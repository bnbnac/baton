use baton_core::*;
#[derive(Default)]
pub struct Ids(u128);
impl Ids {
    pub fn new() -> Self { Self::default() }
    fn next(&mut self) -> u128 { self.0 = self.0.checked_add(1).unwrap(); self.0 }
    pub fn app(&mut self) -> AppId { AppId::from_u128(self.next()) }
    pub fn connection(&mut self) -> ConnectionId { ConnectionId::from_u128(self.next()) }
    pub fn session(&mut self) -> SessionId { SessionId::from_u128(self.next()) }
    pub fn stream(&mut self) -> StreamId { StreamId::from_u128(self.next()) }
    pub fn request(&mut self) -> RequestId { RequestId::from_u128(self.next()) }
}

