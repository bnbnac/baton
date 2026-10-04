# Rust Phase 2 인수 기록

2026-10-05 기준: Tasks 1–7 구현 완료. Task 8의 자동 인수·수동 기록 도구를 구현했으며 **실제 Windows 물리 관측은 미확인**이다. Phase 2 전체 완료나 배포 가능 상태를 뜻하지 않는다. C# MVP, 사용자 하네스 설정, 실제 홈서버는 변경하지 않았다.

## 검증 범위

| ID / 영역 | 시험·관측 효과 | 명령 / 증거 | 결과와 제한 |
|---|---|---|---|
| lifecycle / ownership | 예약·활성화·닫기·제거, 오래된 핸들, 취소 후 늦은 인증 성공 차단 | `cargo +stable test --manifest-path rust/Cargo.toml --locked -p baton-core -p baton-ssh -p baton-app --all-targets` | 코어 84 + SSH 7 + AppService 14. 원격의 임의 분리 작업 종료 보장은 없음. |
| queries / control_io | 수신 시점 권한, token·epoch·view·frame offset, 단일 전송 장벽 | 위 Rust 시험 및 WebView wire 비교 | stale/foreign/replay 입력과 응답 차단. private 화면과 public 출력 분리. |
| model | 1,000 seed, 200,000 event, 독립 참조 모델 | `verify-phase-1.ps1 -Mutation` | 84개 코어 시험 통과. owner/epoch/private/duplicate 변이 4개 모두 컴파일 후 assertion으로 검출. |
| input / auth / output | UTF-8 붙여넣기 분할, IME 원래 epoch, 입력 큐, frame 예산, 인증 정보 비우기 | `npm.cmd test --prefix rust/app` | 순수 UI 시험 12개. ack 반환 전에 도착하는 다음 출력 window 및 ack 실패도 검증. 물리 IME·클립보드의 증거는 아님. |
| auth / SSH fixture | 비밀번호·암호화 키·다단계 인증·취소·늦은 성공·PTY 거절·독립 셸 | `node --test rust/tests/phase2/auth.test.mjs rust/tests/phase2/ssh.test.mjs` | 18개 제품 library 경로 시험. 합성 loopback 서버 사용. |
| terminal / geometry | CPR/DSR/DA, 분할 escape, unsupported sequence, 숨겨진 parser, 출력 포화, 크기 dedup/isolation | `test-desktop.ps1 -Suite all` | 실제 WebView wire 45개. 종료 후 출력·늦은 최초 뷰도 포함. OS 물리 이벤트는 생성하지 않음. |
| interactive-openssh | 두 서버·세 셸, 실제 vi/top·resize·Ctrl+C, 다른 PTY 유지 | `test-openssh.ps1 -Desktop -CleanupReport ...` | 1개 통합 시나리오. 임시 컨테이너 ID/라벨 확인 후 정리. |
| cleanup | 정상 닫기, auth 대기·출력 ack 대기·정리 직전 runner 강제 종료, sentinel 생존 | `node --test rust/tests/phase2/cleanup.test.mjs` | 4개 통과. PID+정확한 시작 tick 문자열+실행 경로, private Windows job, WebView data directory 귀속 기록. |
| runner | 외부 exit 7, 시험/필수 case 누락, skip/ignored/filter, stale identity, 없는 화면, 자손 잔존 거부 | `node --test rust/tests/phase2/runner.test.mjs` | 실패 입력을 성공으로 처리하지 않음. 집계는 로그의 실제 결과에서 계산. |
| manual harness | 독립 서버에서 바이트 기록, upstream PTY/resize/output, 기록 구간 소비, 소유권 전환 | `manual-proxy.test.mjs`, `test-openssh.ps1 -Desktop -ManualSmoke` | 도구 자체 검증. 물리 입력 통과로 합산하지 않음. |
| physical Windows | 실제 키·paste·IME·mouse·숨김/최소화·100/150/200% DPI·vi/top·종료 | [수동 절차](rust-phase-2-manual.md) | **13개 필수 case 미확인**. 자동 통과여도 최종 exit 2. |

## 실행 증거

각 `verify-phase-2.ps1` 실행은 `artifacts/rust-phase-2/<run-id>/summary.json`과 로그를 새로 남긴다. source inventory/digest, Cargo/app npm lock hash, 제품·acceptance executable hash, commit/dirty, OS/Rust/Node/WebView 버전, 명령별 시간·exit code, 실제 pass/fail/skip, fixture ID/정리 결과를 포함한다. 출력은 합성 fixture의 데이터만 저장한다. `desktop`의 45개 case는 Node 통합 시험 한 개 안에서 실행되므로 두 수를 독립 시험처럼 더하지 않는다.

첫 전체 인수 실행 `20260928T133914-ebe923af3e8b4ad8b70b0b70f3682834`: Rust 98, UI 10, Node 29, WebView 43, OpenSSH 1 통과; `manual_pending`, exit 2. 이후 수동 기록 도구 추가 전의 증거이므로 최신 소스의 최종 증거로 재사용하지 않는다. 최신 실행과 최종 리뷰 결과는 아래에 추가한다.

리뷰 수정 전 자동 인수 실행 `20260928T205521-87ff008fc6ed49afa05c95636761922d`: Rust 98, UI 10, Node 31, WebView 43, OpenSSH 1, 수동 도구 smoke 1 통과. fmt/clippy·제품/acceptance 빌드 통과, skipped/ignored 0, 두 Docker 실행 모두 잔존 컨테이너 0. `manual_pending`, exit 2. 이후 독립 최종 리뷰와 수정 결과는 아래와 같다.

## 알려진 경계

- Windows만 실제 GUI 검증했다. macOS/Linux 지원·패키징·배포는 후속 단계다.
- 단계 2 제품에는 MCP 연결과 에이전트 전달 UI가 없다. 신뢰된 시험 연결은 별도 acceptance 실행 파일에만 존재한다.
- 정상 앱 종료는 SSH 연결·로컬 리소스를 닫는다. 원격 shell foreground는 일반 SSH 종료 의미를 따르며 서버 전체 또는 임의 background 프로세스 종료와 같지 않다.
- 자동 검증 도구의 private Job Object 강제 정리는 제품의 정상 종료가 성공했다는 증거가 아니다. 두 결과를 따로 기록한다.
- 수동 인수용 SSH 중계는 합성 자격 증명과 고정 fingerprint로 격리 OpenSSH에 연결한다. 직접 연결 인증의 검증은 별도 제품 SSH 시험이 담당한다.
- `manual-evidence.json`은 사용자 관측 기록이며 암호학적으로 서명된 attestation이 아니다. 해시는 파일 변경·오래된 빌드를 검출하고, 실제 사람이 OS 이벤트를 수행했는지는 사용자 확인이 필요하다.

## 최종 리뷰와 수정 (2026-10-05)

중요도 Important 2건을 수정했다. 사용자 입력 4097번째에서 `RequestHistoryFull`을 재현한 뒤, 4100건과 마지막 Ctrl+C가 전달 가능한 것을 확인했다. UI 입력은 bound view·epoch 검증과 함께 단조 sequence로 중복을 거부하고 완료 payload를 제거한다. 대기 32건/전송 중 1건 상한과 에이전트 요청 이력 4096건은 유지한다. 소유권 전환으로 sequence를 초기화하지 않는다. 사용자 승인은 2026-10-04에 받았다.

원격 종료가 UI 큐를 지워 마지막 출력을 잃는 문제는 종료 후 UI drain으로 수정했다. 입력·공개 읽기·query 응답 권한은 즉시 닫는다. 같은 뷰 또는 종료 전 아직 없던 최초 뷰만 받은 출력을 렌더링·ack하며, 앱 출력 작업은 한 번의 5초 예산으로 끝낸다. 코어·서비스에서 in-flight 64KiB와 마지막 조각을 검증하고 실제 WebView에서도 지연된 ack 및 종료 후 최초 뷰 생성을 검증했다.

첫 수정 검증 `20261004T214117-b324db6d92ff4ac295978d5f214c7dac`은 기능 시험을 통과했지만 **최종 exit 1**이다. OpenSSH 실행의 WebView 자손 하나에서 `path=null`이어서 `descendants_unverified`로 거부됐다. 이 기록을 통과로 재분류하지 않는다. 프로세스 증거 수집을 아래 판단대로 수정했으며 최신 전체 검증은 별도로 기록한다.

Minor 2건은 이 수정 범위에서 보류했다: 런타임 `close_reason`이 UI 오류 사유로 표시되지 않아 일반 ‘종료됨’만 보이는 문제, 동일 서버·계정의 무제목 세션을 구분할 짧은 ID/전체 ID 복사 UI가 없는 문제.

리뷰에서 독립 판정하지 않은 영역은 그대로 미확인 또는 후속 범위로 남긴다. 물리 Windows 13개 case, 제품 실행 파일 자체의 reload/renderer crash/창 X 재현, 모든 서버의 pre-PTY 출력 순서와 완전한 VT 호환성은 확인했다고 주장하지 않는다. MCP/IPC/하네스 통합·배포·macOS/Linux·장기 soak/fuzz·임의 원격 background 작업 종료는 Phase 2 밖이다. 수동 관측의 실제 수행 여부는 사람의 확인이 필요하다.

## 구현 중 판단과 남는 비용

| 판단 | 이유와 비용 |
|---|---|
| Bash 작업 기록 명령을 PowerShell로 수행 | Windows 도구 호환성. 기록 누락 위험은 ledger와 실제 출력으로 확인한다. |
| Query 추적에 별도 caller receive sequence를 추가하지 않음 | 신뢰된 순서 있는 수신을 소비하고 frame/ack에서 replay를 차단. 내부 수신을 잘못 재실행하면 새 token이 생길 수 있다. |
| Resize 전송 실패 시 세션 종료 | 마지막 성공 geometry만 유지. 일시적 실패도 셸을 닫을 수 있다. |
| 인증 취소 후 이미 보낸 응답만 공통 5초 안에서 정리 | 늦은 인증 성공이 PTY로 진행하지 못하게 함. 취소 정리가 최대 5초 걸릴 수 있다. |
| 기존 고정 Phase 0 npm 의존성 그래프로 앱 lock 초기화 | 오프라인 메타데이터 제한. 기존 전이 의존성의 오래된 버전을 물려받을 수 있다. |
| Private Windows Job Object와 detached Node 감독 실행기 | runner 강제 종료 후에도 소유 프로세스만 정리. Windows 시험 도구 유지보수 비용이 있다. 제품 의존성은 아님. |
| Virtual workspace fmt에 `--all` 사용 | 루트 자체에 target이 없으므로 필요. 넓어진 포맷 범위의 diff를 확인한다. |
| Gate 실패 검증은 통제된 artifact와 복제 runner를 병용 | 모든 GUI 시험을 실패 입력마다 반복하지 않음. orchestration 누락 위험은 실제 전체 runner로 보완한다. |
| UI 입력은 동기 admission + 단조 sequence, 완료 payload 폐기 | 사용자와 request ID 공간을 분리해 충돌 방지. 거부된 sequence도 소비하므로 같은 입력의 자동 재전송은 불가. 기존 retained request API는 내부 호환성과 에이전트 경로에 유지. |
| RemoteClosed에 한정한 bounded UI drain | 마지막 출력을 보존하면서 권한은 즉시 폐기. 렌더러가 멈추면 5초 후 일부 출력이 표시되지 않을 수 있고, bounded 버퍼는 카드 제거 때 해제된다. |
| 경로는 제한 조회 권한으로 native image 조회, 같은 핸들의 생성 시각 확인 | `.Path` 누락을 다른 프로세스 경로로 추측하지 않는다. 접근 불가·짧게 생존한 프로세스의 증거가 끝내 없으면 Job이 비어도 gate 실패. API 권한 계약: [Microsoft QueryFullProcessImageName](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew). |

추가 경계 시험에서 UI ack 순서 경쟁도 재현했다. 첫 렌더링 후 Rust가 ack를 처리하면 새 출력이 IPC 응답 반환보다 먼저 도착할 수 있다. 기존 UI는 이전 payload를 아직 예산에 포함해 정상 프레임을 `invalid_frame_bytes`로 거부했다. 렌더링 완료 후 payload와 바이트 예산을 먼저 해제하고 ack를 보낸다. 다음 프레임은 큐에 받아도 이전 ack 완료 전 렌더링하지 않으며, ack 실패 시 큐를 중단한다. 실제 WebView 재현과 순수 UI 회귀 시험으로 검증한다. 이 판단의 비용은 ack가 멈추면 다음 window가 bounded 큐에서 대기한다는 점이며 자동 재전송하지 않는다.

두 번째 검증 `20261004T214542-20fe899b28cb4d5bb2cf0285ab5ccabb`은 위 경쟁을 발견해 exit 1로 끝났다. 종료 감사는 통과했으나 이 실행도 전체 통과 증거로 재사용하지 않는다. 늦은 뷰 시험은 실제 DOM의 `FINAL_RESULT`를 확인하고, 카드 제거는 원래 SSH 정리 예산을 기다린다. 별도의 임의 2초 제거 제한은 두지 않는다.

최신 전체 자동 인수 실행은 `20261004T215359-4233aa2a57584dcc96c8aba1cf294f58`이다. **Rust 105 / UI 12 / Node 31 / 실제 WebView 45 / OpenSSH 1 / 수동 도구 smoke 1 모두 통과**, skipped/ignored 0, fmt/clippy·제품/acceptance 빌드 통과. 두 컨테이너 실행 모두 잔존 0, 정상 종료와 WebView 자손 identity/종료 검증 통과. `summary.json`의 source/lock/executable 전후 해시가 같다. Gate는 **manual_pending / exit 2**이며 별도 validator 호출에서도 exit 2를 확인했다. 물리 13개 case와 Task 8 완료는 여전히 미확인이다.

이 직전 `20261004T215220-08589d64f0db4142b18ad4028cdc2e8f` 실행은 두 번째 합성 SSH fixture의 `second_ready_timeout`으로 GUI 실행 전에 실패했다. 원인은 확정하지 못했다. 시작 제한이나 gate를 바꾸지 않고 같은 코드로 단일 WebView 및 전체 재실행이 통과했으며 실패 기록도 보존했다. 시험 실행기의 간헐적인 시작 지연 가능성은 남는다. Core Phase 1 별도 검증은 84개, 모델 200,000 event, 컴파일된 변이 4개 assertion 검출을 통과했다.
