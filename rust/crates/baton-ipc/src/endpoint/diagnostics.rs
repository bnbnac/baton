//! Opt-in, thread-local evidence for synchronous Windows endpoint failures.
//! Never writes to stdout/stderr and never retains caller data or paths.

#[derive(Debug)]
pub struct StartupFailure {
    pub operation: &'static str,
    /// Exact native error only when captured directly at the failing API.
    pub os_error: Option<i32>,
    pub line: u32,
}

thread_local! {
    static STARTUP_FAILURE: std::cell::RefCell<Option<StartupFailure>> = const { std::cell::RefCell::new(None) };
}

#[track_caller]
pub(crate) fn record_startup_failure(operation: &'static str, os_error: Option<i32>) {
    let line = std::panic::Location::caller().line();
    // Preserve the initiating failure if cleanup also fails. No paths,
    // SIDs, pipe names, secrets, or terminal data enter this record.
    let _ = STARTUP_FAILURE.try_with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.is_none() {
            *slot = Some(StartupFailure {
                operation,
                os_error,
                line,
            });
        }
    });
}

/// Consume/reset the first failure on this thread. Clear immediately before
/// a synchronous operation and consume immediately after it; do not cross an
/// await or move threads between the operation and collection.
pub fn take_startup_failure() -> Option<StartupFailure> {
    STARTUP_FAILURE.with(|slot| slot.borrow_mut().take())
}
