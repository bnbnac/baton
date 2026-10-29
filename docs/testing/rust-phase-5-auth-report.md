# Rust Phase 5: 제품 UI의 키·다중 라운드 인증

2026-10-12 KST. **기존 배포 후보에서 암호화 키, 잘못된 키 암호, 두 라운드 추가 인증, 라운드 사이 취소, 오답, 비밀번호 후 추가 인증의 6개 사례를 확인했다.** 서버는 합성 ssh2 fixture다. 실제 OpenSSH의 키 호환성·PAM/TOTP 정책이나 전체 AUTH-01/02·Phase 5 완료로 확대하지 않는다.

## 대상과 방법

[Windows 시험 ZIP](rust-phase-5-package-report.md)의 압축 해제본을 그대로 실행했다. 작업 기준 HEAD는 `d252be4`다. UI와 어댑터 SHA256이 기존 후보와 같음을 실행 후 검사했으며 제품 소스·빌드·사용자 하네스 설정을 변경하지 않았다.

실제 제품 UI를 Windows 컴퓨터 제어로 조작했다. 연결 폼의 인증 방식을 선택하고 서버 지문을 시험 서버의 지문과 비교한 뒤 수락했다. 키는 Windows 파일 선택창에서 이번 시험이 생성한 파일만 선택했다. 모든 암호·OTP·키는 합성 시험값이다. UI acceptance hook이나 내부 명령 주입을 사용하지 않았다.

서버는 기존 [SSH fixture](../../rust/tests/fixtures/ssh.mjs)를 사례별 별도 프로세스로 실행했다. 임시 Ed25519 호스트키, AES-256-CTR로 암호화한 Ed25519 사용자 키를 생성한다. 공개키 인증은 대응하는 키와 서명을 검증한다. 추가 인증은 두 차례 별도 challenge를 전송하고 각각의 정답을 검사한다. 비밀번호 전환 사례는 password 응답에 partial-success와 keyboard-interactive 요구를 반환한다. 이는 실제 SSH 프로토콜을 사용하는 합성 서버이며 운영용 OTP 생성·만료·PAM 통합 시험은 아니다.

[증거 폴더](../../artifacts/phase5-auth-20261012/)의 `driver.mjs`와 `driver-run2.mjs`를 Node로 실행했다. `requests` 디렉터리의 `start`/`capture`/`stop` 요청이 시험 서버 생성·관측·정리를 제어한다. 준비 응답에는 포트·호스트키 지문·시험 키 경로만 기록하고 키 원문은 넣지 않았다. 서버 audit에는 인증 방법, challenge 횟수, PTY·shell·연결 종료 이벤트를 기록했다. 입력한 인증값은 audit 대상이 아니다.

## 결과

| 사례 | 서버 인증 방법 / challenge | PTY / shell | 관측 |
|---|---|---|---|
| 암호화 키 정상 | publickey 2회 / 0 | 1 / 1 | 제품 UI가 사용자 제어로 전환. 정상 연결 종료 확인 |
| 잘못된 키 암호 | 인증 요청 0 / 0 | 0 / 0 | 복호화 실패 뒤 서버 연결 종료. 다른 인증 방식 자동 시도 없음 |
| 추가 인증 두 라운드 정상 | keyboard-interactive 1회 / 2 | 1 / 1 | 각각 별도 입력란을 거쳐 사용자 제어로 전환 |
| 두 번째 라운드에서 취소 | keyboard-interactive 1회 / 2 | 0 / 0 | 두 번째 프롬프트에서 `연결 종료`, UI 종료됨 및 서버 연결 종료 |
| 첫 라운드 오답 | keyboard-interactive 1회 / 1 | 0 / 0 | UI `AuthFailed`, 연결 종료. 두 번째 challenge와 자동 재시도 없음 |
| 비밀번호 후 추가 인증 | password → keyboard-interactive / 2 | 1 / 1 | 비밀번호 뒤 첫·둘째 OTP 입력란, 이후 사용자 제어로 전환 |

publickey 2회는 이 정상 인증의 서버 관측 횟수다. fixture는 서명 없는 공개키 조회와 해당 키의 서명된 요청을 처리하며, 이를 별도 두 번의 셸 실행으로 세지 않는다. 성공 사례의 셸 생성은 각각 정확히 1회다.

키 사례는 증거 폴더 루트의 `encrypted-key-audit.json`, `wrong-key-audit.json`과 첫 실행 응답에 있다. MFA 네 사례는 `run2/*-audit.json`과 대응 `*.response`에 있다. UI 증거는 `*-ui.txt`이며, 취소 직전 두 번째 challenge 및 비밀번호 후 각 challenge를 별도로 보존했다.

## 중단과 증거의 한계

키 성공·실패 직후 대화가 중단된 사이 첫 실행은 30분 한도 이후 정리돼 `normalExit=false`, `forcedCleanup=true`, supervisor exit 1로 남았다. 어댑터·시험 SSH 서버는 exit 0이고 WebView 자식 종료 audit은 verified다. 이 실행을 정상 앱 종료 통과로 세지 않았다.

첫 실행에서 준비만 해 둔 MFA 서버의 이벤트는 빈 배열이다. 이 사례는 미실행으로 제외했고, run2에서 미완료 MFA만 진행했다. 완료된 키 시험은 반복하지 않았다. 잘못된 키 암호 사례의 최종 UI 오류 화면은 중단 전에 저장하지 못했으므로 그 메시지 자체는 검증했다고 주장하지 않는다. 서버 측 인증 요청·PTY·shell 0회와 연결 종료는 보존된 audit으로 확인했다.

인증 UI에서 입력값이 마스킹되고, 라운드 전환·종료 뒤 인증 폼이 사라지는 것을 관측했다. 관측 가능한 UI 결과이며 메모리의 완전한 삭제를 입증하지 않는다. MCP status transcript·서버 audit·제품 프로세스 로그·저장한 UI 기록에서 합성 암호/OTP의 검사 대상 표현과 private-key 표식이 없음을 검사했다. 숫자 OTP 원문은 JSON 문자열 형태, 추가로 hex/base64를 검사했다. 이 실행에서는 에이전트에 세션을 전달하지 않았으므로 MCP `read_output`의 인증정보 비노출을 새로 검증했다고 주장하지 않는다.

## 검증과 정리

`node artifacts/phase5-auth-20261012/verify.mjs`의 기록 일관성 검사 28개가 통과했다. [검증 receipt](../../artifacts/phase5-auth-20261012/verification.json)는 `six_synthetic_auth_cases_verified`다. 28개는 독립 제품 사례 수가 아니며 제품 시험을 재실행한 것도 아니다.

run2는 제품 창 정상 종료, exit 0, 강제 정리 없음, WebView 자식 종료 확인으로 끝났다. 모든 시험 서버와 어댑터 exit 0, stderr 비어 있음이 `run2/cleanup.json`에 기록됐다. 첫 실행을 포함한 시험 포트 7개에 listener가 없음을 확인하고 합성 개인 키 파일 두 개를 삭제했다. 파일 hash와 정리 시각은 [최종 정리 기록](../../artifacts/phase5-auth-20261012/final-cleanup.json)에 있다. 원시 artifacts는 gitignored 로컬 증거이며 다른 checkout에 자동 포함되지 않는다.

실제 OpenSSH의 암호화 키 연결, 운영 환경 MFA 정책, 호스트키 거절·인증 시작 전 취소·잘못된 비밀번호 등 배포 후보의 나머지 인증 거부 경로는 이 보고서의 통과 범위 밖이다. 기존 라이브러리 시험 결과를 해당 제품 UI 인수의 대체로 사용하지 않는다. 나머지 출시 조건과 과거 초기화 flakiness의 차단 상태는 [패키지 보고서](rust-phase-5-package-report.md#남은-인수)에 유지한다.
