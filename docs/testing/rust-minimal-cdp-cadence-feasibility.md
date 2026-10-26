# Minimal CDP cadence feasibility

Status: implementation and unit verification in progress. **No live run has been started.** This is a three-round diagnostic, not a long-run memory acceptance test.

## Inputs and execution scope

Use the existing `rust-phase-0` worktree and copy `artifacts/phase5-sampler-diagnostic-20261025/config.json` into a new `artifacts/phase5-minimal-cdp-cadence-20261026/config.json` immediately before the authorized run. Do not rebuild candidates or change the preserved image.

- App SHA256: `2e2911c3eb830fc8f207ce3c41852015417c75f1c34ed23f7f8dcab006772316`
- Adapter SHA256: `09823dd5d51cd3b33f286540fe43a03570b3eee81497607a1b5b67336fcb754c`
- Image: `sha256:7270e924b7597cbece5eb6886a47c3383502f31d8a253763774f3b8c6b4f810a`

The runtime compares the exact 23 common source keys, binaries, image and Windows/Node/WebView/Playwright versions with the saved M/F preflight receipts. Extra diagnostic sources (including the reused native-cadence modules and new PowerShell sampler) are hashed separately. A mismatch rejects the run; do not rewrite receipts to match new inputs.

Only after implementation checks/review and live-run authorization:

```powershell
node rust/tests/phase5/minimal-cdp-cadence/launch.mjs artifacts/phase5-minimal-cdp-cadence-20261026/run1 artifacts/phase5-minimal-cdp-cadence-20261026/config.json
```

Existing output, sibling launch receipt or log rejects launch. Do not select another name to retry automatically. The child runner is hidden; the actual test app may show its window. No per-round human or model input is needed.

## What it measures

32 MCP connections, 16 SSH sessions and 2 fixture servers carry the existing output/audit/health load. Sessions 0→1→0 are visited, each time transferring to the current owner's opposite adapter. Each round includes selection, geometry stabilization, resize, reclaim, connection selection, handoff, independent MCP/server verification, audit16 and health32. It has a 60-second deadline; later starts are at least 60 seconds apart. Preparation has the same overall 900-second limit. First failure stops remaining rounds without retry.

Playwright disconnects after setup. One raw CDP page connection remains throughout the short measurement, explicitly disables Network tracking and runs only fixed synchronous DOM expressions. Session tabs are matched by their strong label and small state elements; the full selected session ID is checked after selection, before any control-changing action. Session tab markup itself exposes no full ID. Buttons dispatch the real DOM handlers, and select changes use the visible control; no backend/Tauri invoke or ownership model is called directly. The terminal workspace width changes between 720/1000px: this is not an OS maximize/restore or native input test.

DOM/ID queries are JS execution. `evaluateCalls`, `domQueries` and `domActions` count requests separately. `jsProbes` means heap/memory diagnostic probes here and remains zero, as do `heapDiagnosticCalls` and `forcedGcCalls`. Do not report “JS execution zero.” CDP/DOM request success alone cannot establish a successful transition.

OS samples are labeled `minimal_cdp_attached`, targeting 30-second spacing with a 45-second maximum gap. The sampler verifies process identities/sums and records owned listener and established endpoints, including PID/start ticks. An open client and one server-side established connection are required. These discrete observations cannot prove that no transient external debugger connection ever occurred. Network event absence alone is not proof of no instrumentation effect.

## Stop, evidence and cleanup

Create the file `run1/stop` to request stop; do not interact with the app or attach another debugger. An in-flight action may already have executed when a timeout occurs. The runner blocks new actions, preserves uncertain/partial effects, freezes measurement, closes CDP, captures fixture audit files and attempts normal shutdown and cleanup. Timeout does not mean cancellation or rollback.

After `finishedUtc` exists, verify once:

```powershell
node rust/tests/phase5/minimal-cdp-cadence/verify.mjs artifacts/phase5-minimal-cdp-cadence-20261026/run1
```

The verifier exclusively creates `cdp-cadence-verification.claim` and `cdp-cadence-verification.json`. Do not delete a claim or overwrite/repeat verification after a crash. Raw `cdp.jsonl` must agree with CDP events in `events.jsonl`; those records are joined with raw MCP, output, audit files, geometry, OS samples and shutdown evidence. All 32 adapter EOFs, normal exit and zero owned remnants are required for cadence success. Partial delivered audit commands are checked against actual server effects even without a completed round.

If fallback cleanup is needed, first match this run's owner label + exact container name/ID or process PID + start time. Never remove the preserved image. Preserve the failed evidence; never automatically relaunch.

Report `evidenceValid` separately from `cadenceObserved`. A fully recorded deadline failure may be valid negative evidence; incomplete evidence is invalid. Three completed rounds still leave `longRunReadiness:unproven`, `memoryAcceptance:not_evaluated`, `phase5Acceptance:false`. M/F/N and the prior native deadline result are preserved. Before a longer memory experiment, separately design a matched static-CDP control; detached M is not a same-instrumentation control and its memory cannot be subtracted to manufacture a pass.
