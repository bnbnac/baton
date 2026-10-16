# Phase 5 네이티브 UI 부하 시험 운영 절차

## 준비 상태 — 2026-10-17

실행기와 검증기를 준비했다. **이번 실행기의 180초 smoke와 7,200초 본 시험은 아직 시작하지 않았다.** 기존 2시간 시험 실패와 Phase 5 출시 차단은 유지한다. `release`라는 실행 모드는 이 부하 시험의 인수 조건을 뜻하며 패키지 배포나 Phase 5 전체 완료를 뜻하지 않는다.

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
4. 먼저 smoke를 한 번 수행한다. 네이티브 조작 네 단계가 매 분의 55초 안에 완료되는지 확인한다. 단위 테스트는 이 시간 조건이나 실제 창 조작의 성공을 증명하지 않는다.

PowerShell에서 사용할 명령이다. `pwsh`가 PATH에 없어도 아래 명령은 기존 Windows PowerShell에서 실행할 수 있다. 실행기는 설정된 PS7 절대 경로를 사용한다.

```powershell
Set-Location 'C:\Users\sj\Documents\work\code\baton\.worktrees\rust-phase-0'
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$evidenceRoot = 'artifacts/phase5-native-soak-preparation-20261016'
& $nodeExe rust/tests/phase5/native-soak-launch.mjs "$evidenceRoot/smoke" "$evidenceRoot/config.json" smoke
```

이 문서의 명령은 운영 절차이며 아직 실행하지 않았다. launcher가 출력하는 PID/시각과 `.launch.json`, `.log`를 보존한다. 재시도나 자동 재실행은 하지 않는다.

## 네이티브 UI 요청 처리

준비 단계에서만 Playwright로 16개 SSH 세션을 만들고 전달한다. timed load 직전에 연결을 끊는다. 본 측정 중에는 Playwright/CDP를 연결하거나 JS/DOM 조회·강제 GC를 실행하지 않는다. Windows 관측·조작은 computer-use의 `@oai/sky`를 사용한다. 직접 UIA/Win32 입력 스크립트나 관측 없는 클릭 반복문으로 대체하지 않는다.

```powershell
& $nodeExe rust/tests/phase5/native-soak-ui.mjs peek "$evidenceRoot/smoke"
```

`null`이면 처리할 요청이 없다. 요청에는 owner, 일회성 id, 세션/연결 ID, 앱 실행 파일, issuedAt/expiresAt가 있다. 매 요청마다 새 화면을 관측하고 대상 창과 상태를 확인한다. 한 번 조작한 뒤 다시 관측한다. 이전 화면의 좌표/요소 번호를 다음 요청에 재사용하지 않는다.

| 요청 | 네이티브 조작 및 확인 | 실행기의 별도 검증 |
|---|---|---|
| `select` | `soak-NN` 탭을 선택하고 제목·표시된 세션 ID를 요청과 대조한다. | 선택 자체는 operator ack로 명시한다. 이후 MCP geometry가 750ms 이상 유지된 값을 기준으로 채택한다. |
| `resize` | 요청의 maximized/restored 창 상태로 바꾼다. 이미 해당 상태여서 크기가 바뀌지 않으면 완료로 보고하지 않는다. | 선택 후 기준값과 다른 MCP geometry 및 서버 `stty size` 일치. |
| `reclaim` | 선택된 세션에서 `내가 제어하기` 실행 후 화면 확인. | user_owned, 증가한 epoch, 공개 stream 없음. |
| `handoff` | 요청한 MCP 연결을 선택하고 `에이전트에 전달` 실행 후 화면 확인. | 새 연결의 agent_owned, 증가한 epoch, 새 stream, 이전 owner의 할당 해제. |

연결 목록의 네이티브 팝업 좌표 클릭과 select `set_value`는 앞선 조사에서 신뢰할 수 없었다. 목록을 관측하고 키보드 Home/End/방향키/Enter로 선택하되, 실제 보인 연결 ID를 대조한다. 옵션 순서가 adapter 인덱스와 같다고 가정하지 않는다. 화면의 ID 접두어가 모호하면 추측하지 않는다.

조작을 실제 관측한 뒤에만 해당 요청 ID로 응답한다. `select`에는 확인한 세션 ID도 필요하다.

```powershell
& $nodeExe rust/tests/phase5/native-soak-ui.mjs done "$evidenceRoot/smoke" '<request-id>' '<selected-session-id>'
# resize/reclaim/handoff는 마지막 session 인수를 생략한다.
& $nodeExe rust/tests/phase5/native-soak-ui.mjs done "$evidenceRoot/smoke" '<request-id>'
# 조작 불가 또는 확인 실패
& $nodeExe rust/tests/phase5/native-soak-ui.mjs failed "$evidenceRoot/smoke" '<request-id>'
```

응답은 UI 조작을 했다는 기록이다. resize/reclaim/handoff는 MCP/서버 관측까지 일치해야 다음 단계로 넘어간다. 선택 단계는 독립적인 MCP 선택 검증이 아니며 결과에도 `selectionEvidence: operator_ack`로 기록한다. 숨겨진 세션의 오래된 geometry를 resize 기준값으로 사용하지 않는다.

요청당 최대 45초, 각 분의 UI 작업 전체는 55초까지다. 제한 시간을 넘긴 조작, 다른 owner/id의 응답, 중복 응답, 상태 불일치는 실패다. 한도를 늘려 기존 실패를 성공으로 바꾸지 않는다. 실제 조작 시간이 부족하면 원인을 기록하고 실행 방식부터 다시 검토한다.

## 측정과 종료 판정

매분 16세션에 중복 request_id audit를 보내고 서버 파일의 효과가 정확히 한 번인지 대조한다. 본 시험은 120회·1,920효과, smoke는 3회·48효과다. 매분 연결 health와 세션 하나의 resize/회수/다른 연결 전달을 확인한다. 각 세션의 순서 검사된 연속 출력률은 1KiB/s 이상이어야 한다. 소유권이 바뀌는 세션은 공개 구간의 경계를 새 stream으로 취급한다.

30초마다 OS 메모리와 debugger port 연결 수를 기록한다. 표본 간격/양 끝 공백은 최대 45초이며 매 표본 established 연결 0, 동일 PID·시작 시각과 app 1/renderer 1/adapter 32를 요구한다. 2시간의 첫 20분은 준비 구간으로 제외하고 이후 20분 구간 다섯 개의 중앙값을 기록한다. 마지막/첫 안정 구간의 전체 private와 working set 비율이 모두 1.20 이하여야 한다. 한 시점의 TCP 조회로 표본 사이의 모든 접속 부재를 증명할 수는 없으므로, 측정 중 다른 도구의 접속도 금지한다.

측정 종료 시 `normal-boundary.json`을 먼저 고정한다. 그 뒤에만 Playwright를 재연결해 1.31MiB 출력 대조와 ACK 차단 과부하를 검증한다. 피해 세션만 닫히고 나머지 15개는 살아 있어야 한다. 메모리 증가율 실패만으로 과부하/정상 종료 검사를 건너뛰지 않는다. 출력 누락 등 부하 자체가 무효이면 과부하는 생략 사유를 남기고 종료를 시도한다.

정상 앱 종료, adapter 32개 EOF, 자손 종료 감사, 강제 정리 없음, 소유 프로세스/컨테이너 0까지 확인한다. `stop` 파일이나 중단 신호는 부하를 멈추지만 종료 기록 읽기를 막지 않는다. 실패·중단 기록을 보존하고 재실행하지 않는다.

```powershell
# 종료 요청: 현재 실행의 경로를 확인한 뒤 생성한다.
New-Item -ItemType File -Path "$evidenceRoot/smoke/stop"
# finishedUtc가 생긴 뒤 검증
& $nodeExe rust/tests/phase5/native-soak-verify.mjs "$evidenceRoot/smoke"
```

smoke가 `smoke_passed`, 검증기가 `valid: true, releaseAcceptance: false`이고 정상 정리가 확인된 뒤에만 같은 설정으로 본 시험을 시작할 수 있다. 본 시험은 별도 `release` 디렉터리를 쓰며 같은 UI 소비자가 계속 필요하다. **smoke가 통과해도 자동으로 본 시험을 시작하지 않는다.**

```powershell
& $nodeExe rust/tests/phase5/native-soak-launch.mjs "$evidenceRoot/release" "$evidenceRoot/config.json" release
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
