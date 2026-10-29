# Baton Rust Phase 3 MCP and Ownership Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. 기존 Native 실행 방식을 유지한다. Steps use checkbox syntax for tracking.

**Goal:** 사용자가 Rust Baton의 여러 SSH 셸을 선택한 MCP 연결에 전달·회수하고, 에이전트가 자기에게 배정된 공개 구간만 읽고 제어하도록 한다.

**Architecture:** `baton-ipc`가 인증된 Windows pipe와 제한된 v2 메시지를 담당하고, `baton-adapter`가 stdio MCP 5개 도구를 제공한다. 앱은 기존 Runtime을 통해 권한을 판단하며 Tauri 전용 명령으로만 전달·회수한다. 코어·wire·UI 경계를 분리하고 endpoint 재발견·자동 재연결은 Phase 4에 남긴다.

**Tech Stack:** Rust 1.88 / edition 2024, 현재 lock의 Tokio 1.53.1, 검증된 rmcp =3.4.0, serde/serde_json, getrandom =0.3.4, zeroize =1.9.0, Windows API 경계는 windows-sys =0.61.2. 기존 Tauri 2.11.6·TypeScript·xterm.js 유지. 새 버전으로 일괄 갱신하지 않는다.

**Spec:** [승인된 전환 설계 §§4–11](../specs/2026-09-20-rust-transition-design.md), [검증 기준](../specs/2026-09-20-rust-verification-design.md). Phase 2 종료 결정은 [인수 기록](../../testing/rust-phase-2-report.md)의 최종 절이 우선한다.

상태: 2026-10-09 Tasks 1–8 구현·자동 검증·독립 리뷰 수정 완료. Rust 150 / UI 15 / Node 12 통과, 실패·skip 0. 실제 모델 sudo는 pending이며 Phase 2 DPI 보류를 유지한다. [최종 인수 기록](../../testing/rust-phase-3-report.md)을 따른다. 기존 `codex/rust-phase-0` worktree와 Phase 2 원본 증거를 보존한다.

## 범위와 성공 장면

한 대화에서 앱 서버와 DB·파일 서버를 함께 다루되 셸마다 독립 SSH 연결을 쓴다. 시험에서는 MCP 연결 A에 두 서버의 셸 3개, 연결 B에 같은 서버의 별도 셸 1개를 배정한다. A의 입력·조회는 B에 영향을 주지 않는다. 사용자가 회수해 개인 작업을 한 뒤 재전달해도 개인 구간의 저장 출력이 MCP에 나타나지 않는다.

Desktop/CLI 동시 사용 실험 보류는 유지한다. 독립 stdio 프로세스 두 개의 격리는 자동 검증하며, 같은 MCP 연결을 공유하는 대화를 구별한다고 표시하지 않는다. 실제 하네스 선택·설정 변경은 별도 명시된 사용자 요청에 따라 수행한다.

Phase 3에서 새로 검증할 것은 인증·wire·실제 전달 UI·공개 경계다. 앱 없음에서 MCP initialize/list/status가 동작하고 연결 단절 후 offline을 반환하는 기본 동작은 필요하다. 그러나 자동 재시도·앱 재실행 재인증·장시간 offline 수명은 Phase 4의 완료 조건이다. Unix endpoint 구현 및 해당 OS 인수는 후속 OS 추가 때 수행한다. Windows 외에서는 명시적인 unsupported 결과를 내며 임시 TCP/로컬 셸로 우회하지 않는다.

## Global Constraints

- 앱당 연결 32 / SSH 세션 16. 연결마다 별도 인증 문맥; 호출 인자의 owner/connection_id는 받지 않는다.
- 일반 입력 UTF-8 16 KiB, 셸별 대기 32건. 에이전트 이력 4096건/epoch. 사용자 입력은 기존 단조 sequence 경로를 유지한다.
- 공개 출력 1 Mi UTF-16 단위, read limit 2–32768, wait_ms 0–10000, 연결당 대기 read 8개·진행 요청 16개.
- JSON frame payload 최대 256 KiB. 길이 검사 전 payload 크기로 할당하지 않는다. UI 원본 바이트·과거 스크롤백은 IPC로 노출하지 않는다.
- ID는 128bit 난수의 32자리 hex 문자열. control_epoch/cursor/sequence는 기존 SafeInt, 0..2^53−1 정수. 증가 시 순환 금지.
- 개입 reason UTF-8 2 KiB, 제어문자 거부. 자동 회수·Ctrl+C·Enter·sudo 옵션 수정·실패 명령 재전송 없음.
- 전환/앱 종료의 기존 5초 예산 유지. 원격 명령 완료를 기다리는 뜻이 아니다. `delivered`는 송신 결과다.
- C# endpoint·실행 파일·사용자 하네스 설정 유지. 실제 홈서버 대신 격리 fixture만 자동 변경한다.
- SSH 인증정보, endpoint secret, 사용자 입출력, 원문 예외를 진단 로그/stdout에 쓰지 않는다. 합성 시험 데이터만 artifact에 남긴다.
- Phase 2의 IME·vi 관측을 해시만 달라졌다는 이유로 반복하지 않는다. 제품·입력 경로·의존성 변경의 영향으로 재시험 범위를 결정한다.

## Review Focus

1. 연결 선택 후 그 연결이 사라지는 경쟁: 전달 거부, 다른 연결 자동 선택 없음 (Tasks 2, 6).
2. pending 입력의 MCP 취소가 queued/이미 시작된 쓰기에 다르게 작용: 미시작만 무효화, 부분 송신은 uncertain (Tasks 2, 4, 5).
3. read 완료 후 IPC 응답이 writer 큐에 머무는 동안 회수: 반환 직전 권한 재확인, 비공개 수신 0바이트 (Task 4).
4. 개입 요청 재시도·거절·전달 경계: 알림 폭증·명령 승인 오인·이전 epoch 알림 복원 없음 (Tasks 2, 6, 7).
5. 로그·직렬화·UI에 섞이는 제어문자와 메타데이터: JSON escape, textContent, 안전한 오류 코드, 비밀 미노출 (Tasks 1, 3, 5, 7).

## 구현 전 확인한 차이와 파일 배치

`Registry::register_connection/status_for`는 존재하지만 Runtime은 시작 때의 연결 목록으로 예산을 만들며 실행 중 등록 API는 없다. `SessionHandle::handoff/reclaim/read/submit/cancel_input/input_result`는 재사용한다. `Snapshot`에는 state/epoch/assigned/stream만 있으므로 개입 정보와 wire 출력용 ID 변환을 추가해야 한다. 기존 `dto::Id`는 UI 타입이며 코어 ID의 내부 정수는 비공개다.

제품 `commands.rs`에는 전달·회수 명령이 없다. `acceptance.rs`는 고정 connection=1 시험 연결이므로 제품 IPC로 승격하지 않는다. `SessionViews`는 세션별 xterm 인스턴스를 유지하므로 여기에 소유 전환을 연결한다. `AppService::list()` 전체 목록을 그대로 MCP status로 반환해서는 안 된다.

| 경로 | 책임 |
|---|---|
| `rust/crates/baton-ipc/src/{lib,wire,codec,error}.rs` | SDK 독립 v2 DTO, frame, 오류 |
| `rust/crates/baton-ipc/src/{endpoint,endpoint/windows,client,server}.rs` | OS 발견/인증, 제한된 다중화 |
| `rust/crates/baton-adapter/src/{main,tools,policy,link}.rs` | rmcp stdio, 5도구, 상태·취소 연결 |
| `rust/crates/baton-core/src/{types,input,session,intervention,runtime/connections}.rs` | 신원·연결 등록·개입·중복 처리 |
| `rust/app/src-tauri/src/{agent_bridge,ownership}.rs` | 인증 문맥에서 코어 호출, UI 전환 |
| `rust/app/src/{connections/view,sessions/ownership}.ts` | 연결 선택·전달/회수·개입 배지 |
| `rust/tests/phase3/` | stdio/실제 pipe/OpenSSH/WebView 인수 |
| `rust/scripts/verify-phase-3.ps1` | 영향 범위 기반 검증·산출물 보존 |

## 고정할 wire 및 조립 계약

아래는 새 구현 인터페이스이며 현재 코드에 존재한다고 가정하지 않는다.

- `WireId(u128)`: 32자리 hex만 deserialize, serialize는 소문자. 코어 ID에 `as_u128(self) -> u128` 읽기 변환을 추가하고 `from_u128`과 명시적으로 변환한다. 문자열 ID만으로 권한을 얻지 못한다.
- `AgentRequest`: `Status`, `ReadOutput { session_id, control_epoch, stream_id, cursor, limit, wait_ms }`, `SendText { session_id, control_epoch, request_id, text }`, `SendKey { session_id, control_epoch, request_id, key }`, `RequestUserControl { session_id, control_epoch, request_id, reason }`. unknown fields 거부. epoch/stream 생략 시 오류.
- `AgentResponse`: `Status(StatusResult)`, `Output(OutputPage)`, `Input { result: delivered|input_invalidated|uncertain }`, `Intervention { result: queued|duplicate }`. 내부 Pending은 전송 완료 응답으로 내보내지 않는다.
- `StatusResult`: `contract_version:2, app_state:online|offline, app_instance_id:WireId?, connection_id:WireId?, sessions:Vec<AgentSession>`. offline은 ID=null, sessions=[]; 인증 실패/버전 오류는 별도 오류.
- `AgentSession`: `session_id,label,target:{host,port,username},state,control_epoch,stream_id,geometry:{columns,rows},intervention:null|{request_id,reason,state:requested|declined}`. geometry는 마지막 정상 resize 요청값. 자신에게 배정된 closed/user_owned 상태도 보여주되 I/O는 기존 권한 검사로 거부한다.
- `OutputPage`: `text,next_cursor,oldest_cursor,end_cursor,has_more`. UTF-16 커서를 byte offset으로 바꾸지 않는다.
- `WireError { code, oldest_cursor?:SafeInt }`: 명시적인 CoreError→snake_case 매핑. `not_owner`, `session_closed`, `control_unavailable`, `stale_control_epoch`, `stale_stream`, `cursor_expired`, `request_id_conflict`, `uncertain`, `app_offline`, `authentication_failed`, `protocol_mismatch`를 구분한다. 내부 Debug/OS 오류 원문을 전송하지 않는다.
- `ConnectionContext`: 인증 뒤 앱이 만든 app/connection ID를 소유하는 타입. 역직렬화 불가. 서버만 생성하고 클라이언트 supplied identity로 교체하지 않는다.
- `AgentBackend` trait (baton-ipc): `connected(ConnectionContext)->IpcFuture<Result<(),WireError>>`, `dispatch(ConnectionContext,AgentRequest,CancellationToken)->IpcFuture<Result<AgentResponse,WireError>>`, `disconnected(ConnectionContext)->IpcFuture<()>`. `IpcFuture<'a,T>`는 boxed Send future. CancellationToken은 현재 lock의 tokio-util 것을 사용한다.
- `LocalClient::connect(endpoint_dir:&Path)->Result<Self,WireError>` 및 `call(&self,AgentRequest,CancellationToken)->Result<AgentResponse,WireError>`는 async. `LocalServer::start(endpoint_dir:&Path,app:WireId,backend:Arc<dyn AgentBackend>)->Result<Self,WireError>`와 `shutdown(&self)`도 async. shutdown 때 신규 admission을 먼저 차단한다.

IPC는 4-byte little-endian payload 길이 + UTF-8 JSON이다. payload 0 또는 262145 이상은 본문 읽기/할당 전 연결 종료. 요청 envelope는 `{type:"request",id:SafeInt,body:AgentRequest}`, 응답은 동일 id와 result/error 중 하나, 취소는 `{type:"cancel",id:SafeInt}`. 클라이언트 id는 연결 내 단조 증가하고 재사용하지 않는다. 중복/역순 id는 프로토콜 오류로 연결을 닫는다. 이것과 도구 request_id의 의미적 중복 제거를 구분한다. 종료·취소 처리는 일반 요청 16개 예산 밖 제어 경로다.

인증 첫 frame은 `{type:"hello",contract_version:2,app_instance_id,secret}`이고 서버는 인증 후 connection_id를 반환한다. 연결·인증 전체 3초, 비밀은 앱 실행마다 OS 난수 32bytes. 실패 연결을 Registry에 등록하지 않는다. 클라이언트도 받은 instance가 발견 파일과 같은지 검사한다.

## Task 1: 제한된 v2 메시지와 frame codec

**Files:** Create `rust/crates/baton-ipc/Cargo.toml`, `src/{lib,wire,codec,error}.rs`, `tests/wire.rs`; Modify `rust/Cargo.toml`, `rust/Cargo.lock`, `rust/crates/baton-core/src/types.rs`.

**Interfaces:** 위 WireId/AgentRequest/AgentResponse/WireError. `read_frame<R:AsyncRead+Unpin>(&mut R)->Result<Frame,WireError>`, `write_frame<W:AsyncWrite+Unpin>(&mut W,&Frame)->Result<(),WireError>`는 async. 출력 직렬화도 256 KiB 제한 writer를 사용한다.

- [x] 실패 시험 작성: `frame_limit_before_allocation`은 0/262145/0xffffffff 거부 및 body read=0; `partial_frame_eof`는 잘린 header/body 실행=0; `strict_ids_numbers`는 31/33자리 ID, 음수/소수/2^53 값, 누락 epoch와 unknown owner 거부. `escaped_output_fits`는 제어문자 32768단위의 JSON escape 후에도 제한을 지킨다.
- [x] `cargo +stable test --manifest-path rust/Cargo.toml -p baton-ipc --test wire`로 미구현 실패 확인. 의존성 추가 때만 lock을 의도적으로 갱신하고 기존 pin 변화 검사.
- [x] DTO·codec·오류 매핑과 ID 변환 구현. decoder에서 unbounded 문자열 선할당/recursive JSON 무제한 처리를 허용하지 않는다. key는 Enter/Ctrl+C/Tab/Escape/Ctrl+D/Backspace만 허용.
- [x] 같은 명령에 `--locked`를 추가해 통과 확인. 전체 frame 길이와 serialized response를 검사하고 stdout escape 직접 출력 금지.
- [x] 관련 파일만 커밋: `feat: define bounded Rust MCP v2 wire contract`.

## Task 2: 동적 연결과 개입 요청의 코어 계약

**Files:** Modify `rust/crates/baton-core/src/{lib,types,input,session,runtime}.rs`; Create `src/{intervention,runtime/connections}.rs`, `tests/{connections,intervention}.rs`; update existing input/control/model tests only where contracts change.

**Interfaces:** `Runtime::register_connection(ConnectionId)->Result<(),CoreError>`, `status_for(ConnectionId)->Result<Vec<(SessionId,Snapshot)>,CoreError>`, `app_id()->AppId`. 기존 async disconnect 사용. `SessionHandle::request_user_control(connection,epoch,request_id,reason:String)->Result<InterventionResult,CoreError>` 및 `decline_intervention(epoch,request_id)->Result<(),CoreError>`는 async. Snapshot에 Option<Intervention> 추가; InterventionResult=Queued|Duplicate. `wait_input_result(principal,epoch,request_id)->Result<InputResult,CoreError>`는 watch 알림을 사용하며 변경 알림 등록 후 재확인한다.

- [x] 실패 시험: 32연결 허용/33번째 거부, 종료 시작 이후 register 거부, disconnect와 register 경합에서 유령 예산 없음. A 두 셸/B 한 셸에서 A disconnect는 A AgentOwned만 닫고 회수된 UserOwned는 유지·배정 해제.
- [x] 실패 시험: 개입 reason 2048bytes 허용/2049 거부·제어문자 거부; 같은 id/내용은 Duplicate, 다른 내용은 conflict, 한 셸에 pending 알림은 하나(다른 id는 Busy). 거절 뒤 같은 id 재시도는 알림 재생 없음. 회수/닫힘/재배정 시 표시 제거·stale epoch 거부.
- [x] `cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core`로 신규 assertion 실패 확인.
- [x] registry와 budget 등록을 같은 admission 경계로 구현. lock 순서 registry→budgets→links를 문서화하며 await 중 Mutex 미보유. 개입은 세션 상태 안에서 검사·갱신하고 입력 전송을 만들지 않는다. 에이전트 4096건 이력에 개입도 포함되도록 Inputs의 record 종류를 Input/Intervention으로 분리한다. 같은 epoch/id를 서로 다른 종류로 재사용하면 conflict; 입력 두 도구의 동일 byte 중복 의미는 유지한다. 사용자 sequence 경로는 이력과 계속 분리한다.
- [x] `wait_input_result` 알림을 pending/완료 경계에 연결. 취소는 기존 cancel_input을 통해 미시작 요청만 무효화하고 이미 송신한 요청을 취소 성공으로 표시하지 않는다. 큐 32개 포화 중에도 회수·취소 처리 가능함을 확인.
- [x] core 전체 및 기존 1000×200 event 모델 검사 통과, 관련 변이(owner/epoch/중복)의 검출 유지. 관련 파일만 `feat: register live agent connections and intervention requests` 커밋.

## Task 3: Windows endpoint·인증·앱 잠금

**Files:** Create `rust/crates/baton-ipc/src/endpoint.rs`, `src/endpoint/windows.rs`, `tests/endpoint_windows.rs`; Modify IPC manifest/lock.

**Interfaces:** `EndpointLease::publish(dir:&Path,app:WireId)->Result<Self,WireError>`; `EndpointLease::discovery()`는 crate-private 비밀 포함 정보, `load_endpoint(dir:&Path)->Result<Discovery,WireError>`. 비밀은 Debug/Serialize 진단 출력 금지와 zeroize. lease가 lock 및 최초 pipe instance를 소유한다.

- [x] 실제 Windows 시험 작성: 잘못된 비밀/instance/version 인증 거부·등록0, DPAPI 변조 거부, app 중복 실행 거부, 다른 instance 발견 파일을 이전 lease가 지우지 않음. reparse point·느슨한 ACL·다른 owner 파일 거부.
- [x] `cargo +stable test --manifest-path rust/Cargo.toml -p baton-ipc --test endpoint_windows`로 실패 확인.
- [x] `%LOCALAPPDATA%/BatonRust/v2/endpoint.bin`과 `app.lock`, `\\.\pipe\baton-rust-v2-<instance>` 사용. 앱 토큰 SID에 한정한 protected DACL, remote pipe client 거부, 최초 instance 선점 방지. 임시 발견 파일도 처음부터 제한된 ACL로 만들고 DPAPI CurrentUser 보호 후 원자 교체한다. 비밀·instance·pipe만 저장하며 SSH 정보 제외. 파일 크기 상한 16 KiB, reparse 경로 거부와 핸들 기반 owner/DACL 검증.
- [x] 타 사용자 거부는 ACL 문자열 비교만으로 통과 처리하지 않는다. synthetic foreign SID 토큰의 AccessCheck + 현재 토큰의 성공을 자동 검사하고, 별도 실제 OS 사용자 시험을 하지 못하면 실제 cross-user 연결은 미실시라고 표시한다. 사용자 계정 생성/권한 변경은 이 작업에 포함하지 않는다.
- [x] 같은 suite `--locked` 통과 및 endpoint/pipe handles 정리 확인. 안전한 Win32 wrapper 안에 unsafe 범위 한정. 관련 파일만 `feat: authenticate Windows Rust IPC endpoints` 커밋.

## Task 4: 다중화된 IPC와 앱의 에이전트 호출 경로

**Files:** Create IPC `src/{client,server}.rs`, `tests/{multiplex,server_auth}.rs`; Create app `src/agent_bridge.rs`, `tests/agent_bridge.rs`; Modify app manifest/lib/app/lifecycle and main.

**Interfaces:** 위 LocalClient/LocalServer/AgentBackend; app에 `AgentBridge::new(Arc<AppService>)->Self`. UI 전체 목록 대신 Runtime::status_for 결과의 세션만 metadata와 결합. core geometry getter는 권한 검사 뒤 사용한다.

- [x] 실패 시험: 8대기 read 중 send 즉시 진행, 9번째 waiting read 거부, 16진행 요청/17거부. 32인증 연결·추가 연결 거부, 인증 전 pending socket도 32개로 제한. 응답 writer 지연 중 cancel/disconnect 처리, writer backpressure 상한 초과 시 연결 종료.
- [x] 실패 시험: A가 B session ID를 지정하면 read 0bytes/write 0회. `read_reclaim_before_flush`에서 read wake→회수→writer 허용을 장벽으로 고정해 오래된 응답을 반환하지 않음. 서버 쪽 권한 확인부터 응답 commit 사이 원자 경계를 정의하고 이후 이미 commit한 공개 bytes는 회수할 수 없음을 기록한다.
- [x] IPC/app 해당 suite 실패 확인 후 구현. reader task는 dispatch를 직렬 await하지 않는다. 연결당 16 slots와 응답 대기 큐 최대16, frame당256KiB; writer stall 3초에 연결 종료. 취소 control은 슬롯 미소비, 같은 id 취소는 idempotent. unknown/late cancel은 효과 없이 무시.
- [x] 송신 호출은 submit Pending→wait_input_result로 완료 대기. MCP/IPC 취소는 pending 입력의 cancel_input 호출 후 남은 wait를 정리. 단절 시 `Runtime::disconnect`를 반드시 한 번 호출; 전달된 결과를 새 connection으로 재생하지 않는다. IPC admission 중 앱 종료가 오면 새 등록/입력 불허.
- [x] `cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-ipc -p baton-app` 통과. 실제 pipe로 partial/EOF/무응답 client를 포함해 다른 연결이 유지되는지 확인. 관련 파일만 `feat: route authenticated IPC calls into Baton sessions` 커밋.

## Task 5: 실제 stdio MCP v2 어댑터

**Files:** Create `rust/crates/baton-adapter/Cargo.toml`, `src/{main,tools,policy,link}.rs`, `tests/tools.rs`; Modify workspace/lock; Create `rust/tests/phase3/{stdio,stdio.test}.mjs`.

**Interfaces:** binary `baton-adapter`; `AdapterLink`는 연결 상태와 LocalClient를 소유. rmcp 3.4.0 ServerHandler로 status/read_output/send_text/send_key/request_user_control만 등록. rmcp 취소 `RequestContext.ct`를 Task4 CancellationToken과 연결.

- [x] 실제 stdio 자식 프로세스 시험 먼저 작성: initialize/list의 정확한 5도구·contract_version2, 필수 schema, online unassigned 목록=[], 잘못된 epoch/stream 오류, 응답 JSON escape, stdout에는 MCP frame만 존재. `probe_wait` 등 Phase0 도구는 노출하지 않는다.
- [x] 앱 없을 때 initialize/list/status offline, 입력 app_offline. 연결된 뒤 앱 단절은 offline/캐시 폐기, stdin EOF는 IPC 닫고 어댑터 종료. 인증 실패·버전 불일치는 단순 offline과 구분한다. Phase3은 시작 시 연결 1회만 시도하며 Phase4에서 supervisor를 추가한다는 제한을 문서화한다.
- [x] `cargo +stable test --manifest-path rust/Cargo.toml -p baton-adapter`와 stdio 시험 실패 확인 후 구현. Parameter errors는 invalid_params, 도구 실행 오류는 isError+안전한 코드. status metadata와 원격 출력도 신뢰할 수 없는 데이터로 설명한다.
- [x] 정책에 최종 `sudo -n` 명령/인자/목적을 승인 전에 제시, 승인된 그대로 1회, 실패 후 새 승인, 사용자 비밀번호 대리 입력 금지, 인증 필요 시 개입 요청을 명시한다. 텍스트를 자동 수정하는 sudo 필터나 강제 승인 엔진은 추가하지 않는다.
- [x] `cargo +stable build --manifest-path rust/Cargo.toml --locked -p baton-adapter`; `node --test rust/tests/phase3/stdio.test.mjs` 통과. 느린 read와 취소 도중 EOF도 종료돼야 한다. 관련 파일만 `feat: expose Baton MCP v2 over stdio` 커밋.

## Task 6: 연결 선택·전달·회수·개입 UI

**Files:** Create app Rust `src/ownership.rs`, `tests/ownership.rs`; Modify `src/{app,dto,commands,main,lib}.rs`, capabilities as needed; Create UI `src/{connections/view,sessions/ownership}.ts`, `tests/ownership.test.mjs`; Modify `src/{bridge,main,style.css}`, `src/sessions/view.ts` only for integration.

**Interfaces:** UI-only `list_agent_connections()->Vec<ConnectionInfo>`, `handoff_session({id,expected_epoch,connection_id})`, `reclaim_session({id,expected_epoch})`, `decline_intervention({id,expected_epoch,request_id})`. AppService 메서드는 SessionInfo 또는 안전한 오류 코드를 반환한다. Rust에서 window와 epoch를 검사한다. `ConnectionInfo={id,display_name}`의 표시명은 권한 근거가 아니다. UI Event에 connections 목록 추가; SessionInfo에 assigned_connection/intervention 추가.

- [x] UI/service 실패 시험: 연결 없어 전달 불가, 사용자가 고른 connection이 사라지면 stale 선택 해제·다른 연결 자동 선택 없음. 이전 epoch 버튼 요청 효과0, 다른 탭 선택은 입력 대상 불변. 전달/회수 pending 동안 양측 입력 차단.
- [x] 개입 배지의 회수/거절 버튼 시험: 알림 수신 자체는 소유권·셸 상태 불변; 거절은 명령 실행 승인 아님; 회수 완료 후 사용자 입력만 가능. 이유 문자열 HTML/ANSI/control 내용은 textContent로 표시하고 wire validator 정책 유지.
- [x] service 및 `npm.cmd test --prefix rust/app` 실패 확인 후 구현. 기존 terminal 인스턴스와 scrollback 유지. 사용자 화면의 상단/스크롤 위치를 공개 cursor와 혼동하지 않게 ‘현재 화면’과 ‘에이전트 공개 구간’ 안내를 분리한다. 짧은 session/connection ID와 전체 ID 복사 제공; clipboard는 이 사용자 클릭에서만 사용.
- [x] core 전환 호출이 반환된 것만으로 완료 표시하지 말고 subscribe snapshot의 확정 state를 표시. 연결 목록 갱신과 소유권 변경은 Rust 이벤트가 근거다. `AppService` 상태 lock과 Runtime lock을 역순으로 획득하지 않는다.
- [x] service/UI suite 및 실제 WebView 소유 전환 시험 통과; 입력·터미널 코드를 바꾼 경우에만 해당 Phase2 회귀를 추가. 관련 파일만 `feat: hand off and reclaim sessions from the desktop UI` 커밋.

## Task 7: 실제 SSH·두 MCP 연결·공개 경계 인수

**Files:** Create `rust/tests/phase3/{fixture,integration.test,ownership.test,sudo.test}.mjs`, fixture-only app test entry under acceptance feature if necessary; reuse existing isolated SSH fixture and WebView driver without changing Phase2 receipts. Create `docs/testing/rust-phase-3-manual.md`.

**Interfaces:** fixture exports start/stop and independent server-side byte audit; two real `baton-adapter` stdio processes connect through real authenticated pipes. 시험용 UI 조작 통로는 acceptance binary/feature에서만 등록하고 제품 binary에서 불가함을 검사한다.

- [x] A에 두 서버·3셸, B에 같은 서버·1셸 배정. 서버 수신 식별 마커로 session별 정확한1회 송신, wrong-owner 효과0, 연결 A 종료가 B/회수된 사용자 셸을 닫지 않는지 외부 관측 assertion을 먼저 작성.
- [x] private marker→handoff→public marker→pending read→reclaim→private marker→다른 연결 재전달을 장벽으로 수행. MCP에 private 저장기록 없음, 새 stream/cursor0, stale epoch/stream 거부; UI는 같은 xterm에서 과거 화면 유지. 서버가 재전달 후 같은 문자를 새 출력하면 공개되는 계약도 검사한다.
- [x] sudo fixture는 인증 필요/권한 거부/이미 허용된 경우를 구분. 비밀번호 필요 결과를 인증 cache 부재로 단정하지 않는다. 개입 queued→사용자 회수→합성 자격으로 직접 처리→재전달까지 수행하며 자동 sudo -v/명령 재전송0을 검사한다. 합성 비밀도 MCP와 일반 진단 로그에서 발견되지 않아야 한다.
- [x] 구현 후 `node --test rust/tests/phase3/integration.test.mjs rust/tests/phase3/ownership.test.mjs rust/tests/phase3/sudo.test.mjs` 통과. UI 관측과 서버 바이트·권한 결과를 함께 저장한다. sudo 지침의 실제 모델 준수는 이 deterministic 시험으로 증명하지 않는다.
- [x] 실제 하네스의 목표만 주는 sudo 시험 절차를 문서화: 승인 전 최종 -n, 거절 시 미실행, 인증 필요 때 개입, 재전달 후 무단 재실행 없음. 선택한 하네스에서 이 항목을 실제 수행하기 전에는 SUDO-01 모델 동작을 pending으로 표시한다. 설정 자동 변경/보류한 Desktop+CLI 동시 실험은 수행하지 않는다.
- [x] 관련 파일만 `test: verify multi-connection SSH ownership and private output` 커밋.

## Task 8: 영향 범위 기반 검증과 인수 기록

**Files:** Create `rust/scripts/verify-phase-3.ps1`, `rust/tests/phase3/{receipt,receipt.test}.mjs`, `docs/testing/rust-phase-3-report.md`, `docs/rust-harness-setup.md`. 기존 C# 문서를 미래 제품 동작으로 덮어쓰지 않는다.

- [x] runner 실패 시험: 빠진 required suite, 실제 skip/fail, fixture 잔존, 없어진 증거 파일, 제품 변경을 collector-only로 속인 경우 각각 거부. 수동/하네스 관측이 없으면 pending이며 전체통과로 쓰지 않는다.
- [x] phase3 suite 전체와 변경된 core/app 회귀, fmt/clippy, 제품·어댑터 build를 실행하는 runner 작성. 빌드 단계 뒤 exe/PDB·프런트엔드·source inventory·lock·버전을 실행 ID 폴더에 보존하고 관측 단계에서 자동 재빌드하지 않는다. PowerShell 7 절대 경로 탐색/안내를 제공해 `pwsh`가 PATH에 없던 문제를 되풀이하지 않는다.
- [x] 검증 실행 예: `cargo +stable fmt --manifest-path rust/Cargo.toml --all -- --check`; `cargo +stable clippy --manifest-path rust/Cargo.toml --locked -p baton-core -p baton-ipc -p baton-adapter -p baton-app --all-targets --features baton-app/desktop -- -D warnings`; `cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core -p baton-ipc -p baton-adapter -p baton-app --all-targets`; `npm.cmd test --prefix rust/app`. Node 시험은 runner가 `rust/tests/phase3/*.test.mjs`의 실제 파일 목록을 열거해 `node --test`에 전달한다. 각 명령 직후 실패 코드를 검사한다.
- [x] 문서/수집기만 바뀌면 제품 재빌드·UI 반복을 하지 않는다. 코드/lock/실행 환경 변경은 영향받는 계약을 다시 검증한다. 서로 다른 exe hash의 증거 재사용은 source diff·환경 차이·기존 결과를 설명한 명시적 검토 판단으로 남기며 기존 엄격한 gate 결과를 덮어쓰지 않는다.
- [x] 최종 리뷰에서 권한/공개/취소/Windows unsafe 경계를 확인하고 중요한 지적은 재현→수정→관련 suite로 검증한다. Phase2 DPI 보류, Phase4 offline 재연결, Phase5 부하/출시 OS 검증은 이번 통과 수에 포함하지 않는다.
- [x] 보고서에 명령·버전·pass/fail/skip·실제 관측 주체·fixture 잔존·미실시를 기록한다. 관련 파일만 `test: record Rust Phase 3 acceptance and scope` 커밋. push/PR/merge는 별도의 명시된 작업으로 다룬다.

## 요구사항 대응과 자체 검토

| 요구 | 담당 | 완료 근거 |
|---|---|---|
| OWN-01..05 / IN-01..03 | 2,4,6,7 | 실제 pipe 두 연결, 서버 수신 횟수, 취소/소유권 경쟁 |
| OUT-01..05 / NUM-01 | 1,4,7 | frame/UTF16, private 비공개, 이전 epoch/stream 거부 |
| IPC-01/02 | 1,3,4 | 제한된 decoder, Windows ACL/DPAPI, 인증, 8/16/32 경계 |
| MCP-01 | 5,7 | 실제 stdio schema, 취소, stdout 오염 없음 |
| LIFE-02 / UI-01 | 2,4,6,7 | 어댑터 EOF의 대상 제한 종료, 회수 UI·표시 |
| SUDO-01 | 5,6,7 | 정책/개입 기능은 자동, 모델 준수는 실제 하네스 관측 |
| LIFE-01 / LIFE-03 | Phase4 / Phase5 | 이번 단계 성공으로 대체하지 않음 |

자체 검토: 현재 Runtime에 없는 동적 등록/입력 완료 대기는 Task2, ID 변환은 Task1에 명시했다. 개입의 4096건 이력·method 충돌·취소 시 이미 시작된 송신 효과를 포함했다. wire와 UI 명령을 분리하고 UI 전체 세션 목록이 MCP로 흐르지 않게 했다. 미검증 OS/실제 모델 동작을 성공으로 표시하지 않으며 기존 코어 기능을 새 IPC 계층에서 중복 구현하지 않는다.

## Windows 구현의 공식 자료

- [Microsoft: Named Pipe Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights): pipe의 DACL과 접근 검사. 기본 ACL에 의존하지 않고 대상 사용자를 명시한다.
- [Tokio: ServerOptions](https://docs.rs/tokio/latest/tokio/net/windows/named_pipe/struct.ServerOptions.html): custom SECURITY_ATTRIBUTES와 remote client 거부 API. 구현할 때 lock과 일치하는 로컬 SDK 소스에서도 호출 계약을 확인한다.
