use baton_core::*;
pub fn agent_session() -> (Session, ConnectionId, SafeInt, StreamId) {
    let mut ids = Ids::new();
    let mut s = Session::new(ids.session());
    let a = ids.connection();
    let stream = ids.stream();
    s.connected().unwrap();
    s.handoff(a, stream, std::time::Duration::ZERO).unwrap();
    let e = s.snapshot().epoch;
    (s, a, e, stream)
}
pub fn agent_call(
    connection: ConnectionId,
    epoch: SafeInt,
    id: RequestId,
    bytes: &[u8],
) -> InputCall {
    InputCall {
        principal: Principal::Agent(connection),
        epoch,
        request_id: id,
        payload: bytes.to_vec(),
    }
}
#[derive(Default)]
pub struct Ids(u128);
impl Ids {
    pub fn new() -> Self {
        Self::default()
    }
    fn next(&mut self) -> u128 {
        self.0 = self.0.checked_add(1).unwrap();
        self.0
    }
    pub fn app(&mut self) -> AppId {
        AppId::from_u128(self.next())
    }
    pub fn connection(&mut self) -> ConnectionId {
        ConnectionId::from_u128(self.next())
    }
    pub fn session(&mut self) -> SessionId {
        SessionId::from_u128(self.next())
    }
    pub fn stream(&mut self) -> StreamId {
        StreamId::from_u128(self.next())
    }
    pub fn request(&mut self) -> RequestId {
        RequestId::from_u128(self.next())
    }
}
