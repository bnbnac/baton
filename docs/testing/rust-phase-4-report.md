# Rust Phase 4 오프라인 수명 검증

2026-10-09 KST. **구현·자동 검증 완료, 실제 하네스 인수 pending.** 최종 자동 시험은 Rust 159개 / Node 12개 통과, 실패·skip 0이다. 출시 승인이 아니다. 기존 간헐적 시험 초기화 오류의 원인은 미확정으로 남는다.

## 변경된 동작

어댑터 시작 시 MCP 초기화와 앱 인증을 분리했다. 앱이 없어도 초기화·5개 도구 목록·offline status를 제공한다. 하나의 supervisor가 매번 발견 정보를 새로 읽고 약 1→2→4→최대 5초 간격으로 접속한다. 지터는 ±10%이며 최대 단계에서는 4.5–5초다. 접속·인증 시도는 기존 3초 제한을 유지한다.

연결 성공 시 backoff를 초기화한다. 앱 종료 후 기존 ID와 연결 권한을 버리고, 재실행된 앱에는 새 인증·새 연결 ID·미배정 상태로 붙는다. 호출은 시작할 때 확보한 한 연결에만 속하며 큐에 보관하거나 재전송하지 않는다. 진행 중 입력의 결과를 확정할 수 없으면 uncertain으로 알린다. 오래된 호출의 지연 정리는 새 연결을 지우지 못한다.

EOF는 retry sleep과 handshake를 취소하고 IPC를 닫는다. SSH 자체의 자동 재접속이나 과거 배정·출력 복원은 하지 않는다. 앱 UI·코어·SSH 동작은 변경하지 않았다.

## 증거와 실행

기준 커밋 `ea88e22`, 구현 `e749175`, 통합 시험 `cc9d92f`. [로컬 summary](../../artifacts/rust-phase-4/20261009-lifetime/summary.json)에 소스 inventory, 환경, 실행 파일/PDB·lock hash, 로그 hash, 통합 report 경로를 보관했다. artifact는 Git에 포함하지 않는다.

| 항목 | 결과 |
|---|---|
| Rust core/app/IPC/adapter all-targets | 159 pass, 0 fail, 0 ignored |
| Node stdio·SSH·WebView·receipt 회귀 | 12 pass, 0 fail, 0 skip |
| fmt check | exit 0 |
| desktop 포함 clippy, `-D warnings` | exit 0 |
| 어댑터 debug 빌드 | exit 0, exe/PDB 보관 |

```text
cargo +stable fmt --manifest-path rust/Cargo.toml --all -- --check
cargo +stable clippy --offline --locked --manifest-path rust/Cargo.toml -p baton-core -p baton-ipc -p baton-adapter -p baton-app --all-targets --features baton-app/desktop -- -D warnings
cargo +stable test --offline --locked --manifest-path rust/Cargo.toml -p baton-core -p baton-ipc -p baton-adapter -p baton-app --all-targets
cargo +stable build --offline --locked --manifest-path rust/Cargo.toml -p baton-adapter
node --test --test-concurrency=1 rust/tests/phase3/integration.test.mjs rust/tests/phase3/ownership.test.mjs rust/tests/phase3/sudo.test.mjs rust/tests/phase3/stdio.test.mjs rust/tests/phase3/receipt.test.mjs
```

실행 환경은 summary의 `source.environment`에 기록했다. Windows x64 10.0.26200, Rust/Cargo 1.88.0, Node 22.17.0, WebView2 154.0.4258.62. native DPAPI 시험은 일반 사용자 보안 문맥에서 수행했다. 실제 하네스 설정과 홈서버는 변경하지 않았다.

## 관측 범위

- 앱 없음에서 실제 stdio 초기화 후 앱을 게시하면 같은 어댑터 프로세스가 자동 접속한다. 기존 one-shot 구현에서는 8초 timeout으로 실패했고 구현 후 통과했다.
- 실제 pipe 서버 3회 재시작에서 새 instance·새 connection·빈 세션을 확인했다. offline 입력은 서버에 전달되지 않았다.
- 서버가 받았지만 완료되지 않은 입력은 단절 후 uncertain이고, 교체 서버의 수신 입력은 0건이다. 이후 명시적인 새 호출만 1건 전달됐다.
- 인증/버전 오류를 offline으로 숨기지 않고, 새 endpoint로 바뀌면 복구했다. 손상된 DPAPI 발견 파일도 거부 후 정상 파일로 교체하자 복구했다.
- Welcome을 보내지 않는 실제 pipe에서도 MCP 초기화·목록·status·EOF가 동작했다. 3초 handshake 예산 후 연결 종료와 후속 재접속도 확인했다.
- 8초 동안 offline을 유지한 후 목록·상태·EOF를 확인했다. 이는 장시간 soak가 아니다. backoff 수치·상한·reset과 지터 10,000회 범위는 단위 시험으로 검사했다.
- 실제 두 LocalClient를 사용해 예전 client 정리가 새 client slot을 지우지 않고 새 연결의 응답 ID가 유지됨을 검증했다.
- 실제 MCP·SSH·WebView에서 두 연결의 여러 셸 격리, 회수·재전달의 개인 출력 경계, 합성 sudo 개입이 유지됐다. 각 report의 정상 종료·fixture 정리·서버 관측을 검증했다.

UI 실행 파일은 Phase 3 최종 검증본 `20261008T193341-622766a8632c42efad829b28d89583fb`와 현재 hash가 같음을 확인하고 재사용했다. 변경은 어댑터와 그 어댑터가 사용하는 LocalClient 종료/알림 API다. UI·코어·서버·SSH 경로가 같으므로 앱 재빌드와 Phase 2 물리 키/IME/DPI 시험은 반복하지 않았다. UI 프런트엔드 단위 15개도 이번 통과 수에 합산하지 않는다.

## 실패 기록과 해석

1. 기존 Rust/Node fixture는 MCP initialized를 앱 인증 완료로 간주했다. 새 비동기 초기화에서는 잠깐 offline일 수 있으므로 상태를 확인하고 전달하도록 수정했다. Node의 null connection ID 전달 실패 3건은 수정 전 로그에 남겼고 이후 12개가 통과했다.
2. 새 handshake 시험 두 개가 같은 고정 app ID 75를 병렬로 사용해 Windows 전역 pipe 이름이 충돌했다. fixture ID를 난수로 변경한 뒤 통과했다.
3. 기존 IPC `partial_frame_survives_dispatch_completion` 시험은 endpoint 게시에서 AuthenticationFailed로 한 번 실패했다. frame 처리 이전의 실패이며 원본 상세 원인은 확정하지 못했다. 시간값 기반 fixture ID는 동시성에서 유일성을 보장하지 않아 난수로 바꾸고 비밀을 제외한 경로·ID·오류 진단을 추가했다. 후속 전체 통과를 원인 해결의 증거로 확대하지 않는다. 미해결 flakiness는 출시 차단 조건으로 유지한다.
4. 추가 진단의 포맷 문자열이 clippy 규칙을 위반했다. 해당 시험 커밋 뒤 마지막 lint 결과를 확인한 순서 실수를 ledger에 정정하고 포맷만 수정했다. 최종 fmt·clippy는 통과했으며 이 문서의 결과는 수정 후 검사다.

## 독립 리뷰와 보류

독립 `gpt-6-astra` 리뷰는 Phase 4 변경과 연결되는 IPC·앱 수명·세션 정리를 검토했고 추가 수정 결함을 보고하지 않았다. 이전 Phase 0–3 전체 코드를 새로 재감사했다고 주장하지 않는다. 기존 리뷰에 더해 이번 변경의 통합 경계를 검토했다. 보고서와 수동 안내는 이후 작성돼 작성자가 경로·숫자·범위를 자체 확인했다.

실제 Claude/Codex 경고·도구 가용성, 실제 모델 sudo, 다른 Windows 사용자, DPI/IME 재인수, 강제 전체 앱 종료와 일반 OpenSSH 원격 프로세스 비교, 다른 OS는 이번 자동 결과로 통과 처리하지 않는다. [실제 하네스 절차](rust-phase-4-manual.md)는 아직 pending이며 Phase 5 출시·부하·OS별 인수도 남아 있다.

판단 기록: 설계의 “작은 지터”를 ±10%, 최대 5초로 구체화했다. 필요하면 재시도 간격을 조정하는 비용이 있다. 리뷰가 판단을 보류한 수동 범위·기존 실패 원인·이전 단계 재감사는 그대로 미검증으로 남겼다. 비용은 해당 환경에서의 실제 동작을 아직 입증하지 못했다는 점이다. 보고서 자체는 독립 리뷰 대상이 아니었다는 제한도 유지한다. 별도로 보류한 사소한 코드 지적은 없다.

로컬 브랜치와 작업 폴더를 보존한다. push·PR·merge는 수행하지 않았다.

후속: [Windows 발견 파일 경합 회귀 검증](rust-discovery-race-report.md)에서 별도의 읽기·교체/정리 결함을 재현하고 수정했다. 이 결과로 위 3번의 과거 초기화 오류 원인이 확정된 것은 아니다.
