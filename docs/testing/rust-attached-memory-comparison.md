# Attached CDP memory comparison

## Status — 2026-10-28

Implementation through Task 4 is committed at `3778749` (base `48f24a6`), followed by the final review fixes recorded with this report. The final 16-file offline integration suite passed **214/214** tests. The initial sandbox run reported ten local socket/file-rename permission failures; the same unmodified 210-test suite passed in the host environment before the four review regressions were added. **No preflight or full arm has run.** The evidence root currently contains only a copy of the known candidate configuration.

The single independent review found two Important issues and no Critical/Minor issues: stop requests could admit the next MCP/CDP operation, and duplicate timestamps could count toward the minimum memory samples. Four regression tests reproduced the issues (4/4 failed before correction, 4/4 passed afterward). The guard now checks and latches stop state before dispatch, while preserving evidence finalization and cleanup. Both memory-validation paths reject equal adjacent timestamps. The full 214-test suite passed after these fixes; no repeated review or live experiment was used to claim closure. The reviewer declined to judge live outcomes, which remain pending.

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
| Configuration | `artifacts/phase5-attached-memory-20261027/config.json`, byte-for-byte copy of the sampler diagnostic configuration; SHA256 `66cfa6a822b8170a44b5e0222f0efad8f20b23b7dc97522b718c4783130d9ae7` |

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

## Exact execution sequence — not yet executed

Run from PowerShell in the existing worktree. `node` is available; these commands do not require the `pwsh` executable to be on PATH. The candidate config pins its installed PowerShell path.

```powershell
Set-Location 'C:\Users\sj\Documents\work\code\baton\.worktrees\rust-phase-0'
$am = 'rust/tests/phase5/attached-memory'
$evidence = 'artifacts/phase5-attached-memory-20261027'
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

Only after readiness and full-run authorization, launch full A; each arm takes two measurement hours plus setup/cleanup. Launch B only after A has finished, been verified and passed eligibility:

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

Pending. Offline passing tests and prepared configuration are not live results or a Phase 5 acceptance claim.
