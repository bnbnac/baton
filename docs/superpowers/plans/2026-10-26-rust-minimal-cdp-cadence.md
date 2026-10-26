# Minimal CDP Cadence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 최소 raw CDP 조작으로 60초 주기의 전환 3회가 가능한지 판단할 별도 진단을 구현한다.

**Architecture:** 기존 separated fixture/MCP/lifecycle와 native-cadence의 순수 시간 계약·인스턴스 guard를 읽기 전용으로 재사용한다. 새 CDP 조작기, attached OS sampler, scenario 및 독립 verifier는 `minimal-cdp-cadence`에 둔다. 기존 M/F/N 및 native-cadence 소스를 변경하거나 진단 scope를 F로 위장하지 않는다.

**Tech Stack:** Node.js ESM/node:test/내장 WebSocket, 기존 PowerShell OS 계측, Docker SSH fixture. 새 npm 의존성 없음.

**Spec:** [승인된 설계](../specs/2026-10-26-rust-minimal-cdp-cadence-design.md). 현재 단계는 계획 작성이며 구현·부하 실행은 미착수다.

## Global Constraints

- 기존 작업 트리 `C:/Users/sj/Documents/work/code/baton/.worktrees/rust-phase-0`에서 현재 세션의 직접 구현 방식을 유지한다.
- 32연결/16세션/2서버, 최대3회, 세션0→1→0, 현재 adapter+16 modulo32로 전달한다.
- 회차별 모든 검증/audit16/health32 포함60000ms, 다음 시작은 이전 시작+60000ms 이후, 준비 포함900000ms. 초과 시 후속 회차0, 재시도/몰아 실행/유예0. 정상 종료는 별도 timeout을 사용한다.
- geometry 안정750ms, DOM terminal 너비720/1000px 변경 및 MCP/서버 stty 일치. OS 창 최대화·실제 입력 검증으로 주장하지 않는다.
- 준비 Playwright 분리 후 정확한 소유 page에 raw CDP 연결1개. Network.disable 확인 후 도메인 enable0/강제GC0/heap진단0. 제한된 동기 DOM 표현식만 실행한다.
- 30초 OS 표본 목표/45초 최대 공백. phase는 `minimal_cdp_attached`; CDP가 있으므로 기존 detached 조건으로 표기하지 않는다.
- 기존23개 공통 소스·바이너리2개·image·환경을 M/F 사전 증거와 대조한다. 재사용 native-cadence 및 모든 신규 실행/검증 소스의 해시도 추가한다.
- 제품·Cargo·미완성 fuzz·기존 결과/판정기 변경 또는 재실행 금지. 새 시험은 경로 독점 예약, 독립 verifier는1회만 실행한다.
- 즉시 회수 시 미수신 꼬리 폐기는 허용한다. 공개 stream 내부 연속성/혼합/권한 검증은 유지한다.
- `longRunReadiness:'unproven'`, `memoryAcceptance:'not_evaluated'`, `phase5Acceptance:false`. 2시간 시험·heartbeat 자동 시작 없음.

## Review Focus

1. DOM 교체/중복 이름/disabled 컨트롤로 잘못된 세션 조작: 전체 ID와 유일성·활성 조건 불일치는 입력 전에 거부(Task1).
2. 시간 초과된 CDP 요청의 늦은 성공/부작용: 후속 입력을 차단하고 실행 여부 불명과 실제 관측을 구별(Task1/2).
3. 세션0 재방문 시 최초 owner/stream 재사용: 현재 binding과 새 stream을 원시 MCP로 검증(Task2/3).
4. 외래 page/추가 debugger 연결 또는 계측 실패를0으로 오인: endpoint/process 신원과 소켓·OS 기록을 대조하고 누락은 실패(Task1/2/3).
5. audit 중 중단 후 일부 효과나 정리 실패가 누락: 원시 RPC↔서버 효과 양방향 대조와 실패 기록 보존(Task2/3).

## File Structure

아래 코드는 모두 새 경로 `rust/tests/phase5/minimal-cdp-cadence/`에 둔다.

| 파일 | 책임 |
|---|---|
| `cdp.mjs`, `cdp.test.mjs` | 소유 target 선택, 제한된 transport, deadline·종료·명령 증거 |
| `dom.mjs`, `dom.test.mjs` | 제한된 동기 DOM 조작 표현식과 작은 반환값 |
| `sampling.mjs`, `sample-debug.ps1`, `sampling.test.mjs` | attached OS 표본, 소유 debugger endpoint 관측 |
| `scenario.mjs`, `scenario.test.mjs` | 3회 전환, 주기, 출력/audit/health, 중단 |
| `run.mjs`, `launch.mjs`, `run.test.mjs` | runtime wrapper, manifest/기준 대조, 실행·정리 |
| `verify.mjs`, `verify.test.mjs`, `test-fixture.mjs` | 독립 원시 증거 판정 및 변조 fixture |

운영 문서: `docs/testing/rust-minimal-cdp-cadence-feasibility.md`. 이 계획과 spec은 진행 기록만 갱신한다. artifacts의 과거 raw-cdp.mjs는 참고만 하고 실행 의존성으로 가져오지 않는다.

## Task 1: 제한된 CDP 조작기

**Interfaces:** `selectOwnedTarget(targets,port)->{id,url,webSocketDebuggerUrl}`는 정확히 하나인 `type:'page',url:'http://tauri.localhost/'` 및 같은 loopback port를 요구한다. endpoint의 소유 프로세스 검증은 Task2가 제공한다.
`connectCdp({target,deadline,now,record,WebSocketImpl})->client`; `client.send(method,params,deadline)->Promise<result>`; `client.close()->Promise<void>`; `client.state`는 연결/실패/닫힘을 나타낸다. record는 순서 보존 async JSONL writer다.
`domExpression(action,args)->string`, action은 `select|identity|resize|reclaim|choose_connection|handoff`만 허용한다. 결과는 `{sessionId,connectionId?,width?}` 또는 명시적 오류다. run에서 수집한 전체 ID만 args로 전달한다.

- [x] RED: 아래 이름과 조건을 `cdp.test.mjs`, `dom.test.mjs`에 작성한다. fake WebSocket/clock과 최소 DOM fixture를 사용하며 live 앱에는 연결하지 않는다.
  - `rejects foreign or ambiguous target`: 타 port/host/URL/중복 page 거부, 전송0.
  - `rejects unapproved methods`: Network.enable/HeapProfiler/임의 메서드 전송0. 허용 메서드는 Network.disable과 생성된 Runtime.evaluate뿐이며 표현식은 domExpression 출력과 대조한다.
  - `records timeout as uncertain`: clock이 deadline을 넘으면 새 send0, 늦은 응답이 성공을 생성하지 않고 pending 정리. 소켓 close/error/잘못된 JSON/exceptionDetails도 실패로 기록.
  - `requires unique enabled visible target`: 중복/없음/disabled/숨김/잘못된 전체 ID에서 click/change0. render 교체 후 선택은 새 DOM을 조회한다.
  - `uses DOM handlers only`: 선택 value+change, 버튼 click,720/1000px 변경은 허용하며 내부 invoke/모델 호출·타이머·원격 핸들 반환은 없다. 반환은 by-value 작은 값이다.
- [x] `node --test rust/tests/phase5/minimal-cdp-cadence/cdp.test.mjs rust/tests/phase5/minimal-cdp-cadence/dom.test.mjs` RED를 확인한다.
- [x] 위 인터페이스를 구현한다. `Runtime.evaluate`는 awaitPromise=false/returnByValue=true, 동기 표현식 실행 timeout도 잔여 deadline 안에 둔다. 전송1건씩 직렬 처리한다. 표현식 템플릿과 args는 안전한 직렬화로 결합하고 trace에는 요청ID/owner/round/action/전체 대상ID/시각/표현식SHA/결과를 남긴다. 요청·응답 기록 실패는 부하를 중단한다.
- [x] socket close를 기다리되 종료도 유한 timeout을 둔다. timeout 시 소켓을 닫는다고 이미 실행된 DOM 이벤트를 취소했다고 표시하지 않는다. 앱 이벤트가 시작한 비동기 처리 완료는 Task2의 MCP 상태로 검증한다.
- [x] 같은 명령 PASS 후 Task1의4개 파일만 로컬 커밋한다.

## Task 2: attached sampler와 독립 실행기

**Consumes:** Task1 client/DOM; 기존 `installCadenceGuard`(native-cadence/run.mjs), `roundWindow`, `nextStart`(policy.mjs), separated `createRuntime`, `runExperiment`, `reserveLaunch`, `selectedGeometry`, `remoteGeometry`, `verifyTransition`.
**Produces:** `createCdpCadenceRuntime(options,deps)->r`; `runCdpCadence(r,{connectCdp})->result`; `executeCdpCadence(r)->summary`; `sampleAttached(r)->sample`. 계약은 `{scope:'CC',profile:'diagnostic',seconds:900,rounds:0,maxRounds:3,sessionOrder:[0,1,0],periodMs:60000}`. rounds0은 기존 supervisor 호환 값이다.
`sample-debug.ps1 -Port <port>`는 관측UTC/port/각 listener 및 established의 PID·시작ticks·양쪽 주소/port를 JSON으로 반환한다. 조회 실패는 오류이며 빈 성공으로 변환하지 않는다.

- [x] RED: `sampling.test.mjs`, `scenario.test.mjs`, `run.test.mjs`에 정상0→16/1→17/16→0 binding,60000ms 허용/초과 거부, 조기 다음 회차 거부, audit 중 timeout 후 신규 입력0, 지연 요청 불명 기록, cleanup 전 CDP종료를 검증한다. 가짜 clock/service로 실제 대기 없이 실행한다.
- [x] sampler 테스트에 외래 PID/시작ticks/추가 established 연결/조회 실패 거부,32adapter+app+renderer 신원 유지,private/working 합산,attached phase,중첩 audit/wait와 회차 간 대기에서30초 수집/45초 공백 검출을 추가한다.
- [x] `node --test rust/tests/phase5/minimal-cdp-cadence/sampling.test.mjs rust/tests/phase5/minimal-cdp-cadence/scenario.test.mjs rust/tests/phase5/minimal-cdp-cadence/run.test.mjs` RED를 확인한다.
- [x] createRuntime에 CC계약을 전달하고 이 인스턴스에만 guard와 sampler를 설치한다. 기존 sampler를 호출하기 위해 scope를 잠시 F로 바꾸지 않는다. process role 수집/identity 검사 로직을 새 sampling 모듈에서 조합하고 준비 단계와 attached 측정을 구분한다. 측정 표본은 listener≥1/서버측 established1 및 소유 WebView 프로세스 신원, client의 열린 raw 세션1을 대조한다. OS 표본만으로 순간적인 모든 외부 연결 부재를 증명한다고 하지 않는다.
- [x] manifest에는 기존23개에 신규 실행·검증 `.mjs`/PowerShell 및 가져온 native-cadence 실행 모듈의 전이적 의존성을 모두 추가한다(테스트 제외). 기준 비교는 M/F receipt에 기록된 정확한23개 key 집합으로 수행한다. 모든 현재 소스/바이너리 hash와 image/environment를 시작·종료에 대조하고 추가 소스를 동일23개라고 주장하지 않는다. 기준 mismatch/경로 중복/launch실패/정리실패 회귀 테스트도 추가한다.
- [x] 기존 lifecycle을 `runExperiment(r,{CC:runCdpCadence})`로 호출한다. 기존 시작/끝 event 자체의 t를 측정 경계로 사용해 exact elapsed를 계산한다. launcher는 현재 Node·windowsHide·독점 경로 예약·commit/PID/UTC 기록을 유지한다. `launch.mjs fresh-dir config.json`은 한 번 실행하며 실행기 내부는 `run.mjs`다.
- [x] 준비 Playwright를 분리하고 OS endpoint 신원을 확인한 뒤 target을 선택한다. raw 연결1개, Network.disable 성공, 전체ID 조회를 기록한 다음 측정을 시작한다. 준비에도900초 guard를 적용한다. 실패 시 새 target 탐색/연결 재시도는 하지 않는다.
- [x] 회차마다 fresh DOM 선택/전체ID 확인→selectedGeometry750ms→720/1000px 중 geometry를 변경할 너비 적용→MCP/stty→회수→다른 전체 연결ID 선택→handoff→이전owner 해제/새stream→adoptBinding→audit16→health32를 직렬 실행한다. 각 조작 전후 guard와 MCP 관측을 남기고 UI 반환값만으로 transition event를 만들지 않는다.
- [x] `service`/`tool` 인스턴스 wrapper에서 재진입 방지된 sampler를 호출해 중첩 wait/audit 중에도 수집한다. 회차 사이에도 output service를 계속한다. 진행 중 작업을 Promise.race로 버리고 cleanup하지 않는다. 실패 후 신규 입력은 차단하고 부분 MCP/audit/전환을 남긴다. freeze1회, raw 연결 종료, fixture 파일 audit 회수, shutdown/cleanup 순서를 적용하며 각 단계 실패를 보존하고 다음 정리는 시도한다.
- [x] instrumentation은 `rawCdpSessions:1`, 실제 evaluate 횟수, DOM action/조회 횟수, `forcedGcCalls:0`, `heapDiagnosticCalls:0`를 구분한다. Runtime.evaluate를 사용하면서 JS 실행0이라고 기록하지 않는다. 기존 jsProbes가 메모리 진단만 뜻하면 그 정의를 문서화한다.
- [x] Task2 tests 및 기존 `node --test rust/tests/phase5/native-cadence/policy.test.mjs rust/tests/phase5/native-cadence/run.test.mjs rust/tests/phase5/separated/runtime.test.mjs` PASS 후 Task2 파일만 커밋한다. live 실행 없음.

## Task 3: 원시 증거 검증과 운영 준비

**Interfaces:** `verifyCdpCadenceEvidence(e)->{evidenceValid,completedRounds,cadenceObserved,longRunReadiness:'unproven',memoryAcceptance:'not_evaluated',phase5Acceptance:false,errors,metrics}`; `verifyCdpCadenceDirectory(out)->result`.
e는 summary/events/output/memory/cdp JSONL/audit-observations/normal-boundary/process/final-cleanup이다. CDP trace는 `cdp.jsonl`; 독점 claim/result는 `cdp-cadence-verification.claim`/`cdp-cadence-verification.json`이다.

- [x] RED: `test-fixture.mjs`에 최소 완전3회와 유효한 기한 초과0회 fixture를 만든다. `verify.test.mjs`에서 잘못된 target·CDP미기록·허용되지 않은 도메인·늦은 성공·geometry증거 누락·재방문 owner 오류·stream재사용·누락/중복 audit·부분 Enter효과 불일치·소켓/OS연결 불일치·OS공백·강제정리·hash변조를 각각 실패로 만든다. CDP응답만 성공하고 MCP가 바뀌지 않은 fixture도 거부한다.
- [x] `node --test rust/tests/phase5/minimal-cdp-cadence/verify.test.mjs` RED를 확인한다.
- [x] LogOracle/verifyTransition/validateShutdown/assertProcessIdentity를 재사용한다. 고정 F/N verifier나 네이티브 receipt verifier를 호출하지 않는다. event의 owner/scope/seq/단조시각,CDP request-response-terminal outcome,정확한 허용 템플릿SHA/args,0→1→0 binding,조작 후 MCP/서버 상태를 대조한다. 실패한 CDP요청은 명시적 uncertain/failed로 남아야 하고 성공 회차로 승격되지 않는다.
- [x] 완료 회차마다16 audit효과/32 health,raw 중복request_id 응답과 실제 Enter,서버파일을 양방향 대조한다. 미완료 회차의 효과와 소유권 변경도 따로 보존한다. 출력률은 성공 회차 실행에서 세션별≥1024B/s 및 stream내 gap/중복/혼합0을 요구한다. 회수 경계 꼬리는 계약대로 제외한다.
- [x] OS원시 합계/신원/연결 및 요약,표본 간격≤45초,회차 시작 간격≥60000ms/완료≤60000ms,정상종료·EOF32·소유잔류0을 검증한다. 불완전 증거와 기록된 운영 실패를 구별한다. 짧은 결과에 memoryVerdict를 호출하지 않는다. directory verifier는 현재소스/바이너리·기준 receipt/hash·원시파일 hash를 대조하고 결과를 독점 작성한다.
- [x] 전체 신규 단위 테스트를 명시적 파일 목록으로 실행한다: `node --test rust/tests/phase5/minimal-cdp-cadence/cdp.test.mjs rust/tests/phase5/minimal-cdp-cadence/dom.test.mjs rust/tests/phase5/minimal-cdp-cadence/sampling.test.mjs rust/tests/phase5/minimal-cdp-cadence/scenario.test.mjs rust/tests/phase5/minimal-cdp-cadence/run.test.mjs rust/tests/phase5/minimal-cdp-cadence/verify.test.mjs`。 기존 separated contract/memory/native/runtime/transitions/verify 및 native-cadence policy/run/scenario/verify/ui의 명시적 test 파일도 한 번 검증한다. glob로 fuzz를 포함하지 않는다.
- [x] `docs/testing/rust-minimal-cdp-cadence-feasibility.md`에 config복사/고정hash/실행/중단/1회검증/정리 및 계측 한계를 작성한다. 명령은 아래와 같다. 구현 검토가 완료되기 전 실제 명령을 실행하지 않는다.

```powershell
node rust/tests/phase5/minimal-cdp-cadence/launch.mjs artifacts/phase5-minimal-cdp-cadence-20261026/run1 artifacts/phase5-minimal-cdp-cadence-20261026/config.json
node rust/tests/phase5/minimal-cdp-cadence/verify.mjs artifacts/phase5-minimal-cdp-cadence-20261026/run1
```

- [x] 새 코드와 운영 문서를 로컬 커밋한다. 실행 방식에 필요한 최종 검토는 새 diff의 deadline/원시 증거/계측 경계에 집중한다. 수정이 없고 검사 통과 뒤에는 같은 검사를 반복하지 않는다.

## 실제 실행으로 넘기는 조건

이 계획의 구현 완료 보고에는 단위 검증/검토 결과와 미확인 live 항목을 명시한다. 실제3회 진단은 사용자 실행 승인 범위가 확인된 뒤 한 번만 시작한다. `config.json`은 기존 `artifacts/phase5-sampler-diagnostic-20261025/config.json`을 복사하고 입력 신원을 확인한다. run1/log/launch가 이미 있으면 이름을 바꾸어 자동 재시도하지 않는다.

시작한 실행은 첫 실패 중단→정상 종료→소유 자원 정리→finished 확인→verifier1회→원시 시간/회차수/정리 직접 대조→결과 문서 커밋까지 마감한다. 제품/바이너리/진단 소스는 실행 중 변경하지 않는다. 보존image는 유지한다. 3회 통과도 장기 준비 완료나 출시 통과가 아니며 새2시간 시험은 별도 설계 대상이다.

## Self-review

설계의 조작 제약은 Task1,시간/부하/중단/신원/계측은 Task2,증거·판정·운영은 Task3에 대응한다. 기존 sampler의 CC거부와 baseline비교의 추가소스 문제를 새 인스턴스 구현으로 처리해 과거 판정은 보존한다. timeout은 실행 취소로 간주하지 않는다. 새 도구의3회 cadence만 평가하며 CDP영향 제거/네이티브입력/2시간메모리를 입증하지 않는다. 기존 단위 검사나 실제 부하는 계획 작성 중 실행하지 않았다.

## Implementation checkpoint
2026-10-26: Task1~3 implemented. Full explicit unit suite 169/169; PowerShell sampler syntax checked. Final independent review pending; no live test started. Ledger: .superpowers/sdd/2026-10-26-rust-minimal-cdp-cadence/progress.md.
