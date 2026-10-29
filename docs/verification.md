# 검증 결과와 알려진 한계

> **C# MVP 과거 기록:** 현재 구현은 Rust입니다. 이 문서의 C# 명령·경로·계약은 `csharp-mvp-final` 태그 기준이며 현재 실행 안내로 사용하지 않습니다. [보존·복구 안내](legacy-csharp.md)와 [Rust 개인 사용 안내](rust-personal-use.md)를 참고하세요.

자동 검증 기준일: 2026-09-15. Windows x64(빌드 26200), .NET SDK 10.0.103, Node.js 22.17.0, Docker 29.2.0. 아래 표는 당시 자동 검증 결과다.

2026-09-16 추가: 사용자가 Claude Desktop과 실제 서버에서 1차 수동 테스트를 수행했다. 기본 명령, vi, 닫힌 세션 차단, sudo 실패/성공 흐름을 확인했고 sudo 지침과 연결 선택 UI의 개선점을 발견했다. 종료 시 서버 프로세스에 대해서는 동일 Core를 사용한 별도 Linux 시험에서 일반 셸/작업의 종료와 nohup+disown 작업의 생존을 확인했다. 자세한 근거·제약·미검증 범위는 [1차 테스트 및 서버 종료 보고서](testing/2026-09-16-acceptance-report.md)를 따른다.

## 수행한 검증

| 범위 | 결과와 검증 수준 |
|---|---|
| Release 테스트 | **49개 통과, 실패 0, 선택 Linux 테스트 1개 건너뜀** |
| 실제 Linux SSH | 선택 테스트 별도 실행: **1개 통과, 실패/건너뜀 0**. Docker Alpine/OpenSSH의 실제 bash PTY에 생산 코드로 연결 |
| 인증 | 합성 SSH 서버에서 비밀번호, keyboard-interactive, 비밀번호+추가 challenge, 암호화 PKCS8 개인키, 호스트키 거부. Linux OpenSSH에서는 비밀번호와 SHA256 확인 callback |
| Linux PTY | 비-root UID, 전달 전 출력 비공개, 실제 명령 입출력, sleep 중 Ctrl+C, 정상 exit, 시험 컨테이너 종료 후 단절 탐지 및 늦은 쓰기 거부 |
| 세션 | 소유 연결 격리, 중복 ID/내용 충돌, 불확실한 전송 재실행 방지, 대기 입력 무효화, 닫힌 세션 재사용 거부, 전달 경계 부분 UTF-8 초기화 |
| 출력/터미널 | 제한 버퍼, 오래된 커서와 재개 위치, 비소비 조회, 한글 최대 출력 페이지 IPC 전달, ANSI/UTF-8 분할, 단일 장치 응답, 스크롤백/제어 시퀀스 상한 |
| IPC | DPAPI 왕복, 앱 중복 실행 방지, 잘못된 연결 비밀 거부, 소유 연결별 상태, 동시 조회/입력, 취소/지연 취소, 요청 상한, 단절 정리 |
| 실제 stdio 어댑터 | SDK 어댑터 프로세스의 initialize/도구 4개/status/호출 흐름. 두 어댑터의 EOF/강제 종료가 각자 소유 세션만 닫는지 확인 |
| Codex 네이티브 | 설치된 **Codex Desktop/0.154.0-alpha.6.2**의 별도 app-server가 배포 어댑터의 네 도구 인식. 격리 CODEX_HOME 사용, 사용자 설정 변경/모델 턴/대화 생성 없음 |
| 배포 | `build.cmd publish` 성공. 앱/어댑터 Release 빌드 경고 0, 오류 0. win-x64 self-contained 폴더 생성 |
| 배포 UI | 실제 Baton.exe 시작 화면, 읽기 전용 터미널, 미연결 입력 비활성 상태를 화면·접근성 트리로 확인. 창 스타일 수정 후 재확인. 정상 종료 확인 |
| 비정상 종료 | 실제 배포 앱 강제 종료 → 어댑터 종료, 앱 재시작 → 새 DPAPI 발견 정보, 새 어댑터 초기화 및 EOF 정상 종료 |
| 기록/프로세스 | 생산 소스의 파일 쓰기는 IPC 발견 정보/잠금뿐. 터미널 원문 기록 및 로컬 프로세스 실행 경로 없음. stderr 고정 코드와 터미널 디버그 비활성 확인. 시험 프로세스/컨테이너/태그 정리 |

시험 계정/암호는 로컬 fixture 전용이다. 사용자 서버 계정이나 SSH 설정을 사용하지 않았다. 테스트의 출력 확인용 명령은 시험 코드에만 있으며 Baton이 사용자 명령에 확인 문자열을 자동 삽입하지 않는다.

## 재현

```bat
build.cmd test
build.cmd publish
node scripts/test-app-lifecycle.mjs
```

Docker Linux 엔진이 있다면 PowerShell에서 `./scripts/test-linux-ssh.ps1`을 실행한다. 이미지 패키지 다운로드가 필요하다. 스크립트는 loopback 임의 포트와 고유 소유 라벨의 컨테이너를 만들고 finally에서 자신이 만든 컨테이너/이미지 태그만 정리한다. PowerShell/Node/Docker는 이 개발 시험에만 필요하다.

기본 테스트는 `BATON_LINUX_SSH_PORT`가 없으면 Linux 항목을 명시적으로 건너뛴다. skip은 Linux 검증 통과를 의미하지 않는다. 별도 스크립트 실행 결과를 확인해야 한다.

Codex 검증은 먼저 앱을 `--endpoint-dir <절대 시험 경로>`로 실행하고 다음을 실행한다. 검증 후 앱은 직접 종료한다.

```text
node scripts/test-codex-mcp.mjs <codex.exe 절대 경로> <Baton.Adapter.exe 경로> <앱의 시험 endpoint 경로>
```

이는 도구 검색까지의 검증이다. 실제 Codex 대화에서 Linux 셸을 조작하는 전체 작업을 검증하지 않는다. 격리 설정과 로컬 프로토콜 스키마는 git에서 제외한 artifacts 아래에 남는다.

## 미검증 항목

- **Claude Desktop/Codex 및 Desktop/Claude Code CLI 동시 사용.** 사용자 실제 동시 연결 검증은 보류. Claude Desktop 단독 실연결은 2026-09-16 사용자 시험에서 확인했다.
- 실제 사용자 서버의 호스트키 대조, 인증 UI 비밀번호/개인키/MFA 전체 흐름과 서버별 PAM 정책. 인증 callback 시험과 GUI 인수 검증은 별개다.
- 전달 후 붙여넣기·IME·접근성 입력·마우스의 수동 회귀 시험. UI 입력은 비활성화하고 backend에서도 소유권을 별도로 검사하지만, 모든 입력 장치의 수동 검증을 마친 것은 아니다.
- 장시간 부하, 다른 Windows 버전/SSH 키 형식, 완전한 패킷 blackhole. sudo는 제한된 수동 시험에서 승인 대기를 확인했으나 모든 상황의 준수는 미검증이며 승인 명령의 -n 누락을 발견했다.

## 알려진 한계

- UI는 120×32 고정 PTY를 단색 텍스트로 표시한다. 입력란의 전송 + Enter는 줄 입력 방식이며 완전한 터미널이나 vim/top 조작을 보장하지 않는다.
- VtNetCore 1.0.30은 4바이트 UTF-8 문자(일부 이모지 등)의 화면 표시가 잘못될 수 있다. BMP 한글을 검증했고 MCP 공개 UTF-8 decoder는 UI와 독립적이다.
- normal/alternate 버퍼마다 스크롤백 1000행 제한. 스냅샷은 활성 버퍼 최대 1032행. 비정상적으로 긴 제어 시퀀스는 UI 화면/parser를 초기화하며 공개 원문 스트림은 별도다.
- 전달 때 이전 화면/스크롤백을 지운다. 전달 전에 발생했지만 전달 후 도착한 지연 출력을 완벽하게 구분하지 못한다.
- 관찰 가능한 소켓 종료/연결 실패는 닫힘으로 전환한다. 무응답 네트워크 탐지 시간은 라이브러리/OS에 의존하며 250ms 내 탐지를 보장하지 않는다.
- 종료는 원격 작업 rollback이나 모든 백그라운드 작업 종료를 보장하지 않는다. read 취소/timeout은 원격 작업 취소가 아니다.
- 관리형 문자열, OS pagefile/crash dump, 하네스 기록의 완전 소거를 보장하지 않는다. 같은 Windows 사용자 권한의 다른 프로그램을 격리하지 않는다.
- 설치 프로그램/서명/업데이트/자동 재접속, OpenSSH config/ssh-agent/ProxyJump/보안키/SFTP는 제공하지 않는다.
