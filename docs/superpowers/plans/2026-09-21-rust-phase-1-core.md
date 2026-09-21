# Baton Rust Phase 1 Session Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 SSH 서버 없이 소유권 전환, 입력의 중복 방지, 공개 출력의 경계 및 비동기 경쟁을 검증할 수 있는 `baton-core`를 만든다.

**Architecture:** 세션별 동기 상태 머신이 권한·큐·공개 구간을 결정하고, 얇은 Tokio 실행기가 transport 작업과 타이머를 연결한다. 전송을 기다리는 동안 상태 머신을 잠그지 않는다. SSH·Tauri·MCP는 이후 단계에서 이 코어에 연결하며, 참조 모델은 제품 상태 머신을 사용하지 않는다.

**Tech Stack:** Rust edition 2024 / rust-version 1.88, 기존 Cargo.lock의 Tokio와 serde/serde_json. 제품 코어에는 russh·rmcp·Tauri·xterm 의존성을 넣지 않는다. 모델 생성기는 시험 전용 결정적 PRNG를 사용한다.

**Spec:** [구조 설계](../specs/2026-09-20-rust-transition-design.md), [검증 기준](../specs/2026-09-20-rust-verification-design.md), [단계 0 관측 결과](../../testing/rust-phase-0-report.md).

상태: 2026-09-21 작성, 사용자 검토 대기. 구현 체크박스는 미수행이다. 기존 실행 방식 **Native**를 유지한다. 이 문서는 제품 구현에 착수한 기록이 아니다.

## Global Constraints

- Windows 먼저 검증·배포하고 macOS/Linux는 해당 OS에서 실제 검증한 뒤 순차 지원한다. 코어에 Windows 전용 타입을 넣지 않는다.
- 연결 / SSH 세션: 앱당 32 / 16.
- 일반 입력: UTF-8 16 KiB, 셸별 대기 32건. in-flight 쓰기는 별도 최대 1건이다.
- 요청 중복 이력: 셸·control_epoch별 4096건, 소진 시 새 입력 거부. 자동 회수로 초기화하지 않음.
- 공개 출력: 셸당 1 Mi UTF-16 단위, 조회 2–32768단위.
- 읽기 대기: 0–10000ms, 연결당 대기 read 최대 8개.
- IPC: frame 256 KiB, 연결당 진행 요청 16개. 실제 wire 검증은 단계 3 담당이다.
- UI 미확인 출력: 셸당 코어 1 MiB, xterm으로 한 번에 넘기는 미확인 바이트 64 KiB. 코어의 바이트 예산은 이번 단계, xterm의 소비는 단계 2 담당이다.
- epoch·cursor·sequence: 0부터 2^53−1 범위의 정수. 상한 초과 증가 시 명시적 종료, 순환 금지.
- 전환 장벽 5초, 앱 정상 종료 정리 최대 5초. 원격 명령 완료를 기다리거나 자동 Ctrl+C를 보내지 않는다.
- 연결당 복수 셸, 셸마다 독립 SSH 연결. 같은 서버의 파일·DB 자원 격리는 보장하지 않는다.
- connection_id는 인증된 호출 문맥에서 가져온다. 도구 payload와 UI의 활성 탭으로 권한을 결정하지 않는다.
- 이미 시작한 쓰기의 취소·단절은 rollback이 아니다. `delivered`는 transport 전달이며 명령 완료가 아니다. 불확실 입력은 자동 재전송하지 않는다.
- 전환 시작 즉시 양측 일반 입력과 이전 읽기를 막는다. 새 공개 구간은 전달 완료 시 시작한다.
- 사용자 화면용 바이트와 MCP 공개 문자열은 별도 경로다. 화면·스크롤백에서 공개 출력을 만들지 않는다.
- 비밀번호·키·MFA·사용자 터미널 원문·원문 예외를 파일이나 진단 로그에 기록하지 않는다. 시험 데이터는 합성 표식만 사용한다.
- C# `src/`, `tests/`, `build.cmd`와 기존 사용자 환경·하네스 설정을 변경하지 않는다. 사용자 서버에 연결하지 않는다.
- force push 금지, PR 병합은 squash. 이 계획 실행 자체는 push·병합을 포함하지 않는다.

## Review Focus

1. transport 대기열에 넣기만 한 입력을 이미 전송한 것으로 오인하면 회수 후 전송될 수 있다 — Task 3·5의 쓰기 시작 장벽 양쪽 시험.
2. 동일 request_id에 무수히 많은 호출을 붙이면 입력 수보다 대기 객체가 커질 수 있다 — Task 3·5에서 공유 결과 슬롯과 호출 상한 시험.
3. 비공개 구간 끝의 UTF-8 일부 바이트가 다음 공개 구간과 합쳐질 수 있다 — Task 4의 모든 바이트 분할·재전달 시험.
4. read가 깨어난 후 반환하기 전에 회수되거나 같은 연결로 재전달될 수 있다 — Task 5의 최종 권한 검사 장벽 시험.
5. 이전 어댑터 단절과 회수 완료가 경합하면 사용자가 회수한 셸까지 닫힐 수 있다 — Task 2·5의 사건 순서별 시험.

## 단계별 통과 기준 정정

단계 0 자동 시험 73개 통과는 해당 기술 경계의 관측이다. 실제 키·붙여넣기·IME·마우스·숨김/최소화와 WebView 하위 프로세스 종료는 여전히 미확인이다. 기존 runner의 종료 코드 2와 blocked 기록을 성공으로 바꾸지 않는다.

이 미확인은 SDK와 무관한 단계 1 계획·코어 구현의 선행 조건에서 분리한다. 실제 UI 조작 및 WebView 종료는 **단계 2 완료 조건**, 앱·어댑터 전체 수명은 **단계 4**, 배포본 재검증은 **단계 5**에 남긴다. 이후 해당 계획에 시험 ID·담당 파일·실행 환경을 반드시 넣는다. 단계 1 통과로 이 항목이나 Rust 전체 인수를 완료 표시하지 않는다.

이번 범위는 OWN-01~05, IN-01~03, OUT-01~05의 코어 부분, NUM-01, LIFE-02/UI-03의 코어 부분이다. 실제 IPC frame·MCP 직렬화는 단계 3, ID 난수 발급·재접속은 단계 3~4, resize·프로토콜 자동 응답·실제 인증은 단계 2, 개입 요청/sudo UX는 단계 3이다. 코어에 임시 무권한 resize/응답 API를 만들지 않는다.

## 파일 구조와 공통 인터페이스

모든 경로는 저장소 루트 기준이다. 아직 없는 파일은 구현 시 생성한다.

| 파일 | 책임 |
|---|---|
| `rust/Cargo.toml`, `rust/Cargo.lock` | 제품 코어를 기존 workspace에 추가, 의존성 고정 |
| `rust/crates/baton-core/Cargo.toml`, `src/lib.rs` | crate 및 공개 타입 export |
| `rust/crates/baton-core/src/types.rs`, `src/limits.rs` | 불투명 ID, 안전 정수, 오류, 고정 상한 |
| `rust/crates/baton-core/src/registry.rs` | 연결·세션 등록, 배정별 조회, 단절·앱 종료 |
| `rust/crates/baton-core/src/session.rs` | 상태, epoch, 전환, 수신 사건의 직렬 경계 |
| `rust/crates/baton-core/src/input.rs` | 32건 큐, in-flight 1건, 중복 이력과 결과 |
| `rust/crates/baton-core/src/output.rs` | 증분 UTF-8 decoder, UTF-16 cursor ring |
| `rust/crates/baton-core/src/ui_output.rs` | 순서 있는 원본 바이트와 ack 예산 |
| `rust/crates/baton-core/src/runtime.rs` | bounded 채널, 읽기 대기, 쓰기/닫기 작업, 가상 시계 지원 |
| `rust/crates/baton-core/tests/{numbers,ownership,input,output,races,model}.rs` | 계약별 단위·통합 시험 |
| `rust/crates/baton-core/tests/support/{mod,fixture,transport,reference,generator}.rs` | 결정적 ID, 외부 송신 관측, 독립 참조 모델 |
| `rust/scripts/verify-phase-1.ps1`, `rust/scripts/test-core-mutants.ps1` | 시험 목록·변이·실패 상태 수집 |
| `docs/testing/rust-phase-1-report.md` | 구현 후 실제 결과와 남은 인수 항목 |

다음 타입·메서드 이름을 Task 사이 계약으로 사용한다. 구현은 private 필드를 기본으로 하고 검증을 건너뛰는 public setter를 제공하지 않는다.

```rust
// types.rs: 각각 Copy + Eq + Ord + Hash + Debug인 별도 newtype.
// AppId, ConnectionId, SessionId, StreamId, RequestId: 내부 u128.
// from_u128(u128) -> Self 는 신뢰된 앱 조립/시험용이다. wire 파서는 단계 3.
// ID 자체의 소지가 인증은 아니다. ConnectionId는 인증 IPC 문맥이 공급한다.
pub struct SafeInt(u64);
impl SafeInt {
    pub const MAX: u64 = (1_u64 << 53) - 1;
    pub fn new(value: u64) -> Result<Self, CoreError>;
    pub fn get(self) -> u64;
    pub fn checked_next(self) -> Result<Self, CoreError>;
}
pub enum State { Connecting, UserOwned, Transferring, AgentOwned, Reclaiming, Closed }
pub enum InputResult { Pending, Delivered, InputInvalidated, Uncertain }
pub enum WriteResult { Delivered, Uncertain }
pub enum Principal { User, Agent(ConnectionId) }
pub enum CloseReason { User, TransportLost, ConnectionLost, AppExit, TransitionTimeout,
    CounterExhausted, OutputOverload, FrontendLost }
pub enum CoreError { NotOwner, SessionClosed, ControlUnavailable, StaleControlEpoch,
    StaleStream, RequestIdConflict, InputTooLarge, InputQueueFull, RequestHistoryFull,
    InvalidNumber, CounterExhausted, InvalidCursor, CursorExpired { oldest: SafeInt },
    InvalidLimit, ReadLimit, RequestLimit, Busy, Capacity, DuplicateId, UnknownId,
    InvalidAck, InvalidCompletion }
pub struct InputCall {
    pub principal: Principal, pub epoch: SafeInt, pub request_id: RequestId,
    pub payload: Vec<u8>,
}
pub struct ReadCall {
    pub connection: ConnectionId, pub epoch: SafeInt, pub stream: StreamId,
    pub cursor: SafeInt, pub limit: usize,
}
pub struct ReadPage {
    pub text: String, pub next: SafeInt, pub oldest: SafeInt,
    pub end: SafeInt, pub has_more: bool,
}
pub struct Snapshot {
    pub state: State, pub epoch: SafeInt, pub assigned: Option<ConnectionId>,
    pub stream: Option<StreamId>,
}
pub struct WriteOp { pub id: SafeInt, pub payload: Vec<u8> }
pub struct UiChunk { pub seq: SafeInt, pub bytes: Vec<u8> }
pub struct Usage {
    pub queued: usize, pub active: usize, pub history: usize,
    pub input_bytes: usize, pub public_units: usize, pub ui_bytes: usize,
}
```

`SafeInt`는 Copy이며 serde의 정수 visitor로 역직렬화한다. 음수·float·문자열은 거부하며 f64로 변환해서 검사하지 않는다. 값 타입과 enum들은 시험의 직접 비교에 필요한 Clone/Eq/PartialEq/Debug를 제공한다. 세션/읽기 결과에는 원문 오류·인증정보를 추가하지 않는다. 예제의 `use baton_core::*`, `use std::time::Duration`, `mod support; use support::*`는 해당 시험 파일 상단에서 선언한다.

ID 발급은 코어의 권한 판단과 분리한다. 이번 시험의 `Ids`는 1부터 checked 증가하는 u128을 위 newtype으로 감싼다. 실제 앱의 CSPRNG 발급기는 단계 3 조립 범위이며, 외부 요청의 ID를 발급값으로 재사용하지 않는다. 코어는 현재 등록된 중복 ID를 거부한다. 과거 ID 전체를 무한 tombstone 목록으로 저장하지 않는다. 재접속 ID 재사용 방지의 실제 발급 시험은 단계 4에서 수행한다.

오류 우선순위는 존재/배정 확인 → Closed → 현재 입력 권한 상태 → epoch → stream/read cursor → payload·용량이다. 이전 연결에는 남의 Closed 여부·cursor·출력을 노출하지 않는다. 같은 소유권으로 재전달한 뒤 옛 epoch는 `StaleControlEpoch`; 현재 epoch에서 옛 stream은 `StaleStream`이다.

## Task 1: 안전 정수와 등록 경계를 가진 코어 crate

**Files:** Create `rust/crates/baton-core/Cargo.toml`, `src/{lib,types,limits,registry}.rs`, `tests/numbers.rs`, `tests/support/{mod,fixture}.rs`. Modify `rust/Cargo.toml`, `rust/Cargo.lock`.

**Interfaces:** 위 공통 타입을 생성한다. `Registry::new(app: AppId) -> Registry`, `register_connection(id: ConnectionId) -> Result<(), CoreError>`, `remove_connection(id: ConnectionId) -> Result<(), CoreError>`. Task 2에서 세션 보관을 추가한다. `tests/support/fixture.rs`의 `Ids::new() -> Ids`, `app/connection/session/stream/request(&mut self) -> 해당 ID 타입`은 하나의 checked counter를 공유한다.

- [ ] **Step 1: 정수 경계와 32/33번째 연결의 실패 시험을 작성한다.**

```rust
#[test]
fn safe_numbers_reject_before_rounding() {
    for json in ["-1", "1.5", "9007199254740992", "\"1\"", "1e0"] {
        assert!(serde_json::from_str::<SafeInt>(json).is_err(), "{json}");
    }
    let n: SafeInt = serde_json::from_str("9007199254740991").unwrap();
    assert_eq!(n.get(), SafeInt::MAX);
    assert_eq!(n.checked_next(), Err(CoreError::CounterExhausted));
}
```

같은 파일에서 0 허용, u64::MAX 거부, 중복 등록의 슬롯 소비 0, 32개 등록 후 33번째 `Capacity`, 한 연결 제거 후 새 ID 등록 성공을 검사한다.

- [ ] **Step 2: RED를 확인한다.** crate를 workspace에 등록하고 선언만 둔 뒤 `cargo +stable test --manifest-path rust/Cargo.toml -p baton-core --test numbers` 실행. 첫 실패가 새 타입/메서드 부재인지 확인한다. 네트워크·환경 오류는 RED 증거로 세지 않는다.
- [ ] **Step 3: 정수와 용량 검사를 구현한다.** 기존 lockfile 버전의 `serde` derive, `serde_json`, Tokio `sync,time,rt,macros`를 사용한다. Tokio `test-util,rt-multi-thread`는 dev-dependency features로 추가한다. ID 생성에 네트워크·플랫폼·SDK 의존성을 추가하지 않는다.

```rust
pub fn checked_next(self) -> Result<Self, CoreError> {
    self.0.checked_add(1).filter(|n| *n <= Self::MAX)
        .map(Self).ok_or(CoreError::CounterExhausted)
}
```

상한 검사는 삽입 전에 수행한다. 예상된 capacity 오류가 기존 연결을 제거하지 않아야 한다. 의존성 갱신 diff가 기존 probe 버전을 올리면 원인을 해결하고 해당 갱신을 제외한다.

- [ ] **Step 4: GREEN을 확인한다.** 위 시험을 `--locked`로 실행하고 `cargo +stable tree --manifest-path rust/Cargo.toml -p baton-core`에서 SDK 의존성 부재를 확인한다.
- [ ] **Step 5: 커밋한다.** `git add rust/Cargo.toml rust/Cargo.lock rust/crates/baton-core` 후 `git commit -m "feat: add bounded Rust core identities and numbers"`.

## Task 2: 세션 상태·배정·전환의 직렬 경계

**Files:** Create `src/session.rs`, `tests/ownership.rs`. Modify `src/{lib,registry}.rs`, `tests/support/fixture.rs` (모두 `rust/crates/baton-core/` 하위).

**Interfaces:**

```rust
impl Session {
    pub fn new(id: SessionId) -> Self; // Connecting, epoch 0
    pub fn connected(&mut self) -> Result<(), CoreError>; // UserOwned
    pub fn snapshot(&self) -> Snapshot;
    pub fn handoff(&mut self, to: ConnectionId, stream: StreamId,
                   now: std::time::Duration) -> Result<(), CoreError>;
    pub fn reclaim(&mut self, now: std::time::Duration) -> Result<(), CoreError>;
    pub fn tick(&mut self, now: std::time::Duration);
    pub fn close(&mut self, reason: CloseReason);
    pub fn status_for(&self, connection: ConnectionId) -> Result<Snapshot, CoreError>;
}
impl Registry {
    pub fn insert_session(&mut self, session: Session) -> Result<(), CoreError>;
    pub fn session(&self, id: SessionId) -> Result<&Session, CoreError>;
    pub fn session_mut(&mut self, id: SessionId) -> Result<&mut Session, CoreError>;
    pub fn status_for(&self, connection: ConnectionId) -> Result<Vec<(SessionId, Snapshot)>, CoreError>;
    pub fn handoff(&mut self, id: SessionId, to: ConnectionId, stream: StreamId,
                   now: std::time::Duration) -> Result<(), CoreError>;
    pub fn disconnect(&mut self, id: ConnectionId);
    pub fn close_all(&mut self, reason: CloseReason);
    pub fn forget_closed(&mut self, id: SessionId) -> Result<(), CoreError>;
}
```

Registry가 연결 존재 검사를 담당한다. 직접 Session 사용은 신뢰된 앱 내부/시험용이며 IPC에 노출하지 않는다. `forget_closed`는 사용자에 의한 닫힌 카드 제거에 대응하며 Closed 이외에는 `Busy`; 등록 세션 16개 한도는 아직 제거되지 않은 닫힌 카드도 포함한다. 이 정책을 제품 UI에서 명시한다.

- [ ] **Step 1: 전달→회수→다른 연결 재전달의 시험을 작성한다.**

```rust
#[test]
fn reassignment_revokes_old_owner_and_changes_stream() {
    let mut ids = Ids::new();
    let (a, b) = (ids.connection(), ids.connection());
    let (first, second) = (ids.stream(), ids.stream());
    let mut s = Session::new(ids.session());
    s.connected().unwrap();
    s.handoff(a, first, Duration::ZERO).unwrap();
    let epoch = s.snapshot().epoch;
    s.reclaim(Duration::ZERO).unwrap();
    assert_eq!(s.snapshot().state, State::UserOwned);
    s.handoff(b, second, Duration::ZERO).unwrap();
    assert!(s.snapshot().epoch.get() > epoch.get());
    assert_eq!(s.status_for(a), Err(CoreError::NotOwner));
    assert_eq!(s.status_for(b).unwrap().stream, Some(second));
}
```

추가 시험: A의 3셸/B의 1셸 목록 격리, 16/17 경계, Connecting 실패 후 close, Closed 재연결/전달 거부, 중복 close 멱등성, epoch 최대에서 전환 시 Closed. 최대 epoch 주입은 `session.rs` 내부 `#[cfg(test)]` 시험으로만 한다.

- [ ] **Step 2: RED 확인.** `cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core --test ownership`.
- [ ] **Step 3: 전환을 한 메서드 경계에서 직렬 처리한다.**

```text
handoff accepted: epoch++ → Transferring → 이전 I/O 무효화 → 배정 교체
no active write: 새 stream/decoder → AgentOwned
reclaim accepted: epoch++ → Reclaiming → 이전 I/O 무효화 → 공개 버퍼 폐기
no active write: UserOwned (이전 배정은 상태 표시에 유지)
active write exists: deadline=now+5초, 완료 또는 timeout까지 전환 상태 유지
```

이번 Task에는 active write가 없으므로 전환이 같은 호출에서 완료된다. Task 3이 장벽을 연결한다. 반복 회수·전달은 전환 중 `Busy`이며 epoch를 또 증가시키지 않는다. 다른 연결로 재전달은 UserOwned에서만 허용한다.

`disconnect(A)` 사건: AgentOwned(A)는 close, UserOwned(assigned A)는 배정만 해제, Reclaiming(from A)는 사용자 회수 장벽을 계속 진행하고 이전 배정만 해제, Transferring(to A)는 close. 전환 전에 A 단절을 처리해 이미 Closed라면 회수가 살리지 못한다. 다른 연결 세션에는 영향이 없다. 앱 close는 모든 상태에서 종료 요청을 받는다.

- [ ] **Step 4: GREEN 및 사건 순서 검증.** 동일 시험 명령을 실행한다. `reclaim→disconnect`와 `disconnect→reclaim` 양쪽을 별도 assertion으로 고정하고 종료된 셸·보존된 셸 목록을 직접 비교한다.
- [ ] **Step 5: 커밋한다.** `git add rust/crates/baton-core` 후 `git commit -m "feat: model session ownership and control transitions"`.

## Task 3: 입력 큐·중복 방지·전송 결과

**Files:** Create `src/input.rs`, `tests/input.rs`. Modify `src/{session,lib}.rs`, `tests/support/fixture.rs`.

**Interfaces:** `Session::submit(&mut self, call: InputCall) -> Result<InputResult, CoreError>`, `input_result(&self, principal: Principal, epoch: SafeInt, id: RequestId) -> Result<InputResult, CoreError>`, `start_write(&mut self) -> Option<WriteOp>`, `finish_write(&mut self, id: SafeInt, result: WriteResult) -> Result<(), CoreError>`, `cancel_input(&mut self, principal: Principal, epoch: SafeInt, id: RequestId) -> Result<InputResult, CoreError>`, `usage(&self) -> Usage`. `WriteOp.id`는 세션 수명 전체에서 증가하며 epoch 변경으로 재사용하지 않는다. Usage의 출력 카운터는 Task 4에서 연결한다.

- [ ] **Step 1: 대기 입력은 무효화되고 이미 시작한 입력만 결과를 기다리는 시험을 작성한다.** `tests/support/fixture.rs`에 `agent_session() -> (Session, ConnectionId, SafeInt, StreamId)`와 `agent_call(connection, epoch, id, bytes: &[u8]) -> InputCall`을 정의한다. 전자는 새 연결 ID·세션·stream으로 연결/전달을 완료한다. 후자는 전달받은 값만 복사한다.

```rust
#[test]
fn reclaim_invalidates_unstarted_input() {
    let (mut s, a, epoch, _) = agent_session();
    let mut ids = Ids::new();
    let (one, two) = (ids.request(), ids.request());
    s.submit(agent_call(a, epoch, one, b"FIRST")).unwrap();
    s.submit(agent_call(a, epoch, two, b"SECOND")).unwrap();
    let active = s.start_write().unwrap();
    assert_eq!(active.payload, b"FIRST");
    s.reclaim(Duration::ZERO).unwrap();
    assert_eq!(s.snapshot().state, State::Reclaiming);
    assert!(s.start_write().is_none());
    s.finish_write(active.id, WriteResult::Delivered).unwrap();
    assert_eq!(s.snapshot().state, State::UserOwned);
    assert!(s.start_write().is_none());
    assert_eq!(s.input_result(Principal::Agent(a), epoch, two),
               Err(CoreError::ControlUnavailable));
}
```

input 내부 단위 시험에서는 two의 저장 결과가 InputInvalidated인지도 확인한다. 공개 API에서는 이전 권한으로 저장 결과를 조회할 수 없다.

- [ ] **Step 2: RED 확인.** `cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core --test input`.
- [ ] **Step 3: 검증·예약·큐 추가·쓰기 시작·완료를 분리해 구현한다.**

```text
submit: 권한/epoch → payload 길이 → 기존 request_id 비교 → queue/history 용량 → 등록
duplicate same payload: 같은 Pending/최종 결과 반환, queue/history 추가 0
duplicate different payload: RequestIdConflict, 효과 0
start_write: 현재 상태 허용 + active 없음 → queue pop → active 지정 → WriteOp 반환
finish_write: 현재 active.id 일치 → 결과 저장 → active 제거 → 전환 장벽 완료 검사
```

동일 payload 비교는 원본 바이트까지 비교한다. 해시 일치만으로 같다고 하지 않는다. 이력은 최대 4096×16KiB payload와 유한 메타데이터를 보관하는 초기 상한이며, 입력 상한과 함께 메모리 비용을 보고서에 기록한다. 이력 가득 참을 자동 회수로 해결하지 않는다. 명시적 사용자 전환으로 epoch가 바뀌면 이전 이력은 보안상 조회 불가이며, active 결과 처리를 제외하고 해제한다.

중복 호출당 waiter Vec를 추가하지 않는다. 상태 슬롯 하나를 조회하게 하고 대기는 Task 5의 연결별 요청 상한 안에서 처리한다. 취소된 대기 항목은 `InputInvalidated`; 시작한 항목은 `Pending`을 유지하고 실제 종료 결과만 저장한다. 5초 전환 timeout에서는 active를 `Uncertain`으로 끝내고 close; 늦은 completion은 `InvalidCompletion`, 쓰기 재시작 0이다. 중복 completion도 거부한다.

- [ ] **Step 4: GREEN과 경계 표를 검사한다.**

| 시험 | 반드시 관측할 값 |
|---|---|
| 같은 ID 100회/내용 충돌 | WriteOp 1건/충돌 추가 송신 0 |
| 16KiB / +1, queue 32 / 33, history 4096 / 4097 | 한도까지 허용/초과 등록·할당·송신 0 |
| 대기 취소/시작 후 취소/완료 후 취소 | Invalidated/Pending/저장 최종 결과 |
| partial write·단절 | Uncertain, 새 request_id로 자동 재생 0 |
| 전환 직전·직후 입력 및 옛 epoch 재사용 | 미시작 효과 0, 옛 결과 조회 거부 |
| 4999ms / 5000ms / 늦은 완료 | 장벽 유지/Closed/재활성화 0 |
| WriteOp seq 최대 | 명시적 Closed, 순환·송신 0 |

거부로 인해 새 payload 복사가 발생하지 않는지 내부 슬롯/보관 바이트 카운터로 확인한다. API 진입 전 IPC 파서 메모리는 단계 3에서 검사한다.

- [ ] **Step 5: 커밋한다.** `git add rust/crates/baton-core` 후 `git commit -m "feat: serialize input delivery and invalidate stale writes"`.

## Task 4: 공개 decoder·UTF-16 ring·UI 바이트 예산

**Files:** Create `src/{output,ui_output}.rs`, `tests/output.rs`. Modify `src/{session,lib}.rs`.

**Interfaces:**

```rust
impl PublicOutput {
    pub fn new(capacity_units: usize) -> Result<Self, CoreError>; // 2..=1Mi
    pub fn receive(&mut self, bytes: &[u8]) -> Result<(), CoreError>;
    pub fn read(&self, cursor: SafeInt, limit: usize) -> Result<ReadPage, CoreError>;
}
impl Session {
    pub fn receive(&mut self, bytes: &[u8]) -> Result<(), CoreError>;
    pub fn read(&self, call: &ReadCall) -> Result<ReadPage, CoreError>;
    pub fn next_ui_chunk(&mut self) -> Option<UiChunk>;
    pub fn ack_ui(&mut self, seq: SafeInt) -> Result<(), CoreError>;
}
```

- [ ] **Step 1: 모든 분할 위치에서 같은 문자열과 cursor가 나오는 시험을 작성한다.**

```rust
#[test]
fn all_utf8_splits_keep_utf16_cursor() {
    let bytes = "한😀글".as_bytes();
    for split in 0..=bytes.len() {
        let mut out = PublicOutput::new(32).unwrap();
        out.receive(&bytes[..split]).unwrap();
        out.receive(&bytes[split..]).unwrap();
        let page = out.read(SafeInt::new(0).unwrap(), 32).unwrap();
        assert_eq!(page.text, "한😀글");
        assert_eq!(page.next.get(), 4);
        assert_eq!(out.read(SafeInt::new(2).unwrap(), 32), Err(CoreError::InvalidCursor));
    }
}
```

- [ ] **Step 2: RED 확인.** `cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core --test output`.
- [ ] **Step 3: decoder와 ring을 구현하고 상태 수신 경로에 연결한다.**

```text
증분 decoder: str::from_utf8에서 유효 prefix 처리
error_len=Some(n): invalid 부분 n bytes당 U+FFFD 하나, 다음 바이트 계속 처리
error_len=None: 최대 3 bytes만 decoder carry에 남김
stream 폐기/Closed: carry 폐기, 다음 stream으로 이월 0
ring: char 단위 보관, 각 char의 len_utf16()만큼 cursor 증가
초과: 가장 오래된 char 전체를 제거, oldest를 같은 단위로 증가
```

chunk 경계가 잘못된 UTF-8의 replacement 개수를 바꾸지 않도록 carry와 새 chunk를 합친 작은 prefix부터 처리한다. 전체 입력 chunk를 무제한 복사하지 않는다. cursor가 oldest 미만이면 `CursorExpired`, end 초과 또는 surrogate 중간이면 `InvalidCursor`. page 마지막 char가 limit를 넘으면 다음 page로 보낸다. 2단위 최소 limit로 emoji만 있는 경우에도 진행된다. carry를 포함한 완료되지 않은 바이트는 read text에 나타나지 않는다.

`Session::receive`는 먼저 UI 예산과 seq 증가 가능성을 확인한다. UserOwned/전환 중에도 UI bytes는 순서대로 보관하지만 public에는 AgentOwned일 때만 넣는다. 회수 시 공개 버퍼·decoder를 폐기하고 전달 완료 시 새로 생성한다. Closed에서는 어느 경로에도 추가하지 않는다.

UI bytes는 최대 64KiB chunk로 나누며 보관+in-flight 총 1MiB, 동시에 미확인 64KiB 이하만 넘긴다. ack는 전송된 연속 선두 seq만 수락하고 재생/미래 ack는 `InvalidAck`다. 분할에 필요한 총 seq와 예산을 수신 전에 확인한다. 초과 시 해당 세션을 `OutputOverload`/`CounterExhausted`로 닫고 정상 입력을 이어가지 않는다.

- [ ] **Step 4: GREEN과 공개 경계 시험을 실행한다.**

| 시험 | 관측 |
|---|---|
| private P → handoff → public Q → reclaim → private R → rehandoff | UI=PQR, MCP 각 stream에 Q 또는 빈 값만 |
| 재전달 뒤 P를 새로 수신 | 새 public에 P 허용; 저장 UI 기록 복사 없음 |
| UTF-8 각 split에서 private prefix/public suffix | 이전 carry 결합 0, 새 stream decoder 규칙대로 replacement |
| invalid continuation/overlong/truncated/ANSI, 전 바이트 split | 분할과 무관한 결과, ANSI는 문자열 데이터 |
| capacity 2에 emoji+A, 오래된/미래/중간 cursor | scalar 보존, expired/invalid 구분, 페이지 이어붙임 일치 |
| UI 1MiB / +1, ack replay/미래 seq | 상한 준수/해당 셸 종료, 다른 세션 유지 |
| 공개 cursor/UI seq 최대 | Closed, wrap 0 |

JSON frame 전체 제한은 단계 3에서 최악의 escape expansion과 envelope를 함께 검사한다. 이번 단계의 문자열 상한을 wire 제한 통과라고 표시하지 않는다.

- [ ] **Step 5: 커밋한다.** `git add rust/crates/baton-core` 후 `git commit -m "feat: separate public output from bounded UI delivery"`.

## Task 5: 실제 async 실행기와 전환·읽기 경쟁

**Files:** Create `src/runtime.rs`, `tests/races.rs`, `tests/support/transport.rs`. Modify `src/{lib,registry,session}.rs`, `tests/support/{mod,fixture}.rs`.

**Interfaces:** `Runtime::spawn(registry: Registry) -> Runtime`, `Runtime::attach(&self, id: SessionId, transport: Box<dyn Transport>) -> Result<SessionHandle, CoreError>`, `Runtime::disconnect(&self, id: ConnectionId)`, `Runtime::shutdown(&self)`. 뒤 두 메서드는 async이며 shutdown은 정리 완료까지 최대 5초다. Registry는 런타임 내부 `Arc<std::sync::Mutex<Registry>>`에 보관한다. 각 세션의 실행기와 transport worker가 이 짧은 상태 잠금을 start gate로 공유하며 상태를 복제해 별도 보관하지 않는다. 잠금 안에서는 bounded 상태 처리만 하고 I/O 대기는 잠금 밖에서 한다. 한 세션에 중복 attach는 Busy다.

```rust
pub type IoFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;
pub trait Transport: Send + 'static {
    fn write<'a>(&'a mut self, bytes: &'a [u8]) -> IoFuture<'a, WriteResult>;
    fn close(&mut self) -> IoFuture<'_, ()>;
}
// SessionHandle의 모든 변경/조회는 actor 메시지다.
impl SessionHandle {
    pub async fn submit(&self, call: InputCall) -> Result<InputResult, CoreError>;
    pub async fn cancel_input(&self, principal: Principal, epoch: SafeInt,
                              id: RequestId) -> Result<InputResult, CoreError>;
    pub async fn read(&self, call: ReadCall, wait_ms: u32) -> Result<ReadPage, CoreError>;
    pub async fn reclaim(&self) -> Result<(), CoreError>;
    pub async fn handoff(&self, to: ConnectionId, stream: StreamId) -> Result<(), CoreError>;
    pub async fn close(&self, reason: CloseReason);
    pub async fn receive(&self, bytes: Vec<u8>) -> Result<(), CoreError>;
    pub async fn snapshot(&self) -> Snapshot;
}
```

read future drop은 대기를 취소한다. 입력 수락 응답 전 future drop은 요청별 취소 플래그를 세워 start gate에서 확인한다. 수락 응답 후 취소는 `cancel_input`으로 전달한다. submit은 큐 수락 시 Pending을 반환하고 완료 상태는 Session의 input_result에 대응하는 actor 조회로 제공한다: `SessionHandle::input_result(&self, principal: Principal, epoch: SafeInt, id: RequestId) -> Result<InputResult, CoreError>` (async). 이 Pending은 코어 내부 계약이며 단계 3 MCP가 최종 전송 결과를 기다리는 동안 취소를 연결해야 한다. 송신 상태를 원격 명령 실행 완료로 반환하지 않는다.

`tests/support/transport.rs`: `FaultTransport`는 `Transport`를 구현한다. `TransportAudit`의 `started: Vec<Vec<u8>>, completed: Vec<WriteResult>, closes: usize`를 Arc<Mutex<_>>로 공유한다. write future의 첫 poll에서 started를 추가하고 oneshot 완료 장벽을 기다린다. close는 별도 장벽/카운터다. `RaceFixture::agent() -> RaceFixture` (async)는 Runtime, `handle`, `connection`, `epoch`, `stream`, `audit`를 생성한다. `call(&self, id: u128, text: &[u8]) -> InputCall`, `wait_write_started(&self)` (async), `complete_write(&self, result: WriteResult)`, `advance(&self, by: Duration)` (async)는 각각 값 구성, Notify 장벽, oneshot 해제, Tokio 가상 시계 전진을 수행한다. 모든 helper의 대기는 시험 timeout을 둔다.

`RaceFixture::wait_state(&self, state: State)` (async)는 상태 watch 알림과 snapshot 재검사로 기다린다. 시간 전진이나 반복 sleep을 상태 완료 증거로 쓰지 않는다.

- [ ] **Step 1: transport가 실제로 관측한 바이트를 확인하는 async 시험을 작성한다.**

```rust
#[tokio::test(start_paused = true)]
async fn queued_write_never_reaches_transport_after_reclaim() {
    let f = RaceFixture::agent().await;
    f.handle.submit(f.call(1, b"FIRST")).await.unwrap();
    f.wait_write_started().await;
    f.handle.submit(f.call(2, b"SECOND")).await.unwrap();
    f.handle.reclaim().await.unwrap(); // 전환 수락, 완료 표시 아님
    assert_eq!(f.handle.snapshot().await.state, State::Reclaiming);
    f.complete_write(WriteResult::Delivered);
    f.wait_state(State::UserOwned).await;
    assert_eq!(f.audit.lock().unwrap().started, vec![b"FIRST".to_vec()]);
    assert_eq!(f.handle.snapshot().await.state, State::UserOwned);
}
```

- [ ] **Step 2: RED 확인.** `cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core --test races`.
- [ ] **Step 3: 유한 실행기와 우선 제어 경로를 구현한다.**

```text
session actor: ordinary mailbox 32, receive mailbox 1 × 최대64KiB
control: transition 슬롯 1 + close flag + Notify (중복 close 합침)
worker: 예약 작업 슬롯 1, 완료 슬롯 1; 일반 입력 queue와 별개
write 시작: actor/worker 공유 start gate에서 현재 epoch와 취소 상태 재검사
          gate 안에서 start_write와 write future 첫 poll까지 동기 실행
          Pending 이후 gate를 풀고 await; 그때부터는 이미 시작한 입력
```

transport 슬롯에 예약만 된 항목은 아직 시작한 입력이 아니다. 시작 장벽과 회수 수락은 같은 gate로 직렬화한다. gate 안에서는 I/O를 await하지 않으며 Transport 구현은 첫 poll에서 블로킹하지 않는다는 계약을 가진다. actor가 완료를 기다리느라 close/reclaim/read를 막지 않도록 작업을 분리한다. 모든 외부 대기는 timeout/cancel/close로 해제할 수 있어야 한다. 일반 mailbox 포화는 Busy, 입력 큐 포화는 InputQueueFull로 구분한다. 제어 경로는 일반 mailbox 용량을 사용하지 않는다.

각 사건 처리 및 worker 첫 poll 직전에 같은 monotonic clock의 `tick(now)`를 적용한다. deadline과 완료가 같은 시각이면 만료를 먼저 처리한다. 완료 이벤트 처리 순서 때문에 5초 장벽이 연장되지 않아야 한다. 순수 모델은 Tick 사건으로 같은 경계를 표현한다.

전체 연결별 진행 호출은 16개, 대기 read는 8개를 Runtime의 공유 semaphore로 제한한다. 같은 연결의 여러 셸에 걸쳐 합산한다. 9번째 read/17번째 요청을 새 waiter/대기 future로 큐에 넣지 않고 즉시 거부한다. permit은 취소·단절·응답에서 반환한다. transport callback이 receive 상한을 넘기면 어댑터가 64KiB 이하로 나눈다. receive는 비어 있는 메시지를 무한 누적하지 않는다.

read 순서: 권한 검사+snapshot → 변경 version 등록 → 재검사 → 알림/timeout/취소 → actor에서 최종 권한/epoch/stream 검사와 페이지 생성. 반환 완료의 직렬 시점 이후 이미 반환된 데이터는 회수 불가다. 타임아웃은 현재 권한이 유효할 때 빈 page를 반환하며, 회수된 경우 빈 성공으로 숨기지 않고 오류로 끝낸다. 문자열 완성 전 UTF-8 carry만 생겼으면 남은 시간까지 기다린다.

close는 상태와 I/O를 즉시 차단하고 transport close를 요청한다. active 쓰기가 정해진 정리 시간 내 끝나지 않으면 future/transport를 drop하고 Uncertain으로 기록한다. close future까지 같은 5초 절대 deadline을 공유하여 합계 10초가 되지 않게 한다. drop이 실제 SSH socket 정리로 이어지는지는 단계 2의 transport 시험에서 입증한다.

- [ ] **Step 4: GREEN과 다음 장벽들을 고정한다.** sleep으로 타이밍을 추정하지 않는다. 예약 전/예약 후 첫 poll 전/첫 poll 후/완료 직전은 시험용 Notify로 멈춘다. 가상 시간은 deadline에만 사용한다.

| 고정 경쟁 | 결과 |
|---|---|
| 예약 후 시작 전 회수 | transport.started 0 |
| 시작 후 회수, 쓰기 지연/부분 실패 | 완료 전 Reclaiming, 5초 시 Closed/Uncertain |
| read 알림 뒤 최종 반환 검사 전 회수/재전달 | 옛 출력 반환 0 |
| 32개 입력 queue 포화에서 reclaim/close | 제어 수락, 미시작 송신 0 |
| 같은 ID 100개 동시 호출 | permit 초과 즉시 거부, 새 결과 슬롯/송신 1 이하 |
| read 8개를 A의 세 셸에 분산, 9번째 요청 | ReadLimit, 입력/상태 호출은 진행 |
| read drop/timeout/단절 | permit 회수, 다음 read 성공 |
| A 회수/단절 순서 교환, B 송신 진행 | Task 2 상태 규칙, B 송신 불변 |
| frontend loss/app close와 in-flight | 새 입력 0, deadline 내 tasks 종료 |

가상 시계 시험 외에 다중 스레드 Tokio runtime에서 같은 gate 계약을 장벽으로 검사한다. wall-clock sleep을 assertion 전제에 넣지 않는다. fixture 내부 audit mutex를 await 동안 잡지 않는다.

- [ ] **Step 5: 커밋한다.** `git add rust/crates/baton-core` 후 `git commit -m "feat: drive bounded session actors with cancellable waits"`.

## Task 6: 독립 참조 모델과 1,000개 시드

**Files:** Create `tests/model.rs`, `tests/support/{reference,generator}.rs`. Modify `tests/support/mod.rs`.

**Interfaces:** `Reference::apply(&mut self, event: &Event) -> Observation`, `System::apply(&mut self, event: &Event) -> Observation`, `generate(seed: u64, max_events: usize) -> Vec<Event>`, `minimize(events: &[Event], fails: impl Fn(&[Event]) -> bool) -> Vec<Event>`. `System`은 실제 Registry/Session을 호출하는 시험 어댑터다. reference.rs에 다음 시험 타입을 정의한다. 모두 Clone/Debug 및 직접 비교용 Eq/PartialEq를 제공한다.

```rust
enum Event {
    Connect(ConnectionId), Disconnect(ConnectionId),
    Open(SessionId), Connected(SessionId),
    Handoff(SessionId, ConnectionId, StreamId), Reclaim(SessionId),
    Submit(SessionId, InputCall), StartWrite(SessionId),
    FinishWrite(SessionId, SafeInt, WriteResult), Receive(SessionId, Vec<u8>),
    Read(SessionId, ReadCall), CancelInput(SessionId, Principal, SafeInt, RequestId),
    Tick(Duration), CloseSession(SessionId), CloseApp,
}
enum Reply {
    Unit(Result<(), CoreError>), Input(Result<InputResult, CoreError>),
    Write(Result<Option<WriteOp>, CoreError>), Page(Result<ReadPage, CoreError>),
}
struct Observation {
    reply: Reply,
    sessions: Vec<(SessionId, Snapshot, Usage)>, // ID 정렬
    sent: Vec<(SessionId, SafeInt, Vec<u8>)>, // 누적 시작 효과
}
```

`Tick(Duration)`은 절대 경과 시각이며 생성기는 시간을 감소시키지 않는다. Open은 Connecting 생성, Connected는 연결 완료, CloseSession/CloseApp은 각각 User/AppExit 사유를 쓴다. 상태 없는 대상은 UnknownId로 정규화한다. UI 소비가 없는 모델에서는 보관 상한 도달 시 종료를 그대로 비교한다. UI ack 세부 순서는 Task 4 전용 시험이 담당한다.

- [ ] **Step 1: 독립 오라클 비교 시험을 작성한다.**

```rust
#[test]
fn model_1000_seeds_200_events() {
    for seed in 0..1_000 {
        let events = generate(seed, 200);
        let (mut expected, mut actual) = (Reference::new(), System::new());
        for (index, event) in events.iter().enumerate() {
            assert_eq!(actual.apply(event), expected.apply(event), "seed={seed}, index={index}");
        }
    }
}
```

`Reference::new() -> Reference`, `System::new() -> System`은 빈 앱을 만든다. 실패 시 위 루프를 감싸 최초 불일치 prefix를 추출하고 `minimize`가 연속 구간 삭제로도 실패하는 가장 작은 재현열을 수렴할 때까지 줄인다. 실패 출력에는 합성 seed/event만 쓴다.

- [ ] **Step 2: RED 확인.** `cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core --test model`.
- [ ] **Step 3: 오라클과 생성기를 구현한다.** 참조는 단순 map/list·완성 Unicode 표식으로 규칙을 표현하며 제품의 권한 함수·decoder·큐를 import하지 않는다. decoder 바이트 단위 검증은 Task 4가 담당한다. 생성기는 아래 PRNG를 사용하고 유효/무효 owner·epoch·stream, 반복 request_id, 닫힌 세션, 5초 전후를 선택한다.

```rust
fn next(seed: &mut u64) -> u64 {
    *seed = seed.wrapping_add(0x9E3779B97F4A7C15);
    let mut z = *seed;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}
```

이 wrapping은 시험 난수 전용이다. 제품 epoch/cursor에 적용하지 않는다. 이벤트가 존재하지 않는 ID를 지목하는 경우도 결정적으로 오류 비교한다. 생성 분포를 카운터로 기록하고 각 필수 사건·성공/거부·전환 중 사건이 최소 1회 등장하지 않으면 시험 실패다. 항상 single input owner, stale 효과 0, foreign 읽기 0, duplicate 효과 ≤1, Closed 이후 시작 0, 상한을 검사한다. resize 이벤트는 구현 범위인 단계 2에서 모델을 확장하며 이번 결과에 포함하지 않는다.

- [ ] **Step 4: GREEN과 축소기 자체 시험.** 고의적으로 Event 목록 중 특정 두 사건의 순서만 실패하는 순수 predicate를 넣어 최소 재현에 그 두 사건이 남는지 검사한다. 모형 시험과 Task 5 실제 async 시험을 둘 다 실행한다. 모델만 통과하면 actor 통과로 표시하지 않는다.
- [ ] **Step 5: 커밋한다.** `git add rust/crates/baton-core/tests` 후 `git commit -m "test: check core behavior against an independent model"`.

## Task 7: 변이 검출·실행 runner·단계 보고서

**Files:** Create `rust/scripts/{verify-phase-1,test-core-mutants}.ps1`, `docs/testing/rust-phase-1-report.md`. Modify core 시험 파일은 변이를 검출하지 못한 실제 누락이 있는 경우에만 한다.

**Interfaces:** `verify-phase-1.ps1 [-Mutation]`는 외부 명령 실패 즉시 종료 코드 1, 전체 필수 시험 통과 시 0. `test-core-mutants.ps1`은 제품 원본을 수정하지 않고 각 변이의 컴파일 성공과 관련 시험 실패를 확인한다. 실행 결과는 `artifacts/rust-phase-1/summary.json`에 commit/dirty/source hash, Rust/OS, 명령·기간·pass/fail/skip, seed 수, 변이 판정만 기록한다.

- [ ] **Step 1: runner의 실패를 실제로 유발한다.** 필수 시험 바이너리 목록 `numbers,ownership,input,output,races,model` 중 하나를 runner 설정에서 제외한 격리 사본으로 실행하여 누락 실패를 확인한다. 비정상 종료하는 cargo 대역 실행기로 외부 실패가 이후 명령에 덮이지 않는지 검사한다. 대역 경로는 시험용 매개변수로만 주입하고 일반 runner에는 사용하지 않는다.
- [ ] **Step 2: 상한·모형·async 검사 명령을 연결한다.** 첫 버전확인에서 Rust 1.88.0을 확인한다. 설치된 이름이 stable인 현 환경은 `+stable`을 쓴다.

```powershell
cargo +stable fmt --manifest-path rust/Cargo.toml -p baton-core -- --check
cargo +stable clippy --manifest-path rust/Cargo.toml --locked -p baton-core --all-targets -- -D warnings
cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core --all-targets
pwsh -File rust/scripts/test-core-mutants.ps1
```

runner는 매 명령의 `$LASTEXITCODE`를 즉시 검사한다. `--list` 결과에서 필수 바이너리와 예상 핵심 test 이름·ignored 0을 확인한다. 실행 횟수를 소스에 하드코딩한 성공 수로 보고하지 않는다. core만 바뀐 이번 단계에서 WebView·SSH 73개 전체를 매번 재실행하지 않는다. 공유 lockfile의 probe 의존성이 달라졌다면 해당 경계 검증을 추가한다.

- [ ] **Step 3: 네 변이를 격리 사본에 하나씩 적용한다.**

| 변이 | 바꾸는 의미 | 반드시 실패할 시험 |
|---|---|---|
| owner | 배정 불일치 거부 제거 | ownership의 A/B 직접 조회·input의 foreign 효과 0 |
| epoch | 현재 epoch 비교 제거 | input의 재전달 후 옛 epoch 효과 0 |
| private | receive의 AgentOwned public 조건 제거 | output의 P/Q/R 경계 |
| duplicate | 같은 request_id에서 queue 추가 허용 | input의 100회 동일 호출/송신 1 |

스크립트는 현재 구현의 해당 함수 범위에 정확히 1회 일치하는 소스 치환을 고정한다. 치환 0/복수는 runner 실패다. 각 사본은 독립 workspace manifest와 기존 lockfile을 사용하고 `cargo test --no-run` 성공을 먼저 요구한다. 컴파일 오류·환경 실패·timeout은 killed로 계산하지 않는다. 다음 관련 시험이 assertion으로 실패하고 같은 무변이 사본은 성공해야 killed다. 재접속 ID 재사용 변이는 단계 4에 남기며 4/5를 5/5로 표시하지 않는다.

사본은 저장소의 `artifacts/rust-phase-1/mutants/<고유 실행 ID>/`에만 만든다. 삭제 전 resolved absolute path가 이 실행 디렉터리 하위인지 검사하고 PowerShell `Remove-Item -LiteralPath`를 사용한다. 원본·사용자 작업 트리·다른 실행의 디렉터리를 수정/삭제하지 않는다. 제품에 변이 활성화 feature나 우회 플래그를 남기지 않는다.

- [ ] **Step 4: 결과를 기록한다.**

보고서에 다음 표를 실제 실행 값으로 채운다: `ID / 담당 시험 / 관측 효과 / 명령 / commit·source hash / 통과·실패·skip / 제한`. 결과가 없으면 미실행으로 표시하고 단계 통과로 쓰지 않는다. 단계 0의 물리 UI와 renderer 정리 미확인을 단계 2 할 일로 다시 링크한다. 최대 메모리는 입력 이력 payload만 셸당 64MiB, 16셸 1GiB가 될 수 있음을 계산해 기록하고 metadata/UI/public overhead를 구분한다. 실제 부하 측정 전 사용 메모리로 단정하지 않는다. 더 작은 정책으로 바꾸려면 별도 근거와 설계 갱신을 제안한다.

- [ ] **Step 5: 커밋 및 전체 변경 리뷰 준비.** `git add rust/scripts/verify-phase-1.ps1 rust/scripts/test-core-mutants.ps1 docs/testing/rust-phase-1-report.md` 및 이번 Task에서 실제 변경한 시험 파일만 추가한 뒤 `git commit -m "test: gate Rust core contracts with mutation checks"`. Native 절차에 따라 구현 완료 뒤 한 번의 별도 전체 리뷰를 수행한다. 리뷰 지적은 재현 시험을 먼저 만들고 수정한다. 릴리스 인수 완료로 보고하지 않는다.

## 계획 자체 검토와 완료 판정

| 요구사항 | 구현/시험 담당 | 이 단계 외 증거 |
|---|---|---|
| OWN-01~05 | Task 2·3·5·6 | 실제 IPC/SSH 격리는 단계 3 |
| IN-01~03 | Task 3·5·7 | 실제 russh write/단절은 단계 2 |
| OUT-01~04 | Task 4·5·6 | 실제 UI/MCP 경로는 단계 2·3 |
| OUT-05 | Task 4 cursor/page | 전체 JSON frame 256KiB는 단계 3 |
| NUM-01 | Task 1·2·3·4 | IPC/Tauri 역직렬화 경로는 단계 2·3 |
| LIFE-02 / UI-03 코어 | Task 2·4·5 | 실제 EOF/WebView/프로세스는 단계 2·4 |
| 독립 model 1,000×200 | Task 6 | release 10,000×500은 단계 5 |
| 관련 네 변이 | Task 7 | 재접속 ID 변이는 단계 4 |
| Review Focus 1~5 | 각각 Task 3·5 / 3·5 / 4 / 5 / 2·5 | 물리 UI로 대체 주장하지 않음 |

정의된 타입·메서드 이름과 Task 간 참조를 자체 검토한다. 체크박스 완료는 실제 코드·명령·결과를 본 뒤 표시한다. 단계 1은 코어 필수 시험 실패·skip 0, 모델 시드 충족, 네 변이 검출, SDK 의존성 부재, 전체 리뷰의 핵심 지적 해결 후 완료다. 다음 산출물은 실제 SSH와 UI를 결합하는 단계 2 상세 계획이다.
