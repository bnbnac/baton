# Rust Phase 2 인수 기록

2026-09-29 기준: Tasks 1–7 구현 완료. Task 8의 자동 인수·수동 기록 도구를 구현했으며 **실제 Windows 물리 관측은 미확인**이다. Phase 2 전체 완료나 배포 가능 상태를 뜻하지 않는다. C# MVP, 사용자 하네스 설정, 실제 홈서버는 변경하지 않았다.

## 검증 범위

| ID / 영역 | 시험·관측 효과 | 명령 / 증거 | 결과와 제한 |
|---|---|---|---|
| lifecycle / ownership | 예약·활성화·닫기·제거, 오래된 핸들, 취소 후 늦은 인증 성공 차단 | `cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core -p baton-ssh -p baton-app --all-targets` | 코어 80 + SSH 7 + AppService 11. 원격의 임의 분리 작업 종료 보장은 없음. |
| queries / control_io | 수신 시점 권한, token·epoch·view·frame offset, 단일 전송 장벽 | 위 Rust 시험 및 WebView wire 비교 | stale/foreign/replay 입력과 응답 차단. private 화면과 public 출력 분리. |
| model | 1,000 seed, 200,000 event, 독립 참조 모델 | `verify-phase-1.ps1 -Mutation` | 80개 코어 시험 통과. owner/epoch/private/duplicate 변이 4개 모두 컴파일 후 assertion으로 검출. |
| input / auth / output | UTF-8 붙여넣기 분할, IME 원래 epoch, 입력 큐, frame 예산, 인증 정보 비우기 | `npm.cmd test --prefix rust/app` | 순수 UI 시험 10개. 물리 IME·클립보드의 증거는 아님. |
| auth / SSH fixture | 비밀번호·암호화 키·다단계 인증·취소·늦은 성공·PTY 거절·독립 셸 | `node --test rust/tests/phase2/auth.test.mjs rust/tests/phase2/ssh.test.mjs` | 18개 제품 library 경로 시험. 합성 loopback 서버 사용. |
| terminal / geometry | CPR/DSR/DA, 분할 escape, unsupported sequence, 숨겨진 parser, 출력 포화, 크기 dedup/isolation | `test-desktop.ps1 -Suite all` | 실제 WebView wire 43개. OS 물리 이벤트는 생성하지 않음. |
| interactive-openssh | 두 서버·세 셸, 실제 vi/top·resize·Ctrl+C, 다른 PTY 유지 | `test-openssh.ps1 -Desktop -CleanupReport ...` | 1개 통합 시나리오. 임시 컨테이너 ID/라벨 확인 후 정리. |
| cleanup | 정상 닫기, auth 대기·출력 ack 대기·정리 직전 runner 강제 종료, sentinel 생존 | `node --test rust/tests/phase2/cleanup.test.mjs` | 4개 통과. PID+정확한 시작 tick 문자열+실행 경로, private Windows job, WebView data directory 귀속 기록. |
| runner | 외부 exit 7, 시험/필수 case 누락, skip/ignored/filter, stale identity, 없는 화면, 자손 잔존 거부 | `node --test rust/tests/phase2/runner.test.mjs` | 실패 입력을 성공으로 처리하지 않음. 집계는 로그의 실제 결과에서 계산. |
| manual harness | 독립 서버에서 바이트 기록, upstream PTY/resize/output, 기록 구간 소비, 소유권 전환 | `manual-proxy.test.mjs`, `test-openssh.ps1 -Desktop -ManualSmoke` | 도구 자체 검증. 물리 입력 통과로 합산하지 않음. |
| physical Windows | 실제 키·paste·IME·mouse·숨김/최소화·100/150/200% DPI·vi/top·종료 | [수동 절차](rust-phase-2-manual.md) | **13개 필수 case 미확인**. 자동 통과여도 최종 exit 2. |

## 실행 증거

각 `verify-phase-2.ps1` 실행은 `artifacts/rust-phase-2/<run-id>/summary.json`과 로그를 새로 남긴다. source inventory/digest, Cargo/app npm lock hash, 제품·acceptance executable hash, commit/dirty, OS/Rust/Node/WebView 버전, 명령별 시간·exit code, 실제 pass/fail/skip, fixture ID/정리 결과를 포함한다. 출력은 합성 fixture의 데이터만 저장한다. `desktop`의 43개 case는 Node 통합 시험 한 개 안에서 실행되므로 두 수를 독립 시험처럼 더하지 않는다.

첫 전체 인수 실행 `20260928T133914-ebe923af3e8b4ad8b70b0b70f3682834`: Rust 98, UI 10, Node 29, WebView 43, OpenSSH 1 통과; `manual_pending`, exit 2. 이후 수동 기록 도구 추가 전의 증거이므로 최신 소스의 최종 증거로 재사용하지 않는다. 최신 실행과 최종 리뷰 결과는 아래에 추가한다.

최신 자동 인수 실행 `20260928T205521-87ff008fc6ed49afa05c95636761922d`: Rust 98, UI 10, Node 31, WebView 43, OpenSSH 1, 수동 도구 smoke 1 통과. fmt/clippy·제품/acceptance 빌드 통과, skipped/ignored 0, 두 Docker 실행 모두 잔존 컨테이너 0. `manual_pending`, exit 2. 독립 최종 리뷰는 진행 중이다.

## 알려진 경계

- Windows만 실제 GUI 검증했다. macOS/Linux 지원·패키징·배포는 후속 단계다.
- 단계 2 제품에는 MCP 연결과 에이전트 전달 UI가 없다. 신뢰된 시험 연결은 별도 acceptance 실행 파일에만 존재한다.
- 정상 앱 종료는 SSH 연결·로컬 리소스를 닫는다. 원격 shell foreground는 일반 SSH 종료 의미를 따르며 서버 전체 또는 임의 background 프로세스 종료와 같지 않다.
- 자동 검증 도구의 private Job Object 강제 정리는 제품의 정상 종료가 성공했다는 증거가 아니다. 두 결과를 따로 기록한다.
- 수동 인수용 SSH 중계는 합성 자격 증명과 고정 fingerprint로 격리 OpenSSH에 연결한다. 직접 연결 인증의 검증은 별도 제품 SSH 시험이 담당한다.
- `manual-evidence.json`은 사용자 관측 기록이며 암호학적으로 서명된 attestation이 아니다. 해시는 파일 변경·오래된 빌드를 검출하고, 실제 사람이 OS 이벤트를 수행했는지는 사용자 확인이 필요하다.
