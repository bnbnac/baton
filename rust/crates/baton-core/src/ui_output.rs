use crate::*;
use std::collections::VecDeque;

pub(crate) struct UiOutput {
    queued: VecDeque<UiChunk>,
    inflight: VecDeque<(SafeInt, usize)>,
    bytes: usize,
    inflight_bytes: usize,
    pub(crate) sequence: SafeInt,
}
impl UiOutput {
    pub fn new() -> Self {
        Self {
            queued: VecDeque::new(),
            inflight: VecDeque::new(),
            bytes: 0,
            inflight_bytes: 0,
            sequence: SafeInt::new(0).unwrap(),
        }
    }
    pub fn push(&mut self, bytes: &[u8]) -> Result<(), CoreError> {
        if bytes.len() > limits::UI_BYTES - self.bytes {
            return Err(CoreError::Capacity);
        }
        let count = bytes.len().div_ceil(limits::UI_CHUNK) as u64;
        if self
            .sequence
            .get()
            .checked_add(count)
            .is_none_or(|n| n > SafeInt::MAX)
        {
            return Err(CoreError::CounterExhausted);
        }
        for part in bytes.chunks(limits::UI_CHUNK) {
            self.sequence = self.sequence.checked_next().unwrap();
            self.queued.push_back(UiChunk {
                seq: self.sequence,
                bytes: part.to_vec(),
            });
        }
        self.bytes += bytes.len();
        Ok(())
    }
    pub fn next(&mut self) -> Option<UiChunk> {
        let front = self.queued.front()?;
        if front.bytes.len() + self.inflight_bytes > limits::UI_CHUNK {
            return None;
        }
        let next = self.queued.pop_front().unwrap();
        self.inflight_bytes += next.bytes.len();
        self.inflight.push_back((next.seq, next.bytes.len()));
        Some(next)
    }
    pub fn ack(&mut self, seq: SafeInt) -> Result<(), CoreError> {
        let Some((expected, len)) = self.inflight.front().copied() else {
            return Err(CoreError::InvalidAck);
        };
        if expected != seq {
            return Err(CoreError::InvalidAck);
        }
        self.inflight.pop_front();
        self.inflight_bytes -= len;
        self.bytes -= len;
        Ok(())
    }
    pub fn bytes(&self) -> usize {
        self.bytes
    }
    pub fn clear(&mut self) {
        self.queued.clear();
        self.inflight.clear();
        self.bytes = 0;
        self.inflight_bytes = 0;
    }
}
