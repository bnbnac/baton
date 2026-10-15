# Phase 5 renderer memory: Network domain diagnostic

Status: running (2026-10-16 KST). Investigation only; original two-hour soak failure and release block remain.

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

Completion verification is pending. Existing `baton-2` heartbeat now checks this run, reports only completion/failure/actionable changes, and pauses after documenting the result. Do not start another run automatically.
