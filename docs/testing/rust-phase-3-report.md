# Rust Phase 3 구현·검증 기록

2026-10-09 KST. 구현 및 자동 검증 완료: **Rust 150개·UI 15개·Node 12개 통과, 실패·skip 0**. 최종 상태는 **`automated_passed_manual_pending`**이다. 실제 Claude 등 모델의 sudo 승인 지침 준수는 아직 pending이다. 독립 최종 코드 리뷰 결과와 후속 검증은 아래에 기록한다.

## 구현 범위

- Windows 사용자 전용 DACL·DPAPI 발견 정보와 난수 secret으로 인증하는 로컬 named pipe. 앱당 최대 32개 연결, 연결별 요청·대기 read·응답 큐 상한.
- rmcp 3.4.0 stdio 어댑터의 `status`, `read_output`, `send_text`, `send_key`, `request_user_control` 5개 도구. 연결 ID는 인증된 서버 문맥에서 정한다.
- 앱의 연결 선택·전달·회수·개입 요청 거절 UI. 소유권 전환은 expected epoch를 원자적으로 검사한다.
- 연결별 셸 격리, 사용자 개인 구간과 에이전트 공개 구간 분리, 큐 대기 입력 취소, 회수 직전 출력 응답 권한 재확인.
- sudo 최종 `-n` 명령·인자·목적을 제시하고 1회 승인받도록 하는 MCP 지침. 승인 엔진이나 sudo 명령 자동 수정은 구현하지 않았다.

## 자동 실행 증거

작업 위치: `.worktrees/rust-phase-0`, 브랜치 `codex/rust-phase-0`. Phase 3 시작 커밋 `a374bcf0baf94b64d1ed3b21fcb78f8d5d5abdf1`, Task 7 완료 `a209bcd`.

리뷰 전 전체 실행 ID: `20261008T145207-eb1a48e6d70d49b8847fdfd45b7e89b1` (UTC ID, KST 2026-10-08 23:52 시작). [summary.json](../../artifacts/rust-phase-3/20261008T145207-eb1a48e6d70d49b8847fdfd45b7e89b1/summary.json)에 명령별 인자·종료 코드·로그 hash·소스 inventory·빌드 보관 경로가 있다. artifact는 로컬 증거이며 Git에 포함하지 않는다. 아래 수치는 리뷰 전 결과이며 수정 후 결과는 마지막 절에 별도로 기록한다.

| 검증 | 통과 | 실패 | skip/ignored |
|---|---:|---:|---:|
| Rust core/app/IPC/adapter, all-targets | 150 | 0 | 0 |
| 프런트엔드 단위 시험 | 15 | 0 | 0 |
| Node Phase 3 (stdio·통합·receipt) | 9 | 0 | 0 |

fmt, clippy `-D warnings`, 프런트엔드 제품·인수 assets 빌드, 제품·어댑터·인수 실행 파일 빌드 모두 종료 코드 0. 빌드 뒤 실행 파일/PDB·프런트엔드·lock을 보관하고 관측 단계에서 재빌드하지 않았다. 실행 전후 소스·환경 inventory 일치를 검사했다.

실행 명령은 `rust/scripts/verify-phase-3.ps1`. 주요 단계:

```text
cargo +stable fmt --manifest-path rust/Cargo.toml --all -- --check
cargo +stable clippy --offline --locked --manifest-path rust/Cargo.toml -p baton-core -p baton-ipc -p baton-adapter -p baton-app --all-targets --features baton-app/desktop -- -D warnings
cargo +stable test --offline --locked --manifest-path rust/Cargo.toml -p baton-core -p baton-ipc -p baton-adapter -p baton-app --all-targets
npm.cmd test --prefix rust/app
npm.cmd run build --prefix rust/app
node --test --test-concurrency=1 <rust/tests/phase3의 실제 *.test.mjs 목록>
```

환경: Windows x64 `10.0.26200`, Rust/Cargo `1.88.0`, Node `22.17.0`, WebView2 `154.0.4258.62`. PowerShell 7 절대 경로로 실행했다. 초기 runner가 복수 Node 경로를 하나의 명령으로 취급해 빌드 전에 실패한 기록 `20261008T145144-5955bb22e337409485edf9b6130a0b1b`은 유지했고, 첫 번째 실행 경로 선택으로 수정 후 위 실행을 완료했다.

## 실제 관측과 시험 범위

자동 시험은 실제 Windows pipe, 어댑터 자식 프로세스, 두 개의 로컬 SSH 서버, Tauri WebView를 사용했다. 화면 관측 주체는 인수 스크립트이며 사람의 육안 리뷰로 기록하지 않는다.

| 사례 | 확인 내용 | 최종 report |
|---|---|---|
| 여러 연결·셸 | A의 두 서버 3셸/B의 1셸 격리, 잘못된 owner 입력·읽기 효과 없음, request ID 중복 실행 방지, A EOF의 제한된 영향 | [integration](../../artifacts/phase3-integration/phase3-integration-cf5YdW/report.json) |
| 소유권·출력 | pending read 회수, 사용자 개인 구간, B 재전달 새 stream/cursor, 이전 epoch/stream 거부, xterm 기록 유지 | [ownership](../../artifacts/phase3-integration/phase3-ownership-dP8WUk/report.json) |
| sudo 개입 | 합성 인증 필요/권한 거절/성공, 알림만으로 소유권·실행 변화 없음, 회수 후 직접 처리, 비밀 미노출, 명시적 재시도 | [sudo](../../artifacts/phase3-integration/phase3-sudo-eEiymx/report.json) |

세 report 모두 서버 측 수신 관측, SSH fixture·어댑터 종료, WebView 정상 종료, forced cleanup 없음, descendant audit verified를 기록했다. sudo 관측은 합성 비밀번호 원문 대신 바이트 hash·길이만 남긴다. 사용자 하네스 설정과 실제 홈서버는 변경하지 않았다.

Task 6의 실제 제품 소유권 버튼 시험은 [ownership-ui 증거](../../artifacts/phase3-ui/78214a50b18b4ca28f5a4b8693d82876/report.json)를 재사용한다. Task 7–8에서 제품 소유권 UI와 터미널 입력 소스를 변경하지 않았음을 diff로 검토했다. 같은 xterm/스크롤백 유지, 사용자 입력 차단·회수 후 복귀, 오래된 연결 선택 제거, reason의 문자 그대로 표시를 확인했다. Phase 2의 IME·물리 키·vi를 반복하지 않았다.

회수 전 응답의 commit 지점은 registry 잠금 아래 IPC writer를 확보한 뒤다. 회수가 먼저 완료되면 해당 출력은 거부된다. 이미 commit한 bytes를 나중 회수로 되돌릴 수는 없다. 재전달 뒤 원격 프로그램이 다시 출력한 문자열은 새 공개 출력이 될 수 있다.

## 미실시·보류

- 실제 모델 SUDO-01: pending. 합성 SSH sudo 시험은 실제 OS 권한 부여나 모델 판단을 증명하지 않는다. [수동 절차](rust-phase-3-manual.md).
- Windows 다른 실제 사용자 로그인: 미실시. 현재 SID와 합성 foreign SID의 AuthzAccessCheck 및 ACL/DPAPI·reparse 거부 시험을 수행했다.
- Phase 2 DPI: 보류 유지. 기존 source-equivalence 인수 판단을 strict gate 통과로 바꾸지 않았다.
- Phase 4: 앱 재실행 후 자동 재발견·재연결과 장시간 offline 수명. Phase 3은 어댑터 시작 때 한 번 연결한다.
- Phase 5: 장시간 부하·출시 검증. macOS/Linux IPC·배포도 미실시이며 Windows 결과로 대신하지 않는다.
- SSH 연결 종료는 원격의 모든 분리 프로세스 종료를 보장하지 않는다. 일반 SSH와 마찬가지로 원격 프로그램의 종료·분리 정책에 좌우된다.

## 실행 중 판단

1. Bash 보조 스크립트 대신 Windows PowerShell로 task BASE·red/green 로그·ledger를 기록했다. 잘못되면 기록 형식·복구 도구 호환성 비용이 생긴다.
2. endpoint 공개 전에 앱 등록과 pipe 준비를 끝내 시작 경쟁을 피했다. 추가 시작 상태 관리가 필요하다.
3. 취소는 일반 요청 permit 상한을 우회하되 owner/epoch 검사를 유지했다. 상한에 도달해도 취소할 수 있게 하기 위함이며 취소 경로 자체의 부하 위험은 남는다.
4. endpoint secret/instance/version 검사는 Task 3, 실제 handshake·timeout 통합은 Task 4에 배치했다. 중간 단계 단독 결과는 전체 인증 완료를 뜻하지 않는다.
5. secret-bearing frame은 zeroizing 버퍼를 쓰고 ACL fixture handle에 필요한 읽기 권한을 추가했다. 로그 미노출은 별도 검사 대상이며 zeroize만으로 시스템 전체 메모리 잔류를 보장하지 않는다.
6. 출력·상태 응답 commit을 registry 잠금 아래 동기 callback으로 처리했다. callback의 runtime 재진입을 금지해야 하는 결합 비용이 있다.
7. ownership service 시험은 기존 Windows IPC fixture를 재사용했다. 회수 후 assigned 연결 기록 유지가 계약이므로 잘못된 시험 기대를 수정했다. 다른 OS ownership 시험은 해당 IPC 구현까지 제한된다.
8. sudo 시험은 실제 SSH 위 합성 상태 머신으로 구성했다. 실제 sudo·모델 준수는 별도 미완료로 남긴다.

## 독립 최종 리뷰

독립 컨텍스트의 `gpt-6-astra` 리뷰어가 전체 브랜치 통합 경계와 Phase 3 변경을 검토했다. 범위는 `b0457ab51e0d63112cafcd73c8dfb6a5ec41c96a..a209bcd` 및 당시 Task 8 작업 파일이다. Phase 3 이전 기준은 `a374bcf`다. 리뷰를 다시 반복하지 않고 중요한 지적을 재현 시험으로 검증했다.

**P2 수정:** rmcp tuple transport는 개행까지 메시지를 무제한 수집하므로, 기존 64 KiB duplex·도구 16 KiB·IPC 256 KiB 제한으로 stdio 수신 메모리를 제한하지 못했다. SDK 앞에 개행 제외 256 KiB 상한의 프레임 수집기를 추가했다. 초과 시 SDK로 전달하지 않고 어댑터 연결을 종료하며, 미완성 EOF 프레임은 전달하지 않는다. 개행 있는/없는 초과 입력 두 시험은 수정 전 timeout으로 실패했고 수정 후 정상 종료로 통과했다. 경계 크기 정상 처리와 다음 메시지 예산 초기화 시험도 추가했다.

**P3 보류:** receipt의 descendants 배열 필수 schema, PDB·lock·프런트엔드 전체 inventory 필수 검사, 관측 후 실행 대상 binary hash 재비교. 현재 producer가 파일 복사·descendant 감사를 강제하고 보관 이후 빌드가 없어 현재 runner에서 거짓 통과는 재현되지 않았다. 외부 동시 빌드나 수집기 형식 변경을 더 강하게 탐지하는 보강이며 이번 수정 범위에서는 보류한다.

**리뷰어가 판단하지 않은 범위에 대한 결정:** 실제 모델 sudo, 실제 OS sudo, 다른 실제 Windows 사용자, Phase 2 DPI·물리 입력 재인수, Phase 4 재연결·장시간 offline, Phase 5 부하·출시·다른 OS는 각각 기존 pending/deferred 상태를 유지한다. 범위를 넓혀 합성 Windows fixture 결과로 통과를 추정하지 않는다. 이 결정의 비용은 해당 환경의 실제 동작이 아직 입증되지 않았다는 것이다.

리뷰 수정 후 첫 실행 `20261008T193131-0b6e636987fe415da6edd29955366de1`은 Rust/UI·빌드 통과 후 Node 11통과/1실패로 종료했다. 첫 SSH fixture가 준비 전에 종료됐으며 MCP/UI 실행 전이었다. 당시 stderr를 폐기하던 fixture여서 원인은 확정하지 못했다. 별도 시작·종료 5회는 모두 정상이며 이것을 결함 수정으로 간주하지 않는다. 후속 실행부터 합성 fixture의 종료 코드와 제한된 stderr를 artifact에 보관한다. 실패한 receipt는 그대로 보존한다.

**수정 후 최종 전체 실행:** [20261008T193341-622766a8632c42efad829b28d89583fb](../../artifacts/rust-phase-3/20261008T193341-622766a8632c42efad829b28d89583fb/summary.json), KST 2026-10-09 04:33 시작. Rust 150 / UI 15 / Node 12 통과, 실패·skip 0. fmt·clippy·제품/어댑터/인수 빌드도 통과했다. 이전 실패 원인은 미확정으로 남기며 최종 통과를 그 원인의 해결 증거로 해석하지 않는다.

최종 통합 관측: [여러 연결](../../artifacts/phase3-integration/phase3-integration-IjwY86/report.json), [출력 격리](../../artifacts/phase3-integration/phase3-ownership-oWSJ6z/report.json), [합성 sudo](../../artifacts/phase3-integration/phase3-sudo-c76oaH/report.json). 모두 정상 종료·fixture 정리·서버 관측을 확인했다.

Windows PowerShell 5에서 실행기를 호출해 PowerShell 7 절대 경로 탐색과 `-ReuseEvidence`를 실제 검증했다. [재사용 receipt](../../artifacts/rust-phase-3/20261008T193447-29b07da03a884ff4b915e317db640dfc/summary.json)는 원본 source/log/artifact/관측을 다시 검증했고 빌드·GUI를 실행하지 않았다. 문서만 바뀌었으므로 원본 제품 시험을 반복하지 않는다.

실행 안내: [Rust 앱·MCP 설정](../rust-harness-setup.md). push, PR, merge 및 사용자 하네스 설정 변경은 수행하지 않았다.
