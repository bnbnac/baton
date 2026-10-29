# Phase 5 네이티브 UI 조작 가능성 조사

2026-10-16. 제품 기준 커밋 `5f1c725`. 이 조사는 자동화 연결을 분리한 2시간 시험의 준비 작업이며, 장시간 인수 시험의 통과 증거가 아니다. 제품 코드와 바이너리는 변경하지 않았다.

## 실제 앱에서 확인한 범위

증거 루트: `artifacts/phase5-native-ui-20261016/`. `run1/summary.json`, UI 관측 텍스트, MCP 상태 및 서버 `stty size` 응답을 보존했다. 준비에만 Playwright를 사용하고 분리한 뒤 Windows 네이티브 조작을 실시했다. 32연결·16세션·2서버를 준비했으며 실제 조사 부하는 176.9134365초다. 설정의 requestedSeconds=1800은 상한으로, 실제 실행 시간이 아니다.

| 조작 | 결과와 한계 |
|---|---|
| 세션 탭 선택 | 관측한 화면 좌표로 `soak-00` 선택 확인. 접근성 요소 번호로 두 번 클릭했을 때는 stale element 오류 발생 |
| 사용자 회수 | 동일 세션이 `user_owned`, epoch 2, 공개 stream 없음으로 전환됨 |
| 에이전트 전달 | 기존에 선택돼 있던 adapter 15로 전달됨. epoch 3과 새 stream 및 서버 명령으로 확인 |
| 원하는 다른 연결 선택 | 확인하지 못함. 클릭 후 선택 목록이 열린 상태를 유지하지 못했으나, 이 관측만으로 원인을 확정하지 않음 |
| 창 최대화·복귀 | Windows 창 버튼 조작 후 서버 크기가 102×17 → 274×52 → 102×17로 변경됨 |

전달 직후의 `03-handoff.json.response`는 이전 상태를 담았다. 실행기가 UI 조작 전에 상태를 읽을 수 있으므로, 후속 `04-after-handoff.json.response`와 서버 응답을 최종 근거로 사용했다. 도구 클릭 성공이나 즉시 화면 캡처만으로 전환 완료를 판정하지 않는다.

`verify.mjs`의 `evidenceValid=true`는 위 관측과 소스 13개·바이너리 2개의 해시 일치를 뜻한다. **unattendedReady=false**다. 임의 연결 선택과 안정적인 접근성 요소 활성화가 검증되지 않아 2시간 무인 실행을 시작하지 않았다.

## 포커스 손실 재현

접근성 요소가 빠르게 교체되는 현상을 코드에서 추적했다.

1. `rust/crates/baton-core/src/runtime/driver.rs`의 incoming 처리에서 `receive_scoped` 뒤 `link.publish`를 호출한다.
2. `runtime.rs`의 `Link::publish`는 `watch::Sender::send_replace`로 snapshot을 알린다. 이 경로에는 이전 snapshot과의 동일성 검사가 없다. 별도 `with_session` 경로에는 비교가 있으므로 모든 runtime 경로가 무조건 publish한다고 해석하지 않는다.
3. `rust/app/src-tauri/src/app.rs`의 `watch_session`은 알림을 받으면 전체 `UiEvent::Sessions`를 발행한다.
4. `rust/app/src/main.ts`는 매 sessions 이벤트마다 `render()`를 호출하고 세션 버튼을 `replaceChildren`으로 다시 만든다.
5. `rust/app/src/connections/view.ts`의 `OwnershipView.render`도 기존 제어 패널을 비우고 연결 select와 버튼을 다시 만든다. 표시 상태가 같거나 다른 세션의 출력만 바뀌어도 현재 패널이 교체된다.

변경하지 않은 TypeScript를 `tsc -p tsconfig.test.json`으로 컴파일한 뒤, `reproduce-focus.mjs`에서 실제 `OwnershipView`와 `Ownership` 모듈을 임시 loopback 페이지에 로드했다. Edge 155.0.4283.45 headless에서 사용자 소유 세션과 연결 A/B를 준비하고, A가 선택된 select에 포커스를 준 뒤 동일 세션의 복제본으로 render했다. 이후 실제 브라우저 키보드 ArrowDown을 보냈다.

| 동일 상태 재렌더 횟수 | 기존 select 유지 | 포커스 유지 | ArrowDown 이후 선택 |
|---:|---|---|---|
| 0 (대조) | 예 | 예 | B로 변경 |
| 1 | 아니요 | 아니요, BODY로 이동 | A 그대로 |
| 100 | 아니요 | 아니요, BODY로 이동 | A 그대로 |

2026-10-16T04:21:42.137Z의 `focus-reproduction.json`에 결과와 조사 대상 소스 3개의 SHA-256을 기록했다. 대조 및 재현 조건의 assertion이 모두 통과했다. 이는 **결함이 재현됐다는 뜻**이며 수정 통과가 아니다. 최초 샌드박스 내 Edge 실행은 브라우저 시작 단계에서 실패했고, 허용된 샌드박스 밖 실행에서 위 결과를 얻었다. 브라우저와 임시 HTTP 서버는 종료했다.

동일 상태의 render가 키보드 조작을 중단시키는 제품 동작임을 확인했다. 다만 이 단위 재현은 실제 Windows dropdown popup과 전체 Tauri 이벤트 전달을 직접 관측한 것은 아니다. 앞선 native 클릭 실패 전체를 단일 원인으로 확정하거나, 이 DOM 교체를 기존 메모리 증가의 원인으로 확정하지 않는다.

## 정리와 다음 수정 범위

실제 앱 조사는 정상 종료, 32개 어댑터 EOF, 자손 종료 감사, 강제 정리 없음으로 완료됐다. 최종 재확인에서는 기존 Get-Process helper가 StartTime=null 오류를 냈다. 프로세스를 무조건 종료하지 않고 CIM CreationDate로 기록된 44개 PID의 신원을 비교했다. 43개는 없음, 1개는 PID 재사용이며 소유 프로세스 잔존은 0이었다. owner `cc3fdb06-9cfc-4ba5-addf-f9e83a1f09dd` 컨테이너도 0이었다. `baton-native-ui-20261016` 태그는 기록된 image ID와 일치할 때만 제거했다. `final-cleanup.json`에 남겼다.

제안한 제한적 수정은 프런트엔드 세션 목록과 제어 패널에서 관련 상태가 동일하면 DOM을 유지하는 것이다. 현재 세션·소유권·epoch·연결 목록·선택 연결·busy·개입 요청 변화는 빠짐없이 반영해야 한다. 특히 오래된 epoch를 담은 버튼 요청이나 사라진 연결을 남기지 않도록 회귀 시험이 필요하다. 수정 후 임의 MCP 연결 선택을 짧은 네이티브 시험으로 검증한 다음, 2시간 시험 준비를 재개한다. 현재는 수정안 확인 대기이며 제품 수정과 새 장시간 시험은 시작하지 않았다.

원래 2시간 메모리 시험 실패와 Phase 5 출시 차단은 유지한다. 미완성 fuzz 파일은 수정·실행·커밋하지 않았다.

## 승인된 수정과 검증 — 2026-10-16

위 조사 후 사용자가 제한적 프런트엔드 수정을 승인했다. `main.ts`는 선택 세션과 탭의 ID·표시 이름·상태가 같으면 목록 DOM을 유지한다. `OwnershipView`는 세션 ID·상태·epoch·terminal 유무·할당 연결·개입 요청, 연결 목록·선택 연결·busy를 비교해 관련 상태가 같을 때 제어 패널을 유지한다. 실제 상태 변화에는 기존 렌더 경로를 사용한다. 코어 알림·권한 판정·터미널 출력 경로는 변경하지 않았다.

`rust/tests/phase5/ui-stability.mjs`는 실제 브라우저 DOM과 제품 뷰를 사용한다. 전체 화면 시험에서 외부 Tauri IPC만 fixture로 대체했다. 수정 전에는 선택 상자와 세션 탭의 포커스 유지 assertion 2개가 실패했고, 수정 후 4개 시나리오 모두 통과했다. 동일 상태 100회 알림 후 방향키 선택과 Enter로 탭 선택, 최신 handoff/reclaim epoch, pending 버튼 차단·해제, 연결 제거, terminal 유무, 개입 요청 ID·상태, 세션 이름 변경·제거를 검증한다. Node TAP의 총 5개는 부모 테스트 1개를 포함한다.

- `npm test` (`rust/app`): 기존 15개 통과.
- `npm run build` (`rust/app`): 타입 검사와 Vite 빌드 통과.
- `node --test rust/tests/phase5/ui-stability.mjs`: 4개 브라우저 시나리오 통과. 로컬 실행 시 Playwright 경로와 Chromium 실행 파일을 `BATON_PLAYWRIGHT_PATH`, `BATON_BROWSER_PATH`로 지정할 수 있다.
- 독립 코드 검토: 차단 사항 없음. terminal 유무와 reclaim payload의 명시적 회귀 검사를 보강한 뒤 브라우저 시험을 다시 통과했다.

### 변경된 Windows 앱에서의 확인

증거 루트는 `artifacts/phase5-ui-stability-20261016/`다. 커밋 `a120df6`의 Rust 소스를 별도 디렉터리에 추출하고 승인된 두 프런트엔드 파일과 새 dist만 반영했다. dirty Cargo manifest/lock 및 미완성 fuzz는 포함하지 않았다. offline·locked release 빌드가 통과했다. `source-hashes.json`의 226개 파일과 candidate receipt를 검증했으며 시험 앱 SHA-256은 `1ae03f6b7fc0d3d17eb5571c81ba0c11d73ad9cfc39e37c2c520a9393aa0df0e`다. 이는 최종 배포 패키지가 아닌 검증용 후보 파일이다.

`run1`에서는 실제 출력 중 세션 탭 선택·회수·연결 목록 열림 유지·방향키 선택을 관측했다. 네이티브 도구는 화면 밖 탭 클릭 시 geometry unavailable, WebView 팝업 항목 클릭 시 소유 창 불일치 오류를 냈으며, select의 set_value 호출은 관측 가능한 변경을 만들지 못했다. 열린 목록에서 키보드로 이동하고 Enter로 확정하는 경로는 동작했다. 제품의 반복 DOM 교체와 도구의 팝업 좌표 문제를 구별한다.

다만 `run1`은 전달 검증을 마치기 전에 30분 상한에 도달했다. `native_probe_timeout` 실패를 보존하며 성공으로 취급하지 않는다. 정리 기록은 잔존 프로세스·컨테이너 0이지만 정상 종료 인수 경로는 통과하지 않았다.

사용자의 재개 지시 후 같은 바이너리로 미확인 전달과 정상 종료를 `run2`에서 확인했다. 32연결·16세션·2서버 준비 후 Playwright를 분리했으며 본 조작은 **85.6196977초**였다.

1. Windows 버튼으로 `soak-15`를 회수하고 MCP에서 같은 세션의 user_owned·epoch 2·stream 없음 확인.
2. Windows 연결 목록을 열고 End·Enter로 관측한 새 연결 `ff5546cc9c15674fac1e8cdd36a75921` 선택.
3. 전달 버튼 실행 후 MCP에서 adapter 15 → 22 이동, agent_owned·epoch 3·새 stream 확인.
4. 새 owner로 명령을 보내 서버의 `stty size` 응답 `17 102`를 확인. 선택 상자 값이나 클릭 성공만으로 전달 성공을 판단하지 않음.
5. 앱 정상 종료·32개 어댑터 EOF·WebView 자손 종료 감사 통과. 강제 정리 없음, 잔존 프로세스·컨테이너 0.

`verify.mjs`는 원시 응답과 실제 선택 UI, 준비 수량, 소스 15개·바이너리 2개 및 별도 빌드 소스 해시, natural OS 표본의 debugger established 연결 0을 검증했다. `verified.json`의 `nativeHandoffPassed=true`는 이 짧은 검증에 한정된다. `final-cleanup.json`에서 두 실행의 owner label 기준 컨테이너 0, run2 프로세스 재확인 0, 기록된 image ID와 일치하는 시험 태그 제거를 기록했다.

**수정 및 짧은 네이티브 전달 검증은 완료했다. 2시간 무인 조작 실행기와 메모리 인수 시험은 미완료다.** 다음 작업은 검증된 키보드 선택 경로를 사용하는 실행기 준비다. 기존 메모리 증가의 원인을 이 수정으로 확정하거나 Phase 5 출시 차단을 해제하지 않는다.
