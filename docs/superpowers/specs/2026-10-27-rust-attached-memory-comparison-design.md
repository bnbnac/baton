# Attached static/transition memory comparison

Date: 2026-10-27 (Asia/Seoul)
Status: design proposed; awaiting document approval. No implementation or live run authorized by this document alone.

## Intent and evidence

Determine whether the current candidate remains within the existing two-hour memory-growth limit while repeatedly selecting, resizing, reclaiming and handing off sessions through the actual DOM controls, with a static control under comparable CDP instrumentation.

The short `minimal-cdp-cadence` run2 completed three rounds and independently verified them. It did not evaluate memory acceptance. Its report is `docs/testing/rust-minimal-cdp-cadence-feasibility.md`; evidence is `artifacts/phase5-minimal-cdp-cadence-20261026/run2/`. The implementation base for this design is commit `4ca1729`.

Formal detached M passed its existing two-hour criterion, but measurement had no debugger connection. It cannot serve as a same-instrumentation control for an attached transition run. Historical M/F/N, failed combined soak and all their verifiers remain unchanged.

## Approaches and selected scope

The user selected **A then B, two hours each**, over A/B/B/A, eight hours. Both use fresh processes and fixture containers per arm. A/B/B/A could check repeatability and order sensitivity but doubles live time and evidence review. The selected single pair retains order/environment drift as an explicit limitation; repetitions are not automatic.

- A: static selected session, geometry and ownership under continuous output load; six bounded read-only DOM identity queries per minute.
- B: one complete selection/resize/reclaim/handoff round per minute, including six bounded DOM evaluations.
- Both: one raw CDP page connection, Network tracking disabled, no forced GC or heap diagnostics, same output/audit/health workload.

This matches connection configuration, evaluation count and minute cadence. It does not equalize expression complexity, exact intra-minute timing, response byte count or rendering cost. B includes the effects of automation actions as well as product transitions. The pair cannot isolate a particular transition or prove a causal leak.

## Fixed inputs and exclusions

Use the existing worktree, app and adapter candidates and preserved fixture image. Do not rebuild the product, edit Cargo/fuzz, change historical shared implementations or rewrite old evidence.

- App SHA256: `2e2911c3eb830fc8f207ce3c41852015417c75f1c34ed23f7f8dcab006772316`.
- Adapter SHA256: `09823dd5d51cd3b33f286540fe43a03570b3eee81497607a1b5b67336fcb754c`.
- Fixture image ID: `sha256:7270e924b7597cbece5eb6886a47c3383502f31d8a253763774f3b8c6b4f810a`.
- Each arm: 32 MCP connections, 16 SSH sessions, two local fixture servers, original session-to-adapter mapping.
- Preserve exact 23 common source hashes and M/F preflight receipt checks. Freeze the additional diagnostic source manifest before A; require identical hashes before/after each arm and across A/B.
- Require identical Windows, Node, WebView and setup Playwright versions and image IDs across arms. A mismatch stops progression and is reported; receipts are never edited to conceal it.
- Use a fresh app profile per arm and identical viewport/initial terminal workspace width. Close/clean A's owned resources before B; never run arms concurrently.

No native keyboard/mouse, OS maximize/restore, public-boundary completeness, overload experiment, forced GC or JS heap investigation is added here. Native behavior and release acceptance are separate scopes. Keeping overload outside this comparison avoids adding another variable; existing M overload evidence retains its own scope.

## Preparation and clocks

Preparation has its own 900-second budget. The historical short runner's global 900-second deadline must not govern a two-hour measurement.

Shared setup creates all sessions, selects session 0 and starts the established output fixture. Normalize both arms to terminal workspace width 1000px and wait for stable geometry before measurement. Finish setup Playwright work, disconnect it, confirm zero owned established debugger connections, discover the owned page, attach raw CDP once and send `Network.disable`. Check the full selected session ID is session 0.

Record the preparation DOM evaluations separately. Start a new monotonic measurement clock only after preparation and identity/hash checks succeed. No Playwright reconnect, alternate debugger or interactive app manipulation during measurement.

Measurement lasts at least 7200 seconds. The 120 minute slots are `[60k,60(k+1))`, k=0..119, relative to measurement start. Admit one round per slot at or after its start; it must finish by that slot's end. Work, verification, audit and health all count against this deadline. No accumulated drift, catch-up rounds or retry. A missed slot or incomplete round stops the arm. The scheduler services output and sampling while waiting.

After slot 119, continue output servicing/sampling until 7200 seconds, then freeze measurement before closing CDP or shutting down. Record actual boundary and any overshoot; an inability to freeze within 15 seconds is invalid evidence. Only OS samples with elapsed time in `[0,7200)` enter the growth verdict. All later observations remain preserved and separately labeled.

## Per-minute workload

### A: static control

Keep session 0 selected, width 1000px, and all initial ownership bindings. Each minute execute six sequential fixed synchronous read-only identity evaluations for session 0. They must not focus, mutate DOM, resize or invoke product handlers. Then perform one audit across all 16 sessions and one health check across all 32 connections. Check ownership/epoch/stream and geometry against the post-preparation baseline; any unsolicited change fails the static contract.

### B: transition arm

Builder proposal: visit session `k % 16` each minute, covering all sixteen sessions (eight visits for indices 0..7, seven for 8..15). This extends the short experiment's two-session revisit coverage without creating extra sessions.

Use the proven sequence: select by unique tab label/state; verify full selected ID; wait for selected geometry; change workspace width to 720px if current columns >=90, otherwise 1000px; independently verify changed geometry through MCP and remote `stty`; reclaim; observe `user_owned`; choose the paired adapter `(currentAdapter+16)%32`; hand off; independently verify new owner, old-owner release, epoch and stream before adopting the binding. Then audit16 and health32.

The six evaluations are select, identity, resize, reclaim, choose-connection and handoff. They use actual DOM handlers, never direct backend/Tauri commands. Keep bounded transport deadlines and error payloads, idle-disconnect detection and distinction between transport success and host-side abort from the short driver. A response does not prove a transition; independent MCP/server evidence is required.

Each successful arm must have 120 rounds, 120 complete audit cycles/1920 server effects and 120 health cycles. Count exactly 720 measurement evaluations per arm, separately from preparation. Report B's 600 action evaluations/120 identity queries and A's 720 read-only queries honestly; JS execution is not zero. Output must meet the existing >=1024 B/s per-session accounting contract, including its explicit reclaim/private interval handling.

## Memory sampling and verdict

Use OS process sampling at a 30-second target, scheduled from measurement start rather than repeatedly adding collection time. Do not backfill missing readings or issue catch-up samples. Require first, adjacent and final sample gaps <=45 seconds and at least 30 real samples in each evaluated 20-minute window. Sample count is reported, not assumed to be exactly 240.

Every sample validates owned PID/start-time identity and sums for the app, renderer, 32 adapters and remaining owned descendants. Require stable required process identities; report role-level and total private/working memory. Require the raw CDP client open and exactly one owned server-side established debugger connection, with the listener owned as expected. Label samples `minimal_cdp_attached`; do not relabel as `natural` or zero out connection counts. Discrete socket observations do not rule out all transient outside connections.

The old `native-soak-control.mjs` memoryVerdict requires detached samples and must remain unchanged. A new attached-specific verifier validates the attached contract, then applies the same numerical aggregation and threshold:

1. Exclude the first 1200 seconds as warmup.
2. Compute total private and working-set medians for `[1200,2400)`, `[2400,3600)`, `[3600,4800)`, `[4800,6000)`, `[6000,7200)`.
3. Divide the last window by the first, independently for private and working set.
4. Each arm meets the memory limit only when both ratios <=1.2.

Report every window and adjacent/first-window ratios for context; those extra comparisons are not additional pass gates. Role-level trends are diagnostic, not replacement gates. Do not subtract A's increase from B to manufacture a pass.

Separate `evidenceValid`, workload completion and `memoryPassed`. An otherwise valid run exceeding the threshold is valid negative evidence. Invalid measurements get an unevaluated memory verdict, never a pass.

## Progression and interpretation

Builder proposal: B may start only after A has valid evidence, complete workload, unchanged inputs and verified normal cleanup. A exceeding the memory threshold alone does not block B: B is still needed to compare the attached baseline with transitions. A failure in workload, instrumentation, hashes, shutdown or evidence integrity blocks B. Report the failure without automatically restarting either arm.

Both arm results are shown independently. Both passing supports only this bounded attached A/B scenario. A failing limits attribution of any B growth; A passing/B failing identifies a transition-associated difference in this pair but does not prove product leakage. A failing/B passing does not validate the whole pair as a release gate. Neither result replaces the original failed soak or closes public-boundary completeness. `phase5Acceptance` stays false.

Single A/B order, active CDP and unequal action/query work remain limitations even when hashes/versions match. Record host interruptions or version changes; do not tune thresholds after seeing the results.

## Evidence, stop and ownership

New implementation/evidence namespace; retain all short-run files and outputs. Launcher exclusively creates arm output, log and launch receipt and records commit, configuration hash, PID/start time and owner label. Existing output or an existing claim is never overwritten or renamed to enable a retry.

Preserve raw events, CDP trace, MCP responses, output accounting, audit files, geometry, OS memory/socket samples, measurement boundary, hashes/environment and exit/cleanup observations. The independent verifier joins raw evidence and records source/summary/raw hashes. Verification claims/results are exclusive and run once per arm. The comparison consumes immutable arm results and independently verifies shared input identity; it does not rewrite them.

A stop file or first failure blocks further mutations. Await/record pending work; a timeout does not imply cancellation or rollback. Freeze, close CDP, preserve partial audit effects and uncertain ownership, and use the existing bounded read-only failure status sweep. Shutdown normally and verify 32 adapter EOFs and zero owned remnants. Any fallback cleanup matches owner label plus exact container ID/name or process PID/start time; never remove the preserved image. Forced cleanup cannot become a successful normal-exit verdict.

The implementation plan will specify offline regression checks and one bounded preflight of the new A/B scheduling/verifier path before any four-hour run. Reuse already verified short-driver results; do not rerun the old three-round experiment solely for reassurance. Preflight output cannot count as two-hour evidence. Long live execution and monitoring are separate from design approval; no run starts in this design stage.

## Builder discretion and next deliverables

Module boundaries, bounded serialization layout, test fixtures and exact helper reuse are builder choices, provided old source/evidence remains immutable. Long-run scheduling, evaluation counting and attached verification must be tested independently of real elapsed waits. Include negative fixtures for late/missing rounds, static mutation, stale processes, wrong debugger counts, gaps, hash drift, duplicate/missing audit effects and a valid memory-limit failure.

After document approval, write an implementation plan. After implementation verification, present the preflight/launch readiness and actual execution scope. Reports will link both immutable arm results and comparison verdict; release-blocking documentation keeps the above limits explicit.
