# Rust 개인 사용 브랜치 PR 준비 검토

2026-10-29 KST. 목적은 작업 브랜치의 원격 보관과 검토용 PR 생성이다. 병합·정식 출시 승인 기록이 아니다.

**후속 상태:** 아래 신규 P2는 이후 소스에서 수정하고 결정적 순서 역전 시험으로 확인했다. 수정 사본의 Rust workspace 188개·프런트엔드 21개 시험과 desktop clippy/프런트엔드 빌드가 통과했다. 상세 내용과 기존 ZIP 미반영 한계는 [후속 보고서](rust-session-snapshot-ordering.md)를 따른다. 아래는 PR 생성 당시의 검토·검증 기록이다.

## 대상과 제외 범위

- 원격 base: `b0457ab51e0d63112cafcd73c8dfb6a5ec41c96a` (`origin/main`). fetch 후 확인했으며 base만 가진 추가 커밋은 0개였다.
- 검토·실행한 소스: `877c6b7a67585368927bc6afff955a2e6f7d49a6`. base 대비 142커밋, 481파일, 84,920줄 추가다. 이후 이 검토 기록과 README 경고만 추가한다.
- `git archive HEAD`로 별도 검증 사본을 만들었다. 작업 트리의 미커밋 Cargo 변경과 미완성 fuzz 파일을 포함하지 않았다.
- ZIP, 실행 파일, 원시 로그와 `artifacts/`는 로컬에만 보관한다. 해당 파일을 push하거나 GitHub Release를 생성하지 않는다.
- 기존 C# MVP를 삭제하지 않으며 README에서 Rust 안내와 구분한다.

## 이번 검증

로컬 증거 위치: `<저장소 루트>/artifacts/pr-review-20261029/`. 저장소 clone으로 원시 증거를 받는 것은 아니다.

| 검증 | 결과와 한계 |
|---|---|
| 커밋된 파일 범위 | ZIP·artifacts·미완성 fuzz 파일 없음. 커밋된 Cargo workspace에는 fuzz 멤버가 없음 |
| base 대비 diff check | exit 0 |
| 제품 Rust 시험 | `cargo +stable test --manifest-path rust/Cargo.toml --offline --locked -p baton-core -p baton-ipc -p baton-adapter -p baton-ssh -p baton-app --all-targets --no-fail-fast`: 28 suite, **177 pass / 0 fail / 0 ignored**, exit 0 |
| 프런트엔드 | `npm test`: **15 pass / 0 fail**, `npm run build`: exit 0 |
| Windows desktop 컴파일 | `cargo +stable check --manifest-path rust/Cargo.toml --offline --locked -p baton-app --features desktop --bin baton`: exit 0. vendored Tao 경로와 tauri-runtime-wry 2.11.4 사용 확인 |

Rust 검증은 호스트에서 기존 Cargo 캐시/target을 재사용했다. 프런트엔드도 기존 node_modules를 연결했다. package.json과 package-lock.json은 CRLF→LF 정규화 후 커밋 사본과 내용이 같았고 `npm ls --depth=0`은 exit 0이었다. 깨끗한 머신 설치나 전체 의존성 재설치 검증은 아니다.

최초 프런트엔드 시도는 sandbox의 junction 생성 거부로 의존성을 연결하지 못해 `vite/client` 타입 누락으로 실패했다. 이 로그는 `frontend-tests.log`, `frontend-build.log`로 보존했다. 줄바꿈 차이를 원시 해시 불일치로 감지한 보호 검사도 의존성을 연결하기 전에 중단했다. 내용 대조 후 호스트에서 연결해 실행한 결과는 `frontend-host-*.log`와 `frontend-host-result.json`에 보존했다. 실패를 덮어쓰지 않았다.

앱 실행·실제 SSH·CDP·장시간 메모리·퍼징 시험은 이번에 수행하지 않았다. desktop 검사는 컴파일 검사이며 새 배포 바이너리나 개인 사용 ZIP을 만들지 않았다. 기존 개인 사용 패키지의 별도 점검 범위는 [패키지 보고서](rust-personal-use-check.md)를 따른다.

## 신규 검토 지적: 세션 스냅샷 순서 역전 (P2)

`rust/app/src-tauri/src/app.rs`의 `publish()`는 `list()`로 전체 목록을 만든 다음 별도로 `send()`를 호출한다. 목록 생성 시의 상태 잠금과 `commands.rs`의 Pipe 전송 잠금은 별개다. 독립 세션 감시 작업과 명령 작업 사이에서 이 순서를 직렬화하지 않는다.

가능한 순서는 다음과 같다.

1. 세션 A의 감시 작업이 B의 상태가 UserOwned인 전체 목록을 만들고 전송 직전 지연된다.
2. B의 handoff와 감시 작업이 최신 AgentOwned 목록을 먼저 전송한다.
3. A의 오래된 목록이 나중에 도착한다.
4. `rust/app/src/main.ts`는 sessions를 무조건 교체하고 터미널 입력 상태도 오래된 epoch로 갱신한다. 조용한 셸에서 후속 세션 이벤트가 없으면 잘못된 표시가 유지될 수 있다.

사용자가 에이전트 제어 세션을 사용자 제어로 보거나, 회수 버튼이 비활성화되고 전달 버튼이 활성화될 수 있다. 코어의 stale/ownership 검사는 남아 있어 이 경합 자체를 권한 우회라고 분류하지 않는다. **이 절은 정적 코드 경로 검토 당시의 기록이며 당시에는 실제 재현 시험을 실행하지 않았다.**

PR 생성 당시에는 스냅샷 생성·발행 직렬화 또는 초기 목록 응답까지 포함하는 단조 증가 revision과 순서 역전 회귀 검사를 병합 전 작업으로 남겼다. 당시 PR은 이 미해결 지적을 포함한 초안이었다. 후속 결과는 위 링크를 따른다.

## 검토 범위와 보류

별도 읽기 전용 리뷰는 앱/프런트엔드 연결, 소유권·인증, 코어 출력·입력·수명, IPC 인증·응답 재검사, 어댑터 재연결, 빌드 구성과 관련 문서를 중심으로 수행했다. 481파일 전체의 전수 감사라는 뜻은 아니다.

vendored Tao 전체·SDK 내부, 모든 시험 실행기의 정확성, 원시 artifact 전체 재검증, 물리 입력·다른 사용자 환경과 과거 IPC/메모리 실패 원인은 판단을 유보했다. 기존 정식 Phase 5 미완료 상태를 유지하되, 개인 사용 PR을 위해 정식 출시 검증 전체를 새 선행조건으로 추가하지 않았다.
