# Rust Phase 5 core release verification plan

> Execute inline using superpowers:executing-plans. Continue the approved verification design; no new product behavior or approval flow.

**Goal:** Complete the 10,000-seed × 500-event model gate and 100 repetitions of the fixed-barrier race scenarios.
**Architecture:** Reuse the existing independent reference model and real async race tests. An opt-in `release-verification` Cargo feature enables the larger model test; ordinary test names and budgets remain unchanged. Execute optimized tests and preserve logs, command results, source hashes and elapsed time in a fresh artifact directory.
**Tech Stack:** Existing Rust/Cargo 1.88 and PowerShell. No new dependency.
**Spec:** `docs/superpowers/specs/2026-09-20-rust-verification-design.md` §3.

## Constraints and review focus

- Do not count model or actor tests as real SSH/UI, fuzz, soak, or process lifetime acceptance.
- Keep the existing model's independent oracle, coverage assertions and failure minimization. Exact 10,000 distinct seeds and 500 events each; retain failing seed and minimized sequence in the log.
- Run all existing race scenarios 100 times; retain failures and stop on the first failure instead of retrying it away.
- The opt-in feature must affect only test inclusion, not production core behavior. Normal verification remains 1,000 × 200.
- Preserve earlier evidence and unresolved startup failure/release block. No new ZIP, push or release.

## Tasks

1. [x] Extract the existing model loop into a parameterized test helper without changing its oracle. Keep the original baseline test and add the explicit release-only test.
2. [x] Run optimized core suite including the 5,000,000-event test, verify coverage and no skipped tests. Run the optimized race suite 100 times and record each exit/result.
3. [x] Check fmt/clippy, review the small change once, record scope and limitations in a report, and commit locally.

## Ledger

Base `5ae72b5`. Pre-flight: only shared interface is the model helper reused by the two test budgets; the baseline runner's test name and output must remain unchanged.
Ruling: use a test-only opt-in Cargo feature rather than an ignored test or global environment override, so regular verification retains its no-skips rule and usual budget. Cost: release validation must explicitly pass the feature flag.
Ruling: use existing race tests unchanged and repeat their optimized test binary through Cargo; this adds release evidence without rewriting already-validated barrier logic. It cannot prove every possible scheduling order.

Completed 2026-10-14: optimized core 105/0/0, release model 5,000,000 events, races 17×100 with 100 clean exits. fmt/clippy passed; 36 source hashes match. Independent narrow review completed after the initial usage-limit failure, no actionable findings. Full report: `docs/testing/rust-phase-5-core-release-report.md`. No product fix, so no new RED claim. Remaining Phase 5 gates and startup block retained.
