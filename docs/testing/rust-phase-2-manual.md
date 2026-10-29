# Phase 2 Windows 물리 인수

자동 시험과 별도인 Windows 인수 절차다. 현재 확보한 관측과 남는 제한은 [인수 기록](rust-phase-2-report.md)의 현재 증거 대조표를 따른다. `term.input()` 등 JS 합성 입력을 OS 입력 시험 통과로 기록하지 않는다. 계획에서 허용한 native UI automation과 사람의 직접 조작은 구별해 기록하며, 실제 한글 IME·클립보드 경로를 거쳤는지 확인한다. 제품 실행 파일은 `rust/target/debug/baton.exe`, 시험 전용 실행 파일은 `rust/target/debug/baton-ui-acceptance.exe`이다. 전달/회수 버튼은 시험 앱에만 있다.

## 현재 합의한 범위 (2026-10-06)

사용자 승인으로 Windows 100/150/200% 배율 전수 검사는 **Windows 배포 전 호환성 검사로 이관**한다. 지금은 사용 중인 배율을 바꾸지 않고 창 크기 변경 경로를 확인한다. 미수행 배율은 통과나 불필요로 기록하지 않는다.

기존 `manual-4c56ff5da42d44ff8e5ba7d990219c7b`(vi)와 `manual-650c26def172473f9b70b22bf54947cf`(top)의 최대화·복귀에서 서버 PTY 크기 `141×39 → 314×75 → 141×39`를 확인했다. 사용자는 실제 화면 글자가 깨지지 않았다고 확인했다. 이 기존 증거를 재사용하고 단순히 DPI 목록을 채우려고 같은 조작을 반복하지 않는다. 당시 실제 Windows 배율 수치는 별도로 확인하지 않았으므로 특정 배율 통과로 환산하지 않는다. 배율별 잘림·가독성·마우스 좌표 검증은 배포 전까지 미검증이다.

원래 전체 13개 항목과 단일 실행 수집 방식은 보존한다. 새 schemaVersion 2 수집기는 실제 승인 내용을 가진 `dpi-100`, `dpi-150`, `dpi-200` 보류를 별도로 표현한다. 나머지 필수 관측이 모두 있으면 `observed_with_deferrals` / 최종 `passed_with_deferrals`이며 완전한 배율 검증 통과를 뜻하지 않는다. 현재는 빌드별 관측 누락도 있어 `manual_pending`이다.

## 시작

작업 폴더는 `<저장소 루트>`이다. PowerShell 7, Node, Docker Desktop과 빌드된 두 실행 파일이 필요하다.

1. `pwsh -NoProfile -File rust/scripts/verify-phase-2.ps1`을 실행한다. 자동 검사 통과·수동 미확인은 **exit 2 / manual_pending**이다. 출력의 `PHASE_2_RECEIPT` 경로를 사용한다.
2. `pwsh -NoProfile -File rust/scripts/test-phase-2-manual.ps1 -Verification '<summary.json 절대 경로>'`를 실행한다. 현재 소스·lock·실행 파일 해시가 다르면 시작을 거부한다.
3. `MANUAL_RUN` 디렉터리를 기록한다. 임시 OpenSSH 컨테이너와 loopback 중계 서버만 사용한다. 중계 서버가 SSH로 실제 수신한 입력 바이트를 기록하고 OpenSSH PTY에 전달한다. 실제 홈서버에는 접속하지 않는다.
4. 앱에서 case를 선택하고 소유 상태를 지정한다. **구간 시작 → 실제 조작 → 출력 안정 확인 → 수신 기록** 순서로 수행한다. 상태 변경이 완료됐는지, `observations.jsonl`에 실제 레코드가 추가됐는지 확인한다. 일반 입력은 UserOwned/AgentOwned 양쪽을 기록한다. IME 회수·vi·종료는 아래의 연속 시나리오 규칙을 따른다. 기존 단일 실행 수집기는 마지막 case/mode를 고르지만 새 수집기는 관측 시각까지 명시한다.
5. 화면은 Windows 캡처 도구로 직접 저장한다. 앱 표시, 관측 시각, DPI 시험의 실제 Windows 배율을 함께 확인한다. 캡처에 개인 알림 등이 들어가지 않게 한다.
6. 마지막에는 **관측 종료** 버튼으로 끝낸다. 기본 30분 제한을 초과하거나 실행기를 강제 종료한 실행은 정상 종료 증거가 아니다. 컨테이너 정리 결과와 앱/WebView 자손 종료 결과를 확인한다.

일반 셸 준비 명령과 이전 시험의 미완성 입력 정리는 **구간 시작 전**에 한다. 예를 들어 Ctrl+U로 이전 입력을 지울 수 있다. 입력을 기록하는 fixture이므로 실제 비밀번호나 개인 데이터는 입력하지 않는다.

## 전체 관측 목록 (DPI 세 항목은 배포 전 수행)

| ID | 실제 조작과 확인 |
|---|---|
| `physical-key` | 영문 `A`를 직접 누른다. UserOwned 수신은 `41`, AgentOwned는 빈 문자열이어야 한다. Enter 없이 수행하면 셸 명령이 실행되지 않는다. |
| `physical-paste` | 시험 문자열 `BATON_PASTE 한글 😀`를 OS 클립보드에서 Ctrl+Shift+V로 붙여넣는다. 현재 Windows 시험 환경의 Ctrl+V는 붙여넣기가 아니라 `16` 제어 바이트를 전송하므로 사용하지 않는다. UserOwned에서 본문 UTF-8 바이트가 정확히 일치하고 AgentOwned에는 없어야 한다. 서버가 bracketed paste를 켠 경우 본문 앞 `1b5b3230307e`, 뒤 `1b5b3230317e`는 정상 프레이밍이며 기대값에 포함한다. JS paste 호출은 인정하지 않는다. |
| `ime-commit` | 한글 IME로 `한글`을 조합·확정한다. 완성 UTF-8과 중복/누락 여부를 확인한다. AgentOwned의 시도는 서버에 없어야 한다. |
| `ime-reclaim-mid-composition` | ‘조합 중 전환 예약’을 누르고 한글 조합을 시작해 1초 이상 유지한다. 0.5초 후 AgentOwned→UserOwned가 된다. 이전 조합 확정은 서버에 없어야 한다. 새로 시작한 조합은 별도 구간에서 정상 동작해야 한다. 예약 버튼은 조합 시작에 반응하며 키 입력을 생성하지 않는다. |
| `mouse` | 준비 단계에서 `printf '\033[?1000h\033[?1006h'`로 마우스 보고를 켠다. 특정 셀을 실제로 눌렀다 놓고, 화면 좌표와 SGR mouse 바이트를 비교한다. AgentOwned에서는 없어야 한다. 이후 준비 단계에서 `printf '\033[?1000l\033[?1006l'`로 끈다. |
| `hidden-restore` | 숨기기/복귀 버튼으로 터미널을 숨겼다가 다시 표시한다. 기존 내용·커서가 유지되고 새 입력의 대상과 소유 상태가 맞는지 확인한다. |
| `minimize-restore` | Windows 창 최소화 후 작업 표시줄에서 복귀한다. 커서·내용·입력 대상·소유 상태와 기록된 PTY 크기를 확인한다. |
| `dpi-100` | Windows 디스플레이 배율 100%에서 창 크기를 바꾸고 `stty size`의 결과, 기록의 마지막 sizes, 화면 열·행을 비교한다. 잘림·빈 영역·반복 resize 여부도 본다. |
| `dpi-150` | 위 시험을 실제 150%에서 반복한다. 브라우저 zoom으로 대체하지 않는다. |
| `dpi-200` | 위 시험을 실제 200%에서 반복한다. 시험 후 배율 복구는 사용자가 한다. |
| `interactive-vi` | 한 vi 세션에서 UserOwned의 `vi` Enter `i` + `BATON_EDITOR_TEST`와 resize를 기록한다. 두 번째 구간은 AgentOwned 편집 키 차단이다. 회수 후 세 번째 UserOwned 구간에서 Esc `:q!` Enter와 셸 복귀를 기록한다. 서로 다른 실행의 편집·종료를 합치지 않는다. |
| `interactive-top` | 실제 키로 `top` 실행, 창 크기 변경, 프로그램 종료 후 셸 복귀를 확인한다. AgentOwned에서 누른 종료 키는 전달되지 않아야 한다. |
| `webview-descendant-exit` | 종료 시점의 실제 소유 상태·시각·동작을 기록하고 관측 종료를 누른다. `process.json`의 normalExit=true, forcedCleanup=false, descendantAudit=verified, 자손 exited=true를 확인한다. 빈 입력 레코드 두 개로 양 상태의 종료를 주장하지 않는다. |

`sizes`는 중계 서버가 받은 PTY 크기 이력이다. 전체화면 프로그램에서 서버가 다시 그린 문서는 새 서버 출력이며, 전달 후 재출력된 텍스트가 공개 구간에 들어갈 수 있다. 서버의 `nohup`·분리 세션·백그라운드 작업까지 종료된다는 보장은 하지 않는다.

## 여러 실행의 관측 제출 (schemaVersion 2)

`node rust/tests/phase2/record-manual.mjs --collection <selection.json> <새 collection.json>`을 사용한다. 출력이 이미 있으면 덮어쓰지 않고 거부한다. 필수 관측 미확인은 exit 2, 잘못된 증거는 exit 1이다. 수집기는 승인·실제 관측을 대신 생성하지 않는다.

selection에는 다음을 넣는다.

- `schemaVersion: 2`, 기준 자동 실행의 `identity`, `baseline: {path, sha256}`.
- `runs`: 원본 `id`, 해시를 가진 `metadata`, `raw`(observations.jsonl), 종료 판정에 필요한 `process` 파일 참조.
- `cases`: `id`, `operator: {kind: human|native, name, statement}`, 화면·설명의 해시를 가진 `evidence`, `observations: [{runId, caseId, mode, observedUtc, expectedHex}]`.
- IME 회수는 같은 실행에서 이전 조합 차단 → 새 `한글`+Space 수신 순서와 `transition: {beforeEpoch, afterEpoch}`를 요구한다. 차이는 2다. vi는 같은 실행의 편집 → 차단 → 회수 후 종료 순서와 `interactive: {shellReturned: true, finalText: "BATON_EDITOR_TEST"}`를 요구한다. 화면·resize·셸 복귀는 관측자가 확인한다.
- 정상 종료는 `lifecycle: {runId, mode, observedUtc, trigger}`와 프로세스 증거를 사용한다. 타임아웃 실행의 유효 입력은 사용할 수 있지만 정상 종료로 인정하지 않는다.
- `deferred`: 승인된 DPI 항목별 `{id, approvedBy, approvedUtc, reason, due: "before-windows-release"}`. 요약 ID만 저장하면 승인 근거가 없어 거부된다.

실행 파일·lock은 반드시 일치해야 한다. source inventory 차이는 수집기 전용 5개 파일만 허용하며 변경 목록을 보고한다. 원본 결과를 수정하지 말고 자동 summary 사본에 `node rust/tests/phase2/validate-run.mjs <summary 사본> <collection.json>`을 실행한다. 이 명령은 지정한 summary를 갱신한다. 현재의 실제 예시는 `artifacts/rust-phase-2/reconciliation-20261007/current-selection.json`과 `current-collection-v2.json`이다.

## 기존 단일 실행 제출 (이력·호환용)

`MANUAL_RUN` 안의 `observations.jsonl`에는 서버 관측만 들어간다. 이를 읽고 사용자 판정을 별도 `observations-user.json`에 적는다. 수신값을 무조건 기대값으로 복사하지 말고 실제로 하려던 조작의 바이트와 비교한다. `expectedHex`는 공백 없는 소문자 hex이며 차단 기대값은 `""`이다.

```json
{
  "cases": [
    {
      "id": "physical-key",
      "confirmedBy": "실제 관측자 이름",
      "screenshots": ["physical-key-user.png", "physical-key-agent.png"],
      "userExpectedHex": "41",
      "agentExpectedHex": ""
    }
  ]
}
```

나머지 case도 같은 형식으로 추가한다. 텍스트의 UTF-8 hex는 `[Convert]::ToHexString([Text.Encoding]::UTF8.GetBytes('시험 문자열')).ToLowerInvariant()`로 계산할 수 있다. Enter/ESC/마우스 등 제어 바이트는 실제 조작 순서에 맞춰 별도로 포함한다. 화면 경로는 `MANUAL_RUN` 기준 또는 절대 경로다.

```powershell
pwsh -NoProfile -File rust/scripts/record-phase-2-manual.ps1 `
  -RunDirectory '<MANUAL_RUN>' -Observations '<observations-user.json>'
```

이 도구는 기록·해시·사용자 확인을 검증하고 수신 바이트와 기대값이 맞는지 검사한다. 누락은 exit 2, 오래된 소스/파일 누락/바이트 불일치는 exit 1이다. 성공값이나 사용자 이름을 자동 작성하지 않는다. 완성된 `manual-evidence.json`을 `verify-phase-2.ps1 -ManualEvidence '<경로>'`에 제공해 자동 검사와 함께 검증한다. 코드나 실행 파일이 바뀌면 기존 증거는 재사용할 수 없다.

## 2026-10-05 검증된 빌드로 시작

아래 명령은 현재 자동 검증을 통과한 빌드에 대응한다. 코드를 변경했다면 앞의 전체 검증 절차로 새 receipt를 만들어야 한다.

```powershell
Set-Location '<저장소 루트>'
pwsh -NoProfile -File rust/scripts/test-phase-2-manual.ps1 -Verification 'artifacts/rust-phase-2/20261004T215359-4233aa2a57584dcc96c8aba1cf294f58/summary.json'
```

제품 실행 파일: `<저장소 루트>\rust\target\debug\baton.exe`.
관측 도구 실행 파일: `<저장소 루트>\rust\target\debug\baton-ui-acceptance.exe`. 위 스크립트가 필요한 시험 서버와 관측 도구를 함께 시작한다.
