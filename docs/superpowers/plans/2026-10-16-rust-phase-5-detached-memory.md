# Phase 5: long natural-GC run without attached browser automation

Status: running. Product unchanged; original soak failure and release block remain.

## Question and limits

Does renderer private memory continue to grow for an hour after Playwright disconnects, without raw CDP sessions, JS probes, UI transitions or forced GC? Previous Network-only toggling did not isolate a dominant cause. This run tests the shared automation/instrumentation condition more broadly.

Use existing hashed app/adapter binaries, 32 adapters, 16 SSH sessions, two loopback fixture servers, continuous output and minutely duplicate-ID audit commands. Playwright is used only to prepare the sessions. Disconnect and release all browser/page references before the timed load; do not reconnect. The remote debugging listener remains enabled because setup needs it, so this is not evidence about launching with debugging completely disabled. Prior setup can also have residual effects.

Run once for 3,600 seconds. Treat 0–20 minutes as warm-up and compare OS memory medians for 20–40 and 40–60 minutes. Sample process roles, PID/start identities and debug-port established TCP connections every 30 seconds. Require zero established debugger connections in every timed sample. Do not sample JS/DOM or request GC. Separate the endpoint sample from the 120 natural samples. Record sample timing/gaps and audit health; do not infer success from a process merely running.

The current fixture image may differ from earlier A/B. Historical results are context, not a matched causal comparison. A flat or rising result narrows hypotheses but neither clears the two-hour gate nor proves a leak or its absence. No automatic second run.

## Execution

- Evidence: `artifacts/phase5-detached-memory-20261016/`, runner derived from the existing comparison runner; no product or unfinished fuzz edits/builds.
- Remove all runtime JS/GC/CDP diagnostic paths, not just the schedule. Verify source contains only the setup browser attachment.
- Check the analyzer against valid and intentionally invalid fixtures (missing samples/attachment/short run/identity change/cleanup failure).
- Launch once, record PID/start/commit/source and binary hashes. Existing `baton-2` watches quietly and completes verification/documentation/owner-scoped cleanup.
- Verify output rates >=1KiB/s/session, 60 audit rounds/960 effects, health, normal exit, adapter EOF and process/container cleanup. Preserve all raw evidence.
- Update investigation report and this plan, commit only related documents. Remove the run image tag only after matching the recorded image ID.

## Start record — 2026-10-16 KST

Analyzer tests: 10 passed, including invalid duration, missing sample, active debugger, renderer identity change, GC intervention, cleanup failure, audit omission and sampling gaps. Runner/verifier syntax checks passed. The OS TCP helper was executed read-only before launch.

Launched once at `2026-10-15T21:34:42.528Z` (06:34 KST), PID 34088, HEAD `8562728`. Playwright disconnected at `2026-10-15T21:34:59.425Z`. Confirmed running with 32 connections and 16 sessions; first OS debug-port sample showed zero established connections and one listener. Expected measurement completion is around 07:35 KST, followed by verification/cleanup.

Source/binary hashes and runtime/image identity are recorded in run1/summary.json. Setup uses the same unchanged app/adapter binary hashes as earlier diagnostics. Existing `baton-2` now watches this run without attaching browser automation and pauses after completion/failure reporting. No completion claim yet.
