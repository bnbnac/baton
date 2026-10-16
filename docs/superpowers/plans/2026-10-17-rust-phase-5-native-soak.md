# Phase 5 native UI soak preparation

Status: runner prepared; first live smoke failed on native resize deadline after 55.014 seconds. Two-hour acceptance not started.

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
