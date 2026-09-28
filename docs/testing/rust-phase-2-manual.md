# Phase 2 Windows 물리 인수

자동 시험과 별도인 **미확인 항목**이다. 스크립트나 `term.input()`으로 입력한 결과를 물리 키보드·붙여넣기·IME 통과로 기록하지 않는다. 제품 실행 파일은 `rust/target/debug/baton.exe`, 시험 전용 실행 파일은 `rust/target/debug/baton-ui-acceptance.exe`이다. 전달/회수 버튼은 시험 앱에만 있다.

## 시작

작업 폴더는 `C:\Users\sj\Documents\work\code\baton\.worktrees\rust-phase-0`이다. PowerShell 7, Node, Docker Desktop과 빌드된 두 실행 파일이 필요하다.

1. `pwsh -NoProfile -File rust/scripts/verify-phase-2.ps1`을 실행한다. 자동 검사 통과·수동 미확인은 **exit 2 / manual_pending**이다. 출력의 `PHASE_2_RECEIPT` 경로를 사용한다.
2. `pwsh -NoProfile -File rust/scripts/test-phase-2-manual.ps1 -Verification '<summary.json 절대 경로>'`를 실행한다. 현재 소스·lock·실행 파일 해시가 다르면 시작을 거부한다.
3. `MANUAL_RUN` 디렉터리를 기록한다. 임시 OpenSSH 컨테이너와 loopback 중계 서버만 사용한다. 중계 서버가 SSH로 실제 수신한 입력 바이트를 기록하고 OpenSSH PTY에 전달한다. 실제 홈서버에는 접속하지 않는다.
4. 앱에서 case를 선택하고 소유 상태를 지정한다. **구간 시작 → 실제 조작 → 출력 안정 확인 → 수신 기록** 순서로 수행한다. 각 case를 UserOwned와 AgentOwned에서 각각 기록한다. 같은 case/mode를 다시 기록하면 기록 수집기는 마지막 구간을 선택한다.
5. 화면은 Windows 캡처 도구로 직접 저장한다. 앱 표시, 관측 시각, DPI 시험의 실제 Windows 배율을 함께 확인한다. 캡처에 개인 알림 등이 들어가지 않게 한다.
6. 마지막에는 **관측 종료** 버튼으로 끝낸다. 기본 30분 제한을 초과하거나 실행기를 강제 종료한 실행은 정상 종료 증거가 아니다. 컨테이너 정리 결과와 앱/WebView 자손 종료 결과를 확인한다.

일반 셸 준비 명령과 이전 시험의 미완성 입력 정리는 **구간 시작 전**에 한다. 예를 들어 Ctrl+U로 이전 입력을 지울 수 있다. 입력을 기록하는 fixture이므로 실제 비밀번호나 개인 데이터는 입력하지 않는다.

## 필수 관측

| ID | 실제 조작과 확인 |
|---|---|
| `physical-key` | 영문 `A`를 직접 누른다. UserOwned 수신은 `41`, AgentOwned는 빈 문자열이어야 한다. Enter 없이 수행하면 셸 명령이 실행되지 않는다. |
| `physical-paste` | 시험 문자열 `BATON_PASTE 한글 😀`를 OS 클립보드에서 Ctrl+V로 붙여넣는다. UserOwned의 UTF-8 바이트가 정확히 일치하고 AgentOwned에는 없어야 한다. JS paste 호출은 인정하지 않는다. |
| `ime-commit` | 한글 IME로 `한글`을 조합·확정한다. 완성 UTF-8과 중복/누락 여부를 확인한다. AgentOwned의 시도는 서버에 없어야 한다. |
| `ime-reclaim-mid-composition` | ‘조합 중 전환 예약’을 누르고 한글 조합을 시작해 1초 이상 유지한다. 0.5초 후 AgentOwned→UserOwned가 된다. 이전 조합 확정은 서버에 없어야 한다. 새로 시작한 조합은 별도 구간에서 정상 동작해야 한다. 예약 버튼은 조합 시작에 반응하며 키 입력을 생성하지 않는다. |
| `mouse` | 준비 단계에서 `printf '\033[?1000h\033[?1006h'`로 마우스 보고를 켠다. 특정 셀을 실제로 눌렀다 놓고, 화면 좌표와 SGR mouse 바이트를 비교한다. AgentOwned에서는 없어야 한다. 이후 준비 단계에서 `printf '\033[?1000l\033[?1006l'`로 끈다. |
| `hidden-restore` | 숨기기/복귀 버튼으로 터미널을 숨겼다가 다시 표시한다. 기존 내용·커서가 유지되고 새 입력의 대상과 소유 상태가 맞는지 확인한다. |
| `minimize-restore` | Windows 창 최소화 후 작업 표시줄에서 복귀한다. 커서·내용·입력 대상·소유 상태와 기록된 PTY 크기를 확인한다. |
| `dpi-100` | Windows 디스플레이 배율 100%에서 창 크기를 바꾸고 `stty size`의 결과, 기록의 마지막 sizes, 화면 열·행을 비교한다. 잘림·빈 영역·반복 resize 여부도 본다. |
| `dpi-150` | 위 시험을 실제 150%에서 반복한다. 브라우저 zoom으로 대체하지 않는다. |
| `dpi-200` | 위 시험을 실제 200%에서 반복한다. 시험 후 배율 복구는 사용자가 한다. |
| `interactive-vi` | 실제 키로 `vi`, 입력 모드, `BATON_EDITOR_TEST`, Esc, 저장 없이 종료를 수행한다. 편집 중 창 크기도 바꾼다. AgentOwned에서는 편집 키가 서버에 전달되지 않아야 한다. 종료 조작은 UserOwned로 복귀한 뒤 구간 밖에서 한다. |
| `interactive-top` | 실제 키로 `top` 실행, 창 크기 변경, 프로그램 종료 후 셸 복귀를 확인한다. AgentOwned에서 누른 종료 키는 전달되지 않아야 한다. |
| `webview-descendant-exit` | 양 소유 상태의 기록을 남긴 뒤 관측 종료를 누른다. `result.json`의 `process`에서 normalExit=true, forcedCleanup=false, descendantAudit=verified, 자손 exited=true를 확인한다. 정상 종료와 강제 정리는 서로 대체하지 않는다. |

`sizes`는 중계 서버가 받은 PTY 크기 이력이다. 전체화면 프로그램에서 서버가 다시 그린 문서는 새 서버 출력이며, 전달 후 재출력된 텍스트가 공개 구간에 들어갈 수 있다. 서버의 `nohup`·분리 세션·백그라운드 작업까지 종료된다는 보장은 하지 않는다.

## 관측 기록 제출

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
