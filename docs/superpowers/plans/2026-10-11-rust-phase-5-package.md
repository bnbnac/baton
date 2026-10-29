# Rust Phase 5 Windows 시험 패키지 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. 기존 Native 실행 방식과 승인된 Windows 우선 배포 범위를 유지한다.

**Goal:** 개발 서버 없이 실행할 Windows x64 시험용 ZIP을 생성하고 그 안의 MCP 어댑터를 검증한다.
**Architecture:** 기존 Tauri 제품 빌드와 Rust 어댑터를 release로 빌드한다. 새 실행별 artifact 디렉터리에 실행 파일 두 개·안내·해시 manifest를 넣고 ZIP을 만든다. 검증은 ZIP을 다른 경로에 해제한 파일을 사용한다.
**Tech Stack:** 기존 Rust 1.88+, Tauri 2, Node, PowerShell 7. 제품 의존성 추가 없음.
**Spec:** `docs/superpowers/specs/2026-09-20-rust-transition-design.md`, `docs/superpowers/specs/2026-09-20-rust-verification-design.md` §5–6.

## Global Constraints

- Windows 우선. 첫 산출물은 설치/등록하지 않는 로컬 시험용 ZIP이며 공개 배포·서명·자동 업데이트는 포함하지 않는다.
- 진단/acceptance feature 제외, 제품 UI와 stdio 어댑터만 포함한다. 실제 하네스 설정과 C# 설치는 변경하지 않는다.
- 매 실행 새 디렉터리 사용, 기존 산출물 덮어쓰기 금지, command/exit/time/source/lock/binary hash 기록.
- 미해결 초기화 flakiness, 실제 GUI/IME/DPI·하네스·OpenSSH 비교·퍼징·soak 등은 별도 남아 있다. 빌드 성공과 제한된 smoke를 출시 승인으로 승격하지 않는다.
- 기본 zip을 선택한 이유: 설치 프로그램 제작/서명 이전에도 개발 도구 없는 실행 검증에 사용할 수 있다. WebView2 및 Windows 런타임 조건은 안내하고 최소 지원 환경은 아직 확정하지 않는다.

## Review Focus

- 옛 debug/다른 아키텍처 바이너리가 섞임 → Task 1 PE 아키텍처·subsystem 및 Task 2 명시적 release 입력.
- 패키지 변조/누락/의도하지 않은 파일 → Task 1 정확한 파일 집합·SHA256·schema 검증.
- 생성 경로 이탈/재실행 덮어쓰기 → Task 2 worktree artifacts 하위 새 디렉터리만 허용.
- 소스/lock이 빌드 중 바뀜 → Task 2 전후 source inventory 비교 후 실패.
- 개발 도구 PATH에 우연히 의존 → Task 3 해제된 절대 경로·비개발 작업 디렉터리·Windows-only PATH로 어댑터 실행. 이것이 깨끗한 VM GUI 인수를 대신하지 않음도 명시.

### Task 1: 패키지 검증 계약

**Files:** `rust/tests/phase5/package.mjs`, `rust/tests/phase5/package.test.mjs`.
**Interface:** `createManifest(directory, provenance)`, `verifyPackage(directory)`; CLI `create <directory> <provenance.json>` / `verify <directory>`. 파일은 `baton.exe`, `baton-adapter.exe`, `README.txt`, `manifest.json`만 허용한다. schemaVersion 1, status `candidate_unaccepted`, 플랫폼 `windows-x86_64`, SHA256·길이·PE machine/subsystem 포함.

- [x] 테스트 먼저 작성: 정상 패키지, 파일 변조·누락·추가, 잘못된 PE/ARM/subsystem, 변조된 manifest 상태/경로 거부. Node test로 RED 확인.
- [x] PE 구조 경계 검사와 파일/manifest 검증 구현. manifest의 파일 경로는 고정 allowlist로만 사용하고 symlink/reparse 산출물 거부.
- [x] Node 시험 GREEN, 관련 diff 확인.

### Task 2: 재현 가능한 release ZIP 생성

**Files:** `rust/scripts/build-windows-candidate.ps1`, `docs/rust-windows-candidate.md`.
**Interface:** PowerShell `-OutputDirectory` optional; 기본 `artifacts/rust-phase-5/<UTC>-<GUID>`. 결과 `package/`, `Baton-windows-x64.zip`, `provenance.json`, `summary.json`, 단계별 로그. 실패 시 status `failed`, 성공 시 `built_unaccepted`.

- [x] 기존 artifact 경로/PS7 bootstrap 규칙을 재사용. source snapshot은 `git ls-files rust` 및 새 phase5 스크립트/도구 경로의 파일 내용을 해시한다.
- [x] TypeScript/Vite 제품 assets 빌드 후 Cargo `build --release --target x86_64-pc-windows-msvc --offline --locked -p baton-app --features desktop,tauri/custom-protocol --bin baton`, 같은 target의 release adapter 빌드. 진단/acceptance feature와 환경 override가 섞이지 않도록 실행 환경을 제한한다. 최초 CLI 실행이 manifest를 자동 수정했으므로 직접 Cargo 빌드로 변경한다.
- [x] 성공한 이번 빌드의 release exe 두 개만 새 package 디렉터리에 복사. README·manifest 검증 후 ZIP 작성, ZIP hash 및 toolchain/source 기록.
- [x] 실제 builder 실행. 실패는 기록하고 원인에 맞게 수정하며 기존 성공 증거를 덮어쓰지 않는다.

### Task 3: 압축 해제본 stdio smoke와 인계

**Files:** `rust/tests/phase3/stdio.mjs` (시험 실행 경로 선택), `rust/tests/phase5/smoke.mjs`, `docs/testing/rust-phase-5-package-report.md`.
**Interface:** `node smoke.mjs <extracted-package> <report.json>`; 기존 Adapter 시험 helper에 선택적 executable/env/cwd를 추가한다. report는 실제 exe hash/경로와 관측 결과를 포함한다.

- [x] ZIP을 공백·한글 경로에 해제하고 Task 1 검증을 다시 적용한다.
- [x] 어댑터의 절대 경로 실행, 개발 도구 PATH 제거, 별도 빈 endpoint 경로 사용. initialize·5 tools·offline status·offline 입력 거부·EOF 종료·stdout/stderr 오염 없음 확인. fixture/해제본만 사용한다.
- [x] 독립 리뷰 한 번, 중요한 지적 수정 및 필요한 시험만 재실행.
- [x] 보고서에 실제 산출물/해시/명령/수행 범위와 미완료 인수 항목 기록. 로컬 커밋, push/출시 없음.

## 후속 Phase 5 범위

이 계획은 패키지 생성 하위 작업이다. 남은 작업은 실제 배포 UI/인증/IME/DPI100·150·200/vi·top 인수, 단일 실제 하네스 인수, 다른 OS 사용자 보안 경계, LIFE-03 OpenSSH 비교와 LIFE-04 연결 장애, 10,000시드×500이벤트·장벽100회, 4면×30분 fuzz, 32연결/16SSH/2서버 2시간 soak, 전체 프로세스 수명100회 및 미해결 초기화 실패 진단이다. 보류된 Desktop/CLI 동시 연결은 재개하지 않는다.
