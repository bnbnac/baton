# Rust Phase 2 인수 기록

2026-10-08 현재: Tasks 1–7 구현과 자동 인수, 승인된 복수 실행 증거 수집기 구현을 마쳤다. vi 편집부터 회수·저장 없이 종료까지 한 세션의 native OS 입력 기록도 확보했다. **Task 8/Phase 2는 아직 `manual_pending`이다.** 이전 입력·IME 시험과 최신 vi 시험의 실행 파일 해시가 달라 같은 빌드의 전체 인수로 합산하지 않는다. 100/150/200% DPI 검사는 사용자 승인으로 Windows 배포 전 수행한다. C# MVP, 사용자 하네스 설정, 실제 홈서버는 변경하지 않았다.

## 최신 수집기·vi 검증 (2026-10-08 정리)

- `record-manual.mjs --collection`과 schemaVersion 2를 추가했다. 원본 run ID·시각·관측자·파일 해시를 유지하며 독립 시험을 모은다. IME 회수와 vi 연속 흐름은 같은 실행의 순서를 강제한다. 정상 종료는 실제 종료 동작과 `process.json`으로 판정한다. DPI 보류는 승인자·시각·사유·배포 전 기한을 보존하며 통과와 구별한다.
- 실행 파일·lock 변경은 계속 거부한다. 전체 source inventory를 검증한 뒤 명시한 수집기 5개 파일만 달라진 경우에만 도구 변경으로 기록한다. 제품 및 입력 시험 도구 변경을 포괄적으로 제외하지 않는다.
- 전체 자동 실행 `20261006T163917-beaaac844bf84f488f2a54019a52f04d`: Rust 105, UI 12, Node 40, 실제 WebView 45, OpenSSH 1, 수동 도구 smoke 1; 실패·skip 0, fmt/clippy/두 빌드 통과. 이 결과는 아래 저장 형식 수정 **전** 실행이다. 수정 후 영향받는 수집기·runner 16개를 다시 실행해 통과했다.
- 실제 기록을 최종 검증기에 연결하자 `collection_deferral_invalid`가 재현됐다. 저장 시 보류 승인 객체를 요약 ID로 덮어쓰던 결함이었다. 저장·재검증 회귀를 먼저 실패시킨 뒤 원본 승인 내용을 유지하도록 수정했다. 수정 전 파일과 실패 결과는 보존하고 `*-v2.json`을 별도로 생성했다.

완료한 vi 실행은 `manual-d5bd628436654632a95da27f3d4c0a57`이다. Codex의 `@oai/sky` OS 키 주입으로 실제 vi를 조작했다. 사람의 물리 키보드 확인으로 표시하지 않는다.

| 순서 | 서버 관측 / 확인 |
|---|---|
| UserOwned 편집 | `76690d694241544f4e5f454449544f525f54455354` = `vi` Enter `i` + `BATON_EDITOR_TEST` |
| 편집 중 최대화·복원 | PTY `141×39 → 314×75 → 141×39`; 화면 증거 보존 |
| AgentOwned | `A`·`Esc` 입력 시도 뒤 수신 `""` |
| 회수 후 종료 | `1b3a71210d` = Esc `:q!` Enter; 원래 셸 프롬프트 복귀 |
| 보조 프로세스 확인 | 컨테이너 `ps`에서 vi 없음, SSH 세션과 bash PID 18 유지 |
| 앱 정상 종료 | UserOwned에서 관측 종료 클릭, exit 0, normalExit=true, forcedCleanup=false, 추적 자손 15개 모두 종료, fixture 잔존 0 |

원시 기록은 실행 폴더의 `observations.jsonl`, 화면은 `vi-*.png`, 관측 설명은 `vi-review.json`이다. 화면 캡처의 일부 글자 획 누락은 원시 바이트와 분리해 기록한다. 기존 사용자의 실제 화면 가독성 확인을 이번 실행의 직접 확인으로 바꾸지 않는다.

중단된 `manual-2ca082b0…`, `manual-fff83c26…`, `manual-0da21620…`는 이 완료 기록에 섞지 않았다. `0da21620…`에서는 접근성 클릭이 옆의 구간 시작 버튼에 들어가 기록이 덮어써지는 문제가 있었고 좌표 클릭으로 전환했다. 이후 중단 동안 시간 제한으로 강제 정리되어 전체 vi 완료 증거에서는 제외했다.

빌드별 검증 파일은 `artifacts/rust-phase-2/reconciliation-20261007/`에 있다.

| 파일 | 관측됨 | 미확인 / 보류 |
|---|---|---|
| `historical-collection-v2.json` | 이전 빌드의 입력·IME·마우스·창 복귀·top·종료 9개 | 같은 빌드의 연속 vi 없음; DPI 3개 보류 |
| `current-collection-v2.json` | 최신 빌드의 연속 vi·정상 종료 2개 | 입력·IME 등 8개는 이전 빌드 기록만 있음; DPI 3개 보류 |
| `current-summary-v2.json` | 최신 자동 결과 + 최신 vi/종료를 최종 검증기로 재검증 | `manual_pending`, failure=null, 실제 exit 2 |

최신 자동 실행에서 제품 exe 해시는 `A60F9C…`에서 `C6DC44…`, acceptance exe는 `F8DBE4…`에서 `E60279…`로 바뀌었다. 제품 소스를 수정하지 않았다는 사실만으로 바이너리 동등성을 입증할 수 없다. 변경 원인은 아직 확정하지 않았으며, 새 수집기는 이전 기록을 최신 빌드에 붙이는 시도를 `identity_changed:productExecutable`로 거부했다. 기존 기록은 폐기하지 않는다. 전체 gate를 닫으려면 실행 파일의 차이를 조사해 동등성 정책을 별도로 정하거나 고정된 최종 빌드에서 필요한 입력·IME 기록을 확보해야 한다. 지금은 사용자의 완료한 IME 시험을 무작정 반복하지 않는다.

원본 자동 `summary.json`과 원시 수동 기록은 수정하지 않았다. `current-summary-v2.json`은 검증용 사본이다. 전체 자동 검증의 WebView 45개는 Node 통합 시험에 포함되므로 별도 합산하지 않는다.

추가 대조: 이전/최신 자동 실행 사이 source inventory 차이는 명시한 수집기 5개 파일뿐이다. OS 빌드, Rust 1.88.0, Node 22.17.0은 동일하지만 WebView2는 `154.0.4258.53`에서 `154.0.4258.62`로 바뀌었다. 빌드 로그는 baton-app 재컴파일을 보여준다. 이 정보만으로 exe 해시 차이의 원인을 확정하지 않는다. 최종 저장 형식 수정 후에는 `collection.test.mjs`와 `record-manual.mjs`만 추가로 달라졌고 제품·시험 exe와 lock은 유지됐다. `final-audit.json`에 원본 무변경 및 재검증 결과를 남겼다.

## 수집기 구현 전 증거 대조 (2026-10-06 당시)

원본 자동 인수 `20261004T215359-4233aa2a57584dcc96c8aba1cf294f58`의 전후 identity, 아래 수동 실행 6개의 시작 identity, 현재 작업 폴더를 다시 대조했다. 소스 inventory 153개 파일의 합산 digest, Cargo/app npm lock, 제품/acceptance 실행 파일 SHA-256 **5개 값이 전부 일치**한다. 실행마다 기록 구간이 시작·종료 시각 안에 있는지도 확인했다. 원본과 캡처의 현재 해시를 포함한 대조 결과는 `artifacts/rust-phase-2/reconciliation-20261006/audit.json`, 재현용 읽기 전용 분석은 같은 폴더의 `audit.ps1`에 있다. 이 분석은 인수 gate나 사람의 확인서를 대신하지 않는다. 해시 일치는 다른 실행을 같은 세션으로 취급할 근거도 아니다.

| 항목 | 확보한 증거 | 남는 제한 |
|---|---|---|
| 키·붙여넣기 | 사용자 직접 조작. UserOwned의 `41` 및 bracketed UTF-8 본문, AgentOwned의 빈 수신 | 해당 구간의 전용 화면 캡처 없음. 원본 서버 기록과 대화의 사용자 확인은 있음. |
| IME 확정·차단 | 사용자 직접 한글 조합. 최신 실행에서 `ed959ceab88020` 정확히 1회 수신, AgentOwned 빈 수신 | 영문 모드에서 시도한 `72`는 IME 증거에서 제외. |
| 조합 중 회수 | 같은 실행에서 epoch 2→4, 이전 조합 빈 수신, 이후 새 조합 정확히 수신 | 양 소유 상태의 독립 입력 2건이 아니라 전환 전후의 연속 시나리오. |
| 마우스 | OS 클릭의 SGR 첫 셀 press/release 정확히 수신, AgentOwned 차단 | 현재 창·현재 배율의 한 셀. 다른 DPI 좌표 정확성으로 확대하지 않음. |
| 숨기기·최소화 후 복귀 | OS 조작 후 UserOwned `41`, AgentOwned 빈 수신, 화면 캡처 | 최소화 복귀는 창 활성화 API 사용. 작업 표시줄 클릭 경로와 동일하다고 주장하지 않음. |
| vi | 17자 본문·resize·AgentOwned 차단; 별도 실행에서 한 글자 입력 후 저장 없이 종료·셸 복귀 | 전체 시나리오를 한 편집 세션에서 마친 기록은 없음. 기존 두 실행을 합쳐 그런 기록으로 만들지 않음. |
| top | OS 키로 실행·resize·종료 키 차단·회수 후 셸 복귀, 프로세스 부재 확인 | 종료 키는 수신 기록 구간 밖. 캡처와 당시 보조 기록을 함께 사용. |
| 로컬 종료 | 정상 종료 3회, 강제 정리 3회. 모든 실행에서 추적 자손 종료·시험 컨테이너 잔존 0 | 정상 종료와 강제 정리는 별도 판정. acceptance 앱의 결과이며 제품 앱의 모든 종료 경로를 뜻하지 않음. |
| DPI 100/150/200 | 사용자 승인으로 Windows 배포 전까지 보류 | 현재 배율 수치도 미기록. 창 resize 성공으로 배율별 통과를 대체하지 않음. |

원격 서버 종료에 대해서는 **시험 컨테이너가 정리됐다는 사실만으로 SSH 셸이 연결 종료에 반응해 먼저 종료됐다고 결론 낼 수 없다.** 현재 로컬 종료 기록은 그 순서를 관측하지 않는다. 일반 SSH와의 동작 비교가 필요하면 컨테이너를 유지한 채 별도 연결에서 대상 셸/foreground PID를 관측해야 한다. 임의 background 작업의 종료를 보장하는 요구사항은 추가하지 않는다.

수집기 대조에서 드러난 문제는 다음과 같다. 이는 제품 결함 판정과 구별한다.

- `record-manual.mjs`는 한 실행 디렉터리의 마지막 case/mode 기록만 선택하고, 모든 case에 UserOwned/AgentOwned 두 레코드를 요구한다. 같은 빌드에서 나눠 수행한 독립 시험과 IME 전환 시나리오를 표현하지 못한다.
- 모든 부분 기록에도 `result.json`이 필요해 시간 제한으로 끝난 실행의 유효한 입력 관측을 제출하지 못한다. 해당 관측을 재사용하더라도 그 실행의 정상 종료를 인정하면 안 된다.
- 종료 전 양 소유 상태에서 빈 입력을 기록하는 것은 두 상태에서 각각 앱을 종료했다는 증거가 아니다. 프로세스 종료 기록과 실제 종료 시점의 상태가 필요하다.
- 사람의 실제 IME/클립보드 조작, Codex의 OS 입력 주입, JS 합성 입력을 구별해야 한다. 계획은 native UI automation을 허용한다. OS 입력 주입을 사람의 물리 조작으로 적거나 JS 합성을 OS 입력으로 인정하지 않는다.

당시 후속 제안은 동일한 빌드의 독립 case를 원본 run ID/관측 시각으로 참조하고, IME 전환처럼 연속성이 필요한 기록은 같은 실행에 묶는 것이었다. 사용자 승인 후 구현했으며 최신 상태는 위 절을 따른다. 아래 표와 관측은 이전 빌드의 이력으로 보존한다.

아래 검증 표의 자동 결과와 이후 연대순 기록은 당시의 상태를 보존한다. 과거의 ‘물리 13개 미확인’ 문구는 현재 관측까지 부정하는 뜻이 아니다.

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
| physical Windows | 실제 키·paste·IME·mouse·숨김/최소화·100/150/200% DPI·vi/top·종료 | [수동 절차](rust-phase-2-manual.md) | 현재 증거와 제한은 위 대조표 참고. DPI 3개 배포 전 보류. 기존 수집기 기준 최종 exit 2 유지. |

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
- `manual-evidence.json`은 관측 기록이며 암호학적으로 서명된 attestation이 아니다. 해시는 파일 변경·오래된 빌드를 검출한다. 사람의 직접 조작은 사용자 확인으로, native UI automation은 도구 실행 기록으로 출처를 구별한다. 해시만으로 어느 입력 경로를 사용했는지 증명하지 않는다.

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

## Windows 직접 조작 관측 (2026-10-05~06)

제품 소스와 실행 파일을 변경하지 않고 위 자동 인수 receipt로 수행했다. 아래 실행 ID의 디렉터리는 모두 `artifacts/rust-phase-2/` 아래에 있으며, 원본은 각 `observations.jsonl`이다. 사용자의 실제 키보드 조작과 Codex의 Windows 입력 주입을 구분한다. 후자는 `@oai/sky`로 실제 acceptance 창을 조작한 보조 증거이며 사람의 물리 입력 확인으로 등록하지 않았다. 서로 다른 실행의 부분 기록을 합쳐 같은 실행의 완전한 `manual-evidence.json`으로 만들지 않았다. **Task 8과 Phase 2는 계속 manual_pending이다.**

| 실행 ID | 조작 주체와 관측 | 판정 범위 |
|---|---|---|
| `manual-12763379bad4489786a293c3d8234f53` | 사용자: 영문 키 UserOwned `41`, AgentOwned 빈 문자열. 정정된 Ctrl+Shift+V 붙여넣기는 `BATON_PASTE 한글 😀`의 UTF-8 앞뒤에 bracketed paste 프레이밍이 정확히 붙고, AgentOwned는 빈 문자열. Codex: 숨기기/복귀 뒤 `A`는 UserOwned `41`, AgentOwned 빈 문자열. | 입력 전달·차단의 서버 바이트 확인. 최초 붙여넣기의 `16` 접두사는 사용자가 먼저 누른 Ctrl+V와 일치한다. 화면 품질 및 전체 물리 인수 판정은 별도다. |
| `manual-2d4def31db1248dfb0c3225111db771e` | Codex: 최소화/활성화 복귀 후 UserOwned `41`, AgentOwned 빈 문자열. | 작업 표시줄 클릭 대신 Windows 창 활성화 API로 복귀했다. IME 시도는 한글 조합을 만들지 못했고, 최초 vi 시도 `160d`는 기대한 `vi` 입력이 아니므로 통과가 아니다. `result.json`은 정상 종료와 추적 자손 11개 종료를 기록하지만 종료 버튼의 직접 관측은 없다. |
| `manual-4c56ff5da42d44ff8e5ba7d990219c7b` | Codex: `vi`+Enter, `i`, `BATON_EDITOR_TEST`가 정확히 수신됨. AgentOwned에서 `A`와 Esc 시도는 빈 문자열. 편집 중 PTY 크기 `141×39 → 314×75 → 141×39`. | 입력·차단·크기 변경 확인. 저장 없이 종료까지 완료하지 못했다. `process.json`은 **normalExit=false / forcedCleanup=true**이며 정상 종료 증거로 사용하지 않는다. 자손 12개 종료·컨테이너 잔존 0은 강제 정리 결과다. |
| `manual-650c26def172473f9b70b22bf54947cf` | Codex: `top`+Enter는 `746f700d`. PTY 크기 `141×39 → 314×75 → 141×39`. AgentOwned에서 `q`는 빈 문자열. 회수 후 `q`로 셸 복귀했고 시험 컨테이너의 `ps`에서도 top 소멸·bash 존속을 확인했다. | 대화형 top의 실행·크기 변경·종료 키 차단·회수 후 종료 확인. 종료 키 자체는 기록 구간 밖에서 보냈다. 배율별 DPI 검증과 화면 가독성 판정은 아니다. |

마지막 실행의 마우스 시험은 `docker exec`로 해당 격리 컨테이너의 `/dev/pts/0` 출력에만 `ESC[?1000h`와 `ESC[?1006h`를 보내 준비했다. 실제 입력은 Windows 클릭으로 만들었다. 1183×851 창의 `(12,110)` 위치, 터미널 첫 셀을 눌렀다 놓았으며 기대한 `ESC[<0;1;1M` + `ESC[<0;1;1m`과 서버 기록 `1b5b3c303b313b314d1b5b3c303b313b316d`가 일치했다. AgentOwned의 같은 클릭은 빈 문자열이다. 이후 같은 출력 경로로 두 마우스 모드를 껐다. 사용자 셸 명령 입력으로 준비한 시험과 구별한다.

마지막 실행은 양 소유 상태의 종료 전 기록을 남긴 뒤 **관측 종료 버튼을 직접 눌렀다**. 창이 사라지고 실행기가 exit 0으로 끝났다. `result.json`의 `normalExit=true`, `forcedCleanup=false`, `descendantAudit=verified`, 추적 자손 **13개 모두 exited=true**를 확인했고 `fixture-cleanup.json`의 잔존 컨테이너는 0이다. 이는 acceptance 앱과 소유 프로세스의 종료 증거다. 컨테이너는 시험 실행기가 제거하므로 이 결과만으로 원격 SSH 셸이 컨테이너 제거 전에 종료됐다고 판단하지 않는다. 임의의 원격 백그라운드 작업 종료도 증명하지 않는다.

마지막 실행에 `computer-top-{maximized,user,agent,exited}.png`, `computer-mouse-{user,agent}.png`, `computer-exit-{user,agent}.png`를 저장했다. 이전 vi 실행의 `computer-vi-maximized.png`는 작은 부속 창 캡처일 수 있어 크기 변경 화면의 유효 증거로 사용하지 않는다. 서버 `sizes` 기록은 별도로 유효하다.

남은 사항: 실제 한글 IME 확정 및 조합 중 회수, 실제 Windows 100/150/200% 배율별 비교, vi 저장 없이 종료의 추가 관측, 화면 품질 확인, 사용자 판정·화면 증거를 포함한 최종 물리 인수 기록. 컴퓨터 제어의 `Hangul` 키는 unsupported 오류였고 `type_text`는 이 환경에서 Ctrl+V 바이트를 만들어 텍스트 타이핑 대체로 사용할 수 없었다. 이후 ASCII 시험은 개별 키 입력으로 수행했다. 한글 문자열 붙여넣기를 IME 조합 시험으로 대체하지 않는다. 캡처에서 글자 획이 누락되어 보이지만 실제 표시 결함인지 캡처 경로 문제인지 아직 구분하지 못했다. 이 현상을 화면 품질 통과나 제품 결함 확정으로 기록하지 않는다.

### 2026-10-06 추가 확인

사용자가 실제 화면에서는 글자가 깨지지 않았다고 직접 확인했다. 따라서 캡처의 획 누락을 사용자 화면의 렌더링 결함으로 취급하지 않는다. 캡처 경로의 정확한 원인은 별도로 미확정이며, 이 확인이 아직 수행하지 않은 DPI 배율별 가독성까지 증명하지는 않는다.

`manual-70a108499fdf4bfb9a55f8676d72e47d`에서 Codex가 개별 Windows 키 입력으로 `vi`+Enter → `i` → `A` → Esc → `:q!`+Enter를 수행했다. 서버 수신 `76690d69411b3a71210d`가 의도한 바이트와 일치한다. 미저장 표시가 있는 편집 화면에서 셸 프롬프트로 복귀했고, 해당 격리 컨테이너의 `ps`에서 vi가 없고 bash가 남아 있는 것을 확인했다. 화면은 실행 디렉터리의 `computer-vi-unsaved.png`, `computer-vi-exited.png`에 저장했다. 이전 실행의 긴 문자열·소유권 차단·resize 관측을 반복하지 않고 누락됐던 저장 없는 종료 경로만 보완한 것이며, 한 실행의 전체 물리 인수 통과로 합산하지 않는다.

같은 실행에서 사용자가 한글 IME를 직접 조작했다. `ime-commit / user_owned`의 수신값은 `676b73727f7f7f7f7f7fed959ceab88020`이다. 이는 영문 `gksr`, Backspace 6회, `한글`과 Space 순서다. 사용자는 영문 입력을 지우고 한글로 다시 입력한 것이 맞다고 확인했다. 따라서 이 관측에서 한글 본문과 Space는 중복·누락 없이 수신됐으며, 선행 ASCII/삭제 바이트는 제품이 임의 생성한 입력이라는 증거가 아니다. 순수 한글만 입력한 구간으로 바꾸어 기록하지 않는다. `human-ime-user-with-editing.png`와 `ime-user-review.json`에 원본·사용자 확인을 보존했다. AgentOwned 차단 및 조합 중 소유권 전환은 아직 별도 검증이 필요하다.

이 실행은 사용자 응답 대기 후 창이 사라졌고, 정리 기록은 `normalExit=false / forcedCleanup=true / descendantAudit=verified`, 자손 12개 종료, 컨테이너 잔존 0이다. 이미 보존된 입력 관측은 유지하되 정상 종료 증거로 재분류하지 않는다. 차단 시험은 새 실행 `manual-acdbb3dfae56481693c0aedb1090452f`에서 준비했다.

새 실행에서 사용자가 AgentOwned 상태의 한글+Space 입력 시도를 완료했다고 확인했다. `ime-commit / agent_owned` 관측(2026-10-06T05:38:43.874Z)은 `serverObserved=true`, `receivedHex=""`로 **0바이트 차단**을 확인했다. 화면은 `human-ime-agent.png`에 보존했다. 앞선 UserOwned 한글 수신과 이번 AgentOwned 차단은 각각 유효한 부분 관측이며, 서로 다른 실행을 단일 실행의 인수 증거로 합치지 않는다. 조합 중 소유권 전환과 전환 후 새 조합은 다음 관측 대상이다.

같은 실행의 조합 중 회수 첫 시도는 `72`(영문 r)를 수신했다. 사용자가 실제로 영문 r이 보였다고 확인했으므로 한글 조합 시험에서 제외했다. 미실행 r을 구간 밖에서 Ctrl+U로 지우고 새 구간을 시작했으며, 기존 compositionstart 예약을 중복 등록하지 않았다. 재시도에서는 사용자가 한글 ㄱ 입력과 대기를 완료했다고 확인했고, 캡처의 접근성 상태에서 `user_owned · epoch 4`를 확인했다(전환 전 epoch 2). 2026-10-06T05:43:09.440Z 수신 기록은 빈 문자열로, 예약된 AgentOwned→UserOwned 전환과 해당 조합의 서버 미전달을 확인했다. `human-ime-reclaim-epoch4.png/.txt`, `human-ime-reclaim-blocked.png`, `ime-reclaim-review.json`에 증거를 보존했다. 전환 후 새 조합의 정상 입력은 별도 구간에서 추가 확인한다.

전환 후 새 구간에서 사용자가 직접 `한글`과 Space를 입력했다. 2026-10-06T05:44:56.109Z의 `ime-commit / user_owned` 서버 기록은 기대값 `ed959ceab88020`과 정확히 일치했다. 이전 조합은 전달되지 않고 새 조합은 정상 전달되는 경로를 확인했으며 화면은 `human-ime-fresh-after-reclaim.png`에 저장했다. 이 실행 안에서 AgentOwned 한글 입력 차단, 조합 중 전환의 0바이트 수신, 전환 후 새 한글 입력을 관측했다.

그 뒤 Codex가 관측 종료 버튼을 눌러 이번 실행을 정상 종료했다. 실행기 exit 0, `normalExit=true`, `forcedCleanup=false`, `descendantAudit=verified`, 추적 자손 11개 모두 종료, 시험 컨테이너 잔존 0을 확인했다. 현재 시험 앱은 닫혀 있다. 다음 검증 대상은 실제 Windows DPI 100/150/200%이며, 최종 인수 기록의 필수 case/mode·사용자 판정·같은 실행 요건도 아직 충족하지 않았다. **이번 IME 관측이 전체 Phase 2 완료를 뜻하지는 않는다.**

### DPI 범위 조정 — 사용자 승인

위 후속 순서는 2026-10-06 사용자 승인으로 변경했다. 현재 배율에서 창 크기 변경을 확인하고, 실제 Windows 100/150/200% 전수 검사는 **Windows 배포 전**으로 미룬다. 현재 작업에서 배율을 바꾸거나 같은 창 최대화·복귀 시험을 다시 요구하지 않는다. 기존 vi/top 시험의 서버 PTY `141×39 → 314×75 → 141×39` 기록을 재확인했으며 크기 전달 경로의 증거로 재사용한다. 사용자는 실제 화면의 글자 깨짐이 없다고 확인했다. 당시 배율 숫자는 미확인이므로 어떤 `dpi-*` case도 통과로 표시하지 않는다. 다른 배율에서의 화면 잘림·가독성·마우스 좌표 오차는 배포 전 확인할 잔여 위험이다.

이 변경은 수행 시점과 범위에 대한 합의이며 기존 검증 결과의 수정이 아니다. 소스·실행 파일·기존 receipt와 전체 인수 수집기의 13개 목록은 그대로 유지했다. 현행 도구의 `manual_pending / exit 2`와 나머지 증거 정리 작업은 남아 있다. 미실시 배율을 관측했다고 작성하거나 전체 Phase 2 완료를 선언하지 않는다.
