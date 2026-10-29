# Rust Baton 실행과 MCP 연결

2026-10-09 Phase 4 기준 Windows 개발 빌드용 절차다. 현재 개인 사용 실행 파일은 [개인 사용 안내](rust-personal-use.md)의 경로를 사용한다. Rust 앱과 Rust 어댑터를 함께 사용하며 아래 debug 경로는 개발 빌드 예시다. C# 구현은 [보존 태그](legacy-csharp.md)에서만 관리한다.

## 1. 앱 실행

현재 작업 폴더에서 PowerShell로 실행한다.

```powershell
Set-Location 'C:\Users\sj\Documents\work\code\baton\.worktrees\rust-phase-0'
Start-Process -FilePath (Join-Path $PWD 'rust\target\debug\baton.exe')
```

왼쪽 **새 연결**에서 이름, 서버 주소, 포트, 사용자 이름과 인증 방법을 입력한다. 서버 신원 확인 화면의 지문을 확인하고 인증한다. 서버가 둘이면 각각 연결한다. 같은 서버에도 독립 셸을 여러 개 연결할 수 있다. 앱 전체 SSH 세션 상한은 16개다.

## 2. 하네스에 Rust 어댑터 등록

하네스의 MCP 설정에 아래 stdio 서버 항목을 추가한다. 이는 설정 예시이며 실제 사용자 설정을 자동 변경하지 않았다. 기존 `baton` 설정과 구분하려고 이름을 `baton-rust`로 쓴다.

```json
{
  "mcpServers": {
    "baton-rust": {
      "command": "C:\\Users\\sj\\Documents\\work\\code\\baton\\.worktrees\\rust-phase-0\\rust\\target\\debug\\baton-adapter.exe",
      "args": []
    }
  }
}
```

하네스마다 설정 파일 위치와 서버 재시작 방법은 다르다. 기존 설정의 다른 서버 항목은 유지한다. 어댑터는 터미널에서 대화형으로 조작하는 프로그램이 아니라 하네스가 시작하는 stdio MCP 서버다.

**앱과 어댑터의 시작 순서는 상관없다.** 앱이 없거나 종료되면 MCP 초기화·도구 목록·상태 조회는 유지되고 상태는 offline이다. 앱을 켜면 어댑터가 자동으로 다시 발견하고 인증한다. 재시도 간격은 약 1→2→4→최대 5초이며 각 접속 시도는 3초 제한이다. MCP 초기화 직후에는 인증이 끝나지 않아 잠깐 offline일 수 있다.

재연결 후에는 새 연결 ID가 생기고 미배정 상태가 된다. 사용자가 앱에서 새 연결을 골라 셸을 다시 전달해야 한다. 이전 명령·SSH 연결·세션 배정·출력은 복원하거나 재전송하지 않는다. 인증 실패와 버전 불일치는 offline과 구별해서 표시한다. 하네스가 어댑터 자체를 종료했다면 해당 MCP 서버를 다시 시작해야 한다.

기본 발견 위치는 `%LOCALAPPDATA%\BatonRust\v2\endpoint.bin`이다. 파일은 사용자 전용 ACL과 DPAPI로 보호된다. 일반 사용 시 별도 환경변수나 파일 편집은 필요 없다. `BATON_RUST_ENDPOINT_DIR`은 격리 시험용 경로를 지정할 때만 사용하며 인증 검사를 해제하지 않는다.

## 3. 세션 전달·회수

1. 하네스에 “Baton status만 호출해서 연결 ID와 상태를 보여줘. 아직 명령은 실행하지 마.”라고 요청한다.
2. 앱에서 전달할 SSH 세션을 선택하고 **MCP 연결 선택**에서 그 연결을 고른다. 화면에는 ID 앞 12자리가 보인다. 전달 후 **연결 ID 복사**로 전체 ID를 대조할 수 있다.
3. **에이전트에 전달**을 누른다. 에이전트 제어 상태에서 사용자 터미널 입력은 차단된다. 해당 연결에만 세션이 보인다.
4. 여러 셸이 필요하면 같은 연결에 추가로 전달한다. 별도 어댑터 프로세스에는 다른 연결 ID가 생긴다. 대화 격리는 별도 연결/프로세스를 배정해야 한다. 하나의 MCP 연결을 공유하는 대화를 Baton이 구별하지는 않는다.
5. **내가 제어하기**로 회수한다. 회수 중 입력은 차단되고, 완료 후 사용자 입력이 가능하다. 연결 기록이 남아 있어도 에이전트 제어 권한이 유지된다는 뜻은 아니다.

이번 전달 이후의 출력만 MCP 공개 구간에 포함된다. 기존 화면·스크롤백은 앱에 남지만 자동 공유하지 않는다. 회수 중의 비공개 출력도 재전달 시 과거 기록으로 재생하지 않는다. 다만 서버 프로그램이 재전달 후 같은 내용을 **새 출력으로 다시 그리면** 새 공개 구간에 들어갈 수 있다.

에이전트의 **사용자 개입 요청**은 알림이다. 자동 회수나 명령 실행 승인이 아니다. **회수해서 처리** 또는 **요청 거절**을 사용한다. sudo 비밀번호는 하네스에 제공하지 않고 회수한 사용자 셸에서 직접 처리한다. 실제 모델 승인 흐름은 [별도 수동 시험](testing/rust-phase-3-manual.md)에 있다.

어댑터 연결 종료 시 그 연결이 제어하던 셸은 닫힌다. 이미 사용자에게 회수된 셸과 다른 연결의 셸은 유지된다. 앱 종료는 앱이 소유한 SSH 연결을 닫는다. 원격의 `nohup`, 서비스, 분리된 프로세스까지 모두 종료한다고 보장하지 않는다.

## 4. 빌드와 자동 검증

Phase 4의 명령·관측·제한은 [수명 검증 보고서](testing/rust-phase-4-report.md), 실제 하네스에서 확인할 순서는 [수동 절차](testing/rust-phase-4-manual.md)를 따른다. 아래 Phase 3 실행기는 현재 코드의 공통 회귀 검증에도 사용할 수 있으나, 그것만으로 실제 하네스 인수를 완료했다고 판단하지 않는다.

이미 검증된 실행 파일이 있으면 매번 빌드할 필요가 없다. 소스를 변경한 뒤 전체 Phase 3 검증이 필요할 때만 실행한다. Rust stable 1.88.0, Node 22.17.0, 설치된 프런트엔드 의존성과 Windows 빌드 도구/WebView2를 사용한 기록은 [인수 보고서](testing/rust-phase-3-report.md)에 있다. runner는 Cargo offline 모드이므로 의존성이 먼저 준비되어 있어야 한다.

```powershell
Set-Location 'C:\Users\sj\Documents\work\code\baton\.worktrees\rust-phase-0'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\rust\scripts\verify-phase-3.ps1
```

이 스크립트는 Windows PowerShell 5에서 실행해도 설치된 PowerShell 7을 찾아 다시 실행한다. `pwsh`가 PATH에 없어도 `C:\Program Files\PowerShell\7\pwsh.exe`와 현재 Codex 번들 경로를 확인한다. 찾지 못하면 절대 경로 안내와 함께 중단한다. 이 PC에서 직접 지정하려면:

```powershell
& 'C:\Users\sj\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe' -NoProfile -File .\rust\scripts\verify-phase-3.ps1
```

완료 시 `PHASE_3_RECEIPT` 뒤의 `summary.json`을 확인한다. `automated_passed_manual_pending`은 자동 시험 통과이며 실제 모델 시험까지 완료했다는 뜻은 아니다. 로그, 실행 파일/PDB, 프런트엔드, lock과 소스·환경 지문은 실행별 `artifacts/rust-phase-3/` 폴더에 보존한다. 시험은 로컬 SSH fixture를 사용한다.

문서 또는 허용된 수집기 파일만 수정했다면 기존 증거를 새 receipt에서 재검증할 수 있다. 제품 소스·시험 시나리오·환경이 바뀌면 이 경로는 거부된다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\rust\scripts\verify-phase-3.ps1 -ReuseEvidence 'artifacts\rust-phase-3\<기존 실행 ID>\summary.json'
```

수집기 로직을 바꿨다면 해당 수집기 시험도 별도로 실행한다. 이 재사용 명령은 제품을 빌드하거나 GUI 시험을 반복하지 않으며 원본 receipt를 덮어쓰지 않는다. Phase 2의 DPI 보류와 기존 엄격 gate 결과도 바꾸지 않는다.
