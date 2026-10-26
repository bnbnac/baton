# Native Transition Cadence Feasibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 실제 창 조작으로 60초 주기의 전환 3회를 수행할 수 있는지 확인하는 별도 진단을 준비한다.

**Architecture:** 기존 separated runtime·NativeCasesMailbox·전환 검증을 재사용하는 `native-cadence` 진단을 추가한다. 제품과 기존 M/F/N 계약·판정기는 수정하지 않는다. 실행기와 별도 원시 증거 판정기가 운영 속도·증거 유효성·정상 종료를 구별한다.

**Tech Stack:** Node.js ESM/node:test, 기존 PowerShell 프로세스 감독/OS sampler, Docker SSH fixture, Computer Use `node_repl` + `@oai/sky`.

**Spec:** [승인된 준비안](../specs/2026-10-25-rust-native-transition-feasibility-design.md), 준비 커밋 `868493e`. 사용자 승인 후 구현과 단일 실제 진단까지 마감했다. 결과는 아래 기록을 따른다.

**진행 기록(2026-10-26):** 현재 세션에서 직접 구현하고 독립 최종 리뷰의 3건을 수정했다. 단일 실제 진단은 첫 회차 시간 초과로 종료됐고 증거 유효성과 정상 정리를 검증했다. 추가 실행·heartbeat·2시간 시험은 시작하지 않았다.

## Global Constraints

- 32연결/16세션/2서버, 최대3회, 세션 순서0→1→0. 대상 연결은 현재 adapter+16 modulo32.
- 회차는 탭 선택부터 resize/회수/연결 선택/전달·상태 검증·전체audit/health 완료까지 포함한다. 최초 복원 창 준비는 별도다.
- 첫 회차부터60초를 넘기면 후속 회차 생략. 다음 시작은 이전 시작+60초보다 빠르지 않다. 준비 포함900초 상한, 입력120초/접수 후검증45초는 회차 잔여시간보다 길게 적용하지 않는다.
- 정상 종료/정리는 별도 처리하고 실패 시에도 수행한다. 종료 실패·강제 정리는 별도 실패이며 조용히 통과시키지 않는다.
- 실제 Computer Use 관측→단일입력→재관측, 시작 승인 전 입력 금지. OS 입력 helper/관측 없는 입력 반복은 만들지 않는다.
- 준비 후 Playwright 분리, 측정 중 CDP/JS/강제GC0. OS 표본30초 목표, 기존45초 최대 공백. 짧은 결과에 memoryVerdict 적용 금지.
- 회수 경계 미수신 꼬리 폐기 허용. stream 내부 gap/중복/혼합은 허용하지 않는다.
- 제품·Cargo·미완성 fuzz 및 기존 M/F/N 소스/판정/원시 증거 변경 금지. 기존 작업 트리와 현재 후보 바이너리 사용, 재빌드 금지.
- 2시간 자동 실행/자동 재시도 없음. `longRunReadiness:unproven`, `memoryAcceptance:not_evaluated`, `phase5Acceptance:false` 고정.

## Review Focus

1. 지연된 입력 승인/receipt가60초 이후 도착: 추가 입력·완료 승격을 막는다(Task1/2).
2. 같은 세션 재방문에서 최초 owner를 재사용: 실제 현재 owner/epoch/stream을 따라야 한다(Task1/3).
3. deadline 도달 시 진행 중 MCP/파일 작업과 cleanup 경합: 취소되지 않은 비동기 작업을 남기지 않는다(Task2).
4. 시작 직전/간격 대기의 시간을 제외해 빠른 회차로 표시: 원시 단조 시각과 예정/실제 시작으로 판정한다(Task1/3).
5. 시간 초과 후 audit 또는 정리 증거 부재: 기록 가능한 부적합과 증거 손상을 구별하며 성공 receipt를 만들지 않는다(Task2/3).

## File Structure

모든 새 실행 소스는 `rust/tests/phase5/native-cadence/`에 둔다.

| 파일 | 역할 |
|---|---|
| `policy.mjs`, `policy.test.mjs` | 3회 계약, 회차 deadline과 다음 시작 계산 |
| `scenario.mjs`, `scenario.test.mjs` | mailbox 조작과 전환/audit/health, deadline 처리 |
| `run.mjs`, `launch.mjs`, `run.test.mjs` | 별도 실행 entry, source 신원, once-only launch, 종료/정리 |
| `verify.mjs`, `verify.test.mjs`, `test-fixture.mjs` | 원시 증거 독립 판정과 변조/부분 실행 회귀 |
| `docs/testing/rust-native-transition-feasibility.md` | 준비·실행 명령과 실제 결과/한계 |

## Task 1: 회차 시간과 방문 계약

**Interfaces:** `CADENCE={scope:'NC',profile:'diagnostic',seconds:900,rounds:0,maxRounds:3,sessionOrder:[0,1,0],periodMs:60000}`. rounds=0은 기존 runtime supervisor가900초로 계산하게 하는 내부 호환 값이며 실제 횟수는 maxRounds다. 기존 resolveContract에는 NC를 추가하지 않는다.
`roundWindow({round,startedAt,previousStartedAt,runDeadline}) -> {index,startedAt,deadline}`; `nextStart(previousStartedAt)->number`; `withinDeadline(now,deadline)->boolean`은 단조 ms를 사용한다.

- [x] RED: round0/1/2 index0/1/0, round3거부; 다음 시작 이전 시작+60000, 59999ms조기시작 거부; deadline=min(start+60000,runDeadline); 정확히60000허용/60000초과거부; runDeadline 경과시 시작 거부 테스트.
- [x] Run `node --test rust/tests/phase5/native-cadence/policy.test.mjs`로 새 계약이 없어서 실패하는지 확인한다.
- [x] 위 순수 함수와 고정 상수를 구현한다. 시간 비교 오차를 허용하는 추가 grace는 넣지 않는다.
- [x] 같은 명령 PASS를 확인하고 이 두 파일만 로컬 커밋한다.

## Task 2: 독립 실행기와 실제 조작 조정

**Consumes:** Task1 계약, 기존 `createRuntime`, `NativeCasesMailbox`, `selectedGeometry`, `remoteGeometry`, `verifyTransition`, `reserveLaunch`, `runExperiment`. 기존 `native-ui.mjs` start/done/failed CLI와 화면 receipt 형식을 재사용한다.
**Produces:** `runCadence(r,mailbox)->{completedRounds,cadenceObserved,stopReason}`; `createCadenceRuntime(options,deps)->runtime`; CLI `launch.mjs fresh-dir config.json` 및 내부 `run.mjs fresh-dir config.json`.

- [x] RED: 가짜 단조 clock/runtime으로 3회 정상 진행(0→16,1→17,16→0), 첫 회차초과 후 두 번째미시작, receipt접수후검증초과, 준비실패/중도중단에도 shutdown→cleanup→hash확인, 종료실패 보존을 검사한다. 60초를 넘긴 지연 완료가 transition success를 생성하지 않아야 한다.
- [x] Run `node --test rust/tests/phase5/native-cadence/scenario.test.mjs rust/tests/phase5/native-cadence/run.test.mjs` RED 확인.
- [x] 별도 runtime factory는 기존 createRuntime에 NC 계약을 전달한다. manifest wrapper는 원래 manifest에 모든 새 진단 실행/판정 소스 hash를 추가한다. source 변경/바이너리 변경은 종료 시 거부한다. 기존23소스가 그대로인지 저장된 M/F receipt hash와 읽기 전용 대조하고, 추가 진단 소스가 있어 전체 동일소스라고 주장하지 않는다. 현재 binary/image/environment도 대조하며 다르면 부하 시작 전에 중단한다.
- [x] 기존 runExperiment의 사용자 지정 scenarios에 `{NC:runCadence}`를 전달한다. setup/종료/정리 복제를 피한다. launcher는 기존 reserveLaunch의 새경로/독점 파일을 사용하고 숨겨진 프로세스로 시작한다. 새로운 scope를 N으로 위장하지 않는다.
- [x] setup 후 browser분리, 최초 복원 창 준비를 mailbox로 확인한 다음 측정을 시작한다. 이 준비 구간은 회차 시간에서 제외하되900초 상한 안에 둔다. 원시 `cadence_round_start`에 round/index/previous/current binding/startedAt/deadline 기록.
- [x] 기존 N의 선택→resize→회수→연결 선택→전달 경로를 새 scenario에서 구성하고 모든 request expiresAt을 min(runDeadline,roundDeadline)로 제한한다. 기존 함수의45초 waitFor도 잔여 회차시간에 제한되도록 **이 runtime 인스턴스의 대기 wrapper**로 처리한다. 공통 소스나 전역 prototype은 바꾸지 않는다. UI 드라이버는 매 입력 전 실제 runner 승인과 기한을 확인하며 종료/기한경과 후 receipt를 보내지 않는다.
- [x] 각 await 전후 단조 clock을 확인한다. 취소 불가능한 작업을 Promise.race로 버린 채 cleanup하지 않는다. 끝난 진행중 작업을 수습한 뒤 초과 실패를 기록하고 신규 명령/입력을 시작하지 않는다. 기존 RPC timeout은 유지하며 deadline이 도중 지나면 늦은 결과를 성공으로 세지 않는다. 회차 사이 대기에도 output service/30초 OSsample을 유지한다.
- [x] deadline 검사는 mailbox뿐 아니라 이 runtime의 `tool`/`checkStop`/`waitFor` wrapper에도 둔다. 그래야 16세션 audit·32연결 health 내부 RPC도 기한 이후 새로 시작되지 않는다. 준비 중에는 born+900000, 회차 중에는 그 상한과 roundDeadline의 최솟값, 간격 대기에는 전체 상한을 적용한다. 초과 후 이미 진행 중인 RPC가 끝나는 시각은 별도 기록하며60초 종료 성공으로 표시하지 않는다. 단위 검사에 audit 중 첫 지연 RPC 이후 나머지 세션 명령0건 및 cleanup에서만 guard 해제되는 사례를 추가한다.
- [x] 회차 완료는 adoption→audit(round)→health까지 완료한 뒤 기록한다. 중단 시 `freeze`는 측정 시작된 경우 한 번만 실행한다. 완료 audit와 부분 audit의 실제 서버 파일을 보존하고, 진행중 전환/binding 미완료를 누락으로 숨기지 않는다. 종료/정리 경로는 cadence deadline을 해제하되 기존 자체 timeout을 유지한다.
- [x] timeout 이후 서버 audit 수집은 새 사용자 명령을 보내지 않는 fixture 파일 조회로 제한한다. `s.audits`에 기록하기 전에 timeout이 발생해도 실제 서버 효과가 있을 수 있으므로, 메모리 배열을 정답으로 간주하지 않고 원시 요청/응답/파일의 부분 효과를 대조한다. 파일 조회 실패도 기록하며 증거 완전성을 추정하지 않는다.
- [x] 위 tests PASS, 기존 `node --test rust/tests/phase5/separated/native.test.mjs rust/tests/phase5/separated/runtime.test.mjs` PASS. 실제 UI 시험 없이 이 작업의 소스만 커밋한다.

## Task 3: 원시 증거 판정과 운영 준비

**Interfaces:** `verifyCadenceEvidence(e)->{evidenceValid,completedRounds,cadenceObserved,longRunReadiness:'unproven',memoryAcceptance:'not_evaluated',phase5Acceptance:false,errors,metrics}`. `verifyCadenceDirectory(out)->result`는 검증 receipt가 이미 있으면 중단하고 한 번만 기록한다. 기존 verified.json 대신 `cadence-verification.json`을 사용하며 M/F/N 통과 이름을 발행하지 않는다.

- [x] RED: 3정상회차, 1회시간초과, 0회준비실패, 외래owner, 새stream재사용, 세션0의두번째방문잘못된owner, 짧게조작된duration, 누락/중복audit, receipt이후MCP상태부재, debugger접속, OS표본공백, 외래process, cleanup실패, summary/hash변조를 원시 fixture로 검사한다.
- [x] Run `node --test rust/tests/phase5/native-cadence/verify.test.mjs` RED 확인.
- [x] 기존 LogOracle, verifyTransition, validateShutdown, assertProcessIdentity를 재사용한다. 기존 verifyEvidence는 F/N 고정횟수와 네이티브 사례 순서가 달라 NC에 호출하지 않는다. 새 판정기는 raw event 순서/owner/scope, 0→1→0 binding chain, mailbox request/start/acceptance/result와 실제 MCP/server 관측, 공개 stream cursor연속성을 직접 대조한다. 조작 완료 receipt만으로 통과시키지 않는다.
- [x] 완료 회차 audit는 전체16세션 round당정확히1효과, raw 중복send_text 동일request_id/결과 및 Enter를 대조한다. 미완료 회차의 일부 효과는 별도로 보고한다. raw health/출력/OS표본과 summary를 대조하고 새 소스·기존소스·바이너리해시를 검증한다. 각 natural sample은 일치하는 process신원, debugger연결0, 합산memory일치를 요구한다. 준비와 종료 표본은 측정에 섞지 않는다.
- [x] 회차의 예정/실제 시작·60초상한·audit/health 포함완료 시각을 대조한다. 세 회차완료와 정상종료/EOF32/소유잔류0일 때만 cadenceObserved=true. 정상 증거가 있는 시간초과는 evidenceValid=true/cadenceObserved=false; 필수기록부재/변조는 evidenceValid=false다. 어느 경우도 장기메모리합격을 의미하지 않는다.
- [x] 새 tests 전체와 기존 separated tests를 명시적 파일목록으로 실행한다(미완성 fuzz 제외). PASS 후 새 파일만 커밋한다. 해당 단계에 필요한 review는 변경 범위와 deadline/증거 독립성에 집중한다.
- [x] 운영 문서에 config/현재hash/새실행명령/receipt명령/정리 절차를 기록한다. 실행 명령은 `node rust/tests/phase5/native-cadence/launch.mjs artifacts/phase5-native-cadence-20261025/run1 artifacts/phase5-native-cadence-20261025/config.json`; 새 부모폴더와 config는 실행 직전 준비한다. 이미 존재하면 다른 이름으로 자동 재시도하지 않는다.

## Task 4: 준비 확인 후 한 번 실행·마감

- [x] 구현 검토 및 단위 검증이 끝난 뒤 실행 준비 상태를 보고한다. Computer Use 런타임·현재도구규칙을 먼저 확인한다. 지정 앱이 아닌 창에는 입력하지 않는다. 아직 실행을 시작하지 않았다면 이 계획을 실제 시험 완료로 표시하지 않는다.
- [x] 승인된 실행 범위 안에서 launch를 한 번 수행한다. 각 pending→start승인→관측→단일입력→재관측→done→runner검증을 따른다. 첫 회차60초초과/입력기한만료/관측불일치 시 입력을 멈추고 runner 정상 종료를 확인한다. 사용량 중단 시 자동 재개·늦은 입력을 하지 않는다.
- [x] finished 이후 verifier를 한 번 실행하고 raw시간/완료수/정리결과와 대조한다. 시험 원인과 운영 원인을 분리하고 문서만 결과 커밋한다. owner label+이름/ID 및 PID+시작시각이 일치하는 소유자원만 정리하며 보존image는 삭제하지 않는다.
- [x] 3회완료 여부와 회차시간을 보고하고 종료한다. 성공이어도 2시간 시험/heartbeat를 자동 시작하지 않는다. 실패면 그 증거를 보존하고 새 방법을 별도로 검토한다.

## Self-review

승인 spec의3회/60초/900초/실제UI/무CDP/정상정리/역사보존을 Task1~4에 매핑했다. 0→1→0은 기존 verifyRounds의round%16과 다르므로 공통 판정기를 재사용하지 않는다. 기존 runtime의상태·프로세스수명은 재사용하되 회차deadline은 종료에 적용하지 않는다. 준비/지연receipt/부분audit/시간초과는 새로운 통과가 되지 않도록 별도 fixture를 요구한다. 현재 방식은 기존 N보다 빨라진다고 가정하지 않으며 첫 초과에서 중단한다.

## 2026-10-26 구현 검증

Task 1~3 구현 완료. 독립 최종 리뷰의 duration 경계, 부분 audit 양방향 대조, 중첩 sampler 누락 3건을 각각 RED→GREEN으로 수정했다. 기존 separated를 포함한 118개 단위 테스트 통과. Task 4 실제 진단은 아직 시작하지 않았다. 제품·Cargo·fuzz·기존 M/F/N 파일은 변경하지 않았다.

## 2026-10-26 Task 4 마감

위 구현 검증 이후 `a511479`에서 `artifacts/phase5-native-cadence-20261025/run1`을 한 번 실행했다. 회차 60.0260851초에 중단, 완료 0/3회, 후속 회차 없음. 세션 선택 검증 후 최대화 화면을 관측했으나 기한 내 resize receipt를 제출하지 못했다. `cadence-verification.json`은 한 번만 생성됐으며 `evidenceValid:true`, `cadenceObserved:false`, errors 0이다. 정상 exit, EOF32, 강제 정리 없음, 소유 잔류0, 보존 image 유지. [상세 결과와 운영 한계](../../testing/rust-native-cadence-feasibility.md#2026-10-26-single-live-result).

원시 시간·표본·출력률·summary/hash·정리 결과의 별도 대조는 `completion-analysis.json`에 남겼다. 장기 메모리 판정과 Phase5 인수는 해제하지 않는다. 실행 중 발생한 빈 mailbox 조회 TypeError는 시험 종료 및 검증 후 별도 회귀 테스트로 수정했고(3e1de15), 진단 단위 30/30 통과. 원본 helper는 `ui-at-run.mjs` 및 실행 커밋에 보존했다. 재실행이나 기존 receipt 덮어쓰기는 하지 않았다.
