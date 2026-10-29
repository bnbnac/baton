# Windows IPC 초기화 진단 보강

2026-10-11 KST. 기준 `f7b65e1`. **과거 간헐적 초기화 실패는 재현되지 않았고 원인은 미확정이다.** 이번 변경은 오류를 숨기거나 재시도로 통과시키지 않고, 다음 실패에서 확인할 증거를 보강한다.

## 과거 증거에서 확인한 범위

Phase 4의 `partial_frame_survives_dispatch_completion` 실패는 `LocalServer::start` 안에서 발생했고 reader/frame 처리 이전이었다. 당시 로그 `artifacts/rust-phase-4/20261009-lifetime/task2-rust-green.log`와 같은 시각(2026-10-08 20:04:33 UTC)의 `artifacts/phase3-ipc/auth-179148987325*` 디렉터리 9개를 읽기 전용으로 조사했다.

9개의 디렉터리 이름은 모두 다르고 각각 `app.lock`이 존재한다. 현재 ACL은 기대한 단일 사용자 보호 ACL이다. 따라서 해당 실행의 디렉터리 이름 충돌은 제외할 수 있다. 그러나 실패한 시험과 각 디렉터리의 대응, 당시 app ID, 실패 API/Windows 오류는 저장되지 않아 pipe 충돌이나 다른 원인을 확정할 수 없다. 지금의 ACL 상태가 당시 모든 검사가 통과했다는 증거도 아니다.

## 변경

- 기본 빌드에서는 제외되는 `baton-ipc/endpoint-diagnostics` feature를 추가했다. 단위 시험에서는 자동으로 활성화된다.
- 동기 endpoint 호출의 첫 실패만 thread-local 슬롯 하나에 보관한다. 정적 operation, 오류 발생 줄 번호, API에서 직접 얻은 경우에 한해 native 오류 번호를 담는다. 경로·SID·비밀·터미널 데이터는 담지 않고 stdout/stderr에도 자동 출력하지 않는다.
- `CreateFileW`, `named_pipe.create`, `secret.generate`를 구분한다. 기타 `failure()` 경로는 `validation_or_unclassified`와 소스 줄 번호를 남기고, 오래된 GetLastError 값을 추측해 기록하지 않는다.
- `take_startup_failure()`로 호출 직전 기록을 비우고 직후 소비한다. await를 건너 스레드가 바뀌면 사용할 수 없는 진단이다. `server_auth` fixture의 `LocalServer::start`는 현재 내부 await 없이 첫 poll에서 게시를 마치므로 이 방식이 적용된다. 추후 구현이 바뀌면 함께 검토해야 한다.
- 정상 시작/거부 정책과 wire 오류는 유지한다. 기본 배포 빌드에 진단 feature를 켜지 않는다.

## 시험 결과

증거: [로컬 summary](../../artifacts/ipc-startup-diagnostics/summary.json).

| 검증 | 결과 |
|---|---|
| 진단 회귀시험 RED | 잠금 오류 기록 누락으로 실패 (`red.log`) |
| 독립 리뷰 후 난수 실패 주입 RED | 난수 오류 기록 누락으로 실패 (`entropy-red.log`) |
| 최종 IPC/adapter all-targets, 진단 feature 활성 | 53 pass, 0 fail, 0 ignored (`regression-final.log`) |
| 병렬 신규 endpoint | 9개씩 12회, 총 108개 시작·읽기·정리 성공; 재시도 없음 |
| fmt check | exit 0 |
| 진단 feature 활성/비활성 clippy | 각각 exit 0, `-D warnings`, `CARGO_INCREMENTAL=0` |

실제 잠금 충돌은 CreateFileW 오류 32, 서로 다른 디렉터리에서 동일 app ID로 pipe를 만드는 충돌은 named_pipe.create 오류 5로 기록됐다. 이것은 알려진 두 실패 조건의 진단 검증이며 과거 실패의 원인 재현은 아니다. 난수 실패는 의존성에 실패를 주입해 재현했고, 게시되지 않음과 잠금 해제 후 새로운 독립 시도가 가능함을 확인했다. OS 난수원 자체를 고장 낸 시험은 아니다.

```text
cargo +stable test --offline --locked --manifest-path rust/Cargo.toml -p baton-ipc -p baton-adapter --all-targets --features baton-ipc/endpoint-diagnostics
cargo +stable fmt --all --manifest-path rust/Cargo.toml -- --check
# 아래 clippy는 실행 프로세스에서 CARGO_INCREMENTAL=0으로 실행
cargo +stable clippy --offline --locked --manifest-path rust/Cargo.toml -p baton-ipc -p baton-adapter --all-targets --features baton-ipc/endpoint-diagnostics -- -D warnings
cargo +stable clippy --offline --locked --manifest-path rust/Cargo.toml -p baton-ipc -p baton-adapter --all-targets -- -D warnings
```

기본 feature clippy 최초 실행은 Rust 1.88의 `rustc_query_system/dep_graph`에서 bounds panic(exit 101)으로 실패했다. 로그 `clippy-default.log`를 보존했다. 소스를 바꾸지 않고 증분 컴파일 사용만 끄자 통과했다. 캐시를 지우거나 도구 버전을 바꾸지는 않았다. 이 결과를 애플리케이션 초기화 오류의 원인과 연결하지 않는다.

독립 리뷰에서 ① 병렬 fixture 준비가 실패하면 다른 작업이 barrier에 남을 수 있음 ② 난수 생성 실패 진단 누락을 발견했다. 전자는 모든 실패 가능한 입력 준비를 작업 생성 전 완료하도록 바꾸고 해당 병렬 시험을 재검증했다. 후자는 실패 주입 RED→GREEN으로 수정했다. 최종 관련 suite를 다시 실행했다. 기본/진단 feature 모두 lint를 확인했으며 GUI·SSH·IME·DPI 전체 인수는 반복하지 않았다. 실제 cleanup 실패 주입과 별도의 thread 격리 시험은 수행하지 않았다. 수정 이후 두 번째 독립 리뷰는 하지 않았다.

## 다음 작업

2026-10-13 [후속 조사](rust-startup-followup-report.md)에서 어댑터 공통 fixture가 이 진단을 활성화·소비하지 않던 누락을 보완했다. 제한된 재현 조사에서는 실패가 관측되지 않았고, 관련 시험 56개가 통과했다. 과거 간헐 실패의 원인 확정이나 출시 차단 해제는 아니다.

이 변경으로 미해결 flakiness 출시 차단 조건을 해제하지 않는다. 동일 성공 시험의 무한 반복 대신, 향후 IPC 실패가 발생하면 진단 feature로 위 명령을 실행해 첫 operation/줄/native 오류를 보존한다. Phase 5의 배포본 생성·인수 자동화 준비는 병행할 수 있지만 실제 하네스·패키지·원격 종료·부하·퍼징 인수와 이 실패 원인 검토가 끝나기 전 출시 완료로 표시하지 않는다.
