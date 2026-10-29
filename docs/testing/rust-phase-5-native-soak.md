# Phase 5 네이티브 UI 부하 시험 운영 절차

## 준비 상태 — 2026-10-17

실행기와 검증기를 준비한 뒤 **첫 180초 smoke를 실행했으나 55.014초에 UI 요청 시간 초과로 실패했다.** 7,200초 본 시험은 시작하지 않았다. 아래 준비 기록은 실행 전의 이력이며 실제 실행 결과는 문서 끝에 기록했다. 기존 2시간 시험 실패와 Phase 5 출시 차단은 유지한다. `release`라는 실행 모드는 이 부하 시험의 인수 조건을 뜻하며 패키지 배포나 Phase 5 전체 완료를 뜻하지 않는다.

이 실행기는 독립적인 무인 UI 자동화 프로그램이 아니다. Node 실행기는 MCP·서버·메모리를 관측하고 파일로 UI 작업을 요청한다. 실행 중인 Codex 세션이 computer-use 도구로 요청을 수행해야 한다. heartbeat가 10분마다 확인하는 방식으로는 분당 UI 요청을 처리할 수 없다. 사용자에게 매번 조작을 맡기지는 않지만, Codex가 중단되거나 데스크톱이 잠기면 시험은 실패한다.

관련 파일:

- `rust/tests/phase5/native-soak-launch.mjs`: 새 증거 경로 예약, 숨겨진 실행기 시작, PID/시각/커밋 기록.
- `native-soak.mjs`: 실제 부하·관측·과부하 대조·종료·소유 자원 정리.
- `native-soak-control.mjs`, `native-soak-ui.mjs`: 요청/응답 파일과 제한 시간, UI 조작 수신 확인.
- `native-soak-verify.mjs`: 원시 메모리, UI 결과, 서버 audit, 정상 종료와 현재 해시 대조.
- `rust/scripts/check-test-debug-port.ps1`: OS의 TCP 연결을 조회한다. WebView에 연결하지 않는다.

## 고정할 조건

| 항목 | 값 |
|---|---|
| 증거 루트 | `artifacts/phase5-native-soak-preparation-20261016/` |
| 설정 | 위 경로의 `config.json` |
| 앱 SHA-256 | `1ae03f6b7fc0d3d17eb5571c81ba0c11d73ad9cfc39e37c2c520a9393aa0df0e` |
| 어댑터 SHA-256 | `09823dd5d51cd3b33f286540fe43a03570b3eee81497607a1b5b67336fcb754c` |
| 시험 이미지 태그 | `baton-native-soak-20261016` |
| 이미지 ID | `sha256:7270e924b7597cbece5eb6886a47c3383502f31d8a253763774f3b8c6b4f810a` |
| 연결/세션/서버 | 32 / 16 / 2, 서버는 loopback Docker fixture |
| smoke / 본 시험 | 180초·3회 / 7,200초·120회 |

앱은 앞선 UI 포커스 수정 검증의 후보 바이너리다. 별도 빌드의 226개 소스 기록은 `artifacts/phase5-ui-stability-20261016/source-hashes.json`과 `candidate.json`에 있다. dirty Cargo manifest/lock과 미완성 fuzz를 포함하지 않았다. 이번 준비에서는 제품을 수정하거나 다시 빌드하지 않았다.

smoke와 본 시험 사이에는 실행기 관련 소스 18개, 앱/어댑터 바이너리, 이미지 ID, OS/Node/WebView/Playwright 버전이 같아야 한다. 실행기는 검증 완료된 smoke summary의 해시와 동일 조건을 확인한다. 변경이 있으면 이전 smoke를 재사용하지 않는다. 아무 변경이나 새 실패가 없는데 통과한 시험을 반복하지 않는다.

## 실행 전 확인

1. Codex computer-use를 사용할 수 있는 활성 세션과 잠기지 않은 Windows 데스크톱을 확보한다. 실행기만 띄우고 대화를 끝내면 안 된다.
2. 현재 smoke/release 출력 디렉터리와 `.launch.json`이 없음을 확인한다. 기존 증거는 삭제하거나 덮어쓰지 않는다.
3. 설정의 두 바이너리 해시와 이미지 ID를 확인한다. 시험과 관계없는 앱/컨테이너를 종료하지 않는다.
4. 다음 smoke를 실행할 때는 `awaiting_native_ready`에서 먼저 화면 관측과 응답 기록을 확인한다. 준비 완료 응답 뒤에만 측정이 시작된다. 네이티브 조작 네 단계가 매 분의 55초 안에 완료되는지 확인한다. 단위 테스트는 이 시간 조건이나 실제 창 조작의 성공을 증명하지 않는다.

PowerShell에서 사용할 명령이다. `pwsh`가 PATH에 없어도 아래 명령은 기존 Windows PowerShell에서 실행할 수 있다. 실행기는 설정된 PS7 절대 경로를 사용한다.

```powershell
Set-Location '<저장소 루트>'
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$evidenceRoot = 'artifacts/phase5-native-soak-preparation-20261016'
$run = "$evidenceRoot/smoke2"
$configuration = "$evidenceRoot/config-smoke2.json"
& $nodeExe rust/tests/phase5/native-soak-launch.mjs $run $configuration smoke
```

현재 `smoke` 경로는 실패 증거이므로 다시 실행하거나 비우지 않는다. 위 명령은 개선 후 다음 실행을 위한 별도 경로이며 아직 실행하지 않았다. 새 설정은 같은 바이너리·이미지를 쓰고 검증 대상만 `smoke2/summary.json`으로 지정한다. launcher가 출력하는 PID/시각과 `.launch.json`, `.log`를 보존한다. 재시도나 자동 재실행은 하지 않는다.

## 네이티브 UI 요청 처리

준비 단계에서만 Playwright로 16개 SSH 세션을 만들고 전달한 뒤 soak-00 탭을 선택해 화면에 표시한다. Playwright를 끊은 다음 `ready` 요청을 발행하고, 네이티브 화면 확인 및 같은 파일 경로의 응답 기록이 끝나야 timed load를 시작한다. 준비 확인의 제한 시간은 120초이고 측정 시간에 포함하지 않는다. 본 측정 중에는 Playwright/CDP를 연결하거나 JS/DOM 조회·강제 GC를 실행하지 않는다. Windows 관측·조작은 computer-use의 `@oai/sky`를 사용한다. 직접 UIA/Win32 입력 스크립트나 관측 없는 클릭 반복문으로 대체하지 않는다.

```powershell
& $nodeExe rust/tests/phase5/native-soak-ui.mjs peek $run
```

`null`이면 처리할 요청이 없다. 요청에는 owner, 일회성 id, 세션/연결 ID, 앱 실행 파일, issuedAt/expiresAt가 있다. 매 요청마다 새 화면을 관측하고 대상 창과 상태를 확인한다. 한 번 조작한 뒤 다시 관측한다. 이전 화면의 좌표/요소 번호를 다음 요청에 재사용하지 않는다.

| 요청 | 네이티브 조작 및 확인 | 실행기의 별도 검증 |
|---|---|---|
| `ready` | 시험 창, soak-00 제목, 전체 세션 ID, 창이 복원 상태임을 관측한다. 동일한 응답 CLI로 준비 완료를 기록한다. | 응답 owner/id/세션·제한 시간 검증. 선택 증거는 operator ack다. 완료 전에는 측정하지 않는다. |
| `select` | `soak-NN` 탭을 선택하고 제목·표시된 세션 ID를 요청과 대조한다. | 선택 자체는 operator ack로 명시한다. 이후 MCP geometry가 750ms 이상 유지된 값을 기준으로 채택한다. |
| `resize` | 요청의 maximized/restored 창 상태로 바꾼다. 이미 해당 상태여서 크기가 바뀌지 않으면 완료로 보고하지 않는다. | 선택 후 기준값과 다른 MCP geometry 및 서버 `stty size` 일치. |
| `reclaim` | 선택된 세션에서 `내가 제어하기` 실행 후 화면 확인. | user_owned, 증가한 epoch, 공개 stream 없음. |
| `handoff` | 요청한 MCP 연결을 선택하고 `에이전트에 전달` 실행 후 화면 확인. | 새 연결의 agent_owned, 증가한 epoch, 새 stream, 이전 owner의 할당 해제. |

연결 목록의 네이티브 팝업 좌표 클릭과 select `set_value`는 앞선 조사에서 신뢰할 수 없었다. 목록을 관측하고 키보드 Home/End/방향키/Enter로 선택하되, 실제 보인 연결 ID를 대조한다. 옵션 순서가 adapter 인덱스와 같다고 가정하지 않는다. 화면의 ID 접두어가 모호하면 추측하지 않는다.

조작을 실제 관측한 뒤에만 해당 요청 ID로 응답한다. `ready`와 `select`에는 확인한 세션 ID도 필요하다. 이 환경에서는 hard-link 기반 원자적 응답 쓰기가 샌드박스에서 EPERM으로 거부됐다. Codex는 기존에 허용된 `require_escalated` 실행 경로로 이 CLI를 호출하며, 준비 단계에서 성공한 동일 경로를 측정 중에도 사용한다. 원자적 기록·중복 차단을 없애거나 권한 설정을 바꾸지 않는다.

```powershell
& $nodeExe rust/tests/phase5/native-soak-ui.mjs done $run '<request-id>' '<selected-session-id>'
# resize/reclaim/handoff는 마지막 session 인수를 생략한다.
& $nodeExe rust/tests/phase5/native-soak-ui.mjs done $run '<request-id>'
# 조작 불가 또는 확인 실패
& $nodeExe rust/tests/phase5/native-soak-ui.mjs failed $run '<request-id>'
```

응답은 UI 조작을 했다는 기록이다. resize/reclaim/handoff는 MCP/서버 관측까지 일치해야 다음 단계로 넘어간다. 선택 단계는 독립적인 MCP 선택 검증이 아니며 결과에도 `selectionEvidence: operator_ack`로 기록한다. 숨겨진 세션의 오래된 geometry를 resize 기준값으로 사용하지 않는다.

`done`은 기록 후 최대 5초 기다려 `nextRequest`를 같은 JSON 응답에 반환한다. 반환된 다음 요청이 있으면 별도 `peek` 없이 새 화면 관측부터 진행한다. `receipt: recorded`, `nextRequest: null`, `waitTimedOut: true`는 응답 기록은 성공했지만 다음 요청을 아직 받지 못했다는 뜻이다. UI 조작이나 `done`을 반복하지 말고 이후 `peek`로 확인한다. 실패 응답은 다음 요청을 기다리지 않는다. 다음 요청의 owner와 만료도 확인하며, 이 대기는 요청/회차 제한 시간을 늘리지 않는다.

요청당 최대 45초, 각 분의 UI 작업 전체는 55초까지다. 제한 시간을 넘긴 조작, 다른 owner/id의 응답, 중복 응답, 상태 불일치는 실패다. 한도를 늘려 기존 실패를 성공으로 바꾸지 않는다. 실제 조작 시간이 부족하면 원인을 기록하고 실행 방식부터 다시 검토한다.

### 최대화 상태의 클릭 관측 보완

2026-10-18 집중 진단에서 최대화 후 접근성 요소 클릭이 실제 버튼 위치를 벗어나는 현상을 재현했다. 최대화·복원 직후 첫 캡처는 전환 중 화면이나 이전 접근성 상태일 수 있으므로, 창 크기와 버튼 위치가 확정된 새 화면을 관측한다. 최대화된 창의 회수·전달 및 제목 표시줄 조작은 해당 화면에 보이는 버튼 좌표와 본문 screenshotId를 사용한다. 좌표는 매번 새 관측에서 결정하며 고정하지 않는다.

반환된 screenshots[0]을 본문이라고 가정하지 않는다. 이번 최대화 관측에서는 15×15 영역이 첫 번째, 실제 본문 2560×1392가 두 번째였다. 복원 후에는 본문 1183×851 하나였다. 캡처의 내용·크기를 확인해 대상으로 선택한다. 조작 후 즉시 반환된 접근성 텍스트가 화면보다 늦는 경우도 관측했다. 클릭 호출의 성공 응답이나 이전 트리만으로 완료 처리하지 않고, 화면 변화 및 기존 MCP/서버 검증을 유지한다.

## 측정과 종료 판정

매분 16세션에 중복 request_id audit를 보내고 서버 파일의 효과가 정확히 한 번인지 대조한다. 본 시험은 120회·1,920효과, smoke는 3회·48효과다. 매분 연결 health와 세션 하나의 resize/회수/다른 연결 전달을 확인한다. 각 세션의 순서 검사된 연속 출력률은 1KiB/s 이상이어야 한다. 소유권이 바뀌는 세션은 공개 구간의 경계를 새 stream으로 취급한다.

30초마다 OS 메모리와 debugger port 연결 수를 기록한다. 표본 간격/양 끝 공백은 최대 45초이며 매 표본 established 연결 0, 동일 PID·시작 시각과 app 1/renderer 1/adapter 32를 요구한다. 2시간의 첫 20분은 준비 구간으로 제외하고 이후 20분 구간 다섯 개의 중앙값을 기록한다. 마지막/첫 안정 구간의 전체 private와 working set 비율이 모두 1.20 이하여야 한다. 한 시점의 TCP 조회로 표본 사이의 모든 접속 부재를 증명할 수는 없으므로, 측정 중 다른 도구의 접속도 금지한다.

측정 종료 시 `normal-boundary.json`을 먼저 고정한다. 그 뒤에만 Playwright를 재연결해 1.31MiB 출력 대조와 ACK 차단 과부하를 검증한다. 피해 세션만 닫히고 나머지 15개는 살아 있어야 한다. 메모리 증가율 실패만으로 과부하/정상 종료 검사를 건너뛰지 않는다. 출력 누락 등 부하 자체가 무효이면 과부하는 생략 사유를 남기고 종료를 시도한다.

정상 앱 종료, adapter 32개 EOF, 자손 종료 감사, 강제 정리 없음, 소유 프로세스/컨테이너 0까지 확인한다. `stop` 파일이나 중단 신호는 부하를 멈추지만 종료 기록 읽기를 막지 않는다. 실패·중단 기록을 보존하고 재실행하지 않는다.

```powershell
# 종료 요청: 현재 실행의 경로를 확인한 뒤 생성한다.
New-Item -ItemType File -Path "$run/stop"
# finishedUtc가 생긴 뒤 검증
& $nodeExe rust/tests/phase5/native-soak-verify.mjs $run
```

smoke가 `smoke_passed`, 검증기가 `valid: true, releaseAcceptance: false`이고 정상 정리가 확인된 뒤에만 같은 설정으로 본 시험을 시작할 수 있다. 본 시험은 별도 `release` 디렉터리를 쓰며 같은 UI 소비자가 계속 필요하다. **smoke가 통과해도 자동으로 본 시험을 시작하지 않는다.**

```powershell
& $nodeExe rust/tests/phase5/native-soak-launch.mjs "$evidenceRoot/release" $configuration release
& $nodeExe rust/tests/phase5/native-soak-verify.mjs "$evidenceRoot/release"
```

컨테이너 정리는 이번 owner label과 이름/ID를 모두 대조한 자원에만 적용한다. 이미지 태그는 smoke와 본 시험 사이에 보존한다. 더 이상 시험에 쓰지 않을 때 현재 ID가 위 기록과 같은 경우에만 해당 태그를 제거하고 `final-cleanup.json`에 남긴다. 일괄 prune은 하지 않는다.

## 준비 검증 기록

- Phase 5의 7개 `.test.mjs` 파일: 83개 통과. 새 native mailbox/검증기 테스트는 25개이며 나머지 58개는 기존 분석·프로세스 신원·패키지·로그 oracle 회귀 검사다.
- 선택 확인 누락/오류와 검증 시간 초과: 추가한 두 테스트가 수정 전 실패하고 수정 후 통과했다.
- 선택 전 geometry 사용, 선택 관측과 다른 기준값, 크기 변화 없음: 세 회귀 테스트가 수정 전 실패하고 수정 후 통과했다.
- 모든 `native-soak*.mjs` 구문 검사와 앱/어댑터 해시 확인 통과. Docker 조회는 처음 샌드박스에서 거부됐고, 허용된 읽기 전용 조회로 이미지 ID 일치와 이 이미지의 컨테이너 0을 확인했다.
- 독립 검토 에이전트는 사용 한도로 완료하지 못했다. 직접 검토에서 위 geometry 문제와 stop 중 종료 관측, 앱 시작 전 실패의 정리 경로를 보강했다. 독립 검토 완료로 표시하지 않는다.
- 미완성 fuzz 파일은 수정·실행·커밋하지 않았다. 준비 이미지는 다음 smoke를 위해 보존했다. 실제 smoke/2시간 실행의 성공 증거는 아직 없다.

## 첫 smoke 결과 — 2026-10-17 06:03 KST

사용자의 진행 지시 후 커밋 `20bc104`에서 한 번 실행했다. 실행기 PID 40600, 시작 `2026-10-16T21:02:06.142Z`, owner `d8f4bb9d-9fc1-46fb-adad-db73bdeb59a8`. 증거는 위 루트의 `smoke/`, `smoke.log`, `smoke.launch.json`이다. 32연결·16세션·2서버 준비를 마친 뒤 timed load는 `21:02:25.168Z`에 시작했다.

첫 `select` 요청은 `21:02:31.037Z`에 발행됐다. Windows 화면의 목록이 아래로 스크롤돼 있어 위로 이동한 뒤 soak-00을 선택했고, 다음 관측에서 전체 세션 ID `18d37ad9dd4be62508f395217910d3b6`를 대조했다. 즉시 클릭 응답의 접근성 트리는 이전 선택을 담았으므로 후속 관측을 사용했다.

처음 응답 파일을 기록할 때 샌드박스의 hard-link 생성이 EPERM으로 거부됐다. 완료된 조작을 다시 수행하지 않고 같은 응답 기록만 허용된 환경에서 수행했다. 응답 시각은 `21:03:14.044Z`, 선택 이후 geometry 안정 검증 완료는 `21:03:14.993Z`였다. 요청에서 검증 완료까지 **43.956초**가 걸렸다. 이는 전체 관측·도구 호출·판단·응답 기록 시간이며 제품의 탭 선택 처리 시간으로 해석하지 않는다.

이어진 resize 요청의 남은 예산은 **5.175초**였다. 크기 변경 전 새 창 상태 조회가 `foreground window did not report a process id` 오류를 반환했다. 유효한 새 관측을 얻지 못해 창 크기 변경은 수행하지 않았다. 이후 창 목록에 시험 앱이 없었으며 실행기는 제한 시간 종료 후 정상 종료 경로를 완료했다. 오류와 종료가 가까운 시점이므로 해당 오류를 별도의 제품 결함이나 확정된 도구 원인으로 단정하지 않는다.

실제 측정은 **55.0138236초**, 종료 시각 `21:03:24.104Z`다. 결과는 `failed`, 원인은 `native_action_timeout`. 완료한 전체 회차는 0개이고 회수·전달·과부하 대조는 검증하지 못했다. audit 명령 발행 1회 기록은 있으나 서버 파일 최종 대조까지 도달하지 않았으므로 audit 통과로 취급하지 않는다. 검증기 CLI도 `audit-observations.json` 누락으로 종료 코드 1을 반환했고 `verified.json`은 생성되지 않았다.

정상 종료 단계는 통과했다: 앱 종료 코드 0, adapter 32개 EOF, 자손 종료 감사 verified, 강제 정리 없음. 별도 PID/시작 시각 및 owner label 재확인에서 소유 프로세스와 컨테이너 모두 0이었다. 소스 18개와 바이너리 2개 해시가 일치했고 원시 memory JSONL과 summary의 두 표본이 일치했다. 두 표본의 debugger established는 0이지만 이 길이로 메모리 증가율을 평가하지 않는다.

2시간 시험이나 새 smoke는 시작하지 않았다. 시험 이미지는 동일 조건의 향후 검토를 위해 보존했고 ID 일치를 확인했다. 기존 실패와 출시 차단은 유지한다. 다음 검토 대상은 시작 전 UI 목록 위치 준비, 응답 파일 기록의 실행 권한 확정, 관측과 조작의 실제 시간 예산이다. 제한 시간을 늘리거나 이 실패 기록을 통과로 바꾸지 않는다. 단위 테스트 83개 통과는 이 실제 UI 처리 속도를 증명하지 못했다.

## 준비 순서와 왕복 호출 개선 — 2026-10-17

사용자의 진행 동의 후 실행기 준비 경로만 수정했다. 첫 탭 표시 → Playwright 분리 → 실제 네이티브 준비 응답 → 측정 시작 순서이며, 준비 응답까지 출력 읽기와 중단 확인은 계속한다. 준비 실패도 기존 단계 실행기를 통해 과부하 생략과 정상 종료 시도로 이어진다. 실제 분당 select/resize/reclaim/handoff와 55초 회차 제한, 45초 요청 상한, 메모리 조건은 유지했다.

같은 응답 기록 호출에서 다음 요청까지 반환해 별도의 조회 왕복을 줄였다. 테스트는 준비 응답 누락/다른 세션, 측정 시작 이후 또는 브라우저 분리 이전 준비 기록, 이전 요청의 재반환, 다음 요청 대기 상한을 검사한다. 이 변경은 초기 준비 지연과 조회 호출 수를 줄이기 위한 것이며 실제 55초 조작 성공을 증명하지 않는다. 사용자 상호작용을 무관측 반복문으로 자동화하지 않았다. 첫 실패 증거와 기존 이미지/바이너리는 보존했고 새 smoke와 2시간 시험은 실행하지 않았다.

개선 후 Phase 5의 동일한 7개 단위 테스트 파일에서 **90개 통과**(native 32개, 기존 58개), 실행기 관련 JavaScript 구문 검사 통과. 준비 차단/다음 요청 반환의 새 함수가 없을 때 세 테스트가 실패했고 구현 후 통과했다. 준비 증거 없는 실행을 기존 검증기가 허용하던 회귀 테스트도 실패를 확인한 뒤 수정했다. 실제 앱의 변경된 준비 순서와 네이티브 조작 처리 시간은 다음 live smoke에서 확인할 항목이다.

이번 변경분(`a8d7991` 이후)에 대한 독립 읽기 전용 코드 검토는 차단 사항 없음으로 완료됐다. 검토자는 테스트나 실제 부하를 실행하지 않았으며, 검토 결과를 live smoke 통과로 해석하지 않는다.

## 두 번째 smoke 결과 — 2026-10-17 06:40 KST

사용자의 실행 지시 후 `ccd716f`에서 `config-smoke2.json`으로 한 번 실행했다. PID 37948, 시작 `2026-10-16T21:38:33.377Z`, owner `225be3a2-de11-4208-8472-6b042dfc60c5`. 증거는 같은 루트의 `smoke2/`, `smoke2.log`, `smoke2.launch.json`이다. 기존 실패 증거는 보존했다.

32연결·16세션·2서버 준비 후 Playwright 분리는 `21:38:49.024Z`, 네이티브 ready 검증은 `21:39:03.995Z`, 측정 시작은 `21:39:03.996Z`였다. 준비 응답은 실제 측정 전에 같은 응답 CLI 경로로 기록됐다. 첫 세션 선택은 전체 ID `1940707aa5149548174309e832e1eb32`를 화면과 대조한 operator ack이며, 요청부터 검증까지 7.334초였다. 창 최대화 후 MCP geometry는 102×17에서 274×52로 바뀌었고 서버 `stty size`도 `52 274`로 일치했다. resize 요청부터 검증까지는 22.744초였다. 이 시간은 도구 호출·관측·판단·응답을 포함하며 제품 처리 지연을 뜻하지 않는다.

회수 요청은 `21:39:38.335Z`에 발행됐고 남은 회차 예산은 약 20.664초였다. 접근성 요소로 `내가 제어하기` 버튼을 한 번 클릭했지만 후속 접근성 트리와 화면에서 agent-owned 상태가 계속 보였다. 회수 성공 응답을 기록하지 않았으며 요청은 제한 시간을 넘겼다. 최대화 뒤 관측된 커서 위치와 버튼 위치 차이는 클릭 좌표 문제의 단서일 뿐 원인 확정 증거가 아니다. 전달 단계에는 도달하지 못했다.

실제 측정 **55.0519023초**, 완료 `21:40:03.222Z`, 결과 `failed` / `native_action_timeout`, 완료 회차 0이다. 과부하 대조는 부하 무효로 생략됐다. audit 발행은 1회지만 서버 파일 최종 대조가 없어 audit 통과가 아니다. 검증기 CLI는 `audit-observations.json` 누락으로 종료 코드 1이며 `verified.json`이 없다. 180초 smoke 통과나 메모리 판정을 주장할 수 없다.

정상 종료는 앱 종료 코드 0, adapter EOF 32개, 자손 감사 verified, 강제 정리 없음으로 확인됐다. 별도 PID·시작 시각 및 실제 `baton.soak` owner label/fixture 이름·ID 조회에서 소유 프로세스·컨테이너 잔존 0이다(`post-run-cleanup.json`). 소스 18개·바이너리 2개 해시는 일치하며 원시 memory JSONL 두 표본은 summary와 동일하고 debugger established는 모두 0이다. 이미지 ID는 일치하며 후속 검토를 위해 태그를 보존했다.

제품·실행기·미완성 fuzz 파일은 변경하지 않았고 자동 재실행과 2시간 시험은 시작하지 않았다. 다음 검토는 전체 부하 재실행보다 최대화 후 네이티브 클릭 대상/좌표와 관측 갱신을 좁혀 확인하는 것이다. 기존 2시간 실패 및 Phase 5 출시 차단은 유지한다.

## 최대화 후 클릭 집중 진단 — 2026-10-18

사용자의 진행 지시로 기존 probe의 별도 복사본 `artifacts/phase5-ui-stability-20261016/click-probe.mjs`를 사용했다. 기존 제품/실행기는 수정하지 않았다. 같은 바이너리 두 개와 native-soak fixture image, 32연결·16세션·2서버를 준비했다. 복사본은 첫 탭 표시, 기존 이미지 선택, 900초 진단 상한만 달리했다. 분당 회차 마감이 없는 관측용 진단이므로 smoke나 출시 승인 증거가 아니다.

실행 시작 `2026-10-17T22:35:52.805Z`, PID 14200, owner `f5ce7290-68c6-4c35-bd98-650e2852eb3e`, 증거 `artifacts/phase5-ui-stability-20261016/click-run1/`. Playwright 분리 후 네이티브 입력만 사용했고 실제 진단 구간은 275.8099746초였다. 대상은 soak-00 / `49c797a0b6cb284e776cd921fb7f11e3`이다.

| 관측·조작 | MCP 및 화면 결과 |
|---|---|
| 최대화 완료 뒤 새 접근성 요소로 회수 클릭 | 화면 커서가 버튼 밖에 나타났고 agent_owned / epoch 1 유지 (`01-element.json.response`) |
| 첫 캡처를 본문으로 잘못 선택한 좌표 시도 | 15×15 bounds 오류. epoch 1 유지 (`02-coordinate.json.response`). 이는 이번 진단의 캡처 선택 실수이며 앞선 smoke2 원인과 혼동하지 않는다. |
| 새 본문 캡처의 회수 버튼 좌표 클릭 | user_owned / epoch 2 / stream null (`03-main-coordinate.json.response`) |
| 본문 좌표로 다시 전달 | adapter 0 할당 해제, adapter 15로 agent_owned / epoch 3 / 새 stream (`04-handoff.json.response`) |
| 최대화 상태 제목 표시줄의 접근성 복원 클릭 | 화면에서 복원되지 않았고 커서가 복원 버튼 밖에 나타남. 새 본문 좌표 클릭은 복원에 성공 |
| 복원 완료 후 새 접근성 요소로 회수 클릭 | user_owned / epoch 4 / stream null (`05-restored-element.json.response`) |
| 복원된 본문 좌표로 다시 전달 | agent_owned / epoch 5 / 새 stream, MCP 102×17과 서버 `17 102` 일치 (`06-final-handoff.json.response`) |

이번 환경에서는 최대화 후 접근성 요소를 클릭 대상으로 삼는 경로에 문제가 있음을 재현했다. 동일한 앱·세션에서 본문 좌표 입력은 정상 처리됐고, 복원 상태의 요소 클릭도 성공했다. 제품 소유권 로직을 수정할 근거는 없다. 다만 접근성 제공자·도구의 좌표 변환 중 어느 내부 계층이 원인인지까지 확정한 것은 아니며, 단일 실행으로 모든 배율·창 배치를 보장하지 않는다.

종료 결과는 native_probe_completed, 앱 종료 코드 0, 정상 종료 및 자손 감사 verified, adapter 32개 EOF 확인, 강제 정리 없음이다. 원시 MCP 응답을 독립 assertion으로 대조한 `click-verification.json`과 PID·시작 시각/owner label 재조회 `post-run-cleanup.json`을 남겼다. 소유 프로세스·컨테이너 0, 소스 15개·바이너리 2개 해시 일치, 원시 OS 표본 10개와 summary 일치, 매 표본 debugger established 0이다. 이미지 태그는 같은 ID로 보존했다.

시험 조작 절차만 위와 같이 보완했다. 제품·미완성 fuzz 파일은 변경하지 않았으며 새 180초 smoke 및 2시간 시험은 실행하지 않았다. 55초 회차 내 처리 가능성은 여전히 미검증이고 기존 실패·Phase 5 출시 차단은 유지한다.

## 세 번째 smoke 결과 — 2026-10-18 07:54 KST

사용자의 진행 지시로 `0bcdb19`에서 한 번 실행했다. 설정 `config-smoke3.json`, 증거 `artifacts/phase5-native-soak-preparation-20261016/smoke3/`, PID 43012, 시작 `2026-10-17T22:53:10.479Z`, owner `4fc7348a-9712-4962-84c9-0d5ac4f51f26`. 동일 바이너리·이미지로 32연결·16세션·2서버를 준비했다. 준비 응답 후 측정 시작은 `22:53:43.976Z`였다.

| 첫 회차 단계 | 요청부터 검증까지 | 증거 |
|---|---:|---|
| 선택 | 9.062초 | soak-00 전체 ID `a14c3b2d8349290a75aa35a12a9fdd80` 화면 대조(operator ack) |
| 최대화 | 15.334초 | MCP 102×17 → 274×52, 서버 `52 274` 일치 |
| 회수 | 18.311초 | 본문 캡처 좌표 클릭 후 사용자 제어 화면, MCP user_owned / epoch 2 / stream 없음 검증 |
| 전달 | 남은 예산 7.795초 | 요청한 adapter 16 / `fbb3a4443d91c472db9b31cae307dee6` 선택 완료 전에 제한 시간 도달 |

전달 목록을 열고 관측했지만 대상 연결 선택과 전달 버튼 실행, 완료 응답은 수행하지 않았다. 만료 뒤 추가 입력도 보내지 않았다. 보완한 본문 좌표 클릭은 이번 timed run에서도 회수에 성공했다. 시간 수치는 모델 판단·관측·도구 및 응답 왕복·서버 검증을 포함하므로 제품 처리 지연으로 해석하지 않는다.

실제 측정 **55.0879289초**, 완료 `22:54:43.503Z`, 결과 failed / native_action_timeout, 완료 회차 0. 부하 무효로 과부하 생략, audit 최종 대조 미수행, 180초 미달이다. 검증기 CLI는 audit-observations.json 부재로 종료 코드 1을 반환했다. 별도 failure-evidence-check.json은 실패 증거·해시·단계 관측 대조일 뿐 출시 승인용 verified.json이 아니다.

정상 종료 코드 0, adapter EOF 32개, 자손 감사 verified, 강제 정리 없음. PID·시작 시각과 baton.soak owner label 독립 재조회에서 잔존 프로세스·컨테이너 0을 확인했다. 소스 18개·바이너리 2개 해시 일치, 원시 OS 표본 두 개와 summary 일치, debugger established 모두 0이다. 같은 이미지 태그는 보존했다. 제품·실행기·미완성 fuzz 변경은 없으며 자동 재실행이나 2시간 시험도 없다.

세 번의 smoke에서 현재 대화형 네이티브 소비자가 55초 회차를 완료했다는 증거를 얻지 못했다. 이번에는 클릭 실패가 아닌 관측·도구 왕복을 포함한 시간 예산 부족으로 전달을 완료하지 못했다. 다음은 네 번째 동일 재시도가 아니라 시험 구성 재검토다. 장시간 부하의 자동 실행과 별도 네이티브 UI 검증을 분리할지, 원래 요구한 네이티브 전환 빈도를 다른 실행 방식으로 충족할지 논의해야 한다. 이는 아직 채택하거나 구현하지 않은 제안이며, 기존 55/45초 조건·2시간 실패·Phase 5 출시 차단은 유지한다.
