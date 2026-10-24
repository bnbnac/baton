// Exercise the actual patched Tao HWND callback. All windows are hidden and
// owned by this test; no desktop application receives synthetic messages.
#[cfg(all(test, windows))]
mod tests {
    use std::{
        cell::Cell,
        thread,
        time::{Duration, Instant},
    };
    use tao::{
        event_loop::EventLoopBuilder,
        platform::windows::{EventLoopBuilderExtWindows, WindowExtWindows},
        window::WindowBuilder,
    };
    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::*,
        },
    };

    struct Probe {
        destroy: bool,
        sent: Cell<usize>,
        replayed: Cell<usize>,
        destroy_ok: Cell<bool>,
        queued_before_destroy: Cell<bool>,
        wrong_args: Cell<bool>,
        menu: Cell<usize>,
    }
    // Declared after Window/EventLoop so unwinding removes the callback before
    // either their teardown or the callback data's deallocation.
    struct ProbeGuard {
        hwnd: HWND,
        state: Option<Box<Probe>>,
    }
    impl ProbeGuard {
        fn install(hwnd: HWND, destroy: bool) -> Self {
            let guard = Self {
                hwnd,
                state: Some(Box::new(Probe {
                    destroy,
                    sent: Cell::new(0),
                    replayed: Cell::new(0),
                    destroy_ok: Cell::new(false),
                    queued_before_destroy: Cell::new(false),
                    wrong_args: Cell::new(false),
                    menu: Cell::new(0),
                })),
            };
            let data = (&**guard.state.as_ref().unwrap() as *const Probe) as usize;
            assert!(unsafe { SetWindowSubclass(hwnd, Some(probe), 1, data) }.as_bool());
            guard
        }
    }
    impl Drop for ProbeGuard {
        fn drop(&mut self) {
            if unsafe { IsWindow(Some(self.hwnd)) }.as_bool() {
                let removed = unsafe { RemoveWindowSubclass(self.hwnd, Some(probe), 1) }.as_bool();
                let destroyed = unsafe { DestroyWindow(self.hwnd) }.is_ok();
                if !removed && !destroyed && unsafe { IsWindow(Some(self.hwnd)) }.as_bool() {
                    // Never free callback data if Windows retained its pointer.
                    // This exceptional leak is safer than UAF during unwinding.
                    let _ = Box::leak(self.state.take().unwrap());
                }
            }
        }
    }
    const KEY_BITS: isize = (1 << 29) | (0x39 << 16) | 1;
    unsafe extern "system" fn probe(
        hwnd: HWND,
        msg: u32,
        wp: WPARAM,
        lp: LPARAM,
        _: usize,
        data: usize,
    ) -> LRESULT {
        let p = unsafe { &*(data as *const Probe) };
        if msg == WM_ENTERMENULOOP {
            p.menu.set(p.menu.get() + 1);
            // Bound the unpatched negative control if it enters a native menu.
            let _ = unsafe { PostMessageW(Some(hwnd), WM_CANCELMODE, WPARAM(0), LPARAM(0)) };
        }
        if msg == WM_SYSCHAR {
            p.wrong_args
                .set(p.wrong_args.get() || wp.0 != 32 || lp.0 != KEY_BITS);
            let sent =
                unsafe { InSendMessageEx(None) } & (ISMEX_SEND | ISMEX_REPLIED) == ISMEX_SEND;
            if sent {
                p.sent.set(p.sent.get() + 1);
                // This invokes the real vendored Tao handler, including its post.
                let result = unsafe { DefSubclassProc(hwnd, msg, wp, lp) };
                // Destruction is synchronous and occurs before the outer pump
                // can retrieve Tao's queued replay. No sleeps choose this order.
                if p.destroy {
                    let mut pending = MSG::default();
                    let queued = unsafe {
                        PeekMessageW(
                            &mut pending,
                            Some(hwnd),
                            WM_SYSCHAR,
                            WM_SYSCHAR,
                            PM_NOREMOVE,
                        )
                    }
                    .as_bool();
                    p.queued_before_destroy.set(
                        queued
                            && pending.hwnd == hwnd
                            && pending.wParam == wp
                            && pending.lParam == lp,
                    );
                    p.destroy_ok.set(unsafe { DestroyWindow(hwnd) }.is_ok());
                }
                return result;
            }
            p.replayed.set(p.replayed.get() + 1);
            // Stop at the receiver boundary; opening a visible system menu is
            // covered by the product smoke, not this hidden-window race test.
            return LRESULT(0);
        }
        unsafe { DefSubclassProc(hwnd, msg, wp, lp) }
    }

    fn run(destroy: bool, count: usize) {
        let mut builder = EventLoopBuilder::<()>::new();
        builder.with_any_thread(true);
        let event_loop = builder.build();
        let window = WindowBuilder::new()
            .with_visible(false)
            .with_title("Baton owned race fixture")
            .build(&event_loop)
            .unwrap();
        let hwnd = window.hwnd();
        let guard = ProbeGuard::install(HWND(hwnd as _), destroy);
        let state = guard.state.as_ref().unwrap();
        let worker = thread::spawn(move || {
            for _ in 0..count {
                let mut result = usize::MAX;
                let ok = unsafe {
                    SendMessageTimeoutW(
                        HWND(hwnd as _),
                        WM_SYSCHAR,
                        WPARAM(32),
                        LPARAM(KEY_BITS),
                        SMTO_ABORTIFHUNG,
                        2000,
                        Some(&mut result),
                    )
                };
                assert_ne!(ok.0, 0, "synchronous sender timed out");
                assert_eq!(result, 0, "original message was not consumed");
            }
        });
        let deadline = Instant::now() + Duration::from_secs(6);
        let mut drained = None;
        while Instant::now() < deadline {
            let mut message = MSG::default();
            while unsafe { PeekMessageW(&mut message, None, 0, 0, PM_REMOVE) }.as_bool() {
                unsafe {
                    DispatchMessageW(&message);
                }
            }
            if worker.is_finished() {
                let began = drained.get_or_insert_with(Instant::now);
                if began.elapsed() > Duration::from_millis(100) {
                    break;
                }
            }
            thread::sleep(Duration::from_millis(1));
        }
        assert!(worker.is_finished(), "worker failed to finish within bound");
        worker.join().unwrap();
        assert_eq!(state.sent.get(), count);
        assert!(!state.wrong_args.get());
        assert_eq!(state.menu.get(), 0, "default menu ran synchronously");
        if destroy {
            assert!(
                state.queued_before_destroy.get(),
                "no matching queued replay before destruction"
            );
            assert!(state.destroy_ok.get());
            assert!(!unsafe { IsWindow(Some(HWND(hwnd as _))) }.as_bool());
            assert_eq!(
                state.replayed.get(),
                0,
                "destroyed window received queued replay"
            );
        } else {
            assert_eq!(
                state.replayed.get(),
                count,
                "missing or duplicate queued replay"
            );
        }
        drop(guard);
        assert!(
            !unsafe { IsWindow(Some(HWND(hwnd as _))) }.as_bool(),
            "fixture HWND survived cleanup"
        );
        drop(window);
        drop(event_loop);
    }

    #[test]
    fn repeated_synchronous_keys_replay_once_each() {
        run(false, 8);
    }
    #[test]
    fn destroying_window_before_queued_replay_does_not_dispatch_it() {
        run(true, 1);
    }

    #[test]
    fn callback_fixture_is_destroyed_on_unwind() {
        let mut builder = EventLoopBuilder::<()>::new();
        builder.with_any_thread(true);
        let event_loop = builder.build();
        let window = WindowBuilder::new()
            .with_visible(false)
            .build(&event_loop)
            .unwrap();
        let hwnd = HWND(window.hwnd() as _);
        let result = std::panic::catch_unwind(|| {
            let _guard = ProbeGuard::install(hwnd, false);
            panic!("intentional fixture unwind");
        });
        assert!(result.is_err());
        assert!(!unsafe { IsWindow(Some(hwnd)) }.as_bool());
        drop(window);
        drop(event_loop);
    }
}
