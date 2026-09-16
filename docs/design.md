# Baton MVP 설계

Windows 사용자가 직접 인증한 Linux PTY 셸 하나를 로컬 MCP 어댑터 연결 하나에 영구 배정한다. 에이전트·명령 승인 엔진·감사 시스템은 구현하지 않는다.

## 기술 비교와 결정

| 기준 | A: Windows OpenSSH + ConPTY | B: SSH.NET 원격 PTY 직접 연결 (선택) |
|---|---|---|
| 인증/MFA | OpenSSH 기본 흐름, 하드웨어 키·에이전트 호환성이 유리 | 비밀번호, 암호화 개인키, keyboard-interactive 다단계 MFA. 하드웨어 키/agent 제외 |
| SSH 설정 | 설정 파일 지원. ProxyCommand, LocalCommand, escape 및 forwarding 차단 검토 필요 | OpenSSH config/agent/ProxyJump 미지원. 명시적 host/port/user/key만 사용 |
| 전달 경계 | 인증 출력과 ConPTY parser, 로컬 escape, 자식 프로세스 생명주기까지 관리 | 네트워크 SSH 채널만 존재. 로컬 셸 fallback 없음 |
| Windows 패키징 | 절대 경로 ssh.exe 선택, ConPTY/Job Object 및 네이티브 의존성 | .NET WPF self-contained 배포. SSH 자식 프로세스 없음 |
| 유지보수 | 터미널 호환성은 좋지만 프로세스/옵션 경계가 복잡 | 프로토콜 라이브러리 유지보수 의존, 인증 UI 필요 |

앱은 .NET 10/WPF + SSH.NET 2026.0.0 + VtNetCore 1.0.30. 어댑터는 공식 ModelContextProtocol C# SDK 2.2.0. 별도 웹뷰/브라우저/로컬 셸을 실행하지 않는다. VtNetCore가 VT 파싱과 장치 응답을 담당하고 WPF는 텍스트 화면을 그린다. 색상/전체화면 앱의 완전한 지원은 목표가 아니다.

## 구성

`Claude Desktop / Codex ↔ stdio MCP ↔ Baton.Adapter ↔ 인증된 Windows named pipe ↔ Baton 앱 ↔ SSH.NET ↔ Linux PTY`

MCP는 표준 stdio 전송이고 named pipe는 내부 JSON 프레임 IPC다. 어댑터 연결 ID는 앱이 발급한다. 표시 이름은 신원 증명이 아니므로 UI에 연결 ID도 표시한다. 세션 ID는 인증 비밀이 아니다. named pipe는 CurrentUserOnly, 로컬 접속만 사용하고 앱 시작마다 새 비밀을 발급한다. 비밀 및 pipe 발견 정보만 사용자 전용 ACL + DPAPI CurrentUser로 저장한다. MCP에 비밀을 반환하지 않는다. 같은 Windows 사용자 권한의 악성 프로세스를 격리하는 제품은 아니다.

## 세션 계약

`Connecting → UserOwned → Transferring → AgentOwned → Closed`. 전달 중 새 사용자 입력을 거부하고 직렬 입력 큐의 미처리 항목은 세대 검증으로 폐기한다. 실행 중 입력이 마무리된 후 수신 큐를 배출하고 공개 UTF-8 decoder를 새로 만든다. UI VT parser도 초기화하여 전달 전 ANSI 상태를 이월하지 않는다. 이미 네트워크를 거친 지연 출력의 발생 시점까지 구별하지 못한다.

전달은 되돌릴 수 없다. 어댑터 하나당 셸 하나, 셸당 소유자 하나. 세션 종료/어댑터 단절/앱 종료 시 연결을 닫고 모든 메모리 화면·출력·중복 요청 기록을 폐기한다. 자동 재연결/재배정 없음. 새 연결은 새 UUID.

실제 SSH 입력 바로 앞에서 상태·연결 소유자·세션 ID·입력 세대를 재검사한다. 텍스트 16 KiB, 세션 입력 큐 32건. request_id + payload hash로 중복 구별. 같은 ID로 다른 내용은 거부. 보관 가능한 4096건을 넘으면 새 입력을 거부하여 오래된 ID가 재실행되지 않게 한다. 전송 결과는 delivered / uncertain이며 원격 명령 완료·성공·exit code가 아니다. uncertain이면 재전송하지 않는다.

## 출력과 터미널

공개 메모리 버퍼 1 Mi UTF-16 코드 단위, 조회당 최대 32 Ki 단위. 커서는 공개 문자열의 절대 UTF-16 위치이며 전달 직후 0. 오래된 커서는 cursor_expired와 oldest_cursor를 반환한다. 잘못된 미래 커서는 거부한다. 조회는 비소비적이며 next_cursor/end_cursor/has_more 제공. wait_ms 0–10000, 취소는 조회 대기만 취소한다. Ctrl+C는 ETX 전송이며 SSH 종료와 다르다. 무출력·프롬프트 문자로 완료/비밀번호/권한을 추론하지 않는다.

UI 화면은 제한된 VT 화면/스크롤백만 메모리에 유지한다. PTY는 120×32로 고정한다. VT 장치 자동 응답은 앱의 단일 parser만 생성하며 사용자 입력 API와 분리된 내부 경로로 직렬 전송한다. 전달 후 UI는 키보드·붙여넣기·IME·마우스 입력을 SSH로 보내지 못한다. 화면은 읽기 전용, 입력은 별도 명시적 입력란이다.

## 인증, 오류, 기록

사용자가 각 접속의 SHA256 호스트키 지문을 검토·확인한다(영구 known_hosts 저장소 없음). 비밀번호/키 암호/MFA 응답은 사용자 대화상자에서만 받고 저장하지 않는다. 라이브러리 인증 객체에 필요한 일시적 메모리는 연결 인증 후 참조를 해제한다. 관리형 런타임에서 문자열의 즉시 완전 소거는 보장하지 않는다.

출력·입력·원문 예외를 파일/진단 로그로 쓰지 않는다. 고정 오류 코드만 경계 밖으로 보낸다. 하네스가 MCP 결과를 대화 기록으로 저장하는 것은 Baton 통제 밖이다. OS pagefile/crash dump는 앱의 영구 로그와 별개다.

sudo의 정확한 명령/인자/목적을 기존 하네스 대화에서 매 실행 승인받고, 승인 후 sudo -n을 사용하도록 지침을 제공한다. 스크립트는 내용도 제시한다. cache/NOPASSWD와 무관하며 지속 root 셸 제외. 문자열 검사·자동 옵션 삽입·승인 UI·비밀번호 우회 경로 없음. sudo 실패 원인을 단정하지 않는다. 원격 백그라운드 작업의 종료/rollback을 보장하지 않는다.

## 공식 참고 자료

- [SSH.NET 인증·PTY API](https://github.com/sshnet/SSH.NET)
- [OpenSSH 설정/escape/로컬 명령](https://man.openbsd.org/ssh_config)
- [Windows ConPTY](https://learn.microsoft.com/en-us/windows/console/pseudoconsoles)
- [VtNetCore](https://github.com/darrenstarr/VtNetCore)
- [C# MCP SDK](https://github.com/modelcontextprotocol/csharp-sdk)
- [CurrentUserOnly](https://learn.microsoft.com/en-us/dotnet/api/system.io.pipes.pipeoptions)
- [Codex MCP](https://developers.openai.com/codex/mcp)
- [Claude Desktop 로컬 MCP](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
