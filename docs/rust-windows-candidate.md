# Baton Windows x64 시험 패키지

이 ZIP은 출시 인수가 끝나지 않은 서명 없는 시험용 빌드다. `manifest.json`의 상태는 `candidate_unaccepted`다. 기존 C# Baton을 대체하거나 자동으로 MCP 설정을 변경하지 않는다.

## 실행

1. ZIP 전체를 쓰기 가능한 새 폴더에 해제한다. ZIP 내부에서 직접 실행하지 않는다.
2. UI는 `baton.exe`로 시작한다. Windows x64, Microsoft Edge WebView2 Runtime, Microsoft Visual C++ x64 런타임이 필요하다. 이 release UI의 실제 DLL 의존성에는 `VCRUNTIME140.dll`과 `VCRUNTIME140_1.dll`이 포함된다. ZIP은 런타임 설치 파일을 포함하지 않으며 자동 설치하지 않는다. 실행 대상 PC에 Node, .NET SDK, Rust/Cargo 개발 도구를 설치할 필요는 없다. 다만 개발 도구가 없는 깨끗한 Windows 환경의 전체 GUI 인수는 아직 완료되지 않았다.
3. MCP 하네스에는 압축 해제한 `baton-adapter.exe`의 절대 경로를 stdio 명령으로 등록한다. 인자는 없다. 실제 설정 변경 전 기존 설정을 별도 보관한다. 하네스 설치/등록은 이 패키지가 수행하지 않는다.
4. 앱과 어댑터는 같은 Windows 사용자로 실행한다. 앱이 없으면 어댑터는 초기화·목록·offline 상태를 제공한다. 앱 실행 후 연결되고, UI에서 사용자가 세션을 전달해야 명령을 실행할 수 있다.
5. 종료는 창 닫기를 사용한다. 앱 종료 후 이전 세션을 자동 복원하거나 명령을 재전송하지 않는다.

동일 사용자의 Rust Baton 앱은 한 인스턴스만 사용한다. 실제 SSH 접속·비밀번호·호스트키 확인은 사용자가 UI에서 진행한다. Windows 최소 지원 버전과 다른 OS 지원은 아직 확정/검증 완료되지 않았다. WebView2가 없으면 이 ZIP이 자동 설치해 주지 않는다.

## 파일과 검증 상태

- `baton.exe`: 제품 UI, release 빌드.
- `baton-adapter.exe`: stdio MCP 어댑터, release 빌드.
- `README.txt`: 이 안내.
- `manifest.json`: 파일 크기·SHA256·Windows 아키텍처/서브시스템과 빌드 provenance 참조. 해시는 변조/복사 오류 검사이며 발행자 서명을 대신하지 않는다.

미해결 IPC 초기화 오류, 실제 하네스·sudo·인증·IME/DPI·전체 화면 앱·원격 프로세스 종료 비교·부하·퍼징 검증이 남아 있다. 패키지 생성/stdio smoke 성공만으로 출시 준비가 끝났다고 판단하지 않는다.

## 저장소에서 생성

PowerShell에서 저장소 작업 폴더로 이동해 `rust/scripts/build-windows-candidate.ps1`을 실행한다. Windows PowerShell 5에서는 스크립트가 설치된 PowerShell 7 또는 Codex에 포함된 PowerShell 7의 절대 경로를 찾아 사용한다. 빌드에는 캐시된 npm 의존성, Node, Rust stable, Visual Studio C++ 빌드 도구가 필요하다. Rust 의존성은 `--offline --locked`로 빌드하며 설치/업데이트를 자동 수행하지 않는다.

실행별 `artifacts/rust-phase-5/<시각-ID>`에 ZIP, manifest, source inventory, 명령별 로그와 `summary.json`을 남긴다. 기존 출력 디렉터리는 덮어쓰지 않는다. 이 ZIP의 생성 시점에 대응하는 summary와 함께 검증 결과를 보관한다.
