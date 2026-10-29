use crate::{ProbeInput, pty::HostVerifier};
use russh::{
    client::{Handle, KeyboardInteractiveAuthResponse},
    keys::{PrivateKeyWithHashAlg, decode_secret_key},
};
use std::sync::Arc;

pub(crate) async fn cancel_barrier() {
    println!("{{\"stage\":\"cancel-barrier\"}}");
    std::future::pending::<()>().await;
}

pub(crate) async fn authenticate(
    ssh: &mut Handle<HostVerifier>,
    input: &ProbeInput,
) -> Result<(), &'static str> {
    let credential = &input.credential;
    if let Some(encoded) = &credential.private_key {
        let key =
            decode_secret_key(encoded, Some(&credential.passphrase)).map_err(|_| "auth_failed")?;
        let result = ssh
            .authenticate_publickey(
                &credential.username,
                PrivateKeyWithHashAlg::new(Arc::new(key), None),
            )
            .await
            .map_err(|_| "auth_failed")?;
        return if result.success() {
            Ok(())
        } else {
            Err("auth_failed")
        };
    }
    let interactive =
        ["interactive-two-rounds", "cancel-between-rounds"].contains(&input.case.as_str());
    if !interactive {
        let result = ssh
            .authenticate_password(&credential.username, &credential.password)
            .await
            .map_err(|_| "auth_failed")?;
        if result.success() {
            return Ok(());
        }
        if input.case != "password-then-interactive"
            || !matches!(
                result,
                russh::client::AuthResult::Failure {
                    partial_success: true,
                    ..
                }
            )
        {
            return Err("auth_failed");
        }
    }
    let mut reply = ssh
        .authenticate_keyboard_interactive_start(&credential.username, None)
        .await
        .map_err(|_| "auth_failed")?;
    let mut round = 0;
    loop {
        match reply {
            KeyboardInteractiveAuthResponse::Success => return Ok(()),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Err("auth_failed"),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                if round == 1 && input.case == "cancel-between-rounds" {
                    cancel_barrier().await;
                }
                if prompts.len() != 1 || round >= credential.responses.len() {
                    return Err("auth_failed");
                }
                reply = ssh
                    .authenticate_keyboard_interactive_respond(vec![
                        credential.responses[round].clone(),
                    ])
                    .await
                    .map_err(|_| "auth_failed")?;
                round += 1;
            }
        }
    }
}
