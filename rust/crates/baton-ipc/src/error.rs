use baton_core::{CoreError, SafeInt};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidFrame,
    InvalidRequest,
    Disconnected,
    AppOffline,
    AuthenticationFailed,
    ProtocolMismatch,
    Unsupported,
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
    CursorExpired,
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
    StaleInput,
    UnknownQuery,
    QueryExpired,
    WrongQueryKind,
    InvalidPosition,
    QueryLimit,
    StaleResize,
    InvalidGeometry,
    InvalidReason,
    Uncertain,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireError {
    pub code: ErrorCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oldest_cursor: Option<SafeInt>,
}
impl WireError {
    pub const fn new(code: ErrorCode) -> Self {
        Self {
            code,
            oldest_cursor: None,
        }
    }
}
impl std::fmt::Display for WireError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self.code)
    }
}
impl std::error::Error for WireError {}
impl From<CoreError> for WireError {
    fn from(value: CoreError) -> Self {
        use CoreError as C;
        use ErrorCode as W;
        Self::new(match value {
            C::NotOwner => W::NotOwner,
            C::SessionClosed => W::SessionClosed,
            C::ControlUnavailable => W::ControlUnavailable,
            C::StaleControlEpoch => W::StaleControlEpoch,
            C::StaleStream => W::StaleStream,
            C::RequestIdConflict => W::RequestIdConflict,
            C::InputTooLarge => W::InputTooLarge,
            C::InputQueueFull => W::InputQueueFull,
            C::RequestHistoryFull => W::RequestHistoryFull,
            C::InvalidNumber => W::InvalidNumber,
            C::CounterExhausted => W::CounterExhausted,
            C::InvalidCursor => W::InvalidCursor,
            C::CursorExpired { oldest } => {
                return Self {
                    code: W::CursorExpired,
                    oldest_cursor: Some(oldest),
                };
            }
            C::InvalidLimit => W::InvalidLimit,
            C::ReadLimit => W::ReadLimit,
            C::RequestLimit => W::RequestLimit,
            C::Busy => W::Busy,
            C::Capacity => W::Capacity,
            C::DuplicateId => W::DuplicateId,
            C::UnknownId => W::UnknownId,
            C::InvalidAck => W::InvalidAck,
            C::InvalidCompletion => W::InvalidCompletion,
            C::StaleView => W::StaleView,
            C::StaleInput => W::StaleInput,
            C::UnknownQuery => W::UnknownQuery,
            C::QueryExpired => W::QueryExpired,
            C::WrongQueryKind => W::WrongQueryKind,
            C::InvalidPosition => W::InvalidPosition,
            C::QueryLimit => W::QueryLimit,
            C::StaleResize => W::StaleResize,
            C::InvalidGeometry => W::InvalidGeometry,
            C::InvalidReason => W::InvalidReason,
        })
    }
}
