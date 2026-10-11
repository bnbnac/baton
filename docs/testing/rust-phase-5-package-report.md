# Rust Phase 5 Windows 시험 패키지

2026-10-11 KST. **로컬 시험용 ZIP 생성 및 압축 해제본 어댑터 smoke 완료. 전체 Phase 5/출시 인수는 미완료다.** 공개 배포·설치·서명·실제 하네스 설정 변경은 수행하지 않았다.

## 산출물

최종 실행: `artifacts/rust-phase-5/20261010T213817-6aeef27f4382426d968c8f836bd2de91`.

- [Windows x64 ZIP](../../artifacts/rust-phase-5/20261010T213817-6aeef27f4382426d968c8f836bd2de91/Baton-windows-x64.zip), 6,176,776 bytes.
- ZIP SHA256: `afbf6e7fa378d63e39bb9a0db23203327603a8f9c5cfd5db2c9d11812d0e9677`.
- [빌드 summary](../../artifacts/rust-phase-5/20261010T213817-6aeef27f4382426d968c8f836bd2de91/summary.json): `built_unaccepted`.
- [압축 해제본 smoke](../../artifacts/rust-phase-5/20261010T213817-6aeef27f4382426d968c8f836bd2de91/adapter-smoke.json): `adapter_smoke_passed_gui_pending`.
- [사용 안내](../rust-windows-candidate.md).

ZIP에는 `baton.exe`, `baton-adapter.exe`, `README.txt`, `manifest.json`만 있다. 제품 UI는 Windows GUI subsystem 2, 어댑터는 console subsystem 3이며 둘 다 PE32+ x64다. UI 14,494,208 bytes, 어댑터 3,352,576 bytes다. 파일별 해시는 ZIP 안의 manifest 및 실행 폴더에 보존했다. hash는 복사·변조 검사이며 발행자 서명이 아니다.

기준 HEAD는 `0864750`이고 패키징 도구는 당시 미커밋 상태였다. 실제 빌드 입력은 `source-before.json`/`source-after.json`의 파일별 hash로 식별하며 둘의 내용이 같음을 검사했다. source SHA256은 `2b29296b6bfd51db249de605bf4bf1f681df405ac70d4bc5af5ea476988d6d71`이다. 이후 보고서·계획 체크박스와 로컬 커밋 기록만 바뀌며 이것을 이유로 제품 빌드를 반복하지 않는다.

## 빌드와 검증

명령: `rust/scripts/build-windows-candidate.ps1`. Rust/Cargo 1.88.0, Node 22.17.0, Windows x64 10.0.26200. 상세 환경과 사용한 dumpbin 경로는 실행 폴더의 `environment.json`에 기록했다.

TypeScript 검사와 Vite 제품 assets 빌드 후 Cargo `--release --target x86_64-pc-windows-msvc --offline --locked`로 UI와 어댑터를 생성했다. UI feature는 `desktop,tauri/custom-protocol`로 embedded assets를 사용한다. acceptance/endpoint-diagnostics feature는 활성화하지 않았다. 초기화 오류가 미확정이라는 사실을 배포용 재시도나 진단 숨기기로 우회하지 않았다.

| 항목 | 결과 |
|---|---|
| 패키지 계약 9개 | pass; 정상 파일 집합·hash/PE, 변조·누락·추가·잘못된 PE/아키텍처/subsystem/manifest/경로 거부 |
| 보고서 경로 3개 | pass; 배타적 새 파일, payload 덮어쓰기·패키지 내부/별칭 경로 거부 |
| 기존 stdio helper 회귀 6개 | pass, skip 0 |
| 제품 release 빌드/manifest 생성·검증 | pass |
| ZIP 해제 후 별도 경로 실행 | pass, `압축 해제 검증` 디렉터리 사용 |
| 어댑터 smoke | initialize·5 tools·offline status·offline 입력 거부·EOF exit 0·깨끗한 stdout/stderr |
| smoke fixture 정리 | pass |
| builder 출력 경로/기존 디렉터리 거부 | 두 경우 모두 nonzero, 기존 출력 보존 |

smoke는 압축 해제된 어댑터의 절대 경로를 실행했고 작업 디렉터리는 별도 임시 폴더, endpoint는 존재하지 않는 fixture 경로다. 자식 PATH는 Windows와 System32만 남겼다. 이 호스트의 개발 도구를 제거하지는 않았으므로 깨끗한 VM 인수라고 부르지 않는다. 특히 설치된 System32 런타임은 그대로 사용 가능하다.

두 release 실행 파일을 dumpbin `/dependents`로 검사해 로그를 남겼다. UI에는 `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll` 의존성이 있어 WebView2와 Microsoft Visual C++ x64 런타임 조건을 안내에 명시했다. ZIP은 이 런타임 설치/복구를 수행하지 않는다.

## 실패와 리뷰 처리

1. 최초 Tauri CLI 빌드는 프런트엔드 생성 후 `target was empty`로 실패했고 Cargo.toml에 빈 features 배열도 자동 추가했다. `20261010T213313-94de442c9021495d94bdd431e077838a`의 실패 로그를 보존했다. 자동 변경만 되돌리고 명시적 target의 Cargo 빌드와 TSC/Vite 단계로 나눴다. 환경 override 제거는 환경 변수 삭제로 처리한다.
2. 최초 성공 ZIP은 `20261010T213424-46b2fe216c704d69a54e3f95785907b5`에 보존한다. 이후 리뷰 수정과 VC++ 안내 반영 때문에 최종 실행을 새 디렉터리에서 생성했다. 같은 결과를 덮어쓰지 않았다.
3. 독립 리뷰는 smoke 보고서가 기존 증거나 패키지 파일을 덮어쓸 수 있음을 지적했다. 재현 시험 3개가 실패함을 확인한 뒤, 실제 부모 경로가 패키지 밖인지 검사하고 실행 전에 `wx`로 새 파일 핸들을 확보하게 수정했다. 최종 보고서도 그 핸들로만 쓴다. 12개 시험 및 실제 압축 해제본 smoke가 통과했다. 별도 두 번째 독립 리뷰는 하지 않았다.

## 남은 인수

패키지 생성 시점에는 실제 UI 조작이 미검증이었다. 후속 [제품 UI 기능 smoke](rust-phase-5-product-ui-report.md)에서 같은 바이너리의 로컬 SSH 비밀번호 인증·호스트키·전달·회수·정상 종료를 확인했다. 키/MFA, 한글/붙여넣기/물리 IME·DPI100/150/200, vi/top, 실제 Claude/Codex 단일 하네스 및 sudo, 깨끗한 Windows/다른 사용자 경계, release용 property·race·4면 fuzz·2시간 soak·전체 프로세스 수명100회가 남아 있다. 과거 초기화 flakiness도 원인 미확정이며 출시 차단을 유지한다. 보류된 Desktop/CLI 동시 연결은 재개하지 않았다.

후속 [화면 캡처 진단](rust-capture-diagnostics-report.md)은 직접 WebView 캡처와 창 캡처를 비교해 제품 변경 없이 의심을 해소했다. [LIFE-03 원격 종료 비교](rust-phase-5-lifetime-report.md)는 시험한 OpenSSH/bash 프로필에서 정상·강제 종료 네 경우를 확인했다. 2026-10-12까지 수행한 [LIFE-04 연결 장애](rust-phase-5-network-fault-report.md)는 TCP close·서버 kill·패킷 blackhole을 구분해 관측했다. blackhole 복구의 제한 대기 실패와 이후 재전송 없는 실행 1회는 함께 보존하며, 즉시 단절 탐지나 제한 시간 내 복구를 주장하지 않는다. 다음 작업은 키/MFA 등 나머지 Phase 5 인수다. 패키징 단계의 18개 자동 시험 및 어댑터 smoke를 전체 Rust/GUI/출시 통과 수로 확대하지 않는다. 원래 패키지 receipt의 `gui_pending`은 생성 당시 기록으로 보존하며, 후속 결과는 별도 보고서에 둔다.
