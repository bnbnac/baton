# Phase 5 native UI soak preparation

Status: runner preparation complete; live smoke and two-hour acceptance not started.

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
