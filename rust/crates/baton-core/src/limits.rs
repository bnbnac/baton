//! Product limits, independently exercised at their admission boundaries.
pub const CONNECTIONS: usize = 32;
pub const SESSIONS: usize = 16;
pub const INPUT_BYTES: usize = 16 * 1024;
pub const INPUT_QUEUE: usize = 32;
pub const INPUT_HISTORY: usize = 4096;
pub const PUBLIC_UNITS: usize = 1024 * 1024;
pub const READ_UNITS: usize = 32768;
pub const UI_BYTES: usize = 1024 * 1024;
pub const UI_CHUNK: usize = 64 * 1024;
pub const WAIT_MS: u32 = 10000;
pub const WAIT_READS: usize = 8;
pub const REQUESTS: usize = 16;
pub const TRANSITION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
