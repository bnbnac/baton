# Rust Phase 5: 앱·어댑터·SSH 반복 수명 검증

2026-10-14 KST, 기준 `05e60ea`에 수명주기 시험 실행기와 정상 창 종료 helper만 추가했다. **100회 연속 통과**로 승인된 검증 설계 §4의 반복 수명 항목을 완료한다. 제품 코드 변경은 없다. 전체 Phase 5 완료나 출시 승인을 뜻하지 않는다.

## 시험과 판정

`rust/tests/phase5/lifecycle.mjs`는 매 회차 새로운 endpoint 디렉터리와 MCP 어댑터, 실제 Baton 제품 실행 파일을 사용한다. WebView 사용자 데이터 폴더는 캠페인 내부에서만 재사용한다. Playwright는 시험 앱에만 활성화한 localhost CDP로 실제 연결·호스트 키 확인·인증·세션 전달 화면을 조작한다. 호스트 키는 Docker 내부에서 독립 조회한 fingerprint와 대조한다. 시험용 OpenSSH 컨테이너는 localhost 임의 포트에만 공개하고 합성 계정으로 연결한다. 실제 홈서버·개인 인증 정보는 사용하지 않는다.

매 회차 아래 조건을 모두 확인하며 최초 실패에서 캠페인을 중단한다. 준비 상태를 기한 내 관측하는 polling은 허용하지만 실패한 회차를 자동 재시도해 통과로 바꾸지는 않는다.

1. 어댑터 offline → 앱 시작 후 online → SSH 세션 agent_owned.
2. MCP send_text/send_key로 고유 표식 명령을 실행하고 read_output에서 실제 확장된 표식을 관측한다. 서버에서 bash와 SSH 연결 프로세스가 존재한다.
3. 앱 PID·시작 시각·실행 경로를 검증한 뒤 CloseMainWindow로 정상 종료를 요청한다. 첫 회차에는 틀린 시작 시각으로 종료 요청이 거부되는 음성 대조도 포함한다.
4. 기존 Windows Job 감독기가 앱 exit 0, 강제 정리 없음, 관측된 WebView 자손 종료, Job 비움을 확인한다.
5. 어댑터는 offline으로 전환하며 EOF 후 exit 0, stderr 비어 있음. endpoint.bin과 이전 named pipe가 사라지고 CDP 포트 연결은 거부된다.
6. 컨테이너의 서버 프로세스 목록이 접속 전 기준(sshd listener만)으로 돌아온다. 캠페인 종료 시 소유 label·ID·이름을 대조한 컨테이너만 제거한다.

이 검증의 서버 종료는 해당 SSH 연결·셸 종료를 뜻한다. 서버의 sshd listener 자체를 종료하는 제품 기능이 아니며, nohup·서비스·분리된 작업의 종료를 보장하지 않는다.

## 대상과 재현

- UI: 기존 ZIP 압축 해제본의 `baton.exe`, SHA256 `f2fe998b0f224903d26234b0d033b3e7b7faf8198da80aede9f06504e7fa777b`.
- 어댑터: 후속 하네스 수정 후보, SHA256 `09823dd5d51cd3b33f286540fe43a03570b3eee81497607a1b5b67336fcb754c`.
- 두 바이너리의 조합 검증이며 기존 ZIP에 새 어댑터가 들어 있다는 뜻은 아니다.
- Windows x64, Node 22.17.0, 설치된 WebView2, 로컬 Docker OpenSSH fixture.
- 실행 전후 실행기·종료 helper·기존 감독기·어댑터 통신 helper의 SHA256을 대조한다.

실행기는 현재 검증 PC의 Node/PowerShell/Playwright 설치 경로와 검증 바이너리 경로를 사용한다. 재현 시 해당 의존성을 먼저 준비한다. 저장소 루트에서 `tests/linux-ssh/Dockerfile`로 `baton-lifecycle-20261014` 이미지를 준비한 뒤 작업 트리 루트에서 실행한다.

```text
node rust/tests/phase5/lifecycle.mjs artifacts/phase5-lifecycle-20261014/run100 100
```

출력 폴더는 새 경로여야 한다. 회차별 `result.json`, 프로세스 감독 증거 `process.json`, 캠페인 `summary.json`과 로그를 보존한다.

## 사전 시험 기록

증거 루트: `artifacts/phase5-lifecycle-20261014/`.

- `probe`: 제품 페이지 탐색이 준비보다 빨라 실패. 페이지 준비 관측으로 수정.
- `probe2`: WebView의 window.close()가 네이티브 앱을 닫지 못해 실패. PID·시각·경로 검증 후 정상 창 닫기 요청으로 교체.
- `probe3`: SSH 없는 정상 앱 종료 사전 시험 통과.
- `smoke`: 실행기의 프로젝트 루트 계산 오류로 바이너리를 찾지 못함. 제품 실행 전 실패. 경로 수정.
- `smoke2`: 실제 SSH 표식은 관측했으나 감독기가 process.json을 교체하는 순간 읽어 ENOENT. ENOENT만 제한 시간 내 재조회하도록 수정. 실패 앱 PID가 남지 않았음을 별도 확인.
- `smoke3`: 실제 SSH 접속·표식·정상 종료·원격 프로세스 정리·컨테이너 제거 1회 통과. 본 100회에 포함하지 않는다.
- 독립 정적 검토에서 Docker가 컨테이너를 만들었지만 CLI가 응답을 전달하지 못한 경우 정리가 누락될 수 있음을 발견했다. 실패 경로에서 고유 label로 찾아 이름·ID·label을 검증하고 정리하도록 보완했다. `response-loss/`는 별도 실행기 복사본에서 실제 컨테이너 생성 직후 응답 유실을 주입한 대조 시험이다. 의도한 exit 1과 `injected_docker_response_loss`, `recoveredContainer=true`, `containerRemoved=true`를 확인했다. 진행 중인 본 실행 소스는 변경하지 않았다.
- Docker 이미지 첫 준비는 network=none에서 패키지 설치 캐시가 없어 실패했고, 일반 빌드로 성공했다.

## 결과와 한계

`run100.log` 및 `run100/summary.json`: 요청 100회, **100 pass / 0 fail**, 실행기 exit 0, 소요 511.571초(약 8분 32초). 실패 재시도는 없었다. 독립 검토의 컨테이너 정리 지적을 수정한 뒤 시작했고, 캠페인 중 소스를 바꾸지 않았다. 수정 검토에서도 추가 차단 사항은 없었다.

| 확인 항목 | 결과 |
|---|---|
| 서로 다른 앱 instance / MCP 연결 / SSH 세션 | 각각 100개 |
| 정상 앱 종료 / 어댑터 EOF 종료 | 각각 100회 exit 0 |
| 관측된 WebView 프로세스 인스턴스 | 총 600개, 모두 종료 |
| 강제 정리 / 실패 회차 재시도 | 0 / 0 |
| 종료 후 원격 프로세스 | 100회 모두 접속 전 sshd listener만 남음 |
| endpoint.bin / 옛 named pipe / CDP listener | 100회 모두 제거 또는 연결 거부 |
| 시작 시각 불일치 종료 요청 | 첫 회차에서 거부, 정상 앱 유지 확인 |
| 실행 전후 소스 / 바이너리 SHA256 | 모두 일치 |
| 최종 소유 프로세스 / 시험 컨테이너 잔존 | 0 / 0 |

`verification.json`은 100개 회차별 JSON과 summary의 일치, 고유 ID 수, 모든 통과 조건, 최종 소스·바이너리 해시를 재검증한 결과다. `cleanup.json`은 기록된 PID와 시작 시각으로 이번 시험 프로세스 잔존 0을 다시 확인하고 시험 label 컨테이너 잔존 0, 이번 이미지 태그 제거를 기록한다. 관측 기록과 로그는 보존했다. 다른 사용자 프로세스·Docker 자원은 제거하지 않았다.

단일 Windows PC에서 한 종류의 OpenSSH/bash 설정으로 순차 실행한 결과다. 동시 다중 세션, 장시간 누적 부하, 정상 종료 이외의 모든 장애를 검증한 것은 아니다. 원격 분리 작업과 일반 OpenSSH 동작 비교는 기존 [LIFE-03 보고서](rust-phase-5-lifetime-report.md)를 따른다.

다음 자동 검증 대상은 32연결/16SSH/2서버의 2시간 부하다. 보류된 퍼징, 별도 환경·수동 인수 및 미해결 초기화 실패의 출시 차단 판단도 남아 있다. 이번 실행 중 관련 없는 미완성 퍼징 파일은 수정하거나 검증에 포함하지 않았다.
