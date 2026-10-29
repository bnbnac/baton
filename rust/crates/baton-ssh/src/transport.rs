use crate::*;
use baton_core::{CloseReason, Runtime, SessionHandle, Transport, TransportError, WriteResult};
use russh::{ChannelMsg, ChannelReadHalf, ChannelWriteHalf, Disconnect, client};
use std::{
    io,
    pin::Pin,
    task::{Context, Poll},
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::TcpStream,
    sync::oneshot,
    task::JoinHandle,
};

// russh's Handle Drop does not abort its detached task. Cutting its owned stream
// wakes both read and write, including handshake failure before a Handle exists.
struct CutStream {
    socket: TcpStream,
    cut: IoFuture<'static, ()>,
    ended: Option<oneshot::Sender<()>>,
    #[cfg(feature = "acceptance")]
    observer: Arc<dyn AuthUi>,
}
impl CutStream {
    fn cut(&mut self, cx: &mut Context<'_>) -> bool {
        self.cut.as_mut().poll(cx).is_ready()
    }
}
impl Drop for CutStream {
    fn drop(&mut self) {
        #[cfg(feature = "acceptance")]
        self.observer.owned_stream_dropped();
        if let Some(tx) = self.ended.take() {
            let _ = tx.send(());
        }
    }
}
impl AsyncRead for CutStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.cut(cx) {
            return Poll::Ready(Err(io::ErrorKind::ConnectionAborted.into()));
        }
        Pin::new(&mut self.socket).poll_read(cx, buf)
    }
}
impl AsyncWrite for CutStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        if self.cut(cx) {
            return Poll::Ready(Err(io::ErrorKind::ConnectionAborted.into()));
        }
        Pin::new(&mut self.socket).poll_write(cx, buf)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if self.cut(cx) {
            return Poll::Ready(Err(io::ErrorKind::ConnectionAborted.into()));
        }
        Pin::new(&mut self.socket).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.socket).poll_shutdown(cx)
    }
}
struct Lease(CancellationToken);
impl Drop for Lease {
    fn drop(&mut self) {
        self.0.cancel();
    }
}
pub struct ConnectedSsh {
    id: SessionId,
    read: Option<ChannelReadHalf>,
    io: Option<SshTransport>,
    cancel: CancellationToken,
}
struct SshTransport {
    write: ChannelWriteHalf<client::Msg>,
    ssh: Option<client::Handle<crate::host_key::HostVerifier>>,
    reader: Option<JoinHandle<()>>,
    lease: Lease,
    ended: Option<oneshot::Receiver<()>>,
}
impl Drop for SshTransport {
    fn drop(&mut self) {
        self.lease.0.cancel();
        if let Some(reader) = self.reader.take() {
            reader.abort();
        }
    }
}
impl ConnectedSsh {
    pub fn activate(mut self, runtime: &Runtime) -> Result<SessionHandle, SshError> {
        if self.cancel.is_cancelled() {
            let _ = runtime.close_session(self.id, CloseReason::User);
            return Err(SshError::Cancelled);
        }
        let mut io = self.io.take().unwrap();
        let read = self.read.take().unwrap();
        let (tx, rx) = oneshot::channel();
        io.reader = Some(tokio::spawn(async move {
            if let Ok(session) = rx.await {
                crate::reader::run(read, session).await;
            }
        }));
        let handle = runtime
            .activate_session(self.id, Box::new(io))
            .map_err(|_| SshError::CoreRejected)?;
        let _ = tx.send(handle.clone());
        Ok(handle)
    }
}
impl Transport for SshTransport {
    fn write<'a>(&'a mut self, bytes: &'a [u8]) -> IoFuture<'a, WriteResult> {
        Box::pin(async move {
            match self.write.data(bytes).await {
                Ok(()) => WriteResult::Delivered,
                Err(_) => WriteResult::Uncertain,
            }
        })
    }
    fn resize(&mut self, g: Geometry) -> IoFuture<'_, Result<(), TransportError>> {
        Box::pin(async move {
            self.write
                .window_change(g.columns.into(), g.rows.into(), 0, 0)
                .await
                .map_err(|_| TransportError::Disconnected)
        })
    }
    fn close(&mut self) -> IoFuture<'_, ()> {
        Box::pin(async move {
            let _ = self.write.close().await;
            if let Some(ssh) = self.ssh.take() {
                let _ = ssh.disconnect(Disconnect::ByApplication, "", "").await;
                let _ = ssh.await;
            }
            self.lease.0.cancel();
            if let Some(reader) = self.reader.take() {
                let _ = reader.await;
            }
            if let Some(ended) = self.ended.take() {
                let _ = ended.await;
            }
        })
    }
}
pub(crate) async fn connect(
    r: ConnectRequest,
    ui: Arc<dyn AuthUi>,
    cancel: CancellationToken,
) -> Result<ConnectedSsh, SshError> {
    if r.target.host.is_empty()
        || r.target.host.len() > 253
        || r.target
            .host
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
        || r.target.port == 0
        || r.username.is_empty()
        || r.username.len() > 256
        || r.username.chars().any(char::is_control)
        || Geometry::new(r.initial_geometry.columns, r.initial_geometry.rows).is_err()
        || r.initial_geometry
            != (Geometry {
                columns: 120,
                rows: 32,
            })
    {
        return Err(SshError::InvalidInput);
    }
    let ctx = Arc::new(auth::Context::new(&r, ui, cancel.clone()));
    ctx.check()?;
    let socket = ctx
        .network(TcpStream::connect((r.target.host.as_str(), r.target.port)))
        .await?;
    let cut = CancellationToken::new();
    let lease = Lease(cut.clone());
    let (tx, ended) = oneshot::channel();
    let stream = CutStream {
        socket,
        cut: Box::pin(cut.cancelled_owned()),
        ended: Some(tx),
        #[cfg(feature = "acceptance")]
        observer: ctx.ui.clone(),
    };
    let config = client::Config {
        channel_buffer_size: 1,
        window_size: 65536,
        maximum_packet_size: 32768,
        ..Default::default()
    };
    let handshake = ctx
        .network(client::connect_stream(
            Arc::new(config),
            stream,
            crate::host_key::HostVerifier {
                context: ctx.clone(),
                target: r.target.clone(),
                shutdown: lease.0.clone(),
            },
        ))
        .await;
    let mut ssh = match handshake {
        Ok(ssh) => ssh,
        Err(error) => {
            lease.0.cancel();
            let _ = tokio::time::timeout_at(ctx.cleanup_deadline(), ended).await;
            return Err(error);
        }
    };
    let setup = async {
        auth::authenticate(&mut ssh, &ctx, &r).await?;
        #[cfg(feature = "acceptance")]
        ctx.ui.before_pty();
        ctx.check()?;
        let mut channel = ctx.network(ssh.channel_open_session()).await?;
        ctx.network(channel.request_pty(
            true,
            "xterm-256color",
            r.initial_geometry.columns.into(),
            r.initial_geometry.rows.into(),
            0,
            0,
            &[],
        ))
        .await?;
        ctx.network(wait_success(&mut channel)).await?;
        ctx.check()?;
        ctx.network(channel.request_shell(true)).await?;
        ctx.network(wait_success(&mut channel)).await?;
        ctx.check()?;
        Ok::<_, SshError>(channel)
    }
    .await;
    match setup {
        Ok(channel) => {
            let (read, write) = channel.split();
            Ok(ConnectedSsh {
                id: r.session,
                read: Some(read),
                io: Some(SshTransport {
                    write,
                    ssh: Some(ssh),
                    reader: None,
                    lease,
                    ended: Some(ended),
                }),
                cancel,
            })
        }
        Err(error) => {
            lease.0.cancel();
            // Interactive authentication waits on Handle's sender, not the socket.
            // Drop that sender before waiting for the SDK-owned stream to retire.
            drop(ssh);
            let _ = tokio::time::timeout_at(ctx.cleanup_deadline(), async {
                let _ = ended.await;
            })
            .await;
            Err(error)
        }
    }
}
async fn wait_success(channel: &mut russh::Channel<client::Msg>) -> Result<(), SshError> {
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Success) => return Ok(()),
            Some(ChannelMsg::Failure | ChannelMsg::Close | ChannelMsg::Eof) | None => {
                return Err(SshError::TransportFailed);
            }
            _ => {}
        }
    }
}
