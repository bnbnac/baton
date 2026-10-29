# Baton

## ⚠️ Rust 개인 사용판 — 알려진 문제와 미검증 범위

**현재 Rust 버전은 개인 사용을 위한 시험판입니다. 정식 출시 인수 완료나 모든 환경의 안정성을 보장하지 않습니다.** 개인 사용을 시작하기 위해 정식 출시 검증 전체를 기다릴 필요는 없지만, 아래 한계는 남아 있습니다.

| 항목 | 현재 상태와 사용 시 주의점 |
|---|---|
| **제어권 표시가 과거 상태로 돌아갈 수 있음** | 10월 29일 정적 검토에서 동시 세션 알림의 순서 역전 경합을 확인했습니다. 실제 에이전트 제어 상태인데 사용자 제어로 표시되거나 회수 버튼이 사라질 수 있습니다. 코어의 옛 권한 거부와 별개인 UI 문제이며 아직 수정·재현 시험 전입니다. [PR 검토 기록](docs/testing/rust-pr-readiness-review.md)을 참고하세요. |
| **간헐적 IPC 초기화 실패** | 과거 두 실패의 원인이 미확정입니다. 이후 관련 시험은 통과했지만 해결 증거는 아닙니다. 실패하면 발생 시각·실행 파일·오류를 보존하세요. 상세 진단 보강은 시험 코드에 적용됐으며 배포 앱이 같은 정보를 자동 기록하지는 않습니다. |
| **메모리 증가 이력** | 이전 2시간 시험에서 private +39.87%, working set +25.77%가 관측됐고 단일 원인은 미확정입니다. 후속 고정 UI·자동 전환 시험은 각 조건에서 통과했습니다. 현재 계속 실패한다거나 누수가 완전히 해결됐다는 뜻은 아닙니다. |
| **실사용 환경 검증 미완료** | 물리 한글 IME·배율·지원 하네스 조합·깨끗한 Windows/다른 사용자 환경의 전체 인수는 끝나지 않았습니다. 먼저 본인이 쓰는 환경과 작업이 없는 SSH 세션으로 확인하세요. |
| **명령 승인·복구 한계** | Baton은 명령 승인 엔진이 아닙니다. 에이전트에게 전달한 셸에서 모델 지침만으로 위험한 명령이나 sudo를 강제 차단하지 않습니다. 회수는 이미 실행된 명령을 되돌리지 않으며, 종료가 모든 원격 백그라운드 작업의 종료를 보장하지 않습니다. |
| **잔여 검증** | 입력면 4종의 30분 퍼징은 미실행이고 재접속 ID 재사용 변이 시험 증거는 아직 확인되지 않았습니다. |

**Rust 실행은 [개인 사용 안내](docs/rust-personal-use.md)를 따르세요.** 최신 검증 앱·어댑터를 묶은 로컬 패키지와 짧은 점검 절차를 안내합니다. 아래의 `artifacts/Baton`, .NET 빌드 및 되돌릴 수 없는 전달 설명은 **기존 C# MVP**에 대한 것으로 Rust 버전과 혼용하면 안 됩니다.

근거: [초기화 조사](docs/testing/rust-startup-followup-report.md) · [메모리 원래 실패](docs/testing/rust-phase-5-soak-report.md) · [후속 A/B 통과](docs/testing/rust-attached-memory-comparison.md) · [개인 사용 우선순위와 잔여 검증](docs/testing/rust-phase-5-acceptance-gap-audit.md).

## 기존 C# MVP 안내

Windows 사용자가 직접 연결·인증한 Linux SSH 셸을 Claude Desktop 또는 Codex에 MCP 도구로 전달하는 데스크톱 MVP입니다.

앱이 SSH 세션을 소유합니다. 각 stdio MCP 어댑터는 사용자에게 배정받은 셸 하나만 조작합니다. 자체 AI/채팅/명령 승인 UI/영구 입출력 로그는 없습니다.

## 실행

배포 폴더 `artifacts/Baton` 전체를 보관하고 `app/Baton.exe`를 실행합니다. self-contained 배포에는 .NET 런타임이 포함됩니다. Windows x64, 일반 사용자 권한으로 실행하세요. PowerShell·Git Bash·별도 SSH 실행 파일·Node.js는 앱 실행에 필요하지 않습니다.

1. 앱을 먼저 실행합니다.
2. [하네스 설정 안내](docs/harness-setup.md)에 따라 같은 Windows 사용자로 Claude Desktop/Codex의 Baton MCP를 시작합니다.
3. **새 SSH 세션**에서 host/port/user와 인증 방법을 선택합니다.
4. 비밀번호/개인키 암호/MFA를 직접 입력하고, 신뢰할 수 있는 경로로 받은 SHA256 서버 지문과 대조하여 호스트키를 확인합니다. 호스트키 승인은 해당 접속에만 적용됩니다.
5. 입력란과 **전송 + Enter**, 제어 키로 일반 사용자 셸을 준비합니다. 필요하다면 전달 전에 사용자 본인이 `sudo -v` 등 인증 준비를 할 수 있습니다. 숨김 입력은 이 사용자 소유 단계에서만 사용할 수 있습니다.
6. 대상 MCP 연결의 이름과 연결 ID를 확인하고 **에이전트에 전달**을 누릅니다. 이 동작은 되돌릴 수 없습니다. 화면이 초기화되고 공개 출력 커서가 0에서 시작합니다.
7. 이후에는 출력을 관찰하거나 **SSH 연결 종료**만 합니다. 직접 작업하려면 별도 SSH 세션을 만드세요.

MCP 연결이 끝나면 소유 SSH 세션도 끝납니다. 앱 재실행이나 네트워크 단절 시 자동 재접속하지 않습니다. 새로운 접속에는 새로운 세션 ID를 사용합니다. 종료가 원격 작업의 rollback이나 모든 백그라운드 프로세스 종료를 보장하지는 않습니다.

## 개발·빌드

- .NET 10 SDK, Windows x64.
- Node.js 22+와 npm은 로컬 SSH 시험 서버를 실행하는 **테스트에만** 필요합니다.
- 프로젝트 의존성은 NuGet.Config와 각 `packages.lock.json`, `package-lock.json`에 기록합니다.

명령 프롬프트 또는 IDE 터미널에서:

```bat
build.cmd
build.cmd test
build.cmd publish
```

`build.cmd`는 프로젝트 내부 `.buildhome`/`.packages`에 개발 도구 캐시를 만듭니다. `test`는 합성 SSH fixture를 사용하며 실제 Linux 셸을 실행하지 않습니다. `publish` 결과:

```text
artifacts/Baton/app/Baton.exe
artifacts/Baton/adapter/Baton.Adapter.exe
```

Docker Linux 엔진이 있다면 PowerShell의 `./scripts/test-linux-ssh.ps1`로 실제 OpenSSH/bash PTY 통합 시험을 별도로 실행할 수 있습니다. 배포본 수명 검증은 `node scripts/test-app-lifecycle.mjs`입니다. 실제 수행 결과와 하네스 검증 범위는 [검증 문서](docs/verification.md)에 기록했습니다.

설치 프로그램, 코드 서명, 자동 업데이트는 제공하지 않습니다. 폴더 배포이며 exe 옆 DLL들을 함께 배포해야 합니다. 사용자의 하네스 설정 파일은 자동 수정하지 않습니다.

## 제공 도구

| 도구 | 계약 |
|---|---|
| `status` | 현재 어댑터 연결에 배정된 세션 ID와 상태. 미배정이면 앱에서 전달해야 함 |
| `read_output` | 전달 이후 UTF-8 출력의 비소비적 커서 조회. 문자열은 원격 ANSI 제어 문자를 포함할 수 있음 |
| `send_text` | 정확한 텍스트를 전송. Enter를 추가하거나 명령을 재작성하지 않음 |
| `send_key` | Enter, Ctrl+C 등의 제어 키를 전송 |

커서는 공개 문자열의 절대 UTF-16 코드 단위 위치입니다. 출력 1 Mi 단위, 조회 최대 32 Ki 단위, 대기 최대 10초. `cursor_expired`일 때 `oldest_cursor`에서 재개합니다. `next_cursor`, `end_cursor`, `has_more`를 확인하세요. read timeout은 원격 작업 완료가 아닙니다.

텍스트 입력 최대 UTF-8 16 KiB, 세션별 입력 큐 32건. 매 실행마다 고유 `request_id`를 사용합니다. 같은 ID와 내용은 기존 결과만 반환하며 재전송하지 않습니다. 같은 ID로 다른 내용은 거부합니다. 중복 이력은 세션당 4096개까지 유지하며 소진 시 새 세션이 필요합니다. `delivered`는 채널에 전달했다는 의미이고 원격 명령 성공이 아닙니다. `uncertain`이면 자동 재시도하지 마세요.

## 범위와 문서

- [설계와 기술 비교](docs/design.md)
- [Claude Desktop / Codex 연결](docs/harness-setup.md)
- [에이전트 및 sudo 사용 지침](docs/agent-guide.md)
- [검증 결과와 알려진 한계](docs/verification.md)
- [1차 수동 테스트 및 서버 종료 검토](docs/testing/2026-09-16-acceptance-report.md)
- [구현 순서](docs/implementation-plan.md)

OpenSSH config, ssh-agent, ProxyJump, 하드웨어 보안키, SFTP는 미지원입니다. UI는 VT를 해석한 단색 텍스트 화면입니다. 일반 명령/로그 관찰을 목표로 하며 vim/top 등 전체 화면 앱의 안정적 조작을 보장하지 않습니다.

작업 입출력은 앱 파일/로그에 저장하지 않습니다. `%LOCALAPPDATA%/Baton`에는 사용자 전용 ACL과 DPAPI로 보호한 로컬 IPC 발견 정보 및 앱 잠금 파일만 만듭니다. 하네스가 MCP 결과를 대화 기록으로 보관하는 것은 Baton 통제 밖입니다. 같은 Windows 사용자 권한의 다른 프로그램이나 OS pagefile/crash dump까지 격리하는 제품은 아닙니다.
