# Rust 개인 사용 패키지 점검

2026-10-30 KST 갱신. 목적은 개인 사용 준비이며 정식 Phase 5 인수를 완료하는 작업이 아니다. 상세 안내와 직접 점검표는 [개인 사용 안내](../rust-personal-use.md)에 있다.

## 새 패키지: edacf24에서 재빌드

10월 29일 KST에 커밋 `edacf24de540dc183999633c41d767e67620133f`의 archive에서 앱과 어댑터를 함께 Windows x64 release로 빌드했다. 세션 목록 순서 역전 수정이 포함된다. 기존 ZIP은 덮어쓰지 않았다.

- [새 ZIP](../../artifacts/baton-personal-edacf24-20261029/Baton-personal-edacf24-windows-x64.zip), 6,186,048 bytes.
- ZIP SHA256: `aa3bab314fc63975a01b0e4ff30d29ff0d1431b78c61c2d796928413c85632f8`.
- 앱 SHA256: `15cbb42a1d370ac72abafc4bff85f9249ef51caa8c3972830b79274b6657b03c`.
- 어댑터 SHA256: `42b091c4cbd8c48f9fcf726d94342e8a4a674240a779728dcfad0e3e1e6574c6`.
- 실행 폴더: `artifacts/baton-personal-edacf24-20261029/ready`. 파일은 앱·어댑터·README.txt·manifest.json 네 개다.
- source manifest SHA256: `6045dacb4b1ce4d4fb987617dca18898e3f20e91fc828a0bde2eaf37581a6a9d`.

빌드 입력과 로그는 저장소 기본 경로의 `artifacts/build-edacf24-20261029/`에 보존한다. `source-before.json`과 `source-after.json`을 대조했으며 미커밋 Cargo 변경·미완성 fuzz는 제외했다. `npm ls --depth=0`, `npm run build`, 앱과 어댑터 각각의 `cargo +stable build --release --target x86_64-pc-windows-msvc --offline --locked`가 exit 0이었다. 앱은 `desktop,tauri/custom-protocol` 기능을 사용했다. 기존 node_modules와 Cargo 캐시/target을 재사용했다.

패키지 증거는 작업 트리의 `artifacts/baton-personal-edacf24-20261029/`에 있다. `package.mjs verify`로 원본 패키지와 ZIP에서 해제한 `ready`의 파일 집합·해시·PE를 확인했다. `adapter-smoke.json`은 initialize, 도구 5개, offline status/입력 거부, EOF 0, 깨끗한 stdio 및 Windows 전용 PATH 점검 통과를 기록한다.

`startup-check.json`의 2회 시작(최초+재실행)은 각각 native window·어댑터 online·정상 종료·WebView 자식 종료·endpoint 제거·어댑터 EOF 0을 확인했다. appInstanceId도 달라졌다. 격리 프로필에서 수행했으며 강제 정리, CDP, Playwright, 실제 SSH 및 하네스 설정 접근은 없었다. 이는 창의 시각적 정확성이나 물리 IME 통과를 뜻하지 않는다.

**직접 한글 입력·배율·시험용 SSH·실제 하네스 전달/회수는 pending이다.** 기존 A/B의 장시간 결과를 새 바이너리의 검증으로 확대하지 않는다. `candidate_unaccepted`, `phase5Acceptance=false`, 과거 초기화·메모리 원인 미확정 및 잔여 검증은 유지한다. ZIP·실행 파일·원시 증거는 로컬에만 보관하고 push하지 않는다.

## 이전 패키지 기록 (보존)

아래는 재빌드 전 서로 다른 시점의 후보를 조립한 10월 29일 패키지 기록이다. 새 ZIP과 구분한다.

## 패키지와 출처

이 문서의 `artifacts/` 참조는 로컬 증거다. ZIP·바이너리·원시 로그는 Git 커밋/push 대상에서 제외하며, 아래 해시는 로컬 보관본을 식별하기 위한 기록이다.

- [개인 사용 ZIP](../../artifacts/baton-personal-20261029/Baton-personal-windows-x64.zip).
- ZIP SHA256: `d70cb615772b6e5a7d3df5e1a650bfc3fa6b2e4d08b85f501def2e137f5c7e39`.
- 실행 폴더: `artifacts/baton-personal-20261029/ready` (이 ZIP에서 새로 압축 해제).
- 앱 SHA256: `2e2911c3eb830fc8f207ce3c41852015417c75f1c34ed23f7f8dcab006772316`.
- 어댑터 SHA256: `09823dd5d51cd3b33f286540fe43a03570b3eee81497607a1b5b67336fcb754c`.

10월 28일 attached A/B의 원본 후보와 각각 동일함을 복사 전 확인했다. `package.mjs`로 원본 package와 압축 해제한 ready의 파일 집합·SHA256·PE x64/subsystem을 검사했다. 파일은 앱·어댑터·README.txt·manifest.json 네 개다. 서명 검증이나 깨끗한 Windows 환경 인수를 뜻하지 않는다.

`assembly-inputs.json`은 원본 경로·바이너리 해시·기존 A/B 증거 파일 해시·README 해시·조립 시점 commit을 보존한다. manifest의 `provenance.sourceSha256`은 이 **조립 입력 기록**의 해시다. 서로 다른 시점에 빌드된 두 바이너리를 같은 commit에서 재빌드한 것으로 주장하지 않는다. `candidate_unaccepted` 상태도 유지한다. 원래 빌드 도구나 manifest 형식은 변경하지 않았다.

## 이번에 실행한 점검

| 점검 | 결과와 범위 |
|---|---|
| 원본/복사본/압축 해제본 무결성 | 동일 후보 2개, 파일별 hash·PE·파일 집합 확인 |
| 압축 해제본 어댑터 smoke | initialize, 5 tools, offline status, offline 입력 거부, EOF exit 0, 깨끗한 stdio. PATH는 Windows/System32만 사용. `adapter-smoke.json` |
| 앱 시작·연결·종료 및 재실행 | 총 2회 시작(최초+재실행), 각각 native window 존재·어댑터 online·세션 없음·창 닫기를 통한 exit 0·어댑터 offline/EOF 0 확인. 재실행 app ID가 달라짐 |
| 소유 자원 정리 | 각 실행의 PID·시작 시각·실행 경로로 종료 대상 확인. supervisor가 각 WebView 자식 종료와 정상 종료를 확인, 강제 정리 없음, endpoint.bin 제거 확인 |
| 실사용 SSH·물리 IME·평소 하네스 | **직접 확인 전**. 위 자동 결과를 이 항목의 통과로 확대하지 않음 |

시작 점검은 호스트 환경에서 기존 `desktop-process.ps1`, `close-test-process.ps1` 및 stdio helper를 사용했다. Node 실행 명령은 `node artifacts/baton-personal-20261029/start-check.mjs`다. 전용 LOCALAPPDATA/WebView 데이터 폴더를 사용했고 CDP·Playwright·SSH·사용자 하네스 설정에 접근하지 않았다. 앱의 native window handle은 관측했지만 화면의 시각적 정확성을 확인한 것은 아니다. 기본 사용자 프로필의 기존 앱과 SSH 작업은 대상으로 삼지 않았다.

증거는 `startup-check.json`, `launch-check/cycle-1/process.json`, `launch-check/cycle-2/process.json` 및 각 process.log에 있다. `startup_restart_passed_manual_checks_pending`은 짧은 실행·종료 범위의 통과다. 10~15분 물리 실사용 점검 완료나 과거 초기화 문제 해결을 뜻하지 않는다. 원래 패키지와 시험 증거는 덮어쓰지 않았다.

## 직접 확인 후 남길 것

평소 배율과 실제 하네스에서 시험용 SSH를 사용해 한글 조합·붙여넣기·복사, 무해한 명령·출력, 전달·회수, SSH 종료·새 연결을 확인한다. 아직 결과를 받지 않았으므로 이 항목들은 pending이다. 문제 발생 시 시각·환경 버전·오류·직전 동작만 남기고 인증정보나 터미널 원문 전체는 수집하지 않는다.

README 상단과 ZIP 내 README에는 초기화 원인 미확정, 과거 메모리 증가와 후속 통과, 실제 환경 인수 미완료, 명령 승인/복구 한계, 잔여 fuzz/변이를 명시했다. 개인 사용을 정식 출시 인수 전체가 끝날 때까지 보류하지 않되, 과거 실패를 삭제하거나 전체 통과로 바꾸지는 않는다.
