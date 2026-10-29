# Rust Baton 개인 사용 안내

2026-10-29. 목적은 개인 사용이다. 정식 Phase 5 인수는 미완료이며 [README의 알려진 문제](../README.md)를 먼저 확인한다.

**소스와 아래 ZIP의 차이:** 이후 수정한 [세션 알림 순서 역전 문제](testing/rust-session-snapshot-ordering.md)는 아래 ZIP에 포함되지 않는다. 이번 소스 수정 작업에서는 ZIP을 재빌드하거나 교체하지 않았다. 기존 ZIP에서 제어권 표시·버튼이 실제 상태와 다를 수 있다는 한계를 유지한다.

## 사용할 파일

아래 ZIP·실행 파일과 `artifacts/` 증거는 이 작업 PC에만 보관하며 Git에 커밋하거나 push하지 않는다. GitHub에서 문서를 열면 해당 로컬 파일 링크는 사용할 수 없다. 저장소를 clone한 것만으로 이 패키지를 받는 것은 아니다.

- 로컬 ZIP: [Baton-personal-windows-x64.zip](../artifacts/baton-personal-20261029/Baton-personal-windows-x64.zip).
- 압축 해제 검증 및 사용 폴더: [baton.exe](../artifacts/baton-personal-20261029/ready/baton.exe), [baton-adapter.exe](../artifacts/baton-personal-20261029/ready/baton-adapter.exe).
- 파일 무결성: 같은 폴더의 `manifest.json`. `candidate_unaccepted`는 정식 인수 미완료라는 뜻이며 사용을 금지하는 표시는 아니다.

이번 묶음은 소스를 새로 빌드하지 않고, 10월 28일 attached A/B에서 검증한 두 실행 파일을 복사한다. 앱은 10월 24일 Tao 수정 후보, 어댑터는 10월 13일 하네스 후속 후보다. 패키징 시점의 Git commit은 두 파일을 새로 빌드한 commit이 아니다. 원본 경로·파일 해시와 기존 시험 참조는 패키지 바깥 `assembly-inputs.json`에 기록한다. 기존 10월 11일 ZIP과 구분한다.

## 실행

1. Windows x64에서 ZIP 전체를 쓰기 가능한 새 폴더에 해제한다. 위 `ready` 폴더를 그대로 써도 된다. 실행 중인 앱의 폴더에 덮어쓰지 않는다.
2. WebView2 Runtime과 Microsoft Visual C++ x64 Runtime이 필요하다. 설치·업데이트는 자동 수행하지 않는다. 앱 실행을 위해 Rust/Cargo·Node·.NET SDK를 설치할 필요는 없다. 깨끗한 Windows VM 인수를 완료했다는 뜻은 아니다.
3. `baton.exe`를 일반 사용자 권한으로 실행한다. 같은 Windows 사용자의 Rust Baton은 한 인스턴스만 사용한다.
4. MCP 하네스의 stdio 명령을 이 폴더의 `baton-adapter.exe` **절대 경로**로 지정한다. 인자는 없다. 앱과 같은 Windows 사용자로 실행한다. 기존 하네스 설정은 먼저 보관하며 이 작업에서 자동 변경하지 않는다. 상세 형식은 [Rust 하네스 안내](rust-harness-setup.md)를 따른다.
5. 작업이 없는 시험용 SSH 세션을 연결한다. 비밀번호·개인키 암호·MFA는 앱에서 직접 입력하고 서버 지문을 신뢰할 수 있는 경로로 대조한다.
6. 앱에서 대상 MCP 연결을 확인하고 세션을 전달한다. 사용자 회수는 이후 권한을 회수하는 동작이지 이미 실행된 명령의 취소가 아니다. 회수 경계의 미수신 출력 꼬리는 폐기될 수 있다.
7. 사용을 마치면 SSH 세션과 앱 창을 정상 종료한다. 재실행 시 이전 세션이나 명령을 자동 복원·재전송하지 않는다.

## 10~15분 직접 점검

아래 항목은 실제 사용자가 확인해야 하며 자동화가 키를 주입한 결과로 물리 IME 통과를 대신하지 않는다.

- [ ] 평소 배율에서 창·탭·터미널을 사용할 수 있다.
- [ ] 한글 조합·영문·붙여넣기·선택/복사가 의도대로 동작한다.
- [ ] 시험용 SSH에서 `printf 'BATON_PERSONAL_OK\n'` 같은 무해한 명령의 출력을 확인한다.
- [ ] 사용하는 하네스에서 올바른 연결·세션을 확인하고 전달 후 명령·출력을 확인한다.
- [ ] 사용자 회수 후 직접 입력할 수 있고 에이전트의 옛 권한 요청은 거부된다.
- [ ] SSH 종료·새 연결, 앱 종료·재실행이 동작한다.

아직 체크되지 않은 항목은 실패가 아니라 직접 확인 전이다. 완료되지 않은 점검을 통과로 표시하지 않는다. 결과는 [개인 사용 패키지 점검 기록](testing/rust-personal-use-check.md)에 따로 남긴다.

## 문제가 발생하면

발생 시각, 앱/어댑터 파일 해시, Windows·WebView·하네스 버전, 오류 문구, 직전에 한 동작을 남긴다. 비밀번호·endpoint secret·터미널 원문 전체를 복사하지 않는다. 연결 실패 시 다른 작업 중인 앱을 종료하거나 endpoint 파일을 임의 삭제하지 않는다. 시간에 따라 메모리가 늘면 출력량·세션 수·동작을 함께 기록한다. 같은 성공 시험을 무작정 반복하지 않는다.
