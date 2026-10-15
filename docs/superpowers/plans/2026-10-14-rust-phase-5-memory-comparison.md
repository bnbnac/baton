# Phase 5 메모리 비교 진단 실행 계획

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in the existing worktree. Steps use checkbox syntax for tracking.

**Goal:** 출력·명령 부하에 UI 전환을 추가했을 때 장기 메모리 보유량이 달라지는지 비교해, 실패한 2시간 soak의 다음 조사 대상을 좁힌다.

**Architecture:** 기존 `soak.mjs`의 fixture·UI·MCP·정리 패턴을 별도 진단 실행기에 사용한다. 새 프로세스로 시작하는 A/B 실행을 순차 수행하며 두 실행의 차이는 분당 UI 전환 묶음뿐이다. 원래 인수 실행기와 제품 바이너리는 변경하지 않는다.

**Tech Stack:** 기존 Windows 제품 바이너리, Node/Playwright CDP, PowerShell Job 감독기, localhost Docker OpenSSH.

**Spec:** `docs/superpowers/specs/2026-09-20-rust-verification-design.md` §4 및 `docs/testing/rust-phase-5-memory-investigation.md`.

## 범위와 비교 조건

2026-10-14 사용자 요청은 다음 작업의 준비다. 이 문서는 설계·실행 전 확인을 완료한 상태이며, 아래 실행기 구현 및 장시간 실행은 아직 수행하지 않았다. 기존 Native 방식으로 이어간다.

| 조건 | A: `baseline` | B: `transitions` |
|---|---|---|
| 새 앱·WebView 데이터·어댑터·fixture | 각각 독립 | 각각 독립 |
| MCP / SSH / 서버 | 32 / 16 / 2 | 동일 |
| 출력 | 셸별 기존 1KiB/s 이상 + burst | 동일 |
| 분당 audit 명령·중복 request_id 검증 | 수행 | 동일 |
| 분당 탭 선택·resize·회수/재전달 | 없음 | 기존 `transition(round)` 순환 수행 |
| CDP | 준비부터 끝까지 연결 유지 | 동일 |
| 시간 | 20분 준비 + 40분 관측 | 동일 |
| 강제 GC | 60분 관측 종료 후 1회 | 동일 |

두 실행은 동시 실행하지 않는다. 총 부하 시간 120분에 준비·정리가 더해진다. A를 정상 종료·정리하고 증거를 검토한 뒤 B를 실행한다. A가 실패하면 B를 자동 실행하지 않는다. 순차 실행의 시간대·시스템 부하 차이는 기록에 남긴다.

처음부터 해당 조건을 적용한다. 준비 시간은 16개 출력이 모두 시작된 뒤부터 센다. 20~40분과 40~60분의 자연 GC 상태 메모리를 비교하고, 60분 이후 GC 전후 값은 별도 진단 표에 둔다. 1시간 관측에서 문제가 재현되지 않아도 기존 2시간 실패를 뒤집지 않는다.

UI 전환 묶음에는 탭·geometry·소유권뿐 아니라 원격 `stty size` 명령과 공개 stream 교체가 포함된다. B만 증가하더라도 특정 UI 동작이 원인이라고 단정하지 않고 다음 실험에서 묶음을 분리한다. audit를 양쪽에 넣는 이유는 에이전트 요청 이력 누적을 공통 조건으로 만들기 위해서다.

## 공통 제약

- 제품 수정·Cargo 빌드·fuzz 파일 수정/실행/커밋·사용자 서버·사용자 하네스 설정 변경 없음.
- 기존 `soak.mjs`, 원래 실패 증거, 20% 기준을 유지한다. GC를 인수 시험 통과 수단으로 쓰지 않는다.
- UI `f2fe998b0f224903d26234b0d033b3e7b7faf8198da80aede9f06504e7fa777b`, adapter `09823dd5d51cd3b33f286540fe43a03570b3eee81497607a1b5b67336fcb754c`를 사용한다. 경로는 기존 진단 summary의 `binaries`와 같다.
- 출력 디렉터리는 새로 생성하고 덮어쓰지 않는다. `stop` 파일·SIGINT·실패는 `failed`로 보존하며 자동 재시도하지 않는다.
- 모든 프로세스는 PID+시작 시각, 컨테이너는 owner label+이름+ID를 확인한다. 기존 사용자 자원은 정리 대상에서 제외한다.
- 긴 실행은 감독기와 독립 프로세스로 실행하고 `launch.json`, summary, 로그를 남긴다. 장시간 후속 점검은 시작 시 기존 자동화와 중복되지 않게 설정하며 변화 없는 상태는 알리지 않는다.

## 측정과 판단

- OS 메모리는 30초마다 앱·각 WebView 역할·어댑터별 private/working set 및 합계를 기록한다. 각 표본에 실제 monotonic 경과 시간과 PID·시작 시각을 남긴다.
- 역할은 최초 및 새 PID 등장 시 확인한다. renderer 재시작·누락·PID 재사용이면 비교 유효성 실패로 기록한다. 알 수 없는 역할을 renderer로 추정하지 않는다.
- JS heap·backing storage·embedder heap·DOM nodes/listeners·Tauri callback 수·terminal 수를 5분마다 **GC 없이** 수집한다. 계측 시간과 호출 실패도 남긴다. 양쪽 호출 순서·빈도는 동일하다.
- 60분까지 로그 지속·출력률·공개 구간 정합성·audit·32연결 유지·16세션 생존을 검사한다. B는 원격 geometry와 epoch/stream 교체도 검사한다. 과부하 단계는 이번 진단에서 제외한다.
- 20~40분, 40~60분은 반개구간으로 집계한다. 30초 예정 표본의 실제 시각을 사용하며 누락을 보간하거나 늦은 표본을 몰아서 채우지 않는다. 각 구간 최소 39개, 최대 간격 45초를 비교 유효성 조건으로 둔다. 미달이면 결과는 보존하되 비교 결론을 내리지 않는다.
- 60분 종료 직전 GC 전 측정 → GC 1회 → GC 후 측정 → 정상 종료 순서로 기록한다. 원시 표본과 GC 표본은 별도 파일/배열에 저장한다.
- 각 실행의 구간 중앙값·변화량·비율을 앱/renderer/기타 WebView/어댑터/합계별로 보고한다. A/B의 GC 후 retained JS·DOM·콜백도 병기한다. 한 쌍으로 인과관계나 통계적 유의성을 주장하지 않는다.
- B에서만 증가하면 전환 묶음 분리, 둘 다 증가하면 공통 출력·명령·계측/런타임 보유량 조사, 둘 다 불명확하면 원래 2시간 조건에 진단 관측을 추가하는 방안을 검토한다. 결과에 앞서 반복 실행을 예약하지 않는다.

## Task 1: 비교 분석 계약

**Files:** Create `rust/tests/phase5/memory-comparison-analysis.mjs` and `rust/tests/phase5/memory-comparison-analysis.test.mjs`.

**Interface:** `analyzeComparison(a, b)` returns `{valid, reasons, arms}`. 각 arm은 `{condition, elapsedSeconds, samples, diagnostics, sources, binaries, checks, cleanup}`를 제공한다. `samples`는 `{elapsed, processes:[{pid, startedTicks, role, privateBytes, workingSetBytes}]}`이고 `diagnostics`는 `{elapsed, phase:'natural'|'pre_gc'|'post_gc', heap, dom, state}`다. `checks`에 출력률/audit/health/transition 검증 결과, `cleanup`에 정상 종료/소유 자원 잔존 확인을 담는다.

- [x] 합성 자료로 1200/2400/3600초 경계, 누락 구간, 45초 초과 간격, PID 재사용/renderer 교체, GC 표본 혼입, 조건/해시 불일치, 실패한 부하·정리의 비교 거부 시험을 작성한다. GC 전후 값은 자연 구간 중앙값에 포함되지 않아야 한다.
- [x] `node --test rust/tests/phase5/memory-comparison-analysis.test.mjs`의 기대 실패를 확인한다.
- [x] 메모리 집계와 비교 유효성 분석을 구현한다. 메모리 증가 자체는 진단 결과이지 실행 실패나 제품 통과 판정으로 변환하지 않는다.
- [x] 동일 시험의 통과와 `node --check rust/tests/phase5/memory-comparison-analysis.mjs`를 확인한다.

## Task 2: 진단 실행기와 짧은 사전 시험

**Files:** Create `rust/tests/phase5/memory-comparison.mjs`, `rust/scripts/sample-test-process-roles.ps1`. Reuse existing helpers without changing acceptance runner behavior.

**CLI:** `node rust/tests/phase5/memory-comparison.mjs <fresh-directory> baseline|transitions smoke|diagnostic`. `diagnostic`은 3600초·분당 동작, `smoke`는 60초·3초마다 동작이다. smoke는 준비/안정 구간 비교를 충족하지 못한 것으로 명시한다.

- [x] 기존 soak의 준비·출력 파서·audit·transition·종료/정리 패턴을 적용한 별도 실행기를 작성한다. 8분 probe의 문자열 치환 생성 방식은 사용하지 않는다. 새 역할 sampler와 분석기까지 소스 해시 목록에 포함한다.
- [x] 역할 sampler는 감독기 receipt와 Adapter PID+시작 시각을 입력받아 소유 관계·시작 시각을 검증한 역할 목록만 반환한다. 명령행 전체·비밀값은 저장하지 않는다.
- [x] 측정/진단 스케줄과 정상 종료를 구현하고, summary에 상태·현재 condition·실제 시간·checks·해시를 기록한다. 메모리 크기와 무관하게 정상 종료 경로에 도달하되, 계측/부하 오류를 숨기지 않는다.
- [x] fixture 이미지 `baton-memory-comparison-20261014`를 기존 `tests/linux-ssh/Dockerfile`로 생성한다. 두 smoke를 순차 1회씩 실행해 A의 전환 0회/B의 최소 17회·탭 재방문, audit 대조, 16 terminal, 역할 식별, GC 전후 분리와 정상 정리를 확인한다. 실패 증거는 보존하고 원인 수정 없이 반복하지 않는다.
- [x] 소스·바이너리 해시와 diff를 검토하고 관련 파일만 로컬 커밋해 장시간 실행 입력을 고정한다.

## Task 3: 비교 실행 및 보고

2026-10-15 20:45:27 KST에 `4a1cb3a` 고정 소스로 A 본 부하를 시작했다. `run-a-launch.json` PID 42532, `run-a/summary.json`에서 baseline/running·32연결·16세션을 확인했다. 후속 점검 `baton-2`를 이 비교 작업으로 갱신했다. A 유효성·정리 확인 후에만 B를 시작하며 자동 재실행하지 않는다. 아래 체크박스는 실행 시작이 아닌 결과 검증까지 마쳐야 완료한다.

**Files:** Artifacts under `artifacts/phase5-memory-comparison-20261014/`; update `docs/testing/rust-phase-5-memory-investigation.md`.

- [x] 고정한 실행기로 A `baseline diagnostic`을 새 디렉터리에 시작하고 launch 기록을 남긴다. 실제 3600초·관측 유효성·정상 종료·소유 정리를 확인한다. 2026-10-15: 3600.2853031초, analyzeArm valid, JSONL·해시·정리 재검증 완료.
- [ ] A 유효성 확인 후 동일 입력의 B `transitions diagnostic`을 새 디렉터리에서 실행한다. 같은 검증과 source/binary hash 일치를 확인한다.
- [ ] `analyzeComparison` 결과를 원시 JSONL과 대조한다. 두 실행의 조건별 중앙값·GC 후 보유량·차이·시간대/환경 한계를 보고서에 기록한다. 기존 2시간 실패는 유지한다.
- [ ] 소유 자원 정리를 검증하고, 이번 이미지 태그는 기록된 ID와 일치할 때만 제거한다. 관련 문서만 로컬 커밋하고 완료한 후속 점검은 PAUSED로 전환한다.

2026-10-15 21:47:17 KST: A 검증 후 B를 한 번 시작했다. `run-b-launch.json` PID 14360. B 완료·최종 비교는 대기 중이며 소스 수정이나 자동 재실행 없이 후속 점검을 유지한다.

## 검토 초점

1. GC 표본이 자연 메모리 중앙값에 섞여 증가를 숨기는 경우: Task 1 분리 시험.
2. PID 재사용/renderer 교체로 다른 프로세스를 비교하는 경우: Task 1 거부 시험과 Task 2 실제 역할 확인.
3. B의 공개 stream 교체를 출력 손실로 오판하거나 준비 출력을 출력률에 합산하는 경우: 기존 oracle 유지 및 Task 2 smoke.
4. 샘플링 지연으로 짧은 구간을 충분한 관측으로 오인하는 경우: Task 1 시간/표본 유효성 시험.
5. 원래 인수 실행기 변경이나 서로 다른 바이너리로 조건 효과를 주장하는 경우: Task 1 해시 불일치 거부 및 Task 3 전후 해시 대조.

## 준비 확인 — 2026-10-14

- [x] 기존 실패/진단 결과와 실행기·검증 설계 검토, A/B 변수 및 GC 시점 고정.
- [x] 기존 UI/adapter SHA256 재대조 일치. Node·PowerShell 7·Playwright·Dockerfile 경로 확인.
- [x] Docker 서버 29.2.0 응답, `baton.soak` label의 잔존 컨테이너 없음 확인. C 드라이브 여유 약 956GB.
- [x] 계획 자체 검토: 과거 8분 진단의 초기 할당/순차 CDP 비교 한계를 반영했고, 2시간 인수 판정과 분리했다.
- [x] Task 1~2 구현·사전 시험 완료(2026-10-15). 분석기 35개·oracle 10개·역할 수집 1개 통과. A 60.008초/B 62.236초 정상 종료 및 정리. 본 실행은 Task 3에서 별도 추적한다.
