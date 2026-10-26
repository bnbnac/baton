# Native cadence feasibility diagnostic

This diagnostic is scoped to three native UI transitions, visiting sessions
0 → 1 → 0, on the existing 32-connection / 16-session / 2-server fixture.
It does not accept combined transition memory or release Phase 5.

Implementation status: implemented and reviewed. Before the live run, 118
targeted and existing separated tests passed on 2026-10-26. The single live
attempt stopped at the first 60-second deadline, with valid negative evidence
and normal cleanup. Details and limitations follow below.

## Fixed inputs and preparation

Reuse `artifacts/phase5-sampler-diagnostic-20261025/config.json`; copy it into
the new `artifacts/phase5-native-cadence-20261025/config.json` parent immediately
before launch. Do not rebuild. Both saved M/F preflight receipts and their
summary hashes must match, as must all 23 common sources, both binaries,
image ID, Windows/Node/WebView/Playwright environment. Added diagnostic source
hashes are recorded separately in the manifest's native-cadence paths.

- App SHA-256: `2e2911c3eb830fc8f207ce3c41852015417c75f1c34ed23f7f8dcab006772316`
- Adapter SHA-256: `09823dd5d51cd3b33f286540fe43a03570b3eee81497607a1b5b67336fcb754c`
- Preserved image: `sha256:7270e924b7597cbece5eb6886a47c3383502f31d8a253763774f3b8c6b4f810a`

Run from the existing `rust-phase-0` worktree, after computer-use availability
and review have been checked:

```powershell
node rust/tests/phase5/native-cadence/launch.mjs artifacts/phase5-native-cadence-20261025/run1 artifacts/phase5-native-cadence-20261025/config.json
```

An existing output directory, sibling log or launch receipt rejects launch.
Do not pick a new name to retry automatically. The launcher uses a hidden
Node process; its test app has a visible native window for observed interaction.

## Native input protocol

Preparation uses Playwright only to provision the local fixture, then disconnects
it. Restore the window through the initial native mailbox request; this is outside
the round timer but inside the 900-second global budget. After that, the first
round begins immediately. Each round includes selection, resize, reclaim,
connection selection, handoff, state/geometry verification, all 16 audits and
all 32 health queries. Its deadline is 60 seconds, without grace. Subsequent
rounds start no sooner than the previous start plus 60 seconds.

Use the diagnostic CLI, which reuses the existing mailbox publication format
and checks its expiry before accepting a completion:

```powershell
node rust/tests/phase5/native-cadence/ui.mjs peek artifacts/phase5-native-cadence-20261025/run1
node rust/tests/phase5/native-cadence/ui.mjs start artifacts/phase5-native-cadence-20261025/run1 REQUEST_ID
node rust/tests/phase5/native-cadence/ui.mjs check artifacts/phase5-native-cadence-20261025/run1 REQUEST_ID
node rust/tests/phase5/native-cadence/ui.mjs done artifacts/phase5-native-cadence-20261025/run1 REQUEST_ID observation.json
```

`observation.json` contains the fresh Computer Use screenshot ID and the observed
`selectedSession`, `targetConnection` or `windowMode` appropriate to the request.
Observe the exact returned Baton window, wait for `inputAllowed:true`, then
perform one observed UI input and refresh. Recheck permission immediately before
each input, including multi-step connection selection. A check is not a lease
for later actions. Do not publish a late receipt, resume stale input after an
interruption, use synthetic repeated input, or reconnect a debugger.

The clock conversion in this CLI uses the processes' monotonic clocks and their
recorded time origins. The runner is the authority for accepting receipts and
success; a stale client check cannot extend its deadline.

## Stop, cleanup and verification

The first deadline or action failure stops subsequent rounds. In-flight operations
are settled before cleanup. The pending UI permission is retired; fixture audit
files are then read without sending further terminal commands. Partial effects
and unfinished native requests remain in the raw evidence. Stop manually by
creating `run1/stop`; wait for `finishedUtc`, shutdown and cleanup records.

Once finished, run exactly once:

```powershell
node rust/tests/phase5/native-cadence/verify.mjs artifacts/phase5-native-cadence-20261025/run1
```

The verifier claims `cadence-verification.claim` exclusively and writes
`cadence-verification.json`, never an M/F/N `verified.json`. Missing mandatory
evidence yields `evidenceValid:false`. A fully recorded deadline failure can
have `evidenceValid:true` and `cadenceObserved:false`. Three verified rounds,
normal app exit, EOF from all 32 adapters and no owned remnants are required
for `cadenceObserved:true`. Short-run rates and memory samples are reported;
no two-hour memory verdict is evaluated.

If cleanup fails, inspect only the recorded owner label plus exact fixture
name/ID, and PID plus start identity, before removing any owned resource. Keep
the preserved image. Never infer cleanup success or automatically launch a
replacement run. `longRunReadiness:unproven`, `memoryAcceptance:not_evaluated`
and `phase5Acceptance:false` remain in every result.

## 2026-10-26 single live result

Evidence: `artifacts/phase5-native-cadence-20261025/run1`, execution commit
`a511479584ec12158a8d341dfc4da01fd4183b31`, owner
`ae90a3f3-ce19-435d-9844-fdbfd49863b6`. Launch UTC 03:41:12.482;
finished UTC 03:43:37.257. The independent verifier ran once, before any
post-run source edit. Its saved result is **evidenceValid=true,
completedRounds=0, cadenceObserved=false**, with no evidence errors.
Summary SHA-256: `520399762fbea3b1eac0a1fc8a7d55bf6a40cf51e2f30a2fa2643b3531fe38f2`.

The first round's deadline was observed after **60.0260851 seconds**. That
26.0851 ms detection overrun was not accepted as grace or a completed round.
Session selection completed 36.1783591 seconds after round start. The next
request was maximize/resize: the window was visibly maximized, but no completion
receipt was submitted before expiry. Its request is retained as
`native_abandoned`. No reclaim, connection selection, handoff, round audit or
round health completed; no later round started. All 16 audit files were captured
and had zero effects. No late input or completion receipt was sent.

Measurement lasted 67.2361246 seconds, including the initial OS sample before
round start. There were two natural samples at 7.206459 and 42.5083193 seconds;
largest boundary-inclusive gap was 35.3018603 seconds. Both had debugger
established=0 with matching process identities; forced GC/JS/raw CDP counts
were zero. Public output rates were 1144.474–1219.582 B/s. These short samples
are not a memory acceptance result.

Normal app exit and EOF32/32 were verified. Cleanup reported no forced action,
no failures, zero processes and zero containers remaining. An additional
read-only owner-label query returned no containers; the preserved image still
had the recorded ID. The verifier checked 29 sources (23 unchanged common
sources plus 6 diagnostic sources), two binaries, saved M/F preflight receipts
and environment identity. `completion-analysis.json` independently cross-checks
raw boundary arithmetic, rates, sample intervals, hashes and cleanup fields;
the verifier was not repeated.

### Operational limitations and post-run fix

This attempt includes model/tool round trips and two helper issues. An attempted
ESM import in the Computer Use REPL failed because that environment has no
`process` global; the existing shell CLI was then used. A `peek` between requests
also threw on null pending/active state. This was a read-only inspection failure,
not a granted input permission. No execution source was edited during the run.

After the final verification, the null-inspection bug was reproduced by a failing
unit test and fixed in `3e1de15`; the diagnostic unit suite passed 30/30. The old
`ui.mjs` is preserved as `ui-at-run.mjs`, whose hash matches the run manifest;
the run's original committed source remains at `a511479`. Current helper source
is therefore intentionally different from this historical run. No live rerun
was performed and the saved verdict was not overwritten.

The observation establishes only that this attempt did not meet one transition
per minute. It does not identify an app latency defect or prove that every native
automation method is too slow. Combined transition memory remains unverified;
the historical M/F/N evidence and Phase 5 release block remain unchanged.
