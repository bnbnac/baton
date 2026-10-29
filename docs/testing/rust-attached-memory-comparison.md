# Attached CDP memory comparison

## Status — 2026-10-28

**The authorized full A/B pair completed and both independent memory verdicts passed.** At execution commit `0c2373b` (execution sources identical to `cf91fa5`), A measured7200.0030525s and B7200.0033968s. Both have `evidenceValid=true`, `workloadPassed=true`, `memoryPassed=true`; the immutable full comparison is `comparable=true`, with no identity differences. `phase5Acceptance=false` and the Phase5 release block remain. The corrected preflight at `cf91fa5` had previously passed with memoryPassed=null. Full results and limits are below.

Implementation through Task4 is committed at `3778749` (base `48f24a6`), with review fixes/readiness at `fd354fa` (214/214 integration tests). The initial sandbox run reported ten permission failures; the unchanged 210-test suite passed on the host before four review regressions were added. The first authorized A startup failed before measurement; correction `cf91fa5` passed its child-process regression and79/79 affected tests. The user explicitly authorized the corrected attempt. Original failure files remain under the20261027 root; its exact matching global reservation was archived/released only after confirming the old PID/path absent and no arm directory. No automatic renamed retry occurred.

The single independent review found two Important issues and no Critical/Minor issues: stop requests could admit the next MCP/CDP operation, and duplicate timestamps could count toward the minimum memory samples. Four regression tests reproduced the issues (4/4 failed before correction, 4/4 passed afterward). The guard now checks and latches stop state before dispatch, while preserving evidence finalization and cleanup. Both memory-validation paths reject equal adjacent timestamps. The full214-test suite passed after these fixes; no repeated review was requested. Live outcomes below come from actual evidence, not the code review.

Plan: [implementation and execution](../superpowers/plans/2026-10-27-rust-attached-memory-comparison.md). Spec: [approved design](../superpowers/specs/2026-10-27-rust-attached-memory-comparison-design.md).

This is an attached-instrumentation diagnostic. It neither replaces the failed original combined soak nor releases the Phase 5 block. Public boundary completeness remains unverified. Equal evaluation cadence does not mean equal action costs, and one fixed A-then-B order does not establish causality or rule out a leak.

## Inputs and gates

| Input | Required identity |
|---|---|
| App | `artifacts/phase5-product-patch-20261024/baton.exe`, SHA256 `2e2911c3eb830fc8f207ce3c41852015417c75f1c34ed23f7f8dcab006772316` |
| Adapter | `artifacts/phase5-harness-fixes-probe3-20261013/candidate/baton-adapter.exe`, SHA256 `09823dd5d51cd3b33f286540fe43a03570b3eee81497607a1b5b67336fcb754c` |
| Fixture image | `sha256:7270e924b7597cbece5eb6886a47c3383502f31d8a253763774f3b8c6b4f810a` |
| Environment | Windows `10.0.26200` x64, Node `v22.17.0`, required WebView `155.0.4283.62`, Playwright `1.62.1` |
| M baseline | `artifacts/phase5-sampler-diagnostic-20261025/m-preflight` |
| F baseline | `artifacts/phase5-sampler-diagnostic-20261025/f-preflight` |
| Configuration | `artifacts/phase5-attached-memory-20261028/config.json`, byte-for-byte copy of the sampler diagnostic configuration; SHA256 `66cfa6a822b8170a44b5e0222f0efad8f20b23b7dc97522b718c4783130d9ae7` |

Read-only input inspection confirmed both binaries, image, baseline receipts and all 23 common sources. The full manifest currently has 45 sources (23 common plus 22 diagnostic sources). Every launch freezes their actual hashes; verifier checks them again. The actual fresh WebView process version is checked after setup and before measurement against the required baseline version; the prelaunch record is not an observation of that future process.

The launcher checks immutable evidence and input identity before reserving execution. The runner checks its reservation/configuration/source hashes before setup, the actual environment after setup, and eligibility again before measurement. A worktree-wide `artifacts/attached-memory.active.json` reservation prevents concurrent arms. It is removed only after the matching runner reports normal owned cleanup. A crash or failed launch preserves the reservation and consumed paths; do not delete them or change the output name to retry automatically.

B requires A's verified, complete workload, matching inputs/profile and normal cleanup. A valid **memory failure** still permits B; invalid evidence, incomplete workload or cleanup failure does not. Full execution additionally requires the immutable successful preflight pair under the same inputs. CLI nonzero from a memory failure does not by itself determine B eligibility.

## Measurements

| Per arm | Preflight | Full |
|---|---:|---:|
| Preparation budget | 900 s | 900 s |
| Measurement | 180 s | 7200 s |
| Connections / sessions / servers | 32 / 16 / 2 | 32 / 16 / 2 |
| Absolute 60 s slots | 3 | 120 |
| Measurement evaluations | 18 | 720 |
| Audit cycles / effects | 3 / 48 | 120 / 1920 |
| Health cycles | 3 | 120 |
| Memory verdict | `null` | Independent A and B verdicts |

A makes six identity queries per slot with initial selection, width and ownership held fixed. B makes six select/identity/resize/reclaim/connection/handoff evaluations and targets session `k % 16` using its current paired owner. Both normalize the initial workspace to 1000 px (viewport 1280×900), detach setup Playwright, and retain one raw CDP connection with `Network.disable`. No forced GC or heap diagnostics; identity queries are explicitly counted as JavaScript execution.

OS sampling targets absolute 30 s ticks; delayed ticks are skipped, never backfilled. Timestamps must strictly increase after the first observation. First/adjacent/final sample gaps must be at most 45 s. Full verdict excludes the initial 1200 s, then requires at least 30 samples in each of five 1200 s windows. Total private and working-set last-window/first-window median ratios must each be ≤1.2, independently for each arm. Extra ratios and per-role trends are descriptive. No subtraction of A from B changes a verdict.

After all slots finish, only output/status reads may continue to the boundary. A final read may cross the boundary by at most 15 s; samples at/after the fixed end are preserved separately in `memory-post.jsonl`, excluded from the memory verdict. This grace never extends a round's deadline. The shared desktop watchdog is a coarse 1620/29700 s ceiling; the new guard enforces the experiment's smaller budgets and awaits in-flight operations. It is not hard realtime cancellation during a host hang.

## Execution sequence — completed preflight and full pair

The following preflight commands describe the completed20261028 attempt. **Do not rerun them against the consumed paths.** The earlier20261027 A startup attempt is separately preserved. Both corrected arms released their own active reservations after normal cleanup. The full pair was subsequently authorized and completed; all full paths are also consumed. Commands below document the sequence and must not be rerun.

Run from PowerShell in the existing worktree. `node` is available; these commands do not require the `pwsh` executable to be on PATH. The candidate config pins its installed PowerShell path.

```powershell
Set-Location 'C:\Users\sj\Documents\work\code\baton\.worktrees\rust-phase-0'
$am = 'rust/tests/phase5/attached-memory'
$evidence = 'artifacts/phase5-attached-memory-20261028'
node "$am/launch.mjs" "$evidence/preflight-a" "$evidence/config.json" A preflight
```

Wait for `preflight-a/summary.json` to contain `finishedUtc`, and check the log, cleanup and launch PID/start identity. Inspect whether `attached-memory-verification.json` or its `.claim` already exists. **Run the verifier once only when neither exists**, preserving its output in a fresh log. An orphan claim is an incomplete verification, not permission to retry.

```powershell
node "$am/verify.mjs" "$evidence/preflight-a"
node "$am/launch.mjs" "$evidence/preflight-b" "$evidence/config.json" B preflight --a "$evidence/preflight-a"
```

After B finishes, verify once under the same rule, then compare once:

```powershell
node "$am/verify.mjs" "$evidence/preflight-b"
node "$am/compare.mjs" "$evidence/preflight-a" "$evidence/preflight-b" "$evidence/preflight-comparison.json"
```

The authorized full execution used this sequence, with B launched only after A finished, was verified and passed eligibility:

```powershell
node "$am/launch.mjs" "$evidence/full-a" "$evidence/config.json" A full --preflight "$evidence/preflight-comparison.json"
# After A finishes, verify once:
node "$am/verify.mjs" "$evidence/full-a"
node "$am/launch.mjs" "$evidence/full-b" "$evidence/config.json" B full --a "$evidence/full-a" --preflight "$evidence/preflight-comparison.json"
# After B finishes, verify once, then compare once:
node "$am/verify.mjs" "$evidence/full-b"
node "$am/compare.mjs" "$evidence/full-a" "$evidence/full-b" "$evidence/full-comparison.json"
```

Each launch reserves `<arm>.claim.json`, `<arm>.inputs.json`, `<arm>.launch.json` and `<arm>.log`; the runner exclusively creates the arm directory. Existing paths reject reuse. Each comparison reserves `<result>.claim` and writes its result exclusively. Neither reading saved verification nor comparing results reruns an arm or verifier.

To request a stop, create the active arm's `stop` file, for example:

```powershell
New-Item -ItemType File -Path "$evidence/preflight-a/stop"
```

Monitor evidence files and owned process identity only during measurement. Do not reconnect Playwright/CDP, inspect JavaScript, force GC, change sources, run other experiments or interact with the app. On failure, preserve all evidence and report it; no renamed retry. Keep the preserved fixture image. Cleanup must be restricted to this run's matching owner label and exact name/ID.

## Results

The authorized A launch on **2026-10-28 07:08 KST** (2026-10-27 22:08 UTC), commit `fd354fa`, exited before creating the arm directory. `preflight-a.log` reports an unsettled top-level await at the entry-point import of `launch.mjs`. Its dependency graph imports `run.mjs` while that executable module is still awaiting completion. The launcher's subsequent PID/start-time query found PID40940 already absent, and `preflight-a.launch.json` records `launch_failed`; a start timestamp was not obtained.

An offline real-child-process regression reproduced exit13 with the same import warning. Moving CLI execution into an async main, without blocking module evaluation on top-level await, makes the entry reach reservation validation and reject an unreserved test invocation with the expected exit1. This regression passed after correction, and the affected four test files passed79/79. Prior tests imported the runtime as a library and injected the launch subprocess, so they did not exercise this executable entry cycle.

Read-only process checks found PID40940 absent and no Node process targeting the attempt's output path. Neither A nor B arm directory exists. The failure occurred before `mkdir`, runtime initialization and fixture/app setup; no measurement/audit/sample or app/server cleanup result is claimed. `preflight-a-startup-failure.json` records the assessment and hashes of the original launch/inputs/claim/log. The verifier was not invoked because no completed arm evidence exists. The matching global active reservation and all consumed paths are retained.

No valid preflight pair or memory result follows from that first startup-failed attempt. Its historical failure is not overwritten by the corrected results below.

### Corrected preflight pair — 2026-10-28

Execution commit `cf91fa510fb1b8a307e98644c311a01b7b0d3f94`; evidence root `artifacts/phase5-attached-memory-20261028`. Each arm was launched once, verified once after `finishedUtc`, then the pair was compared once. B launch was admitted only after A's valid workload and cleanup. A ran07:13:25–07:16:57 KST; B ran07:17:46–07:21:15 KST. Verification of the already completed B resumed after the usage-limit interruption; B was not restarted.

| Observed result | A static | B transitioning |
|---|---:|---:|
| Actual measurement seconds | 180.0080306 | 180.0010621 |
| Connections / sessions / servers | 32 / 16 / 2 | 32 / 16 / 2 |
| Completed rounds | 3 | 3 |
| Measurement evaluations | 18 identity queries | 3 identity queries +15 actions |
| Preparation evaluations (separate) | 1 identity | 1 identity |
| Audit effects / health cycles | 48 / 3 | 48 / 3 |
| Transitioned session indices | none | 0,1,2 |
| OS samples / established CDP connections per sample | 6 / 1 | 6 / 1 |
| Per-session output rate range (bytes/s) | 1155.921–1162.748 | 1152.029–1163.383 |
| App exit / adapter EOF | 0 /32 | 0 /32 |
| Forced cleanup / remaining processes / remaining containers | false /0 /0 | false /0 /0 |
| Evidence valid / workload passed | true /true | true /true |
| Memory verdict | null | null |

Raw audit files, health/shutdown events and memory JSONL were directly cross-checked against the receipts. A sample elapsed seconds:1.7059903,31.8023921,61.7167254,91.8099837,121.6301637,151.7063445. B:1.7964394,31.8013330,61.6515369,91.8031409,121.6847935,151.7029195. All show one established CDP connection, and no forced GC/heap diagnostics occurred. Preparation identity queries are excluded from the18 measured evaluations. Each source manifest contains the same45 files (23 common+22 diagnostic); both candidate hashes, image and Windows/Node/WebView/Playwright identities match. The pair has distinct owners and directories, with A finished before B started.

Read-only follow-up confirmed both exact owner labels have zero containers, runner PIDs32256/42560 are absent, the global active reservation is absent, and the required fixture image remains. No unrelated resource was removed. Follow-up evidence is `preflight-final-observation.json`.

Immutable receipts:

- A: `preflight-a/attached-memory-verification.json`; summary SHA256 `50a999b78861cf8a12345ccf7f610e8e90cd0df06b913d39ea2dc815e3446349`.
- B: `preflight-b/attached-memory-verification.json`; summary SHA256 `3a90d89c19e2a69f75138626edd42959750ce0729d95a8df860747ab29f78cd7`.
- Pair: `preflight-comparison.json`, SHA256 `9db9d69704421a8c90f7aa7b092ef566d9c2a0d2a18eb3936d61a64aa7f8f6ce`; `comparable=true`, `preflightPassed=true`, no identity differences.

This validates the new short scheduling/measurement/transition/verification path. It does **not** exercise five20-minute windows, all120 session revisits or establish a long-run memory conclusion. At preflight completion full A/B were unexecuted; the later full result is recorded below. The original failed soak, public-boundary limitation and Phase5 release block remain unchanged.


### Authorized full pair — 2026-10-28

Both full arms ran once at `0c2373b726a692650912e818fad98218f19d9936`, with execution sources identical to `cf91fa5`. A runner PID40108 started04:20:12.9173565Z; measurement began04:20:37.251Z and cleanup finished06:20:45.487Z. Its once-only verification completed06:44:35.812Z before B was admitted. B runner PID26756 started06:45:28.7277604Z; measurement began06:45:53.029Z and cleanup finished08:46:00.126Z. B verification completed08:51:51.233Z. All times are UTC.

| Evidence | A: static identity | B: automatic transitions |
|---|---:|---:|
| Measurement seconds | 7200.0030525 | 7200.0033968 |
| Connections / sessions / servers | 32 / 16 / 2 | 32 / 16 / 2 |
| Completed rounds / measured evaluations | 120 / 720 | 120 / 720 |
| Measured queries / actions | 720 / 0 | 120 / 600 |
| Separate preparation identity query | 1 | 1 |
| Audit cycles / effects / health cycles | 120 / 1920 / 120 | 120 / 1920 / 120 |
| Per-session output rate range, B/s | 1158.391870–1159.664508 | 1158.764991–1160.561163 |
| OS samples / largest boundary-or-adjacent gap, s | 240 / 30.616243 | 240 / 30.671466 |
| Established owned CDP per sample | 1 | 1 |
| Forced GC / heap diagnostic calls | 0 / 0 | 0 / 0 |
| Normal exit code / adapter EOFs / owned leftovers | 0 / 32 / 0 | 0 / 32 / 0 |
| evidenceValid / workloadPassed / memoryPassed | true / true / true | true / true / true |

Each verifier ran once, with exclusive claim/result and `full-a.verify.log` / `full-b.verify.log` preserved. `full-comparison.json` and its claim/log were created once after B verification. Its full-profile `preflightPassed=false` is not a failed preflight: the earlier preflight receipt remains true; the full result uses memoryPassed=true.

Raw events, audits, shutdown and memory JSONL were directly cross-checked:120 rounds,120 health cycles,1920 audit effects, exit0/EOF32; every memory sample had one established owned CDP connection. A made six ordered identity evaluations per slot; B used the six scheduled select/identity/resize/reclaim/choose_connection/handoff operations and session k%16/current paired owner, validated by the trace verifier. Identity evaluation is JavaScript execution despite jsProbes=0; no claim of zero JS or detached measurement is made. Both memory-post.jsonl files are empty; no post7200 sample entered a verdict.

All45 source hashes (including23 common sources), two candidate hashes and environment/image identities matched the frozen inputs and preflight; current source/binary hashes were checked again after comparison. Windows10.0.26200 x64, Nodev22.17.0, WebView155.0.4283.62 and Playwright1.62.1 were identical. Candidate and image SHA256 values remain those in the input table.

#### Total memory windows and descriptive ratios

The raw JSONL medians were independently recomputed and exactly matched both verification receipts, including all role windows. Every window below has40 samples. Values are bytes. The only pass criteria remain last/first total private and working-set ratios each <=1.2; adjacent/first comparisons below are descriptive.

| Arm | Window, min | Private median | Working-set median | Private / first | Working / first | Private / previous | Working / previous |
|---|---|---:|---:|---:|---:|---:|---:|
| A | 20–40 | 834822144 | 1237780480 | 1.000000000 | 1.000000000 | — | — |
| A | 40–60 | 853561344 | 1259655168 | 1.022446937 | 1.017672510 | 1.022446937 | 1.017672510 |
| A | 60–80 | 853600256 | 1212219392 | 1.022493548 | 0.979349256 | 1.000045588 | 0.962342253 |
| A | 80–100 | 854398976 | 1231611904 | 1.023450303 | 0.995016422 | 1.000935707 | 1.015997527 |
| A | 100–120 | 884819968 | 1203140608 | 1.059890390 | 0.972014527 | 1.035605136 | 0.976882900 |
| B | 20–40 | 706797568 | 1108774912 | 1.000000000 | 1.000000000 | — | — |
| B | 40–60 | 702918656 | 1105012736 | 0.994511990 | 0.996606907 | 0.994511990 | 0.996606907 |
| B | 60–80 | 696676352 | 1074604032 | 0.985680177 | 0.969181409 | 0.991119450 | 0.972481128 |
| B | 80–100 | 694599680 | 1067956224 | 0.982742035 | 0.963185776 | 0.997019173 | 0.993813714 |
| B | 100–120 | 698081280 | 1067354112 | 0.987667915 | 0.962642733 | 1.005012384 | 0.999436202 |

A last/first: private1.059890390 (+5.9890%), working0.972014527 (−2.7985%). B: private0.987667915 (−1.2332%), working0.962642733 (−3.7357%). Each independently passes.

#### Role trends (descriptive only)

Median sequences correspond to20–40,40–60,60–80,80–100,100–120minutes; MiB values are rounded to two decimals. Role medians need not sum to the median of the total.

| Arm / role | Private medians, MiB | Working-set medians, MiB | Last/first private | Last/first working |
|---|---|---|---:|---:|
| A / app | 145.09, 145.86, 145.94, 146.20, 146.36 | 167.97, 169.90, 121.50, 143.98, 144.60 | 1.008804049 | 0.860873711 |
| A / renderer | 349.79, 366.77, 366.75, 365.72, 391.75 | 399.19, 416.26, 416.71, 414.57, 433.48 | 1.119967614 | 1.085890981 |
| A / adapter | 86.98, 87.29, 87.51, 89.11, 92.33 | 312.04, 312.22, 312.38, 312.70, 294.91 | 1.061503570 | 0.945100273 |
| A / other | 214.01, 213.95, 214.10, 214.06, 213.99 | 302.91, 302.99, 303.27, 302.92, 274.74 | 0.999917862 | 0.907001786 |
| B / app | 64.05, 64.74, 65.42, 66.03, 66.38 | 72.88, 73.53, 49.78, 51.04, 51.23 | 1.036440704 | 0.702950398 |
| B / renderer | 313.34, 307.30, 304.12, 297.59, 296.26 | 369.79, 363.93, 358.35, 349.26, 346.89 | 0.945502032 | 0.938051602 |
| B / adapter | 93.74, 93.97, 94.60, 96.29, 100.21 | 310.31, 310.38, 310.76, 311.79, 313.86 | 1.068983478 | 1.011461697 |
| B / other | 201.47, 200.81, 201.55, 202.61, 203.14 | 304.89, 305.46, 305.72, 306.15, 306.43 | 1.008269110 | 1.005022228 |

A renderer private increased11.9968% across the endpoint windows while B renderer private decreased5.4498%; B app and adapter private still increased3.6441% and6.8983%. These observations neither establish a transition benefit nor prove absence of retention. The arms began with different absolute memory levels, were executed in one fixed A→B order, retain CDP instrumentation, and have unequal action costs despite matching evaluation cadence. No A subtraction or changed acceptance threshold was used.

#### Receipts, cleanup and limits

- A: full-a/attached-memory-verification.json; summary SHA256 `04c785c4d836a0187bce48840ce69020e2305fe186b51ac2ab68704749243905`.
- B: full-b/attached-memory-verification.json; summary SHA256 `66d7642f202564c1b58394cfa6c3a11feccb4025fd88261330dd211af856a4e5`.
- Pair: full-comparison.json, SHA256 `0951de3f4dab3b077b39382fe389c1b456f6db17d9b5a67d3f02a1979e87e0b3`; comparable=true, differences=[], memoryPassed=true, phase5Acceptance=false.
- Fresh follow-up: full-final-observation.json at2026-10-28T08:52:58.195Z; both exact owner labels returned zero containers, runners40108/26756 were absent, the active reservation was absent, and the required image remained. Exact fixture names/IDs are recorded there. No resource was removed by this follow-up.

Both runtime cleanup receipts record normal exit, EOF32, descendant exit audit, no forced cleanup, and zero owned process/container leftovers. The preserved image was not deleted. No product/Cargo/fuzz file was edited, run or committed for this closeout.

This completes the authorized attached automatic-transition diagnostic scope, not Phase5 acceptance. The original failed combined soak remains a failure; public-boundary completeness and the broader combined-transition acceptance claim remain unverified. A single diagnostic pair cannot establish causality, cover native public-boundary interactions, or prove leak absence. The original Phase5 release block and phase5Acceptance=false remain. No new trial was started.
