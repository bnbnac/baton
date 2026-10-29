# Rust Phase 5 LIFE-03: OpenSSH와 원격 작업 수명 비교

2026-10-11 KST. **시험한 OpenSSH/bash 환경에서 Baton의 정상·강제 종료는 일반 OpenSSH 클라이언트와 같은 원격 프로세스 결과를 보였다.** 별도의 원격 강제 정리 기능이나 제품 코드 수정은 하지 않았다. 전체 Phase 5 통과를 뜻하지 않는다.

## 대상과 방법

[기존 Windows ZIP](rust-phase-5-package-report.md)의 압축 해제본 `baton.exe`/`baton-adapter.exe`를 사용했다. 실행 후 두 바이너리의 SHA256이 기존 후보와 동일함을 확인했다. 실제 홈서버와 사용자 하네스 설정은 사용하지 않았다.

서버는 프로젝트 `tests/linux-ssh/Dockerfile`로 만든 localhost 전용 임시 컨테이너다. 서버 OpenSSH 10.3p1, bash 5.3.9, `UsePAM no`, Windows 기준 클라이언트는 OpenSSH_for_Windows 9.5p2다. 이미지 ID, 커널, 호스트키 및 버전은 [증거 폴더](../../artifacts/phase5-life03-20261011/)의 `container.json`, `environment.json`, `cleanup.json`에 보존했다.

네 경우 각각에 interactive PTY 셸을 열고 다음 작업을 준비했다. 각 프로세스의 PID를 시험 디렉터리에 기록한 뒤, **별도의 SSH 관찰 연결**이 `/proc/PID/stat`의 시작 시각·상태·세션·프로세스 그룹·controlling tty와 stdin 링크를 읽었다.

- interactive bash 셸
- 셸 job table에 남은 일반 `sleep 1800 &`
- stdin/stdout/stderr를 분리하고 `nohup sleep 1800`과 `disown`을 함께 적용한 작업
- 전면 `sleep 1800` 작업

Windows OpenSSH는 `-tt`와 시험 전용 키·known_hosts를 사용했다. 정상 연결 종료는 SSH escape `~.`, 강제 종료는 해당 클라이언트 프로세스 종료로 수행했다. Baton은 제품 UI로 직접 연결·인증·MCP 전달한 뒤, MCP로 같은 작업을 준비했다. 정상 종료는 창 닫기, 강제 종료는 PID·실행 경로·시작 시각을 검사한 제품 루트 프로세스에 `Stop-Process -Force`를 적용했다. 원격 작업에 종료 명령을 직접 보내지 않았다.

## 관측 결과

| 클라이언트/종료 방식 | 셸 | 전면 작업 | 일반 백그라운드 | nohup + disown |
|---|---|---|---|---|
| Windows OpenSSH / 연결 정상 종료 | 종료 | 종료 | 종료 | 생존, controlling PTY 없음 |
| Windows OpenSSH / 프로세스 강제 종료 | 종료 | 종료 | 종료 | 생존, controlling PTY 없음 |
| Baton / 창 정상 종료 | 종료 | 종료 | 종료 | 생존, controlling PTY 없음 |
| Baton / 프로세스 강제 종료 | 종료 | 종료 | 종료 | 생존, controlling PTY 없음 |

종료 후 약 1.5초와 5초 대기 시점의 두 관측에서 결과가 같았다. 일반 작업의 `/proc/PID`는 없어졌고, 분리한 작업은 같은 PID와 시작 시각을 유지하며 실행 상태 `S`, tty `0`, stdin `/dev/null`로 남았다. PID만 같다는 이유로 생존 판정하지 않았다. [원시 관측](../../artifacts/phase5-life03-20261011/results.json)과 [검증 결과](../../artifacts/phase5-life03-20261011/verification.json)에 네 경우가 모두 있다.

Baton 정상 종료는 exit 0이었다. 의도한 강제 종료는 nonzero였고, 두 경우 모두 감시자의 추가 강제 정리 없이 관측된 WebView 하위 프로세스가 종료됐다. 동일 어댑터가 `offline`을 반환한 뒤 EOF exit 0으로 종료됐고 stderr는 비어 있었다. 이는 실제 Claude/Codex 하네스 시험을 대체하지 않는다.

## 실패·중단·정리

첫 Windows OpenSSH 시도는 시험 키의 상속 ACL이 너무 넓어 인증 전에 거부됐다. `attempt1/`에 로그를 보존했고, **그 시험 키 파일만** 현재 사용자에게 접근을 제한한 뒤 진행했다. 실제 사용자 키나 SSH 설정은 변경하지 않았다.

첫 Baton 정상 종료 준비 중 대화가 장시간 중단돼 30분 시험 제한으로 프로세스가 정리됐다. 해당 `baton-normal`은 정상 종료 증거에서 제외했다. 준비 자료와 캡처는 남겼고 `interrupted/`에 메타데이터를 보존했다. 재개 시 완료된 OpenSSH 기준 두 경우는 반복하지 않고, Baton 두 경우만 별도 실행했다. 실제 판정 대상은 `baton-normal-resume`과 `baton-forced`다.

마지막에 컨테이너 ID·이름·라벨과 이미지 ID를 확인하고 이번 시험 컨테이너 및 이미지 태그만 제거했다. 생존한 분리 작업도 이때 함께 정리됐다. 컨테이너와 시험 포트 56666/56667 잔존 수는 모두 0이다. 기존 저장소·다른 Docker 자원은 정리 대상으로 삼지 않았다.

## 결론의 범위

사용자 질문인 “앱 종료가 일반 SSH 클라이언트처럼 동작하는가”는 **이 서버 설정과 작업 구성에서 확인했다.** 앱 종료가 모든 원격 작업을 반드시 죽인다는 보장은 아니다. `nohup + disown`처럼 의도적으로 분리한 작업이 남는 결과는 기준 클라이언트와 동일했다.

다른 셸, PAM/systemd 정책, tmux/screen, 별도 daemon, 네트워크 blackhole까지 일반화하지 않는다. LIFE-03은 시험한 프로필의 네 경우를 통과로 기록하며, LIFE-04 연결 장애·서버 종료·패킷 유실 시험과 나머지 Phase 5 항목은 별도다.
