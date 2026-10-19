# Phase 5 목적별 시험 운영

상태: 수정 후 M 사전 시험은 통과했다. 같은 입력의 F는 전환 17회와 정상 종료를 수행했으나 마지막 새 stream 출력 증거 부재로 독립 검증에 실패했다. 첫 출력 대기 보강 후 unit 116개 통과, 실제 재실행/N 미실행. 기존 2시간 실패와 Phase 5 출시 차단은 유지한다.

[승인 설계](../superpowers/specs/2026-10-18-rust-phase-5-separated-validation-design.md), [구현 계획](../superpowers/plans/2026-10-18-rust-phase-5-separated-validation.md).

## 범위

| Scope | 정식 실행 | 사전 검사 | 통과의 의미 |
|---|---|---|---|
| M | 7,200초, 고정 첫 탭, Playwright 분리 | 180초/3회 audit | 고정 UI의 부하·자연 메모리 및 과부하·종료 |
| F | Playwright 연결, 전환 120회 | 17회(첫 세션 재방문) | 프런트엔드 resize·회수·다른 owner 전달 기능 |
| N | 복원/최대화, 서로 다른 2세션 | 없음 | 현재 Windows 환경에서 실제 입력 경로 |

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
    "M": "artifacts/phase5-separated-20261018/m-preflight",
    "F": "artifacts/phase5-separated-20261018/f-preflight"
  }
}
```

F/N 및 정식 비교 실행의 설정에는 `baselineEvidence`로 완료·검증된 최초 M 사전 검사 디렉터리를 지정한다. 해당 실행과 source manifest, 바이너리, image, OS/Node/WebView/Playwright가 달라지면 측정 전 거부한다. config 자체의 증거 경로 차이를 제품 변경으로 취급하지 않는다. fixture는 localhost에만 노출한다. 사용자 서버·자격 증명은 사용하지 않는다.

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

computer-use skill의 관측 → 단일 조작 → 새 관측 절차를 따른다. 직접 Win32/PowerShell UIA helper 또는 관측 없는 클릭 루프를 사용하지 않는다. 로그인은 setup 단계에서 fixture 전용 Playwright로 끝나 있으므로 네이티브 조작은 준비된 세션의 창/탭/소유권만 다룬다.

1. `node rust/tests/phase5/separated/native-ui.mjs peek <evidence-dir>`로 요청과 전체 세션/목표 연결 ID를 읽는다.
2. 대상 창을 새로 관측하고 본문 캡처의 크기·내용으로 screenshotId를 고른다. 첫 배열 원소가 본문이라고 가정하지 않는다. 복원/최대화 완료 후 다시 관측한다.
3. 조작 준비가 끝나면 `... native-ui.mjs start <evidence-dir> <request-id>`를 호출한다. `inputAllowed:true`와 해당 요청의 active 정보가 확인돼야 입력한다. 대기 중이면 peek로 확인하며 start나 UI 입력을 중복 실행하지 않는다.
4. 새 관측으로 지정된 입력을 한 번 실행한다. 최대화 상태에서 이미 빗나간 접근성 요소 클릭 방식 대신 본문 캡처 좌표를 사용한다. 선택 목록은 전체 목표 연결 ID를 대조한다. 단축 표식만으로 다른 연결을 선택하지 않는다.
5. 즉시 새 화면을 관측하고 `done`에 JSON observation을 전달한다. `screenshotId`는 모든 응답에 필수다. select에는 `selectedSession`, window_mode/resize에는 `windowMode`, choose_connection에는 `targetConnection`도 필요하다. 예: `{"screenshotId":"실제 캡처 ID","selectedSession":"전체 세션 ID"}`. 실패는 `failed`로 보고한다.
6. receipt 저장 실패 시 UI를 다시 누르지 않는다. pending/active와 실제 화면·MCP 상태를 먼저 확인한다. 완료 판정은 runner의 MCP·서버 stty·epoch/stream/이전 owner 검증이 수행한다.

N의 전체 900초에는 준비가 포함된다. 입력 준비 전의 관측 대기와 실제 입력 확인은 별도다. start 승인부터 상태 확인까지 최대 45초이며 도구 왕복도 포함하므로 순수 제품 지연으로 보고하지 않는다. 세션 0은 복원 창 resize, 세션 1은 복원 상태에서 선택 후 최대화 resize를 사용한다. 전달할 연결 선택과 전달 버튼은 별도 요청이므로 하나의 입력 시간에 목록 탐색 전체를 몰아넣지 않는다.

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
