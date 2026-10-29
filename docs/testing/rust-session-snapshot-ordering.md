# 전체 세션 목록의 순서 역전 수정

2026-10-29 KST. PR #11에서 발견한 P2 제어권 표시 경합의 후속 수정이다. 기준 커밋은 `2a191d412f8d017588b319aac65549d28f0b8a39`이며, 제품 권한·공개 출력·회수 의미는 변경하지 않는다.

## 원인과 선택

서버는 목록을 생성할 때의 잠금을 풀고 나서 별도로 전송했다. 오래된 전체 목록이 최신 목록보다 나중에 전송될 수 있었고 프런트엔드는 이를 무조건 적용했다. 또한 초기 `list_sessions` 명령 응답과 채널 알림은 도착 순서가 독립적이어서, 늦게 도착한 초기 응답도 최신 화면을 덮어쓸 수 있었다.

전송까지 잠금을 유지하는 방식은 초기 명령 응답과 채널 사이의 순서를 해결하지 못하며 전송을 상태 잠금에 묶는다. 이번에는 전체 목록에 단조 증가 revision을 부여하는 방식을 선택했다. 번호는 `AppState` 잠금 안에서 목록과 함께 캡처하고, 전송 전에 잠금을 해제한다. 초기 응답도 같은 번호 발급 경로를 사용한다.

프런트엔드 `subscribe`는 초기 응답과 알림을 한 수신 함수에 전달하며 마지막으로 적용한 번호 이하의 목록을 무시한다. `main.ts`의 별도 초기 배열 덮어쓰기를 제거했다. 세션별 epoch 비교만으로는 같은 epoch의 종료·목록 제거를 처리하지 못하므로 전체 목록 번호를 사용한다. heartbeat·인증·연결 알림은 기존 흐름을 유지한다.

번호는 기존 `SafeInt`로 표현한다. JavaScript 안전 정수 범위를 넘기면 세션을 닫고 `session_revision_exhausted` 오류를 반환하며, 번호를 순환시켜 이전 목록과 혼동하지 않는다. 변경한 형식은 앱 내부 UI 명령/알림이며 MCP v2 wire 형식은 변경하지 않았다.

## 재현과 검사

- Rust sink 경계에서 두 세션을 포함한 옛 목록을 고정 대기시켰다. 다른 세션을 닫은 최신 목록이 먼저 전달된 뒤 옛 목록을 전달했다. 원래 코드에서는 순서를 식별할 revision이 없어 실패했다. 수정 후에는 도착 순서와 무관하게 옛 번호가 작고, 앞뒤 초기 응답도 같은 번호 순서를 사용함을 확인했다.
- 실제 프런트엔드 `subscribe`에 Tauri `mockIPC`로 전송 경계만 대체했다. 전달 완료 알림 뒤에 옛 사용자 제어 목록을 넣으면 원래 코드는 사용자 제어로 돌아가 실패했다. 수정 후 `Ownership`의 회수 요청은 최신 epoch를 유지하고 `InputController`는 사용자 입력을 거부한다.
- 늦은 초기 응답, 초기 응답만 있는 시작, 알림보다 최신인 초기 목록, 같은 epoch에서의 종료·제거, 중복/유효하지 않은 번호와 뒤따르는 정상 목록을 검사했다. Rust에서는 번호 소진 시 실제 세션 종료와 추가 연결 거부도 검사했다.

원래 코드의 RED는 Rust 1개 실패(exit 101), 프런트엔드 3개 실패/16개 통과(exit 1)였다. 오류 없이 실행된 동작 assertion 실패이며 로그를 보존했다. 최소 수정 후 GREEN은 해당 Rust 1개·프런트엔드 19개 통과였고, 초기 응답 번호 대조·번호 소진·잘못된 번호 검사를 보강한 최종 결과는 아래와 같다.

| 최종 검증 | 결과 |
|---|---|
| `cargo +stable test --manifest-path rust/Cargo.toml --offline --locked --workspace --all-targets --no-fail-fast` | **188 pass / 0 fail / 0 ignored**, 31 suite, exit 0 |
| `cargo +stable clippy --manifest-path rust/Cargo.toml --offline --locked -p baton-app --all-targets --features desktop -- -D warnings` | exit 0. 실제 desktop 명령/DTO 컴파일 포함 |
| `npm test` | **21 pass / 0 fail**, exit 0 |
| `npm run build` | TypeScript 검사와 Vite 빌드 exit 0 |

최종 검증은 기준 커밋을 archive한 사본에 수정 소스·시험 8개만 덮은 별도 폴더에서 수행했다. 미커밋 Cargo 변경·미완성 fuzz는 포함하지 않았고, 기존 Cargo 캐시/target과 node_modules를 재사용했다. 원시 증거와 overlay SHA256은 로컬 `C:/Users/sj/Documents/work/code/baton/artifacts/session-order-20261029/`의 `source-inputs-final.json`, `backend-red.log`, `frontend-red.log`, `workspace-tests.log`, `desktop-clippy.log`, `frontend-tests-final.log`, `frontend-build.log`에 있다. 이 원시 증거는 push하지 않는다.

별도 읽기 전용 리뷰는 수정 파일과 직접 호출부를 확인했다. 초기 응답도 같은 번호 체계에 들어가고, 전송 전 잠금이 풀리며, acceptance 구독 호출부도 새 반환형과 호환됨을 확인했다. 새 P1/P2나 데드록 지적은 없었다. 이를 저장소 전체 재감사로 확대하지 않는다.

## 남는 한계

이번 시험은 순서를 고정한 서비스/프런트엔드 회귀 검사다. 실제 WebView에서 자연 발생 빈도를 측정하거나 물리 입력·SSH·하네스 시험을 반복한 것은 아니다. 수정 당시에는 ZIP을 만들지 않았으나, 후속 작업에서 `edacf24`의 앱·어댑터를 함께 재빌드한 **`Baton-personal-edacf24-windows-x64.zip`에 수정을 포함했다**. 기존 이름의 개인 사용 ZIP에는 이 수정이 없다. [새 패키지 점검 기록](rust-personal-use-check.md)을 참고한다. 오래된 패키지의 메모리/입력/하네스 검증을 수정된 새 바이너리의 증거라고 주장하지 않는다.

과거 IPC 초기화 두 실패, 원래 메모리 증가의 원인, 잔여 환경·퍼징·변이 검증은 기존 문서대로 유지한다. `phase5Acceptance=false`이며 이번 수정 완료가 정식 출시 승인이나 자동 병합을 뜻하지 않는다.
