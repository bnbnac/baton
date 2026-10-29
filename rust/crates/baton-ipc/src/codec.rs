use crate::{ErrorCode, Frame, WireError};
use std::io::{self, Write};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use zeroize::{Zeroize, Zeroizing};
pub const MAX_FRAME_BYTES: usize = 256 * 1024;
fn invalid() -> WireError {
    WireError::new(ErrorCode::InvalidFrame)
}
pub async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> Result<Frame, WireError> {
    let mut header = [0; 4];
    reader
        .read_exact(&mut header)
        .await
        .map_err(|_| invalid())?;
    let size = u32::from_le_bytes(header) as usize;
    if size == 0 || size > MAX_FRAME_BYTES {
        return Err(invalid());
    }
    let mut payload = Zeroizing::new(vec![0; size]);
    reader
        .read_exact(&mut payload)
        .await
        .map_err(|_| invalid())?;
    let frame: Frame = serde_json::from_slice(&payload).map_err(|_| invalid())?;
    frame.validate()?;
    Ok(frame)
}
struct Bounded(Vec<u8>);
impl Drop for Bounded {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}
impl Write for Bounded {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > MAX_FRAME_BYTES - self.0.len() {
            return Err(io::Error::other("frame_limit"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
pub async fn write_frame<W: AsyncWrite + Unpin>(
    writer: &mut W,
    frame: &Frame,
) -> Result<(), WireError> {
    frame.validate()?;
    let mut payload = Bounded(Vec::new());
    serde_json::to_writer(&mut payload, frame).map_err(|_| invalid())?;
    writer
        .write_all(&(payload.0.len() as u32).to_le_bytes())
        .await
        .map_err(|_| WireError::new(ErrorCode::Disconnected))?;
    writer
        .write_all(&payload.0)
        .await
        .map_err(|_| WireError::new(ErrorCode::Disconnected))?;
    writer
        .flush()
        .await
        .map_err(|_| WireError::new(ErrorCode::Disconnected))
}
