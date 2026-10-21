# Phase 5: Windows 창 메뉴와 app_offline 조사

2026-10-21. **창 메뉴를 열어 둔 조건에서 offline 전환과 정상 종료 실패를 두 번 재현했다.** 메뉴 없는 대조 실행은 75.534초 동안 같은 연결로 online을 유지하고 정상 종료했다. 제품 수정이나 N 본시험 재실행은 하지 않았다. 내부 정지 원인의 확정은 아직 남아 있다.

## 출발점과 범위

`phase5-separated-20261021-independent/n-restored`의 마지막 원시 `read_output` 응답은 `{code:"app_offline"}`다. 실행기의 `bad_cursor`는 이 응답에 정상 출력의 `next_cursor`가 없어서 발생한 후속 오류이며, cursor 값이 실제로 손상됐다는 뜻이 아니다. 실패 시점은 입력 deadline보다 앞서 있다. 사용량 한도 중단만으로 원인을 설명할 수 없다.

진단은 고정 후보 앱, MCP adapter 1개, SSH 세션 0개, CDP/Playwright 연결 0개로 수행했다. 각 실행은 별도 LOCALAPPDATA/WebView 디렉터리와 기존 소유 job supervisor를 사용했다. 상태를 약 1초마다 읽고 메뉴를 닫은 뒤 약 10초간 복구 여부를 확인했다. 대조 실행에서 접근성 조회 1회를 수행했다. Native 입력은 computer-use의 Alt+Space/Escape, 메뉴 열린 동안 UI 조작은 없었다.

증거 루트: `artifacts/phase5-offline-diagnostic-20261021/`. `probe.mjs`, `probe-control.mjs`, `probe-screenshot.mjs`와 각 실행의 events/summary/process/메뉴 관측 marker, 후속 정리 확인을 보존했다. `analysis.json`은 원시 상태 이력에서 전환 시각과 횟수를 다시 계산하고 파일 SHA256을 기록한다.

## 실제 결과

| 실행 | 메뉴 관측 | 상태 결과 | 메뉴 닫은 뒤 | 종료 |
|---|---|---|---|---|
| `run1` | 화면 + 접근성 조회; 접근성은 null | 08:08:29.248 UTC online → 08:09:22.593 offline | 후속 10개 표본 모두 offline | 정상 종료 15초 대기 실패, 강제 정리 |
| `control` | 메뉴 열지 않음; 화면 + 접근성 조회 | 08:12:22.851부터 75.534초 online 유지 | 해당 없음 | 앱 exit 0, adapter EOF 0, descendant audit verified |
| `screenshot-only` | 화면만 캡처, 접근성 조회 없음 | 08:13:54.363 UTC online → 08:14:48.766 offline | 후속 10개 표본 모두 offline | 정상 종료 15초 대기 실패, 강제 정리 |

각 실행은 시작 때의 일시적 offline 이후 하나의 online connection ID만 관측했다. 메뉴 사례는 offline 상태에서도 **동일 앱 PID와 Process.StartTime ticks**가 살아 있음을 별도로 확인했다. 메뉴가 화면에 보였고 Escape 뒤에는 사라졌다. 메뉴 종료 후 연결 복구가 안 된다는 범위는 약 10초의 관측에 한정한다.

모든 실행 후 앱/관측된 자식/adapter/runner PID 잔류 0을 확인했다. 메뉴 사례의 최종 process receipt는 supervisor 강제 종료 전의 `normalExit:false, descendantAudit:unverified` 상태다. 그 receipt의 `forcedCleanup:false`를 정상 정리로 해석하면 안 된다. 진단 runner의 종료 대기 실패 후 `stop()`이 supervisor를 종료했고, 소유 job의 kill-on-close 이후 잔류 0을 별도로 확인했다. 메뉴 사례에서는 정상 종료나 EOF 통과를 주장하지 않는다.

첫 생존 확인의 CIM CreationDate는 100ns ticks 정밀도가 달라 expected와 7 ticks 차이가 났다. 해당 기록을 삭제하지 않았으며, `offline-process-exact.json`에서 Get-Process.StartTime으로 정확히 일치함을 다시 확인했다. 소유 여부 판정에는 후자를 사용한다.

## 고정 입력 확인

- app SHA256: `1ae03f6b7fc0d3d17eb5571c81ba0c11d73ad9cfc39e37c2c520a9393aa0df0e`
- adapter SHA256: `09823dd5d51cd3b33f286540fe43a03570b3eee81497607a1b5b67336fcb754c`
- Node `v22.17.0`, Windows 기존 환경, 관측된 WebView 경로 `155.0.4283.62`.
- 각 실행 종료 및 분석 시 두 바이너리 hash 일치. probe summary의 `sourcesUnchanged`라는 필드명은 **두 바이너리 검사만** 의미한다. 제품 전체 소스 불변 검사를 뜻하지 않는다.
- 후보 build source manifest SHA256: `d95de46cb7365a1a5db05b3cf4c7e2b893baec0c34126c7dbc8d2594d8c3a8ec`. 보존된 후보 `lifecycle.rs` hash가 manifest 값 `d100cb5483faae39de77ae401585d8db2497fd9e099b5300adfd627c7a188e0e`와 일치한다. 현재 파일과는 줄바꿈 차이만 있으며 `git diff --no-index --ignore-space-at-eol`에서 내용 차이가 없다.

## 코드에서 확인한 경로와 아직 확인하지 못한 것

후보의 `rust/app/src-tauri/src/lifecycle.rs`는 5초마다 heartbeat를 보내고, 마지막 pong 이후 30초가 지나면 `frontend_lost()` → `stop(FrontendLost)` → `state.stopping=true`로 전환한다. 이후 `pong()`도 거부한다. `agent_bridge.rs`는 stopping 상태의 요청/연결에 AppOffline을 반환하고, adapter는 이를 offline 상태로 표현한다. 따라서 **프로세스가 살아 있어도 offline이 지속될 수 있는 경로**가 코드에 있다.

현재 가설은 Windows 메뉴의 모달 처리 중 프런트엔드 heartbeat 응답이 지연되고 이 영구 정지 경로로 들어간다는 것이다. 메뉴 없는 대조와 접근성 조회 없는 재현이 이를 지지한다. 단, 현재 후보에는 마지막 pong/정지 사유/IPC 종료 사유 로그가 없고 UI thread stack도 수집하지 않았다. 정확한 내부 대기 지점, heartbeat가 직접 정지 원인이었는지, 정상 종료 실패가 같은 대기의 결과인지는 확정하지 않는다. Tauri/Tao 코드를 읽었지만 런타임 스택 없이 라이브러리의 특정 줄을 원인으로 단정하지 않는다.

메뉴 marker는 화면 확인 뒤 기록한 시각이며 실제 키 입력 시각이 아니다. marker부터 offline까지의 시간을 30초 watchdog 측정값으로 사용하지 않는다. 메뉴 입력 자체는 native automation이므로 물리 키보드와 완전히 동일한 동작이라고 주장하지 않는다. 세 사례는 짧은 순차 진단이며 빈 앱 조건이다. SSH 출력 부하에서의 추가 영향은 검증하지 않았다.

## 다음 작업

1. 제품 동작을 바꾸기 전에 별도 진단 후보에 마지막 ping/pong, `frontend_lost` 진입 사유, IPC 연결 종료 사유 및 정상 종료 단계의 관측을 추가한다. 기존 고정 후보와 증거를 덮어쓰지 않는다.
2. 같은 최소 메뉴 재현에서 정지 경로와 UI thread 대기 위치를 대조한다. 정상 종료 실패도 함께 설명돼야 한다.
3. 실제 프런트엔드 상실 시 차단하는 기존 보장을 유지하면서 Windows 메뉴/크기 조정 중 일시 지연을 어떻게 다룰지 결정한다. 30초 제한 연장이나 app_offline 무시로 시험만 통과시키지 않는다.
4. 원인이 해결된 뒤 N 사례를 다시 판단한다. 기존 실패를 통과로 바꾸지 않고 Phase 5 인수/결합 메모리/공개 경계 미검증은 그대로 둔다.
