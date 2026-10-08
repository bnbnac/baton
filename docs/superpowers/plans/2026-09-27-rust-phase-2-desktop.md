# Baton Rust Phase 2 SSH and Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 사용자가 직접 SSH 서버에 접속·인증하고 여러 독립 셸을 조작하는 Rust/Tauri 앱을 만든다. 단계 0에서 남은 실제 Windows 입력과 WebView 종료를 이번 단계에서 검증한다.

**Architecture:** `baton-core`가 세션 수명·입력·조회 응답·크기·출력 예산의 정책을 소유한다. `baton-ssh`는 russh 연결 하나와 PTY 하나를 세션 하나에 대응시키고, Tauri 앱은 인증 UI와 코어를 조립한다. TypeScript/xterm은 원본 바이트를 렌더링하고 구조화된 사용자 동작만 Rust에 요청한다.

**Tech Stack:** Rust edition 2024 / rust-version 1.88, Tokio, serde, russh 0.63.1, Tauri 2.11.6, TypeScript 7.0.2, Vite 8.3.0, xterm 6.0.0, FitAddon 0.11.0. 단계 0 lockfile의 검증 버전을 출발점으로 사용한다.

**Spec:** [구조 설계](../specs/2026-09-20-rust-transition-design.md), [검증 기준](../specs/2026-09-20-rust-verification-design.md), [단계 0 보고서](../../testing/rust-phase-0-report.md), [단계 1 보고서](../../testing/rust-phase-1-report.md).

상태: 2026-10-08. Tasks 1–8 및 Phase 2 완료(기존 증거 인정, DPI는 Windows 배포 전 보류). 사용자는 제품 변경 없이 exe 해시만 달라진 경우의 반복 시험을 생략하도록 요청했다. 제품·입력 harness·lock 무변경과 두 collection의 10개 항목을 재검증해 단계 종료를 결정했다. 동일 바이너리 전체 통과는 아니며 strict runner의 원본 `manual_pending / exit 2`는 유지한다. 상세 근거와 남는 제한은 [인수 기록](../../testing/rust-phase-2-report.md)의 최종 결정을 따른다. 아래 기존 gate 요구는 구현 당시 기준으로 보존하며 이번 단계 종료에는 이 승인된 예외를 적용한다. 실행 방식은 기존 **Native**를 유지한다. 기준 코드 `d62b85a`의 코어 55개/workspace 64개 결과는 단계 1 증거이며 이 계획의 시험 결과로 합산하지 않는다.

## Global Constraints

- Windows 먼저 검증·배포하고 macOS/Linux는 각 OS의 실제 인수 후 순차 지원한다. 코어·SSH crate에 Windows UI 타입을 넣지 않는다.
- 연결 / SSH 세션: 앱당 32 / 16. Connecting·Closed 카드도 16개 한도에 포함한다. 사용자가 닫힌 카드를 제거한 뒤 빈 슬롯에 새 ID로 연결한다.
- 일반 입력: UTF-8 16 KiB, 셸별 대기 32건, in-flight transport 작업 최대 1개. 에이전트 request 이력은 셸·control_epoch별 4096건이며 자동 회수·재실행으로 초기화하지 않는다. 사용자 터미널 입력은 별도 bound-view 경로에서 단조 sequence로 중복을 거부하고 완료된 입력을 폐기한다. sequence는 소유권 전환 후에도 초기화하지 않는다. (2026-10-04 사용자 승인)
- 공개 출력: 셸당 1 Mi UTF-16 단위, 조회 2–32768단위. 기존 read8/request16 정책을 보존한다.
- UI scrollback: 셸당 최대 1000행. UI 미확인 출력은 셸당 코어 1 MiB, xterm에 넘긴 미확인 바이트 합계 64 KiB.
- epoch·cursor·sequence는 0..2^53−1 정수. 증가 시 상한 초과는 명시적 세션 종료이며 순환 금지.
- 전환 장벽과 정상 종료 정리는 최대 5초. 각 하위 작업마다 새 5초를 추가하지 않는다. 자동 Ctrl+C·SSH 재접속·실패 입력 재전송·rollback 없음.
- 초기 PTY 120×32, 열 20–500 / 행 5–200. 최신 크기 하나, 최대 100ms에 한 번, 같은 크기는 보내지 않는다. 0 크기에서는 마지막 유효 크기를 유지한다.
- 프로토콜 조회: 셸당 미처리 32개, 생성 후 2초 만료, 응답 최대 128바이트. CPR 좌표만 행 1–200 / 열 1–501 (pending-wrap 포함); PTY 열 상한은 500.
- 화면 바이트와 공개 문자열은 별도다. 이미 코어에 들어온 private/이전 epoch 출력은 새 공개 구간으로 재분류하지 않는다. 원격이 나중에 다시 출력한 내용의 영구 비공개는 보장하지 않는다.
- 일반 키·붙여넣기·IME·마우스는 UserOwned+현재 epoch에서만 입력한다. 프런트엔드 disableStdin은 보조 수단이다. resize와 구조화된 terminal reply를 MCP에 노출하지 않는다.
- 같은 서버라도 셸마다 독립 SSH 연결. 화면 활성 탭·별칭·대화 이름은 권한 근거가 아니다. 다른 서버의 입력·크기·종료에 영향을 주지 않는다.
- 비밀번호·키·MFA·사용자 터미널 원문·원문 예외를 파일이나 진단 로그에 쓰지 않는다. 원격 문자열은 HTML/JS로 넣지 않는다. 로컬 셸·임의 파일·원격 페이지 권한 없음.
- C# `src/`, `tests/`, `build.cmd` 및 사용자 하네스 설정을 변경하지 않는다. 자동 검증에는 격리 loopback fixture만 사용한다. 실제 사용자 서버는 자동 접속하지 않는다.
- 기존 Phase 0 probe를 제품 의존성으로 가져오지 않는다. 검증된 알고리즘과 회귀 데이터를 제품 모듈로 옮기고 제품 경로에서 다시 시험한다.
- phase-0의 blocked/exit 2를 성공으로 덮어쓰지 않는다. 물리 UI 증거·renderer 종료가 없으면 Phase 2 runner도 exit 2다.
- force push 금지, PR은 squash. 이번 계획 실행에는 push·병합·배포·사용자 환경 설정 변경이 포함되지 않는다.

## Review Focus

1. 인증 취소·창 닫기 직후 늦은 성공이 도착해 새 셸이 열리는 상황 — Task 1·4의 활성화 gate와 서버 PTY/shell 0회 시험.
2. 수신과 화면 표시 사이의 회수·재전달, 분할 CSI 마지막 바이트와 다른 조회 토큰의 혼선 — Task 2·6의 epoch/offset 검증과 실제 WebView 회귀.
3. 일반 입력 포화·정체된 쓰기 중 terminal reply/resize가 권한 전환을 우회하거나 종료 기한을 늘리는 상황 — Task 3·4의 단일 transport 작업 장벽 시험.
4. 한글 조합·대량 붙여넣기·빠른 탭 전환·최소화 복귀에서 대상이나 epoch가 바뀌는 상황 — Task 6·7·8의 실제 수신 바이트와 각 서버 geometry 확인.
5. UI reload·renderer 종료·부모 runner 강제 종료에서 연결/하위 프로세스가 남거나 무관한 프로세스를 죽이는 상황 — Task 5·8의 앱 수명 검사와 PID+시작 시각+귀속 검증.

## 범위와 구현 결정

이번 산출물은 **사용자용 SSH 터미널 앱**이다. 연결 대상은 hostname/IP, port, username, label을 입력하며 password / 암호화 private-key 파일 / keyboard-interactive를 선택한다. 호스트키는 매 연결마다 host·port·알고리즘·SHA-256 fingerprint를 표시하고 사용자가 해당 시도에 승인한다. known_hosts·자격 증명·연결 설정 저장은 추가하지 않는다. 키 파일은 사용자가 HTML file input에서 선택한 한 파일만 메모리로 읽고 전송하며 일반 파일 읽기 권한을 주지 않는다.

UI는 좌측 세션 목록, 우측 활성 터미널, 연결/인증 패널, 대상·계정·별칭·짧은 ID·소유 상태 표시로 구성한다. 전체 ID 복사를 제공한다. 닫힌 카드는 명시적으로 제거할 때까지 남긴다. 탭 전환·회수 때 xterm을 재생성하지 않는다. 단계 2 제품에는 MCP 연결·가짜 연결 목록·전달 버튼을 노출하지 않는다. AgentOwned 전환 시험은 별도 acceptance 실행 파일에서 신뢰된 시험 연결을 등록해 수행하며 실제 하네스를 설치/수정하지 않는다.

인증 UI는 서버의 안내/프롬프트를 plain text로 표시하고 echo 설정을 반영한다. 자동으로 비밀번호를 다른 인증 방식에 재사용하지 않는다. partial-success에서 서버가 keyboard-interactive를 요구하면 사용자에게 다음 challenge를 보여준다. 잘못된 암호 후 자동 재시도하지 않으며, 실패한 연결은 Closed로 남기고 사용자가 새 연결을 시작한다.

새 구현에 필요한 로컬 입력 상한을 다음으로 고정한다: host 253 bytes, username/label 각 UTF-8 256 bytes, password/passphrase/개별 MFA 응답 16 KiB, key 파일 1 MiB, challenge당 prompt 16개·총 표시 문자열 32 KiB, 인증 challenge 최대 16회. 외부 문자열은 길이 검사 후 UI로 전달한다. TCP/KEX·각 서버 응답 대기 10초, 사용자 인증 응답 대기 5분; 단계별 대기 기한과 앱 종료 5초 기한은 구분한다. 제한/timeout은 안전한 오류 코드로 종료하며 raw error를 전달하지 않는다. 이것은 기존 규격의 무제한 구현을 막기 위한 Phase 2 구현 정책이다.

서버 출력은 임의 길이 전체 복사 없이 ≤64 KiB 조각으로 코어에 전달한다. russh 자체 channel/packet/window 예산도 설정하고 그 메모리는 코어 1 MiB와 별도 보고한다. GUI가 느릴 때 무제한 중간 큐나 모든 frame의 Promise 목록을 만들지 않는다.

실시간 app/session ID와 UI generation은 `getrandom`으로 128-bit를 발급하고 OS entropy 실패를 전파한다. 이미 lock에 있는 호환 버전을 사용하며 0·현재 충돌이면 다시 생성한다. 이것은 UI 앱에서 필요한 ID 발급만 앞당기는 것이며 IPC connection 인증과 reconnect-ID 검증 완료를 뜻하지 않는다. UI 일반 입력은 세션당 단조 증가 `input_seq: SafeInt`를 보내며 Rust는 그 값을 bound-view 사용자 입력 경로의 단조 sequence로 검증한다. 같은 세션에서 seq를 재사용하지 않고 상한 도달 시 종료하며 자동 재전송하지 않는다.

## 파일과 공통 인터페이스

모든 경로는 작업 트리 루트 기준이다. 기존 runtime 파일은 lifecycle과 IO driver를 분리할 때만 필요한 범위로 나눈다.

| 파일 | 책임 |
|---|---|
| `rust/crates/baton-core/src/runtime/{lifecycle,driver}.rs`, `src/runtime.rs` | 동적 세션, transport 단일 작업, 종료/회수 gate |
| `rust/crates/baton-core/src/{view,queries,geometry}.rs` | UI generation, 조회 토큰/parser, 크기 coalescing |
| `rust/crates/baton-core/src/{session,types,ui_output}.rs` | UI frame metadata, 제어 작업과 기존 정책 통합 |
| `rust/crates/baton-core/tests/{lifecycle,queries,geometry,control_io}.rs` | 결정적 gate·fake clock·송신 효과 검사 |
| `rust/crates/baton-ssh/src/{lib,auth,host_key,transport,reader,error}.rs` | russh 연결·인증·PTY·크기·수신·정리 |
| `rust/crates/baton-ssh/tests/driver.rs` | library 기반 독립 SSH fixture 시험 driver |
| `rust/app/src-tauri/src/{lib,main,app,commands,dto,auth_bridge,output_pump,lifecycle,ids}.rs` | 최소 Tauri glue와 시험 가능한 AppService |
| `rust/app/src/{main,bridge}.ts`, `style.css`, `index.html` | 앱 진입·typed bridge·레이아웃 |
| `rust/app/src/terminal/{terminal,input,output,queries,geometry}.ts` | xterm 수명·일반 입력·출력/ack·hook·fit |
| `rust/app/src/sessions/{store,view}.ts`, `src/auth/{view,form}.ts` | 명시적 세션 선택, 연결·인증 UI |
| `rust/app/tests/*.test.ts` | Node 실행용 순수 UI 상태/bridge 시험 (DOM renderer 시험과 구분) |
| `rust/tests/phase2/{auth,ssh,desktop,runner,cleanup}.test.mjs` | 실제 제품 library / WebView / 정리 시험 |
| `rust/tests/phase2/{desktop-driver,fixtures}.ts`, `acceptance.html` | 별도 acceptance frontend, 제품 컴포넌트 재사용 |
| `rust/app/src-tauri/src/bin/ui_acceptance.rs`, `tests/service.rs` | 별도 acceptance 호스트·제품 AppService 시험 |
| `rust/scripts/{verify-phase-2,test-desktop,record-phase-2-manual}.ps1` | runner, Windows 증거 수집, 수동 기록 검사 |
| `docs/testing/{rust-phase-2-report,rust-phase-2-manual}.md` | 실제 결과와 사람이 수행할 절차 |

추가/변경 manifest: `rust/Cargo.toml`, `Cargo.lock`, `baton-core/Cargo.toml`, 새 `baton-ssh/Cargo.toml`, `rust/app/{package.json,package-lock.json,tsconfig.json,vite.config.ts}`, `src-tauri/{Cargo.toml,build.rs,tauri.conf.json,capabilities/main.json}`, acceptance 전용 Tauri/Vite 설정. npm은 앱의 독립 lock을 생성하되 기존 검증 버전을 정확히 고정한다. 설치·lock 갱신은 구현 Task에서만 수행한다.

공통 API에서 ID는 core newtype, `SafeInt`는 검증된 정수, 시간은 주입 가능한 `Duration`/Tokio `Instant`다. wire DTO는 hex ID string과 safe integer를 사용하며 별도 parser가 오류를 반환한다. endpoint secret이나 원격 인증정보를 Snapshot/DTO의 Debug에 넣지 않는다.

```rust
// Task 1, trusted app/adapter assembly API. Never expose Registry mutation to JS.
Runtime::reserve_session(&self, id: SessionId) -> Result<(), CoreError>;
Runtime::activate_session(&self, id: SessionId, io: Box<dyn Transport>) -> Result<SessionHandle, CoreError>;
Runtime::close_session(&self, id: SessionId, reason: CloseReason) -> Result<(), CoreError>;
Runtime::forget_closed(&self, id: SessionId) -> Result<(), CoreError>;
Runtime::session_handle(&self, id: SessionId) -> Result<SessionHandle, CoreError>;
Runtime::snapshots(&self) -> Vec<(SessionId, Snapshot)>; // trusted UI only

// Task 2: ViewId = new u128 ID; QueryId = SafeInt wrapper, unique for session life.
struct ViewBinding { session: SessionId, generation: ViewId }
enum QueryKind { Dsr, Cpr, Da }
struct QueryMark { id: QueryId, kind: QueryKind, epoch: SafeInt, end_offset: usize }
struct UiFrame { binding: ViewBinding, seq: SafeInt, bytes: Vec<u8>, queries: Vec<QueryMark> }
struct ReplyCall { binding: ViewBinding, epoch: SafeInt, query: QueryId,
                   kind: QueryKind, row: Option<u16>, column: Option<u16> }
SessionHandle::bind_view(&self, generation: ViewId) -> Result<ViewBinding, CoreError>;
SessionHandle::next_ui_frame(&self, view: ViewBinding) -> Result<Option<UiFrame>, CoreError>;
SessionHandle::ack_ui_frame(&self, view: ViewBinding, seq: SafeInt) -> Result<(), CoreError>;
SessionHandle::protocol_reply(&self, call: ReplyCall) -> Result<(), CoreError>;

// Task 3: Geometry validated constructor; GeometryRequest includes view + resize_seq.
struct Geometry { columns: u16, rows: u16 }
struct GeometryRequest { binding: ViewBinding, resize_seq: SafeInt, geometry: Geometry }
SessionHandle::resize(&self, request: GeometryRequest) -> Result<(), CoreError>;
Transport::resize(&mut self, geometry: Geometry) -> IoFuture<'_, Result<(), TransportError>>;
// Existing write/close remain; no public raw bypass-write API.
```

위 선언의 `Runtime` 동기 메서드는 짧은 gate만 사용하며 network await를 하지 않는다. SessionHandle 작업은 기존처럼 async 메서드다. `forget_closed`는 driver가 실제 종료한 뒤에만 성공하며 기존 handle은 UnknownId/Closed로 안전하게 거부한다. panic하는 `expect("attached session is retained")`를 제거한다.

추가 오류는 `StaleView`, `UnknownQuery`, `QueryExpired`, `WrongQueryKind`, `InvalidPosition`, `QueryLimit`, `StaleResize`, `InvalidGeometry`와 `TransportError::Disconnected/Failed`다. 기존 오류 우선순위와 상태 정책은 유지한다. 후속 MCP mapping을 이번 UI 오류 문자열과 결합하지 않는다.

## Task 1: 실행 중 세션 생성·활성화·정리

**Files:** Modify core `runtime.rs`, `runtime/driver.rs`, `registry.rs`, `session.rs`; Create `runtime/lifecycle.rs`, `tests/lifecycle.rs`. Tests reuse `tests/support/transport.rs`의 audit/barrier.

**Interfaces:** 위 Runtime API 생산. 기존 `spawn(Registry)`, `attach`, SessionHandle API는 기존 시험이 계속 동작하도록 유지하거나 호출부를 동일 계약으로 이관한다. reserve는 Connecting 삽입, activate는 attach+connected를 같은 gate에서 수행한다.

- [x] **Step 1: 실패하는 lifecycle 시험을 작성한다.** 타입 선언/최소 stub 뒤 assertion 실패를 확인한다.

```rust
// reserve_close_late_activate_never_opens: reserve → close → activate
assert!(matches!(activation, Err(CoreError::SessionClosed)));
assert_eq!(audit.started_bytes(), 0);
assert_eq!(audit.transport_drops(), 1);
// forget_waits_for_driver_and_stale_handles_never_panic
assert_eq!(forget_while_driver_pending, Err(CoreError::Busy));
assert!(old_handle_operation.is_err());
assert_ne!(replacement_id, closed_id);
// existing_shutdown_gate_covers_reserve_and_activate
assert_eq!(post_shutdown_reserve, Err(CoreError::SessionClosed));
assert_eq!(transport_drops_at_shutdown_return, admitted_transports);
```

추가: 16개 Connecting/Closed 포함 한도, 중복 ID, 원격 종료 후 다른 셸 유지, reserve 직후 앱 종료, activate 앞뒤 취소, list가 제거된 세션을 반환하지 않는 순서를 고정한다. Debug/metadata에서 비밀을 보유하지 않는다.

- [x] **Step 2:** `cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core --test lifecycle` → 새 계약 assertion FAIL. 컴파일 실패만으로 RED를 충족했다고 기록하지 않는다.
- [x] **Step 3:** 등록·활성화·shutdown을 같은 registry gate에 묶는다. close는 Connecting도 처리한다. driver join 완료 뒤만 map 정리; 제거/과거 handle 호출에 panic 없음. reserve 후 실패는 Closed로 남긴다.
- [x] **Step 4:** 동일 명령 PASS, 기존 `races` 및 전체 core PASS. `shutdown_joins_attach_admitted_before_close_gate`는 유지한다.
- [x] **Step 5:** Task 1 파일만 stage 후 `git commit -m "feat: manage live core session lifecycles"`.

## Task 2: 뷰 권한과 실제 수신에 묶인 terminal reply

**Files:** Create core `view.rs`, `queries.rs`, `tests/queries.rs`; Modify `types.rs`, `session.rs`, `ui_output.rs`, `runtime.rs`, `runtime/driver.rs`. Phase0 `queries.rs`는 참고만 하고 의존하지 않는다.

**Interfaces:** `ViewBinding`, `QueryMark`, `UiFrame`, `ReplyCall` 및 view/frame 메서드 생산. 기존 public-only 수신 표식을 내부 `ReceiveScope{epoch:SafeInt,control_allowed:bool,public_allowed:bool}`로 확장한다. `SessionHandle::receive` 진입 gate에서 UserOwned/AgentOwned이면 control_allowed, AgentOwned이면 public_allowed를 기록한다. `Session::receive_scoped(bytes,scope)`는 원본 UI를 보존하고, scope가 현재 epoch와 같고 처리 시에도 해당 상태가 허용할 때만 query/public에 반영한다. 동기 `Session::receive`는 현재 scope를 만드는 편의 wrapper로 유지한다. 내부 `Queries::receive(epoch, seq, bytes, now) -> Result<Vec<QueryMark>,CoreError>`와 `Queries::prepare_reply(call, now) -> Result<Vec<u8>,CoreError>`가 token 검증/소모와 응답 바이트 생성을 담당한다. 이 Task의 시험은 승인된 바이트까지 검증하며 실제 transport로 보내는 `SessionHandle::protocol_reply`와 송신 직전 재검사는 Task3에서 연결한다. parser는 bounded incremental 상태이며 패킷 전체를 누적하지 않는다.

- [x] **Step 1:** 아래 효과 시험을 먼저 작성한다.

```rust
// token_once_expired_foreign_and_transition
assert_eq!(supported_reply_bytes, b"\x1b[0n");
assert_eq!(second_reply, Err(CoreError::UnknownQuery));
assert_eq!(at_2000ms, Err(CoreError::QueryExpired));
assert_eq!(foreign_view_accepted_reply_bytes, 0);
assert_eq!(old_epoch_accepted_reply_bytes, 0);
assert_eq!(at_32_pending, 32);
assert_eq!(thirty_third_query_result, Err(CoreError::QueryLimit));
// pending wrap: CPR column501 accepted;502 rejected; reply always <=128 bytes.
```

모든 분할 위치에서 `ESC[06n ESC[2;3H ESC[6n`, leading zero, OSC/DCS 안의 ESC→CSI, 64바이트보다 긴 CSI, CAN/SUB, UTF-8 분할과 ASCII 제어를 조합한다. 기대 바이트는 Phase0 실측 fixture와 비교한다. 조회 시작 epoch를 저장하고 이전 epoch에서 시작한 미완성 CSI에 다음 epoch의 token을 주지 않는다. UI를 늦춰 오래된 frame이 다음 token을 빌리는 사례를 재현한다. `queued_user_query_then_handoff_has_no_reply`는 UserOwned에서 수신 큐에 들어온 조회가 처리 전 전달되면 새 epoch token/응답 0회임을 확인한다. UserOwned의 정상 조회는 공개 출력 없이 terminal reply를 생성할 수 있어야 한다.

- [x] **Step 2:** `cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core --test queries` → token/epoch/offset assertion FAIL.
- [x] **Step 3:** 실제 수신 경계에서만 token을 발급한다. frame 분할 후 `end_offset`은 그 frame 안의 조회 최종 바이트를 가리킨다. 생성 시각은 UI pump 시각이 아니다. 과거 scope의 바이트도 parser의 구조 상태에는 반영하되 조회 권한을 만들지 않는다. 전환 때 parser를 무조건 Ground로 초기화해 긴 OSC/DCS의 나머지를 새 CSI로 오인하지 않는다. 32개 상한은 미응답 token과 송신 대기 reply 합계에 적용하며, UI 지연으로 만료된 token을 새 token으로 교체하지 않는다. 상한 초과는 해당 세션을 OutputOverload로 명시적으로 닫는다. view의 첫 bind만 허용하며 다른 generation으로 재부착하면 FrontendLost로 닫는다. 같은 binding 확인은 idempotent지만 과거 frame을 재전송하지 않는다. ack/reply의 view와 seq/epoch는 Rust에서 검사한다.
- [x] **Step 4:** 동일 시험 PASS. core output/races PASS, 특히 queued_receive 경계 회귀 유지. 생성기의 invalid-read 누락 보강은 Task3 모델 확장에 포함한다.
- [x] **Step 5:** `git commit -m "feat: bind terminal replies to received queries"`.

## Task 3: 단일 transport 작업과 동적 geometry

**Files:** Create core `geometry.rs`, `tests/geometry.rs`, `tests/control_io.rs`; Modify `runtime/driver.rs`, `runtime.rs`, `session.rs`, `types.rs`, `tests/support/{transport,reference,generator}.rs`, `tests/model.rs`.

**Interfaces:** Geometry/resize 및 `protocol_reply` API 생산. `Geometry::new(columns:u16,rows:u16)->Result<Geometry,CoreError>`는 범위를 검사한다. `TransportError` 정의. core 내부 `TransportOp = Input(WriteOp) | Reply{seq,epoch,bytes} | Resize{seq,view,geometry}`, `TransportCompletion = Data(WriteResult) | Resize(Result<(),TransportError>)`를 정의한다. 기존 write sequence를 모든 transport 작업의 공통 단조 증가 sequence로 확장하며 종류별로 같은 번호를 따로 발급하지 않는다. `Session::start_transport_op(now) -> Option<TransportOp>`, `finish_transport_op(seq, completion, now) -> Result<(),CoreError>`를 driver가 사용한다. 외부 raw reply 입력은 노출하지 않는다.

- [x] **Step 1:** 다음 assertion을 가진 시험을 작성한다.

```rust
assert_eq!(geometry_after_zero_measurement, Geometry::new(120,32).unwrap());
assert_eq!(out_of_range, Err(CoreError::InvalidGeometry));
assert_eq!(old_resize_seq, Err(CoreError::StaleResize));
assert_eq!(foreign_view_effects, 0);
assert!(adjacent_resize_start_times.windows(2).all(|t| t[1]-t[0] >= Duration::from_millis(100)));
assert_eq!(stable_latest, Geometry::new(91,27).unwrap());
assert_eq!((epoch_after,stream_after,cursor_after),(epoch_before,stream_before,cursor_before));
assert_eq!(unstarted_old_reply_bytes, 0);
assert_eq!(concurrent_transport_ops_max, 1);
```

일반 queue32+active1에서 reply/resize를 보내고 회수·close가 즉시 수락되는지 검사한다. 전환 중 latest geometry 하나만 유지하며 완료 후 해당 view가 여전히 유효할 때 전송한다. reply는 enqueue와 첫 transport poll 직전에 token/epoch/2초 만료를 검사한다. 일반 입력, reply, resize가 이미 시작했다면 모두 5초 전환 장벽의 대상이다. 실패한 resize로 geometry 성공값을 갱신하지 않는다.

- [x] **Step 2:** `cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core --test geometry --test control_io` → 구체적 상한/경합 assertion FAIL.
- [x] **Step 3:** 단일 active future를 작업 enum으로 일반화한다. reply는 token 소모 후에도 송신/취소까지 32개 예산에 남는다. resize는 일반 입력 queue를 쓰지 않고 latest slot 하나를 교체한다. close/transition은 큐와 독립이며, 실행 가능한 reply/resize 묶음과 ordinary input 사이를 번갈아 선택해 일반 입력이 계속 굶지 않게 한다. elapsed clock은 주입 가능하게 유지한다. resize에 새 input epoch/stream을 발급하지 않는다.
- [x] **Step 4:** 독립 모델에 resize request/start/complete와 view 교체/닫힘을 추가한다. event 선택과 invalid field 선택에 독립 PRNG draw를 사용해 Phase1의 modulo 상관 문제를 없애고 `stale_epoch_reads > 0`, `stale_stream_reads > 0`, `stale_view_resizes > 0`를 실제 집계한다. 1,000 seeds×200 events에서 사건별/거부별 coverage 출력, 실패 축소 유지. `cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core --all-targets` PASS, fmt/clippy PASS. 바뀐 모델 결과를 이전 200,000 사건 통계와 혼합하지 않는다.
- [x] **Step 5:** `git commit -m "feat: serialize terminal controls and coalesce resize"`.

## Task 4: 취소 가능한 russh 인증과 PTY transport

**Files:** Create `baton-ssh` manifest/src/tests (위 파일 표), `rust/tests/phase2/{auth,ssh}.test.mjs`; reuse existing ssh2 fixture/helper, 필요한 케이스만 추가. Modify workspace manifest/lock.

**Interfaces:** `Target{host:String,port:u16}`, `ConnectRequest{session,target,username,auth_method,initial_geometry}`; `AuthPrompt{attempt_id,challenge_id,kind,display,prompts:Vec<PromptField>}`와 `PromptField{text,echo}`; `AuthAnswer`는 host accept/reject, password, key+passphrase, interactive responses의 enum. attempt/challenge ID는 app에서 발급한 별도 u128 newtype이다. secret 타입은 Debug/Serialize를 구현하지 않는다. `AuthUi::ask(prompt)->IoFuture<Result<AuthAnswer,AuthError>>`는 bounded 한 번 응답 인터페이스. `connect(request,auth_ui,cancel)->Result<ConnectedSsh,SshError>`와 `ConnectedSsh::activate(runtime)->Result<SessionHandle,SshError>` 생산; raw russh 타입은 crate 밖으로 노출하지 않는다. SshError는 정해진 code만 app에 반환한다.

`tests/driver.rs`는 일반 libtest로 실행하지 않는다. manifest에 `[[bin]] name="baton-ssh-fixture-driver", path="tests/driver.rs", required-features=["acceptance"]`로 선언한다. Node helper가 `cargo +stable build --manifest-path rust/Cargo.toml --locked -p baton-ssh --features acceptance --bin baton-ssh-fixture-driver --message-format=json`의 executable 경로를 읽어 실행한다. fixture 선택·합성 인증정보는 길이 제한 stdin으로만 받고 argv/로그에 넣지 않는다. 일반 product build의 default feature에 acceptance를 넣지 않는다.

- [x] **Step 1:** Node ssh2 독립 서버 audit으로 host reject/cancel, wrong password, encrypted key/wrong passphrase, keyboard-interactive 2회, password partial-success→interactive, 취소 전/라운드 사이/PTY 전/late success를 작성한다. 취소 후 실제 success를 받는 케이스는 서버 auth 해제와 클라이언트 관측을 모두 확인하고 `pty=0`, `shell=0`, `connection_closed=1`을 assert한다. prompt replay/wrong attempt/다른 session 답변은 auth 효과 0회여야 한다.
- [x] **Step 2:** `cargo +stable test --manifest-path rust/Cargo.toml -p baton-ssh --no-run` 후 고정 버전 lock 검토. `node --test rust/tests/phase2/auth.test.mjs rust/tests/phase2/ssh.test.mjs` → 제품 driver의 계약 assertion FAIL. fixture/probe 성공을 제품 성공으로 대신하지 않는다.
- [x] **Step 3:** 단계0에서 확인한 `check_server_key`, authenticate API, PTY/shell Success 관측을 제품 actor로 구현한다. 사용자의 host 승인 전에 authenticate를 호출하지 않는다. challenge ID는 한 번 사용하고 stale answer를 폐기한다. key/plain secret은 필요한 범위만 소유하고 사용 후 `zeroize`로 지운다. JS/SDK 내부 복사의 완전한 메모리 소거까지 주장하지 않는다.

`Channel::split()`의 read/write half를 사용한다 (russh 0.63.1 로컬 소스 확인). read task는 Data/ExtendedData의 순서를 보존해 하나씩 코어에 전달하고 EOF/Close/오류 때 해당 세션만 닫는다. write/resize는 core 단일 작업 경로를 사용한다. SDK 송신 성공은 Delivered, 시작 이후 실패는 Uncertain이며 자동 재시도하지 않는다. SSH reader/connection supervisor는 하나의 소유 객체와 cancel/join 경로로 묶는다. transport Drop은 그 세션의 reader/SDK 작업도 중단한다. normal close는 channel close→disconnect→connection task 종료를 같은 종료 기한 안에서 기다린다. close callback 재수신은 보장하지 않는다.

- [x] **Step 4:** fixture 시험 PASS. 독립 서버 두 개/셸 네 개에서 A 출력·입력이 B에 섞이지 않고 A 종료 뒤 B 명령 성공. 실제 OpenSSH fixture에서 `stty size` 32×120→27×91, Ctrl+C→새 명령 marker, PTY/shell 거절·원격 exit·TCP close를 관측한다. session close와 reader가 서로 join을 기다리는 교착이 없어야 한다. blackhole 즉시 탐지·원격 작업 전체 종료는 주장하지 않는다.
- [x] **Step 5:** fmt/clippy+core+SSH 통과 후 `git commit -m "feat: connect authenticated SSH terminal transports"`.

## Task 5: Tauri 앱과 연결·인증 화면

**Files:** Create `rust/app` manifest/config/entry, `src-tauri/src/{app,commands,dto,auth_bridge,lifecycle,ids}.rs`, `tests/service.rs`, UI `auth`/`sessions`/`bridge` 파일. core/SSH Task 인터페이스 소비.

**Interfaces:** `AppService`가 Runtime, 세션 metadata, auth attempt, 유효 view를 소유한다. UI command는 `connect_session`, `answer_auth`, `cancel_connect`, `list_sessions`, `close_session`, `remove_closed_session`, `bind_terminal`, `user_input`, `ack_output`, `terminal_reply`, `resize_terminal`, `frontend_pong`으로 한정한다. Rust가 app/session/view ID·입력 Principal::User를 결정하고 UI의 `input_seq`를 검증해 core의 별도 사용자 입력 경로로 전달한다. command payload에 임의 principal/connection을 받지 않는다. DTO는 `deny_unknown_fields`를 적용한다. AppService 자체는 Tauri 타입 없이 시험 가능하게 하고 `commands.rs`가 Channel을 연결한다.

- [x] **Step 1:** AppService 시험에서 유효하지 않은 host/port/key size/prompt 답변, foreign view, closed session, startup 후16/17, 취소 직후 늦은 성공, 앱 종료 중 connect를 거부한다. 허용 command 목록에 agent handoff/exec/file-read가 없음을 검사한다. 인증표식이 로그/에러 DTO/세션 metadata에 없는지 fixture marker로 검사한다. UI 테스트에서는 응답 제출 후 secret field가 비워지고 다른 세션 challenge에 재사용되지 않음을 확인한다.
- [x] **Step 2:** `cargo +stable test --manifest-path rust/Cargo.toml -p baton-app --test service` 및 `npm.cmd test --prefix rust/app` → assertion FAIL. 순수 TS 시험은 tsc로 test output에 컴파일 후 Node test runner로 실행한다; WebView 검사라고 부르지 않는다.
- [x] **Step 3:** 독립 app package와 최소 Tauri capability/CSP를 만든다. 앱 전체 state는 Rust AppService이며 UI store는 표시용이다. 데이터는 textContent/xterm에만 넣는다. Tauri file/shell/opener plugin은 추가하지 않는다. main 로컬 window만 command 권한을 가진다. CSP remote script/navigation 차단. auth challenge는 Channel로 전달하고 취소/창 닫기 때 pending oneshot을 끝낸다. stale view가 붙거나 UI output channel이 끊기면 앱 모든 세션을 FrontendLost로 닫고 자동 복원하지 않는다.

frontend loss는 send 실패·reload/window event로 관측하고 backend challenge에 대한 heartbeat도 추가한다. heartbeat는 노출된 main window의 별도 control channel을 통해 5초마다 challenge, 마지막 유효 응답 이후 30초 만료로 정의한다. 숨김/최소화만으로 상태를 잃지 않게 실제 WebView에서 검증한다. 기한을 UI 환경 때문에 지킬 수 없다면 정상 최소화 종료를 수용하지 말고 관측 근거로 이 정책을 고쳐 다시 검증한다. heartbeat는 output ack를 대신하지 않는다.

- [x] **Step 4:** service/TS PASS, `npm.cmd run build --prefix rust/app` PASS, desktop build PASS. 실제 제품 실행에는 시험용 연결/명령 경로가 없음을 built assets와 invoke handler 목록으로 검사한다. preview를 보이게 실행할 때만 visible 창을 사용하고 background fixture는 hidden으로 시작한다.
- [x] **Step 5:** `git commit -m "feat: add desktop connection and authentication UI"`.

## Task 6: xterm 출력·일반 입력·프로토콜 응답 통합

**Files:** Create frontend `terminal/{terminal,input,output,queries}.ts`, backend `output_pump.rs`, acceptance frontend/config/bin; Modify `main.ts`, `sessions/store.ts`.

**Interfaces:** `TerminalView(binding, host, bridge)`는 한 session에 한 xterm을 만든다. `applySnapshot(snapshot)`, `write(frame): Promise<void>`, `setVisible(visible)`, `dispose()` 생산. Frame은 Rust UiFrame의 camelCase DTO이며 session/view/seq와 각 query의 epoch를 검증한다. `TerminalBridge`는 Task5 command를 typed Promise로 감싼다; 일반 입력에는 capture 당시 session/view/epoch/input_seq를 넣는다. 입력 epoch는 마지막 출력 frame에서 추정하지 않고 별도 최신 Snapshot에서 가져온다.

acceptance 전용 frontend entry와 Rust binary는 제품과 다른 dist/실행 파일/identifier를 쓴다. `baton-app`의 `desktop` feature는 실제 GUI build, `acceptance` feature는 `baton-ui-acceptance` binary에만 필요하게 한다. 각 시험은 같은 제품 TerminalView/AppService를 import하되 시험용 connection 등록·회수 제어는 그 binary에만 컴파일한다. AppService 생성 시 `Runtime::spawn`에 시험 연결을 미리 등록해 전달하는 방식으로 기존 trusted assembly를 쓰며, 단계3 dynamic IPC 등록을 선구현하지 않는다.

- [x] **Step 1:** 실제 Tauri Channel→xterm→typed reply→russh fixture 경로에서 DSR/CPR/DA 지원 응답 정확히1회, 중복/만료/다른 view/이전 epoch 0회, unsupported 조회가 뒤 토큰을 빌리지 않는다는 assertion을 쓴다. Phase0 38개 WebView 케이스의 해당 회귀 입력을 제품 컴포넌트에 다시 적용한다. `P(private)→Q(public)→R(private)→재전달`에서 UI PQR 유지, public에 해당 구간 Q만 노출, 새 stream에 저장된 P/R 없음. MCP 대신 core read로 검증했다고 명시한다.
- [x] **Step 2:** `pwsh -NoProfile -File rust/scripts/test-desktop.ps1 -Suite terminal` → 제품 연결 경로의 assertion FAIL. 지원 hook 없는 baseline에서는 기본 onData 응답이 올바르게 차단/분리되지 않아 실패해야 한다.
- [x] **Step 3:** xterm public parser hook만 사용한다. query 최종 byte를 처리하는 동안에만 해당 token을 활성화하고 그 이전 prefix에는 토큰을 주지 않는다. 지원 조회는 유효 token이 없더라도 기본 응답을 억제한다. old/expired reply 거부는 기대된 경계 결과로 처리하고 전체 UI 실패로 바꾸지 않는다. output payload를 과거 UI scrollback에서 만들지 않는다.

UserOwned에서만 onData를 일반 입력으로 보내고 Rust에서 재검사한다. 조합 시작의 binding/epoch를 기억해 회수 후 composition commit을 폐기한다. 정상 재전달 뒤 새 조합은 입력 가능해야 한다. 긴 paste는 16KiB UTF-8 이하 scalar 경계 조각으로 순서대로 보내되 전체 paste의 binding/epoch를 고정하고 최초 거부 후 나머지를 중단한다. 무제한 input Promise를 쌓지 않고 동시 in-flight UI call을 1개, 대기를32개로 제한한다; 포화 시 입력 거부를 UI에 표시하며 자동 재시도하지 않는다.

frame은 seq 순서로 xterm.write callback까지 완료한 뒤 ack한다. callback 전 ack·중복 ack·미래 ack는 금지한다. 여러 작은 frame의 합계도 64KiB를 넘지 않도록 Rust 예산을 사용한다. 구독자를 먼저 등록한 뒤 상태/queue를 확인해 마지막 출력의 wakeup 유실을 막고, pending output이 있으면 drain한 뒤 기다린다. 숨긴 탭도 renderer/parser는 계속 소비한다.

- [x] **Step 4:** terminal acceptance PASS. ack 정지 후 1MiB 초과는 해당 세션 명시적 종료·입력 차단, 다른 셸 유지. OSC52/긴 OSC·DCS·CSI·잘못된 수치는 clipboard read/write·file·navigation 0회. xterm private API나 source patch 없음. 입력 회수 전후 실제 서버 bytes=0/정확값을 검사한다.
- [x] **Step 5:** `git commit -m "feat: connect bounded terminal rendering and input"`.

## Task 7: 다중 세션 화면과 실제 resize

**Files:** Create frontend `terminal/geometry.ts`, complete `sessions/view.ts`/styles; Add `rust/tests/phase2/desktop.test.mjs` geometry cases and real OpenSSH test commands.

**Interfaces:** `GeometryObserver(binding,term,fit,bridge)`는 ResizeObserver/visibility event를 연결하고 `setVisible(bool)`, `dispose()`를 제공한다. UI는 safe resize_seq를 증가시켜 Task3 API 호출. core가 최종 rate/중복/권한 검사를 담당한다. 표시 geometry는 마지막 transport 전달 성공값이다.

- [x] **Step 1:** 연속91×27→120×32→91×27, 같은 값 반복, viewport0, 숨긴 탭, stale view callback, DPI100/150/200%에서 검사한다. 다른 셸 `stty size` 불변, 현재 셸 최종 원격 크기=최종 fit, 100ms 내 중복 전송 없음, epoch/stream/cursor 유지. 비공개 vi 문서의 resize 재출력이 public에 새로 들어올 수 있음을 별도 fixture로 검증한다.
- [x] **Step 2:** `pwsh -NoProfile -File rust/scripts/test-desktop.ps1 -Suite geometry` → geometry/대상 assertion FAIL.
- [x] **Step 3:** 보이는 양수 viewport에서만 FitAddon을 사용하고 규격 범위로 clamp한다. 숨긴 탭/최소화 동안 resize를 보내지 않고 복귀 때 다시 측정한다. Tab DOM를 숨겨도 xterm 인스턴스를 폐기하지 않는다. 세션 이름 변경/목록 순서 변경은 binding을 바꾸지 않는다. 마지막 닫힌 탭 제거 후도 다른 셸에 늦은 callbacks를 보내지 않는다.
- [x] **Step 4:** geometry acceptance PASS. 같은 서버2셸+별도서버1셸에서 interactive vi에 입력→저장 없이 종료, interactive top→resize→종료, Ctrl+C 이후 같은 셸 명령 성공. batch top만으로 대체하지 않는다. 실제 키/IME/DPI 관측은 Task8 기록이 없으면 미확인으로 남긴다.
- [x] **Step 5:** `git commit -m "feat: fit independent terminal views to remote PTYs"`.

## Task 8: Windows 인수·프로세스 정리·실패하는 runner

**Files:** Create scripts/report/manual/runner/cleanup test files listed above. Existing Phase0 helpers는 공통 수정이 필요할 때 그 회귀도 수행하며 기존 요약 파일을 덮어쓰지 않는다.

**Interfaces:** `verify-phase-2.ps1 [-ManualEvidence path]` → 0 전부 충족 / 1 실패 / 2 자동 통과·필수 수동 미확인. `test-desktop.ps1 -Suite terminal|geometry|lifecycle`은 소유한 실행물만 정리한다. `record-phase-2-manual.ps1`은 관측 기록 수집/형식 검증만 하며 성공값을 자동 작성하지 않는다.

- [x] **Step 1:** runner 사본에서 외부 command 실패, 필수 test/case 누락, ignored/skip, stale sourceDigest/manual receipt, 없는 screenshot, descendant 잔존을 주입한다. 각각 exit1 또는 수동 미확인 exit2여야 한다. pass 수는 로그의 실제 결과에서 계산한다. runner를 auth 대기·UI ack 대기·cleanup 직전에 실제 중단시키는 시험을 먼저 실패시킨다.
- [x] **Step 2:** `node --test rust/tests/phase2/runner.test.mjs rust/tests/phase2/cleanup.test.mjs` → 누락/잔존을 성공으로 처리하는 초기 runner assertion FAIL.
- [x] **Step 3:** source/lock/executable hash, commit/dirty, Rust/Node/WebView2/Windows 버전, 명령·시간·pass/fail/skip, fixture ID와 정리 결과를 `artifacts/rust-phase-2/<run-id>/`에 기록한다. 전체 output은 합성 fixture만 저장한다. 타임아웃/수동 미확인/환경 부재를 pass로 바꾸지 않는다.

소유 프로세스는 생성 직후 root PID+시작 시각+실행 경로를 기록하고, 살아 있는 동안 해당 WebView user-data-dir과 부모 계통으로 자손 PID+시작 시각을 기록한다. root가 죽은 뒤 현재 PPID만 보고 소유권을 추정하지 않는다. 긴 WMI query를 cleanup의 유일한 방법으로 사용하지 않는다. 관찰 자체에 기한을 두고 입증되지 않은 프로세스는 이름으로 일괄 종료하지 않는다. 정상 앱 close에서 자손이 스스로 끝났는지와 runner 비정상 종료 뒤 강제 정리했는지를 별도 결과로 보고한다. 두 번째 sentinel 앱/WebView는 살아 있어야 한다.

원래 전체 물리 case ID: `physical-key`, `physical-paste`, `ime-commit`, `ime-reclaim-mid-composition`, `mouse`, `hidden-restore`, `minimize-restore`, `dpi-100`, `dpi-150`, `dpi-200`, `interactive-vi`, `interactive-top`, `webview-descendant-exit`. UserOwned/AgentOwned 둘 다 실제 OS 이벤트로 수행하고 fixture 서버 byte audit과 화면을 함께 기록한다. `term.paste()`/JS event dispatch는 물리 붙여넣기 증거가 아니다. native UI automation이 없으면 사용자가 수행할 순서와 현재 exe 경로를 제공하고 해당 gate만 pending으로 남긴다.

2026-10-06 사용자 승인에 따른 범위 조정: `dpi-100`, `dpi-150`, `dpi-200`의 실제 Windows 배율 전수 검사는 Windows 배포 전 호환성 검사로 이관한다. 현재 배율에서의 창 크기 변경은 기존 vi/top 관측의 PTY `141×39 → 314×75 → 141×39` 증거를 재사용한다. 실제 배율 숫자와 다른 배율에서의 잘림·가독성·마우스 좌표는 미검증으로 남긴다. 앞선 Step 1의 DPI 표현을 실제 배율 관측 완료로 해석하지 않는다. 현행 전체 수집기의 목록과 기존 receipt는 변경하지 않으므로 `manual_pending`을 성공으로 재분류하지 않는다. 동일 실행·case/mode·관측 주체 등 나머지 인수 증거 요건의 정리는 별도 남은 작업이다.

수동 증거에는 현재 source/lock/executable hash, OS/WebView, case별 관측 시각·화면 경로·byte audit/run ID·사용자 확인을 요구한다. 화면 하나로 byte 차단/프로세스 종료를 입증하지 않는다. 코드가 바뀌면 영향받는 이전 증거를 무효화한다.

2026-10-08 구현 반영: 위 10-06 문단은 당시의 상태다. 승인된 schemaVersion 2 수집기는 같은 빌드의 독립 실행을 원본 ID/시각/관측자/해시로 연결하고, IME 회수와 vi는 같은 실행의 연속성을 강제한다. 종료는 실제 lifecycle 증거로, DPI 보류는 승인 내용과 배포 전 기한으로 표현한다. 명시한 수집기 파일 외 source 변경과 exe/lock 변경은 거부한다. 새 수집기 9개와 기존 runner 7개가 통과했고 vi 연속 시험도 완료했다. 이전 입력·IME와 최신 vi의 exe 해시가 달라 빌드별로 증거를 분리했으므로 Step 4/5 및 Phase 2 완료 표시는 유지하지 않는다. 자세한 상태는 인수 기록의 최신 절을 따른다.

- [x] **Step 4:** 자동 검사 및 실제 Windows 관측을 수행했다. 2026-10-08 소스 검토에 따른 기존 증거 인정으로 완료; strict runner exit 0을 얻었다는 뜻은 아니다. 아래는 원래 검증 명령이다. 외부 실패 코드를 즉시 검사한다.

```powershell
cargo +stable fmt --manifest-path rust/Cargo.toml --all -- --check
cargo +stable clippy --manifest-path rust/Cargo.toml --locked -p baton-core -p baton-ssh -p baton-app --all-targets --features baton-app/desktop -- -D warnings
cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core -p baton-ssh -p baton-app --all-targets
npm.cmd test --prefix rust/app
npm.cmd run build --prefix rust/app
node --test rust/tests/phase2/auth.test.mjs rust/tests/phase2/ssh.test.mjs rust/tests/phase2/desktop.test.mjs rust/tests/phase2/runner.test.mjs rust/tests/phase2/cleanup.test.mjs
pwsh -NoProfile -File rust/scripts/verify-phase-2.ps1 -ManualEvidence <actual-receipt.json>
```

Expected: 자동 suite PASS/0 ignored, source 동일, 제품 Debug/acceptance 대상 구분, 실제 Windows 필수 case 모두 관측 시만 최종 exit0. 단계0 API probe 전부를 매번 재실행하지 않는다. 공유 dependency pin을 바꿨다면 영향받는 probe 시험을 추가한다. 단계1 verify/mutation 스크립트의 고정 suite 목록과 치환 anchor가 달라졌으면 유지보수 후 여전히 누락/컴파일실패를 성공으로 오인하지 않는지 확인한다.

- [x] **Step 5:** `rust-phase-2-report.md`에 실제 관측·제한 및 2026-10-08 사용자 승인 종료 결정을 기록했다. 기존 최종 리뷰의 Important 2건 수정·검증은 보고서에 남겼다. 미실시 DPI와 과거 exe 직접 비교 부재는 한계로 유지한다. 추가 반복 시험이나 새 커밋·병합을 단계 종료 조건으로 두지 않는다.

## 완료 판정과 다음 단계

| 요구 | 담당 | 단계 2에서 주장할 수 있는 범위 |
|---|---|---|
| AUTH-01/02 | 1,4,5,8 | 사용자 인증/취소+제품 SSH fixture 실제 효과 |
| VT-01~03 | 2,3,6,8 | 지원 조회·구조화 응답·일반 입력 차단, 완전한 VT 호환성 아님 |
| VT-04 | 4,7,8 | 실제 interactive vi/top, 대체 화면·커서·셸 복귀 |
| UI-01 | 5,6,7 | 탭·대상·화면 유지; MCP 연결 선택 UX는 단계 3 |
| UI-02/03 | 1,5,6,8 | frontend loss·정상 종료·bounded 소비, 크래시 화면 복원 없음 |
| GEO-01/02 | 3,7,8 | 실제 stty와 UI fit, 숨김·DPI·경합 |
| OWN/IN/OUT/NUM 회귀 | 1,2,3,6 | core + acceptance 연결에서 정책 유지; 실제 MCP 검증 아님 |
| LIFE 일부 | 1,4,5,8 | 이 앱 소유 SSH/reader/WebView 종료. OpenSSH 원격 작업 비교는 단계 5 |
| 단계0 미확인 7항목 | 8 | 물리 입력·숨김/최소화·renderer를 실제 관측해야 해소 |

단계 3: 인증된 IPC/MCP v2, 여러 연결 배정·전달·회수 UI, sudo 개입 UX. 단계 4: 앱 offline/재실행과 어댑터 수명, 재접속 ID 변이. 단계 5: 배포본·OpenSSH 비교·4면 각30분 fuzz·2시간 soak·100회 수명 반복·대상 OS 인수. 이 후속 항목을 Phase2 통과 수에 포함하지 않는다.

## 계획 자체 점검

- 승인된 큰 구조를 유지하며 단계1의 live Runtime 부족, private ingress 보존, attach/shutdown gate를 각 Task1/2/3으로 연결했다.
- API의 ID/geometry/query/view 타입과 파일 소유를 위에 고정했다. query 수신 metadata는 UI pump에서 재발급하지 않는다.
- 실행 전 원본 코드를 확인한 근거: Phase0 russh auth/PTY probe, russh0.63.1 `Channel::split`/`window_change`, xterm public hook 구현 및38개 회귀, core55와 최종리뷰 보고서. 최신 라이브러리로 업그레이드했다는 뜻이 아니다.
- 새 정책(인증/입력 상한·기한·heartbeat·사용자용 연결 UI)은 이 계획 검토 범위로 명시했다. frontend freeze와 최소화를 구별하는 실제 시험이 실패하면 수동 gate를 완화하지 않고 정책을 재검토한다.
- 이번 문서 작성에서는 코드·dependency·사용자 서버·하네스·제품 실행을 변경하지 않았다. 구현 및 새 시험 실행은 계획 검토 후 Native로 진행한다.
