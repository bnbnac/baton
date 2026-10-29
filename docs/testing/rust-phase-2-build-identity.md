# Phase 2 빌드 해시 조사

**후속 결정 (2026-10-08):** 사용자의 요청에 따라 제품·입력 harness·lock 무변경을 확인하고 기존 두 빌드의 관측을 인정해 Phase 2를 종료했다. 아래 재시험 8개 요구는 철회한다. DPI는 Windows 배포 전 보류를 유지한다. 과거 바이너리 동등성이 증명됐다는 의미는 아니며, 원본 strict gate의 `manual_pending`도 변경하지 않는다. 현재 유효한 판정과 재검증 근거는 [인수 기록의 최종 결정](rust-phase-2-report.md#최종-결정--2026-10-08-반복-시험-없이-단계-종료)을 따른다. 아래는 결정 이전 조사 이력이다.

2026-10-08 조사 결론: **동일 소스 재빌드만으로 exe SHA-256이 바뀌는 경로를 제품과 시험 앱에서 재현했다.** 이번 재현의 차이는 PE 빌드 시각과 CodeView 디버그 식별자뿐이었다. 이전 물리 입력 시험 당시 바이너리는 찾지 못했으므로, 과거 빌드와의 동등성이 입증됐다고 확대하지 않는다. 전체 인수 상태는 `manual_pending`이다.

## 보존과 재현

조사 전 현재 제품·시험 exe, 대응 PDB, 제품·시험 프런트엔드 결과물을 `artifacts/rust-phase-2/build-identity-20261008/frozen/`에 복사했다. 이 exe는 최신 자동 인수와 완료된 연속 vi/정상 종료 시험의 해시와 일치한다.

1. 제품을 `cargo +stable build --manifest-path rust/Cargo.toml --locked -p baton-app --features desktop --bin baton -v`로 다시 빌드했다. Cargo는 `Fresh baton-app`을 보고했고 exe 해시도 유지됐다.
2. 동일 소스에서 `npm.cmd run build --prefix rust/app`을 실행한 뒤 같은 Cargo 명령을 실행했다. Cargo는 `dist/assets/index-BxbyKUSB.js`의 수정 시각 때문에 `Dirty baton-app`을 보고하고 바이너리를 재컴파일했다.
3. 시험 프런트엔드도 `vite.acceptance.config.ts`로 다시 생성하고 `--features desktop,acceptance --bin baton-ui-acceptance`로 빌드했다. 역시 자산 파일 수정 시각에 의해 재컴파일됐다.
4. 새 결과물은 `rebuilt/`에 별도로 보존하고, 현재 사용 위치와 `target/debug/deps`의 exe를 조사 전 바이너리로 복원했다. 대응 PDB도 복원했다. `restored.json`의 네 exe 해시 일치를 확인했다. 소스와 인수 gate는 변경하지 않았다.

| 대상 | 조사 전 SHA-256 | 재빌드 SHA-256 | 다른 바이트 |
|---|---|---|---:|
| 제품 | `C6DC4455DDF5A986FD6AD56E7A4499C0571F070E43BC7152F76F670AE7311010` | `F6486B333BA0E955556D1F2A90010FA339D69FA2CD1A36207A797086B05CD634` | 28 |
| 시험 앱 | `E602791BFDEEB3B87D14ADADAF6308D4AB431A9C67F29361E3CFEBBB3800799A` | `853BDD742D2207CB9A86C4A71713E2F60413FCC87ACFEAA32CFE2AFB36E97E24` | 27 |

두 쌍 모두 길이가 같고 `.text`, `.data`, `.pdata`, `.rsrc`, `.reloc`이 바이트 단위로 일치했다. `.rdata`의 차이도 debug directory timestamp와 CodeView GUID에 한정됐다. COFF timestamp와 이 디버그 필드를 제외하면 전체 파일이 일치했다. checksum과 CodeView age는 비교 도구의 제외 목록에는 있지만 실제 값은 바뀌지 않았다. debug directory의 timestamp와 CodeView가 디버그 정보임은 [Microsoft PE 규격](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format#debug-directory-image-only)을 기준으로 해석했다.

제품/시험의 HTML·CSS·JS 각각 3개, 총 6개 파일도 재생성 전후 SHA-256이 모두 일치했다. 즉 이번 재현에서 프런트엔드 내용 변경이 바이너리 차이를 만든 것은 아니다. 로컬 Tauri codegen은 원본 자산을 `include_bytes!`로 컴파일 의존성에 추가하며, Cargo 로그가 재컴파일 원인을 직접 기록했다.

분석은 직접 만든 두 개의 unsigned x64 Debug exe에 한정한다. 일반적인 임의 PE의 동등성 판정기나 실행 코드 변경을 무시하는 인수 정책을 추가한 것이 아니다. 비교 도구의 민감도도 확인했다. 코드 `.text` 또는 리소스 `.rsrc`의 바이트 하나를 메모리에서 바꾸면 메타데이터를 제외한 해시가 달라졌다.

## 과거 기록에 적용할 수 있는 범위

과거 자동 인수 `20261004T215359-4233aa2a57584dcc96c8aba1cf294f58`와 최신 자동 인수 `20261006T163917-beaaac844bf84f488f2a54019a52f04d`의 소스 차이는 수집기 전용 5개 파일뿐이다. 당시 빌드 로그에 나온 프런트엔드 산출물 이름과 크기도 같다. Rust/Node/OS는 동일했고, WebView2는 `154.0.4258.53`에서 `154.0.4258.62`로 달라졌다.

저장소와 worktree의 제품·시험 exe를 검색했으나 과거 `A60F9C…`/`F8DBE4…` 해시에 해당하는 사본은 없었다. 최초 검색에서 권한이 없던 두 과거 시험 폴더도 별도로 읽기 전용 확인했다. 과거에는 파일 전체 해시만 저장했고 exe/PDB나 정규화된 내부 해시는 보존하지 않았다. **그 해시만으로 당시 차이가 이번과 똑같은 메타데이터 차이였다고 역산할 수 없다.** 같은 원인일 가능성은 이번 실험으로 뒷받침되지만, 직접 동등성 증명은 아니다.

따라서 기존 입력·IME 관측은 해당 빌드의 회귀 근거로 보존한다. 최신 빌드에 대한 동일 바이너리 인수로 자동 승격하지 않고 기존 해시 검사도 유지한다. 바이너리 복구 가능성을 확인한 뒤에 정한 필요한 재시험 범위는 다음과 같다.

| 구분 | 항목 | 이유 |
|---|---|---|
| 재사용, 반복 불필요 | 최신 자동 시험, 연속 vi, 정상 종료 | 현재 보존한 exe와 해시 일치 |
| OS 자동화로 재시험 가능 | 키, 붙여넣기, 마우스, 숨김 복귀, 최소화 복귀, top | 관측은 있으나 이전 exe의 기록만 있음. 사람의 직접 조작으로 표시하지 않음 |
| 실제 한글 IME 경로 재시험 필요 | IME 확정·차단, 조합 중 회수·새 조합 복구 | 이전 바이너리의 유효한 관측은 유지하되 현재 빌드 gate에는 별도 기록 필요. JS 이벤트로 대체하지 않음 |
| 합의한 보류 유지 | 실제 DPI 100/150/200 | Windows 배포 전 검사. 이번 조사로 통과 처리하지 않음 |

## 이후 시험 운영

현재 빌드 쌍을 기준으로 남은 수동 인수를 수집한다. 수동 기록을 모으는 동안 전체 빌드 명령을 반복하지 않는다. 수집기만 바뀐 경우에는 명시한 도구 변경을 검증하고 수집기 테스트 및 원본 증거 재검증을 실행한다. 제품·입력 harness 변경이 생기면 기존 바이너리를 덮어쓰지 말고 새 빌드와 새 증거 집합을 만든다.

이번 조사에서 바이너리 재현성을 위해 링커 옵션이나 Tauri 소스를 바꾸지 않았다. 우선 고정된 바이너리와 원본 로그를 보존하면 재빌드 때문에 이미 수행한 인수를 다시 잃는 일을 피할 수 있다. 정규화 해시는 분석용으로만 남기고 인수 gate의 전체 SHA-256을 대체하지 않는다.

재현 명령과 읽기 전용 비교 코드는 `artifacts/rust-phase-2/build-identity-20261008/`의 `compare-pe.mjs`, `audit.mjs`, `*.log`에 있고, 실제 비교 결과는 `rebuilt-product-comparison.json`, `rebuilt-acceptance-comparison.json`, `audit.json`이다. `audit.mjs`는 보존한 바이너리/자산 해시, 허용 필드 밖의 차이 부재, 코드·리소스 변이 검출을 다시 확인한다. 이 폴더는 로컬 시험 artifact이며 Git 커밋에 바이너리를 넣지 않는다.
