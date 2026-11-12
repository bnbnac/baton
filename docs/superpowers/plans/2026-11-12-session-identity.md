# 세션 식별과 셸 소유 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude 세션이 모든 호출에 자기 UUID(`agent_key`)를 싣고, Baton 앱이 셸과 이름을 어댑터 연결이 아니라 그 키에 묶는다.

**Architecture:** 어댑터는 키를 해석하지 않고 전달한다. 앱의 에이전트 브리지가 호출의 `agent_key`를 같은 128비트 값의 `ConnectionId`(가상 연결)로 바꿔 코어에 넘기므로, 코어의 소유 판정·필터·예산은 그대로 세션 단위가 된다. 물리 IPC 연결은 인증 단위로만 남고 더 이상 레지스트리에 등록하지 않는다.

**Tech Stack:** Rust(`baton-ipc`, `baton-core`, `baton-adapter`, Tauri 앱 `rust/app/src-tauri`), TypeScript(`rust/app/src`), Windows 전용 IPC.

**Spec:** `docs/superpowers/specs/2026-11-12-session-identity-design.md` (이슈 #18)

## Global Constraints

- MCP/IPC 계약 버전은 **3**이다. v2 어댑터와 v3 앱은 핸드셰이크에서 거부된다. 버전 리터럴은 상수 하나(`baton_ipc::CONTRACT_VERSION`)로 모은다.
- 모든 도구는 필수 필드 `agent_key`(UUID 문자열)를 받는다. 키가 없거나 형식이 틀린 호출은 호환 모드 없이 **셸 정보 없이 거부**한다.
- 연결 한도 32(`limits::CONNECTIONS`), 동시 셸 한도 16(`limits::SESSIONS`), 연결당 요청 한도(`limits::REQUESTS`)는 그대로다. 가상 연결도 32에 포함된다.
- 한 셸은 한 소유자(키)만 갖는다. 한 키는 셸 여러 개를 가질 수 있다. 셸 ID는 화면에서 12자리로 표시한다.
- 물리 연결이 끊겨도 가상 연결과 거기에 묶인 셸은 남는다. 앱 종료 시 모두 소멸한다.
- sudo 실행별 사전 승인, 사용자 직접 인증과 명시적 전달, 전달 후 사용자 입력 차단, 입력 취소·불확실 처리 규칙은 바꾸지 않는다.
- 위조(다른 세션이 키를 알아내 사용)는 막지 않는다. 세션 기록 파일을 읽는 코드는 넣지 않는다.
- 화면 라벨의 "세션"은 "셸"로, 소유자 선택은 "Claude 세션"으로 쓴다. 드롭다운 항목은 `제목 · UUID 앞 6자리`, 이름이 없으면 `Claude 세션 · UUID 앞 6자리`.
- 커밋은 사용자가 요청할 때만 한다. 각 태스크의 커밋 단계는 "사용자 요청 시"에만 수행하고, 그때 `git add`는 파일을 명시한다(`git add -A` 금지).

## Review Focus

1. 같은 UUID를 대소문자·하이픈 유무만 다르게 보내도 같은 세션이어야 한다 (Task 1).
2. 키 없는 호출과 형식이 틀린 키는 셸 목록이나 오류 본문에 어떤 값도 새지 않고 거부된다 (Task 3).
3. 서로 다른 키 둘이 한 물리 연결을 쓸 때, 한쪽의 `session_id`로 다른 쪽이 읽기·쓰기를 해도 출력·입력이 변하지 않는다 (Task 4).
4. 연결이 32개에 도달해도 셸이 없는 가상 연결을 정리해 새 세션을 받아야 하고, 셸을 가진 연결은 지워지지 않는다 (Task 2).
5. 어댑터가 앱에 재접속하면 세션마다 붙인 이름이 키별로 정확히 복원된다 (Task 3).

---

### Task 1: IPC 계약 v3와 `AgentKey`

**Files:**
- Modify: `rust/crates/baton-ipc/src/wire.rs`, `src/endpoint.rs`, `src/endpoint/windows.rs`, `src/server.rs`, `src/client.rs`
- Modify (컴파일 따라가며 갱신): `rust/crates/baton-ipc/tests/server_auth.rs`, `tests/multiplex.rs`
- Create: `rust/crates/baton-ipc/tests/agent_key.rs`

**Interfaces:**
- Produces:
  - `pub const CONTRACT_VERSION: u32 = 3;` (`wire.rs`, `baton_ipc::*`로 노출). 소스의 `contract_version: 2`/`!= 2` 리터럴(`wire.rs` `StatusResult::offline`, `server.rs`, `client.rs`, `endpoint.rs`, `endpoint/windows.rs`)을 모두 이 상수로 교체한다.
  - `pub struct AgentKey(u128)` — `Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash`. `AgentKey::from_u128(u128) -> AgentKey`, `as_u128(self) -> u128`, `AgentKey::parse(text: &str) -> Option<AgentKey>`. `parse`는 하이픈 포함 36자(8-4-4-4-12)와 하이픈 없는 32자 16진수를 대소문자 구분 없이 받고, 그 외와 nil(모두 0)은 `None`. Serialize는 소문자 하이픈 36자, Deserialize는 `parse` 실패 시 `invalid_agent_key` 오류.
  - `AgentRequest`의 모든 변형(`Status`, `ReadOutput`, `SendText`, `SendKey`, `RequestUserControl`, `SetConnectionName`)에 첫 필드 `agent_key: AgentKey` 추가. `impl AgentRequest { pub fn agent_key(&self) -> AgentKey }`.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/agent_key.rs`:
  - `parses_hyphenated_and_plain_hex_case_insensitively`: `"3F39E1C4-70C2-475E-B0E7-B5891A42F330"`와 `"3f39e1c470c2475eb0e7b5891a42f330"`가 같은 키(`as_u128` 동일).
  - `rejects_malformed_keys`: `""`, 35자, 37자, 비16진 문자, 중괄호 포함, nil(`"00000000-0000-0000-0000-000000000000"`) 모두 `None`.
  - `serializes_as_lowercase_hyphenated`: JSON 직렬화 결과가 `"3f39e1c4-70c2-475e-b0e7-b5891a42f330"`.
  - `agent_request_requires_agent_key`: `serde_json::from_value({"method":"status"})`는 오류, `{"method":"status","agent_key":"<유효>"}`는 `AgentRequest::Status{..}`이고 `agent_key()`가 같은 값을 돌려준다. 같은 방식으로 `send_text`에서도 키 누락이 오류.
- [ ] **Step 2: 실행해 실패 확인** — `cargo test -p baton-ipc --test agent_key` (컴파일 오류 또는 FAIL)
- [ ] **Step 3: `wire.rs`에 `AgentKey`, `CONTRACT_VERSION`, `AgentRequest` 변경 구현** — `WireId`의 serde 구현을 본떠 파싱한다.
- [ ] **Step 4: 버전 리터럴 교체와 테스트 갱신** — 위 소스의 리터럴을 상수로 바꾸고, `tests/server_auth.rs`의 버전 변형(`if variant == 0 { 1 } else { 2 }`)과 `tests/multiplex.rs`의 `AgentRequest`/`contract_version`을 `CONTRACT_VERSION`과 새 필드에 맞춘다. 이전 버전 거부를 고정하는 테스트 `hello_with_previous_contract_version_is_rejected`(리터럴 `2`로 Hello 전송, `ProtocolMismatch` 기대)를 `server_auth.rs`에 추가한다.
- [ ] **Step 5: 통과 확인** — `cargo test -p baton-ipc` 전체 통과.
- [ ] **Step 6: 커밋 (사용자 요청 시)** — `feat: IPC 계약 v3와 agent_key 추가`

### Task 2: 코어 `ensure_connection`과 용량 정리

**Files:**
- Modify: `rust/crates/baton-core/src/registry.rs`, `src/runtime/connections.rs`
- Test: `rust/crates/baton-core/src/runtime/connections.rs`의 `mod tests`

**Interfaces:**
- Produces:
  - `Registry::prune_unassigned_connections(&mut self) -> Vec<ConnectionId>` — 어떤 셸의 `assigned`에도 없는 연결을 제거하고 제거한 ID를 돌려준다. 연결 제거 시 `remove_connection`의 의미를 따른다.
  - `Runtime::ensure_connection(&self, id: ConnectionId) -> Result<bool, CoreError>` — 이미 있으면 `Ok(false)`, 새로 등록하면 `Ok(true)`. 가득 찼으면(`Capacity`) 셸이 없는 연결을 한 번 정리한 뒤 다시 시도하고, 그래도 가득 차면 `Err(CoreError::Capacity)`. 종료 중이면 `Err(CoreError::SessionClosed)`. 락 순서는 기존 규칙(registry → budgets → links)을 지키고, 정리된 연결의 예산도 같은 락 안에서 제거해 레지스트리와 예산 집합이 항상 같게 유지한다.
- Consumes: 기존 `Runtime::register_connection`, `limits::CONNECTIONS`.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `ensure_connection_is_idempotent`: 같은 ID로 두 번 호출하면 `Ok(true)` 다음 `Ok(false)`, 연결 수 1.
  - `ensure_connection_prunes_unassigned_when_full`: 연결 32개를 채우고 그중 하나(`#5`)에 셸 하나를 핸드오프한 뒤 새 ID로 호출하면 `Ok(true)`이고 `#5`는 남으며 총 수는 32 이하, 예산 맵의 키 집합이 레지스트리의 연결 집합과 같다.
  - `ensure_connection_never_evicts_a_connection_that_owns_a_shell`: 연결 32개 중 셸을 가진 연결 여러 개를 두고 새 ID를 반복해서 넣어도 셸을 가진 연결은 하나도 사라지지 않는다. (셸 한도 16이 연결 한도 32보다 작아서 정리 후에도 가득 차는 `Capacity`는 한도가 바뀌지 않는 한 나오지 않는다. 오류 경로는 구현하되 테스트하지 않는다.)
- [ ] **Step 2: 실행해 실패 확인** — `cargo test -p baton-core ensure_connection`
- [ ] **Step 3: 구현** — `Registry`에서 셸 `assigned` 값을 모아 가진 연결과 비교한다(`Session.assigned`는 크레이트 내부 접근).
- [ ] **Step 4: 통과 확인** — `cargo test -p baton-core` 전체 통과 (기존 `registration_and_disconnect_never_leave_a_ghost_budget` 포함).
- [ ] **Step 5: 커밋 (사용자 요청 시)** — `feat: 코어에 ensure_connection과 용량 정리 추가`

### Task 3: 어댑터 도구 계약과 키별 이름 복원

**Files:**
- Modify: `rust/crates/baton-adapter/src/tools.rs`, `src/link.rs`
- Modify (컴파일 따라가며 갱신): `rust/crates/baton-adapter/tests/tools.rs`, `tests/common/mod.rs`, `tests/stdio_online.rs`, `tests/lifetime.rs`, `tests/startup_diagnostics.rs`

**Interfaces:**
- Consumes: Task 1의 `AgentKey::parse`, `AgentRequest`.
- Produces: `definitions()`의 여섯 도구 모두 `agent_key`(string, 패턴은 36자 또는 32자 16진수)를 `required`에 포함. `parse(name, args)`가 `agent_key` 누락·형식 오류를 `ErrorData::invalid_params("agent_key_required", Some(json!({"field":"agent_key","expected":"<형식 설명과 키를 구하는 방법>","actual_type":<종류>,"dispatched":false})))`로 거부한다. 틀린 값은 오류 본문에 담지 않는다(`request_id` 처리와 같은 원칙). 키 검사는 `request_id` 검사보다 먼저 한다. `link.rs`의 `State.name: Option<String>`을 `names: BTreeMap<AgentKey, String>`으로 바꾼다. `AdapterLink::call`이 `SetConnectionName`을 받으면 해당 키의 이름을 기록하고, 앱에 새로 연결될 때 `announce_name`이 기록된 모든 키의 이름을 순서대로 다시 보낸다. 3초 타임아웃과 "연결이 끊기면 `suspect` 표시" 규칙은 기존과 같고 하나라도 끊기면 중단한다. (Task 1 이후 `AgentRequest` 변형이 바뀌어 `link.rs`는 이 변경 없이는 컴파일되지 않으므로 같은 태스크에 둔다.)

- [ ] **Step 1: 실패하는 테스트 작성** — `link.rs` 테스트 모듈:
  - `names_for_two_keys_are_both_replayed_on_the_next_connection`: 오프라인에서 서로 다른 키 둘에 이름을 설정한 뒤 앱이 뜨면 두 이름이 모두 해당 키로 전달된다.
  - `a_later_name_for_the_same_key_replaces_the_earlier_one`.
  - 기존 `name_set_while_offline_is_announced_on_the_next_connection` 등은 키 필드에 맞춰 갱신한다.

  `tests/tools.rs`:
  - `every_tool_requires_agent_key`: 여섯 도구 각각 키 없이 `parse` 호출이 `Err`이고 메시지가 `agent_key_required`.
  - `agent_key_error_never_echoes_the_value`: 틀린 값(`"SECRET-not-a-uuid"`)을 넣었을 때 직렬화한 오류에 그 문자열이 없다.
  - `agent_key_is_accepted_in_both_notations`: 하이픈 36자와 32자 16진수 모두 `parse`가 `Ok`이고 같은 `AgentKey`.
  - `all_definitions_list_agent_key_as_required`.
- [ ] **Step 2: 실행해 실패 확인** — `cargo test -p baton-adapter` (컴파일 오류 또는 FAIL)
- [ ] **Step 3: 구현** — `definitions()`에서 `status`/`set_connection_name`의 빈 `props`에도 `agent_key`를 넣고, `parse`에 키 검증을 추가하고, `link.rs`의 이름 맵과 재전송을 구현한다. 도구 설명 문구는 Task 6에서 최종 정리한다.
- [ ] **Step 4: 기존 테스트 갱신** — 픽스처(`common/mod.rs`)의 `AgentRequest::Status {}` 등과 `contract_version: 2`를 새 형태·상수로 바꾸고, 도구를 호출하는 테스트에 유효한 키를 넣는다.
- [ ] **Step 5: 통과 확인** — `cargo test -p baton-adapter` 전체 통과.
- [ ] **Step 6: 커밋 (사용자 요청 시)** — `feat: 어댑터 도구에 agent_key 필수화와 키별 이름 복원`

### Task 4: 앱 브리지가 키로 가상 연결을 쓰게

**Files:**
- Modify: `rust/app/src-tauri/src/agent_bridge.rs`
- Test: `rust/app/src-tauri/src/agent_bridge_tests.rs`

**Interfaces:**
- Consumes: Task 1의 `AgentKey`, `CONTRACT_VERSION`, `AgentRequest::agent_key()`; Task 2의 `Runtime::ensure_connection`.
- Produces: `AgentBridge`의 새 내부 함수 `fn principal(&self, context: ConnectionContext, request: &AgentRequest) -> Result<core::ConnectionId, WireError>` — 기존 `check`(앱 종료 중·앱 인스턴스 ID 검사)를 거친 뒤 `ConnectionId::from_u128(request.agent_key().as_u128())`를 돌려준다. 동작 변경:
  - `dispatch`: 검증 후 `principal`로 가상 연결 ID를 얻고 `ensure_connection`을 호출한다. `Ok(true)`면 `publish_connections()`. `CoreError`는 기존 변환으로 `WireError`가 된다(가득 차면 `Capacity`).
  - `commit_response`와 `status`: 물리 연결 ID 대신 가상 연결 ID를 쓴다. `status`는 `contract_version: CONTRACT_VERSION`, `connection_id`는 **가상 연결 ID**(앱 목록의 연결 ID와 같다).
  - `connected`: 앱 종료·인스턴스 ID 검사만 하고 레지스트리에 등록하지 않는다. `disconnected`: 레지스트리와 이름에 손대지 않는다.
  - `SetConnectionName`: 가상 연결 ID를 키로 기존 `set_connection_name`을 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `agent_bridge_tests.rs`(기존 `session()`, `Writes`, `ConnectorFixture` 재사용):
  - `two_agent_keys_on_one_ipc_connection_see_only_their_own_shells`: 한 `LocalClient`에서 키 A, B로 각각 `Status`를 보내고, 셸 둘을 각 키의 가상 연결에 핸드오프한 뒤 각 응답에 자기 셸만 있다.
  - `foreign_key_cannot_read_or_write_another_keys_shell`: B 키로 A의 `session_id`에 `ReadOutput`/`SendText` → `NotOwner` 계열 오류, 이후 A의 출력 커서와 쓰기 기록이 변하지 않는다.
  - `one_agent_key_can_own_three_shells`: 셸 3개를 한 키에 핸드오프하면 `Status`가 3개를 보여주고 서로 다른 `session_id`다.
  - `connection_names_are_kept_per_agent_key`: 같은 물리 연결에서 두 키가 다른 이름을 설정하면 `list_agent_connections`에 두 이름이 따로 나온다.
  - `first_call_registers_the_agent_connection_in_the_app_list`: 새 키의 `Status`만 호출해도 목록에 항목이 생긴다.
  - `status_connection_id_matches_the_app_list_id`.
  - `shells_stay_assigned_after_physical_disconnect_and_same_key_reattaches`: 핸드오프 후 클라이언트를 닫고 새 `LocalClient`로 같은 키 `Status`를 보내면 셸이 `agent_owned`로 남아 있고 `SendText`가 전달된다.
  - 기존 `real_ipc_bridge_filters_owners_and_blocks_foreign_read_and_write`는 핸드오프 대상을 물리 연결 ID가 아니라 키의 가상 연결 ID로 바꿔 갱신한다.
- [ ] **Step 2: 실행해 실패 확인** — `cargo test -p baton-app agent_bridge`- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 위 명령과 `cargo test --workspace`
- [ ] **Step 5: 커밋 (사용자 요청 시)** — `feat: 앱 브리지가 agent_key로 소유를 판정`

### Task 5: 화면 라벨과 용어

**Files:**
- Modify: `rust/app/src/connections/view.ts`, `rust/app/src/main.ts`
- Test: `rust/app/src/acceptance.ts`의 기존 단정문 구조에 추가

**Interfaces:**
- Produces: `connectionLabel(c: Connection): string` → `c.name ? `${c.name} · ${c.id.slice(0,6)}` : `Claude 세션 · ${c.id.slice(0,6)}``. (연결 ID는 키 128비트의 16진수라 앞 6자가 UUID 앞 6자리와 같다.)

변경할 문자열(현재 위치): `view.ts`의 `세션 ${id}` → `셸 ${id}`, `세션 ID 복사` → `셸 ID 복사`, `연결 ID 복사` → `Claude 세션 ID 복사`, `제어 연결`/`연결 기록` 문구에 "Claude 세션" 사용, 드롭다운 placeholder `MCP 연결 선택`/`연결된 MCP 없음` → `Claude 세션 선택`/`Claude 세션 없음`, aria-label `전달할 MCP 연결` → `전달할 Claude 세션`. `main.ts`의 사이드바 `h2('세션')` → `h2('셸')`, 기본 제목 `SSH 세션` → `SSH 셸`.

- [ ] **Step 1: 실패하는 테스트 작성** — `acceptance.ts`에 `equal(connectionLabel({id:'3f39e1c470c2…',display_name:'x',name:'서버 점검'}), '서버 점검 · 3f39e1')`, 이름 없을 때 `'Claude 세션 · 3f39e1'`, 드롭다운 placeholder와 버튼 라벨(`셸 ID 복사`) 단정을 추가한다.
- [ ] **Step 2: 실행해 실패 확인** — `rust/app`에서 `npm test`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npm test`와 `npm run build`
- [ ] **Step 5: 커밋 (사용자 요청 시)** — `feat: 핸드오프 화면을 Claude 세션 기준으로`

### Task 6: 지침과 문서

**Files:**
- Modify: `rust/crates/baton-adapter/src/policy.rs`(`INSTRUCTIONS`), `rust/crates/baton-adapter/src/tools.rs`(도구 설명), `docs/agent-guide.md`, `docs/rust-personal-use.md`, `docs/conversation-isolation-design.md`
- Test: `rust/crates/baton-adapter/tests/tools.rs`

**Interfaces:** 없음(문구).

내용: `INSTRUCTIONS`에 계약 v3, 모든 호출에 `agent_key`를 싣는 규칙, 키 취득법(환경 정보에 세션별 UUID 디렉터리 이름이 보이면 그 UUID, 없으면 무작위 UUID를 한 번 만들어 세션 내내 같은 값을 사용), Baton이 언급되면 먼저 `set_connection_name`으로 제목을 등록하고 `status`를 호출한다는 규칙, 다른 세션의 키·기록을 읽거나 쓰지 않는다는 규칙, 서브에이전트는 같은 키를 쓴다는 규칙, 키를 잃으면 같은 값을 다시 쓴다는 규칙을 영어로 추가한다. sudo 문단과 `request_id` 문단은 그대로 둔다. `docs/agent-guide.md`에 같은 내용을 한국어로 쓰고, `docs/rust-personal-use.md`의 "어댑터는 세션마다 별도 프로세스"를 Desktop은 클라이언트 종류당 하나를 공유한다는 사실로 고치며, `docs/conversation-isolation-design.md` 상단에 이 설계로 갱신됐다는 상태 메모를 추가한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/tools.rs`의 `instructions_cover_the_agent_key_rules`: `INSTRUCTIONS`에 `agent_key`, `every call`, `set_connection_name`, `sudo -n`이 모두 들어 있다(기존 sudo 규칙이 유지됨을 함께 고정).
- [ ] **Step 2: 실행해 실패 확인** — `cargo test -p baton-adapter --test tools instructions_cover`
- [ ] **Step 3: 문구와 문서 수정**
- [ ] **Step 4: 통과 확인** — `cargo test -p baton-adapter`
- [ ] **Step 5: 커밋 (사용자 요청 시)** — `docs: agent_key 지침과 문서 갱신`

### Task 7: 통합 검증

**Files:** 없음(검증만).

- [ ] **Step 1: 전체 자동 테스트** — `rust`에서 `cargo test --workspace`, `rust/app`에서 `npm test`, `npm run build` 모두 통과.
- [ ] **Step 2: 알려진 제외 범위 확인** — `rust/tests/*.mjs`(Node 하네스)는 이 변경 범위에서 제외한다. `phase3/stdio.test.mjs`는 이미 도구를 다섯 개로 단정해서(현재 어댑터는 여섯 개) 이 변경과 무관하게 맞지 않을 가능성이 있다(추정, 실행하지 않음). 변경 전후 실행 결과를 비교해 이 변경이 새로 깨뜨린 것이 없는지만 보고한다.
- [ ] **Step 3: 수동 확인 절차 작성(사용자 실행)** — 병합 후 `rust/scripts/install-local.ps1`을 **자동 실행하지 않고** 사용자에게 제안한다(`AGENTS.md` 규칙, 새 어댑터는 Claude 세션 재시작 필요). 확인 항목: 서로 다른 두 Claude 세션이 각자 `set_connection_name`을 호출하면 앱 드롭다운에 두 항목이 나온다, 한 세션에만 셸을 핸드오프하면 다른 세션의 `status`가 비어 있다, 한 세션이 셸 두 개를 가질 수 있다.

---

## 자체 점검

- **명세 대응:** 5.1 키 → Task 1·6, 5.2 계약 → Task 1·3·4, 5.3 가상 연결 → Task 2·4, 5.4 수명 → Task 4(물리 연결 분리)·2(용량), 5.5 화면 → Task 5, 5.6 지침 → Task 6, 5.7 호환 → Task 1(핸드셰이크)·3(키 없는 호출 거부), 검증 기준 §8 → Task 4의 테스트가 소유 격리·이름 분리·재접속 유지·셸 3개를 포함.
- **작성자 판단(계획에서 정한 것):** nil UUID 거부, 키 형식 두 가지 허용(출력은 하이픈 소문자), 용량 도달 시 셸 없는 연결 정리(명세의 "숨기는 기준값" 대신 제거로 해결), 정리된 연결의 이름 항목은 그대로 두며(같은 키가 다시 오면 유효) 목록은 살아 있는 연결만 보여 줌, `status.connection_id`를 가상 연결 ID로 변경, `rust/tests/*.mjs` 제외.
- **알려진 위험:** 물리 연결을 레지스트리에 더 이상 등록하지 않으므로 `AgentBackend::connected`에 의존하던 다른 코드(획득 테스트 하네스 등)가 있는지 Task 4에서 컴파일과 테스트로 확인한다.
