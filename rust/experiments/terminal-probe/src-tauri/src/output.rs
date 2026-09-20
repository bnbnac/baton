use std::collections::{BTreeMap, VecDeque};
#[derive(Default)]
pub struct Output {
    queue: VecDeque<Vec<u8>>,
    pending: BTreeMap<u64, usize>,
    queued: usize,
    inflight: usize,
    seq: u64,
}
pub struct Chunk {
    pub seq: u64,
    pub bytes: Vec<u8>,
}
impl Output {
    pub fn enqueue(&mut self, bytes: Vec<u8>) -> Result<(), &'static str> {
        if bytes.len() > 1048576 - self.queued {
            return Err("output_overload");
        }
        self.queued += bytes.len();
        for chunk in bytes.chunks(65536) {
            self.queue.push_back(chunk.to_vec());
        }
        Ok(())
    }
    pub fn take(&mut self) -> Result<Option<Chunk>, &'static str> {
        let Some(front) = self.queue.front() else {
            return Ok(None);
        };
        if front.len() > 65536 - self.inflight {
            return Ok(None);
        }
        let seq = self
            .seq
            .checked_add(1)
            .filter(|v| *v <= 9_007_199_254_740_991)
            .ok_or("sequence_overflow")?;
        let bytes = self.queue.pop_front().unwrap();
        self.seq = seq;
        self.queued -= bytes.len();
        self.inflight += bytes.len();
        self.pending.insert(seq, bytes.len());
        Ok(Some(Chunk { seq, bytes }))
    }
    pub fn ack(&mut self, seq: u64) -> Result<(), &'static str> {
        if self.pending.first_key_value().map(|(key, _)| *key) != Some(seq) {
            return Err("invalid_ack");
        }
        self.inflight -= self.pending.remove(&seq).unwrap();
        Ok(())
    }
    pub fn sizes(&self) -> (usize, usize) {
        (self.queued, self.inflight)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn max_safe_sequence_never_wraps_or_releases_bytes() {
        let mut output = Output {
            seq: 9_007_199_254_740_990,
            ..Output::default()
        };
        output.enqueue(vec![1]).unwrap();
        let last = output.take().unwrap().unwrap();
        assert_eq!(last.seq, 9_007_199_254_740_991);
        output.ack(last.seq).unwrap();
        output.enqueue(vec![2]).unwrap();
        assert_eq!(output.take().err(), Some("sequence_overflow"));
        assert_eq!(output.sizes(), (1, 0));
    }
    #[test]
    fn ack_backpressure_caps_inflight_and_preserves_bytes() {
        let mut output = Output::default();
        output.enqueue(vec![7; 65537]).unwrap();
        let first = output.take().unwrap().unwrap();
        assert_eq!(first.bytes, vec![7; 65536]);
        assert!(output.take().unwrap().is_none());
        assert_eq!(output.sizes(), (1, 65536));
        assert!(output.ack(first.seq + 1).is_err());
        output.ack(first.seq).unwrap();
        assert!(output.ack(first.seq).is_err());
        assert_eq!(output.take().unwrap().unwrap().bytes, vec![7]);
    }
    #[test]
    fn queue_overflow_does_not_allocate_or_admit_more_output() {
        let mut output = Output::default();
        output.enqueue(vec![0; 1048576]).unwrap();
        assert!(output.enqueue(vec![1]).is_err());
        assert_eq!(output.sizes(), (1048576, 0));
    }
}
