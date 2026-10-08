use crate::{ErrorCode, WireError, WireId};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use zeroize::{Zeroize, Zeroizing};
#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{EndpointLease, load_endpoint};
#[derive(Clone, PartialEq, Eq)]
pub struct Secret([u8; 32]);
impl Secret {
    pub fn generate() -> Result<Self, WireError> {
        let mut value = Self([0; 32]);
        getrandom::fill(&mut value.0)
            .map_err(|_| WireError::new(ErrorCode::AuthenticationFailed))?;
        Ok(value)
    }
    pub fn expose_hex(&self) -> Zeroizing<String> {
        Zeroizing::new(self.0.iter().map(|b| format!("{b:02x}")).collect())
    }
    pub fn matches(&self, other: &Self) -> bool {
        bool::from(self.0.ct_eq(&other.0))
    }
}
impl Drop for Secret {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}
impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("<redacted>")
    }
}
impl Serialize for Secret {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.expose_hex())
    }
}
impl<'de> Deserialize<'de> for Secret {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = Zeroizing::new(String::deserialize(d)?);
        if text.len() != 64 || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(serde::de::Error::custom("invalid_secret"));
        }
        let mut value = Self([0; 32]);
        for n in 0..32 {
            value.0[n] = u8::from_str_radix(&text[n * 2..n * 2 + 2], 16)
                .map_err(|_| serde::de::Error::custom("invalid_secret"))?;
        }
        Ok(value)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Discovery {
    pub contract_version: u32,
    pub app_instance_id: WireId,
    pub pipe_name: String,
    pub secret: Secret,
}
impl Discovery {
    pub fn verify(&self, version: u32, app: WireId, secret: &Secret) -> Result<(), WireError> {
        if version != 2 || self.contract_version != 2 {
            return Err(WireError::new(ErrorCode::ProtocolMismatch));
        }
        if app != self.app_instance_id || !self.secret.matches(secret) {
            return Err(WireError::new(ErrorCode::AuthenticationFailed));
        }
        Ok(())
    }
}
