# Baton

사용자가 Windows 앱에서 직접 연결·인증한 SSH 셸을 Claude Desktop 등의 MCP 하네스에 전달하고 다시 회수하는 Rust/Tauri 데스크톱 앱입니다. 앱이 SSH 연결을 소유하고, MCP stdio 어댑터가 배정된 세션을 조작합니다.

## ⚠️ Rust 개인 사용판 — 알려진 문제와 미검증 범위

**현재 Rust 버전은 개인 사용을 위한 시험판입니다. 정식 출시 인수 완료나 모든 환경의 안정성을 보장하지 않습니다.** 개인 사용을 시작하기 위해 정식 출시 검증 전체를 기다릴 필요는 없지만, 아래 한계는 남아 있습니다.

| 항목 | 현재 상태와 사용 시 주의점 |
|---|---|
| **제어권 표시 경합 — 새 ZIP에 수정 포함** | 동시 세션 알림의 순서 역전으로 과거 제어 상태가 표시되는 문제를 수정하고 고정 순서 회귀 검사를 추가했습니다. **새 `Baton-personal-edacf24-windows-x64.zip`에는 수정이 포함됩니다.** 기존 `Baton-personal-windows-x64.zip`에는 없으므로 새 패키지를 사용하세요. 10월 30일 사용자 PC·Claude Desktop에서 한글 입력, SSH, 전달·회수, 새 연결의 [기본 실사용 점검](docs/testing/rust-personal-use-check.md)을 완료했습니다. [수정·검증 범위](docs/testing/rust-session-snapshot-ordering.md)를 참고하세요. |
| **간헐적 IPC 초기화 실패** | 과거 두 실패의 원인이 미확정입니다. 이후 관련 시험은 통과했지만 해결 증거는 아닙니다. 실패하면 발생 시각·실행 파일·오류를 보존하세요. 상세 진단 보강은 시험 코드에 적용됐으며 배포 앱이 같은 정보를 자동 기록하지는 않습니다. |
| **메모리 증가 이력** | 이전 2시간 시험에서 private +39.87%, working set +25.77%가 관측됐고 단일 원인은 미확정입니다. 후속 고정 UI·자동 전환 시험은 각 조건에서 통과했습니다. 현재 계속 실패한다거나 누수가 완전히 해결됐다는 뜻은 아닙니다. |
| **실사용 환경 검증 미완료** | 물리 한글 IME·배율·지원 하네스 조합·깨끗한 Windows/다른 사용자 환경의 전체 인수는 끝나지 않았습니다. 먼저 본인이 쓰는 환경과 작업이 없는 SSH 세션으로 확인하세요. |
| **명령 승인·복구 한계** | Baton은 명령 승인 엔진이 아닙니다. 에이전트에게 전달한 셸에서 모델 지침만으로 위험한 명령이나 sudo를 강제 차단하지 않습니다. 회수는 이미 실행된 명령을 되돌리지 않으며, 종료가 모든 원격 백그라운드 작업의 종료를 보장하지 않습니다. |
| **잔여 검증** | 입력면 4종의 30분 퍼징은 미실행이고 재접속 ID 재사용 변이 시험 증거는 아직 확인되지 않았습니다. |

## 실행

[개인 사용 안내](docs/rust-personal-use.md)의 새 로컬 ZIP을 사용합니다. ZIP·실행 파일은 저장소에 포함하지 않습니다. Windows x64, WebView2 Runtime, Microsoft Visual C++ x64 Runtime이 필요하며 실행에 Rust·Node·.NET SDK는 필요하지 않습니다.

1. ZIP 전체를 새 폴더에 풀고 `baton.exe`를 일반 사용자 권한으로 실행합니다.
2. Claude Desktop 등 MCP 하네스의 stdio 명령을 같은 폴더의 `baton-adapter.exe` 절대 경로로 지정합니다. 인자는 없으며 앱과 같은 Windows 사용자로 실행합니다. [MCP 연결·회수 안내](docs/rust-harness-setup.md)를 참고하세요.
3. 앱에서 SSH 연결·인증을 진행하고 서버 지문을 신뢰할 수 있는 경로로 대조합니다. 인증정보는 하네스에 전달하지 않습니다.
4. 하네스에서 `status`를 조회해 연결 ID를 확인한 뒤 앱에서 해당 연결을 선택하고 **에이전트에 전달**합니다.
5. **내가 제어하기**로 회수하면 직접 입력할 수 있습니다. 회수 시 미수신 공개 출력 꼬리는 폐기될 수 있고 이미 실행된 명령은 취소되지 않습니다.
6. 사용 후 SSH 연결과 앱 창을 정상 종료합니다. 이전 세션·명령은 자동 복원·재전송되지 않습니다.

하나의 MCP 연결을 여러 대화가 공유하면 Baton은 대화별로 구분하지 못합니다. 독립된 권한 경계가 필요하면 별도 연결을 사용합니다. 10월 30일 사용자 PC·Claude Desktop에서 확인한 [기본 실사용 결과와 한계](docs/testing/rust-personal-use-check.md)를 참고하세요.

## 개발·빌드

현재 제품과 시험 코드는 `rust/`에 있습니다. Windows용 빌드에는 Rust stable, Visual Studio C++ 빌드 도구, Node.js/npm과 WebView2가 필요합니다. 저장소 루트에서 PowerShell로 실행합니다.

```powershell
npm ci --prefix rust/app
npm run build --prefix rust/app
cargo +stable build --locked --release --target x86_64-pc-windows-msvc --manifest-path rust/Cargo.toml -p baton-app --features desktop,tauri/custom-protocol --bin baton
cargo +stable build --locked --release --target x86_64-pc-windows-msvc --manifest-path rust/Cargo.toml -p baton-adapter --bin baton-adapter
```

결과는 `rust/target/x86_64-pc-windows-msvc/release/`의 `baton.exe`, `baton-adapter.exe`입니다(별도 `CARGO_TARGET_DIR`을 지정하면 해당 경로를 사용합니다). 빌드가 성공해도 실사용·출시 인수 전체가 완료되는 것은 아닙니다. [시험 패키지 생성 절차](docs/rust-windows-candidate.md)는 기존 기록의 적용 범위를 확인하고 사용하세요.

기본 회귀 검사:

```powershell
npm test --prefix rust/app
cargo +stable test --locked --manifest-path rust/Cargo.toml -p baton-core -p baton-ssh -p baton-ipc -p baton-adapter -p baton-app --all-targets
```

별도 Node 기반 통합 시험은 `rust/tests/package.json`의 의존성을 사용합니다(`npm ci --prefix rust/tests`). 공통 OpenSSH 시험 이미지는 `tests/linux-ssh/Dockerfile`에 남아 있으며 Docker 시험 환경용입니다. 실제 SSH·장시간 시험의 실행 조건은 각 보고서와 계획을 따릅니다.

## 구조와 기록

- `rust/app/`: Tauri 데스크톱 UI와 프런트엔드
- `rust/crates/`: 세션 코어, SSH, 로컬 IPC, MCP 어댑터
- `rust/tests/`, `rust/scripts/`: 통합 시험과 검증 도구
- [개인 사용 안내](docs/rust-personal-use.md) · [잔여 검증](docs/testing/rust-phase-5-acceptance-gap-audit.md)
- [초기화 조사](docs/testing/rust-startup-followup-report.md) · [메모리 조사](docs/testing/rust-phase-5-memory-investigation.md)
- [C# MVP 보존·복구 안내](docs/legacy-csharp.md): C# 전용 구현은 현재 트리에서 제거했으며 `csharp-mvp-final` 태그로 보존합니다. 과거 C# 문서는 역사적 기록이며 현재 Rust의 실행 계약이 아닙니다.

## 라이선스

이 저장소는 [Apache License 2.0](LICENSE)으로 배포합니다. `rust/vendor/tao-0.35.3`은 Tauri의 Tao 0.35.3(Apache-2.0)을 일부 수정해 포함한 것이며, 원본 라이선스와 저작권 표시를 유지합니다. 변경 범위와 출처는 [rust/vendor/README.md](rust/vendor/README.md)를 참고하세요. 그 밖의 의존성은 저장소에 포함하지 않고 `Cargo.lock`·`package-lock.json`으로 고정합니다.
