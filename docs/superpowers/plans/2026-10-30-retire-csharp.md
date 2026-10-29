# C# MVP 보존과 Rust 중심 정리

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 사용자 실사용 확인을 마친 Rust를 현재 구현으로 안내하고 C# 전용 구현을 현재 트리에서 제거한다.

**Architecture:** 삭제 직전 상태를 annotated tag `csharp-mvp-final`로 보존한다. Rust 및 공통 OpenSSH fixture는 경로와 내용을 유지하고 과거 문서에는 역사적 범위를 표시한다.

**Tech Stack:** Git, Rust/Tauri, Node.js, PowerShell.

**Spec / 승인 범위:** 사용자가 승인한 순서는 실사용 확인 → C# 마지막 상태 태그 → C# 전용 소스·시험·빌드 설정 제거 → README Rust 중심 정리다. 대안인 두 구현 병행 유지는 안내 혼동과 관리 부담을 남기며, 별도 archive 디렉터리 복제는 Git 태그와 중복되므로 사용하지 않는다.

## 제약과 검토 초점

- `tests/linux-ssh/Dockerfile`은 Rust 시험이 참조하므로 유지한다.
- Rust 코드·Cargo 파일·미완성 fuzz·기존 ZIP·실행 중인 앱·사용자 설정은 변경하지 않는다.
- 삭제는 추적 중인 C# 전용 파일만 대상으로 한다. ignored 빌드 산출물은 청소하지 않는다.
- 과거 검증 기록을 현재 Rust 결과로 바꾸지 않는다. 정식 Phase 5 인수는 미완료다.
- 태그와 작업 브랜치만 일반 push하며 force push·main 병합은 하지 않는다.
- Rust Node 시험의 `ssh2`는 `rust/tests/package.json`과 lock으로 독립 관리되는지 확인한다.
- 현행 문서에서 C# 실행 명령을 따르지 않도록 구분하고 복구 방법을 남긴다.

## 실행

- [ ] 사용자 실사용 보고를 문서 커밋으로 보존하고 해당 HEAD에 `csharp-mvp-final` 태그를 만든다. 태그의 C# 소스·빌드 파일 존재를 확인한다.
- [ ] `src/`, `tests/Baton.Tests/`, `tests/Baton.LifecycleProbe/`, 루트 `scripts/`의 C# 전용 스크립트 4개, `tests/ssh-fixture.mjs`, 루트 npm manifest/lock, `build.cmd`, `Directory.Build.props`, `global.json`, `NuGet.Config`를 제거한다.
- [ ] README를 Rust 소개·알려진 한계·실행·개발·문서 링크 중심으로 바꾼다. 기존 C# 문서는 경로를 보존하고 상단에 역사적 범위와 태그 안내를 붙인다.
- [ ] Rust 트리와 공통 Dockerfile의 태그 대비 동일성, 삭제 목록, 문서 링크, diff를 확인한다. 깨끗한 커밋 archive에서 Cargo metadata, 프런트엔드 시험/빌드, Rust fixture 의존성 해석을 확인한다. 새 제품 동작이 없으므로 삭제 구현을 따라 쓰는 새 시험이나 장시간 시험은 추가하지 않는다.
- [ ] 별도 읽기 전용 리뷰에서 Rust 의존성 누락·현재/과거 문서 혼동·복구 태그를 확인한다. 결과를 기록하고 커밋·push·기존 PR 설명을 갱신한다.

## 실행 기록

- 사전 조사: Rust는 공통 OpenSSH Dockerfile을 참조한다. 루트 Node manifest는 C# 합성 SSH fixture 전용이며 Rust 시험은 자체 manifest/lock을 가진다.
- 기존 작업 트리에 미커밋 Cargo/fuzz 변경이 있으므로 검증은 커밋 archive에서 수행한다.
