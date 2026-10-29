//! Authenticated local IPC contract for Baton Rust, independent of MCP and UI SDKs.
mod backend;
mod codec;
pub mod endpoint;
pub use backend::*;
pub use tokio_util::sync::CancellationToken;
#[cfg(windows)]
mod client;
#[cfg(windows)]
mod server;
#[cfg(windows)]
pub use client::LocalClient;
#[cfg(windows)]
pub use server::LocalServer;
mod error;
mod wire;
pub use codec::*;
pub use error::*;
pub use wire::*;
