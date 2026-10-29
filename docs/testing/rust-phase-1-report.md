# Rust Phase 1 — session core 검증

2026-09-27. SDK와 무관한 코어 구현 및 자동 검증 결과다. 실제 SSH·MCP·WebView를 연결한 제품 인수 결과가 아니다. 전체 변경 리뷰는 아래에 별도로 기록한다.

## 실행 결과

- 환경: Windows, `rustc +stable` 1.88.0, edition 2024.
- 명령 V: `pwsh -NoProfile -File rust/scripts/verify-phase-1.ps1 -Mutation` → exit 0.
- 명령 R: `pwsh -NoProfile -File rust/tests/phase-1-runner.test.ps1` → exit 0.
- 코어 55 passed / 0 failed / 0 ignored; runner 음성 시험 2 passed / 0 failed / 0 skipped.
- fmt 및 clippy `--all-targets -- -D warnings` 통과. 기존 workspace 포함 64개 시험도 최종 수정 후 통과했다. probe 의존성 pin은 변경하지 않았다.
- 증거: `artifacts/rust-phase-1/summary.json`, `mutation-summary.json`, 단계별 `.log`. 이 경로의 파일은 로컬 실행 산출물이며 Git에 포함하지 않는다.
- 실행 당시 commit: `a90918d6fce22ab5eb4a67dae0e41ac0f6968cae`, dirty=true (리뷰 수정 검증 중). 실행 소스는 아래 SHA-256으로 식별하며 실행 전후 동일함을 확인했다. 커밋된 깨끗한 트리에서 실행했다고 주장하지 않는다.
- sourceDigest: `1300D034554496DB3383E6F92C139C035BCACD3237EC7C20E5F829271F107014`.
- 실행 시간: `37.79`초. 원본을 복사한 무변이 기준선의 전체 시험도 통과했다.

| ID | 담당 시험 | 관측 효과 | 명령 | pass / fail / skip | 제한 |
|---|---|---|---|---|---|
| NUM-01, IN/LIFE 단위 | numbers 2 + lib 5 | 부정확한 정수·중복·counter 순환 거부, 입력 무효화, 종료 경쟁 | V | 7 / 0 / 0 | wire 전체는 단계 3 |
| OWN-01~05 | ownership 7 | 배정별 조회, 회수/단절 순서, 닫힘 복원 금지 | V | 7 / 0 / 0 | 인증 IPC 연결 전 |
| IN-01~03 | input 11 | 100회 중복 입력 효과 1, foreign/old epoch 효과 0, 큐·이력 상한 | V | 11 / 0 / 0 | 전달은 명령 실행 완료가 아님 |
| OUT-01~05, UI-03 코어 | output 11 | UTF-8 분할·오류, UTF-16 ring/page, 비공개 구간 차단, UI ack/예산 | V | 11 / 0 / 0 | 실제 xterm 소비 전 |
| OWN/IN/OUT 경쟁, LIFE-02 코어 | races 17 | 첫 poll/회수 장벽, read 반환 전 재검사, 8 reads/16 requests/32 queue, 5초 종료 | V | 17 / 0 / 0 | 합성 transport, 원격 프로세스 종료 증거 아님 |
| 독립 모델 | model 2 | 1,000 seeds × 200 events, 축소기 검증 | V | 2 / 0 / 0 | 동기 정책 모델; 실제 네트워크 아님 |
| runner 실패 전파 | phase-1-runner.test.ps1 | cargo exit 7 및 numbers 누락을 runner exit 1로 보고 | R | 2 / 0 / 0 | 대역 실행기는 시험 인자로만 사용 |

표의 commit/hash는 위 실행 receipt에 공통으로 적용한다. lib 다섯 시험은 숫자뿐 아니라 입력 무효화와 종료 경쟁도 포함하며 별도 합산하지 않는다.

모델 실제 관측: accepted=67,867, rejected=132,133, transition_observations=4,150. 15종 이벤트가 모두 발생했다. 참조 모델은 제품 Session/Registry/Input/PublicOutput을 호출하지 않고 자체 자료구조와 정책을 사용한다. 모델 수신은 완성된 Unicode 문자열이며 바이트별 분할·오류는 output 시험에서 검증한다.

## 변이 검출

`test-core-mutants.ps1`은 고유 실행 디렉터리의 독립 workspace에서 기존 dependency pin을 유지한다. 모든 사본은 먼저 컴파일에 성공해야 하고, 지정 시험의 assertion 실패만 killed로 센다. 컴파일·환경 실패는 검출 성공이 아니다. 원본 코어 hash는 실행 전후 동일하다.

| 변이 | 실제 실패 시험 | 컴파일 | assertion 검출 |
|---|---|---|---|
| owner input 권한 비교 제거 | foreign_and_stale_inputs_and_results_have_zero_effect | 통과 | 검출 |
| epoch 비교 제거 | foreign_and_stale_inputs_and_results_have_zero_effect | 통과 | 검출 |
| 비공개 출력까지 public buffer에 보존 | public_history_never_comes_from_ui_and_reemitted_private_text_is_public | 통과 | 검출 |
| 같은 request_id 재등록을 queue에 추가 | duplicate_input_has_one_effect_and_conflict_has_none | 통과 | 검출 |

결과는 **이번 단계 4/4**다. 재접속 ID 재사용의 다섯 번째 변이는 단계 4에 남는다. private 변이는 단순 조건 삭제의 missing-buffer panic을 피하려고 buffer 생성·전환 유지까지 함께 바꾼 하나의 논리적 결함이다. 세 anchor 각각 정확히 1회 일치할 때만 치환한다.

## 구현 판단과 비용

1. Windows에서 skill의 bash helper가 basename/dirname을 찾지 못해 PowerShell로 task brief/ledger를 관리했다. 판단이 틀리면 기록 누락 위험이 있으므로 task별 증거와 commit을 대조했다.
2. transport worker와 세션 actor를 단일 task/단일 in-flight future로 합쳤다. 첫 poll은 회수와 같은 짧은 mutex 구간에서 수행하고, control/read 최종 검사는 일반 입력 큐를 거치지 않는다. 큐 예약과 실제 시작 간 틈을 없애는 선택이며, 비용은 공유 gate 경합·기아 가능성이다. bounded 처리와 실제 Tokio 경쟁 시험으로 검증했다.
3. private 변이는 세 위치를 함께 바꿔 실제 누출을 만들었다. 조건 하나만 삭제하면 assertion 대신 버퍼 부재 panic이 나므로 유효한 검출로 셀 수 없다. 비용은 단일 줄 결함 검출력과 동일하게 해석할 수 없다는 점이다.

## 자원 상한과 남은 인수

입력 중복 비교를 위한 원문 payload의 정책상 최대는 `4096 × 16 KiB = 64 MiB/셸`, 16셸에서 **1 GiB**다. 실제 측정 메모리가 아니다. map/queue metadata, active write 복사, 공개 Unicode ring, UI 1 MiB 예산, runtime 채널과 allocator overhead는 별도다. 이 상한 축소는 근거와 설계 변경을 동반해야 한다.

실제 키·붙여넣기·IME·마우스·숨김/최소화와 WebView 하위 프로세스 종료는 [단계 0 보고서](rust-phase-0-report.md)의 미확인 상태를 유지하며 단계 2 완료 조건이다. 단계 0 runner의 exit 2/blocked를 통과로 바꾸지 않았다. SSH 어댑터의 drop이 원격 SSH 연결·프로세스에 미치는 결과, 실제 resize·인증, MCP frame·직렬화·ID 난수·재접속, sudo 개입 UX, 앱 전체 종료와 배포본 인수는 단계 2~5에서 검증한다.

## 전체 변경 리뷰

별도 gpt-6-astra 리뷰어가 `fdf8356..a90918d`를 읽기 전용으로 검토했다. Important 2개, Minor 1개를 보고했다. 중요한 두 문제는 구현자가 한 번의 수정 단계에서 아래 회귀 시험의 실패를 먼저 재현하고 수정했으며, 전체 시험과 변이를 다시 통과했다. 수정 후 별도 재리뷰는 수행하지 않았다.

| 발견 | 수정 | RED → GREEN 증거 |
|---|---|---|
| 큐에 들어온 비공개/이전 public 출력이 전달 후 새 public에 노출 | ingress 공개 epoch를 기록하고 처리 시 재검사; UI 출력 유지 | `queued_receive_never_crosses_into_a_later_public_epoch`: OLD_BOUNDARY 누출 assertion 실패 → 두 경로 통과 |
| attach와 shutdown 경합 시 새 driver가 종료 대기 대상에서 누락 | registry gate에서 attach 등록과 shutdown의 stop/대상 확정/close 직렬화 | `runtime::tests::shutdown_joins_attach_admitted_before_close_gate`: shutdown 반환 시 drop 0 assertion 실패 → drop 1 통과 |

종료 경쟁 재현용 barrier hook은 `cfg(test)` 내부에만 있고 제품 바이너리에 포함되지 않는다. 멈춘 transport의 close와 실제 drop을 관측하며 시간 지연 추측에 의존하지 않는다.

**보류 Minor:** 모델 생성기가 사건 선택과 유효성 선택에 같은 난수의 modulo를 사용해, 무작위 Read는 stale epoch/stream을 선택하지 않는다. 해당 거부 동작은 개별 output/race 시험에서 검증된다. 독립 난수 draw와 invalid-read별 coverage counter는 후속 작업이다. 20만 이벤트가 이 조합까지 포함한다는 뜻으로 해석하면 안 된다.

## 리뷰에서 범위 밖으로 분류한 항목에 대한 판단

다음 모두를 명시적으로 후속 인수 대상으로 유지한다. 단계 1의 자동 시험 통과로 완료 처리하지 않는다.

| 항목 | 판단 | 틀렸을 때의 비용 |
|---|---|---|
| 실제 SSH write/socket/원격 프로세스 종료 | transport 통합 때 실제 검증 | 합성 close를 원격 정리 완료로 오인 |
| 키·IME·마우스·xterm·resize·terminal reply·WebView | 단계 2 필수 인수 | 실제 UI 실패 누락 |
| IPC 인증/frame/MCP 직렬화·취소/caller identity | 단계 3 필수 인수, core ID 자체는 인증 아님 | 위조 호출·잘못된 frame 우회 |
| 안전한 ID 발급·재접속 유일성 | 단계 3~4 필수 | ID 재사용으로 격리 약화 |
| live Runtime 등록·연결 완료·닫힌 세션 교체 | 통합 단계에서 명시적 lifecycle API 추가 필요 | 현재 preconstructed Registry로 새 연결/교체 불가 |
| 사용자 개입 알림·sudo 승인/인증 UX | UI/adapter 단계 | 승인·인증 흐름 완료 불가 |
| closed/stale 결과의 MCP uncertain 매핑 | 후속 계약에서 rollback 불가 의미 유지 | 이미 보낸 명령을 재시도할 위험 |
| 실측 메모리·경합/기아·fuzz/soak·배포 Windows·macOS/Linux | 후속 실측 인수 | 과부하·기아·플랫폼 실패 누락 |
| 전환 전 원격 생성되었지만 이후 도착한 출력 | 원격 생성 시각은 알 수 없으므로 로컬 수신 경계 적용; 이미 큐에 들어온 데이터는 재분류 금지 | 공개 구간을 명령 발생 시점의 비밀 보장으로 오인 |
| private 단일 줄 guard 변이 검출력 | 문서화한 복합 논리 변이 4/4만 주장 | 단일 줄 삭제 검출력을 과장 |

수신 경계 판단의 비용: 전달 직전 수신한 데이터는 공개 스트림에서 보수적으로 빠질 수 있다. 사용자 UI에는 보존되며 다음 에이전트 구간으로 넘기지 않는 것이 우선이다.
