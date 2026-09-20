use crate::ProbeInput;
use russh::keys::{HashAlg, PublicKeyOrCertificate};
use russh::{ChannelMsg, Disconnect, client};
use std::sync::Arc;

pub(crate) struct HostVerifier {
    expected: String,
}

impl client::Handler for HostVerifier {
    type Error = russh::Error;
    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        Ok(key.public_key().fingerprint(HashAlg::Sha256).to_string() == self.expected)
    }
}

pub(crate) async fn run(input: ProbeInput) -> Result<(), &'static str> {
    if input.case == "host-cancel" {
        return Err("cancelled");
    }
    let config = Arc::new(client::Config::default());
    let mut ssh = client::connect(
        config,
        (input.host, input.port),
        HostVerifier {
            expected: input.host_fingerprint.clone(),
        },
    )
    .await
    .map_err(|e| {
        if matches!(e, russh::Error::UnknownKey) {
            "host_rejected"
        } else {
            "transport_failed"
        }
    })?;
    if input.case == "cancel-before-auth" {
        crate::auth::cancel_barrier().await;
    }
    crate::auth::authenticate(&mut ssh, &input).await?;
    if input.case == "cancel-before-shell" {
        crate::auth::cancel_barrier().await;
    }
    let mut channel = ssh
        .channel_open_session()
        .await
        .map_err(|_| "transport_failed")?;
    channel
        .request_pty(true, "xterm-256color", 120, 32, 0, 0, &[])
        .await
        .map_err(|_| "transport_failed")?;
    wait_success(&mut channel).await?;
    channel
        .request_shell(true)
        .await
        .map_err(|_| "transport_failed")?;
    wait_success(&mut channel).await?;
    if input.case == "openssh" {
        eprintln!("check_initial_geometry");
        command(&mut channel, b"stty size\r", b"32 120\r\n").await?;
        eprintln!("check_resized_geometry");
        channel
            .window_change(91, 27, 0, 0)
            .await
            .map_err(|_| "transport_failed")?;
        command(&mut channel, b"stty size\r", b"27 91\r\n").await?;
        eprintln!("check_sleep_started");
        command(
            &mut channel,
            b"printf 'SLEEP_READY\\n'; sleep 30\r",
            b"SLEEP_READY\r\n",
        )
        .await?;
        eprintln!("check_interrupt");
        command(&mut channel, b"\x03", b"^C").await?;
        eprintln!("check_after_interrupt");
        command(
            &mut channel,
            b"printf 'BATON_PHASE0\\n'\r",
            b"BATON_PHASE0\r\n",
        )
        .await?;
    } else {
        command(&mut channel, b"ABC\r", b"ABC\r").await?;
        channel
            .window_change(91, 27, 0, 0)
            .await
            .map_err(|_| "transport_failed")?;
    }
    channel.close().await.map_err(|_| "transport_failed")?;
    ssh.disconnect(Disconnect::ByApplication, "", "")
        .await
        .map_err(|_| "transport_failed")?;
    // A locally closed channel has no guaranteed Close callback in this SDK.
    drop(channel);
    match ssh.await {
        Ok(()) | Err(russh::Error::Disconnect) => {}
        Err(_) => return Err("transport_failed"),
    }
    Ok(())
}

async fn command(
    channel: &mut russh::Channel<client::Msg>,
    bytes: &[u8],
    expected: &[u8],
) -> Result<(), &'static str> {
    channel.data(bytes).await.map_err(|_| "transport_failed")?;
    let mut received = Vec::new();
    while !received.windows(expected.len()).any(|w| w == expected) {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => {
                if received.len() + data.len() > 65536 {
                    return Err("output_limit");
                }
                received.extend_from_slice(&data);
            }
            Some(ChannelMsg::Close) | None => return Err("transport_failed"),
            _ => {}
        }
    }
    Ok(())
}

async fn wait_success(channel: &mut russh::Channel<client::Msg>) -> Result<(), &'static str> {
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Success) => return Ok(()),
            Some(ChannelMsg::Failure | ChannelMsg::Close) | None => return Err("transport_failed"),
            _ => {}
        }
    }
}
