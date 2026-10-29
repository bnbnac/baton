# Baton Rust Phase 4 Offline Lifetime Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans, retaining the existing inline Native execution method. The user requested the next phase on 2026-10-09; the approved transition design already defines this behavior.

**Goal:** 앱이 없거나 종료·재실행돼도 MCP 초기화·목록·상태 조회를 유지하고 새 인증 연결로 복귀한다.

**Architecture:** AdapterLink에 단일 재연결 supervisor를 둔다. 도구 호출은 현재 연결의 snapshot만 사용하며 재시도하거나 저장하지 않는다. 기존 LocalClient의 단절 알림과 취소를 이용한다. 앱/SSH/UI 계약은 변경하지 않는다.

**Tech Stack:** 기존 Rust 1.88, Tokio, rmcp 3.4.0, Windows authenticated pipe. 새 라이브러리 버전 갱신 없음.

**Spec:** [승인된 설계 §§9–12](../specs/2026-09-20-rust-transition-design.md), [LIFE-01/02와 검증 범위](../specs/2026-09-20-rust-verification-design.md).

상태: 2026-10-09 구현·자동 검증·독립 리뷰 완료. Rust159/Node12 통과, 실제 하네스 인수 pending. [보고서](../../testing/rust-phase-4-report.md)를 따른다.

## Global Constraints

- 최초 접속은 MCP 초기화와 독립적으로 시작한다. 실패 후 1, 2, 4, 최대 5초 간격; 각 단계에 ±10% 지터, 최대 단계는 4.5–5초. 접속·인증 시도는 기존 3초 제한을 유지한다.
- 매 시도마다 발견 정보를 다시 읽는다. 인증/버전 오류는 offline으로 숨기지 않되 이후 새 endpoint가 정상화되면 복구한다.
- 단일 worker/단일 진행 접속. 성공하면 backoff 초기화. EOF/stop은 연결 중/대기 중 즉시 취소, 상주 worker 없음.
- 연결 ID/앱 instance/세션/입출력 캐시 재사용 금지. 미완료 입력은 uncertain, offline 입력은 app_offline, 이전 입력 재생 없음.
- 오래된 호출의 지연된 실패가 새 연결을 지우지 못하게 Arc identity로 compare-and-clear한다. 이전 연결의 늦은 성공 출력도 현재 연결로 오인해 반환하지 않는다.
- Windows fixture만 자동 변경. 실제 하네스 설정, 홈서버, Phase2 DPI·IME 재시험 및 보류한 Desktop/CLI 동시 시험은 건드리지 않는다. 실제 하네스 경고 확인은 pending으로 보고한다.
- 문서만 수정한 뒤 빌드·GUI 반복 없음. 실행 파일이 바뀌면 영향받는 실제 stdio/pipe/SSH 경계를 검증한다.

## Review Focus

1. 동시 호출의 오래된 오류가 새 연결을 지우거나 과거 성공 결과를 반환하는 경쟁.
2. 인증 실패/잘못된 버전에서 반복 접속이 busy loop 또는 오류 은폐를 일으키는 경우.
3. stdin EOF가 초기 handshake 또는 retry sleep 중 발생해 worker/IPC를 남기는 경우.
4. 반복 앱 재시작 중 요청이 새 endpoint로 재전송되는 경우.
5. 실행 중 endpoint 폐기·손상·복구와 다른 어댑터의 세션 독립성.

## Task 1: 연결 supervisor와 backoff

**Files:** `rust/crates/baton-adapter/src/{link,main,reconnect}.rs`, `src/lib.rs`, `Cargo.toml`; `rust/crates/baton-ipc/src/client.rs`; `rust/crates/baton-adapter/tests/stdio_online.rs`.

**Interfaces:** `AdapterLink::start(PathBuf) -> Self` 즉시 반환, `shutdown(&self).await`; `LocalClient::disconnected(&self).await`; `Backoff::next_delay()` 유한 지터. 기존 `call` tool interface 유지.

- [x] 기존 one-shot offline 시험을 자동 재발견 시험으로 변경하고 real stdio로 offline→online 새 ID를 기대한다. 변경 전 FAIL을 확인한다. backoff 범위/포화/reset 시험도 먼저 작성한다.
- [x] supervisor 구현, cancel-safe lifecycle, error 분류, compare-and-clear. 모델 검증 없이 사용자 재배정은 자동 수행하지 않는다.
- [x] adapter/IPC 시험과 fmt/clippy 실행. 실제 DPAPI는 사용자 security context에서 검증한다. `feat: reconnect Rust MCP adapters across app lifetime` 커밋.

## Task 2: 재시작·미완료 호출·EOF의 실제 통합 검증

**Files:** `rust/crates/baton-adapter/tests/{stdio_online,lifetime}.rs` 및 필요한 공통 fixture, `rust/tests/phase3/receipt.mjs`의 바뀐 계약 시험 이름.

**Interfaces:** Task1 공개 lifecycle, 실제 LocalServer endpoint와 adapter 자식 프로세스. 서버 fixture는 받은 요청/접속을 독립 계수한다.

- [x] 앱 재시작 3회 새 instance/connection·빈 세션, offline 입력 미전달, pending 입력 uncertain/재전송 없음, 인증·버전 오류 후 복구, retry 중 EOF, handshake stall 중 초기화/목록/status/EOF를 시험한다. 누락 동작 RED 후 수정한다.
- [x] 연결 epoch race는 단위 시험으로 오래된 client가 새 slot을 지우지 못함을 고정한다. 1/2/4/5 backoff와 상한은 결정적 시간/지터 입력으로 검사하고 실시간 offline 유지도 관측한다.
- [x] 관련 Rust suite와 실제 Phase3 Node stdio/SSH 통합을 실행해 연결 격리·개인 출력 회귀를 확인한다. UI source는 변경하지 않으므로 Phase2 물리 시험 반복 없음. `test: verify MCP lifetime and no replay across restart` 커밋.

## Task 3: 보고서·실행 안내와 최종 리뷰

**Files:** `docs/testing/rust-phase-4-report.md`, `docs/rust-harness-setup.md`, `docs/testing/rust-phase-4-manual.md`.

- [x] 실제 실행 명령·OS/SDK·통과/실패/skip·자식 종료를 기록한다. Phase3 원본 증거를 덮어쓰지 않는다. 실제 모델/하네스, 강제 앱 종료/OpenSSH 원격 비교/출시는 미검증 범위를 명시한다.
- [x] 자동 재연결 안내로 업데이트한다. 실제 하네스 경고와 도구 가용성 시험은 사용자가 설정한 단일 하네스에서 별도 관측하도록 구체적 절차를 적는다.
- [x] 한 번의 독립 전체 변경 리뷰와 중요한 지적 RED→GREEN 수정. fmt/clippy/영향 suite 통과 뒤 로컬 커밋. push/PR/merge는 별도 요청 범위다.
