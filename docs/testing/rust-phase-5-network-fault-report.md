# Rust Phase 5 LIFE-04: 연결 종료·서버 강제 종료·패킷 차단

2026-10-11~12 KST. **세 장애 조건을 실제 배포 후보에서 각각 관측했다. TCP 종료와 서버 강제 종료는 세션 폐쇄 및 이후 입력·읽기 거부를 확인했다. 패킷 차단은 30초 동안 연결 상태를 유지했고, 복구 확인의 제한 대기는 실패한 뒤 나중에 실행 1회를 확인했다.** 모든 경로가 제한 시간 내 복구됐다는 판정이나 전체 Phase 5 통과가 아니다.

## 대상과 재현 방법

제품 기준은 [Windows 시험 ZIP](rust-phase-5-package-report.md)의 압축 해제본이다. 작업 HEAD `3e87574`에서 제품 코드는 바꾸지 않았다. 종료 후 확인한 `baton.exe` SHA256은 `f2fe998b0f224903d26234b0d033b3e7b7faf8198da80aede9f06504e7fa777b`, `baton-adapter.exe`는 `a1c0d1c92d1986d0ff120f88dfdfeb77cfbcac2921d869c4e1066aba362733f6`으로 기존 후보와 같다. acceptance hook 없이 제품 UI에서 호스트키 확인·비밀번호 인증·MCP 선택·전달을 수행했다.

서버는 프로젝트 `tests/linux-ssh/Dockerfile`에 iptables만 추가한 localhost 전용 Alpine/OpenSSH fixture다. OpenSSH 10.3p1, bash 5.3.9, `UsePAM no`이며 합성 계정을 사용했다. `NET_ADMIN`은 이 컨테이너에만 부여했다. 실제 홈서버, Windows 방화벽, 사용자 하네스 설정은 변경하지 않았다.

[증거 폴더](../../artifacts/phase5-life04-20261011/)의 `driver.mjs`는 압축 해제본 어댑터의 stdio MCP를 호출하고, 독립 SSH 연결로 서버 관측을 수행한다. Node로 드라이버를 실행한 뒤 `requests/*.json`에 순차 요청을 넣었다. `container.json`에 컨테이너·이미지 ID와 호스트키, 각 `ready.json`에 사용 포트가 있다. 제품 연결은 UI에서 직접 만들었다.

| 조건 | 주입 방법 | 실행 기록 |
|---|---|---|
| TCP 정상 close | 투명 TCP 프록시 양쪽 소켓의 `end()` 호출. SSH disconnect 메시지는 별도로 주입하지 않음 | `run2/01-prepare-fin.json.response`, `02-fin.json.response` |
| 패킷 blackhole | 제품이 직접 연결한 SSH TCP tuple만 INPUT/OUTPUT `DROP`. 독립 관찰 연결은 제외 | `run2/03-prepare-blackhole.json.response`, `results.json` |
| 서버 강제 종료 | ID·이름·label 검증 후 전용 컨테이너에 `docker kill --signal KILL` | `run3/01-prepare-server-kill.json.response`, `02-server-kill.json.response` |

각 prepare는 대상 세션에서 `$SSH_CONNECTION`과 준비 표식을 기록했다. 패킷 차단 중에는 실행될 때마다 카운터 파일에 한 줄을 추가하는 명령과 `BH_REPLY` 출력을 **한 번만** 보냈다. 조건별 원시 MCP 요청·응답은 `transcript.json`에 보존했다.

## 관측 결과

| 조건 | 세션 및 앱 | 입력·출력 결과 |
|---|---|---|
| TCP 정상 close | 기존 세션 `closed`, 공개 stream 제거. 앱 `online`, 기존 MCP connection 유지 | 이후 send_text/read_output 모두 `session_closed` |
| 서버 강제 종료 | 컨테이너 exit 137, OOM 아님. 기존 세션 `closed`, UI `종료됨`. 앱 `online`, 기존 MCP connection 유지 | 이후 send_text/read_output 모두 `session_closed` |
| 패킷 blackhole | 0·5·15·30초 관측에서 `agent_owned`, 동일 epoch/stream/connection | send_text와 Enter는 `delivered`. 서버 실행 횟수는 각 관측에서 0. 읽기는 기존 공개 출력만 반환, `BH_REPLY` 없음 |

TCP 종료 후 첫 status 표본은 약 2.5ms, 서버 kill 요청 시작 후 첫 status 표본은 약 1,023ms에 이미 `closed`였다. 후자는 Docker kill·inspect 시간도 포함한다. 단일 관측치이며 탐지 시간 상한이나 성능 보장이 아니다.

패킷 차단의 INPUT 규칙은 실제로 10개/1,708바이트를 DROP했다. OUTPUT 규칙 카운터는 0이었다. 양방향 규칙을 설치했지만 실제 드롭 증거는 INPUT에 있다. 읽기 cursor를 0으로 유지했으므로 기존 출력이 다시 반환된 것이며, 네 표본의 text와 end_cursor가 동일함을 검사했다. 30초 동안 단절을 감지하지 않았다는 결과만 확인하며, 영원히 감지하지 않는다고 주장하지 않는다.

## 패킷 복구 대기 실패와 후속 관측

DROP 규칙 제거 시각은 `2026-10-11T13:03:35.889Z`다. 드라이버는 250ms 간격 최대 80회의 복구 확인을 수행했지만 카운터 1을 보지 못해 `blackhole_recovery_timeout`을 반환했다. SSH 왕복을 포함하므로 정확히 20초인 타이머가 아니다. [실패 응답](../../artifacts/phase5-life04-20261011/run2/04-blackhole.json.response)을 성공 결과로 덮어쓰지 않았다.

그 뒤 별도 관측에서 서버 카운터 1과 DROP 규칙 제거를 확인했다. [보충 기록](../../artifacts/phase5-life04-20261011/run2/blackhole-recovery-supplement.json)의 시각은 `2026-10-11T13:05:09.7033223Z`다. 같은 세션·stream·MCP 연결의 `agent_owned`도 별도 status로 확인했다. 정확한 실행·복구 시각이나 지연 원인은 측정하지 않았다.

MCP transcript에는 카운터 증가 명령의 send_text가 한 번만 있다. 이 조건에서는 **전송 경로에서 수락된 입력이 네트워크 복구 후 늦게 실행될 수 있었다.** `delivered`는 원격 명령 완료를 뜻하지 않으며, 출력이 없다는 이유로 자동 재전송해서는 안 된다는 기존 계약과 구분해 읽어야 한다. 이 시험은 회수 후 미전송 큐 취소 계약을 추가 검증한 것이 아니다.

## 판정 범위와 정리

- LIFE-04의 세 조건별 관측·보고를 완료했다. 제한 시간 내 blackhole 복구는 실패 기록으로 유지한다. 제한 시간 자체는 시험 드라이버의 관찰 범위이며 제품 복구 SLA가 아니다.
- FIN/kill 직전 요청한 `pendingRead`는 cursor 0의 기존 출력을 즉시 반환했다. 빈 버퍼에서 대기 중인 read 취소를 검증했다고 주장하지 않는다. 폐쇄 뒤 별도 read 거부는 확인했다.
- 최초 실행은 인증/장애 주입 전 장시간 중단됐다. run2의 완료된 FIN·blackhole 증거를 유지하고, 다음 중단 후 run3에서는 미완료 서버 kill만 수행했다. 수정하지 않은 제품 시험을 통과 기록을 얻기 위해 반복하지 않았다.
- run3 제품 창은 정상 종료(exit 0)했고, WebView 자식 6개 종료 및 강제 정리 없음이 `process.json`에 기록됐다. run2/run3 어댑터와 supervisor는 exit 0, 어댑터 stderr는 비어 있다.
- 전용 컨테이너 ID·이름·label·이미지를 확인한 뒤 컨테이너와 추가한 이미지 태그를 제거했다. 서버 포트 64337 및 완료 시험의 프록시 포트 59768/55755에 listener가 없음을 확인했다. [정리 기록](../../artifacts/phase5-life04-20261011/cleanup.json)을 보존한다.

`node artifacts/phase5-life04-20261011/verify.mjs`로 원시 기록 사이의 21개 일관성 검사를 통과했다. [검증 receipt](../../artifacts/phase5-life04-20261011/verification.json)는 `three_conditions_observed_with_bounded_recovery_timeout`이다. 21개는 제품 시나리오 수가 아니며, 제품 시험의 재실행도 아니다. 원시 증거는 gitignored 로컬 artifacts에 있으므로 다른 checkout에서 링크를 사용하려면 해당 폴더가 필요하다.

키/MFA·실제 하네스/sudo·IME/DPI·다른 OS 사용자·장시간 부하 및 과거 초기화 flakiness 등 [남은 Phase 5 인수](rust-phase-5-package-report.md#남은-인수)는 유지한다.
