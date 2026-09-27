use serde::{Deserialize, Serialize};

macro_rules! identity {
    ($($name:ident),+) => {$(
        #[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
        pub struct $name(u128);
        impl $name {
            /// Trusted application assembly only; possession is not authentication.
            pub const fn from_u128(value: u128) -> Self { Self(value) }
        }
    )+};
}
identity!(AppId, ConnectionId, SessionId, StreamId, RequestId, ViewId);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize)]
pub struct SafeInt(u64);
impl SafeInt {
    pub const MAX: u64 = (1_u64 << 53) - 1;
    pub fn new(value: u64) -> Result<Self, CoreError> {
        if value <= Self::MAX {
            Ok(Self(value))
        } else {
            Err(CoreError::InvalidNumber)
        }
    }
    pub const fn get(self) -> u64 {
        self.0
    }
    pub fn checked_next(self) -> Result<Self, CoreError> {
        self.0
            .checked_add(1)
            .filter(|n| *n <= Self::MAX)
            .map(Self)
            .ok_or(CoreError::CounterExhausted)
    }
}
impl<'de> Deserialize<'de> for SafeInt {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct IntegerVisitor;
        impl serde::de::Visitor<'_> for IntegerVisitor {
            type Value = SafeInt;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("an integer between 0 and 2^53-1")
            }
            fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<SafeInt, E> {
                SafeInt::new(value).map_err(|_| E::custom("invalid_number"))
            }
            fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<SafeInt, E> {
                u64::try_from(value)
                    .map_err(|_| E::custom("invalid_number"))
                    .and_then(|n| self.visit_u64(n))
            }
        }
        deserializer.deserialize_any(IntegerVisitor)
    }
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum State {
    Connecting,
    UserOwned,
    Transferring,
    AgentOwned,
    Reclaiming,
    Closed,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InputResult {
    Pending,
    Delivered,
    InputInvalidated,
    Uncertain,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WriteResult {
    Delivered,
    Uncertain,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Principal {
    User,
    Agent(ConnectionId),
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CloseReason {
    User,
    TransportLost,
    ConnectionLost,
    AppExit,
    TransitionTimeout,
    CounterExhausted,
    OutputOverload,
    FrontendLost,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CoreError {
    NotOwner,
    SessionClosed,
    ControlUnavailable,
    StaleControlEpoch,
    StaleStream,
    RequestIdConflict,
    InputTooLarge,
    InputQueueFull,
    RequestHistoryFull,
    InvalidNumber,
    CounterExhausted,
    InvalidCursor,
    CursorExpired { oldest: SafeInt },
    InvalidLimit,
    ReadLimit,
    RequestLimit,
    Busy,
    Capacity,
    DuplicateId,
    UnknownId,
    InvalidAck,
    InvalidCompletion,
    StaleView,
    UnknownQuery,
    QueryExpired,
    WrongQueryKind,
    InvalidPosition,
    QueryLimit,
    StaleResize,
    InvalidGeometry,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InputCall {
    pub principal: Principal,
    pub epoch: SafeInt,
    pub request_id: RequestId,
    pub payload: Vec<u8>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReadCall {
    pub connection: ConnectionId,
    pub epoch: SafeInt,
    pub stream: StreamId,
    pub cursor: SafeInt,
    pub limit: usize,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReadPage {
    pub text: String,
    pub next: SafeInt,
    pub oldest: SafeInt,
    pub end: SafeInt,
    pub has_more: bool,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Snapshot {
    pub state: State,
    pub epoch: SafeInt,
    pub assigned: Option<ConnectionId>,
    pub stream: Option<StreamId>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WriteOp {
    pub id: SafeInt,
    pub payload: Vec<u8>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UiChunk {
    pub seq: SafeInt,
    pub bytes: Vec<u8>,
    pub queries: Vec<crate::QueryMark>,
}
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Usage {
    pub queued: usize,
    pub active: usize,
    pub history: usize,
    pub input_bytes: usize,
    pub public_units: usize,
    pub ui_bytes: usize,
}
