use crate::{ErrorCode, WireError};
use baton_core::{SafeInt, limits};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct WireId(u128);
impl WireId {
    pub const fn from_u128(value: u128) -> Self {
        Self(value)
    }
    pub const fn as_u128(self) -> u128 {
        self.0
    }
}
impl Serialize for WireId {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&format!("{:032x}", self.0))
    }
}
impl<'de> Deserialize<'de> for WireId {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        if text.len() != 32 || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(serde::de::Error::custom("invalid_id"));
        }
        u128::from_str_radix(&text, 16)
            .map(Self)
            .map_err(|_| serde::de::Error::custom("invalid_id"))
    }
}
pub const CONTRACT_VERSION: u32 = 3;

/// A Claude session's identity, carried on every agent request. It is a trusted
/// claim by the session, not an authenticated credential.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct AgentKey(u128);
impl AgentKey {
    pub const fn from_u128(value: u128) -> Self {
        Self(value)
    }
    pub const fn as_u128(self) -> u128 {
        self.0
    }
    /// Accepts the hyphenated 8-4-4-4-12 form or 32 plain hex digits, in either
    /// case. The nil value is rejected so an unset key never becomes a session.
    pub fn parse(text: &str) -> Option<Self> {
        let bytes = text.as_bytes();
        let hex: String = match bytes.len() {
            32 => text.to_owned(),
            36 => {
                if [8, 13, 18, 23].iter().any(|&i| bytes[i] != b'-') {
                    return None;
                }
                text.chars().filter(|c| *c != '-').collect()
            }
            _ => return None,
        };
        if hex.len() != 32 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let value = u128::from_str_radix(&hex, 16).ok()?;
        (value != 0).then_some(Self(value))
    }
}
impl Serialize for AgentKey {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let v = self.0;
        s.serialize_str(&format!(
            "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
            (v >> 96) as u32,
            (v >> 80) & 0xffff,
            (v >> 64) & 0xffff,
            (v >> 48) & 0xffff,
            v & 0xffff_ffff_ffff
        ))
    }
}
impl<'de> Deserialize<'de> for AgentKey {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        Self::parse(&text).ok_or_else(|| serde::de::Error::custom("invalid_agent_key"))
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case", deny_unknown_fields)]
pub enum AgentRequest {
    Status {
        agent_key: AgentKey,
    },
    ReadOutput {
        agent_key: AgentKey,
        session_id: WireId,
        control_epoch: SafeInt,
        stream_id: WireId,
        cursor: SafeInt,
        limit: u32,
        wait_ms: u32,
    },
    SendText {
        agent_key: AgentKey,
        session_id: WireId,
        control_epoch: SafeInt,
        request_id: WireId,
        text: String,
    },
    SendKey {
        agent_key: AgentKey,
        session_id: WireId,
        control_epoch: SafeInt,
        request_id: WireId,
        key: Key,
    },
    RequestUserControl {
        agent_key: AgentKey,
        session_id: WireId,
        control_epoch: SafeInt,
        request_id: WireId,
        reason: String,
    },
    SetConnectionName {
        agent_key: AgentKey,
        name: String,
    },
}
pub const CONNECTION_NAME_CHARS: usize = 64;
// Invisible and bidi-override characters pass char::is_control but can blank a label or reorder it to mimic another session.
fn is_hidden_format(c: char) -> bool {
    matches!(c,
        '\u{00AD}' | '\u{034F}' | '\u{061C}' | '\u{115F}' | '\u{1160}' | '\u{180E}'
        | '\u{200B}'..='\u{200F}'
        | '\u{2028}'..='\u{202E}'
        | '\u{2060}'..='\u{2064}'
        | '\u{2066}'..='\u{2069}'
        | '\u{2800}' | '\u{3164}' | '\u{FEFF}' | '\u{FFA0}'
        | '\u{E0001}' | '\u{E0020}'..='\u{E007F}')
}
impl AgentRequest {
    pub fn agent_key(&self) -> AgentKey {
        match self {
            Self::Status { agent_key }
            | Self::ReadOutput { agent_key, .. }
            | Self::SendText { agent_key, .. }
            | Self::SendKey { agent_key, .. }
            | Self::RequestUserControl { agent_key, .. }
            | Self::SetConnectionName { agent_key, .. } => *agent_key,
        }
    }
    pub fn validate(&self) -> Result<(), WireError> {
        match self {
            Self::SendText { text, .. } if text.len() > limits::INPUT_BYTES => {
                Err(WireError::new(ErrorCode::InputTooLarge))
            }
            Self::ReadOutput { limit, wait_ms, .. }
                if !(2..=32768).contains(limit) || *wait_ms > 10000 =>
            {
                Err(WireError::new(ErrorCode::InvalidLimit))
            }
            Self::RequestUserControl { reason, .. }
                if reason.len() > 2048 || reason.chars().any(char::is_control) =>
            {
                Err(WireError::new(ErrorCode::InvalidRequest))
            }
            Self::SetConnectionName { name, .. }
                if name.trim().is_empty()
                    || name.chars().count() > CONNECTION_NAME_CHARS
                    || name.chars().any(|c| c.is_control() || is_hidden_format(c)) =>
            {
                Err(WireError::new(ErrorCode::InvalidRequest))
            }
            _ => Ok(()),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Key {
    Enter,
    #[serde(rename = "Ctrl+C")]
    CtrlC,
    Tab,
    Escape,
    #[serde(rename = "Ctrl+D")]
    CtrlD,
    Backspace,
}
impl Key {
    pub fn bytes(self) -> &'static [u8] {
        match self {
            Self::Enter => b"\r",
            Self::CtrlC => b"\x03",
            Self::Tab => b"\t",
            Self::Escape => b"\x1b",
            Self::CtrlD => b"\x04",
            Self::Backspace => b"\x7f",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AgentResponse {
    Status(StatusResult),
    Output(OutputPage),
    Input { result: InputOutcome },
    Intervention { result: InterventionOutcome },
    ConnectionName {},
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputOutcome {
    Delivered,
    InputInvalidated,
    Uncertain,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InterventionOutcome {
    Queued,
    Duplicate,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppState {
    Online,
    Offline,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusResult {
    pub contract_version: u32,
    pub app_state: AppState,
    pub app_instance_id: Option<WireId>,
    pub connection_id: Option<WireId>,
    pub sessions: Vec<AgentSession>,
}
impl StatusResult {
    pub fn offline() -> Self {
        Self {
            contract_version: CONTRACT_VERSION,
            app_state: AppState::Offline,
            app_instance_id: None,
            connection_id: None,
            sessions: vec![],
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentSession {
    pub session_id: WireId,
    pub label: String,
    pub target: Target,
    pub state: SessionState,
    pub control_epoch: SafeInt,
    pub stream_id: Option<WireId>,
    pub geometry: Geometry,
    pub intervention: Option<Intervention>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub host: String,
    pub port: u16,
    pub username: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Connecting,
    UserOwned,
    Transferring,
    AgentOwned,
    Reclaiming,
    Closed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Geometry {
    pub columns: u16,
    pub rows: u16,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Intervention {
    pub request_id: WireId,
    pub reason: String,
    pub state: InterventionState,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InterventionState {
    Requested,
    Declined,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutputPage {
    pub text: String,
    pub next_cursor: SafeInt,
    pub oldest_cursor: SafeInt,
    pub end_cursor: SafeInt,
    pub has_more: bool,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Frame {
    Hello {
        contract_version: u32,
        app_instance_id: WireId,
        secret: crate::endpoint::Secret,
    },
    Welcome {
        contract_version: u32,
        app_instance_id: WireId,
        connection_id: WireId,
    },
    Rejected {
        error: WireError,
    },
    Request {
        id: SafeInt,
        body: AgentRequest,
    },
    Response {
        id: SafeInt,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<AgentResponse>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<WireError>,
    },
    Cancel {
        id: SafeInt,
    },
}
impl std::fmt::Debug for Frame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Frame(<redacted>)")
    }
}
impl Frame {
    pub fn success(id: SafeInt, result: AgentResponse) -> Self {
        Self::Response {
            id,
            result: Some(result),
            error: None,
        }
    }
    pub fn failure(id: SafeInt, error: WireError) -> Self {
        Self::Response {
            id,
            result: None,
            error: Some(error),
        }
    }
    pub fn validate(&self) -> Result<(), WireError> {
        match self {
            Self::Request { body, .. } => body.validate(),
            Self::Response { result, error, .. } if result.is_some() == error.is_some() => {
                Err(WireError::new(ErrorCode::InvalidFrame))
            }
            _ => Ok(()),
        }
    }
}
