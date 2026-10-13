# Phase 5 단일 Claude 하네스 인수 기록

2026-10-13. 현재는 **준비 및 어댑터 안내 수정 검증 완료, 실제 Claude 호출 미실행**이다. CLI 로그인 확인은 모델/MCP 통합 시험 통과가 아니다.

## 재연결 안내 수정

실제 하네스 시험 준비 중 MCP `initialize.instructions`의 마지막 문단이 Phase 3 계약에 머물러 있음을 발견했다. 구현은 Phase 4에서 자동 재탐색·재연결을 지원하지만, 안내는 자동 재연결이 미구현이며 어댑터를 재시작하라고 했다. 모델이 정상 복구 중 MCP를 불필요하게 중단하도록 유도할 수 있었다.

`rust/crates/baton-adapter/src/policy.rs`의 마지막 문단만 수정했다. 일반적인 앱 부재는 offline/null ID/빈 sessions, 인증·버전 실패는 별도 오류임을 명시한다. 앱 재시작 뒤 새 ID와 사용자 전달이 필요하고, 이전 세션·출력·명령은 복원·재전송되지 않는다. 기존 sudo 1회 승인과 `-n` 정책은 그대로다. IPC나 재연결 구현 변경은 없다.

증거는 `artifacts/phase5-harness-20261013/`에 보존한다.

| 검증 | 결과 |
|---|---|
| 기존 release 어댑터 initialize | 잘못된 Phase 3 안내 재현, `before/protocol.json` |
| fmt 검사 | 통과 |
| `cargo +stable test --manifest-path rust/Cargo.toml --offline --locked -p baton-adapter --all-targets` | 14 pass, 0 fail, 0 ignored; 실제 IPC 수명·재연결 시험 포함 |
| Windows x64 release adapter 빌드 | 통과, `adapter-release.log` |
| 수정 release initialize | 자동 재연결 안내 확인, `after/protocol.json` |
| 전후 비교 | 5개 도구 schema·offline 응답·첫 세 정책 문단 동일, 두 어댑터 EOF exit 0 |

순수 문구를 복제하는 단위시험은 추가하지 않았다. 실제 제품 바이너리의 MCP 응답을 전후 비교했고 기존 동작 시험을 실행했다. UI 입력·터미널 등 변경하지 않은 이전 통과 사례는 반복하지 않았다.

## 시험 대상과 격리

이전 ZIP과 압축 해제본은 그대로 보존한다. 새 `candidate/`는 실제 하네스 시험용 조합이며 새 배포 ZIP이 아니다.

- UI SHA256: `f2fe998b0f224903d26234b0d033b3e7b7faf8198da80aede9f06504e7fa777b` — 이전 제품 UI와 동일.
- 새 adapter SHA256: `2290a96c7c16cb1e3642e6d8023500776d631b28a3d4b058f4243edb3ac343bb`.
- 소스 기준 `46c74b6` + 위 policy 변경. 상세 복사 원본·길이·해시는 `candidate-provenance.json`.
- Claude Code 2.1.270, 사용자가 CLI 로그인 완료. 기존 Desktop/CLI MCP 설정을 수정하지 않는다.
- 준비한 드라이버는 명시적인 시험 MCP 설정, 별도 endpoint 및 WebView 경로, 내장 도구 비활성화, Baton 도구 5개만 허용한다. 한 CLI 프로세스를 유지하며 실제 MCP wire와 응답을 기록한다. 프록시는 바이트를 전달·기록하며 응답을 합성하지 않는다.
- 실제 홈서버 대신 로컬 fixture를 사용할 예정이다. 비밀번호나 인증 토큰은 모델 입력에 넣지 않는다. Desktop/CLI 동시 연결 인수는 보류 상태를 유지한다.

## 실행 대기 사유와 남은 시험

로그인 후 최초 실행 요청은 자동 승인 검토에서 거부됐다. 이유는 Baton 상태·연결 메타데이터의 Anthropic 전송에 대한 명시적 승인이 부족하다는 판단이다. 명령은 시작되지 않았으며 실제 Claude 응답·앱 시작·SSH fixture 실행을 완료했다고 주장하지 않는다. 사용자에게 격리된 시험 데이터의 외부 전송 승인을 요청했다.

승인 후 같은 CLI/MCP 프로세스에서 앱 offline → 시작 → SSH 전달 → sudo 거절·1회 승인·인증 필요 알림 → 사용자 회수·인증·재전달·새 승인 → 앱 종료·재시작을 관측한다. 실제 모델의 정책 준수와 서버 실행 횟수를 함께 확인해야 한다. CLI 시험은 Desktop 경고 UI와 물리 IME/DPI 인수를 대신하지 않는다. Phase 5 전체 및 출시는 미완료다.
