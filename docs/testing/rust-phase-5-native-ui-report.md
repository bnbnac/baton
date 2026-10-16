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
