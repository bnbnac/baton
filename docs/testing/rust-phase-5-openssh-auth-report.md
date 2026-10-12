# Rust Phase 5: OpenSSH 키 인증과 인증 거부

2026-10-12~13 KST. **실제 OpenSSH 서버에서 암호화 Ed25519 키 연결과 MCP 명령 실행, 호스트키 거절, 비밀번호 입력 전 취소, 잘못된 비밀번호의 네 사례를 확인했다.** 제품 코드는 변경하지 않았다. 다른 키 종류·모든 서버 정책·전체 Phase 5 통과를 뜻하지 않는다.

## 대상과 방법

[기존 Windows ZIP](rust-phase-5-package-report.md)의 압축 해제본을 실제 UI로 조작했다. 작업 기준 HEAD는 `97fa270`이다. 종료 후 검사한 UI·어댑터 SHA256은 기존 후보와 동일하다. 내부 acceptance hook은 사용하지 않았다.

서버는 프로젝트 `tests/linux-ssh/Dockerfile`로 만든 localhost 전용 컨테이너이며 OpenSSH 10.3p1 / OpenSSL 3.5.7이다. 설정에는 `UsePAM no`가 있지만 실제 서버 로그는 `Unsupported option UsePAM`을 기록했다. 2026-10-13 원본 로그 재확인으로 이 설명을 정정하며, PAM 지원·정책 검증으로 해석하지 않는다. 인스턴스 명령에 `-E /tmp/baton-auth.log -o LogLevel=DEBUG3`를 지정했다. 인증 종류와 PTY·shell 요청을 독립적으로 확인하기 위한 서버 로그이며 실제 사용자의 서버나 자격 증명은 사용하지 않았다.

시험마다 `begin` 시점의 로그 길이를 저장하고 `capture`에서 이후 구간을 수집했다. 앞 사례의 종료 기록을 확인한 뒤 다음 사례를 시작했다. 각 판정 구간에는 해당 연결 1개가 있으며, 거부 사례에서 관측되지 않은 PTY·shell 로그가 성공 사례에서는 생성되는 것을 확인했다.

키는 ssh2의 Ed25519 생성기로 만든 합성 암호화 개인 키(AES-256-CTR)다. 대응 공개키만 fixture 계정의 `authorized_keys`에 등록하고 디렉터리 0700·파일 0600 및 소유자를 설정했다. 제품 UI에서 Windows 파일 선택창으로 그 개인 키만 지정하고 합성 키 암호를 입력했다.

[증거 폴더](../../artifacts/phase5-openssh-auth-20261012/)에 `container.json`, 준비 응답, 사례별 `*-audit.json`, `*-ui.txt`, 원시 MCP transcript와 프로세스 종료 기록이 있다. `driver.mjs`와 `driver-resume.mjs`를 Node로 실행하고 `requests/*.json`으로 시작·관측·MCP 호출·종료를 제어했다. 실제 인증은 제품 UI에서만 수행했다.

## 결과

| 사례 | 제품 UI | OpenSSH 관측 |
|---|---|---|
| 호스트키 거절 | `HostRejected`, 종료됨 | 사용자 인증 요청 0, PTY·shell 요청 0, preauth 연결 종료 |
| 비밀번호 입력 전 취소 | 빈 Password 프롬프트에서 연결 종료, 종료됨 | 사용자 인증 요청 0, PTY·shell 요청 0, preauth 연결 종료 |
| 잘못된 비밀번호 | `AuthFailed`, 종료됨 | password 요청 1, 실패 1, PTY·shell 요청 0. 다른 인증 방식·자동 재시도 없음 |
| 암호화 Ed25519 키 | 사용자 제어 → MCP 전달 → 종료됨 | publickey 요청 2, 인증 수락 1, PTY 할당 1, shell 시작 1, 정상 disconnect와 PTY 해제 |

공개키의 두 요청은 키 조회와 서명 인증 절차이며 셸은 1회만 열렸다. 키 인증 성공 후 동일한 세션 `a70498079c5d43f0e2466131a95fc271`을 UI에서 시험 MCP 연결에 전달했다. 새 request_id로 send_text와 Enter를 각각 한 번 호출해 `printf 'OPENSSH_KEY_OK\n'; whoami; tty`를 실행했다. read_output에서 다음 실제 결과를 확인했다.

```text
OPENSSH_KEY_OK
batonfixture
/dev/pts/0
```

명령 echo만으로 성공 판정하지 않았다. 위 출력 줄의 연속된 내용을 검사했고, 공개 구간에 연결 전 로그인 배너가 포함되지 않았음을 확인했다. UI의 연결 종료 후 MCP status에서도 같은 세션이 `closed`, stream이 null로 바뀌었다. 키 암호·의도적인 오답 비밀번호의 원문/hex/base64 및 private-key 표식은 수집한 MCP 출력·UI 기록·서버/제품 로그에 없었다. 검사한 합성 표식의 비노출 범위이며 모든 비밀값·메모리 삭제에 대한 보장은 아니다.

## 중단·도구 오류·검증 범위

첫 실행에서 세 거부 사례는 완료했다. 다음 키 사례는 인증 제출 전 대화가 중단됐고, 서버 로그에 `Timeout before authentication`이 남았다. 최초 실행 전체에 publickey 수락과 shell 시작이 0인 것도 확인했다. 이 미완료 시도를 성공 사례에 포함하지 않았다. 원래 기록을 보존한 채 `run2`에서 키 사례만 완료했다. 완료된 세 거부 시험은 반복하지 않았다.

첫 실행의 일부 컴퓨터 제어 호출은 자동 승인 검토의 HTTP 429 때문에 실행되지 않았다. 잠시 기다린 뒤 같은 검토 경로로 재시도하고 화면을 다시 확인했다. 이 호출 실패를 제품 인증 실패로 세지 않았다.

최초 증거 검증식은 출력 표식 바로 앞에 CRLF가 있다고 잘못 가정했다. 원시 출력에는 bash의 bracketed-paste 제어문자 뒤 CR과 실제 결과가 있었다. 그 바이트 경계를 반영하도록 검증식만 수정했고 `verification-notes.json`에 기록했다. 제품 수정·동일 시나리오 재실행은 하지 않았다.

`node artifacts/phase5-openssh-auth-20261012/verify.mjs`의 증거 일관성 검사 28개가 통과했다. [검증 receipt](../../artifacts/phase5-openssh-auth-20261012/verification.json)는 `four_openssh_auth_cases_verified`다. 이는 네 제품 사례의 근거 검사 수이며 별도 28개 제품 시나리오가 아니다.

## 정리와 남은 범위

두 실행의 UI·supervisor·어댑터는 정상 exit 0, 강제 정리 없음, WebView 자식 종료 audit verified로 기록됐다. 서버 로그도 별도로 보존했다. 전용 컨테이너의 ID·이름·label·이미지를 확인한 뒤 컨테이너와 시험 이미지 태그를 제거했고 포트 57676에 listener가 없음을 확인했다. 두 실행의 합성 개인 키 파일은 삭제하고 hash만 [정리 기록](../../artifacts/phase5-openssh-auth-20261012/cleanup.json)에 남겼다. 원시 artifacts는 gitignored 로컬 증거이므로 다른 checkout에는 자동 포함되지 않는다.

[합성 키·다중 인증 UI 시험](rust-phase-5-auth-report.md)과 이번 실제 OpenSSH 시험을 구분해 읽는다. RSA/ECDSA 등 다른 키 형식과 운영 환경 PAM/TOTP는 시험하지 않았다. 실제 단일 하네스/sudo, 터미널·물리 IME/DPI, 다른 사용자 경계, 부하 시험 및 초기화 flakiness 등 [나머지 Phase 5 인수](rust-phase-5-package-report.md#남은-인수)는 남아 있다.
