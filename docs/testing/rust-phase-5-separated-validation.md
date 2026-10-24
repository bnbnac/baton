# Phase 5 목적별 시험 운영

상태(2026-10-23 최신): N 사례별 독립 완료 구현과 관련 테스트 131개·독립 리뷰를 마쳤다. 새 복원 사례는 app_offline으로 실패, 독립 사례 통과 0/2, 최대화 미실행이다. 후속 최소 Tauri 창에서도 SSH/MCP/watchdog 없이 메뉴 후 Rust 응답 중단·정상 종료 실패를 재현했다. 화면 JS 카운터는 증가하지만 Rust 수신은 멈췄고 종료 허용 후에도 같은 앱·WebView가 살아 있었다. 메뉴 없는 동일 바이너리 대조는 정상 종료했다. [조사 결과](rust-phase-5-offline-investigation.md)에 원시 근거와 하위 이벤트 처리 조사 범위를 기록했다. 현재 소유 잔류 0. 기존 실패와 정식 F/M·Phase 5 출시 차단은 유지한다.

[승인 설계](../superpowers/specs/2026-10-18-rust-phase-5-separated-validation-design.md), [구현 계획](../superpowers/plans/2026-10-18-rust-phase-5-separated-validation.md).

최신 추가 조사: Alt+Space는 Tao의 WM_PAINT → PeekMessageW 안에서 Windows 기본 메뉴 처리로 진입한 뒤 반환되지 않았다. Escape 후 화면에서 메뉴가 사라져도 실제 메뉴 종료 이벤트는 없었다. 같은 진단 바이너리의 제목 표시줄 우클릭 메뉴는 Rust 응답을 유지하고 실제 메뉴 종료 및 정상 앱 종료를 확인했다. 따라서 다음 조사 범위는 Alt+Space/WM_SYSCHAR의 송신·focus·동기 전달 경계다. 상세와 이전 해석 정정은 위 조사 보고서 마지막 절을 따른다. N/F/M 상태는 변하지 않았다.

후속 문맥/개입 실험: Alt+Space는 다른 thread가 기다리는 send_flags1, 제목 표시줄은0이며 두 조건 모두 소유 WebView 창에 포커스가 있었다. 동기 Alt+Space만 큐로 넘기면 응답은 유지됐지만 실제 메뉴 루프/정상 종료 실패는 남았다. 회복 검사는 변경 전후 모두 실패했으므로 제품 수정안으로 채택하지 않는다. 사용량 중단 실행은 제외하고 명시적 재개 후 미완료 검증을 완료했다. 다음 조사 범위는 Escape/키 해제/메뉴 취소 전달이다. 제품 변경 없음, N/F/M 및 출시 차단 유지.

최신 정정 — Escape 2회 비교: 기존 원본/큐 전달 바이너리를 각각 한 번 실행했다. 두 조건 모두 첫 Escape 후 팝업만 사라지고 두 번째 Escape에서 WM_EXITMENULOOP가 발생했다. 원본도 그 뒤 11ms에 Rust tick 수신을 재개하고 정상 종료했다. 따라서 앞선 1회 Escape 종료 실패를 영구 교착으로 해석하지 않는다. 메뉴 루프 동안 원본 tick/ack는 0/0, 큐 전달은 25/13이었다. 두 조건의 실제 메뉴 종료·양방향 응답·정상 종료 검사는 통과했고 소유 잔류는 0이다. 이는 최소 앱의 단기 진단이며 제품 watchdog 문제나 N 통과를 뜻하지 않는다. 다음 검증은 실제 메뉴 종료를 기준으로 관측하는 시험 절차와 메뉴 유지 중 heartbeat 정지를 분리하여, 승인된 제품 후보에서 확인하는 것이다.

## 범위

2026-10-23 큐 전달 후보 검증: `phase5-product-defer-20261023`의 제품 계측 복사본에서 Alt+Space74.292초/pong15, 제목 표시줄60.521초/pong12로 기존 red→동일 검사 green을 확인했다. 양쪽 동일 연결/online·실제 메뉴 종료·정상 exit/EOF/audit·소유 잔류0. 후보는 Tao 한 파일뿐이며 제품 저장소에는 미반영이다. 송신자 대기와 이벤트 처리 시점이 함께 달라지므로 단일 근본 원인으로 단정하지 않는다. 다음은 제품 적용 위치/의존성 유지 방식과 입력·종료 경합 회귀 범위를 정해 구현으로 옮기는 단계다. 정식 N/F/M 및 Phase5 차단 유지.

2026-10-23 제품 경계 추가 검증: 제품 기능 보존 계측 앱에서 Alt+Space 메뉴27.395초 동안 pong0, 마지막 응답 후30.054초에 FrontendLost, 실제 메뉴 종료 후21표본 offline을 확인했다. 앱 자체는 정상 종료했다. 같은 바이너리의 제목 표시줄 메뉴62.594초는 pong13/online 유지·정상 종료였다. 별도 짧은 대조는 사용량 중단으로 정상 종료 판정에서 제외했다. 세 실행 소유 잔류0. 다음은 동기 Alt+Space 큐 전달을 제품 계측 복사본에 한정한 장시간 메뉴/종료 회귀 검증이다. 제한 전 제품 Alt+Space 복귀와 N/F/M 본시험은 여전히 미검증이다.

| Scope | 정식 실행 | 사전 검사 | 통과의 의미 |
|---|---|---|---|
| M | 7,200초, 고정 첫 탭, Playwright 분리 | 180초/3회 audit | 고정 UI의 부하·자연 메모리 및 과부하·종료 |
| F | Playwright 연결, 전환 120회 | 17회(첫 세션 재방문) | 프런트엔드 resize·회수·다른 owner 전달 기능 |
| N | 복원/최대화 각각 독립 실행, 새 세션 1개씩 | 없음 | 현재 Windows 환경에서 실제 입력 경로 |

F는 분당 실행 속도나 2시간 지속성을 입증하지 않는다. N은 장기 안정성이나 모든 DPI/IME 환경을 입증하지 않는다. 세 결과 모두 `phase5Acceptance:false`, `combinedTransitionMemory:unverified`다.

2026-10-19 승인에 따라 F/N은 `publicBoundaryCompleteness:unverified`도 명시한다. 각 공개 stream 내부의 연속성을 확인하지만 회수로 폐기된 마지막 꼬리의 완전성은 주장하지 않는다. M은 전환을 하지 않아 이 필드가 `not_exercised`다.

## 고정 입력과 실행

PowerShell에서 작업 디렉터리를 `C:\Users\sj\Documents\work\code\baton\.worktrees\rust-phase-0`로 설정한다. Node 실행은 `C:\Program Files\nodejs\node.exe`를 사용한다. `pwsh`가 PATH에 있다고 가정하지 않는다.

새 실행기: `rust/tests/phase5/separated/launch.mjs <fresh-directory> <config.json> M|F|N preflight|full`. 같은 출력 경로·log·launch 파일이 있으면 거부한다. 실패 디렉터리는 보존하며 이름을 바꾸어 자동 재실행하지 않는다.

설정 예시(실제 파일은 artifacts 아래 생성):

```json
{
  "app": {
    "path": "artifacts/phase5-ui-stability-20261016/baton.exe",
    "sha256": "1ae03f6b7fc0d3d17eb5571c81ba0c11d73ad9cfc39e37c2c520a9393aa0df0e"
  },
  "adapter": {
    "path": "artifacts/phase5-harness-fixes-probe3-20261013/candidate/baton-adapter.exe",
    "sha256": "09823dd5d51cd3b33f286540fe43a03570b3eee81497607a1b5b67336fcb754c"
  },
  "imageId": "sha256:7270e924b7597cbece5eb6886a47c3383502f31d8a253763774f3b8c6b4f810a",
  "pwsh": "C:/Users/sj/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe",
  "playwrightPath": "C:/Users/sj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
  "preflightEvidence": {
    "M": "artifacts/phase5-separated-20261019-r2/m-preflight",
    "F": "artifacts/phase5-separated-20261019-r2/f-preflight"
  }
}
```

F 및 정식 M 비교 실행의 설정에는 `baselineEvidence`로 완료·검증된 M 사전 검사 디렉터리를 지정한다. 해당 실행과 source manifest, 바이너리, image, OS/Node/WebView/Playwright가 달라지면 측정 전 거부한다. config 자체의 증거 경로 차이를 제품 변경으로 취급하지 않는다. fixture는 localhost에만 노출한다. 사용자 서버·자격 증명은 사용하지 않는다.

N v2 설정은 `baselineEvidence`를 생략하고 위 `preflightEvidence`의 M/F를 모두 지정한다. 기존 원시 증거와 `verified.json`의 summary 해시를 읽기 전용으로 확인하고, `native.mjs`/`verify.mjs` 두 파일만 변경 전후 해시를 공개하여 허용한다. 그 외 공통 소스·바이너리·image·환경은 일치해야 한다. 동일 하네스 소스라고 주장하지 않는다. 준비된 설정은 `artifacts/phase5-separated-20261020-native-v2/config-n.json`이며 실제 실행 이력이 아니다. 정식 M/F는 이 예외를 적용하지 않으므로 실행할 소스와 사전 증거의 동일성을 별도로 결정해야 한다.

```powershell
node rust/tests/phase5/separated/launch.mjs artifacts/phase5-separated-20261018/m-preflight artifacts/phase5-separated-20261018/config-m.json M preflight
```

M 종료·정리·독립 검증 후 같은 방법으로 `f-preflight config-f.json F preflight`, 그 다음 `n-cases config-n.json N full`을 각각 실행한다. 한 실행이 끝나기 전 다음 실행을 시작하지 않는다. 정식 `F full`과 `M full`은 사전 검사 결과 보고 후 별도 실행 결정이 필요하다. 이 문서의 명령은 실행 이력이 아니다.

## 관련 단위 검사

```powershell
node --test rust/tests/phase5/separated/*.test.mjs rust/tests/phase5/native-soak-control.test.mjs rust/tests/phase5/native-soak-verify.test.mjs rust/tests/phase5/soak-oracle.test.mjs
```

Node가 wildcard를 처리하지 못하는 환경에서는 separated 아래 `contract.test.mjs`, `runtime.test.mjs`, `memory.test.mjs`, `transitions.test.mjs`, `native.test.mjs`, `verify.test.mjs`를 나열한다. 미완성 fuzz가 포함되는 상위 glob이나 Cargo 빌드는 실행하지 않는다. 단위 테스트의 가짜 7,200초 증거는 실제 장시간 부하 결과가 아니다.

## N 네이티브 소비자

### 2026-10-21 승인 변경: 사례별 완료 보존

설정의 `nativeCase`를 `restored` 또는 `maximized`로 지정하면 해당 사례만 실행한다. 각각 새로운 32연결/16세션/2서버를 준비하고 세션 index 0에서 지정 창 모드의 resize·회수·다른 연결 재전달을 수행한다. 서로 독립 실행이므로 실제 세션/owner는 새로 생성된다. 각 사례는 16세션 audit 1회, health, 출력, 정상 종료, 32 adapter EOF, 소유 자원 정리까지 마친다. 전체 준비 포함 900초와 입력 120초/검증 45초 제한은 유지한다.

각 디렉터리에 기존 `verify.mjs <case-directory>`를 실행하면 원시 증거와 현재 소스/후보를 검증한다. 통과는 `casePassed:true, scopePassed:false`로 저장된다. 완료한 사례는 재실행하지 않고 그대로 둔다. 두 사례가 각각 완료된 뒤 아래 명령으로 원시 증거를 다시 읽어 합산한다.

```powershell
node rust/tests/phase5/separated/verify.mjs --native-cases artifacts/<batch>/n-aggregate.json artifacts/<batch>/n-restored artifacts/<batch>/n-maximized
```

합산은 서로 다른 owner와 정확히 한 건씩의 복원/최대화, 각 `verified.json`의 summary hash, 현재 소스/바이너리 및 M/F 사전 증거를 확인한다. 두 사례의 전체 소스·후보·image·환경·baseline이 일치해야 한다. 결과 파일은 덮어쓰지 않는다. 합산 통과는 `execution:independent_cases`로 명시하며 연속 실행이나 장기 안정성 통과가 아니다. Phase 5 출시 차단과 두 미검증 항목은 유지한다.

`nativeCase` 없는 과거 실행은 기존 두 사례 방식으로 계속 검증한다. 과거 실패/부분 기록을 새 단일 사례로 재표기하지 않는다. 아래 세션 0/1 설명은 이 과거 방식에 해당한다. 변경은 N driver와 verifier에만 한정했으며 공통 runtime/launcher/M/F 코드는 그대로다. 기존 M/F와의 소스 차이 허용 범위도 N driver/verifier 두 파일로 유지한다.

computer-use skill의 관측 → 단일 조작 → 새 관측 절차를 따른다. 직접 Win32/PowerShell UIA helper 또는 관측 없는 클릭 루프를 사용하지 않는다. 로그인은 setup 단계에서 fixture 전용 Playwright로 끝나 있으므로 네이티브 조작은 준비된 세션의 창/탭/소유권만 다룬다.

1. `node rust/tests/phase5/separated/native-ui.mjs peek <evidence-dir>`로 요청과 전체 세션/목표 연결 ID를 읽는다.
2. 대상 창을 새로 관측하고 본문 캡처의 크기·내용으로 screenshotId를 고른다. 첫 배열 원소가 본문이라고 가정하지 않는다. 복원/최대화 완료 후 다시 관측한다.
3. 조작 준비가 끝나면 `... native-ui.mjs start <evidence-dir> <request-id>`를 호출한다. `inputAllowed:true`와 해당 요청의 active 정보가 확인돼야 입력한다. 대기 중이면 peek로 확인하며 start나 UI 입력을 중복 실행하지 않는다.
4. 새 관측으로 지정된 입력을 한 번 실행한다. 최대화 상태에서 이미 빗나간 접근성 요소 클릭 방식 대신 본문 캡처 좌표를 사용한다. 연결 선택은 아래 키보드 절차를 따른다. WebView popup 항목에 대한 좌표/접근성 클릭과 select `set_value`를 재시도 경로로 사용하지 않는다.
5. 즉시 새 화면을 관측하고 `done`에 JSON observation을 전달한다. `screenshotId`는 모든 응답에 필수다. select에는 `selectedSession`, window_mode/resize에는 `windowMode`, choose_connection에는 `targetConnection`도 필요하다. 예: `{"screenshotId":"실제 캡처 ID","selectedSession":"전체 세션 ID"}`. 실패는 `failed`로 보고한다.
6. receipt 저장 실패 시 UI를 다시 누르지 않는다. pending/active와 실제 화면·MCP 상태를 먼저 확인한다. `acceptances/<request-id>.json`과 `native_received`는 runner의 실제 접수를 기록하며 `responseReceivedAt`과 `verifyDeadline`을 담는다. `results`가 생성되어야 해당 상태 검증이 완료된 것이다. 완료 판정은 runner의 MCP·서버 stty·epoch/stream/이전 owner 검증이 수행한다.

N v2의 전체 900초에는 준비가 포함된다. start 승인부터 조작·화면 관측·완료 기록 접수까지 120초, runner의 완료 접수부터 상태 검증까지 별도 45초다. 두 기한 모두 전체 900초에 잘린다. polling·중복 응답으로 시계를 다시 시작하지 않는다. 실제 제품 반응 시간은 `not_measured`다. 세션 0은 복원 창 resize, 세션 1은 복원 상태에서 선택 후 최대화 resize를 사용한다. 전달할 연결 선택과 전달 버튼은 별도 요청이므로 하나의 입력 시간에 목록 탐색 전체를 몰아넣지 않는다. 기존 N v1은 원래 45초 기준으로 유지한다.

### 연결 선택의 키보드 절차

2026-10-16의 같은 후보 앱에서 열린 목록의 End→Enter 선택과 실제 전달을 확인했다. 이는 현재 임의 중간 항목까지 검증됐다는 의미가 아니다. 원래 실패한 popup 클릭은 반복하지 않으며 실제 조작은 computer-use API의 관측→한 키→새 관측으로 진행한다.

1. `choose_connection` 요청의 전체 `targetConnection`을 읽고 start 승인을 확인한다. 새 본문 관측에서 활성화된 **선택 상자 자체**를 눌러 목록을 연다. 이는 popup 항목 클릭과 구별한다.
2. 열린 목록의 접근성 항목 description에서 전체 ID와 화면의 순서를 확인한다. placeholder 포함 여부와 현재 강조 항목을 확인하며 adapter 번호나 과거 실행의 목록 순서로 키 횟수를 계산하지 않는다. 전체 목표 ID가 유일하게 식별되지 않으면 중단한다.
3. 관측한 목록의 가까운 끝으로 Home 또는 End 한 번을 보내고 다시 관측한다. 목표까지 Up/Down 한 번씩 이동하며 매번 강조 항목·목록 열림 상태를 확인한다. `press_key`는 선택된 Baton 창을 대상으로 하며 OS 단축키나 popup 좌표 조작으로 대체하지 않는다. 닫힌 select에서 여러 방향키를 이어 보내지 않는다.
4. 목표 항목이 강조된 관측을 전체 ID와 대조한 뒤 Return으로 확정하고 새 화면에서 선택값을 확인한다. 축약 ID는 앞서 관측한 전체 ID와 유일하게 대응해야 한다. 동일 접두어가 여럿이거나 선택 결과를 구별할 수 없으면 `done`을 게시하지 않는다.
5. 확인 후 `choose_connection` receipt를 기록한다. 이 receipt는 UI 관측이며 전달 성공 판정이 아니다. 별도 `handoff` 요청 이후 전달 버튼을 누르고, runner가 정확한 새 owner/epoch/stream 및 이전 owner 해제를 검증해야 한다.

목록이 예상 밖으로 닫히거나 포커스가 사라지거나 도구 오류가 발생하면 추가 키를 보내지 않고 새 관측으로 실패 여부를 판단한다. 타임아웃을 늘리거나 선택된 것으로 추정해 전달하지 않는다. 선택 변경의 `onchange`는 제어 패널을 다시 렌더하므로 확정 뒤에는 이전 요소 인덱스를 버린다. 관련 없는 출력 알림만으로 DOM을 교체하지 않는 기존 수정은 유지되어 있다.

## 관측·중단·검증

진행은 summary의 `status`, `elapsedSeconds`와 원시 로그 갱신으로 확인한다. `finishedUtc` 전에는 코드/진단 소스 변경, CDP 재접속, JS/GC 조회, 추가 실행을 하지 않는다. 상태가 계속 갱신되면 반복 알림을 보내지 않는다.

중단이 필요하면 이번 증거 디렉터리 안에 `stop` 파일을 만든다. 이는 workload를 중단하며 정상 종료·소유 자원 정리를 계속 시도한다. PID만 보고 임의 프로세스를 종료하지 않는다. 소유 PID+시작 시각, 컨테이너 label `baton.soak`+이름/ID를 대조한다. 이미지 태그는 비교 묶음 동안 보존한다.

종료 후 실행:

```powershell
node rust/tests/phase5/separated/verify.mjs artifacts/phase5-separated-20261018/m-preflight
```

검증 결과는 `verification.json`; 독립 검증이 통과한 경우만 `verified.json`을 만든다. 이미 성공 파일이 있는 디렉터리에 재검증 CLI를 실행해 성공 파일을 교체하지 않는다. 기존 결과를 읽고, 추가 분석은 별도 파일로 기록한다. raw JSONL의 잘린 마지막 줄·누락·불일치는 실패이며 무시하지 않는다.

증거 파일: events/output/memory JSONL, audit-observations, normal-boundary, process, final-cleanup, summary JSON. M은 첫 20분 제외 후 다섯 20분 중앙값과 마지막/첫 private·working 비율을 보고한다. 메모리 기준 초과와 부하 자체 무효를 구분하며 유효 부하의 메모리 초과만으로 과부하 대조를 생략하지 않는다. F/N 결과를 M 자연 메모리 표본과 합치지 않는다.

## 기록

2026-10-18: 신규 시험 코드와 기존 관련 검사 100개 통과, 신규 `.mjs` 문법 검사 통과. 독립 검토 진행 중. 후보 image ID 일치와 해당 image의 컨테이너 없음 확인. 실제 사전 검사/장시간 실행 결과는 아직 없다.

### 2026-10-19 독립 검토 후 수정

검토 범위 `290bac8..4fcb095`에서 6건을 발견했다. 현재 수정은 새 시험 코드에만 적용했으며 제품·기존 실행기·fuzz·Cargo를 변경하거나 실행하지 않았다.

| 항목 | 조치와 증거 | 상태 |
|---|---|---|
| 회수 요청부터 공개 출력/시간을 제외 | backlog를 빈 read까지 drain하고 reclaiming 동안 공개 소비를 계속한다. private 시간은 reclaimed 이후만 계산한다. | 부분 수정, 아래 한계 미해결 |
| F/N 전환 증거 연결 누락 | 회차별 geometry/status 순서, binding, 새 stream 출력, health, 최종 binding을 대조한다. | 회귀 검사 통과 |
| N 중복/불일치 receipt | 고유 ID·조작 순서·요청/start/response/result 파일·회차 관측·준비 포함 watchdog을 대조한다. | 회귀 검사 통과 |
| 과부하 성공 필드 신뢰 | 정상 대조 명령·cursor·1,310,720개 Z·완료 표식, ACK 차단 단계 뒤 victim 및 다른 15세션 상태를 대조한다. | 회귀 검사 통과 |
| 메모리 PID와 소유 증거 미연결 | 매 표본의 소유 receipt/adapter/전체 descendant 집합과 최종 종료 receipt를 대조한다. | 회귀 검사 통과 |
| deadline 이후 성공 허용 | service/check 완료 뒤에도 단조 시각을 검사한다. | 회귀 검사 통과 |

수정 전 실패 재현과 수정 후 통과 기록은 `artifacts/separated-review-*-red.log`, 최종 관련 suite는 `artifacts/separated-review-suite.log`(111/111)다. 단위 fixture의 성공은 실제 F/N 실행 증거가 아니다.

남은 경계 문제: `rust/crates/baton-core/src/session.rs`의 `reclaim()`은 stream을 비우고 `begin_transition()`은 공개 버퍼를 즉시 폐기한다. 기존 외부 API에서 이전 공개 stream의 최종 cursor를 조회할 수 없다. 따라서 마지막 read와 실제 회수 사이에 생성된 꼬리의 누락 여부를 현재 시험만으로 확정할 수 없다. 계속 읽다가 회수와 경합하면 오류로 실패하므로, 보강만으로 원래 경계 완전성 요구가 충족됐다고 주장하지 않는다. **현재 판정기의 F/N 통과 이름을 이 미해결 요구의 통과로 사용하지 않는다. 사전 시험은 보류한다.**

사용자 결정 대기: (1) F/N을 각 공개 stream 내부 연속성 및 소유권/geometry 기능으로 한정하고 회수 경계 완전성을 별도 미검증 항목으로 고정하거나, (2) 제품에 최종 cursor를 남기는 관측 기능부터 별도 설계한다. 어느 경우든 원래 결합 전환·자연 메모리와 Phase 5 출시 차단은 해제하지 않는다.

후속 결정: 사용자가 2026-10-19에 (1)을 승인했다. 위 보류는 이 범위 변경으로 해소했다. 예상된 stale read는 실제 reclaiming/user_owned 상태·증가한 epoch·null stream이 함께 확인될 때만 원시 경계 사건으로 보관한다. 앱 offline/통신 오류나 내부 sequence gap은 계속 실패한다. 최종 관련 검사 114/114 (`artifacts/separated-scope-suite.log`). 실제 Linux fixture에서 sleep을 대체한 90 tick/102 record 점검을 setup 중 수행하며, 이는 실제 1초 간격의 증거는 아니다.

검토에서 실행하지 않은 항목: 실제 Docker/Windows 정리, 실제 네이티브 화면/좌표/DPI는 사전 시험/N에서 확인할 예정이다. N의 OS 표본 최대 45초 공백 검사는 짧은 관측 유효성 조건으로 유지하며 장기 메모리 통과를 뜻하지 않는다. 이전 Phase와 제품/fuzz는 이번 검토 밖이다.

### 2026-10-19 M 사전 시험 1회 — 준비 실패

- 증거: `artifacts/phase5-separated-20261018/m-preflight/`, sibling `m-preflight.log`, `m-preflight.launch.json`. 고정 커밋 `96853f08fb5538d7c14c5afe3752f2e615e3256a`.
- 시작/종료: `2026-10-18T22:52:46.235Z` / `2026-10-18T22:53:08.079Z`. 실행기 PID 21536, 시작 ticks `639279607661805322`; owner `e26d2593-ea23-4746-80bd-ff8757847d69`.
- 180초 정상 부하는 **시작하지 못했다**. sessions/connections 0, OS 표본/audit 없음. 실행기 오류는 `webview_ready_timeout`이며 `process.log`의 직접 원인은 앱 setup의 `ipc_directory_unavailable` panic, exit 101이다. 메모리 기준 실패나 제품 전환 실패로 분류하지 않는다.
- 실제 Linux fixture의 발생기 점검: 90 tick, burst tick `[30,60,90]`, 누적 `[34,68,102]`, 총 102 record. 원시 파일 `generator-ticks.txt`.
- 원인: 새 실행기가 격리 `LOCALAPPDATA=<out>/local` 부모 폴더를 만들지 않았다. `Test-Path`는 false였고, 앱의 `prepare_endpoint_dir()`는 기존 부모 아래 `BatonRust/v2`만 만든다. 기존 native-soak에는 부모 mkdir이 있었다.
- 종료 판정: 정상 종료 실패, `forcedCleanup:true`; adapter 정리를 포함해 최종 소유 process/container 0. 앱은 먼저 비정상 종료했으므로 WebView descendant audit는 unverified다. 자원 정리 성공을 정상 종료 통과로 바꾸지 않는다.
- `post-failure-check.json`: 수정 전 소스 23개/바이너리 2개 해시 모두 일치. 실제 owner label 컨테이너 0, 해당 후보 실행 경로의 프로세스 0을 별도로 확인했다. 이미지 태그는 후속 비교를 위해 보존한다.
- 독립 판정 `verification.json`: 필수 `audit-observations.json`이 없어 `evidenceValid:false`, `preflightPassed:false`. `verified.json`을 만들지 않았다. 준비 실패 때문에 이후 부하 조건도 검증하지 못했다.

후속 수정: 새 runtime에 부모 디렉터리 생성만 추가했다. 보안 DACL이 필요한 `BatonRust/v2` 자식은 계속 앱이 생성한다. 누락 회귀 테스트 RED→GREEN, 관련 suite **115/115** (`artifacts/separated-local-root-suite.log`). 제품·기존 실행기·fuzz·Cargo는 변경하지 않았다. 실패 당시 해시 대조는 수정 전 `post-failure-check.json`으로 보존하며, 현재 소스는 수정 때문에 해당 실패 실행과 다르다.

자동 재실행하지 않았다. F 사전 시험과 N은 시작하지 않았다. 재실행 결정 시 새 증거 경로를 사용하고 F/N 및 정식 비교 설정의 baseline/preflight 경로도 새 성공 증거에 맞춰야 한다. 이번 실패 디렉터리를 덮어쓰지 않는다.

### 2026-10-19 수정 후 M 통과 / F 증거 실패

사용자 재실행 승인 후 커밋 `198caca41e77c184e7e90d25d5a8f816f86d1449`로 새 증거 루트 `artifacts/phase5-separated-20261019`를 사용했다. 먼저 M을 검증하고 통과 뒤 F만 실행했으며, 두 실행의 23 source/2 binary/image/OS/Node/WebView/Playwright 신원은 일치했다. Windows `10.0.26200`, Node `v22.17.0`, WebView `155.0.4283.62`, Playwright `1.62.1`.

| 관측 | M preflight | F preflight |
|---|---|---|
| 증거 디렉터리 | `m-preflight` | `f-preflight` |
| owner | `50279b02-2551-40d8-9004-7e2d73498f70` | `346d84f2-cadb-41c2-9e0b-6fb84b93ac3a` |
| 전체 시작/종료 UTC | 2026-10-18 23:00:36.314 / 23:04:05.656 | 2026-10-18 23:04:34.009 / 23:05:32.554 |
| 측정 경과 | 180.0363초 | 34.3978초 |
| 연결/세션/서버 | 32/16/2 | 32/16/2 |
| audit 효과 | 3회 ×16 = 48 | 17회 ×16 = 272 |
| 세션별 출력률 | 1161.43~1168.26 B/s | 1140.80~1202.45 B/s |
| 정상 종료/EOF | exit 0, 32개 | exit 0, 32개 |
| 강제 정리/잔류 | false, process/container 0 | false, process/container 0 |
| 독립 판정 | `preflightPassed:true` | `evidenceValid:false`, `new_stream_output_missing` |

M의 OS 표본은 5.6874/33.7285/63.7884/93.8500/123.6871/153.7037초에 수집됐고 established debugger 연결은 모두 0이었다. 32KiB×40 정상 소비 대조, ACK 차단 후 victim closed와 다른 15세션 agent_owned, 원시 audit/출력/종료/정리를 확인했다. `verified.json` 생성, `scopePassed:false`, `phase5Acceptance:false` 유지. 2시간 자연 메모리 통과 증거가 아니다.

F는 17번째 전환(session 0의 재방문, adapter 16→0, epoch 3→5) 후 새 stream으로 17번 읽었지만 구조화 SOAK record는 아직 없었다. binding 이벤트 t=51466.1763ms, 측정 종료 t=51730.8062ms로 간격은 약 264.63ms다. 발생기는 1초 주기이며 측정이 첫 새 record를 기다리지 않고 끝났다. 단순 cursor 이동/빈 read를 출력 관측 성공으로 취급하지 않은 독립 판정이 이를 거부했다. runner의 `status:finished`/17회 완료는 workload 조정기 종료를 뜻하며 인수 통과로 해석하지 않는다. F에 `verified.json`은 없다.

양쪽 실제 owner label 컨테이너와 후보 executable 프로세스가 0임을 종료 뒤 교차 확인했다(`post-exit-check.json`). F 파일에는 수정 전 source 23개/binary 2개 해시 일치도 보존했다. M의 성공 파일과 F의 실패 파일은 수정하거나 다시 판정하지 않는다.

후속 수정: `adoptBinding()`이 새 stream oracle의 첫 완전한 record를 관측할 때까지 기존 45초 wait/service 경로로 대기한다. 다른 세션 소비/stop 처리는 유지한다. 빈 read 뒤 다음 read에서 첫 record가 오는 회귀 검사 RED→GREEN, 전체 관련 unit **116/116** (`artifacts/separated-first-output-suite.log`). 이 수정은 F/N 공통 전환 경로이며 제품·기존 실행기·판정 기준을 완화하지 않는다. 소스 해시가 바뀌었으므로 이번 M/F와 새 수정본을 동일 소스 묶음으로 합산하지 않는다. 실제 재실행/N 및 정식 F/M은 시작하지 않았다.

### 2026-10-19 R2 — M/F 사전 검사 통과, N 입력 기한 초과

사용자 재실행 승인 후 고정 커밋 `6089e6bd72254bc4b7cf2b9077c001bae05f5b37`과 증거 루트 `artifacts/phase5-separated-20261019-r2`를 사용했다. M 독립 검증 → F 독립 검증 → N 순서로 실행했다. 제품/진단 소스를 변경하거나 이미 통과한 판정을 다시 실행하지 않았다.

| 관측 | M preflight | F preflight | N full 시도 |
|---|---|---|---|
| 증거 디렉터리 | `m-preflight` | `f-preflight` | `n-cases` |
| owner | `3896488b-1937-482f-90db-ce59c71f8f1d` | `00e46691-6f75-4374-8511-5792ada7e732` | `80ef5ae7-320c-4402-b1c8-b903b833ab9d` |
| 시작 UTC | 07:03:41.239 | 07:07:43.593 | 07:09:27.166 |
| 종료 UTC | 07:07:14.682 | 07:08:48.560 | 07:12:35.354 |
| 측정 경과 | 180.0968초 | 40.2712초 | 151.1045초 후 중단 |
| 연결/세션/서버 | 32/16/2 | 32/16/2 | 32/16/2 준비 |
| 완료 audit 효과 | 48 | 272 | 없음, 첫 사례 미완료 |
| 독립 재구성 출력률 | 1161.04~1167.87 B/s | 1134.46~1153.91 B/s | 판정하지 않음 |
| 정상 종료 / 강제 정리 | true / false | true / false | false / true |
| 최종 소유 process/container | 0/0 | 0/0 | 0/0 |
| 독립 결과 | `preflightPassed:true` | `preflightPassed:true` | `evidenceValid:false` |

M의 자연 OS 표본은 6개이며 debugger established 연결은 모두 0이다. 정상 소비 1,310,720 bytes 대조와 ACK 차단 victim closed/다른 15세션 유지, 정상 종료 및 어댑터 EOF 32를 독립 검증했다. F는 17회 전환과 각 새 공개 stream의 첫 완전한 record까지 검증했다. M/F 모두 `scopePassed:false`, `phase5Acceptance:false`; 180초 M은 2시간 메모리 통과가 아니며 17회 F는 120회 정식 결과가 아니다.

N은 첫 사례의 복원 창 관측과 soak-00 선택까지 두 receipt를 완료했다. 선택된 전체 session ID는 `0743b9e1b59462fd373a9c0e13773da5`, MCP geometry는 102×17이었다. 세 번째 resize 요청 `4255e7a1-67a6-4c2e-8b08-22e940df98c5`의 입력 시작은 t=123201.0845ms, deadline은 t=168201.0845ms였다. 두 native drag 뒤 창은 관측상 1183×851 그대로였고, 두 번째 시도에서는 본문 텍스트가 선택됐다. 이후 Alt+Space로 시스템 메뉴를 열었지만 크기 변경 완료 receipt를 발행하지 못한 상태에서 `input_expired`로 중단됐다. **완료 사례는 0/2이며 두 receipt를 두 사례 통과로 세지 않는다.**

이 45초는 computer-use 도구 왕복·관측·판단을 포함한다. 원시 request/start/result와 실제 관측은 입력 경로가 완료되지 않았음을 보여 주며, 제품의 resize 처리 지연이나 geometry 불일치 자체를 입증하지 않는다. 실패 시 시스템 메뉴가 열린 상태였고 shutdown의 15초 `normal_exit` 대기도 만료됐다. 메뉴와 종료 실패의 인과관계는 아직 검증하지 않았으므로 추측으로 남긴다. 정상 종료/어댑터 EOF 32/자손 정상 종료 감사를 통과로 주장하지 않는다. 강제 정리 뒤 잔류 자원 없음만 별도로 확인했다.

N 독립 verifier는 필수 `audit-observations.json` 부재로 `evidenceValid:false`를 저장했고 `verified.json`을 만들지 않았다. runner의 첫 원인은 `input_expired`; audit 부재는 첫 사례 완료 전에 중단된 결과다. `post-exit-check.json`에서 owner 컨테이너와 후보 앱/어댑터 및 이번 WebView 경로의 프로세스가 없음을 재확인했다.

`r2-evidence-crosscheck.json`은 세 실행 간 source 23개/binary 2개/image/환경 일치, 현재 파일 해시 일치, M/F 성공 파일의 summary SHA 일치와 실제 audit 48/272를 확인한다. M summary SHA는 `221e8f1b4e3b0d0aaef360ab6227bc6b5d4b775fbbe0f2a762cfc3ca1f7c0354`, F는 `396e82e3437ee5e7ba10be5a8de0e2b0c136ae1819e072464226ae20566dcd75`, N은 `003355f05a71892fc9073860d73d372fb7fd2dddbd69f319dd7fe410fcbbedbb`다. Windows/Node/WebView/Playwright와 image는 앞서 고정한 값과 같다.

후속 재시도 준비는 소스/45초 기준을 그대로 두고 시스템 메뉴의 키보드 크기 조정을 사용하는 것이다. 사용자 “진행하자”를 근거로 `n-cases-retry1` 실행을 요청했으나 자동 승인 검토가 실패 후 재시도에 대한 명시 승인 불충분으로 거부했다. **실행되지 않았으며 해당 출력 디렉터리/launch 파일도 없다.** 우회 실행하지 않았다. 구체적 N 재시도 승인 확인이 필요하다. M/F 사전 검사는 반복할 필요가 없고, 정식 F 120회/M 7200초는 아직 별도 결정 대상이다. 회수 경계 완전성·결합 전환 메모리 미검증과 Phase 5 출시 차단은 유지한다. 이미지 태그는 후속 비교를 위해 보존한다.

### 2026-10-19 N 명시 승인 재시도 — 완료 기록이 기한 이후 도착

위 거부 이후 사용자가 N만 1회 재시도하는 요청에 명시적으로 `승인`했다. `n-cases-retry1`을 한 번 실행했다. 이전의 경로 부재/미실행 기록은 거부 시점의 상태이며, 이번 결과가 최신 상태다. 실행 커밋 `8b1c5ca`는 직전 `6089e6b`에 결과 문서만 추가한 커밋이다. 시험 source 23개/binary 2개/image/환경은 R2 M/F와 동일하고 실행 후 현재 해시도 일치했다(`failure-analysis.json`). 통과한 M/F를 반복하거나 제품·시험 소스를 수정하지 않았다.

- owner: `11d7adbe-bd9e-4160-8b9b-8574a9e1cd3b`; launcher PID 39200. 전체 UTC `09:55:29.920`→`09:57:54.454`; 측정 구간 `09:55:48.293`→`09:57:49.926`, 121.6331초. 32연결/16세션/2서버 준비, OS 표본 4개. 사례 완료는 **0/2**.
- 복원 창 관측과 soak-00 선택의 receipt 두 개를 완료했다. 세션 `31964461b8fabfc010a2fc12d7c5ecee`, 선택 시 MCP geometry 102×17.
- resize 요청 `9153dfe0-b314-4fc9-a378-010e6a6d352e`: 입력 시작 t=95017.3168ms, deadline t=140017.3168ms. 실제 UI에서 Alt+Space → 크기 조정(S) → Right → Left → Return을 각각 새 관측 사이에 수행했다. 화면 너비는 **1183→1172**, 높이는 851 유지였으며 Return으로 조정을 확정했다. 실제 창 resize 자체는 관측했지만 서버 stty와의 일치까지 검증한 것은 아니다.
- 완료 response 파일의 UTC mtime은 `09:57:53.910`으로 측정 중단 `09:57:49.926`보다 약 **3.984초 늦다**. 파일 시각은 보조 상관관계 증거이며 단조 deadline을 대체하지 않는다. 원시 events에서 선택 완료 이후 freeze 이전 MCP status 호출은 0개다. `runNative()`는 완료 receipt를 받은 뒤에만 resize geometry 확인을 호출하므로 이번에는 그 검증 단계에 진입하지 못했다. 실행기 오류는 `input_expired`다.
- 따라서 이번 실패는 computer-use 조작·매 단계 화면 확인·완료 기록을 포함한 **전체 입력 절차가 45초를 넘긴 것**이다. Baton의 resize 응답 지연이나 서버 geometry 불일치로 분류하지 않는다. 늦게 저장된 `performed` response를 성공으로 간주하지 않으며 해당 resize result도 없다.
- 이번에는 정상 종료 exit 0, 어댑터 EOF **32/32**, 자손 종료 감사 `verified`, 강제 정리 없음, 잔류 process/container **0/0**을 원시 shutdown 사건과 `post-exit-check.json`으로 확인했다. 이전 시도의 정상 종료 실패도 보존하며, 메뉴 종료만이 차이를 만들었다는 인과관계까지 단정하지 않는다.
- 독립 verifier는 첫 사례 중단으로 `audit-observations.json`이 없어 `evidenceValid:false`를 기록했다. `verified.json` 없음. summary SHA `666d1d5df811dd1c1872fc4493b9c2b0aaeb3c41cd78aeb6b0b07d76b20e58b0`.

승인된 재시도 1회를 소진했고 추가 실행하지 않았다. 다음 검토 대상은 N의 시간 측정 구간이다. 현재 45초는 제품 응답뿐 아니라 모델 판단과 도구 왕복/receipt 저장도 포함한다. 조작 수행 예산과 제품 상태 확인 기한을 분리하는 방안은 **제안일 뿐 승인·구현되지 않았으며**, 현재 기준과 실패 판정은 유지한다. N 재시도나 정식 F/M을 자동 시작하지 않는다. Phase 5 출시 차단과 회수 경계/결합 전환 메모리 미검증도 유지한다.

### 2026-10-20 N v2 시간 분리 — 구현 및 검토 완료, 실제 재시험 전

위 제안을 사용자가 승인해 조작·화면 관측·완료 접수 120초와 접수 후 상태 검증 45초로 분리했다. 준비 포함 전체 900초 상한은 유지한다. 시작/접수 시각은 runner의 단조 시계를 사용하고 재접수·polling으로 연장하지 않는다. 실제 제품 반응 시간은 `not_measured`로 기록한다. 기존 N v1 실패 두 건을 새 기준으로 소급 통과시키지 않는다.

독립 코드 검토에서 선택·resize의 합성 관측 시각만 검사하고 원시 MCP 상태의 접수 후 순서를 강제하지 않는 P2 결함을 확인했다. 잘못된 원시 증거가 실제 통과하는 세 회귀 사례를 먼저 재현하고, 접수 사건 이후~검증 종료 시각 안의 동일 세션/adapter/epoch/stream/geometry만 인정하도록 수정했다. 선택의 750ms 안정 구간도 그 안에 있어야 한다.

- 관련 전체 unit **126/126 통과**, native/verify 문법 검사 및 `git diff --check` 통과. 로그: `artifacts/separated-native-timing-final-suite.log`.
- 검토 결함의 RED: `artifacts/separated-native-raw-timing-red2.log`(의도한 3건 실패). GREEN: `artifacts/separated-native-raw-timing-green.log`(판정기 42/42).
- 기존 R2 M/F 원시 증거와 저장된 summary SHA를 읽기 전용 재검증했다. `source-comparison-final.json`에 현재 source 23개/바이너리 2개 대조와 `sameHarnessSources:false`를 기록했다. 변경은 실행 소스 중 `native.mjs`와 `verify.mjs`뿐이며 나머지는 일치한다.
- 위 정적 비교의 환경값은 과거 기록, image ID는 설정값이다. 현재 실제 환경/이미지가 같다는 새 실행 증거는 아니며, N setup에서 재확인해야 한다.
- 새 설정과 비교 기록: `artifacts/phase5-separated-20261020-native-v2/`. 과거 `verified.json`은 덮어쓰지 않았다. 제품·공통 실행 소스·fuzz·Cargo는 이번 변경에 포함하지 않았다.

새 N 실행은 아직 시작하지 않았다. 정식 F/M도 미실행이며, 이 N 전용 비교 예외로 정식 시험의 동일 소스 요구를 면제하지 않는다. 기존 2시간 실패, 회수 경계/결합 전환 메모리 미검증과 Phase 5 출시 차단을 유지한다.

### 2026-10-20 N v2 1회 — 드롭다운 입력 도구 오류 후 기한 만료

사용자의 후속 `진행`에 따라 `5bdde17f23d4bb1da9ab2f7660d208e469d6a41d`에서 N을 한 번 실행했다. 증거는 `artifacts/phase5-separated-20261020-native-v2/n-cases`, sibling log/launch JSON이다. owner `dca0b8a3-131d-4390-8b00-febaad5426d5`, launcher PID 12712, 시작 UTC `09:08:53.321`, finishedUtc `09:14:21.511`. 정상 측정 구간은 304.8192초, OS 표본 9개, 완료 사례는 **0/2**다.

- 첫 세션 `2be46ed201cd8986dd5cfed95f91ff16`의 복원 창·선택·resize·회수 receipt 네 개가 완료됐다. 네이티브 시스템 메뉴 키보드 조작으로 창 너비 1183→1172를 관측했다. MCP geometry는 **102×17→100×17**, 원격 `stty`는 **17 100**으로 일치했다. 회수 뒤 `user_owned`, epoch 2, stream null을 확인했다.
- 조작 시작~완료 접수는 네 단계 각각 15.228/17.266/37.090/20.087초였다. 이는 도구 왕복·관측을 포함하는 운영 시간이며 제품 반응 시간이 아니다. 특히 resize가 이전보다 빠르게 반응했다거나 제품 지연을 해결했다고 해석하지 않는다.
- 다음 목표 연결 `30cee5e830f57290e9167c55038edfa9`를 목록 accessibility description의 전체 ID로 대조했다. 항목 클릭은 `point (...) is over msedgewebview2.exe "Chrome Legacy Window", not target window baton.exe "Baton"`으로 거부됐다. 창 활성화·새 관측 후 드롭다운 screenshot 좌표로 한 번 재시도했으나 같은 대상 창 불일치로 거부됐다. 선택 완료나 전달 버튼 실행은 확인하지 못했으며 전달 receipt도 없다.
- 컴퓨터 제어를 중단하고 `failed` receipt를 게시하려 했지만 자동 승인 검토의 사용량 한도로 **그 명령은 실행되지 않았다**. 승인 검토 실패는 안전성 거부가 아니다. runner는 연결 선택 요청의 120초 입력 기한(t=203581.427→323581.427ms)을 만료시켜 `input_expired`로 종료했다. 도구 창 판정 오류와 이후 기록 저장 차단을 제품 소유권 전달 실패로 분류하지 않는다.
- 종료는 exit 0, 어댑터 EOF **32/32**, 자손 종료 감사 `verified`, 강제 정리 없음이다. `final-cleanup.json`은 잔류 process/container 0/0이며, 후속 읽기 전용 점검에서도 소유 프로세스 신원 43개(PID+시작 ticks)와 정확한 owner label 컨테이너의 잔류 0을 확인했다(`post-exit-check.json`).
- 실행 후 source 23개/binary 2개 해시가 모두 일치했다(`failure-analysis.json`). 준비 때 실제 OS/Node/WebView/Playwright/image도 R2 M/F와 일치했고, N 조정기/판정기 두 파일 차이만 공개했다. 환경은 Windows 10.0.26200, Node v22.17.0, WebView 155.0.4283.62, Playwright 1.62.1이다.
- 독립 verifier는 첫 사례 미완료로 `audit-observations.json`이 없어 `evidenceValid:false`, `scopePassed:false`를 기록했다. `verified.json`은 없다. summary SHA는 `f222038ac64bb46774c6d0671497671dd556a3a83e9584d14041b8d0e38e579e`다. 부분 관측을 N 통과로 승격하지 않는다.

실행 중 소스를 변경하거나 새 시험을 자동 시작하지 않았다. 다음 검토 대상은 별도 WebView popup에 대한 컴퓨터 제어의 대상 지정/키보드 선택 경로다. 제품 변경이나 기한 추가 완화의 근거는 없으며, N 재시험 및 정식 F/M은 시작하지 않았다. 기존 메모리 실패와 Phase 5 출시 차단은 유지한다.

### 2026-10-20 키보드 경로 검토

과거 [네이티브 UI 조사](rust-phase-5-native-ui-report.md#변경된-windows-앱에서의-확인)와 [기존 soak 운영 절차](rust-phase-5-native-soak.md)를 다시 확인했다. 10월 16일에 동일 popup 소유 창 오류 및 `set_value`의 변경 미관측을 이미 기록하고, 열린 목록의 키보드 선택을 운영 경로로 지정했었다. 이번 N v2에서 그 경로를 적용하지 않고 항목 클릭과 좌표 클릭을 다시 시도한 것은 운영상 실수다. 새 제품 결함의 발견으로 취급하지 않는다.

과거 run2의 선택 UI 원문·회수/전달 응답을 읽기 전용 대조했다. 목표 연결 `ff5546cc9c15674fac1e8cdd36a75921`, adapter 15→22, user_owned epoch2→agent_owned epoch3, 원격 `17 102`와 정상 정리 기록을 확인했다. 현재 후보 앱 SHA `1ae03f6b7fc0d3d17eb5571c81ba0c11d73ad9cfc39e37c2c520a9393aa0df0e`와 과거 candidate가 일치하고, 현재 `OwnershipView`도 당시 빌드 소스와 일치한다. 과거 `verified.json`을 재작성하지 않았다.

연결 목록은 표시 문자열이 12자리 접두어이고 실제 option 값은 전체 ID다. 전체 ID 관측과 정확한 새 owner의 MCP 검증을 계속 요구한다. 출력 알림에 대한 DOM 유지와, 실제 선택 변경에 따른 DOM 교체를 구별해 위 키보드 절차를 명시했다. 과거 End→Enter 성공을 임의 중간 항목 성공으로 확대하지 않는다. 제품/시험 코드는 수정하지 않았고 추가 unit·빌드·실제 N 시험은 실행하지 않았다. 다음 실행의 확인 대상은 이 절차로 현재 N의 지정 연결을 선택할 수 있는지이며, 120초/45초/900초 기준과 기존 실패 기록은 그대로 유지한다.

### 2026-10-21 N v2 키보드 재시도 마감 — 입력 완료 전 중단

사용자 `하자` 승인으로 고정 커밋 `0cee14c650dd554c860fb0cfffd50fb1efac9c8d`에서 N 1회를 실행했다. 증거는 `artifacts/phase5-separated-20261020-native-v2/n-keyboard`와 sibling log/launch JSON이다. owner `8c9f93e4-b023-4ada-9126-84354f7ccd80`, launcher PID 35812. 실행은 2026-10-20 **23:34:36~23:39:30 KST**(UTC 14:34:36.223~14:39:30.835), 부하 측정은 **270.8540초**, OS 표본 8개다. 32연결/16세션/2서버를 준비했지만 완료 사례는 **0/2**다.

- 복원 창 관측·soak-00 선택·resize·회수의 receipt/접수/검증 결과 네 개가 있다. 세션은 `b9abc9c83c470b583f81583a02b4efe0`. MCP geometry **102×17→100×17**과 원격 `stty` **17 100**이 일치하고, 회수 뒤 `user_owned`, epoch 2, stream null을 확인했다.
- 연결 선택 요청 `348f70e7-9604-46ad-a63b-5fb0028e2ede`의 목표는 `b6d96e0637bc8bb527b927f991fa619f`다. 실제 UI에서 전체 ID를 확인하고 열린 목록에 End를 입력해 마지막 항목이 강조된 것까지 관측했다. 목표 항목 확정 및 재전달 완료는 관측하지 못했다. 해당 요청은 starts만 있고 response/acceptance/result가 없다.
- 사용자가 후속 재개 요청에서 사용량 한도로 대화가 중단됐다고 보고했다. 실행기에서 직접 확인되는 원인은 **`input_expired`**이며 입력 시작 t=169266.2085ms, deadline t=289266.2085ms다. 외부 한도의 정확한 발생 시각·종류는 실행기 원시 증거에 없으므로 이를 계측한 것으로 주장하지 않는다. 임의 중간 항목의 키보드 선택 실패 또는 제품 전달 결함으로 판정하지도 않는다.
- 정상 종료 exit 0, 어댑터 EOF **32/32**(모두 exit 0), 자손 종료 감사 `verified`, 강제 정리 없음과 기록상 잔류 process/container 0/0을 확인했다. 후속 CIM 조회로 앱·자손·어댑터 **42개 PID+생성 시각** 및 정확한 owner label 컨테이너의 잔류 0을 재확인했다. runner PID도 없다. 첫 `Get-Process` 조회는 PID 35876의 시작 시각을 읽지 못해 불완전했으며, 별도 `post-exit-check-cim.json`이 이를 대체한다. 해당 PID는 나중에 시작된 `svchost.exe`로 재사용됐고 이번 시험 자원이 아니므로 건드리지 않았다.
- 독립 verifier는 필수 `audit-observations.json` 부재로 `evidenceValid:false`, `scopePassed:false`를 기록했고 `verified.json`을 만들지 않았다. 완료 transition/audit/health가 없어 출력률 인수·두 사례·메모리 판정을 내리지 않는다. partial native receipt 네 개는 사례 네 개가 아니다.
- 현재 source **23개**, binary **2개** 해시 일치를 별도 `failure-analysis.json`에 저장했다. summary SHA는 `da6291897c227a6a5733af2a3e23710652838a0507816d0c63912ac3e513c497`다. R2 M/F에 대한 실행 당시 비교는 `sameCommonInputs:true`, `sameHarnessSources:false`이며 native/verify 두 파일 차이 공개를 유지한다.

이번 재개에서는 종료된 실행에 늦은 receipt를 넣거나 새 시험을 시작하지 않았다. 원시 실패를 보존하고 결과 문서만 갱신한다. 다음 미완료 작업은 N의 지정 연결 선택·재전달을 포함한 두 사례이며, 새 실행은 별도 재시도 결정 대상이다. 정식 F 120회/M 7200초, 회수 경계 완전성·결합 전환 메모리와 Phase 5 출시 차단은 그대로 남는다. 제품 수정이나 입력 기한 추가 완화의 근거는 없다.

### 2026-10-21 키보드 재시도 — 첫 사례 완료, 두 번째 사례 전 중단

사용자 `네 합시다` 승인으로 `62f3e990c4906689dae13311cffe72dd3fdde43f`에서 N 1회를 실행했다. 증거 경로는 `artifacts/phase5-separated-20261021-native-keyboard/n-cases`다. 첫 launcher 호출은 새 부모 폴더가 없어 `realpath`에서 프로세스 생성 전에 종료됐다. 폴더를 생성한 뒤 실제 runner를 한 번 시작했다(PID 8884, owner `afb15771-dbb3-4dbb-aaa6-926d9c5bc7da`). 실제 실행은 **2026-10-21 06:08:18~06:14:09 KST**, 부하 측정 327.2980초, OS 표본 10개, 연결/세션/서버 32/16/2다.

- 첫 사례의 복원 창·선택·resize·회수·연결 선택·전달 **6개 receipt**가 접수·검증됐다. 창 너비 1183→1172, MCP 102×17→100×17과 원격 `17 100`이 일치했다.
- 열린 연결 목록에서 전체 ID를 대조하고 Down을 한 번씩 입력·관측한 뒤 Return으로 지정 중간 항목 `8acaf30dbd9b609e8030709fe2b9d417`을 확정했다. 이후 전달 버튼을 눌렀고 원시 MCP status에서 세션 `0b9b4d077d269b502098efe28e81334d`의 adapter **0→16**, epoch **1→2(user_owned)→3(agent_owned)**, 새 stream `8db0eb55037b78e3a70c2fbf8e2dfb42`를 확인했다. 이전 owner의 sessions는 비었다. 저장된 출력에 LogOracle을 다시 적용해 새 stream의 **160개 레코드 연속성**을 확인했다(`partial-analysis.json`). 이번 지정 중간 항목의 키보드 선택·전달은 관측됐지만 모든 항목/환경으로 일반화하지 않는다.
- runner의 transition 완료는 **1/2**다. 첫 audit 실행 사건과 health 사건은 각 1개지만 최종 서버 `audit-observations.json`은 없다. 서버 효과 16개/32개 검증이나 전체 N 통과로 주장하지 않는다. 독립 verifier는 필수 audit 부재로 `evidenceValid:false`, `scopePassed:false`이고 `verified.json`도 없다.
- 두 번째 사례의 `window_mode` 요청 `688b0dae-29b9-4e88-81cd-cfa2b3c5f98f`는 입력 시작 t=226742.7035ms, deadline t=346742.7035ms다. 복원 창 화면 관측 뒤 완료 receipt 발행 전에 대화가 중단됐고 runner가 `input_expired`로 종료했다. 사용자는 사용량 한도 중단을 보고했지만 runner는 외부 한도를 계측하지 않는다. 두 번째 세션 선택/최대화/회수/전달은 수행하지 못했다.
- 정상 종료 exit 0, 어댑터 EOF 32/32(모두 exit 0), 자손 종료 감사 `verified`, 강제 정리 없음이다. 현재 CIM의 **44개 소유 PID+생성 시각**, runner PID 및 정확한 owner label 컨테이너를 읽기 전용 점검해 잔류 0을 확인했다(`post-exit-check.json`).
- 현재 source 23개/binary 2개 해시가 일치한다. summary SHA `954a6a304bc1e9ee1df65ad961e1bc7fde948b0886f1108fa58a531aa7b09425`. 원시 사건/출력과의 부분 대조는 별도 `partial-analysis.json`에 저장했다. 기존 실패 기록을 덮어쓰거나 첫 사례 부분 결과로 전체 verifier를 통과시키지 않았다.

현재 제한은 제품 결함으로 입증된 것이 아니라 대화 중단에 민감한 실제 입력 시험 운영이다. 종료된 시험에는 늦은 receipt를 보내지 않았다. 새 실행·시간 기준 변경·제품 수정 없이 이번 결과를 마감한다. N 전체 두 사례, 정식 F/M, 회수 경계 완전성·결합 전환 메모리와 Phase 5 출시 차단은 그대로 남는다.

### 2026-10-21 사례 분리 후 복원 창 1회 — app_offline

- 구현 커밋: `8aafc1a`; 증거: `artifacts/phase5-separated-20261021-independent/n-restored`. owner `6111f970-15d8-485a-a499-57fe10c26a34`, runner PID 39076. 시작 02:57:43 UTC, 종료 03:00:58 UTC. 자연 관측 157.331초/OS 표본 5개, 32연결/16세션/2서버.
- 창 복원 상태와 세션 선택 두 요청만 검증됐다. 세션 `9113e33a22d7550fe6110be71ec26031`, 초기 geometry 102×17. 테두리 drag 후 화면 너비는 1183으로 동일했다. Windows 창 메뉴를 여는 Alt+Space 다음 관측에서 accessibility가 null이어서 tree 출력 코드가 오류를 냈다. resize 완료 receipt, 회수·전달, audit는 없다.
- runner는 `bad_cursor`로 실패했다. 마지막 원시 출력 응답은 cursor 188704 요청에 대한 `{"code":"app_offline"}`이며, cursor 숫자 불일치의 증거가 아니다. `acceptOutput()`이 정상 출력의 next_cursor를 요구하면서 붙인 오류 이름이다. 입력 deadline 237132ms보다 앞선 175514ms에 오류가 기록됐으므로 입력 시간 초과로 분류하지 않는다. 사용자 보고 사용량 한도 중단과 앱 연결 단절의 인과관계는 확인되지 않았다.
- shutdownFailure `normal_exit`; 최종 cleanup `normalExit:false, forcedCleanup:true`, 잔류 프로세스/컨테이너 0. 07:47 UTC에 소유 신원 42건을 PID+startedTicks로 다시 대조했고 일치 잔류 0, runner 없음, owner label 컨테이너 없음이다. `post-exit-check.json`에 저장했다. process.log는 비어 있고 해당 시각의 Baton/WebView Application 충돌/멈춤 이벤트 조회에서 일치 항목을 얻지 못했다. 이것만으로 충돌 여부나 단절 원인을 확정하지 않는다.
- 독립 verifier는 audit-observations 부재로 무효, casePassed/scopePassed false, verified.json 없음. `failure-analysis.json`에서 소스 23개/바이너리 2개 현재 해시 일치를 확인했다. summary SHA256 `54e69688beba5418e3cecfee89e721fc822d3819435e6e6e102b32202676e748`.
- 독립 사례 0/2. 최대화 설정만 준비했으며 실행하지 않았다. 자동 재실행하지 않고 먼저 app_offline 원인을 조사한다. 원시 증거·기존 실패 및 Phase 5 출시 차단을 유지한다.

### 2026-10-24 제품 Tao patch와 비계측 창 smoke

승인한 저장소 내부 Tao 0.35.3 override를 구현했다. upstream 119파일 원본 hash/라이선스를 보존하고 Windows event_loop.rs 1개 수정 + helper/test 1개 추가로 제한했다. stub RED 2실패 뒤 predicate4, 전체Rust185, frontend15 및 offline/locked release build 통과. sandbox의 기존 IPC 시험 실패는 같은 기준 버전을 sandbox 밖에서 실행해 통과했으며 원시 실패도 보존했다.

`artifacts/phase5-product-patch-20261024/native1`은 사용량 중단으로 driver 미완료/시간 제한 종료라 정상 종료 판정에서 제외했다. 명시적 재개 후 같은 비계측 제품의 `native2`에서 메뉴 표시46.223초, 반복 열기/최대화·복원/제목 표시줄 메뉴/웹 입력란 포커스/메뉴 Close를 확인했다. 종료 전143상태 online·동일연결, app exit0/adapter EOF0/정상종료/audit verified/소유 잔류0 및 소스·바이너리hash 검증. 제품 SHA256 `2e2911c3eb830fc8f207ce3c41852015417c75f1c34ed23f7f8dcab006772316`.

정적 review는 현재 고정 Tauri 사용 방식에 차단 결함을 찾지 못했다. 재전달로 raw Tao IME 이벤트가 중복될 수 있으나 현재 런타임은 이를 사용하지 않는다는 제한을 기록했다. 창파괴-before-replay 정밀 경합과 정식 N(SSH 포함) 검증은 남아 있다. 기존 N 0/2, F/M 및 Phase5 출시 차단은 유지한다. 상세 결과·중단/관측 정정·범위는 `docs/testing/rust-tao-system-menu-patch.md`를 참조한다.
