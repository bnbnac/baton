# 같은 Windows 컴퓨터의 MCP 연결

> **C# MVP 과거 기록:** 현재 구현은 Rust입니다. 이 문서의 C# 명령·경로·계약은 `csharp-mvp-final` 태그 기준이며 현재 실행 안내로 사용하지 않습니다. [보존·복구 안내](legacy-csharp.md)와 [Rust 개인 사용 안내](rust-personal-use.md)를 참고하세요.

앱을 먼저 실행하고, 하네스가 `Baton.Adapter.exe`를 stdio 서버로 실행하도록 설정한다. 두 하네스는 동일한 어댑터 바이너리를 사용한다. 앱 내부 named pipe 주소나 인증 비밀은 MCP 설정에 넣지 않는다.

아래 `C:\Tools\Baton`은 예시 **설치 폴더**다. 실제 배포 폴더의 절대 경로로 바꿔야 한다. 앱과 어댑터를 같은 Windows 사용자 및 같은 비관리자 권한으로 실행한다. Windows 네이티브 어댑터와 Windows named pipe를 사용하므로 WSL 내부 MCP 설정은 이 MVP 범위 밖이다.

## Claude Desktop

Claude Desktop의 **Settings → Developer → Edit Config**에서 Windows 설정 파일 `%APPDATA%\Claude\claude_desktop_config.json`의 기존 `mcpServers` 항목에 병합한다. 기존 설정 전체를 덮어쓰지 않는다.

```json
{
  "mcpServers": {
    "baton": {
      "command": "C:\\Tools\\Baton\\adapter\\Baton.Adapter.exe",
      "args": ["--label", "Claude Desktop"]
    }
  }
}
```

Claude Desktop을 완전히 종료 후 재시작하여 MCP 도구 상태를 확인한다. Baton 앱의 대상 연결 목록에서 `Claude Desktop`과 연결 ID를 확인한 뒤 SSH 세션을 전달한다. 이 연결은 로컬 stdio 연결이며 Claude 웹의 remote connector 설정이 아니다. ([MCP 공식 로컬 연결 안내](https://modelcontextprotocol.io/docs/develop/connect-local-servers), [Claude 로컬 MCP 안내](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop))

## Codex

사용자 설정 `%USERPROFILE%\.codex\config.toml`에 추가한다. 사용자 지정 CODEX_HOME을 사용 중이면 그 위치의 `config.toml`을 편집한다.

```toml
[mcp_servers.baton]
command = 'C:\Tools\Baton\adapter\Baton.Adapter.exe'
args = ['--label', 'Codex']
startup_timeout_sec = 15
tool_timeout_sec = 30
```

Codex에서 MCP 설정을 다시 로드하거나 앱을 재시작한다. `status` 도구로 `unassigned` 상태를 확인하고 Baton에서 해당 `Codex` 연결 ID에 새 SSH 세션을 전달한다. Codex는 `command`/`args`로 stdio MCP 서버를 구성한다. ([OpenAI 공식 MCP 설정](https://developers.openai.com/codex/mcp))

## 함께 사용하기

두 어댑터 연결은 별도 연결 ID를 가진다. Claude Desktop용 SSH 세션 A와 Codex용 SSH 세션 B를 각각 만들고 전달한다. 같은 셸을 두 하네스에 전달할 수 없다. 표시 이름은 설정에서 제공한 라벨이며 인증된 하네스 신원 증명이 아니다. 같은 라벨의 어댑터가 여러 개라면 연결 ID로 구별한다.

대화별 신원을 구별하지 않는다. 하네스가 여러 대화에서 하나의 MCP 프로세스를 공유하면 그 대화들도 동일 어댑터 세션을 사용하는 구조이므로, 전용 작업 흐름에서 사용한다.

앱 종료 후에는 기존 어댑터가 자동 재접속하지 않는다. 앱을 다시 실행하고 하네스의 MCP 연결도 다시 시작해야 한다. 하나의 SSH 세션만 종료한 경우, 사용자가 새 세션을 직접 같은 대기 연결에 다시 전달할 수 있다. 새 세션 ID를 `status`로 다시 확인해야 한다.

하네스의 사용자 지침에 [agent-guide.md](agent-guide.md)를 추가한다. 서버 instructions와 도구 설명에도 sudo 정책을 넣지만, 하네스 자체 도구 승인 설정을 변경하거나 승인을 대신하지 않는다.

## 연결 문제

- 앱 먼저 실행, exe 절대 경로와 DLL 배포 폴더를 확인한다.
- 앱·하네스의 Windows 사용자/권한 수준이 같은지 확인한다. 관리자 권한으로 실행하지 않는다.
- `unassigned`는 연결 실패가 아니다. 앱에서 인증된 셸을 전달해야 한다.
- `session_closed`이면 이전 ID는 무효다. 새 세션과 새 명시적 전달이 필요하다.
- `endpoint_unavailable`/`connection_failed`면 앱이 실행 중인지 확인하고 MCP 어댑터를 다시 시작한다.
- 하네스 자체가 MCP 결과를 저장할 수 있다. 민감 출력의 하네스 대화 기록 정책은 해당 하네스에서 관리한다.

실제 두 하네스의 설치·버전·연결 확인 여부는 [검증 결과](verification.md)를 확인한다. 설정 안내와 프로토콜 테스트만으로 실제 하네스 연결을 완료했다고 간주하지 않는다.
