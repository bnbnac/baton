# Rust 단계 0 기술 검증 기록

2026-09-20. **전체 판정: blocked. 제품 전환 완료나 단계 1 착수 승인이 아니다.**

자동 시험 51개가 통과했다. 실제 Windows 키·붙여넣기·IME·마우스·숨김/최소화 복귀와 WebView 하위 프로세스 종료는 미확인이다. 자동 시험의 skip은 0이지만, 이 미확인을 성공에 합산하지 않는다. `verify-phase-0.ps1`은 수동 증거가 없으면 종료 코드 2를 반환한다.

## 경계별 결과

| 경계 | 고정 버전 | 실행 / 관측 | 통과·실패·skip | 판정 |
|---|---|---|---|---|
| SSH·인증 | russh 0.63.1, ssh2 1.17.0 | 독립 서버 audit, PTY·resize, 암호화 키, 2회 keyboard-interactive, partial-success, 거부·취소·늦은 성공 | 12·0·0 | adopt: 라이브러리 실험 범위 |
| 실제 OpenSSH | 저장소 `tests/linux-ssh/Dockerfile` | 실제 `stty` 32×120 → 27×91, sleep 인터럽트 후 같은 셸 명령 성공 | 1·0·0 | adopt: 해당 fixture 범위 |
| MCP stdio | rmcp 3.4.0, 프로토콜 2025-11-25 | SDK와 독립인 JSON-RPC client, offline 상태/오류, 동시 status, 취소, EOF | 5·0·0 | adopt: offline transport 범위 |
| 토큰·출력 예산 | Rust 1.88.0 | 중복·만료·세대·다른 세션, 32개 조회 상한, 64KiB in-flight / 1MiB queue, 잘못된 ack·안전 정수 상한 | 8·0·0 | adopt: 순수 경계 로직 |
| 실제 WebView | Tauri 2.11.6, xterm 6.0.0, FitAddon 0.11.0 | Tauri Channel → xterm write → typed reply → Rust 수신; 기본 xterm과 바이트 비교 | 20·0·0 | blocked: 아래 물리 조작 미확인 |
| 강제 실패 정리 | Node 22.17.0, PowerShell, Docker | fixture-ready, auth-held, MCP wait, WebView ack wait, container-ready; 별도 sentinel 생존 | 5·0·0 | blocked: WebView 하위 프로세스 별도 감사 필요 |

기존 C# 기준 시험은 별개로 49 통과 / 선택 Linux fixture 1 skip이었다. Rust 통과 수에 포함하지 않았다. 이 실험의 일반 입력은 Rust 수신 카운터까지 확인하며 SSH와 xterm이 하나의 제품 경로로 결합된 시험은 아니다.

## 환경과 증거

- Windows 버전: `10.0.26200.0`, x86_64 MSVC. macOS/Linux 미검증.
- Rust/Cargo 1.88.0. 설치된 toolchain 이름이 `stable`이므로 runner는 버전을 검사한 후 `+stable`을 쓴다. 머신 toolchain은 변경하지 않았다.
- WebView2: `153.0.4234.48` (Tauri SDK에서 조회).
- Tauri CLI 2.11.5, API 2.11.1, Vite 8.3.0, TypeScript 7.0.2. 정확한 전이 의존성은 lockfile 기준이다.
- Docker Desktop 4.59 / Engine 29.2. 고유 이름·label의 loopback fixture만 사용한다.
- 최초 전체 자동 성공: `2026-09-20T09:37:57Z`. 당시 HEAD `9b06c23` + 미커밋 Task 5 소스 manifest. HEAD만으로 시험 코드를 식별하지 않는다.
- 당시 소스 SHA-256: `ED910D178BB4D41CC3E6EC3654E2291C1CCE4EDF9B942A7DA89BB3846B13ADAB`.
- Cargo.lock SHA-256: `5EC5E700F8EF9366794208D28B3414F0C9A0228B75B5FE522D75341B45BACA2A`.
- terminal npm lock SHA-256: `E2C23ACC45E44CF077E82B742DFE21D2A0EB3AC897EBF06D071F2EA65937F407`.
- 최신 실행의 commit, 파일별 해시, sourceDigest, 실행 파일 해시, runtime, 소요 시간, 판정: `artifacts/rust-phase-0/summary.json`.
- 실제 WebView 케이스 결과: `artifacts/rust-phase-0/webview.json`. root PID·시작 시각·종료 확인: 같은 경로의 `.cleanup.json`.

생성된 증거와 빌드 결과는 Git에서 제외한다. 인증정보나 서버 터미널 전문은 보고서에 넣지 않는다. 수동 화면 캡처는 아직 없다.

## 재현

이 문서의 명령은 `codex/rust-phase-0` 작업 트리 루트에서 실행한다. Rust 1.88.0 MSVC, Node/npm, WebView2, Docker Desktop이 필요하다.

```powershell
npm.cmd ci --prefix rust/tests
npm.cmd ci --prefix rust/experiments/terminal-probe
pwsh -NoProfile -File rust/scripts/verify-phase-0.ps1
$LASTEXITCODE
```

runner는 fmt, desktop 기능까지 포함한 clippy, Rust 단위 시험, 실행 파일 빌드, 고정 목록의 Node 시험, 실제 OpenSSH, 실제 WebView를 순서대로 검사한다. 외부 명령 실패, 필수 케이스 누락, source/lock 변경은 성공으로 덮어쓰지 않는다. npm 의존성 설치는 최초 준비 단계이며 runner가 자동으로 시스템 도구를 설치하지 않는다.

종료 코드: **0** 모든 증거 충족 / **1** 실패 / **2** 자동 시험 통과, 수동 증거 미충족. PowerShell을 또 다른 `-Command`로 감쌀 때는 `exit $LASTEXITCODE`로 자식 종료 코드를 보존해야 한다.

## 미확인 수동 시험

빌드된 `rust/target/debug/baton-terminal-probe.exe`를 실행한다. 자동 시험이 끝나면 버튼으로 소유 상태를 바꾸고 Rust 수신 byte 수·거부 횟수·hex를 확인한다. 이 화면은 외부 SSH에 연결하지 않는다. 시험 문자열만 입력한다.

1. **키:** 에이전트 소유에서 `KEY`를 눌렀을 때 수신 byte가 증가하지 않고 거부 횟수가 늘어야 한다. 사용자 입력 허용으로 전환한 후 같은 키는 수신 hex에 `4b4559`가 추가되어야 한다.
2. **붙여넣기:** 시험 문자열 `PASTE`를 실제 붙여넣기로 넣는다. 두 소유 상태에서 차단/정확한 수신을 각각 확인한다. API의 `paste()` 자동 시험은 이 물리 조작을 대체하지 않는다.
3. **IME:** Windows 한국어 IME로 `한글`을 조합하고 확정한다. 에이전트 소유는 0바이트, 사용자 소유는 정확한 UTF-8 `ed959ceab880` 6바이트가 추가되어야 한다. 조합 중간 문자가 이중 전송되지 않아야 한다.
4. **마우스:** 마지막 시험 화면에는 SGR mouse mode가 켜져 있다. 두 소유 상태에서 터미널 내부 클릭/이동에 따른 Rust 수신을 확인한다. 허용된 클릭의 SGR press/release 바이트를 기록한다.
5. **숨김·복귀 / 최소화·복귀:** 자동 시험 중 화면을 숨기거나 최소화했다 복귀한다. 결과 20개, 출력 순서, 중복 응답 0을 확인한다. 현재 자동 runner의 숨김 시작 옵션만으로 통과 처리하지 않는다.
6. **하위 프로세스:** 해당 시험 앱에서 생성된 WebView2 프로세스의 PID·시작 시각을 별도로 기록하고 앱 종료 뒤 종료 여부를 확인한다. 프로세스 이름 일괄 종료나 기존 사용자 프로세스 사용은 금지한다.

화면과 결과를 확인한 뒤 증거 JSON에 현재 summary의 `identity.commit`, `identity.sourceDigest`, 실제 화면 파일의 절대 경로 `screenshot`, 다음 순서의 `cases: [{name, passed}]`를 기록한다:

`physical-key`, `physical-paste`, `ime-commit`, `mouse`, `hidden-restore`, `minimize-restore`, `webview-descendant-exit`.

```powershell
pwsh -NoProfile -File rust/scripts/verify-phase-0.ps1 -ManualEvidence <검증한-증거.json>
```

JSON은 사람의 실제 확인 기록이며 자동으로 채우지 않는다. 코드를 변경하면 과거 증거는 무효다. 스크린샷 하나만으로 입력 바이트나 프로세스 종료를 증명하지 않는다.

## 발견한 경계와 실행 판단

- **CPR 최대 열:** 500열 PTY에서 pending wrap의 xterm 커서 열은 501이다. 최초 시험은 `invalid_position`으로 실패했다. PTY 너비는 500 그대로, 구조화 CPR의 열만 501까지 허용했다. 실제 xterm 기본 응답 `ESC[200;501R`과 비교해 통과했다. 502는 거부한다.
- **기본 자동 응답:** hook 미등록 상태에서 실제 WebView 시험이 실패하는 것을 먼저 확인했다. hook은 토큰이 없어도 지원 조회의 기본 onData 응답을 막는다. Rust가 유효한 조회 토큰 하나당 허용 바이트를 한 번 생성한다.
- **WMI 정리 지연:** WebView 하위 프로세스 정보를 정리 경로에서 조회하자 제한 시간을 넘겨 상위 runner가 종료됐다. 남은 시험 앱 1개를 실행 경로·시작 시각으로 확인해 종료했다. 조회를 제거하고 root PID 신원을 실행 직후 기록하며 내부 제한 시간을 외부 제한보다 짧게 했다. 하위 프로세스 감사는 미확인으로 남겼다.
- **russh 종료:** 로컬 channel close 후 같은 채널의 close callback을 기다리는 방식은 SDK에서 성립하지 않았다. close/disconnect 순서와 연결 작업 종료를 기다리고 별도 서버 audit으로 연결 종료를 관찰한다.
- **SSH 취소:** 전체 진행 future를 취소하는 작은 실행 파일이다. 제품의 재사용 가능한 session actor는 아직 없다. 인증 완료 뒤의 취소 장벽과 늦은 성공 응답에서 셸 생성 0회를 검증했다.
- **Tokio stdin:** 취소용 stdin read는 블로킹 reader를 남길 수 있다. runner는 최종 outcome을 받으면 stdin을 닫는다. 이것은 probe의 제어 계약이다.
- **MCP EOF:** stdin EOF를 별도로 관찰해 대기 작업을 먼저 취소한다. 현재 probe의 도구 argument schema는 빈 객체이며 제품 v2 전체 schema는 후속 단계다. 2025-11-25 계약 관찰용 legacy logging만 한정적으로 허용한다.
- **순차 UI 사례:** case Map 대신 고유 ID를 가진 active case 하나와 Tauri Channel을 쓴다. 제품의 여러 세션 격리는 후속 단계다.
- **작업 도구:** skill의 bash bookkeeping helper 실행이 안 되어 PowerShell 기록으로 대체했다. Tauri CLI는 npm PowerShell wrapper의 인수 전달 문제를 피하려고 Node 진입점을 직접 실행했다. 실험용 Windows 아이콘은 빌드 리소스 요구 때문에 추가했다.
- **의존성:** 설치된 Rust와 호환되는 russh 0.63.1을 고정했다. 더 최신 russh를 시험했다고 주장하지 않는다.

학습 포인트: Rust 소유권은 channel을 drop했을 때의 정리 범위를 드러내지만 원격 종료 확인을 대신하지 않는다. async 취소는 다음 await로 진행하지 않는 것뿐 아니라 SDK 작업·stdin reader 종료까지 관찰해야 한다. Tauri의 typed command는 임의 ANSI 문자열 대신 제한된 응답 종류와 좌표를 Rust에서 검증하게 한다.

단계 1 계획, 제품 세션 actor, 사용자 서버 접속, 실제 하네스 연결·재접속, 설치본 배포, 2시간 soak, 33개 전체 인수 기준은 이번 결과에 포함되지 않는다.
