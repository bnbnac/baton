# Tao 0.35.3 local patch

The workspace pins Tao through `[patch.crates-io]` to `tao-0.35.3/`.
This is the published Apache-2.0 crate, including its license files.
`tao-0.35.3.upstream.json` records the crates.io archive checksum (verified
against the original Cargo.lock) and original file SHA-256 values.
The local `.gitattributes` disables line-ending conversion to preserve those bytes.

Only `src/platform_impl/windows/event_loop.rs` is changed; its adjacent
`event_loop/alt_space.rs` is added. The latter includes regression tests.
There are no diagnostic logs or artifact-directory dependencies.

## Why

On the tested Windows/WebView2 stack, handling a synchronously sent Alt+Space
WM_SYSCHAR inside DefWindowProc's system-menu loop stalls frontend IPC long
enough to trigger Baton's existing frontend watchdog. Re-posting the message
to the same HWND lets the sending call return before the menu loop starts.
The queued message carries the original arguments, has no blocking sender,
and follows default processing without recursively re-posting itself.

The patch runs after Tao's callback, only for default WM_SYSCHAR processing.
It requires Space, the Alt context bit, ISMEX_SEND, and no ISMEX_REPLIED.
Only a successful PostMessage consumes the original; failure retains default
processing. It does not disable the watchdog or alter other platforms.
This changes message timing; repeated keys, focus changes and close/menu
commands require Windows integration coverage, beyond the predicate tests.

The replay also traverses Tao's earlier keyboard/IME callbacks again. In
particular, Tao can emit `ReceivedImeText(" ")` on both passes. Baton's pinned
tauri-runtime-wry 2.11.4 ignores these raw Tao text/keyboard events; this is a
product-scoped workaround, not a generally compatible upstream Tao fix.
Re-evaluate this before upgrading that runtime or adding raw Tao event consumers.

## Check and maintain

From the repository root on Windows:

```powershell
cargo test --manifest-path rust/tests/tao-alt-space/Cargo.toml --locked
cargo tree --manifest-path rust/Cargo.toml -p baton-app --features desktop -i tao --locked
```

The dependency tree must resolve Tao to this repository path. Build and run
the product's native system-menu regressions as well; predicate tests alone
cannot prove frontend liveness or window shutdown behavior.

For an upgrade, compare the new upstream event-loop handling, rebase these
two files, retain upstream licenses, regenerate the original-file manifest
from the verified new published archive, and update the lockfile. Do not
silently absorb unrelated source edits. Remove the override and vendor only
after an upstream release passes the same native cases without this patch.
