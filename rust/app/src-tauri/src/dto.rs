use baton_core::SafeInt;
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Id(pub u128);
impl Serialize for Id {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&format!("{:032x}", self.0))
    }
}
impl<'de> Deserialize<'de> for Id {
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
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConnectionRequest {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub label: String,
    pub method: Method,
}
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Method {
    Password,
    Key,
    Interactive,
}
#[derive(Clone, Debug, Serialize)]
pub struct SessionInfo {
    pub id: Id,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub state: String,
    pub epoch: SafeInt,
    pub error: Option<String>,
    pub has_terminal: bool,
    pub assigned_connection: Option<Id>,
    pub intervention: Option<baton_ipc::Intervention>,
}
#[derive(Clone, Debug, Serialize)]
pub struct ConnectionInfo {
    pub id: Id,
    pub display_name: String,
}
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnershipRequest {
    pub id: Id,
    pub expected_epoch: SafeInt,
}
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HandoffRequest {
    pub id: Id,
    pub expected_epoch: SafeInt,
    pub connection_id: Id,
}
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeclineRequest {
    pub id: Id,
    pub expected_epoch: SafeInt,
    pub request_id: Id,
}
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct AppError {
    pub code: String,
}
impl AppError {
    pub fn new(code: &str) -> Self {
        Self { code: code.into() }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UiEvent {
    Connections { connections: Vec<ConnectionInfo> },
    Sessions { sessions: Vec<SessionInfo> },
    Heartbeat { challenge: Id },
    Auth { prompt: AuthPromptDto },
}
#[derive(Clone, Debug, Serialize)]
pub struct AuthPromptDto {
    pub session: Id,
    pub attempt: Id,
    pub challenge: Id,
    pub kind: String,
    pub display: String,
    pub prompts: Vec<PromptFieldDto>,
}
#[derive(Clone, Debug, Serialize)]
pub struct PromptFieldDto {
    pub text: String,
    pub echo: bool,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Answer {
    Host { accept: bool },
    Password { password: String },
    Key { encoded: String, passphrase: String },
    Interactive { responses: Vec<String> },
}
impl Drop for Answer {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        match self {
            Self::Password { password } => password.zeroize(),
            Self::Key {
                encoded,
                passphrase,
            } => {
                encoded.zeroize();
                passphrase.zeroize();
            }
            Self::Interactive { responses } => responses.zeroize(),
            _ => {}
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthResponse {
    pub session: Id,
    pub attempt: Id,
    pub challenge: Id,
    pub answer: Answer,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub session: Id,
    pub view: Id,
}
#[derive(Clone, Debug, Serialize)]
pub struct FrameDto {
    pub binding: Binding,
    pub seq: SafeInt,
    pub bytes: Vec<u8>,
    pub queries: Vec<QueryDto>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryDto {
    pub id: SafeInt,
    pub kind: String,
    pub epoch: SafeInt,
    pub end_offset: usize,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UserInput {
    pub binding: Binding,
    pub epoch: SafeInt,
    pub input_seq: SafeInt,
    pub data: Vec<u8>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionRequest {
    pub id: Id,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AckRequest {
    pub binding: Binding,
    pub seq: SafeInt,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResizeRequest {
    pub binding: Binding,
    pub resize_seq: SafeInt,
    pub columns: u16,
    pub rows: u16,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplyRequest {
    pub binding: Binding,
    pub epoch: SafeInt,
    pub query: SafeInt,
    pub kind: ReplyKind,
    pub row: Option<u16>,
    pub column: Option<u16>,
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplyKind {
    Dsr,
    Cpr,
    Da,
}
impl Binding {
    pub(crate) fn core(self) -> baton_core::ViewBinding {
        baton_core::ViewBinding {
            session: baton_core::SessionId::from_u128(self.session.0),
            generation: baton_core::ViewId::from_u128(self.view.0),
        }
    }
}
