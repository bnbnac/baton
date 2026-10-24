# Windows system-menu product patch

## Scope

Approved on 2026-10-24: vendor Tao 0.35.3, retain the diagnostic-proven
synchronous Alt+Space interception point, remove diagnostic logging, validate
the product binary, then return to formal N acceptance. This does not waive
the previous two-hour soak failure or the Phase 5 release block.

The workspace override uses `rust/vendor/tao-0.35.3`, not an artifact or registry
edit. One upstream file changes and one helper/test file is added. Archive
SHA-256: `d1c93047acf68669466a34690ac58cca7010bd1b201e1ec86f1fd0a75d3dd4a9`.
The original 119 file hashes and Apache-2.0 license are retained. See the vendor
README for upgrade/removal instructions and the raw Tao event compatibility
limitation. Static review found no demonstrated blocker for the pinned Baton
runtime; this is not a generally compatible upstream Tao fix.

## Build and automated checks

Evidence: `artifacts/phase5-product-patch-20261024`.
The build snapshot contains tracked HEAD `7f3dfce` plus the approved vendor
patch. Preexisting unfinished fuzz source and manifest additions were excluded.

- Predicate RED: after correcting an initial harness path error, 2 failures
  and 2 passes with a stub implementation; GREEN: all 4 pass using the actual
  vendored helper. Cases cover blocking Alt+Space, failed posting, queued/replied
  messages, unrelated keys/messages.
- Baseline sandbox run failed
  `late_retirement_of_old_client_preserves_replacement_connection` with
  `AppOffline`; the unchanged baseline passed outside the sandbox.
- Product workspace: 185 tests pass outside the sandbox. Existing incremental
  cache hard-link warnings remain; there is no claim of a warning-free run.
- Frontend: 15 tests pass; TypeScript/Vite production build passes.
- Offline/locked release build passes; dependency tree resolves Tao to the
  vendored path. Product SHA-256:
  `2e2911c3eb830fc8f207ce3c41852015417c75f1c34ed23f7f8dcab006772316`.

## Native product check

`system-menu-smoke.mjs` runs the uninstrumented product and one adapter with
isolated local state, no SSH session and no CDP. A native driver records observed
actions in `actions.jsonl`, marks `closing.json` before Close, and creates
`done.json` after the final action. The runner checks continuous online state
and unchanged app/connection identity before closing, then app exit, adapter
EOF and descendant audit. A timeout or missing driver completion fails the run.

`native1` was interrupted by the usage limit. It recorded online state up to
its deadline but failed `native driver did not finish`; its process receipt is
not a normal-exit proof. A subsequent PID/start-time check found no owned
root/WebView processes. It is excluded from native acceptance.

The explicit resume used the same binary in `native2` (03:57:31–03:59:59 UTC).
The uninstrumented product passed these bounded checks:

- Alt+Space menu remained visible across observations 46.223 seconds apart;
  two Escapes dismissed it, and reopening worked.
- System-menu Maximize and Restore commands changed the window as expected.
- Titlebar right-click opened its menu; one Escape dismissed it.
- Clicking the WebView name input showed a caret; Alt+Space still opened the
  native menu after that focus transition.
- The menu's Close command produced app exit 0, adapter EOF exit 0,
  `normalExit:true`, `forcedCleanup:false`, and descendant audit `verified`.
- All 143 status samples from first online until the close marker remained
  online with unchanged app/connection IDs. A PID/start-time check found zero
  owned root/WebView processes afterward. WebView receipt version:
  155.0.4283.62.

`verify-native.mjs native2` checked raw events, source/vendor/binary/harness
hashes, observation order, exit records and cleanup; its result is
`native-verified.json`. The close observation originally claimed immediate
window disappearance too early: the immediate window list still contained it,
while the next list was empty. `observation-correction.json` preserves that
correction; normal exit is established by the supervisor receipt, not that
initial observation. Maximum/restore animation frames were followed by stable
screen observations.

## Remaining limits

UI observations do not measure WM_ENTERMENULOOP/WM_EXITMENULOOP boundaries or
accepted frontend pong counts. The prior instrumented experiment supplies
those separate observations. A deterministic window-destruction-before-replay
race is not established by manual UI closing. SSH traffic and the independent
N cases still require formal validation. F/M and the Phase 5 release block
remain unchanged.
