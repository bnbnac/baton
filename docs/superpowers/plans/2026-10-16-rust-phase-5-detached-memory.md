# Phase 5: long natural-GC run without attached browser automation

Status: completed and verified. Product unchanged; original soak failure and release block remain.

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

Source/binary hashes and runtime/image identity are recorded in run1/summary.json. Setup uses the same unchanged app/adapter binary hashes as earlier diagnostics. The start record above is historical; completion is recorded below.

## Completion — 2026-10-16 07:35 KST

Actual load 3,600.4452386 seconds; finished `2026-10-15T22:35:09.618Z`. `verify.mjs` returned valid=true, acceptancePassed=false. Raw JSONL and summary matched; all 13 source and two binary hashes matched. The 120 natural samples had maximum gap 30.6675 seconds and zero established debugger connections each. Both stable windows had 40 samples; independent PowerShell calculations confirmed renderer/total private medians. Endpoint at 3,604.9025 seconds was separate.

32 connections, 16 sessions, two same-image fixtures, 60 audit rounds/960 effects, health and output rates 1,178.89–1,180.32 B/s/session passed. No timed JS probes, forced GC or raw CDP session; the setup listener remained enabled.

20–40 / 40–60 minute medians: total private 747.87 / 746.63MiB (-0.17%); total working 1,128.91 / 1,127.52MiB (-0.12%); renderer private 315.49 / 311.69MiB (-1.21%); renderer working 367.04 / 360.23MiB (-1.85%); app private 145.64 / 146.16MiB (+0.36%). Growth was not reproduced across these stable windows. Instrumentation effects become a stronger candidate relative to historical attached runs, but this does not establish causality, a specific CDP domain, or a two-hour acceptance pass. There was no matched same-image contemporaneous control.

Normal exit/adapter EOF/descendant audit passed without forced cleanup. Final identity/owner-label recheck found zero processes/containers; the matching `baton-detached-memory-20261016` tag was removed. Evidence: run1/verified.json and final-cleanup.json. Report results and pause heartbeat. No new run, product/fuzz edits or release-block removal.
