# Phase 5 Separated Validation Implementation Plan

**최신 실행 상태(2026-10-25):** `9cd3ccb` 구성의 M 180.100초/F 17회 사전시험과 N 복원·최대화 독립 사례 2/2 검증 완료. 증거는 `artifacts/phase5-sampler-diagnostic-20261025`, N 집계는 `n-aggregate.json`의 `native_cases_passed`다. 최초 최대화 실행은 승인 검토 사용량 한도로 입력 시작 전 만료됐고, 사용자 재개 후 `n-maximized-resume`만 실행했다. 정식 F120/M7200 실행 결정과 공개 경계·결합 메모리 검증은 남으며 Phase 5 인수는 아니다. 아래 날짜별 미완료 기록은 당시 상태다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 동일 후보에 대한 고정 UI 2시간 부하(M), 자동 전환 120회(F), 짧은 네이티브 UI(N)를 독립 실행·검증하고 각 결과의 한계를 보존한다.

**Architecture:** 기존 native-soak의 준비·MCP·OS 관측·종료 절차를 새 공통 runtime에 옮겨 세 시나리오가 공유한다. 기존 실행기/판정기는 수정하지 않는다. 새 독립 검증기는 원시 출력·상태·메모리·서버 audit·자원 신원을 다시 대조하며 부분 시험을 Phase 5 인수로 승격하지 않는다.

**Tech Stack:** Node.js ES modules / node:test, Playwright, Windows PowerShell 프로세스 감독기, Docker localhost OpenSSH fixture, Codex computer-use. 제품 Rust/Cargo 빌드는 하지 않는다.

**Spec:** [승인된 설계](../specs/2026-10-18-rust-phase-5-separated-validation-design.md). 사용자 설계·계획 및 inline 실행 승인: 2026-10-18.

**2026-10-19 진행:** Task 1–6 구현 커밋 `fd97ae7`부터 `4fcb095`까지 완료 후 독립 검토를 수행했다. 검토 수정 후 관련 unit 111/111. Task 7 문서/config 준비 완료, 실제 시험 미실행. 회수 시 이전 공개 버퍼가 폐기되어 최종 cursor를 확인할 수 없는 설계 문제가 남아 있다. 이 문제는 Task 2 경계 요구를 아직 충족하지 못하며 사용자 범위 결정 전 사전 시험을 시작하지 않는다. [수정 및 남은 한계](../../testing/rust-phase-5-separated-validation.md#2026-10-19-독립-검토-후-수정). 아래 체크리스트는 원래 계획이며 완료 이력은 이 진행 기록과 작업 ledger에 보존한다.

**2026-10-19 후속 승인:** 사용자가 권장 범위 제한을 승인했다. Task 2의 최종 공개 cursor 완전성 요구는 F/N 부분 시험에서 제외하고 `publicBoundaryCompleteness: unverified`를 강제한다. 회수 의도부터 임의로 시간을 제외하지 않으며 실제 비공개 확인 이후만 분모에서 제외한다. 예상된 stale read도 epoch/state 원시 증거가 없으면 실패다. 제품 변경 없이 이 범위로 사전 시험을 진행한다. 수정 후 관련 unit 114/114. 정식 F/M 실행은 여전히 별도 결정 대상이다.

**2026-10-19 실제 결과:** `96853f0`의 M preflight 1회는 준비 중 실패했다(`webview_ready_timeout`, 앱 로그 `ipc_directory_unavailable`, exit 101). 정상 부하 미시작, Linux 90 tick 점검만 통과. 원인은 실행기의 격리 LOCALAPPDATA 부모 mkdir 누락이며 수정 후 관련 unit 115/115. 실패 원시 증거와 수정 전 23 source/2 binary hash 대조를 보존했다. 정상 종료 실패/강제 정리 발생, 잔류 owner container 및 후보 process 0. 자동 재실행 및 F/N 후속 실행 없음. [상세 결과](../../testing/rust-phase-5-separated-validation.md#2026-10-19-m-사전-시험-1회--준비-실패). Task 7은 부분 진행이며 완료가 아니다.

**2026-10-19 승인된 재실행 결과:** `198caca`의 M preflight는 실제 180.0363초/48 audit 효과/과부하 대조/정상 종료/EOF 32/잔류 0으로 독립 검증 통과했다. 이어 같은 신원의 F preflight는 17회/272 효과/정상 종료를 수행했으나 마지막 새 stream record 전에 freeze되어 `new_stream_output_missing`으로 독립 검증 실패했다. 약 264.63ms 뒤 측정 종료한 실행기 대기 누락을 보강, 회귀 RED→GREEN 및 관련 unit 116/116. 실제 재실행과 N 미실행. 수정 후 source hash가 달라 기존 통과 M과 동일 소스 묶음으로 합치지 않는다. [M/F 원시 결과와 후속 수정](../../testing/rust-phase-5-separated-validation.md#2026-10-19-수정-후-m-통과--f-증거-실패).

## Global Constraints

**2026-10-20 키보드 경로 검토:** 같은 후보 앱의 10월 16일 기록에 popup 클릭 오류와 열린 목록 End→Enter 전달 성공이 이미 있었다. 당시 원시 UI·MCP 응답과 현재 앱/OwnershipView 해시 일치를 읽기 전용 확인했다. N v2에서 이미 신뢰할 수 없다고 기록된 클릭을 다시 사용한 운영 실수를 남기고, [키보드 절차](../../testing/rust-phase-5-separated-validation.md#연결-선택의-키보드-절차)를 운영 문서에 명시했다. 열린 목록에서 전체 ID/실제 순서를 대조하고 한 키씩 관측 후 Return으로 확정한다. 임의 중간 항목은 아직 미검증이며 제품 수정·추가 시험·시간 기준 변경은 없다.

**2026-10-21 후속 최신 상태:** 명시 승인한 새 N 실행(`62f3e99`, `phase5-separated-20261021-native-keyboard/n-cases`)에서 키보드로 지정 중간 연결을 확정·전달했다. 첫 사례 6개 receipt, adapter0→16/epoch1→2→3/이전 owner 해제/새 stream 160개 연속 레코드를 원시 대조했다. 두 번째 사례 시작 관측 중 대화 중단(사용자 보고: 사용량 한도) 후 input_expired. runner 완료 1/2이나 최종 서버 audit 부재로 전체 N 독립 증거 무효다. 정상 종료/EOF32/자손 감사/소유 신원44개 및 컨테이너 잔류0, source23/binary2 해시 일치. [상세 기록](../../testing/rust-phase-5-separated-validation.md#2026-10-21-키보드-재시도--첫-사례-완료-두-번째-사례-전-중단). 추가 실행 없이 마감하며 N/정식 F/M/Phase 5는 미완료다.

**2026-10-21 이전 재시도 마감:** 승인된 N v2 키보드 재시도 `n-keyboard`는 연결 선택 완료 전 `input_expired`로 종료됐다. 사용자는 사용량 한도 중단을 보고했으며 runner 자체는 외부 한도를 계측하지 않는다. 네 receipt(복원/선택/resize/회수), MCP/서버 100×17 일치까지 확인했지만 사례 0/2이며 audit 부재로 독립 증거 무효다. 정상 종료/EOF32/자손 감사/강제 정리 없음, 현재 소유 신원 42개와 owner 컨테이너 잔류 0 및 source23/binary2 해시 일치를 확인했다. [실제 결과와 한계](../../testing/rust-phase-5-separated-validation.md#2026-10-21-n-v2-키보드-재시도-마감--입력-완료-전-중단). 새 시험은 시작하지 않았다. N 두 사례와 정식 F/M은 미완료이고 기존 출시 차단을 유지한다. 아래 기록은 당시 상태다.

**2026-10-20 N v2 실제 실행 최신 상태:** 후속 사용자 승인으로 `5bdde17`에서 N 1회를 실행했다. 복원/선택/resize/회수 네 receipt와 MCP geometry 102×17→100×17 및 서버 `17 100`을 확인했다. 연결 선택에서 컴퓨터 제어가 별도 WebView popup을 대상 Baton 창과 다르다고 거부했고, 새 관측 후 한 번 재시도도 실패했다. failed receipt 게시는 자동 승인 검토 사용량 한도로 실행되지 않았고 runner는 120초 `input_expired`로 종료했다. 사례 0/2, 독립 증거 무효(audit 파일 부재). 정상 종료/EOF32/자손 종료 감사/강제 정리 없음/실제 잔류0 및 source23/binary2 해시 일치 확인. [상세 결과](../../testing/rust-phase-5-separated-validation.md#2026-10-20-n-v2-1회--드롭다운-입력-도구-오류-후-기한-만료). 추가 시험은 자동 실행하지 않으며 Task 7과 Phase 5는 미완료다. 아래 미실행 기록은 각각 당시 상태다.

**2026-10-20 승인 변경 및 현재 상태:** 사용자가 N의 조작/관측/완료 접수 120초와 접수 후 독립 상태 검증 45초 분리를 승인했다. 전체 준비 포함 900초 상한은 유지한다. `nativeTimingVersion:2`, `nativeResponseLatency:not_measured`, 접수 파일/원시 사건을 추가했다. 독립 검토에서 선택·resize의 원시 상태가 접수 이전이어도 통과하는 결함을 확인해, 접수 이후~검증 완료 사이의 상태와 750ms 선택 안정 구간을 요구하도록 보완했다. 기존 R2 M/F 사전 검사 통과와 N 두 실패는 보존한다. N만 native/verify 두 파일의 버전 차이를 공개한 공통 입력 비교를 허용하며, 정식 M/F 동일 소스 요구는 유지한다. 새 N 및 정식 F/M은 미실행이다. 아래 2026-10-19 기록의 승인 대기/기준 미구현은 당시 상태다.

검증: 검토 결함 3건 RED→GREEN, 최종 관련 unit 126/126·문법 검사·diff 공백 검사 통과. 기존 M/F raw와 저장 summary SHA를 재검증했고 두 변경 파일 외 source/binary 차이는 없었다. 준비 설정은 `artifacts/phase5-separated-20261020-native-v2/config-n.json`, 상세 기록은 [N v2 구현 결과](../../testing/rust-phase-5-separated-validation.md#2026-10-20-n-v2-시간-분리--구현-및-검토-완료-실제-재시험-전). 실제 실행 환경/이미지는 이후 setup에서 확인할 대상이다. Task 7 및 Phase 5는 계속 미완료다.

**2026-10-19 N 재시도 최신 상태:** 위 자동 승인 거부 뒤 구체적인 N 1회 재시도 요청에 사용자가 `승인`했다. `n-cases-retry1`을 실행했으나 사례 0/2에서 `input_expired`. 시스템 메뉴로 실제 창 너비 1183→1172 변경은 관측했지만 완료 receipt 저장이 측정 중단 약 3.984초 뒤여서 MCP/server resize 검증에 진입하지 못했다. 제품 응답 지연으로 분류하지 않는다. 정상 종료/EOF32/자손 종료 감사/강제 정리 없음/잔류 0은 확인했다. 소스 23개·바이너리 2개와 환경은 통과한 R2 M/F와 동일하다. 승인된 1회는 실행 완료했으며 추가 재실행하지 않는다. 다음은 입력 수행 시간과 제품 상태 확인 시간을 분리할지 검토하는 단계로, 기준 변경은 아직 승인·구현하지 않았다. [재시도 증거](../../testing/rust-phase-5-separated-validation.md#2026-10-19-n-명시-승인-재시도--완료-기록이-기한-이후-도착). Task 7 및 Phase 5는 미완료다.

**2026-10-19 R2 최신 상태:** `6089e6b`에서 M 180.0968초/48 audit 및 F 17회/272 audit 사전 검사가 각각 독립 검증 통과했다. 소스 23개/바이너리 2개/image/환경 일치, 정상 종료/EOF 32/잔류 자원 0 확인. N은 첫 사례의 창 관측·탭 선택 이후 실제 resize 입력 완료를 확인하지 못해 45초 `input_expired`로 중단됐다(사례 0/2). 정상 종료도 만료돼 강제 정리, 잔류 자원 0. N verifier는 audit 파일 부재로 무효 판정했다. 제품 resize 결함이나 메뉴와 종료 실패의 인과관계는 입증하지 못했다. N 재시도 요청은 자동 승인 검토에서 거부되어 실행되지 않았다. Task 7은 부분 진행이며 N/정식 F/M은 완료되지 않았다. [R2 상세 결과](../../testing/rust-phase-5-separated-validation.md#2026-10-19-r2--mf-사전-검사-통과-n-입력-기한-초과). 소스/기준을 바꾸지 않았으므로 통과한 M/F 반복은 불필요하다. 별도 구체적 N 재시도 승인 확인 후 새 경로를 사용한다.

- 32개 고유 MCP 연결, 16개 SSH 세션, 별도 localhost 서버 두 개에 8개씩 배치한다.
- M 정상 부하 최소 7,200초; 셸별 최소 1KiB/s와 30초마다 4KiB burst; 120회 audit·1,920효과.
- M OS 관측 30초, 최대 공백 45초(양 끝 포함), warm-up 20분 이후 20분 구간 5개·각 최소 30표본. 마지막/첫 구간 합계 private 및 working 중앙값 비율 각각 ≤1.20.
- M 측정 중 Playwright/CDP·JS 진단·강제 GC 없음, debugger established 표본값 모두 0. listener와 준비 영향은 한계로 남긴다.
- F는 120회 횟수 기준, 상태 대기 45초, geometry 안정 750ms, 120회 audit·1,920효과. 분당 빈도·2시간 지속성·자연 메모리를 주장하지 않는다.
- N v2는 서로 다른 세션으로 복원·최대화 두 사례, 전체 watchdog 900초, start 승인 후 조작·관측·완료 접수 120초, 접수 후 상태 검증 45초다. 제품 반응 시간은 미측정이며 관측·판단 시간에 55초 회차 제한을 적용하지 않는다.
- 정상 앱 종료 0·어댑터 EOF 32·자손 종료 감사·강제 정리 없음·소유 자원 0을 모두 요구한다. 실패해도 정리하며 자동 재실행하지 않는다.
- `phase5Acceptance:false`, `combinedTransitionMemory:'unverified'` 고정. 기존 2시간 실패·세 native smoke 실패·출시 차단을 유지한다.
- 제품·기존 판정기·미완성 fuzz·dirty Cargo 파일은 변경/실행/커밋하지 않는다. 새 시험 코드와 관련 문서만 명시적으로 stage한다. push하지 않는다.
- 작업 위치는 기존 `.worktrees/rust-phase-0`. 새 worktree나 의존성 설치 없이 현재 바이너리를 사용한다. 소스·바이너리·이미지·환경이 달라지면 동일 조건 증거로 합치지 않는다.

## Review Focus

1. 준비 중 부분 실패: 컨테이너 생성은 됐지만 ID 수신 실패, 어댑터 일부만 시작한 경우에도 소유 대상만 정리하고 실패를 보존한다 — Task 2.
2. 출력 stream 경계: 회수 전 마지막 공개 출력 누락을 비공개 구간으로 숨기거나 새 stream에 이전 조각을 붙이지 않는다 — Task 2/4.
3. native receipt 경합: 늦게 도착한 응답·동일 요청 중복·다른 owner가 다음 조작을 완료시킬 수 없다 — Task 5.
4. 부분 JSONL/오래된 성공 파일: 기록 도중 종료 또는 이미 사용한 경로가 성공 판정으로 남지 않는다 — Task 1/6.
5. 잘못된 재사용: 후보가 같아도 image/runtime 또는 관측 조건이 다른 결과를 동일 조건으로 합치지 않는다 — Task 1/6.

## 파일 구성과 기존 코드 재사용

새 파일은 모두 `rust/tests/phase5/separated/` 아래 둔다. 아래 파일명은 그 디렉터리 기준이다.

| 파일 | 책임 |
|---|---|
| `contract.mjs`, `contract.test.mjs` | scope/profile/config와 비교 신원, 원시 증거 schema |
| `runtime.mjs`, `runtime.test.mjs` | fixture·앱·어댑터 생명주기, 실제 MCP/출력/audit/OS 기록 |
| `stream.sh` | 시간 tick과 출력 sequence를 분리한 합성 출력 |
| `memory.mjs`, `memory.test.mjs` | M의 정상 구간·freeze·과부하 대조 |
| `transitions.mjs`, `transitions.test.mjs` | F와 N 공통 상태 검증, F의 Playwright 조작 |
| `native.mjs`, `native.test.mjs`, `native-ui.mjs` | N 조정기·receipt 프로토콜·사람/에이전트용 파일 CLI |
| `run.mjs`, `launch.mjs`, `verify.mjs`, `verify.test.mjs` | 단일 scope 실행, 숨김 launcher, 독립 증거 재검증 |
| `test-fixture.mjs` | 위 단위 검사만 사용하는 최소 유효 증거/가짜 시계·전송 객체 |

변경 없는 재사용: `../soak-oracle.mjs`의 `LogOracle`, `../native-soak-control.mjs`의 `memoryVerdict`; `../../phase3/stdio.mjs`의 `Adapter/data`; `../../helpers/process.mjs`; `../../phase2/desktop-supervisor.mjs`; `rust/scripts/{desktop-process,close-test-process,sample-test-memory,sample-test-process-roles,check-test-debug-port}.ps1`.

`native-soak.mjs`의 CLI를 import하지 않는다(즉시 실행 부작용). setup/cleanup/overload 구현을 새 runtime으로 옮기되 역사적 실행기를 새 모듈로 연결하는 리팩터링은 하지 않는다. 기존 `soak-stream.sh`는 `n % 30`에 burst 순번 증가가 섞여 약 26초 주기가 되므로 새 `stream.sh`는 별도 초 tick을 사용한다. 과거 출력 주기를 소급 수정하지 않는다.

## 공통 인터페이스

- `Scope = 'M'|'F'|'N'`, `Profile = 'preflight'|'full'`.
- `resolveContract(scope, profile) -> {scope,profile,seconds,rounds,cases,scopeEligible}`: M preflight=180초/3 audits, full=7200초/120 audits; F preflight=17회(같은 세션 재방문 포함), full=120회; N full=2사례/900초이며 preflight를 거부한다. preflight는 항상 `scopeEligible:false`.
- `validateConfig(config) -> config`: app/adapter `{path,sha256}`, immutable `imageId`, `pwsh`, `playwrightPath`, `baselineEvidence`(선택, 비교 묶음의 첫 실행 디렉터리), `preflightEvidence:{M?:directory,F?:directory}`를 검증한다. full M/F는 해당 scope의 경로를 요구한다. 기존 실패 smoke 경로를 새 preflight 증거로 받지 않는다.
- `compareIdentity(a,b) -> {same:boolean,differences:string[]}`: sources manifest, 바이너리 2개, image ID, OS/arch/Node/WebView/Playwright 비교. scope/profile에 따른 계측 차이는 명시하고 무조건 같다고 처리하지 않는다.
- `createRuntime({root,out,config,contract}, dependencies?) -> Runtime`; dependencies는 단위 검사용 clock/spawn/docker/transport/filesystem 주입이며 운영 경로에서 자동 mock fallback은 없다.
- `Runtime`: `setup()`, `disconnectBrowser()`, `service()`, `health()`, `audit(round)`, `verifyAudits()`, `sampleMemory()`, `freeze()`, `overload()`, `shutdown()`, `cleanup()`은 Promise를 반환한다. `status(adapterIndex)`, `command(session,text,duplicate=false)`, `waitFor(check,label,timeoutMs=45000)`도 제공한다. `waitFor`는 check 사이 service/stop을 처리한다. 읽기 전용 `sessions`, `connections`, `page`, `summary`, `contract`를 노출한다.
- `Session = {index,id,adapter,epoch,stream,cursor,oracle}`. `setTransition(session,stage)`는 허용된 제외 구간만 기록하고, `adoptBinding(session,binding)`는 새 epoch/stream/cursor와 oracle 경계를 적용한다. 아무 세션이나 streaming 제외 목록에 추가할 수 없다.
- `runMemory(runtime)`, `runFunctional(runtime)`, `runNative(runtime,mailbox)`는 해당 workload 증거를 반환한다. runner가 항상 shutdown/cleanup을 수행한다.
- `verifyEvidence(evidence) -> {evidenceValid,scopePassed,preflightPassed,phase5Acceptance:false,combinedTransitionMemory:'unverified',errors:string[],metrics}`. 정상적으로 수집한 기준 초과는 evidenceValid=true, scopePassed=false; 필수 증거 부재/불일치는 evidenceValid=false.

원시 파일: `events.jsonl`(순서·단조 경과시간·UTC·scope·owner·action/요청/응답), `output.jsonl`(각 read의 session/epoch/stream/cursor 및 원문 응답), `memory.jsonl`, `audit-observations.json`, `normal-boundary.json`, `process.json`, `final-cleanup.json`, `summary.json`. 출력은 fixture 합성 데이터만 보관하며 메모리에 전체 실행 로그를 쌓지 않는다. 스트림 파일 쓰기는 backpressure를 처리한다. 검증 결과는 `verification.json`; 성공일 때만 별도 `verified.json`을 exclusive 생성한다.

### Task 1: 실행 계약과 증거 신원

**Files:** Create `contract.mjs`, `contract.test.mjs`, `test-fixture.mjs`.
**Interfaces:** 위 resolveContract/validateConfig/compareIdentity 및 event schema를 정의한다. `loadEvidence(out)`와 실제 verifier는 Task 6 소유다.

- [ ] 계약과 신원 불일치 테스트를 작성한다. 대표 assertion: `assert.equal(resolveContract('M','full').seconds,7200)`, `assert.equal(resolveContract('F','full').rounds,120)`, `assert.equal(resolveContract('F','preflight').rounds,17)`, `assert.throws(()=>resolveContract('N','preflight'))`. 이미지/환경/소스 하나만 바뀐 쌍은 `assert.equal(compareIdentity(a,b).same,false)`.
- [ ] `node --test rust/tests/phase5/separated/contract.test.mjs`가 새 export 미구현으로 실패하는지 확인한다.
- [ ] 계약을 구현한다. 알 수 없는 scope/profile, 경로 누락, 잘못된 hash, 비교 대상 source manifest 누락을 명시적 오류로 거부한다. 시간은 단조 시계로 판정하고 UTC는 상관관계용으로만 쓴다. 연결 ID 중복은 Task 2 setup과 Task 6 증거 검증에서 거부한다.
- [ ] 같은 테스트에서 정상 조합 및 거부 사례가 모두 통과하는지 확인한다. 변경 파일만 커밋: `test: define separated validation contracts`.

### Task 2: 공통 runtime과 출력 경계

**Files:** Create `runtime.mjs`, `runtime.test.mjs`, `stream.sh`; Extend `test-fixture.mjs`.
**Interfaces:** 위 Runtime 전체. setup은 32/16/2 준비·초기 출력·신원 확인 후 반환한다. service는 stop 확인·공개 출력 소비·진행 summary 저장을 수행하고 요청 없는 UI 동작을 하지 않는다.

- [ ] 가짜 transport/process/docker와 실제 임시 파일로 실패 테스트를 작성한다. 부분 setup 실패 시 알려진 owner+name+ID만 정리함, PID 재사용 시 종료 거부, stop 뒤에도 cleanup 실행, 파일 쓰기 실패 보존, private 구간 밖 sequence gap 거부, stream 교체 전후 조각 분리, EOF 31 또는 forcedCleanup=true 거부를 검증한다. 예: `assert.equal(report.cleanup.remainingContainers,0)`와 `assert.equal(report.scopePassed,false)`를 동시에 요구한다.
- [ ] `node --test rust/tests/phase5/separated/runtime.test.mjs` 실패를 확인한다.
- [ ] 기존 절차를 새 runtime에 구현한다. fixture는 immutable ID로 시작하고 `baton.soak=owner`와 정확한 이름/ID를 저장한다. source manifest에는 새 실행 관련 모듈/스크립트 전체와 기존 import/transitive helper·제품 main/view·Dockerfile을 포함한다. 앱/어댑터 hash와 환경은 준비 전후 확인한다. 원시 MCP/출력/서버 audit는 판정 전에 저장한다. 준비 실패에도 가능한 정상 종료 후 필요한 소유 자원 정리를 한다.
- [ ] `stream.sh`를 구현한다. 첫 1초 대기 후 tick마다 1008개 x가 든 기존 SOAK 형식 한 줄, 매 30번째 tick에 추가 4줄; sequence는 출력마다 증가한다. Task 7 preflight 준비에서 같은 Linux fixture로 90 tick의 sleep 생략 실행을 한 번 확인한다: burst tick `[30,60,90]`, 누적 출력 수 `[34,68,102]`. 테스트 모드의 sleep 생략·tick 상한은 이 점검에만 쓰고 실제 측정은 1초 sleep/무한 출력으로 고정한다. 고정 tick 검사는 실제 시간 간격의 증거가 아니며 실제 출력률은 원시 출력으로 별도 검증한다.
- [ ] public→private 전환 직전 읽기를 drain하고 마지막 cursor 및 MCP 전환 증거를 남긴다. 회수와 경쟁해 drain이 거절되면 확인된 마지막 public cursor부터의 불확실성을 실패로 남기고 조용히 리셋하지 않는다. 새 stream 최초 record는 새 기준으로 삼되 같은 stream의 gap/중복/혼합은 거부한다. rate 분모는 실제 public 측정 시간이며 시나리오 전환 확인 시간 전체를 임의 제외하지 않는다.
- [ ] runtime 테스트 통과 후 short preflight에서 실제 Linux 발생기의 tick/출력 수를 확인하도록 운영 절차에 포함한다. 단위 테스트만으로 Docker/Windows 성공을 주장하지 않는다. 변경 파일만 커밋: `test: add scoped validation runtime`.

### Task 3: M 고정 UI 부하

**Files:** Create `memory.mjs`, `memory.test.mjs`.
**Interfaces:** `runMemory(runtime)`; 기존 `memoryVerdict(samples,duration)`를 호출하되 full만 메모리 인수 비율을 판정한다.

- [ ] 가짜 시계/runtime 테스트를 작성한다. 단조 시간 7200초 전 종료 거부, 60초 경계 audit 120회, sample 최대 공백 45초, freeze 전 브라우저 재접속 금지, 메모리 비율 1.21일 때 overload 계속 수행, workload 오류일 때 overload 생략 사유 기록을 검증한다. 예: `assert.deepEqual(trace.slice(-2),['freeze','overload'])`(유효 부하·메모리 초과 사례). 이후 shutdown 실행 보장은 Task 6 runner 테스트에서 확인한다.
- [ ] `node --test rust/tests/phase5/separated/memory.test.mjs` 실패를 확인한다.
- [ ] setup의 첫 탭을 유지하고 browser.close 및 참조 해제 후 측정한다. 연결/세션/owner/epoch/stream 기준을 저장해 의도치 않은 변화를 거부한다. OS 표본은 역할 신원과 합계를 포함하고 30초 일정, 자연 구간만 기록한다. audit를 한꺼번에 밀어 넣어 지연을 숨기지 않고 실제 시각을 보존한다.
- [ ] 정상 구간 freeze를 먼저 저장한다. full의 메모리 초과와 workload 무효를 분리한다. 유효 workload 뒤 기존 32KiB×40 정상 소비→victim ACK 차단 대조를 수행하고 victim closed/15 alive를 원시 상태로 확인한다. preflight에서도 과부하/종료 경로는 실행하되 메모리 통과 이름은 사용하지 않는다.
- [ ] 위 테스트와 기존 `native-soak-control.test.mjs`, `soak-oracle.test.mjs`를 실행해 통과를 확인한다. 커밋: `test: separate detached static load scenario`.

### Task 4: F 자동 전환 120회

**Files:** Create `transitions.mjs`, `transitions.test.mjs`.
**Interfaces:** `runFunctional(runtime)`와 `verifyTransition({before,selected,resized,remote,reclaimed,assigned,oldOwner,targetConnection}) -> observation`. 이 순수 함수는 Task 5/6에서도 사용한다; verifier는 raw를 읽어 인자를 재구성한다.

- [ ] stale epoch, 동일 stream, 잘못된 연결, 이전 owner 미해제, 선택 전 geometry 기준, MCP/stty 불일치, 119회 또는 중복 round를 거부하는 테스트를 작성한다. `verifyTransition(valid).verified === true`; 각 변형은 throw. 17회 preflight는 session 0의 두 번째 방문과 연결 0→16→0을 반드시 포함한다.
- [ ] `node --test rust/tests/phase5/separated/transitions.test.mjs` 실패를 확인한다.
- [ ] 실제 Playwright 버튼·목록 조작을 구현한다. 탭 전체 ID 대조→750ms geometry 안정→`.terminal-workspace` 폭 720/1000px 교대→MCP/stty→회수→목표 `(previous+16)%32` 전달→이전 owner 해제를 수행한다. 제품 상태 직접 수정 API는 만들지 않는다. DOM 폭 변경은 명시적으로 프런트엔드 resize 검사다.
- [ ] 모든 wait와 Playwright action timeout은 최대 45초. 진행 중 다른 세션 출력 소비/stop 처리를 유지한다. 단일 회차 완료 후 전체 16세션 audit와 32연결 health를 검증하고 다음 회차로 이동한다. 최초 실패 중단, 동일 action 재입력 없음. Playwright locator의 관측 대기는 허용하지만 실패한 조작을 다시 호출하지 않는다.
- [ ] 실제 회차 시각·public 구간·출력·audit를 기록한다. attached 상태는 메모리 참고값만 허용하며 M 자연 표본으로 표시하지 않는다. 위 테스트 통과 후 커밋: `test: add count based functional transitions`.

### Task 5: N 네이티브 두 사례와 시간 분리

**Files:** Create `native.mjs`, `native.test.mjs`, `native-ui.mjs`.
**Interfaces:** `NativeCasesMailbox(dir,owner,clock)`의 `issue(action,runDeadline)`, `read()`, `beginInput(requestId)`, `accept(response)`, `finish(observation)`; `runNative(runtime,mailbox)`; CLI `native-ui.mjs peek|start|done|failed evidence-dir [request-id] [observation-json]`.

- [ ] 실제 임시 디렉터리로 receipt 경합/원자성 테스트를 작성한다. 다른 owner, 이전 ID, 중복 응답, expired run, wrong full session ID를 거부한다. 입력 시작 전 60초 관측 대기는 허용하고, 입력 시작부터 확인까지 45초 초과는 거부한다. 모든 단계가 전체 900초를 넘을 수 없다. `assert.equal(request.expiresAt,runDeadline)`이며 입력 시작 통지 후 verification deadline은 `min(inputStartedAt+45000,runDeadline)`.
- [ ] `node --test rust/tests/phase5/separated/native.test.mjs` 실패를 확인한다.
- [ ] 기존 mailbox의 exclusive 임시 파일/하드링크 패턴을 새 파일에 사용하되 기존 45초 request timeout을 재사용하지 않는다. 각 조작 직전에 CLI `start`로 runner 시계의 inputStartedAt을 기록하고 실제 입력은 한 번만 한다. 기록 전에 필요한 창/대상 관측을 마친다. receipt는 관측한 전체 ID·창 모드·screenshot 식별자를 기록한다. 입력 성공 선언만으로 finish하지 않고 Task 4의 MCP/서버 oracle을 통과시킨다. receipt 전 상태 관측도 service에서 유지한다. 이 시간에는 도구 왕복이 포함되므로 순수 제품 지연이라고 보고하지 않는다.
- [ ] 복원과 최대화에서 서로 다른 세션(0,1)을 각각 선택한다. 최초 현재 geometry를 읽고 실제 창 크기를 바꾼 후 같은 창 모드의 최종 관측 및 MCP/stty를 기록한다. 복원→최대화 전환을 두 번째 사례의 resize로 사용할 수 있다. 회수 후 초기 선택과 다른 16/17번 연결을 명시 선택·전달한다. 같은 연결에 단순 재전달해서 사례를 충족하지 않는다.
- [ ] 운영 절차에 실제 본문 screenshotId 선택, 최대화 좌표 입력, 매 조작 후 새 관측, 목록 전체 연결 ID 대조, receipt 쓰기 실패 시 UI 재입력 금지를 적는다. computer-use skill을 실행 시 다시 확인한다. 단위 테스트 통과 후 커밋: `test: add bounded native validation cases`.

### Task 6: 실행 CLI와 독립 검증

**Files:** Create `run.mjs`, `launch.mjs`, `verify.mjs`, `verify.test.mjs`; Extend `test-fixture.mjs`.
**Interfaces:** `launch.mjs fresh-dir config.json M|F|N preflight|full`; `run.mjs` 동일 인자; `loadEvidence(out) -> Evidence`; `verifyEvidence(evidence)`; `verify.mjs evidence-dir [comparison-dir...]`.

- [ ] 완전한 최소 원시 fixture와 변형들을 작성한다. 7200 미만/120회 미만, sample gap/GC/CDP/역순/합계 오류, raw-summary 불일치, audit 효과 중복/누락, 마지막 JSONL 잘림, cleanup 누락, normal-boundary 뒤 memory 끼워넣기, image/runtime mismatch, 이미 존재하는 out/log/launch/verified를 거부한다. `scopePassed`는 raw 판정으로 계산하며 `summary.status='passed'`만 바꿔도 결과가 변하지 않아야 한다. preflight 정상 결과는 `preflightPassed:true,scopePassed:false,phase5Acceptance:false`.
- [ ] `node --test rust/tests/phase5/separated/verify.test.mjs` 실패를 확인한다.
- [ ] launcher는 artifacts 내부의 fresh 경로와 실제 경로 경계(reparse 포함)를 검사하고 `.launch.json`/`.log` exclusive 예약 후 `windowsHide:true`로 단 한 번 시작한다. 전체 supervisor 상한은 M seconds+900, F rounds×240+900, N 900초로 설정한다. F 상한은 장기 hang 방지이며 처리량 합격 조건이 아니다. N 900초는 준비까지 포함한다.
- [ ] runner는 scope에 맞는 scenario를 하나만 실행한다. 운영 오류 후에도 정상 종료 시도/소유 정리/finishedUtc/실패 원인을 저장한다. 새로운 full M/F는 같은 scope preflight의 독립 검증과 공통 소스·후보·image·환경 일치를 요구한다. N은 준비된 consumer가 수동 실행한다. 서로 다른 시험을 자동 연쇄 시작하지 않는다.
- [ ] verifier는 모든 raw 파일을 읽고 output을 LogOracle로 다시 재생하며 public rate와 audit를 재계산한다. 판정에 필요한 MCP 응답·geometry·서버 audit·ownership·32EOF·프로세스 신원/합계·정리 증거를 요구한다. 현재 소스/바이너리 hash도 비교한다. 누락/파싱 실패는 경로와 원인을 `verification.json`에 기록하고 exit 1, 성공 파일 없음. 유효 기준 초과도 exit 1이나 evidenceValid=true로 구분한다. full 성공 이름은 설계의 M/F/N 이름을 사용한다.
- [ ] 전체 새 unit 및 기존 native control/verify/oracle 검사를 실행한다. `node --check`는 신규 `.mjs`별로 실행한다. 테스트 수는 실제 결과로 기록한다. 관련 파일만 커밋: `test: verify separated validation evidence independently`.

### Task 7: 실행 준비 문서와 단계별 증거

**Files:** Create `docs/testing/rust-phase-5-separated-validation.md`; Update 이 계획. 실제 결과가 나온 경우에만 `docs/testing/rust-phase-5-memory-investigation.md`에 링크와 한계를 추가한다.
**Interfaces:** Task 6 CLI, Task 5 native CLI. 다음 명령은 구현 후 사용할 명령이며 이 문서 작성 중 실행하지 않는다.

- [ ] 운영 문서에 새 schema/config 예제와 명시적 test 목록을 쓴다. `node --test rust/tests/phase5/separated/*.test.mjs`를 기본 새 unit 명령으로 제공하되 shell wildcard가 펼쳐지지 않으면 파일명을 나열한다. broad phase5 glob이나 cargo는 사용하지 않는다.
- [ ] 신규 증거 루트 `artifacts/phase5-separated-20261018/`와 config를 준비한다(이미 있으면 덮어쓰지 않고 새 suffix). app/adapter 경로와 hash는 승인 설계 시 후보로 고정: app `artifacts/phase5-ui-stability-20261016/baton.exe` / `1ae03f6b7fc0d3d17eb5571c81ba0c11d73ad9cfc39e37c2c520a9393aa0df0e`, adapter `artifacts/phase5-harness-fixes-probe3-20261013/candidate/baton-adapter.exe` / `09823dd5d51cd3b33f286540fe43a03570b3eee81497607a1b5b67336fcb754c`. image `sha256:7270e924b7597cbece5eb6886a47c3383502f31d8a253763774f3b8c6b4f810a`는 실제 존재/태그 ID를 확인하며 불일치 시 재빌드로 대체하지 않는다.
- [x] 구현 검토 후 승인된 실행 범위 내에서 M preflight 180초, F preflight 17회를 각각 한 번 수행한다. 명령: `node rust/tests/phase5/separated/launch.mjs artifacts/phase5-separated-20261018/m-preflight artifacts/phase5-separated-20261018/config.json M preflight` (F는 `f-preflight`, `F`). 각 finishedUtc 후 `node rust/tests/phase5/separated/verify.mjs <evidence-dir>`. 실패하면 다음 단계 자동 진행 없이 원인·소유 정리 결과를 기록한다. 최신 구성 결과: 2026-10-25 증거 루트의 M/F `verified.json`.
- [x] 같은 입력으로 N full 두 사례를 active computer-use와 수행하고 검증한다. 명령은 `.../launch.mjs .../n-cases .../config.json N full`; native CLI로 요청·receipt만 교환한다. 실제 조작과 캡처는 컴퓨터 제어 도구로 수행한다. 서로 겹치는 실행은 하지 않는다. 승인된 독립 사례 방식의 최신 결과: 2026-10-25 `n-restored` + `n-maximized-resume`, 집계 `n-aggregate.json`.
- [ ] 사전 검사와 N의 독립 결과·소스/바이너리/이미지/환경 비교·cleanup을 보고하고 정식 F/M의 준비 상태를 검토한다. 정식 실행은 별도 실행 결정 후 `.../f-full .../config.json F full`, `.../m-full .../config.json M full` 순서로 각각 한 번 시작한다. 실행 간 코드가 바뀌지 않았다면 이유 없이 이미 통과한 검사를 반복하지 않는다. 새 heartbeat는 별도 필요가 생긴 경우에만 설정하고 불변 상태 알림은 하지 않는다.
- [ ] 정식 실행 후 각 검증 결과·M 다섯 중앙값/비율·F 회차 소요시간/횟수·N 실제 창 관측·원시 증거 경로·제약을 기록한다. 보존 image는 최종 사용 종료 시 owner 대상 컨테이너 0 및 현재 tag ID 일치 확인 뒤 정리하고 `final-cleanup.json`에 남긴다. 문서만 명시 stage하여 로컬 커밋한다. 세 scope가 통과해도 결합 메모리 항목/출시 차단은 유지한다.

## 2026-10-21 승인 변경 — N 사례별 독립 완료

사용자는 모델/대화를 변경하지 않고 복원·최대화 사례를 독립 실행·audit·정상 종료·검증 후 합산하는 변경을 승인했다. 이전 실패/부분 기록을 재활용해 통과시키지 않는다.

- [x] config.nativeCase로 한 사례만 실행하고 공통 setup/shutdown/cleanup을 그대로 사용한다. 각 새 실행은 세션 index 0을 사용한다.
- [x] 단일 사례는 casePassed만 저장하며 두 사례의 원시 증거·현재 소스/바이너리·동일 image/환경/baseline을 재검증한 합산만 scopePassed를 반환한다. 저장된 결과와 합산 파일은 덮어쓰지 않는다.
- [x] 실패 테스트 확인 후 구현. 사례 누락·잘못된 모드·audit/종료 누락·환경/소스 차이·과거 기록 재표기·저장 후 raw/summary/후보 변경을 거부한다. 관련 suite 131개 통과, 독립 읽기 전용 리뷰에서 차단 결함 없음.
- [ ] 새 복원 사례를 한 번 실행하고 종료/정리/독립 검증한다.
- [ ] 복원 통과 기록을 보존한 상태에서 최대화 사례를 한 번 실행하고 검증한다.
- [ ] 두 사례를 합산해 결과를 기록한다. 정식 F/M과 Phase 5 출시 차단은 별개다.

운영 명령과 변경된 범위는 `docs/testing/rust-phase-5-separated-validation.md`의 사례별 완료 보존 절을 따른다. 기존 원래 계획의 두 사례 연속 실행 지시는 이 변경으로 대체하며, 공통 runtime 및 기존 M/F preflight 소스 비교 규칙은 변경하지 않는다.

## 자체 검토와 실행 인계

2026-10-25 상태 회수: 새 제품 `6b4324a`의 M180초/F17회 preflight는 독립 검증 통과. `phase5-followup-20261024`의 복원·최대화 N은 각각 연결 선택/회수 입력 기한 만료로 미완료(0/2), 모두 정상 종료·EOF32·잔류0. 별도 Tao callback 회귀시험의 정리 수명 결함을 수정하고 패치3통과/upstream 예상2실패 및 재검토를 완료했다. 자세한 부분 관측과 한계는 운영 문서와 `rust-tao-system-menu-patch.md`에 기록했다. Task 7과 출시 차단은 완료하지 않는다. 사용자 재개 요청에 따른 후속 N은 새 증거 경로를 사용하고 기존 성공한 사전시험은 동일성 검증 아래 재사용한다.

같은 날 명시적 재개 실행 `n-restored-resume`는 resize 검증 후 메모리 수집 `process_missing`으로 실패했다. 정상 종료/EOF32/잔류0, N0/2이며 최대화 후속 실행 없음. 누락 PID를 기록하지 않던 진단 공백을 보완(예외에 pid/kind/expectedStartedTicks/stage 추가)하고 RED→GREEN 2검사와 독립 검토를 완료했다. 기준은 그대로다. 이 수집기 변경으로 이후 실행은 이전 M/F preflight의 소스 동일성을 만족하지 않으므로 새 사전시험부터 필요하다. 원래 process_missing 원인은 아직 미확정이며 자동 재실행하지 않았다. 상세 근거와 드라이버 시작 확인 오류는 운영 문서의 해당 절에 기록했다.

설계 §3 공통 신원/생명주기는 Task 1/2/6, §4 M은 Task 3, §5 F는 Task 4, §6 N은 Task 5, §7 증거/판정은 Task 6, §8 실행 순서는 Task 7에 대응한다. Review Focus 다섯 항목 모두 관련 task의 실패 테스트에 포함했다. 새로운 출력 발생기의 시간 tick 분리는 시험 요구를 구현하기 위한 변경이며 제품 수정이 아니다.

권장 실행 방식은 **현재 세션에서 직접 구현 후 전체 변경 독립 검토**다. 공통 runtime·증거 schema에 대한 의존이 커 작업마다 별도 구현자를 두는 이점이 작다. 사용자에게 이 계획 검토와 실행 방식 선택을 요청한 후 착수한다. 구현 완료와 정식 장시간 시험 완료는 별도로 보고한다.

### 2026-10-21 독립 사례 첫 실행 결과

구현 `8aafc1a` 이후 `artifacts/phase5-separated-20261021-independent/n-restored`를 한 번 실행했다. window_mode/select만 검증된 뒤 resize 대기 중 raw `app_offline` → runner `bad_cursor` 실패. audit 부재와 강제 cleanup 때문에 독립 통과 0/2이며 최대화는 미실행이다. 정상 종료 실패, 최종/후속 소유 잔류 0, 소스23/바이너리2 해시 일치를 기록했다. 사용량 한도 중단 보고만으로 원인을 정하지 않는다. 다음 작업은 원시 app_offline의 연결 단절 원인 조사이며 자동 재실행하지 않는다. 상세 수치와 한계는 시험 운영 문서의 해당 날짜 결과를 따른다.

### 2026-10-21 창 메뉴 최소 진단

N 재실행 대신 고정 후보·SSH 0·MCP 1로 원인을 조사했다. 메뉴+접근성 조회, 메뉴+화면 전용 두 조건에서 offline 및 정상 종료 실패가 재현됐다. 메뉴 없는 대조는 75.534초 online/exit0/EOF0을 확인했다. 메뉴 사례는 프로세스 생존 중 offline이며 Escape 뒤 10개 표본에서도 회복되지 않았다. 모든 실행 후 잔류0. 현재 유력한 경로는 프런트엔드 30초 heartbeat 감시의 영구 stopping 전환이나 직접 정지 사유/스택이 없어 확정하지 않는다. 다음은 별도 진단 후보의 정지 사유·ping/pong·종료 단계 관측이며 제품 수정/N 재실행은 아직 하지 않았다. 상세 증거와 한계: `docs/testing/rust-phase-5-offline-investigation.md`.

### 2026-10-22 정지 사유 계측

고정 후보의 별도 소스 복사본에만 로그를 추가해 `artifacts/phase5-offline-trace-20261022`에서 대조/메뉴 진단을 수행했다. 제한 실행 환경의 최초 control은 MCP online 미성립으로 제외했다. 같은 사용자 권한의 control2는 75.482초 online, exit0/EOF0을 확인했다. 메뉴 사례는 마지막 pong 이후 내부 측정 30.072초에 heartbeat timeout/FrontendLost로 정지했다. 정상 닫기 요청 후 서비스·IPC 종료와 Tauri ExitRequested까지 6ms 내 도달했지만 supervisor의 15초 종료 대기는 실패했다. 원시 로그·소스/바이너리 해시와 정리 기록을 analyze.mjs로 대조했으며 세 실행 잔류0. 제품 수정·N/F/M 재실행 없음. 다음은 ExitRequested 이후의 이벤트 루프/창 정리와 root·WebView·supervisor 생존을 같은 권한에서 구분하는 조사다. heartbeat 정지 사유 확인과 종료 문제 해결을 혼동하지 않는다. 세부 근거·제외 기준·한계는 `docs/testing/rust-phase-5-offline-investigation.md`에 기록했다.

### 2026-10-23 한도 중단 후 종료 경계 회수

`artifacts/phase5-exit-trace-20261022`의 이미 끝난 결과를 분석했다. 최초 menu는 수집기 구문 오류로 제외했고 수정·수집 자체 확인 후 실행한 menu2와 short-menu에서 종료 허용 이후 동일 PID/시작 시각의 앱 root와 WebView 6개 생존을 확인했다. 서비스/IPC 종료는 완료됐으나 최종 Exit 이벤트는 없고 정상 종료 15초 대기는 실패했다. short-menu는 메뉴 닫힌 뒤 9.086초 후 timeout, 그 2.086초 뒤 정상 닫기 요청이므로 timeout 없는 종료 대조로 사용할 수 없다. 전체 진단 소스/앱 hash, 원시 표본, 소유 잔류0 검증 완료. 재개 시 재실행/제품 수정 없음. 다음은 Windows 이벤트 처리의 복구·최종 Exit 경계를 스택 또는 최소 재현으로 구분하는 조사다. N/F/M 및 Phase 5 차단 유지. 상세는 `docs/testing/rust-phase-5-offline-investigation.md` 마지막 절.

### 2026-10-23 최소 Tauri 창 재현

`artifacts/phase5-minimal-window-20261023`에서 Baton SSH/MCP/watchdog를 실행하지 않는 최소 UI를 비교했다. 같은 의존성/설정, 별도 source/dist만 변경했다. 메뉴 없는 대조는 JS tick/eval ack, Exit 이벤트, exit0/정상 자식 정리 통과. 메뉴 조건은 화면 카운터 27→47에도 Rust tick/ack 수신이 중단되고, 종료 허용 후 Exit 이벤트 없이 15초 대기 실패. 2.686초 생존 표본에서 동일 root/WebView6을 확인했다. 원시 분석과 전체 소스/실행기/바이너리 해시, 소유 잔류0 검증 완료. 따라서 watchdog timeout과 제품 SSH/MCP 서비스는 이 재현의 필요 조건이 아니다. 동일 native automation/job supervisor/창 설정의 영향과 특정 Tauri/Tao 원인은 미확정이며 다음은 하위 Windows 이벤트 전달·종료 경계 계측이다. 제품 변경/N/F/M 재실행 없음. 상세는 조사 보고서 마지막 절.

### 2026-10-23 Windows 내부 경계와 진입 방식 대조

`phase5-tao-loop-20261023`의 대조/Alt+Space 결과를 회수하고, 추가 경계 계측을 한 `phase5-tao-paint-20261023`에서 대조/Alt+Space/제목 표시줄 우클릭을 비교했다. 별도 Tao 복사본 2파일의 로그와 경로 patch만 변경했으며 제품/registry/fuzz는 보존했다. Alt+Space는 WM_PAINT → PeekMessageW → WM_SYSCHAR/WM_SYSCOMMAND의 DefWindowProcW 안에서 반환되지 않았고, 화면상 메뉴가 사라져도 WM_EXITMENULOOP가 없었다. 종료 허용과 ExitWithCode(0)은 중첩 처리됐지만 바깥 루프로 복귀하지 않았다. 동일 바이너리의 제목 표시줄 메뉴는 실제 15.580초 메뉴 구간에서 tick16/ack8, 메뉴 종료 이벤트, exit0/정상 자식 정리를 확인했다. 따라서 이전 메뉴 닫힘 marker를 실제 메뉴 루프 종료로 보는 해석은 철회한다. 원시 로그/소스/앱/registry hash 및 다섯 실행 소유 잔류0 검증 완료. 다음은 Alt+Space/WM_SYSCHAR 송신·focus·동기 전달 경계 조사이며 WebView2 재진입은 아직 가설이다. N/F/M 및 Phase 5 차단 유지. 세부 수치/한계/검사 오류 기록은 조사 보고서 마지막 절.

### 2026-10-23 동기 전송 문맥과 큐 전달 실험

`phase5-syschar-context-20261023`에서 Alt+Space send_flags1/제목 표시줄0과 양쪽의 소유 WebView 포커스를 확인했다. 송신 PID는 이 API로 확정하지 않았다. `phase5-syschar-defer-20261023`는 별도 진단 복사본 한 파일에 동기 Alt+Space를 큐잉하는 개입만 추가했다. 먼저 작성한 회복 검사는 변경 전후 모두 menu_loop_exit_missing으로 실패했다. 변경 후 send_flags1→0, 양방향 응답 유지(tick11/ack6)는 확인했으나 실제 메뉴 종료/앱 정상 종료 실패는 남아 제품 수정안으로 채택하지 않는다. 첫 개입 실행은 사용량 중단으로 제외하고, 명시적 재개 후 같은 바이너리의 새 menu-complete 증거에서 마무리했다. 원시 로그/전체 소스·바이너리·registry/단일 변경 범위 및 네 실행 소유 잔류0 검증 완료. 한 실패 실행은 최종 process.json 부재를 별도로 기록하고 beforeClose/생존 표본으로 신원을 검증했다. 다음은 Escape/키 해제/메뉴 취소 경로 조사. 제품/fuzz 변경 및 N/F/M 재실행 없음, Phase 5 출시 차단 유지.

### 2026-10-23 Escape 2회 비교와 해석 정정

최신 후보 검증: `phase5-product-defer-20261023`에서 동기 Alt+Space만 같은 인수로 큐에 전달하는 후보를 제품 계측 복사본의 Tao 한 파일에 적용했다. 기존 red는 heartbeat_timeout, 같은 검사로 후보 Alt+Space74.292초/pong15와 제목 표시줄60.521초/pong12 모두 통과. 동일 connection/online, 실제 메뉴 종료, exit0/EOF0/audit verified/잔류0 및 소스·앱·검사 hash 검증. 제품 채택은 아직 아니며 처리 시점 이동과 송신자 대기 해제를 분리한 원인 증명도 아니다. 다음은 제품 적용 위치/의존성 patch 관리 및 입력·종료 경합 회귀 범위를 정하는 단계. 제품/fuzz 미변경, 정식 N/F/M 및 Phase5 차단 유지.

후속 제품 경계 검증 완료: `phase5-product-menu-20261023`은 제품 trace 소스에 기존 Tao 로그만 결합했다. Alt+Space 메뉴27.395초에서 pong0/마지막 응답 후30.054초 timeout, 실제 메뉴 종료 뒤21표본 offline. 앱은 정상 종료했다. 제목 표시줄 메뉴62.594초 대조는 pong13/online 유지·정상 종료. 짧은 대조 재시도는 사용량 중단으로 정상 종료 판정에서 제외했고 증거를 보존했다. 원시 로그/전체 소스·앱·adapter 해시/동일 WebView 경로 버전/소유 잔류0 검증 완료. 제한 전 제품 복귀는 미검증이다. 다음은 동기 Alt+Space 큐 전달을 제품 계측 복사본에만 적용한 장시간 메뉴·제목 표시줄·종료 검증이다. 제품/fuzz 수정 및 N/F/M 재실행 없음, Phase5 차단 유지.

동일 원본/큐 전달 진단 바이너리의 새 `menu-two-escape` 증거에서 첫 Escape는 팝업만 숨기고 두 번째 Escape가 실제 메뉴 루프를 종료함을 확인했다. 두 조건 모두 기존 recovery predicate 통과, 정상 exit0/자식 audit verified/소유 잔류0. 원본은 27.383초 메뉴 구간 tick/ack0/0, 실제 종료11ms 뒤 Rust tick 재개. 큐 전달은 25.648초 메뉴 구간25/13으로 응답 유지. 따라서 앞선 1회 Escape 실행의 정상 종료 실패를 영구 교착으로 해석하지 않으며, 이번 원본까지의 복구를 큐 전달의 고유 효과로 주장하지 않는다. 전체 snapshot 소스/앱 해시와 원시 로그·marker·수치 재계산은 `phase5-syschar-context-20261023/analyze-two-escape.mjs`로 검증했다. 제품 watchdog이 없는 30초 미만 단기 진단이므로 실제 제품 app_offline 해결은 미검증이다. 다음은 실제 메뉴 종료를 관측하는 시험 절차와 메뉴 유지 중 제품 heartbeat 정지를 분리한 bounded 검증이다. 새 제품 수정이나 N/F/M 본시험 없이 이번 두 진단만 완료, Phase 5 차단 유지.

### 2026-10-24 제품 Tao patch와 비계측 창 smoke

승인한 저장소 내부 Tao 0.35.3 override를 구현했다. upstream 119파일 원본 hash/라이선스를 보존하고 Windows event_loop.rs 1개 수정 + helper/test 1개 추가로 제한했다. stub RED 2실패 뒤 predicate4, 전체Rust185, frontend15 및 offline/locked release build 통과. sandbox의 기존 IPC 시험 실패는 같은 기준 버전을 sandbox 밖에서 실행해 통과했으며 원시 실패도 보존했다.

`artifacts/phase5-product-patch-20261024/native1`은 사용량 중단으로 driver 미완료/시간 제한 종료라 정상 종료 판정에서 제외했다. 명시적 재개 후 같은 비계측 제품의 `native2`에서 메뉴 표시46.223초, 반복 열기/최대화·복원/제목 표시줄 메뉴/웹 입력란 포커스/메뉴 Close를 확인했다. 종료 전143상태 online·동일연결, app exit0/adapter EOF0/정상종료/audit verified/소유 잔류0 및 소스·바이너리hash 검증. 제품 SHA256 `2e2911c3eb830fc8f207ce3c41852015417c75f1c34ed23f7f8dcab006772316`.

정적 review는 현재 고정 Tauri 사용 방식에 차단 결함을 찾지 못했다. 재전달로 raw Tao IME 이벤트가 중복될 수 있으나 현재 런타임은 이를 사용하지 않는다는 제한을 기록했다. 창파괴-before-replay 정밀 경합과 정식 N(SSH 포함) 검증은 남아 있다. 기존 N 0/2, F/M 및 Phase5 출시 차단은 유지한다. 상세 결과·중단/관측 정정·범위는 `docs/testing/rust-tao-system-menu-patch.md`를 참조한다.
