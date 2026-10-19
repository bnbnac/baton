# Phase 5 Separated Validation Implementation Plan

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

- 32개 고유 MCP 연결, 16개 SSH 세션, 별도 localhost 서버 두 개에 8개씩 배치한다.
- M 정상 부하 최소 7,200초; 셸별 최소 1KiB/s와 30초마다 4KiB burst; 120회 audit·1,920효과.
- M OS 관측 30초, 최대 공백 45초(양 끝 포함), warm-up 20분 이후 20분 구간 5개·각 최소 30표본. 마지막/첫 구간 합계 private 및 working 중앙값 비율 각각 ≤1.20.
- M 측정 중 Playwright/CDP·JS 진단·강제 GC 없음, debugger established 표본값 모두 0. listener와 준비 영향은 한계로 남긴다.
- F는 120회 횟수 기준, 상태 대기 45초, geometry 안정 750ms, 120회 audit·1,920효과. 분당 빈도·2시간 지속성·자연 메모리를 주장하지 않는다.
- N은 서로 다른 세션으로 복원·최대화 두 사례, 전체 watchdog 900초, 입력 후 상태 확인 45초. 관측·판단 시간에 55초 회차 제한을 적용하지 않는다.
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
- [ ] 구현 검토 후 승인된 실행 범위 내에서 M preflight 180초, F preflight 17회를 각각 한 번 수행한다. 명령: `node rust/tests/phase5/separated/launch.mjs artifacts/phase5-separated-20261018/m-preflight artifacts/phase5-separated-20261018/config.json M preflight` (F는 `f-preflight`, `F`). 각 finishedUtc 후 `node rust/tests/phase5/separated/verify.mjs <evidence-dir>`. 실패하면 다음 단계 자동 진행 없이 원인·소유 정리 결과를 기록한다.
- [ ] 같은 입력으로 N full 두 사례를 active computer-use와 수행하고 검증한다. 명령은 `.../launch.mjs .../n-cases .../config.json N full`; native CLI로 요청·receipt만 교환한다. 실제 조작과 캡처는 컴퓨터 제어 도구로 수행한다. 서로 겹치는 실행은 하지 않는다.
- [ ] 사전 검사와 N의 독립 결과·소스/바이너리/이미지/환경 비교·cleanup을 보고하고 정식 F/M의 준비 상태를 검토한다. 정식 실행은 별도 실행 결정 후 `.../f-full .../config.json F full`, `.../m-full .../config.json M full` 순서로 각각 한 번 시작한다. 실행 간 코드가 바뀌지 않았다면 이유 없이 이미 통과한 검사를 반복하지 않는다. 새 heartbeat는 별도 필요가 생긴 경우에만 설정하고 불변 상태 알림은 하지 않는다.
- [ ] 정식 실행 후 각 검증 결과·M 다섯 중앙값/비율·F 회차 소요시간/횟수·N 실제 창 관측·원시 증거 경로·제약을 기록한다. 보존 image는 최종 사용 종료 시 owner 대상 컨테이너 0 및 현재 tag ID 일치 확인 뒤 정리하고 `final-cleanup.json`에 남긴다. 문서만 명시 stage하여 로컬 커밋한다. 세 scope가 통과해도 결합 메모리 항목/출시 차단은 유지한다.

## 자체 검토와 실행 인계

설계 §3 공통 신원/생명주기는 Task 1/2/6, §4 M은 Task 3, §5 F는 Task 4, §6 N은 Task 5, §7 증거/판정은 Task 6, §8 실행 순서는 Task 7에 대응한다. Review Focus 다섯 항목 모두 관련 task의 실패 테스트에 포함했다. 새로운 출력 발생기의 시간 tick 분리는 시험 요구를 구현하기 위한 변경이며 제품 수정이 아니다.

권장 실행 방식은 **현재 세션에서 직접 구현 후 전체 변경 독립 검토**다. 공통 runtime·증거 schema에 대한 의존이 커 작업마다 별도 구현자를 두는 이점이 작다. 사용자에게 이 계획 검토와 실행 방식 선택을 요청한 후 착수한다. 구현 완료와 정식 장시간 시험 완료는 별도로 보고한다.
