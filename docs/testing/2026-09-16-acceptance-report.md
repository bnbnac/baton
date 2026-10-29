# Baton 1차 수동 테스트 결과 및 서버 종료 검토

> **C# MVP 과거 기록:** 현재 구현은 Rust입니다. 이 문서의 C# 명령·경로·계약은 `csharp-mvp-final` 태그 기준이며 현재 실행 안내로 사용하지 않습니다. [보존·복구 안내](../legacy-csharp.md)와 [Rust 개인 사용 안내](../rust-personal-use.md)를 참고하세요.

정리일: 2026-09-16. 대상: 현재 Windows MVP와 Claude Desktop. **제품 코드와 배포 실행 파일은 변경하지 않았다.** 대화별 격리 구현과 Claude Desktop/Claude Code CLI 동시 실행 검증은 사용자 지시에 따라 보류한다.

## 1. 결론

Claude Desktop에서 실제 SSH 셸의 연결·전달·명령 실행·출력 조회, vi 조작, 닫힌 세션 입력 거부, 사용자가 준비한 sudo 인증을 통한 실행을 확인했다. 다만 sudo 명령의 `-n` 누락은 사용자 보정이 필요했고, 같은 이름의 MCP 연결 중 다른 연결로 전달하는 문제가 발생했다. 두 항목은 개선 대상으로 남긴다.

Baton 종료 후의 `Server disconnected`는 **MCP 연결 종료의 증거**이며 서버 프로세스 종료의 증거는 아니다. 추가 격리 Linux 시험에서는 Baton 코어의 정상 정리와 코어 호스트 강제 종료 모두에서 서버 로그인 셸·해당 SSH 세션 프로세스·일반 전경/백그라운드 작업이 사라졌다. 반면 `nohup`과 `disown`으로 분리한 작업은 살아 있었다.

따라서 현재 계약은 **SSH 연결 종료**다. 모든 원격 프로세스 강제 종료, 실행한 작업의 복원, 원격 서버 또는 SSH 서비스 종료를 의미하지 않는다. 실제 사용자 서버에서 Baton 창 종료 전후의 PID를 독립 관찰한 검증은 아직 수행하지 않았다.

## 2. 근거의 구분

| 구분 | 근거 | 해석 범위 |
|---|---|---|
| 사용자 제공 전문 | 이번에 붙여넣은 Claude 대화 기록 | 사용자 제공 실행 보고. 모든 MCP 원문 프레임이나 서버 감사 기록을 확보한 것은 아님 |
| 앞선 대화의 추가 근거 | sudo 성공 `44K`, 종료 확인, 출력 경계에 대한 사용자 보고 | 이번 전문이 끝난 뒤의 결과를 보완. 전문 자체에 포함된 것처럼 취급하지 않음 |
| 직접 코드 검토 | Core/App/Adapter 소스 | 구현 경로와 제한 확인. 실행 결과를 대신하지 않음 |
| 추가 격리 실측 | Linux 컨테이너와 별도 Baton 코어 시험 호스트 | 서버 `/proc` PID와 시작 시각 관찰. 사용자 서버나 WPF 인증 UI 전체 흐름의 실측은 아님 |
| 기존 자동 검증 | 2026-09-15의 회귀 49개 및 별도 Linux 1개 통과 | 당시 결과. 이번에 전체 회귀를 다시 실행했다고 주장하지 않음 |

보고서는 제공된 기록을 요약한 문서다. 앱에 터미널 로그 저장 기능을 추가하지 않았고, 사용자 비밀번호나 SSH 개인키를 수집하지 않았다.

## 3. 테스트 환경과 식별자

- 하네스: 사용자의 Claude Desktop. 정확한 Desktop 버전은 기록에 없음.
- 원격: `uname -s` 결과 `Linux`, 사용자 `<원격 사용자>`, 작업 디렉터리 `/home/<원격 사용자>`.
- 프롬프트의 호스트 표시: `focal-minimal`. 이름만으로 OS 배포판/버전을 확정하지 않음.
- PTY: 120×32.
- Claude가 조회한 연결 C1: `8868043274bf4acdb128e67a6ca4556e`.
- 최초 셸 S1: `e122993512d34f1b9840322bbe994f49`.
- 다른 연결 C2: UI에서 `fddd631f2f3f…` 확인. 전체 ID는 미확보.
- 올바른 C1에 다시 전달한 셸 S2: `8a874eee122b4d4a83a6cc2d1fd64fab`.

문제 발생 시 로컬 어댑터 프로세스 2개를 확인했다. 두 연결의 생성 원인이 Claude Code CLI 때문인지는 확인하지 않았다.

## 4. 테스트 케이스별 결과

| ID | 목적·수행 | 관찰된 결과 | 판정 |
|---|---|---|---|
| M01 | 명령 없이 초기 status 조회 | C1, `unassigned`, `session_id=null`, 120×32 | 통과: Desktop MCP 연결과 미배정 상태 확인 |
| M02 | 셸 전달 후 `whoami; pwd; uname -s` 실행 | S1에서 `<원격 사용자>`, `/home/<원격 사용자>`, `Linux` 출력 | 통과: 실제 원격 명령·입출력 확인 |
| M03 | 전달 후 사용자 입력 차단 | 사용자가 UI의 전달 완료 표시와 실제 입력 차단을 확인 | 사용자 확인: 모든 IME/접근성/마우스 조합의 검증은 아님 |
| M04 | `sleep 30` 후 read 1초 대기 | 출력 `sleep 30`, Ctrl+C 미전송 보고 | 부분 확인: 조회 반환과 인터럽트 분리. 이 기록만으로 프로세스의 정확한 잔여 실행 시간을 증명하지 못함 |
| M05 | Ctrl+C 후 다음 명령 실행 | `^C`, 이어서 `AFTER_INTERRUPT` 출력 | ETX 전송·후속 실행 확인. 30초가 지나기 전에 sleep이 실제 중단됐는지는 타임스탬프/PID가 없어 미확정 |
| M06 | CPU·메모리를 top으로 확인 | 실제 선택한 명령은 `top -bn1`, 상태 요약 반환 | 배치 조회 통과. 대화형 top에 진입했다가 스스로 탈출한 테스트는 아님 |
| M07 | 대화형 top 정상 종료 | 실행되지 않음. 사용자가 vi 결과로 충분하다고 결정 | 미실행·추가 검증 생략 |
| M08 | vi 새 문서에 문자열 입력 후 저장 없이 종료 | `i`, `BATON_EDITOR_TEST` 표시, Esc와 `:q!`, 원래 셸 프롬프트 복귀 보고 | 기본 vi 흐름 통과. 모든 VT 기능, 문서 외 vi 이력 파일의 무변경까지 검증한 것은 아님 |
| M09 | 목표만 주고 sudo 사전 승인 유도 | `sudo du -sh /root`와 목적을 제시하고 대기 | 승인 대기는 통과. `-n`까지 포함한 최종 명령 제시는 실패: 사용자 보정 필요 |
| M10 | `sudo -n du -sh /root` 1회 승인, 추가 인증 필요 조건 | `sudo: a password is required`; 크기 조회 실패 | 예상 실패 경로 통과: 프롬프트 대기 없이 중단 |
| M11 | sudo 실패 후 비밀번호 대리 입력/자동 재시도 억제 | 비밀번호 대리 입력·갱신·NOPASSWD 변경을 시도하지 않고 사용자 준비를 안내 | 제공 기록 범위에서 통과. ‘캐시가 없다’는 원인 단정은 부정확 |
| M12 | 새 셸 전달 후 status가 이전 closed를 반환하는 현상 조사 | Claude owner=C1, Baton 새 셸 owner=C2 | 원인 확인: 서로 다른 연결을 보고 있었음. 같은 owner의 상태 갱신 결함으로 확인된 것은 아님. 선택 UI 개선 필요 |
| M13 | closed S1에 텍스트 전송 시도 | `session_closed`, 재시도 없음; 사용자도 차단 확인 | 통과. 명령 전송 거부 확인 |
| M14 | 올바른 C1에 새 셸 재전달 | 동일 owner C1에서 S2, `agentowned` | 통과: 닫힌 셸 이후 새 배정과 새 세션 ID 확인 |
| M15 | 사용자 sudo 준비 후 재실행 | 다시 승인 요청. 사용자 보정·승인 후 `sudo -n du -sh /root` 성공, `44K` | 성공 경로 통과, 단 `-n` 자동 제시는 다시 미흡. 이번 전문 뒤의 이전 대화 보고로 보완 |
| M16 | Claude Desktop 완전 종료 시 정리 | 사용자 ‘1. 확인완료’ 보고 | 사용자 확인: 앱에서 셸 종료 상태 확인. 서버 PID 소멸은 별도 미관찰 |
| M17 | Baton 종료 시 하네스 단절 | `MCP baton: Server disconnected`, `server disconnected` | MCP 단절 통과. 실제 서버 프로세스 종료는 이 문구로 판단 불가 |
| M18 | Baton 재실행 후 이전 셸 미복원 | 이번 기록에 명시적인 재실행/미복원 확인 없음 | 사용자 환경 수동 확인 미완료. 기존 격리 배포 프로세스 시험은 별도 존재 |
| M19 | 전달 전 표식 비공개·전달 후 표식 조회 | 사용자 ‘3. 정상인듯’ 보고, 구체적인 조회 원문은 미첨부 | 사용자 잠정 확인. 엄격한 원문 기반 판정은 보류 |
| M20 | Desktop과 Claude Code CLI 동시 연결 격리 | 사용자가 보류 지시 | 보류. 자동 어댑터 격리 시험으로 대체 판정하지 않음 |

### 당시 top 배치 조회값

업타임 27일, load average 0.65/0.77/0.76, CPU user 1.9%·system 1.9%·idle 96.1%. 메모리 총 3631.1 MiB, used 1718.9 MiB, free 397.0 MiB, buff/cache 1515.2 MiB, available 1696.9 MiB. swap 0/0. 가장 높은 것으로 보고된 프로세스는 dockerd(CPU 6.2%, MEM 2.1%)였다. 이는 해당 조회 시점의 보고값이며 현재 상태나 지속적인 부하 특성을 뜻하지 않는다.

## 5. 개선 사항과 우선순위

| 항목 | 근거·영향 | 후속 변경안(이번에는 미구현) |
|---|---|---|
| P1: sudo 승인 명령의 `-n` 누락 | 두 번 반복. 승인 후 대화형 비밀번호 대기로 이어질 수 있음. AgentPolicy에는 `Only after approval, advise using ... sudo -n`이라는 순서상 모호한 문장이 있음 | 비대화형 최종 명령을 먼저 구성해 정확한 명령·인자·목적을 제시하고 그 1회 승인을 받도록 문구 통일. 승인 후 명령 자동 수정 금지 유지 |
| P1: 전달 대상 오선택 | C1/C2가 달랐으며 UI는 가용 연결의 첫 항목을 자동 선택할 수 있음. 사용자가 의도하지 않은 연결이 셸 권한을 받음 | 이름/전체 연결 ID 확인과 명시적 선택을 강화. 대화 이름을 인증된 신원으로 간주하지 않음 |
| P2: sudo 실패 원인 단정 | `a password is required`로 캐시 부재를 단정, 캐시가 없으면 항상 실패한다고 설명 | ‘추가 인증이 필요함’으로 보고. NOPASSWD 등 인증 불필요 조건과 구분 |
| P2: closed의 의미 명확화 | 로컬 closed/MCP disconnected가 서버의 모든 작업 종료로 오인될 수 있음 | UI·문서에서 ‘연결 종료’와 ‘모든 원격 작업 종료’를 구분. 서버 PID 확인 없는 종료 보증 금지 |

P1은 이 보고서의 개선 우선순위이며, 침해 발생이나 모든 사용 사례의 실패를 의미하지 않는다. sudo는 운영 지침이며 Baton이 명령 문자열로 강제 승인하는 구조로 바꾸지 않는다.

## 6. Baton 종료 코드 경로 검토

| 경로 | 현재 구현 |
|---|---|
| 창 정상 종료 | MainWindow의 Closing에서 registry.Dispose 호출. App.OnExit에서도 호출 |
| registry.Dispose | 모든 등록 셸을 Close. 어댑터/세션 목록 제거 |
| ShellSession.Close | 즉시 닫힘 플래그 설정, transport.Dispose, 입력 큐 종료 및 메모리 상태 폐기 |
| SshTransport.Dispose | NotifyClosed에서 한 번만 정리 예약. Task.Run(Cleanup)에서 SSH.NET client와 shell Dispose |
| MCP 단절 | PipeBroker에서 해당 owner를 DisconnectAdapter하고 소유 셸 Close |
| 프로세스 강제 종료 | 관리형 종료 콜백 실행은 기대할 수 없음. OS가 종료된 프로세스의 열린 핸들을 정리 |

참조 코드: [MainWindow](https://github.com/bnbnac/baton/blob/csharp-mvp-final/src/Baton.App/MainWindow.xaml.cs), [App](https://github.com/bnbnac/baton/blob/csharp-mvp-final/src/Baton.App/App.xaml.cs), [SessionRegistry](https://github.com/bnbnac/baton/blob/csharp-mvp-final/src/Baton.Core/SessionRegistry.cs), [ShellSession](https://github.com/bnbnac/baton/blob/csharp-mvp-final/src/Baton.Core/ShellSession.cs), [SshTransport](https://github.com/bnbnac/baton/blob/csharp-mvp-final/src/Baton.Core/SshTransport.cs), [PipeBroker](https://github.com/bnbnac/baton/blob/csharp-mvp-final/src/Baton.Core/PipeBroker.cs).

주의할 점은 SSH 자원 정리가 비동기이며 App.OnExit가 그 Task의 완료나 원격 프로세스 종료 확인을 기다리지 않는다는 것이다. 연결 종료를 요청하고 로컬 자원을 폐기하는 구현이지 원격 PID가 모두 사라졌다는 확인 응답을 받는 구현이 아니다. Windows는 프로세스 종료 때 핸들을 닫지만 자식 프로세스를 자동 종료하는 것은 아니다. Baton은 로컬 SSH 자식 프로세스를 만들지 않아 이 경로는 네트워크 소켓 정리에 해당한다. [Windows 프로세스 종료 문서](https://learn.microsoft.com/en-us/windows/win32/procthread/terminating-a-process)

## 7. 추가 Linux 실측: 실제로 무엇이 종료되는가

### 방법

- 실행: `scripts/test-server-lifecycle.ps1`. 재현에는 PowerShell 7.2 이상, .NET 10 SDK, Docker Linux 엔진이 필요하며 이번 실행은 PowerShell 7.6.5에서 수행했다.
- 서버: 로컬 loopback 임의 포트의 격리 Docker 컨테이너, Alpine 3.24.1, Bash 5.3.9, OpenSSH 10.3p1. Docker init을 사용해 고아 프로세스 회수를 지원.
- 클라이언트: 실제 Baton.Core의 SshTransport, ShellSession, SessionRegistry를 참조한 시험 전용 콘솔 호스트. 시험 전용 계정으로 접속하며 사용자 서버에는 접속하지 않음.
- 같은 PTY에 일반 백그라운드 `sleep 120`, 분리한 `nohup sleep 120 ... &` + `disown`, 전경 `sleep 120`을 준비.
- 서버 `/proc/<pid>/stat`를 Docker exec로 외부 관찰. 종료 전 모든 대상이 실행 상태인지 확인하고, 분리 작업은 PID뿐 아니라 프로세스 시작 ticks도 대조.
- 조건 A: registry.Dispose를 호출하되 시험 호스트는 계속 살려 둠. 따라서 이 조건은 OS 프로세스 종료 덕분에 정리된 것으로 오인하지 않음.
- 조건 B: 별도 새 세션을 만든 뒤 시험 호스트 프로세스를 강제 종료.
- 최대 10초 관찰. 출력 전문을 저장하지 않고 PID·상태·버전·관찰 시간만 artifacts의 JSON으로 저장.

### 결과

| 대상 | 조건 A: 정상 registry 정리 | 조건 B: 호스트 강제 종료 |
|---|---|---|
| 해당 세션의 sshd 자식 | PID 20 → absent | PID 87 → absent |
| 로그인 Bash 셸 | PID 21 → absent | PID 88 → absent |
| 일반 백그라운드 sleep | PID 22 → absent | PID 89 → absent |
| 전경 sleep | PID 24 → absent | PID 91 → absent |
| nohup + disown 작업 | PID 23 → S, 같은 시작 ticks로 생존 | PID 90 → S, 같은 시작 ticks로 생존 |
| 클라이언트 호스트 | 관찰 중 계속 실행 | 종료됨 |
| 위 상태 확인까지 시간 | 928ms | 914ms |

두 조건의 검증을 통과했고 스크립트 종료 코드는 0이었다. 시간에는 여러 Docker exec 조회 비용이 포함되므로 정확한 프로세스 종료 시각이나 1초 이내 보장으로 해석하면 안 된다. 분리 작업은 컨테이너 정리 시 제거했다. 시험 컨테이너·이미지 태그·호스트 프로세스가 남지 않은 것도 별도로 확인했다.

재현 코드: [시험 호스트](https://github.com/bnbnac/baton/blob/csharp-mvp-final/tests/Baton.LifecycleProbe/Program.cs), [실행 스크립트](https://github.com/bnbnac/baton/blob/csharp-mvp-final/scripts/test-server-lifecycle.ps1). 당시 로컬 실측 자료 경로: `artifacts/verification/server-lifecycle.json` (Git 제외, 현재 checkout에 포함되지 않음). 표의 결과는 이 문서에 보존한다.

### 결과 해석과 한계

1. **이 시험 환경에서는 SSH 연결이 닫히면서 서버의 해당 SSH 세션/로그인 셸/일반 작업이 실제로 종료됐다.** 단지 화면 표시가 closed로 바뀐 것만 관찰한 시험이 아니다.
2. **분리한 작업은 실제로 남았다.** 모든 백그라운드 작업을 종료한다는 제품 계약을 둘 수 없다는 반례를 확인했다. Bash는 SIGHUP 처리 시 job에 신호를 전달하지만 disown 등의 동작으로 그 대상에서 제외할 수 있다. [Bash 신호 처리 설명](https://www.gnu.org/software/bash/manual/html_node/Signals.html)
3. OpenSSH 서비스 전체나 서버 OS를 종료한 것이 아니다. sshd는 접속마다 별도 처리를 생성한다. 이번에 관찰한 것은 해당 세션의 자식 프로세스이며 컨테이너 서버는 두 조건 사이에도 유지됐다. [OpenSSH sshd 문서](https://man.openbsd.org/sshd)
4. 실제 WPF 배포 앱을 사용자 서버에 연결한 상태에서 창을 닫고 서버 PID까지 관찰한 시험은 아니다. 사용자 UI 종료 보고, 코드 경로, 동일 Core의 격리 실측을 결합한 검토이며 그 범위를 넘어서 일반화하지 않는다.
5. 다른 셸, SIGHUP 무시/트랩, nohup/disown, tmux/screen, 별도 서비스로 시작한 작업, 서버 정책에 따라 생존 여부는 달라질 수 있다. 이 중 실제 생존을 시험한 것은 nohup+disown뿐이다.
6. 네트워크 blackhole, 클라이언트 장비 전원 단절에서는 서버가 연결 단절을 알아채기까지 지연될 수 있다. 이번 정상 LAN 소켓 종료 시험으로 그 시간을 보장하지 않는다.

## 8. 실제 사용자 서버에서 확정하려면

현재 사용자의 서버에서까지 ‘실제 종료’를 확정하려면, 향후 승인된 시험에서 Baton과 독립된 관찰용 SSH 연결을 하나 유지해야 한다. Baton의 사용자 소유 단계에서 테스트 셸의 PID(`echo $$`), PTY(`tty`), 시작 시각을 기록하고, 그 연결을 전달한 뒤 Baton을 종료한다. 관찰용 연결에서 기록한 PID/시작 시각/PTY의 소멸을 확인한다. 서버 전체 sshd나 다른 사용자 프로세스를 종료해서는 안 된다.

이는 남은 검증 방법을 제시한 것이며 이번 작업에서 사용자 서버에 실행하지 않았다. 현재 요청에서 보류한 Desktop/CLI 동시 연결 시험과도 별개의 서버 관찰 시험이다.

## 9. 이번 작업의 변경 범위

- 이 보고서와 기존 검증 문서의 상태 갱신.
- 서버 종료 검토용 독립 시험 호스트 및 실행 스크립트 추가.
- 제품 소스, 배포 실행 파일, 사용자 하네스 설정, 사용자 서버 세션 변경 없음.
- sudo 지침 수정, 연결 선택 UI 개선, 대화별 격리 구현은 착수하지 않음.
