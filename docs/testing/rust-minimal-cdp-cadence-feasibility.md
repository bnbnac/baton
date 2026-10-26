# Minimal CDP cadence feasibility

Status: implementation unit suite **180/180 passed**, but the first authorized live run on 2026-10-27 KST **failed during preparation, before measurement or any cadence round**. No automatic retry was made. This is a three-round diagnostic, not a long-run memory acceptance test.

## First live result — preparation failure

Evidence: `artifacts/phase5-minimal-cdp-cadence-20261026/run1/`, launch/log siblings, `verify-run1.log`, `post-run-analysis.json` and `post-run-resources.json`. The planned directory date was retained; actual start was 2026-10-26 22:17:44.564 UTC (2026-10-27 07:17:44.564 KST), finish 22:18:15.861 UTC, wall duration 31.297 seconds. Runner PID 19752, commit `f0be5b9c3c5b22fb723afae0a8cc46beebf20674`, owner `3eec5f12-5ef8-4f41-860f-935c2619ecab`.

- Setup established 32 connections / 16 sessions / 2 fixture servers and matched the M/F baseline identities. Playwright disconnected and the raw CDP connection successfully returned from `Network.disable`.
- The first `Runtime.evaluate` was the preparation-only `identity` query. It failed with `cdp_response_error`. No DOM action, measurement-start event, OS measurement sample or cadence round followed. Completed rounds: **0**.
- A concrete harness inconsistency was found: shared `Runtime.setup()` ends by selecting `soak-00`, but `prepareCdp()` expects `r.sessions.at(-1).id` (session 15). Using the run's saved IDs and the unchanged DOM expression, an offline selected-session-0 fixture throws `dom_session` for the recorded session-15 expectation and succeeds for session 0. This reproduces the code defect, not the lost live browser exception: the CDP client recorded only a generic error and did not retain the protocol/JavaScript error details. Therefore the exact live exception remains unconfirmed.
- The failure sweep returned all 32 status responses; their recorded session owner/epoch/stream bindings match the acknowledged initial bindings. All 16 audit files are empty. Normal app exit, 32 adapter EOFs, no forced cleanup and zero owned process/container remnants were recorded. A separate PID/start-time and owner-label check after exit also found no remnants. The preserved image ID still matches.
- Current source hashes **37/37**, candidate binaries **2/2**, M/F baseline receipts and environment identities match. Read-only analysis is saved separately from the original verifier result; it does not convert this run into a cadence pass.

The directory verifier ran **once** and returned `evidenceValid:false`: `normal-boundary.json` does not exist because measurement never started. This is a preparation failure with no cadence measurement, not valid completed-round or deadline-negative evidence. `cadenceObserved:false`, `longRunReadiness:unproven`, `memoryAcceptance:not_evaluated`, and `phase5Acceptance:false` remain. Summary SHA256: `35f3debebb4a3af848a028aa8216fbb7f61c30614d551376ede804e956882650`.

Next corrective work: align the preparation identity expectation with shared setup, add an integration regression covering that boundary, and retain bounded CDP error details. Do not alter this run, repeat its verifier or launch another run automatically. Product and diagnostic sources were not modified during or after this live attempt; only analysis artifacts and result documents were added.

## Inputs and execution scope

Use the existing `rust-phase-0` worktree and copy `artifacts/phase5-sampler-diagnostic-20261025/config.json` into a new `artifacts/phase5-minimal-cdp-cadence-20261026/config.json` immediately before the authorized run. Do not rebuild candidates or change the preserved image.

- App SHA256: `2e2911c3eb830fc8f207ce3c41852015417c75f1c34ed23f7f8dcab006772316`
- Adapter SHA256: `09823dd5d51cd3b33f286540fe43a03570b3eee81497607a1b5b67336fcb754c`
- Image: `sha256:7270e924b7597cbece5eb6886a47c3383502f31d8a253763774f3b8c6b4f810a`

The runtime compares the exact 23 common source keys, binaries, image and Windows/Node/WebView/Playwright versions with the saved M/F preflight receipts. Extra diagnostic sources (including the reused native-cadence modules and new PowerShell sampler) are hashed separately. A mismatch rejects the run; do not rewrite receipts to match new inputs.

Historical command for the consumed first attempt (do not execute it again):

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

Unexpected socket closure/error is retained separately from intentional close, including when no request is pending. The measurement guard checks the connection before allowing another operation or completing a round. Each request records its actual dispatch budget after the request evidence write; the execution timeout is capped at the remaining transport deadline. A timely transport response and a later host-side action abort are distinct records. Host completion must meet the round deadline, while the response must meet the request deadline.

After failure and measurement freeze/CDP close/audit capture, a read-only status sweep records each of the 32 connections' sessions, epochs and streams independently of the last acknowledged binding. It has a 15-second admission budget and reserves the existing 5-second RPC timeout before starting each query. Queries that fail or cannot start within that budget are explicit unknown observations. Recording/scheduling may extend wall time; this is not hard cancellation. No inputs or binding adoption occur in this sweep. The verifier joins each returned observation with the raw MCP status and reports completeness separately; an incomplete sweep cannot establish the final owner for every session.

After `finishedUtc` exists, verify once:

```powershell
node rust/tests/phase5/minimal-cdp-cadence/verify.mjs artifacts/phase5-minimal-cdp-cadence-20261026/run1
```

The verifier exclusively creates `cdp-cadence-verification.claim` and `cdp-cadence-verification.json`. Do not delete a claim or overwrite/repeat verification after a crash. Raw `cdp.jsonl` must agree with CDP events in `events.jsonl`; those records are joined with raw MCP, output, audit files, geometry, OS samples and shutdown evidence. All 32 adapter EOFs, normal exit and zero owned remnants are required for cadence success. Partial delivered audit commands are checked against actual server effects even without a completed round.

If fallback cleanup is needed, first match this run's owner label + exact container name/ID or process PID + start time. Never remove the preserved image. Preserve the failed evidence; never automatically relaunch.

Report `evidenceValid` separately from `cadenceObserved`. A fully recorded deadline failure may be valid negative evidence; incomplete evidence is invalid. Three completed rounds still leave `longRunReadiness:unproven`, `memoryAcceptance:not_evaluated`, `phase5Acceptance:false`. M/F/N and the prior native deadline result are preserved. Before a longer memory experiment, separately design a matched static-CDP control; detached M is not a same-instrumentation control and its memory cannot be subtracted to manufacture a pass.

## Final review and implementation decisions

One independent review of `758d124..eaad136` found three Important issues: an idle disconnect could disappear behind cleanup, a transport success followed by host failure could look like missing evidence, and uncertain UI execution lacked a final ownership observation. Each was reproduced with a failing regression test and fixed in one pass, along with the related fixed-timeout-margin issue. The complete new/shared suite then passed 180/180. No second review or repeated live run was performed. Review ledger and test output are preserved under `artifacts/phase5-minimal-cdp-cadence-implementation-20261027/`.

- PowerShell bookkeeping replaced a bundled Git Bash helper that exited without output; the cost is manual bookkeeping.
- Private historical evidence helpers were copied into this verifier to preserve old source hashes; the cost is duplicate maintenance.
- Tabs expose a label/state but no full ID. Selection uses unique markup, then verifies the full ID synchronously before control changes. An incorrect tab can be selected before rejection, but reclaim/handoff is blocked.
- Actual WebView/CDP, Windows socket sampling, Docker/SSH and 60-second performance remain unverified until the separately authorized live run; unit tests cannot establish those results.
- Native keyboard/mouse and OS window resizing are outside the DOM diagnostic; this result cannot establish native-input behavior.
- Two-hour memory behavior and Phase 5 acceptance remain unverified/blocked; a short cadence result cannot remove that block.
- Product, Cargo, fuzz and historical verification implementation were outside this change; inherited defects there are not excluded by this review.
