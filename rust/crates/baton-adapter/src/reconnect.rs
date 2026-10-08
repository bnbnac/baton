#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backoff_has_small_jitter_saturates_and_resets() {
        let mut low = Backoff::default();
        let mut high = Backoff::default();
        for (minimum, maximum) in [
            (900, 1100),
            (1800, 2200),
            (3600, 4400),
            (4500, 5000),
            (4500, 5000),
        ] {
            assert_eq!(low.next_with_sample(0).as_millis(), minimum);
            assert_eq!(high.next_with_sample(u16::MAX).as_millis(), maximum);
        }
        low.reset();
        assert_eq!(low.next_with_sample(0).as_millis(), 900);
        for _ in 0..10000 {
            assert!((900..=5000).contains(&low.next_delay().as_millis()));
        }
    }
}
use std::time::Duration;

#[derive(Default)]
pub(crate) struct Backoff {
    step: usize,
}
impl Backoff {
    pub(crate) fn reset(&mut self) {
        self.step = 0;
    }
    pub(crate) fn next_delay(&mut self) -> Duration {
        let mut bytes = (u16::MAX / 2).to_le_bytes();
        let _ = getrandom::fill(&mut bytes);
        self.next_with_sample(u16::from_le_bytes(bytes))
    }
    fn next_with_sample(&mut self, sample: u16) -> Duration {
        let base = [1000_u64, 2000, 4000, 5000][self.step];
        self.step = (self.step + 1).min(3);
        let low = base * 9 / 10;
        let high = (base * 11 / 10).min(5000);
        Duration::from_millis(low + (high - low) * u64::from(sample) / u64::from(u16::MAX))
    }
}
