# Attached Memory Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and independently verify a fresh sequential two-hour static A / two-hour transitioning B memory comparison under comparable raw-CDP instrumentation.

**Architecture:** Reuse the frozen separated runtime/lifecycle and minimal-CDP transport, DOM and process-sampling helpers read-only. Put the new two-phase deadline guard, minute-slot scenario, attached memory verdict and pair launcher/verifier in `rust/tests/phase5/attached-memory/`. Historical short and detached runners/verifiers remain unchanged; their hard-coded duration/count assumptions are not reused as the new contract.

**Tech Stack:** Node.js ESM, node:test, built-in WebSocket, existing Windows PowerShell process sampling, local Docker SSH fixtures; no new dependencies.

**Spec:** [Approved design](../specs/2026-10-27-rust-attached-memory-comparison-design.md), approved 2026-10-27. This plan has not been implemented or executed.

## Global Constraints

- Worktree `C:/Users/sj/Documents/work/code/baton/.worktrees/rust-phase-0`; implementation base `7758902` plus this planning commit. Direct implementation in this session is preserved; local commits only.
- A then B, fresh processes/profiles/containers; 32 MCP connections, 16 SSH sessions, two fixture servers per arm. No simultaneous arms or automatic retries.
- Full: preparation 900 seconds, measurement 7200 seconds, 120 slots of 60000ms. One round per slot, completion within its slot; no catch-up. Freeze overshoot <=15 seconds, never used to extend a round deadline.
- B session `k % 16`; paired owner `(currentAdapter+16)%32`; stable geometry >=750ms; width 720px when columns>=90, otherwise 1000px. Both start with session0 and workspace width1000px.
- Six measurement evaluations per round: A six read-only identity queries; B select/identity/resize/reclaim/choose_connection/handoff. Full totals720 evaluations,120 audit cycles/1920 effects,120 health cycles per arm.
- One owned raw CDP connection throughout measurement; Network.disable, forced GC0, heap diagnostics0. Identity queries are JS execution, never reported as zero JS.
- OS target30 seconds from measurement start; first/adjacent/final gap<=45 seconds; >=30 samples per evaluated20-minute window. Honest `minimal_cdp_attached` phase/established1; exact240 samples is not a gate.
- Warmup1200 seconds; five1200-second window medians; total private and working last/first<=1.2 independently per arm. Extra ratios and role trends are descriptive. No A subtraction and no release acceptance.
- Preserve product/Cargo/fuzz, old test sources and evidence. Retain exact23 common source keys, two candidate hashes, image and environment from the spec; hash all additional execution/verifier sources. No rebuild or preserved-image deletion.
- A with valid complete workload/normal cleanup may permit B even when memoryPassed=false. Other A failures block B. Each verifier exclusively claims/writes once; frozen results cannot be overwritten.
- Preflight is a new A/B pair with180 seconds/3 slots per arm (six measured minutes plus setup/cleanup). It exercises the new scheduler, A query matching and B path; memoryPassed=null and phase5Acceptance=false. It does not substitute for full evidence.

## Review Focus

1. Setup lasting near900 seconds must not consume the measurement budget; the old scope-dependent desktop watchdog must not kill a valid run (Tasks1/2).
2. Six identical A identity requests must not collapse into one match; missing, duplicated or reordered responses must fail independent verification (Tasks2/3).
3. Slow OS sampling, host suspend or event writes near a slot boundary must not produce catch-up rounds, fabricated samples or late successful actions (Tasks1/2/3).
4. A valid memory-limit failure must permit comparison, while invalid evidence, profile mismatch or incomplete cleanup must block B even if a summary says passed (Tasks3/4).
5. A crashes after reservations or B sees inputs changed between validation and startup: preserve claims, reject reuse, revalidate at startup, and clean only owned resources (Tasks2/4).

## File Structure and read-only reuse

All new code below is under `rust/tests/phase5/attached-memory/`:

| Files | Responsibility |
|---|---|
| `policy.mjs`, `policy.test.mjs` | Contracts, absolute slot/sample schedules, attached memory aggregation |
| `guard.mjs`, `guard.test.mjs` | Preparation/measurement/round/freeze deadlines and awaited operations |
| `scenario.mjs`, `scenario.test.mjs` | Static/transition rounds, instrumentation counters, measurement boundary |
| `run.mjs`, `run.test.mjs` | Runtime wrapper, baseline/manifest checks, lifecycle integration |
| `verify-trace.mjs`, `verify.mjs`, `verify.test.mjs`, `test-fixture.mjs` | Raw evidence joins, arm verification and exclusive output |
| `compare.mjs`, `launch.mjs`, `launch.test.mjs`, `compare.test.mjs` | Pair identity, eligibility and exclusive launch/compare |

Operational report: `docs/testing/rust-attached-memory-comparison.md`; eventual result link in `docs/testing/rust-phase-5-memory-investigation.md`. Update this plan's checkboxes only as work is verified.

Read-only imports: `separated/runtime.mjs` createRuntime/sha256/validateShutdown; `separated/run.mjs` runExperiment/reserveLaunch/root; `separated/contract.mjs` validateConfig/compareIdentity; `separated/transitions.mjs` selectedGeometry/verifyTransition; `minimal-cdp-cadence/scenario.mjs` prepareCdp/ui/performRound/observeFailureState; `minimal-cdp-cadence/cdp.mjs` and `dom.mjs` fixed expressions; `minimal-cdp-cadence/sampling.mjs` sampleAttached/validateAttachedSample; `minimal-cdp-cadence/run.mjs` commonSources/checkBaselines. Import only compatible exported helpers. Do not call runCdpCadence/createCdpCadenceRuntime or installCadenceGuard: they embed the short contract. Private verifier helpers may be copied with provenance into new verify-trace.mjs and adapted; do not export them by changing frozen source.

## Task 1: Explicit experiment clocks and attached verdict

**Files:** Create policy.mjs, guard.mjs and their tests.

**Interfaces:** `resolveArm(arm:'A'|'B',profile:'preflight'|'full')->Contract` returns `{scope:'AM',arm,profile,seconds,rounds,periodMs:60000,preparationMs:900000,freezeGraceMs:15000}` (180/3 or7200/120). `slot(contract,startMs,k)->{startMs,deadlineMs,index}` uses index0 for A and k%16 for B. `nextSampleAt(startMs,observedMs)->number` returns the next absolute30-second tick strictly after the completed collection; skipped ticks are not synthesized. `memoryResult(samples,durationSeconds,profile)->{memoryPassed:boolean|null,windows,ratios,roles}` validates honest attached samples and uses full-only aggregation. Invalid inputs throw; preflight yields null, not a pass.

`installArmGuard(r)->guard` supplies the existing helper-compatible `deadline`, `globalDeadline`, `check()`, `beginRound(deadline)`, `betweenRounds()`, `finish()`, plus `startMeasurement(startMs)` and `beginFreeze()`. Wrappers guard tool/read/checkStop/docker/ps/waitFor/during. Pending operations are awaited even on failure. Freeze mode permits evidence finalization only, no new product mutations; cleanup starts only after finish().

- [x] Write `absolute slots survive long preparation` with `assert.deepEqual(slot(resolveArm('B','full'),0,119),{startMs:7140000,deadlineMs:7200000,index:7})`; preflight B indices0,1,2; unknown arm/profile rejected. Fake clock setup899000ms followed by measurement accepts a slot at setup+7140000ms; setup900001ms fails. A response at slot deadline+1 cannot create successful round evidence. A skipped minute is failure rather than a new shifted slot.
- [x] Add sampling/verdict assertions: collection finishing35000ms schedules60000ms, not65000ms; 46-second gap rejects; a window with29 samples rejects; 30 accepts. A finite positive total last/first1.2 passes and1.200001 fails; first1200 seconds are excluded; elapsed7200 is excluded from input aggregation and not silently relabeled. Altered total/process sums, foreign/reused PID, detached phase or established0/2 reject. Valid preflight returns memoryPassed=null. Use synthetic full-duration samples, not live waits.
- [x] Run `node --test rust/tests/phase5/attached-memory/policy.test.mjs rust/tests/phase5/attached-memory/guard.test.mjs`; confirm meaningful RED before implementation.
- [x] Implement the named interfaces with integer-millisecond scheduling, existing attached sample validation and unchanged numerical median math. Record guard violations once, preserving observed/deadline times and reason; freeze grace is separate from round/measurement work.
- [x] Run the same tests; require all pass. Commit only these four files with message `test: define attached memory clocks and verdict`.

## Task 2: Static and transition execution with fresh lifecycle

**Files:** Create scenario.mjs, run.mjs and their tests.

**Interfaces:** `createAttachedRuntime({root,out,config,arm,profile},deps={})->Runtime`; `executeAttached(r,scenario=runAttachedArm)->Promise<summary>`; `runAttachedArm(r,overrides={})->Promise<void>`; `performStaticRound(r,k)->Promise<void>`. Summary records arm/profile, preparation and measurement counters separately, initial bindings/geometries, frozen boundary, source manifests and actual clocks. Scope remains AM throughout; full is not M/F acceptance.

- [x] Write `static round queries six times without mutation` with fake-runtime `assert.deepEqual(actions,Array(6).fill('identity'))` and `assert.deepEqual(tail,['audit16','health32'])`; B passes k%16 to the existing performRound and revisits session0 with its current paired owner/epoch/stream. The A health observation must match all16 post-preparation bindings and geometries. A static change fails even with successful CDP replies. Preserve distinct request IDs/trace sequence for repeated identical identity calls.
- [x] Add integration-boundary tests: normalization and stable geometry happen while setup Playwright is attached; disconnect/zero endpoint/one raw connection/Network.disable/identity occur before measurement. No reconnect afterward. Counters yield preflight18 evaluations/48 effects/3 health cycles or full720/1920/120, excluding preparation. Inject a mid-audit stop, idle CDP close, timeout after delivery and collector crossing a slot deadline: no later mutation, pending operations awaited, partial effects retained, failure observations then shutdown/EOF/cleanup/hash checks still occur.
- [x] Run `node --test rust/tests/phase5/attached-memory/scenario.test.mjs rust/tests/phase5/attached-memory/run.test.mjs`; observe RED.
- [x] Implement new runtime/guard and absolute-slot orchestration using the read-only helpers. Extend the manifest with the exact new execution and verifier file set plus transitive diagnostic dependencies; compare shared23 separately to M/F receipts. Record normalized width1000 and all initial MCP geometry/bindings. Keep one open CDP connection while servicing output between rounds and while sampling; do not run sample collection recursively or concurrently. Freeze once at7200 (or180 in preflight), preserve later collection data separately, close CDP then verify audits and shut down.
- [x] Pin shared setup's desktop supervisor compatibility in a regression: scope AM with rounds120 supplies the existing fallback `120*240+900=29700` seconds; preflight3 gives1620. This is a coarse safety ceiling, not the experiment budget. The new guard enforces900 preparation/7200 measurement; retain owner-PID supervision and document that a host hang is not hard realtime cancellation. Never pass rounds0 (900-second watchdog) or mislabel scope M to get a longer watchdog.
- [x] Run Task1+Task2 tests; require pass, then commit their four new files as `test: run matched static and transition memory arms`.

## Task 3: Independent raw-evidence arm verification

**Files:** Create verify-trace.mjs, verify.mjs, verify.test.mjs and test-fixture.mjs.

**Interfaces:** `verifyArmEvidence(e)->ArmVerdict`; `loadArmEvidence(out)->Promise<Evidence>`; `verifyArmDirectory(out)->Promise<ArmVerdict>`. Verdict fields: `evidenceValid:boolean`, `workloadPassed:boolean`, `memoryPassed:boolean|null`, `arm`, `profile`, `completedRounds`, `metrics`, `errors`, `phase5Acceptance:false`; directory result adds summary/raw/source hashes and verifiedUtc. Directory creates `attached-memory-verification.claim` and `attached-memory-verification.json` exclusively. CLI: `node .../verify.mjs <arm-dir>`; nonzero for invalid/incomplete workload or full memory failure; callers must inspect fields, not equate exit status with eligibility.

- [x] Build synthetic A/B fixtures with actual contract shapes and raw event/CDP/MCP/audit/output/memory relationships for preflight and full profiles. In `valid memory failure stays valid evidence`, assert `assert.equal(v.evidenceValid,true); assert.equal(v.workloadPassed,true); assert.equal(v.memoryPassed,false)`. Cover valid static/full pass, transitioning/full pass and preflight memoryPassed=null. Summary-only edits cannot alter verdicts.
- [x] Add negative fixtures: one missing/duplicated/reordered A identity response among six; A mutation expression; B wrong session/old binding on revisit; fabricated remote geometry; success after deadline/disconnect; truncated JSONL; audit delivery with missing effect or duplicate effect; foreign output/stream mixing; inconsistent normal boundary; missing sample, stale renderer, extra debugger connection; unknown/missing source key; bad hash/receipt; cleanup leftovers/forced exit. A valid early stop may be recorded as complete negative evidence but workloadPassed=false and memoryPassed=null; missing boundary/raw data is evidenceValid=false.
- [x] Run `node --test rust/tests/phase5/attached-memory/verify.test.mjs`; observe RED.
- [x] Implement raw joins independently of runner summary assertions. Copy/adapt historical private joins into verify-trace.mjs with source provenance. Match repeated A operations by their ordered request-ID/dispatch/response/action spans, not only `(round,action)` uniqueness. Recompute initial/static bindings, B geometry/ownership sequence, audit effects, 120 health checks, output accounting, clock boundaries, identities/socket counts and attached window medians. Do not call the detached or three-round verifier with forged inputs. Check all frozen input hashes before/after reading and preserve raw-hash receipts.
- [x] Add exclusive claim/result collision tests (including an orphan claim) using temporary directories; never repair/overwrite claims. Run Task1–3 tests and require pass. Commit only these four files as `test: verify attached memory arms from raw evidence`.

## Task 4: Pair eligibility, launch and comparison

**Files:** Create compare.mjs, launch.mjs and their tests.

**Interfaces:** `readVerifiedArm(out)->Promise<{summary,verdict}>` checks receipt hashes against current raw evidence without writing/re-running verification. `canStartB(a,currentIdentity,profile)->{allowed,reasons}`; `compareArms(a,b)->Comparison` returns both independent verdicts, `comparable`, differences/limitations and `phase5Acceptance:false`. `launchArm({out,configPath,arm,profile,aEvidence,preflightPair},deps)->Promise<receipt>` reserves paths before spawn, validates inputs before spawning and again in runner setup. CLI: `node .../launch.mjs <out> <config> A|B preflight|full [--a <dir>] [--preflight <pair-result>]`. Comparison CLI: `node .../compare.mjs <A-dir> <B-dir> <fresh-result.json>` writes an exclusive comparison claim/result.

- [x] Write `valid A memory failure still permits B` with `assert.equal(canStartB(a,currentIdentity,'full').allowed,true)` when only a.verdict.memoryPassed is false. Failed/invalid A or cleanup=false blocks; wrong arm/profile, stale hashes/environment/image, missing preflight receipts and changed source between precheck/setup block. B launched first is rejected. Full requires an immutable successful preflight A/B comparison with matching source/binaries/image/environment; preflight has no memory gate. B additionally requires its own same-profile A result and normal cleanup.
- [x] Add launch crash/collision tests: any existing output/log/launch receipt/claim rejects without spawning; failed spawn preserves reservation/error evidence; no fallback new name; no concurrent A/B; hidden child launch records PID/start timestamp, commit and config hash. Comparison rejects swapped arms, overlapping wall intervals, shared owner/profile directory or differing input identity; A and B values remain independent, never subtracted into a pass.
- [x] Run `node --test rust/tests/phase5/attached-memory/launch.test.mjs rust/tests/phase5/attached-memory/compare.test.mjs`; observe RED.
- [x] Implement these interfaces with existing reserveLaunch and safe fresh-profile paths. Enforce A's recorded finish/cleanup before B starts. Preserve candidate/image. A memory failure is distinguished from inability to compare. Store limits (single order, attached instrumentation, unequal action costs) in comparison output. Never auto-launch a repeat or new pair on failure.
- [x] Run all explicit new tests, then commit these four files as `test: gate and compare attached memory experiment pairs`.

## Task 5: Integrated readiness and bounded preflight

2026-10-28 readiness: final integration214/214; one independent review, two Important findings fixed with four RED→GREEN regressions. Report and unchanged candidate config prepared. No live arm has run; preflight/full authorization and execution remain pending.

2026-10-28 execution update: user authorized the bounded A/B preflight. A's first launch at fd354fa failed before runtime initialization because executable run.mjs awaited a circular import. No measurement, B launch, verifier or automatic retry occurred. Failure evidence and active reservation are preserved. A real child-process regression reproduced exit13 and passed after async-main correction; affected run/launch/compare/verify tests79/79. Preflight pair remains incomplete, and full execution remains unauthorized/unexecuted. See the operational report for exact evidence paths.

**Files:** Create docs/testing/rust-attached-memory-comparison.md; update this plan with actual verified progress. Evidence root for the first authorized attempt: `artifacts/phase5-attached-memory-20261027/`; reserve once, never reuse consumed paths.

- [x] Run this exact integrated command, require all pass, and record the actual test count. No live rerun of old cadence/M/F/N or fuzz is included. Require `git diff --check` clean for changed files.

```powershell
node --test rust/tests/phase5/attached-memory/policy.test.mjs rust/tests/phase5/attached-memory/guard.test.mjs rust/tests/phase5/attached-memory/scenario.test.mjs rust/tests/phase5/attached-memory/run.test.mjs rust/tests/phase5/attached-memory/verify.test.mjs rust/tests/phase5/attached-memory/launch.test.mjs rust/tests/phase5/attached-memory/compare.test.mjs rust/tests/phase5/minimal-cdp-cadence/cdp.test.mjs rust/tests/phase5/minimal-cdp-cadence/dom.test.mjs rust/tests/phase5/minimal-cdp-cadence/sampling.test.mjs rust/tests/phase5/minimal-cdp-cadence/scenario.test.mjs rust/tests/phase5/minimal-cdp-cadence/run.test.mjs rust/tests/phase5/minimal-cdp-cadence/verify.test.mjs rust/tests/phase5/separated/contract.test.mjs rust/tests/phase5/separated/runtime.test.mjs rust/tests/phase5/separated/transitions.test.mjs
```
- [x] Use one final independent code review of this implementation range, following executing-plans/requesting-code-review instructions. Fix material findings with focused RED/GREEN tests; repeat only checks affected by those fixes. Preserve a bounded review record; do not start an open-ended review loop.
- [x] Write the report with exact CLI commands, stop files, claims/results, frozen inputs and expected preflight/full metrics. Copy the unchanged known candidate config; attach M/F baseline paths. Record implementation commit and manifest. Confirm live authorization at execution time from the session; design/plan approval alone is not a claim that an experiment ran.
- [ ] Execute the new preflight A once at `preflight-a`, verify once after finishedUtc, and only if eligible execute B once at `preflight-b`. Each measures180 seconds, three slots,18 evaluations,48 effects,3 health cycles, sampled attached state, normal EOF32/cleanup. Compare once to `preflight-comparison.json`. These are two arms of one bounded preflight, not retries of the old short test. Failure stops without renaming/relaunching; investigate only if authorized scope permits.
- [ ] Record raw verification results/limits and commit only implementation fixes or relevant documents with named paths. No full run starts until readiness is concrete and the full execution scope is authorized. If already explicitly authorized in-session, proceed without asking again.

## Task 6: Authorized full pair and immutable result report

**Files:** Update docs/testing/rust-attached-memory-comparison.md, docs/testing/rust-phase-5-memory-investigation.md and this plan only after actual results; new immutable artifacts `full-a`, `full-b`, `full-comparison.json` under the same evidence root.

- [ ] On authorization, freeze identical inputs and launch full A once with matching preflight receipt; record owned runner PID/start and paths. Monitor files/process identity only. No app/CDP access during measurement, repeated unchanged messages, source changes, additional tests or forced GC. Use heartbeat only when authorized, reusing paused baton-2 and retaining silent-progress/failure-only behavior if requested.
- [ ] After finishedUtc, first check whether the arm verification exists. Run it once only if absent, preserve its output log, and directly cross-check raw window medians, source/binary identities,120 rounds/1920 effects/120 health cycles, outputs, attached socket/process identity and normal exit/EOF32/zero owned leftovers. If a claim exists without result, stop and report; do not rerun or remove it.
- [ ] Start full B once only when canStartB allows it, including valid A memory failure. Monitor and verify under the same rules. On any invalid/workload failure, report the available evidence and stop progression; no automatic rerun.
- [ ] Compare immutable A/B results once, report all five medians/role trends and independent ratios/threshold results with limitations. Keep original failed soak and Phase5 release block. Update only result documents and commit them locally after checking staged paths/diff; preserve all raw artifacts and the server image. Pause the monitor after final reporting if one was activated.

## Self-review and handoff

Spec coverage: fixed inputs/exclusions → Tasks2/4/5; clocks/query matching/static and transition workload → Tasks1/2/3; sampling/verdict → Tasks1/3; A→B eligibility and immutable artifacts → Tasks3/4; cleanup/failure → Tasks2/3/6; bounded preflight and reporting → Tasks5/6. All five Review Focus cases have explicit negative tests above. Interfaces use one AM contract and one ArmVerdict shape throughout. No implementation, live execution or result is claimed by checked-off planning work.

Execution method remains direct implementation in this session, with one final independent review. Await the user's review of this plan before implementation; do not ask them to choose an execution method again.
