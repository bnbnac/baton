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
