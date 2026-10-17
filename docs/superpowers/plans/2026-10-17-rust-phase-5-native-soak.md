# Phase 5 native UI soak preparation

Status: two live smokes failed. Focused follow-up reproduced maximized accessibility-click mis-targeting; observed main-screenshot coordinate input succeeded. Native operating procedure updated; timed smoke and two-hour acceptance remain unproven.

The user approved preparing the next test after the focused UI fix and short native handoff check. Reuse the existing verified app/adapter binaries and fixture recipe. Do not change product behavior or unfinished fuzz files. Preserve the original two-hour memory failure and Phase 5 release block.

## Execution contract

- Prepare a fresh-evidence launcher, detached measurement runner, native UI mailbox/consumer CLI, independent result verifier and operating procedure.
- Setup may use Playwright. Disconnect before timed output/audit/health/UI workload. No CDP, JS probes or forced GC during natural memory sampling.
- 32 connections, 16 sessions, two loopback fixture servers. One round/minute: audit all sessions, select a rotating target, resize, reclaim, hand off to the alternate connection.
- Native UI actions require an active Codex computer-use consumer. The Node runner alone is not an unattended UI driver. Verify practical throughput with a 180-second smoke before considering 7,200 seconds.
- Separate select acknowledgement from resize measurement; hidden-session geometry cannot supply the resize baseline. Mark selection as operator observation; verify resize via MCP plus server stty, ownership changes via epoch/stream/owner.
- Preserve five 20-minute memory windows after warm-up. Last/first private and working medians must each be <=1.20. Memory threshold failure still runs overload control and normal shutdown; invalid workload records skipped overload.
- Reconnect Playwright only after freezing normal-phase evidence. Require normal app exit, 32 adapter EOFs, descendant audit and zero owned resource leftovers.
- No automatic rerun. No automatic smoke-to-release launch. Release launch requires a verified same-source/binary/image/environment smoke.

## Preparation completed — 2026-10-17

New runner/control/launcher/UI/verifier files and TCP sampler are documented in `docs/testing/rust-phase-5-native-soak.md`. Regression checks cover mailbox binding/deadlines, pre-selection resize baselines, false evidence acceptance and phase sequencing. Seven Phase 5 unit test files passed 83 tests; native subset is 25. Syntax and binary hashes passed; prepared fixture image identity matched and zero containers used it. Independent review could not finish because the review agent hit its usage limit; self-review is recorded, not substituted as independent approval.

Evidence/config: `artifacts/phase5-native-soak-preparation-20261016/`. Image tag `baton-native-soak-20261016` is deliberately retained for smoke. Both smoke and release directories are absent. No test run/heartbeat has been started by this preparation.

## Remaining

1. Perform one live 180-second smoke with active native UI handling; verify cadence, all four stages, overload and shutdown. Record failure without rerunning if the deadlines cannot be met.
2. If valid and normally cleaned, review readiness for the single two-hour run using unchanged inputs. Keep active UI handling available for its full duration.
3. Verify raw evidence, record the memory windows and limitations, remove only matching owned resources/image tag when no longer needed. A soak pass covers this gate, not all Phase 5 requirements.

## First smoke — 2026-10-17

Executed once on user instruction at `2026-10-16T21:02:06.142Z`, commit `20bc104`, PID 40600, evidence `artifacts/phase5-native-soak-preparation-20261016/smoke`. Prepared 32/16/2. Native select succeeded, but observing the initially scrolled list, selecting/verifying the session, and publishing the receipt took 43.956 seconds from request to verification. Initial receipt publication hit sandbox EPERM on the hard link; the same receipt was then recorded outside the sandbox without repeating the UI action. Resize had only 5.175 seconds left and expired; a fresh window observation returned `foreground window did not report a process id` around shutdown. No resize input was issued.

Actual timed load 55.0138236 seconds, complete rounds 0; normal workload failed with `native_action_timeout`, overload skipped as invalid workload, shutdown passed with 32 EOFs and verified descendant exit. Forced cleanup false, owned processes/containers 0 on independent recheck, source 18/binary 2 hashes unchanged, two raw OS samples match summary and show zero established debugger connections. Audit was issued but not server-verified; the verifier exits nonzero because audit-observations.json is absent. No successful verified.json exists.

The first remaining step above was attempted and failed; do not execute it again automatically. Review native-consumer latency, initial UI positioning and receipt permission readiness before proposing a new run. Preserve this failure, keep the two-hour gate blocked and retain the matching fixture image for that review. No product/runner/fuzz edits or automatic rerun in this execution turn.

## Bounded preparation correction — 2026-10-17

After the user's agreement to reduce UI/receipt overhead, select the first tab during the existing Playwright setup and add a native `ready` acknowledgement after disconnect and before starting the measured clock. It uses the same mailbox publication path and requires the observed session ID. Keep output pumping and stop checks alive while waiting; preparation timeout is 120 seconds and enters the existing failed-normal/shutdown path. Timed round/request limits remain 55/45 seconds.

The receipt CLI now returns the next distinct, same-owner, unexpired request after at most five seconds. It never repeats UI input or acknowledges the next action automatically. A null next request means poll later, not repeat the completed action. Use the approved escalated file-write path consistently, including preparation; no sandbox/security setting changes.

Verifier requires readiness after browser disconnect and before load start, with matching request/session/owner and deadline. Unit tests cover readiness gating and next-request delivery using the real filesystem mailbox. This removes avoidable preparation and polling overhead; it does not establish actual native throughput. A future smoke must use fresh evidence (`smoke2`, `config-smoke2.json`). The failed original evidence remains immutable. No new live run has been started.

Validation: all seven Phase 5 unit-test files pass 90 tests (32 native, 58 existing); native runner/CLI syntax checks pass. Live preparation/throughput validation remains pending.

Independent read-only review of the bounded diff against `a8d7991` found no blockers; reviewer did not execute tests or a live workload.

## Second smoke — 2026-10-17

Executed once with user authorization at `2026-10-16T21:38:33.377Z`, commit `ccd716f`, PID 37948, owner `225be3a2-de11-4208-8472-6b042dfc60c5`, fresh evidence `artifacts/phase5-native-soak-preparation-20261016/smoke2`. Prepared 32 connections/16 sessions/two servers. Browser disconnected at 21:38:49.024Z; native ready verified at 21:39:03.995Z; measured load started at 21:39:03.996Z. Receipt publication succeeded before starting the clock.

Selection took 7.334 seconds from request to verification (operator-observed full session ID). Resize took 22.744 seconds, changing MCP geometry from 102x17 to 274x52 with matching remote stty `52 274`. These durations include observer/tool round trips, not just product latency. Reclaim was issued with approximately 20.664 seconds left. One accessibility-element click returned, but subsequent UI observations remained agent-owned. No success receipt was submitted. A possible post-maximize click-coordinate mismatch remains unproven; do not classify this as a confirmed product defect.

Normal workload failed with `native_action_timeout` after 55.0519023 seconds; zero completed rounds, no handoff, overload skipped. Audit was issued once but not server-verified. Verifier exits 1 for absent audit-observations.json and produces no verified.json. Shutdown passed: exit code 0, 32 adapter EOFs, verified descendant exit, no forced cleanup. Independent process identity and actual baton.soak owner label plus fixture name/ID checks found no leftovers. Source 18/binary 2 hashes unchanged; both raw memory samples equal summary, debugger established 0. Matching image tag retained for review.

Do not rerun automatically or launch the two-hour acceptance. Next investigate native click targeting/observation refresh after maximizing in a focused check, before another timed smoke. No product, runner or unfinished fuzz edits in this execution. Original memory failure and Phase 5 release block remain.

## Focused native click comparison — 2026-10-18

On user authorization, launched one isolated diagnostic copy of the earlier probe at `2026-10-17T22:35:52.805Z`, PID 14200, owner `f5ce7290-68c6-4c35-bd98-650e2852eb3e`. Evidence: `artifacts/phase5-ui-stability-20261016/click-run1/`. Same app/adapter/image, 32 connections, 16 sessions, two servers; Playwright disconnected before native actions. Actual diagnostic duration 275.8099746 seconds, no per-minute cadence assertion.

After stable maximization and fresh observation, accessibility-element reclaim left epoch 1 agent-owned and the visible cursor outside the button. Explicit main-screenshot coordinate input reclaimed to epoch 2 user-owned and a subsequent handoff reached epoch 3 with a new stream and previous owner unassigned. Accessibility-element restore also missed the native title-bar button; main-screenshot coordinates restored it. In the restored window, accessibility-element reclaim succeeded (epoch 4), followed by coordinate handoff (epoch 5/new stream), MCP 102x17 and remote stty `17 102` agreement.

The returned screenshot array contained a 15x15 region before the actual 2560x1392 maximized window. An initial diagnostic coordinate attempt selected that first region and failed bounds validation; this operator mistake is separate from the earlier smoke2 failure. Procedure now requires inspecting returned regions, selecting the actual main capture, observing completed window transitions and deriving coordinates afresh. Immediate accessibility text can lag the screenshot; independent MCP checks remain mandatory.

This isolates a maximized accessibility-targeting problem in this environment, not a demonstrated ownership-handler defect. Provider/tool internals and other DPI/layouts remain undetermined. No product fix is justified by these results. Normal exit code 0, 32 adapter EOFs and verified descendant exit; no forced cleanup or owned leftovers. Independent assertions passed for raw MCP epoch/stream sequence, source 15/binary 2 hashes and 10 raw OS samples matching summary (debugger established 0). Image retained with matching ID. See click-verification.json and post-run-cleanup.json.

Completed this focused check and amended operating documentation only. No new smoke/release run, no product/unfinished fuzz changes. Next step, subject to a new execution decision, is one fresh 180-second smoke using the corrected native observation procedure; it still must fit unchanged 55/45-second limits. Original memory failure and Phase 5 release block remain.
