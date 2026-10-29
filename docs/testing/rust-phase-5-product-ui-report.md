# Rust Phase 5 제품 UI 기능 smoke

2026-10-11 KST. **기존 ZIP의 실제 제품 UI에서 SSH 인증·전달·회수·정상 종료를 확인했다. 전체 Phase 5 인수는 미완료다.** 최초 화면 캡처의 글자 획 의심은 후속 [캡처 경로 비교](rust-capture-diagnostics-report.md)에서 제품 변경 없이 해소했다. 제품 코드는 수정하거나 재빌드하지 않았다. 실제 홈서버·하네스 설정·사용자 자격 증명은 사용하지 않았다.

## 실행 대상과 관측 방법

기준 HEAD `b1d1138`. [패키지 보고서](rust-phase-5-package-report.md)의 `20261010T213817-6aeef27f4382426d968c8f836bd2de91/압축 해제 검증`에 있는 `baton.exe`와 `baton-adapter.exe`를 그대로 실행했다. 두 실행 파일 SHA256이 기존 후보와 같음을 실행 후 검사했다.

증거는 [실행 폴더](../../artifacts/phase5-product-ui-20261011/), [기능 검증 결과](../../artifacts/phase5-product-ui-20261011/verification.json), [MCP·SSH 관측 기록](../../artifacts/phase5-product-ui-20261011/transcript.json), [프로세스 종료 기록](../../artifacts/phase5-product-ui-20261011/process.json)에 있다. `verify.mjs`는 저장된 관측 자료에 대한 17개 단언을 통과했다. 이것을 17번의 독립 GUI 실행 또는 전체 회귀시험 통과로 계산하지 않는다.

제품 UI는 `@oai/sky`로 직접 조작했다. MCP는 압축 해제본 어댑터의 실제 stdio 프로토콜을 사용했다. 별도 로컬 `ssh2` 서버는 가짜 계정 `fixture-product`와 시험 암호만 받아 입력 바이트·PTY 크기·연결 종료를 기록했다. 이 서버는 명령을 실행하는 OS 셸이 아니다. 시험 전용 `LOCALAPPDATA`와 `WEBVIEW2_USER_DATA_FOLDER`를 사용했으며 프로세스 Job으로 이번 실행의 하위 프로세스를 추적했다.

## 결과

| 항목 | 관측 |
|---|---|
| 어댑터 선행 실행 | 처음 `offline`, 제품 실행 후 동일 어댑터가 `online` 반환 |
| SSH 인증 | UI 지문과 서버에서 독립 계산한 SHA256 지문 일치 확인 후 신뢰, 비밀번호 인증 후 사용자 제어 진입 |
| 사용자 입력 | UI에서 `a` 키 → 서버 `61` 수신 |
| 전달 | UI에서 시험 MCP 선택·전달 → `agent_owned`, epoch 1, 새 stream ID |
| 출력 공개 경계 | 전달 전 `PRIVATE_BEFORE`가 UI에 표시됐지만 첫 MCP read는 빈 문자열·cursor 0 |
| 공개 출력 | 전달 후 `PUBLIC_AFTER 한글 😀\r\n`을 MCP가 정확히 반환 |
| 사용자 입력 차단 | 에이전트 제어 중 터미널에서 `b` 키를 눌러도 서버 수신은 `61` 그대로 |
| 에이전트 입력/중복 | 같은 request ID의 `AGENT_INPUT` 2회 요청 → 서버에 1회만 도착. Ctrl+C는 `03` 도착 |
| 사용자 개입 요청 | UI에 요청 사유와 `회수해서 처리` 표시. 알림 상태에서 에이전트 제어 유지 |
| 회수 | UI 버튼으로 `user_owned`, epoch 2, stream null. 이전 권한으로 send/read 모두 `control_unavailable` |
| 입력 복원 | 회수 후 `c` 키 → 서버 끝에 `63` 추가. 거부된 에이전트 입력은 도착하지 않음 |
| 앱 정상 종료 | SSH 연결을 남긴 채 창 닫기 → 제품 exit 0, 강제 정리 없음, 관측한 WebView 하위 프로세스 10개 모두 종료 |
| 어댑터 생존 | 앱 종료 후 같은 어댑터가 오류 없이 `offline`, 빈 세션 목록 반환. 이후 stdin EOF로 exit 0, stderr 비어 있음 |
| 서버/fixture 정리 | SSH 서버가 `closed: true` 관측. 시험 서버·감시자 exit 0. 시험 리스너 및 제품/driver PID 잔존 없음. endpoint에는 `app.lock`만 남고 discovery 삭제 |

최종 서버 수신 hex는 `614147454e545f494e5055540363`이다. 사용자 `a`, 에이전트 `AGENT_INPUT` 1회, Ctrl+C, 사용자 `c` 순서다. UI 높이 변화에 따라 서버에서 PTY 102×16 → 100×15 → 102×16도 관측했다. 이는 실제 Windows 배율 변경 시험을 대체하지 않는다.

## 제한과 다음 검토

[회수 후 화면 캡처](../../artifacts/phase5-product-ui-20261011/reclaimed-window.png)에서 터미널 글자 일부 획이 불명확하다. MCP 문자열은 정확했으나, 실제 렌더링과 화면 캡처 중 어디서 발생했는지는 분리하지 못했다. 화면 품질·한글 표시를 이번 실행으로 통과 처리하지 않는다. 컴퓨터 제어 도구의 접근성 포커스도 터미널 대신 문서를 반환했으므로 입력 성공은 서버 바이트 관측으로 판정했다. MCP 선택 팝업 좌표 클릭은 도구의 창 경계 검사에 한 번 거부됐고, 창 재관측 후 키보드로 선택을 확정했다.

앱 종료가 **SSH 연결을 닫는 것**은 이 fixture에서 확인했다. 이후 별도 [LIFE-03 OpenSSH 비교](rust-phase-5-lifetime-report.md)에서 실제 서버의 셸·foreground/background/nohup 프로세스 수명을 검증했다. 위 단락은 최초 smoke 당시 관측을 보존하며, 후속 화면 진단은 [캡처 보고서](rust-capture-diagnostics-report.md)에 있다. 실제 하네스, 키/MFA, 물리 IME, DPI, 깨끗한 Windows/다른 사용자 경계, LIFE-04 장애·property·fuzz·soak 등 기존 인수 항목과 과거 초기화 flakiness의 출시 차단도 유지한다. 보류한 Desktop/CLI 동시 연결은 시험하지 않았다.
