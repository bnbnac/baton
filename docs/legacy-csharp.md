# C# MVP 보존과 복구

2026-10-30. Rust 개인 사용 점검 후 C# 전용 소스·시험·빌드 설정을 현재 작업 트리에서 제거했다. 현재 구현과 실행 안내는 [Rust 개인 사용 안내](rust-personal-use.md)를 따른다.

## 보존 지점

- Annotated tag: [`csharp-mvp-final`](https://github.com/bnbnac/baton/tree/csharp-mvp-final)
- Commit: `92bbd490523edfaa79e3e0f7987a88bd3aba0f79`
- 이 태그에는 삭제 전 C# 코드와 당시 Rust 코드가 함께 있다. C#의 마지막 상태를 식별하며 정식 출시·보안 인수 완료를 뜻하지 않는다.

내용만 조회하려면 `git show csharp-mvp-final:README.md`를 사용한다. 실행·개발이 필요하면 현재 Rust 작업을 되돌리지 않고 별도 폴더에 checkout한다. 아래 대상 폴더는 존재하지 않아야 한다.

```powershell
git fetch origin tag csharp-mvp-final
git worktree add --detach ../baton-csharp-mvp csharp-mvp-final
```

그 checkout의 README와 `build.cmd`가 C# 실행·빌드 기준이다. 기존 C# ZIP·로컬 산출물은 이번 정리로 삭제하지 않았다. 태그는 소스 보존이며 바이너리 배포가 아니다.

## 현재 트리의 범위

`src/Baton.*`, `tests/Baton.*`, 루트의 C# 전용 스크립트 4개, 합성 SSH fixture 및 그 npm manifest/lock, .NET 빌드 설정을 제거했다. Rust 시험이 사용하는 `tests/linux-ssh/Dockerfile`은 경로와 내용을 유지한다. Rust Node 통합 시험은 `rust/tests/package.json`과 자체 lock을 사용한다.

기존 설계·하네스·검증 문서는 과거 링크와 근거 보존을 위해 경로를 유지하고 C# 기록임을 표시했다. 그 안의 삭제된 소스·스크립트 경로는 위 태그에서 조회한다. Rust 전환 계획의 “C#을 유지한다”는 내용은 병행 전환 당시 범위이며 이번 승인된 정리로 현재 트리에서는 종료됐다. 과거 시험 결과·실패·미검증 항목은 삭제하거나 Rust 전체 통과로 바꾸지 않는다.
