use baton_core::{CloseReason, SessionHandle};
use russh::{ChannelMsg, ChannelReadHalf};
pub(crate) async fn run(mut channel: ChannelReadHalf, session: SessionHandle) {
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                // The runtime receive slot has a 64 KiB cap; preserve stream order.
                for bytes in data.chunks(65536) {
                    if session.receive(bytes.to_vec()).await.is_err() {
                        return;
                    }
                }
            }
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }
    session.close(CloseReason::TransportLost).await;
}
