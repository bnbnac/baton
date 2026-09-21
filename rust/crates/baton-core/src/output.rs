use crate::*;
use std::collections::VecDeque;

pub struct PublicOutput {
    chars: VecDeque<char>,
    units: usize,
    capacity: usize,
    pub(crate) end: SafeInt,
    carry: [u8; 4],
    carry_len: usize,
}
impl PublicOutput {
    pub fn new(capacity_units: usize) -> Result<Self, CoreError> {
        if !(2..=limits::PUBLIC_UNITS).contains(&capacity_units) {
            return Err(CoreError::InvalidLimit);
        }
        Ok(Self {
            chars: VecDeque::new(),
            units: 0,
            capacity: capacity_units,
            end: SafeInt::new(0).unwrap(),
            carry: [0; 4],
            carry_len: 0,
        })
    }
    pub(crate) fn units(&self) -> usize {
        self.units
    }
    fn append(&mut self, c: char) -> Result<(), CoreError> {
        let next = self
            .end
            .get()
            .checked_add(c.len_utf16() as u64)
            .filter(|n| *n <= SafeInt::MAX)
            .ok_or(CoreError::CounterExhausted)?;
        self.end = SafeInt::new(next).unwrap();
        self.units += c.len_utf16();
        self.chars.push_back(c);
        while self.units > self.capacity {
            self.units -= self.chars.pop_front().unwrap().len_utf16();
        }
        Ok(())
    }
    pub fn receive(&mut self, bytes: &[u8]) -> Result<(), CoreError> {
        // Carry at most three incomplete bytes, never a whole packet.
        for byte in bytes {
            self.carry[self.carry_len] = *byte;
            self.carry_len += 1;
            loop {
                let buffer = self.carry;
                match std::str::from_utf8(&buffer[..self.carry_len]) {
                    Ok(text) => {
                        for c in text.chars() {
                            self.append(c)?;
                        }
                        self.carry_len = 0;
                        break;
                    }
                    Err(error) => {
                        let valid = error.valid_up_to();
                        for c in std::str::from_utf8(&buffer[..valid]).unwrap().chars() {
                            self.append(c)?;
                        }
                        let consumed = if let Some(invalid) = error.error_len() {
                            self.append('\u{fffd}')?;
                            valid + invalid
                        } else {
                            valid
                        };
                        self.carry.copy_within(consumed..self.carry_len, 0);
                        self.carry_len -= consumed;
                        if error.error_len().is_none() || self.carry_len == 0 {
                            break;
                        }
                    }
                }
            }
        }
        Ok(())
    }
    pub fn read(&self, cursor: SafeInt, limit: usize) -> Result<ReadPage, CoreError> {
        if !(2..=limits::READ_UNITS).contains(&limit) {
            return Err(CoreError::InvalidLimit);
        }
        let oldest = SafeInt::new(self.end.get() - self.units as u64).unwrap();
        if cursor < oldest {
            return Err(CoreError::CursorExpired { oldest });
        }
        if cursor > self.end {
            return Err(CoreError::InvalidCursor);
        }
        let mut position = oldest.get();
        let mut taken = 0;
        let mut text = String::new();
        for c in &self.chars {
            let next = position + c.len_utf16() as u64;
            if position < cursor.get() {
                if next > cursor.get() {
                    return Err(CoreError::InvalidCursor);
                }
                position = next;
                continue;
            }
            if taken + c.len_utf16() > limit {
                break;
            }
            taken += c.len_utf16();
            text.push(*c);
            position = next;
        }
        let next = SafeInt::new(cursor.get() + taken as u64).unwrap();
        Ok(ReadPage {
            text,
            next,
            oldest,
            end: self.end,
            has_more: next < self.end,
        })
    }
}
