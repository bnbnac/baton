# Windows 발견 파일 읽기·교체 경합 회귀 검증

2026-10-09 KST. 기준 커밋 `743fc36`. Phase 5에 앞서 Windows IPC 발견 파일의 재현 가능한 경합을 수정했다. **이전의 간헐적 신규 endpoint 초기화 실패는 원인 미확정으로 유지한다.** 이번 결함과 같은 원인이라는 증거가 없으며 출시 차단 조건을 해제하지 않는다.

## 재현과 수정

어댑터가 `endpoint.bin`을 읽는 동안 핸들이 삭제 공유를 허용하지 않았다. 이 핸들을 의도적으로 유지하면 앱의 발견 파일 교체가 실패하고 정상 종료 후 파일이 남았다. 시간 지연이나 확률적 경합에 기대지 않고 두 회귀시험으로 재현했다.

`FILE_SHARE_DELETE`를 추가하면 정상 종료 정리는 통과하지만, 기존 `MoveFileExW` 교체는 Windows 오류 5(접근 거부)로 계속 실패했다. 따라서 읽기 공유 설정과 교체 API를 함께 수정했다.

- 독자는 읽기·삭제 공유만 허용한다. 열린 파일에 대한 제자리 쓰기는 계속 거부한다.
- 앱은 보호된 임시 파일에 암호문을 기록하고 동기화한 다음 쓰기 핸들을 닫는다. 같은 파일을 검증된 DELETE 전용 핸들로 다시 열고 `SetFileInformationByHandle(FileRenameInfoEx)`의 `REPLACE_IF_EXISTS | POSIX_SEMANTICS`로 게시한다.
- 기존 독자는 기존 파일의 완전한 스냅샷을 읽고 새 독자는 새 파일을 읽는다. 게시용 핸들도 읽기 공유를 허용하므로 그 핸들이 닫히기 전 읽기를 방해하지 않는다.
- UTF-16 가변 길이 구조체는 ABI 정렬을 보장하는 저장소와 검사된 크기를 사용한다. SID·보호된 DACL·reparse 차단·DPAPI 검증은 유지한다.
- 교체가 거부되면 기존 파일을 보존하고 임시 파일만 정리한다. 삭제 후 이동이나 무조건 재시도로 성공을 가장하지 않는다.

API 근거: [Microsoft FILE_RENAME_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info), [FILE_RENAME_INFORMATION의 POSIX 교체 의미](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information). Windows API feature만 추가했고 의존성 버전과 lockfile은 바꾸지 않았다.

## 검증

로컬 증거는 [summary](../../artifacts/ipc-discovery-race/summary.json) 및 같은 폴더의 로그에 보관한다. artifact는 Git에 포함하지 않는다.

| 항목 | 결과 |
|---|---|
| 수정 전 두 회귀시험 | 교체·종료 정리 모두 실패 (`red.log`) |
| 읽기 공유만 수정 | 종료 정리 통과, 교체 실패 (`green.log`; 파일명과 달리 전체 통과 아님) |
| 교체 API 수정 후 | 두 회귀시험 통과 (`replacement.log`) |
| Windows endpoint 단위 시험 | 9 pass, 0 fail, 0 ignored (`unit.log`) |
| Rust core/app/IPC/adapter all-targets | 163 pass, 0 fail, 0 ignored (`rust-full.log`) |
| 전체 fmt / desktop 포함 clippy `-D warnings` | exit 0 (`fmt.log`, `clippy.log`) |

새 시험 네 개는 다음을 검증한다.

1. 읽기 핸들을 연 채 파일 교체: 기존 핸들의 비밀은 이전 값, 새 읽기의 비밀은 새 값이다.
2. 읽기 핸들을 연 채 정상 종료: 발견 파일이 정리되며, 제자리 쓰기는 거부된다.
3. 한글·이모지 경로에서 100회 종료·재게시: 이전 읽기 핸들이 유지돼도 새 게시와 복호화가 성공한다. 끝에는 `endpoint.bin`과 임시 파일이 없고 재사용하는 `app.lock`만 남는다.
4. 삭제 공유를 거부하는 외부 핸들로 교체 실패 유도: 기존 발견 정보가 유지되고 임시 파일이 제거된다.

```text
cargo +stable test --offline --locked --manifest-path rust/Cargo.toml -p baton-ipc --lib
cargo +stable test --offline --locked --manifest-path rust/Cargo.toml -p baton-core -p baton-ipc -p baton-adapter -p baton-app --all-targets
cargo +stable fmt --all --manifest-path rust/Cargo.toml -- --check
cargo +stable clippy --offline --locked --manifest-path rust/Cargo.toml -p baton-core -p baton-ipc -p baton-adapter -p baton-app --all-targets --features baton-app/desktop -- -D warnings
```

## 범위와 남은 항목

검증 환경은 현재 Windows x64의 로컬 파일시스템이다. 구형 Windows 및 다른 파일시스템에서 새 교체 API가 지원되지 않으면 게시를 거부한다. 구형 환경 지원을 입증하거나 지원 최소 버전을 확정한 결과가 아니며 배포 대상 검증이 필요하다.

100회 시험은 발견 파일·lease 수명 검증이다. 앱 전체 프로세스 100회 종료, 원격 SSH 프로세스 정리, 부하·장시간 soak를 통과했다는 뜻이 아니다. 실제 하네스, GUI/IME/DPI와 패키지 인수는 실행하지 않았다. 이전 GUI 실행 파일을 이번 수정 검증본으로 간주하지 않는다. Rust 시험은 이번 소스로 다시 컴파일했고 기존 인증·서버·실제 pipe 및 어댑터 수명 시험을 포함한다.

Phase 4 보고서의 과거 초기화 실패, 실제 하네스 인수 pending과 Phase 5 출시 검증은 별도 미완료 상태로 유지한다.

독립 리뷰는 이번 코드 diff·Windows 바인딩·공식 API 문서를 확인했고 수정할 결함을 보고하지 않았다. 작성자가 실행한 시험을 중복 실행하지는 않았다. 새 이름 게시 직후 rename 핸들이 닫히기 전의 짧은 구간은 권한·공유 모드 호환성을 코드로 검토했으며 그 구간에 독자를 강제로 멈춰 세운 직접 시험은 없다. 다른 OS/파일시스템, 과거 초기화 실패와 출시 인수는 이 리뷰로 보증하지 않는다. 보고서는 리뷰 이후 작성자가 검토했다.
