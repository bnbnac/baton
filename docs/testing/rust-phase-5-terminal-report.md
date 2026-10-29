# Rust Phase 5: 배포본의 대화형 터미널 인수

2026-10-13 KST. **기존 Windows ZIP에서 대화형 top·Vim, Ctrl+C, 한글·이모지 출력과 붙여넣기, 소유 전환에 따른 사용자 입력 차단, 창 크기 변경을 확인했다.** 제품 수정·재빌드는 없었다. 물리 IME·OS 배율 전환과 전체 Phase 5 완료를 뜻하지 않는다.

## 대상과 근거

작업 기준 HEAD는 `f873bd0`. [기존 패키지](rust-phase-5-package-report.md)의 압축 해제본 UI·어댑터를 별도 LOCALAPPDATA/WebView 프로필에서 실행했고, 종료 후 SHA256이 기존 후보와 같은지 확인했다. acceptance hook이나 실제 하네스 설정 변경은 사용하지 않았다.

프로젝트 Linux SSH Dockerfile에 Vim·procps-ng·Python을 추가한 localhost 전용 fixture를 사용했다. OpenSSH 10.3p1, procps-ng 4.0.6, Vim 9.2, Python 3.14.8이며 Windows WebView2는 154.0.4258.62였다. `vi`는 BusyBox이고 `vim`은 별도 설치된 Vim이다. sshd 설정의 `UsePAM no`는 이 빌드에서 unsupported 경고를 냈으므로 PAM 정책 검증으로 해석하지 않는다.

실제 제품 UI로 합성 계정을 인증하고 시험 stdio 어댑터에 전달했다. 명령은 MCP send_text/send_key로 보내고 각 입력에 새 request_id를 사용했다. 사용자 키·붙여넣기는 네이티브 UI 입력으로 주입했다. 서버의 `ps`, 파일 부재, 원시 입력 바이트는 별도 `docker exec`로 관측했다. 이 실행의 SSH 인증·shell 시작은 각각 한 번이었다.

[증거 폴더](../../artifacts/phase5-terminal-20261013/)에는 실행 driver, 원시 MCP 요청·응답, 프로세스 목록, 서버 로그, UI 접근성 기록, 관측 메모 및 정리 결과가 있다. 화면은 대화의 computer-use 캡처로 확인했으며 `observations.json`에 판정 근거와 제한을 남겼다. gitignored 로컬 증거는 다른 checkout에 자동 포함되지 않는다.

## 결과

| 항목 | 실행과 관측 | 판정 범위 |
|---|---|---|
| VT-04 대화형 top | `top -d 60`의 CPU·메모리·프로세스 표와 반전된 헤더 확인. 서버 PID 17, PTY pts/0. `q` 후 프롬프트 복귀 | batch 실행으로 대체하지 않음 |
| VT-04 Vim | `vim -u NONE -i NONE -n /tmp/baton-editor-test.txt`. 두 줄 입력, 한글·이모지, Backspace 후 마지막 글자를 X로 수정, Escape와 `:q!`로 종료 | 대체 화면 진입/탈출 바이트, 커서·색상 및 화면 전환 관측. 서버 파일 부재 확인 |
| Ctrl+C | 실행 중인 `sleep 600` PID 67 확인 후 Ctrl+C. 이후 `AFTER_INTERRUPT`와 `SHELL_PID=16` 출력 | 기다리던 작업은 사라지고 원래 bash는 유지 |
| Unicode·색상 | Vim의 `BATON_EDITOR_TEST 한글 😀`, 셸의 ANSI 빨강 `RED`와 `한글 😀 END` | MCP 문자열과 화면 표시 관측. 모든 Unicode/글꼴 지원 보장은 아님 |
| VT-02 사용자 입력 | 동일 원시 입력 관측기로 에이전트 소유 → 사용자 회수 → 에이전트 재전달을 관측 | 사용자 소유 때만 붙여넣기·키 바이트 도착. 물리 IME·마우스 경로는 이번 대상 아님 |
| GEO-01 크기 | 창 최대화·복원. MCP geometry와 원격 `stty size`가 `102×17 → 274×52 → 102×17`로 일치 | 해당 전환의 세션 ID·epoch·stream 유지. DPI·연속 resize 경합 전체 통과는 아님 |

Vim의 첫 줄은 `BATON_EDITOR_TEST 한글 😀`, 두 번째 줄은 `SECOND_LINE`을 입력한 뒤 마지막 E를 지워 `SECOND_LINX`로 바꿨다. 원시 출력의 `ESC[?1049h`와 `ESC[?1049l`로 대체 화면 진입·탈출도 확인했다. `:q!` 뒤 서버에서 편집 파일이 없었고, 후속 명령으로 셸 복귀를 확인했다. 저장 실패로 파일이 없었던 사례가 아니다.

모든 대화형 작업의 부모 셸은 PID 16, `/dev/pts/0`이었다. 연결을 끝내기 전에는 top·Vim·sleep이 사라지고 셸이 남았으며, 연결 종료 후에는 해당 PTY 프로세스도 없었다.

## 붙여넣기와 소유 전환

Python 관측기가 같은 PTY를 raw 모드로 읽으면서 bracketed paste를 활성화했다. 관측기 PID 81과 시작 시각이 전 구간에서 같았다. Ctrl+Shift+V로 합성 문자열 `BATON_PASTE 한글 😀`를 붙여넣고, 일반 키 `a`, Backspace, Shift+A를 별도로 보냈다.

- 최초 AgentOwned: 붙여넣기·키 시도 후 수신 0바이트.
- UserOwned: `ESC[200~` + 문자열의 정확한 UTF-8 + `ESC[201~`이 한 번 도착했다. 키 입력은 뒤에 `61 7f 41`만 추가됐다.
- 재전달 AgentOwned: 같은 붙여넣기·키 시도 후 추가 0바이트. 관측기를 정상 종료한 최종 기록에서도 바이트는 불변이었다.

회수 시 epoch 2·stream null, 재전달 시 epoch 3·새 stream을 확인했다. 사용자 구간의 raw 관측기는 입력을 출력으로 echo하지 않으므로, 이 결과만으로 비공개 출력 누출 시험을 완료했다고 주장하지 않는다. 관측기 종료 후 같은 셸에서 `AFTER_PASTE`, `SHELL_PID=16`을 확인했다. 시험용 클립보드는 원래 텍스트로 복원됐다.

## 실패 기록과 한계

1. 첫 편집 명령은 BusyBox `vi`에 Vim 전용 `-u` 옵션을 줘 거부됐다. 그 원시 오류를 보존하고 설치한 `vim`을 명시했다. 제품 오류나 통과 사례로 세지 않았다.
2. 최초 창 복원 버튼 클릭 후 실제 창은 최대화 상태였고 `RESTORED_SIZE`도 `52 274`였다. 이를 복원 성공으로 처리하지 않았다. 화면에서 Windows 시스템 메뉴의 이전 크기로 항목을 확인해 실행한 뒤에만 `17 102`로 복원됐다. 첫 클릭의 미적용을 제품 원인으로 확정할 근거는 없다.
3. 컴퓨터 제어의 캡처 geometry 부재·만료된 버튼 인덱스, 시스템 메뉴의 null 접근성 트리는 최신 화면을 다시 관측해 처리했다. 한 번의 서버 관측은 자동 승인 검토의 사용량 한도로 실행되지 않았고, 사용자의 한도 재설정 뒤 동일한 승인 경로로 실행됐다.
4. 작은 터미널 글자의 창 캡처에는 [이전에 진단한 획 샘플링 현상](rust-capture-diagnostics-report.md)이 보였다. 이번에는 새 픽셀 품질 판정을 내리지 않았다. 네이티브 주입 키를 물리 키보드·IME 시험으로 세거나 창 크기 전환을 OS DPI 전환으로 세지 않는다.

## 검증과 정리

`node artifacts/phase5-terminal-20261013/verify.mjs`의 증거 검사 **32개 통과**. 이는 위 시험의 근거 검사 수이며 32개 독립 제품 시나리오가 아니다. [검증 기록](../../artifacts/phase5-terminal-20261013/verification.json)에 실제 출력·서버 수신·권한 세대·파일 부재·프로세스 종료·후보 hash 검사를 남겼다.

앱·어댑터·supervisor exit 0, 강제 정리 없음, 모든 관측 WebView 자식 종료를 확인했다. 시험 컨테이너 ID·label·이미지를 확인한 뒤 컨테이너와 이미지 태그를 제거했고 포트 52490의 listener도 0이었다([정리 기록](../../artifacts/phase5-terminal-20261013/cleanup.json)).

다음은 실제 단일 Claude/Codex 하네스 및 sudo 흐름이다. 물리 IME·DPI100/150/200, 다른 OS 사용자 경계, 출시 부하·퍼징 및 초기화 flakiness는 [남은 Phase 5 인수](rust-phase-5-package-report.md#남은-인수)로 유지한다. 이번에 확인한 배포본 터미널 시나리오는 제품·관련 입력 경로 변경이나 새 실패 근거가 없는 한 반복하지 않는다.
