// Compile the actual vendored decision code without Tao's unrelated dev dependencies.
#[cfg(all(test, windows))]
#[path = "../../vendor/tao-0.35.3/src/platform_impl/windows/event_loop/alt_space.rs"]
mod alt_space;
