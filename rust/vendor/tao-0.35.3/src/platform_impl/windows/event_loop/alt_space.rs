// Copyright 2026 Baton contributors
// SPDX-License-Identifier: Apache-2.0

use windows::Win32::UI::WindowsAndMessaging::{ISMEX_REPLIED, ISMEX_SEND, WM_SYSCHAR};

/// Return true only when the caller may consume the original message.
pub(super) fn defer(
  msg: u32,
  wparam: usize,
  lparam: isize,
  send_flags: u32,
  post: impl FnOnce() -> bool,
) -> bool {
  msg == WM_SYSCHAR
    && wparam == 32
    && lparam & (1isize << 29) != 0
    && send_flags & (ISMEX_SEND | ISMEX_REPLIED) == ISMEX_SEND
    && post()
}

#[cfg(test)]
mod tests {
  use super::*;
  use windows::Win32::UI::WindowsAndMessaging::{ISMEX_CALLBACK, ISMEX_NOTIFY, WM_CHAR};

  const ALT_CONTEXT: isize = 1 << 29;

  #[test]
  fn blocking_alt_space_queues_once_and_consumes_only_on_success() {
    let mut calls = 0;
    assert!(defer(WM_SYSCHAR, 32, ALT_CONTEXT | 1, ISMEX_SEND, || {
      calls += 1;
      true
    }));
    assert_eq!(calls, 1);
  }

  #[test]
  fn failed_post_preserves_default_processing() {
    let mut calls = 0;
    assert!(!defer(WM_SYSCHAR, 32, ALT_CONTEXT | 1, ISMEX_SEND, || {
      calls += 1;
      false
    }));
    assert_eq!(calls, 1);
  }

  #[test]
  fn replay_replied_and_nonblocking_messages_never_post() {
    for flags in [0, ISMEX_REPLIED, ISMEX_SEND | ISMEX_REPLIED, ISMEX_NOTIFY, ISMEX_CALLBACK] {
      assert!(!defer(WM_SYSCHAR, 32, ALT_CONTEXT | 1, flags, || panic!("unexpected replay")));
    }
  }

  #[test]
  fn other_keys_and_messages_keep_default_semantics() {
    for (msg, key, context) in [(WM_CHAR, 32, ALT_CONTEXT), (WM_SYSCHAR, 65, ALT_CONTEXT), (WM_SYSCHAR, 32, 1)] {
      assert!(!defer(msg, key, context, ISMEX_SEND, || panic!("unrelated message queued")));
    }
  }
}
