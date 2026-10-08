//! Authenticated local IPC contract for Baton Rust, independent of MCP and UI SDKs.
mod codec;
mod error;
mod wire;
pub use codec::*;
pub use error::*;
pub use wire::*;
