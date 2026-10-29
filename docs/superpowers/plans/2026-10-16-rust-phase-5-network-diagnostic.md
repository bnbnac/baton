# Phase 5 renderer memory: Network domain diagnostic

Status: completed and verified (2026-10-16 KST). Investigation only; original two-hour soak failure and release block remain.

## Hypothesis and controls

Installed Playwright enables CDP Network tracking. The installed Tauri IPC implementation uses fetch for commands and large channel payloads. A/B natural JS heap and backing storage stayed roughly bounded while renderer private memory grew. Test whether Network tracking contributes to retained renderer memory before changing product code.

Use the same hashed product binaries, 32 adapters, 16 SSH sessions, two loopback Docker fixtures, continuous output and minutely audited commands. After UI setup, disconnect Playwright completely. Attach one raw page CDP WebSocket that enables no domains implicitly. Network enable/disable must happen on this same session: disabling a different session would not test the hypothesis.

Run once: 120 seconds warm-up with Network off, then three 180-second stages OFF / ON / OFF. Collect OS memory every 30 seconds, JS/DOM/callback metrics at boundaries, and an equal forced-GC boundary before and after each stage. Record an immediate snapshot after Network.disable, before GC. Count Network events without retaining their payloads. ON must observe requests; stable OFF stages must observe none. Account separately for late events during the disable boundary.

This short diagnostic isolates the Network domain, not all Playwright effects. Forced GC is a diagnostic intervention, not a product fix. Time/order and short warm-up limit conclusions; no acceptance decision or automatic rerun follows.

## Execution and evidence

- Evidence root: `artifacts/phase5-network-20261016/`; diagnostic-only runner derived from the existing comparison runner, with unchanged setup/oracle/cleanup helpers.
- Test the raw CDP client's response correlation, protocol error/timeout/disconnect handling and event counters before using it.
- Verify output rates, audit effects, stable process identities, same binaries/source hashes, normal exit and owner-scoped resource cleanup.
- Record runtime versions and fixture image ID. Remove only this run's container labels and image tag after matching recorded IDs.
- Summarize stage deltas and limitations in `docs/testing/rust-phase-5-memory-investigation.md`. Commit only related documents; preserve the ignored raw evidence. Do not modify or execute unfinished fuzz work.

## Launch record

Raw CDP helper: four tests passed (out-of-order replies/protocol errors, payload-free counters, timeout/late reply, disconnect). Runner and verifier passed Node syntax checks. These are diagnostic-tool checks, not a product test pass.

Launched once at `2026-10-15T16:48:43.323Z` (2026-10-16 01:48 KST), runner PID 41784. Observed `running`, 16 sessions and `warmup_off`; Playwright disconnected at `2026-10-15T16:49:00.140Z`. Run evidence records source/binary hashes and runtime identity. Fixture build reused cached layers but generated a different image ID from the previous A/B; this experiment compares stages within one run only.

## Verified result

Completed at `2026-10-15T17:00:30.853Z` (2026-10-16 02:00 KST). Actual total load was 682.0234115 seconds including diagnostic boundaries. Stage durations were 120.740 / 180.091 / 180.376 / 180.360 seconds. `verify.mjs` returned `valid=true`: source hashes 13, binaries 2, raw JSONL equality, 32 unique connections / 16 sessions / two same-image fixtures, 192 audited effects, all output rates >=1KiB/s and health checks verified.

OFF stages had zero Network events; ON had 3,511 request events during its timed stage. Another 92 requests occurred while ON remained enabled during the ending diagnostics/GC; total at the final OFF baseline was 3,603 and stayed unchanged. There was no ambiguous toggle on a second CDP session.

Post-GC renderer private deltas: first OFF -0.02MiB, ON +5.45MiB, final OFF +4.81MiB. Immediately after disable, before another GC, private changed from 135.76 to 135.29MiB (-0.47MiB). Subsequent post-disable GC reached 128.29MiB; this later decrease cannot be attributed to disable alone. Final OFF post-GC was 133.09MiB.

The short experiment does not show a distinctive large ON-only increase or immediate large disable release. It does not establish Network tracking as the main cause of the previous long-run growth, nor exclude other instrumentation or long natural-GC effects. No product change, acceptance rerun or new diagnostic was started.

Normal exit, no forced cleanup, adapter EOF and WebView descendant audit passed. `final-cleanup.json` rechecked identities/owner label and found zero processes/containers, then removed only the recorded matching image tag. Detailed metrics and limitations are in the investigation report. Pause `baton-2` after reporting completion.
