# Baton 구현 순서

> **C# MVP 과거 기록:** 현재 구현은 Rust입니다. 이 문서의 C# 명령·경로·계약은 `csharp-mvp-final` 태그 기준이며 현재 실행 안내로 사용하지 않습니다. [보존·복구 안내](legacy-csharp.md)와 [Rust 개인 사용 안내](rust-personal-use.md)를 참고하세요.

요청에서 설계 후 구현 진행을 승인했으므로 이 세션에서 순서대로 실행한다.

- [x] 1. SSH 검증: SSH.NET으로 호스트키 확인, 비밀번호/keyboard-interactive, PTY와 raw 입출력을 로컬 시험 서버에서 검증한다. `tests/ssh-fixture.mjs`, `SshTransportTests.cs`, `SshTransport.cs`.
- [x] 2. 세션 계약: `OutputBuffer`, `TerminalScreen`, `ShellSession`, `SessionRegistry`를 구현한다. 전달 경계/소유권/중복/지연 입력/출력 상한/취소를 테스트 먼저 작성하여 검증한다.
- [x] 3. IPC: `PipeProtocol`, `LocalEndpoint`, `PipeBroker`, `PipeClient`로 CurrentUserOnly + DPAPI 인증, 독립 연결, 비동기 요청과 단절 정리를 구현·검증한다.
- [x] 4. MCP: `Baton.Adapter`에서 status/read_output/send_text/send_key만 등록하고 공통 instructions를 제공한다. 실제 SDK 클라이언트/stdio 프로세스로 도구와 취소, 연결 수명 검증.
- [x] 5. WPF: `MainWindow`, `ConnectionDialog`, `PromptDialog`로 세션 목록, 사용자 인증, 터미널, 소유 연결 선택/전달/종료를 연결한다. 앱 자체는 자식 프로세스를 만들지 않는다.
- [x] 6. 배포·검증: Release 빌드와 Windows x64 self-contained 폴더 배포. 실행/설정/sudo 안내 및 실제 수행한 테스트와 미검증 항목을 문서화한다.

검증 명령: `dotnet test tests/Baton.Tests --configfile NuGet.Config` 대신 restore를 먼저 명시적으로 실행한 다음 `dotnet test tests/Baton.Tests --no-restore`. WPF/어댑터 각각 Release build, publish. 서버 인증정보나 사용자 하네스 설정은 자동 변경하지 않는다.

구현/배포 단계는 완료했다. 실제 Claude Desktop 연결과 두 하네스 동시 운용을 포함한 미검증 인수 항목은 verification.md에 별도로 남긴다.
