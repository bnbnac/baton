# Windows IPC 초기화 실패 후속 조사

2026-10-13 KST. 기준 `b1d5e5c`. **간헐적 `AuthenticationFailed`의 원인은 여전히 미확정이다.** 실패 경로에 진단 수집이 빠진 사실을 확인하고 시험 코드를 보완했다. 제품의 인증·초기화 동작은 변경하지 않았고 출시 차단도 해제하지 않는다.

## 출발 증거와 가설

[하네스 후속 검증](rust-phase-5-harness-followup-report.md)의 `green-2.log`에서 `stdio_online_output_errors_then_offline_has_no_cached_identity`가 `tests/common/mod.rs:136`의 `LocalServer::start`로 실패했다. 명령 전송이나 request_id 검증 전에 발생했다.

[기존 초기화 진단](rust-startup-diagnostics-report.md)은 opt-in feature이며 IPC의 `server_auth` 시험에서 소비하도록 되어 있었다. 어댑터 시험의 `setup`에는 feature 활성화와 수집이 모두 없었다. 따라서 이번 실패 기록에도 Windows API·native 오류가 남지 않았다.

어댑터 fixture는 디렉터리 이름과 app ID를 각각 `SystemTime::now().as_nanos()`로 만든다. pipe 이름은 app ID에서 만들어지므로 같은 시각 값이 재사용되면 디렉터리가 달라도 충돌할 수 있다는 가설을 세웠다. 제품 UI는 `getrandom`으로 128비트 app ID를 생성하므로 시험의 시각 기반 ID와 다르다. **이번 조사에서 실제 중복 ID나 그에 따른 간헐 실패는 관측하지 못했다.** 가설만으로 fixture ID나 제품 코드를 교체하지 않았다.

## 제한된 재현 조사

증거 폴더: `artifacts/startup-followup-20261013/`.

| 조사 | 관측 |
|---|---|
| 기존 `stdio_online` 5개 시험, 최대 20회·실패 시 즉시 중단 | 20회 모두 통과, `reproduce-1.log`~`reproduce-20.log`. 진단을 켜고 기존 ID 생성은 유지 |
| 같은 fixture로 동시 초기화 확대 | 16 worker runtime, 64개 task × 10 round, **640건 성공**. `concurrent-probe.log`; 임시 조사 소스는 `startup_probe.rs`로 증거 폴더에 보존하고 상시 suite에서는 제거 |
| 이전 실패 시점의 디렉터리 확인 | 인접 실행까지 포함한 14개 이름 모두 다름, 각 `app.lock`만 남음. `prior-directories.json`. 특정 실패 시험과 디렉터리의 대응 및 당시 app ID는 복구하지 못함 |

640건은 endpoint 초기화 조사이며 앱 프로세스 수명 640회나 실제 SSH 시험이 아니다. 서버는 각 round에서 shutdown했다. 시험 디렉터리는 조사 증거로 보존한다. 성공 횟수로 원인이 제거됐다고 해석하지 않고, 이 범위를 넘는 확률적 반복은 중단했다. 조사 시점의 진단·동시성 조건도 과거 실행과 완전히 같지 않다.

## 확인된 진단 누락 보완

- 어댑터의 **dev-dependency**에서만 `baton-ipc/endpoint-diagnostics`를 켰다. `cargo tree --edges normal,build,features`에서 일반 어댑터 의존 경로에 해당 feature가 없음을 확인했다. 제품 기본 의존성·wire 오류·배포 ZIP은 그대로다.
- 공통 fixture의 `start_server`가 시작 직전 이전 진단을 비우고 직후 첫 진단을 소비한다. 실패에는 경로·app ID·wire 오류·operation·native 오류·소스 줄을 함께 남긴다. 성공 정보도 test stderr에 기록하므로 `--nocapture` 로그에서 다른 초기화와 비교할 수 있다. secret·SID·터미널 출력은 기록하지 않는다.
- `LocalServer::start`가 현재 첫 poll에서 동기 게시를 끝낸다는 구현 조건을 코드 주석으로 남겼다. 내부에 실제 suspension이 추가되면 thread-local 수집 방식을 재검토해야 한다.
- 이 보완은 공통 `setup` 경로 대상이다. 다른 시험에서 직접 호출하는 모든 `LocalServer::start`를 일괄 계측한 것은 아니다.

추가 회귀시험 `fixture_startup_failure_identifies_lock_and_pipe_collisions`는 실제 서버를 유지한 상태에서 같은 디렉터리 잠금과 다른 디렉터리의 같은 pipe 이름 충돌을 각각 만든다. 기존 unwrap 방식에서는 원인 정보가 없어 실패했다(`diagnostics-red.log`). 보완 후에는 각각 `CreateFileW`/32, `named_pipe.create`/5가 fixture 실패 기록에 남으며 두 게시 파일도 정리됨을 확인했다. **알려진 실패 조건의 진단 검증이지 과거 간헐 오류 원인의 재현이 아니다.**

## 최종 검증과 다음 판단

```text
cargo +stable test --manifest-path rust/Cargo.toml --offline --locked -p baton-ipc -p baton-adapter --all-targets
cargo +stable clippy --manifest-path rust/Cargo.toml --offline --locked -p baton-adapter --all-targets -- -D warnings
cargo +stable fmt --all --manifest-path rust/Cargo.toml -- --check
```

`CARGO_INCREMENTAL=0`, 현재 Windows x64에서 실행했다. IPC·어댑터 관련 전체 시험은 기본 병렬 설정으로 **56 pass, 0 fail, 0 ignored** (`regression.log`), clippy와 fmt는 exit 0이다. 독립 리뷰는 이번 작은 시험 진단 변경에 별도로 수행하지 않았다. 제품 UI·SSH·이미 통과한 하네스 시험은 반복하지 않았다.

원인이 확인되지 않았으므로 제품 재시도나 인증 완화는 추가하지 않았다. 다음 동일 실패에서는 수정된 공통 fixture의 panic에 API·native 오류가 남는다. 시각 ID 충돌을 확인하려면 실패 app ID와 같은 실행의 성공 로그를 비교해야 하므로 원인 조사 실행에는 `-- --nocapture`를 사용한다. 현재 기록으로 과거 Phase 4 실패와 이번 실패가 같은 원인이라고 묶을 수 없다. 다른 Phase 5 인수는 계속할 수 있지만 초기화 오류의 출시 차단은 유지한다.

## 2026-10-29 기록·호출 경로 재분류

기준 HEAD `f2c7e80`. 기존 로그와 소스 이력을 읽기 전용으로 대조했다. 새 시험·제품 수정·Cargo 변경은 수행하지 않았다. `AuthenticationFailed` 문자열은 endpoint 게시의 잠금·pipe 생성·ACL·암호화·파일 게시 실패에도 사용된다. 이 문자열만으로 클라이언트 인증 검사 결함이나 인증 우회를 뜻한다고 해석하면 안 된다.

| 실패 기록 | 실패 지점과 당시 식별자 | 분류 |
|---|---|---|
| `artifacts/rust-phase-4/20261009-lifetime/task2-rust.log` | `lifetime.rs:39`, 첫 `EndpointLease::publish`; 어댑터 프로세스를 시작하기 전 | [Phase 4 보고서](rust-phase-4-report.md)의 고정 app ID 75 중복 건. 보고서는 두 handshake fixture의 pipe 충돌과 난수 ID 변경을 기록한다. 미해결 두 건과 합산하지 않음 |
| 같은 폴더의 `task2-rust-green.log` | `server_auth.rs:152`, `LocalServer::start` 게시 중; 당시 시각 기반 디렉터리·app ID | 미확정. `cc9d92f`의 diff에서 이후 난수 ID로 교체하고 경로·ID panic을 추가했음을 확인했다. 변경 후 성공은 과거 충돌의 입증이 아님 |
| `artifacts/phase5-harness-fixes-20261013/green-2.log` | `common/mod.rs:136`, `LocalServer::start` 게시 중; 시각 기반 디렉터리·app ID | 미확정. 현재도 `setup`은 시각 기반 ID를 사용하며, `5ae72b5` 이후 공통 시작 함수에서 진단을 수집함 |

현재 `LocalServer::start`는 `EndpointLease::publish`와 첫 pipe 인수 후 serve task를 만든다. 두 미확정 실패는 이 초기 게시 단계에 있으므로 request ID 검증, 출력 읽기, handshake 이후 backend 인증 경로의 실패와 구별한다. 제품 앱 ID는 난수 생성 경로를 사용하지만 endpoint 게시 코드는 공유한다. 따라서 fixture 충돌 가설만으로 제품 영향이 없다고 단정할 수도 없다.

`reproduce-1.log`~`reproduce-20.log` 및 `concurrent-probe.log`의 `fixture_start` 행을 다시 파싱했다. 총 **740행**(기존 100+640) 모두 `Ok(()) diagnostic=None`이며, 각 로그 내부의 app ID 중복과 경로 중복은 각각 0이다. 새로 740번 실행했다는 뜻이 아니다. 실패 실행의 ID를 복원하는 자료도 아니다.

`artifacts`의 `.log`에서 `AuthenticationFailed`와 `fixture_start.*(Err|Some)`를 검색했다. WebView 프로필, source snapshot, target 및 접근 거부가 있었던 `phase3-endpoint` 디렉터리는 제외했다. 오류 없이 끝난 이 제한 검색은 10개 로그의 14행을 찾았으며, 위 과거 실패·그 복사본·의도적 진단 RED·이전 ACL/발견 파일 경합 개발 기록이었다. 이후의 새로운 진단 포함 자연 실패는 이 검색에서 발견되지 않았다. JSON/JSONL·미저장 실행·제외 경로까지 무실패였다는 보장은 아니다.

진단 범위에도 제한이 있다. `lifetime.rs`의 직접 `EndpointLease::publish` 2곳과 `LocalServer::start` 6곳은 현재 공통 `start_server`를 거치지 않는다. 따라서 “어댑터의 다음 모든 초기화 실패에 진단이 남는다”는 표현은 틀리다. 이는 진단 누락이며 그 경로에서 새 제품 실패를 발견했다는 뜻은 아니다. 또한 현재 모든 Windows API가 native 오류를 따로 기록하는 것은 아니다. 일부는 `validation_or_unclassified`와 소스 줄만 제공한다.

**결론:** 알려진 고정 ID 충돌은 해결된 fixture 결함으로 분리하고, 나머지 두 사건은 원인 미확정으로 유지한다. 과거 기록에는 실제 ID와 실패 API가 없어서 이번 기록 조사만으로 원인을 확정할 수 없다. 기존 성공 반복이나 알려진 충돌의 재주입을 추가해도 그 공백을 소급해서 메우지 못한다. 다음 필요한 증거는 실제 실패 시의 경로·app ID·게시 단계·native 오류 및 같은 실행의 성공 ID다. 향후 관련 인수 실행에서 이를 보존해야 하며, 현재 근거로 인증 완화·제품 재시도·출시 차단 해제를 하지 않는다.

## 2026-10-29 어댑터 통합시험 진단 누락 보완

위 조사 이후 승인된 후속 변경이다. `tests/common/mod.rs`에 동기 `publish_lease`를 추가했다. 호출 직전 thread-local 진단을 비우고 직후 소비해 성공/실패의 경로·app ID·wire 결과·operation/native 오류/줄을 stderr에 기록한다. 성공한 lease 자체나 secret은 출력하지 않는다. `lifetime.rs`의 직접 게시 2곳을 이 함수로, 서버 시작 6곳과 `stdio_online.rs`의 1곳을 기존 `start_server`로 연결했다. ID 생성·권한·재시도·제품 동작은 변경하지 않았다. 의도적으로 오래된 진단을 남기는 회귀시험 호출은 수집 함수를 거치지 않는다.

증거: `artifacts/startup-capture-20261029/`. 기존 실패 로그는 이름을 바꾸거나 덮어쓰지 않았다.

| 검증 | 결과 |
|---|---|
| 새 lease 진단 시험 RED (`red.log`) | 진단 없는 기존 직접 publish/unwrap을 함수로 추출한 상태에서 실제 잠금/pipe 충돌의 원인 정보가 없어 실패, exit 101 |
| 진단 보완 후 회귀시험 | 실제 잠금 오류 `CreateFileW`/32와 pipe 충돌 `named_pipe.create`/5 구분. 이전 잠금 오류가 thread-local에 남아 있어도 다음 pipe 오류로 올바르게 기록하며 소비 후 잔류 진단 없음. 두 endpoint 게시 파일 정리 확인 |
| 제한 환경의 최초 관련 suite (`green.log`) | 파일명과 달리 실패. adapter lib 1 pass/1 fail 후 중단. 첫 `LocalClient::connect`에서 `AppOffline` |
| 제한 환경의 통합시험 (`adapter-integration.log`) | 3 pass/11 fail. 진단 시험 2개와 장기 offline 시험은 통과, lifetime 6개와 stdio_online 5개는 연결/상태 대기 timeout |
| 동일 소스의 호스트 환경 관련 suite (`host-regression.log`) | **57 pass, 0 fail, 0 ignored**, exit 0. 기본 병렬 실행, `--no-fail-fast -- --nocapture` |
| adapter all-targets clippy (`clippy.log`) | exit 0, `-D warnings` |
| 변경한 Rust 시험 파일 4개의 rustfmt check 및 diff check | exit 0 |

제한 환경에서 실패한 시험명은 다음과 같다. 실패를 이후 호스트 통과로 지우지 않는다.

- lib: `link::tests::late_retirement_of_old_client_preserves_replacement_connection`.
- lifetime: `handshake_attempt_expires_and_reconnects_to_a_replacement_endpoint`, `handshake_stall_does_not_block_initialize_tools_status_or_eof`, `authentication_and_version_errors_recover_with_fresh_discovery`, `three_app_restarts_use_new_identity_and_never_replay_offline_input`, `pending_input_becomes_uncertain_and_is_not_sent_to_replacement_app`, `damaged_discovery_is_rejected_then_reloaded_after_replacement`.
- stdio_online: `offline_start_rediscovers_a_new_app_without_restarting_stdio`, `stdio_online_output_errors_then_offline_has_no_cached_identity`, `authentication_and_version_failures_are_not_reported_as_offline`, `stdio_cancellation_and_eof_release_pending_reads_and_ipc`, `request_id_diagnostics_precede_dispatch_even_when_offline`.

이번 연결 실패는 서버 게시 이후에 발생했다. 제한 환경에서 여러 연결 시험이 함께 실패하고 같은 소스가 호스트 환경에서 통과한 관측은 실행 환경의 영향을 시사한다. 다만 실패 native 오류를 직접 수집한 것은 아니므로 특정 sandbox 정책/API 거부를 원인으로 확정하지 않는다. 과거 게시 단계의 `AuthenticationFailed` 두 건과도 같은 원인이라고 묶지 않는다.

```text
CARGO_INCREMENTAL=0
cargo +stable test --manifest-path rust/Cargo.toml --offline --locked -p baton-ipc -p baton-adapter --all-targets --no-fail-fast -- --nocapture
cargo +stable clippy --manifest-path rust/Cargo.toml --offline --locked -p baton-adapter --all-targets -- -D warnings
rustfmt +stable --edition 2024 --check rust/crates/baton-adapter/tests/common/mod.rs rust/crates/baton-adapter/tests/lifetime.rs rust/crates/baton-adapter/tests/startup_diagnostics.rs rust/crates/baton-adapter/tests/stdio_online.rs
```

`verification-summary.json`에 로그별 시험 수·실패명·SHA256을 보존했다. 기존 미커밋 `rust/Cargo.toml`과 `rust/Cargo.lock`은 작업 전 SHA256과 일치한다. 제품 소스·미완성 fuzz·배포 후보는 변경하지 않았고, fuzz/GUI/SSH/장시간 시험을 실행하지 않았다. 이번 완료 범위는 **어댑터 통합시험 진단 누락 보완**이다. 과거 두 사건의 원인 규명, 제품 초기화 결함 수정, 전체 Phase 5 통과 또는 출시 차단 해제를 뜻하지 않는다.
