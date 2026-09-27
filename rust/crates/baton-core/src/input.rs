use crate::*;
use std::collections::{BTreeMap, VecDeque};

struct Entry {
    payload: Vec<u8>,
    result: InputResult,
}
#[derive(Clone, Copy)]
struct Active {
    op: SafeInt,
    request: RequestId,
}
pub(crate) struct Inputs {
    entries: BTreeMap<RequestId, Entry>,
    queued: VecDeque<RequestId>,
    active: Option<Active>,
    pub(crate) sequence: SafeInt,
}
impl Inputs {
    pub(crate) fn next_request(&self) -> Option<RequestId> {
        self.queued.front().copied()
    }
    pub fn new() -> Self {
        Self {
            entries: BTreeMap::new(),
            queued: VecDeque::new(),
            active: None,
            sequence: SafeInt::new(0).unwrap(),
        }
    }
    pub fn submit(&mut self, id: RequestId, payload: Vec<u8>) -> Result<InputResult, CoreError> {
        if payload.len() > limits::INPUT_BYTES {
            return Err(CoreError::InputTooLarge);
        }
        if let Some(entry) = self.entries.get(&id) {
            return if entry.payload == payload {
                Ok(entry.result)
            } else {
                Err(CoreError::RequestIdConflict)
            };
        }
        if self.queued.len() >= limits::INPUT_QUEUE {
            return Err(CoreError::InputQueueFull);
        }
        if self.entries.len() >= limits::INPUT_HISTORY {
            return Err(CoreError::RequestHistoryFull);
        }
        self.entries.insert(
            id,
            Entry {
                payload,
                result: InputResult::Pending,
            },
        );
        self.queued.push_back(id);
        Ok(InputResult::Pending)
    }
    pub fn result(&self, id: RequestId) -> Result<InputResult, CoreError> {
        self.entries
            .get(&id)
            .map(|e| e.result)
            .ok_or(CoreError::UnknownId)
    }
    pub fn cancel(&mut self, id: RequestId) -> Result<InputResult, CoreError> {
        let entry = self.entries.get_mut(&id).ok_or(CoreError::UnknownId)?;
        if self.active.is_some_and(|a| a.request == id) {
            return Ok(entry.result);
        }
        if entry.result == InputResult::Pending {
            self.queued.retain(|queued| *queued != id);
            entry.result = InputResult::InputInvalidated;
        }
        Ok(entry.result)
    }
    pub fn start(&mut self) -> Result<Option<WriteOp>, CoreError> {
        if self.active.is_some() || self.queued.is_empty() {
            return Ok(None);
        }
        let sequence = self.reserve_sequence()?;
        let id = self.queued.pop_front().unwrap();
        self.active = Some(Active {
            op: sequence,
            request: id,
        });
        Ok(Some(WriteOp {
            id: sequence,
            payload: self.entries[&id].payload.clone(),
        }))
    }
    pub fn finish(&mut self, id: SafeInt, result: WriteResult) -> Result<(), CoreError> {
        let active = self
            .active
            .filter(|a| a.op == id)
            .ok_or(CoreError::InvalidCompletion)?;
        self.entries.get_mut(&active.request).unwrap().result = match result {
            WriteResult::Delivered => InputResult::Delivered,
            WriteResult::Uncertain => InputResult::Uncertain,
        };
        self.active = None;
        Ok(())
    }
    pub fn active(&self) -> bool {
        self.active.is_some()
    }
    pub fn reserve_sequence(&mut self) -> Result<SafeInt, CoreError> {
        self.sequence = self.sequence.checked_next()?;
        Ok(self.sequence)
    }
    fn invalidate_queued(&mut self) {
        for id in self.queued.drain(..) {
            self.entries.get_mut(&id).unwrap().result = InputResult::InputInvalidated;
        }
    }
    pub fn begin_epoch(&mut self) {
        self.invalidate_queued();
        self.entries
            .retain(|id, _| self.active.is_some_and(|a| a.request == *id));
    }
    pub fn clear(&mut self) {
        self.queued.clear();
        self.entries.clear();
        self.active = None;
    }
    pub fn usage(&self) -> Usage {
        Usage {
            queued: self.queued.len(),
            active: usize::from(self.active.is_some()),
            history: self.entries.len(),
            input_bytes: self.entries.values().map(|e| e.payload.len()).sum(),
            ..Usage::default()
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalidation_marks_only_unstarted_work() {
        let mut q = Inputs::new();
        q.submit(RequestId::from_u128(1), b"one".to_vec()).unwrap();
        q.submit(RequestId::from_u128(2), b"two".to_vec()).unwrap();
        q.start().unwrap().unwrap();
        q.invalidate_queued();
        assert_eq!(q.result(RequestId::from_u128(1)), Ok(InputResult::Pending));
        assert_eq!(
            q.result(RequestId::from_u128(2)),
            Ok(InputResult::InputInvalidated)
        );
    }
    #[test]
    fn sequence_overflow_does_not_dequeue_or_start() {
        let mut q = Inputs::new();
        q.sequence = SafeInt::new(SafeInt::MAX).unwrap();
        q.submit(RequestId::from_u128(1), b"x".to_vec()).unwrap();
        assert_eq!(q.start(), Err(CoreError::CounterExhausted));
        assert_eq!(q.usage().queued, 1);
        assert_eq!(q.usage().active, 0);
    }
}
