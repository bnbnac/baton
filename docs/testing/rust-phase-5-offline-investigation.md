# Phase 5: Windows 창 메뉴와 app_offline 조사

최신 제품 경계 검증(2026-10-23): Alt+Space 메뉴 중 마지막 heartbeat 응답 후30초에 FrontendLost가 발생했고 실제 메뉴 종료 뒤에도 offline을 유지했다. 메뉴 종료 후 앱 자체는 정상 종료했다. 같은 바이너리의 제목 표시줄 메뉴는62.594초 동안 pong13회/online을 유지했다. 상세·절차 변경·한계는 마지막 절을 따른다.

2026-10-23 갱신. **Escape 두 번째 입력에서 실제 메뉴 루프가 끝났고, 동기 전달 원본과 큐 전달 진단 앱 모두 응답 복구·정상 종료했다.** 첫 Escape로 팝업이 사라져도 메뉴 모드는 남아 있었다. 앞선 종료 실패를 영구 교착 또는 별도의 종료 결함으로 확정하지 않는다. 원본은 메뉴 루프 동안 Rust 수신이 멈추고 큐 전달 실험은 응답을 유지한다는 차이는 남는다. 제품 수정이나 N 본시험 재실행은 하지 않았다. 앞선 결과와 가설은 당시 기록이며, 마지막 절에서 확인 범위를 갱신한다.

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

## 2026-10-22: 정지 사유 계측 결과

증거: `artifacts/phase5-offline-trace-20261022/`. 이전 고정 후보의 보존 소스를 새 디렉터리로 복사하고, Rust 앱 소스 6개에 경계 로그와 로그 모듈 1개만 추가했다. UI assets, Cargo.lock, 제품 작업 파일과 미완성 fuzz는 변경하지 않았다. `source-before.json`, `source-verified.json`, `verify-source.mjs`가 전체 복사본의 변경 범위를 검증한다. 최초 `diagnostic` 모듈 이름이 Rust/Tauri 매크로의 도구 이름과 충돌해 빌드에 실패했고 `baton_trace`로 바꿔 빌드했다. 최초 overlay 목록보다 최종 `source-verified.json`이 최종 파일 hash의 기준이다.

- 진단 앱 SHA256: `f9387df8af7983c1f05b73fa80fd978559757ae9c4791df7c94fc4a43c09c6e6`. `build2.json` exit 0. 기존 후보 앱·adapter는 보존했다.
- SSH 0, MCP 1, CDP/Playwright 0. logger는 별도 로컬 파일에 시각·Rust thread ID·경계 이벤트만 기록한다. 원래 timeout이나 정지/종료 동작은 변경하지 않았다. 로그 추가에 따른 타이밍 영향은 배제하지 않는다.
- 최초 `control`은 제한된 실행 환경에서 MCP online에 도달하지 못해 중단했다. 앱 heartbeat 자체는 정상 왕복했다. `menu-closed.json`은 이 실행을 조기 종료하기 위한 marker이며 실제 메뉴 조작이 아니다. 그 파일의 고정 UTC는 실제 관측 시각으로 쓰지 않는다. `abort-note.json`과 `analysis.json`에 제외 사유를 기록했다. summary의 `observationComplete:true`만으로 유효한 대조로 판단하지 않는다. 실행 권한이 연결 실패의 원인이라는 가설은 있으나 ACL 실패 지점을 확정하지 않았다.
- 기존 시험과 같은 사용자 권한에서 실행한 `control2`는 동일 연결의 online 표본 76개, 75.482초를 확인했다. heartbeat timeout 없음, 앱 exit 0, adapter EOF 0, descendant audit verified.
- 같은 권한·바이너리의 `menu`는 Alt+Space로 메뉴를 열고 screenshot만 관측했다. 송신 로그는 계속 성공했지만 pong이 멈췄다. 마지막 pong과 timeout 로그 사이 30.073초, timeout 직전 내부 경과 측정 30.072초에 `heartbeat.timeout` → `frontend_lost` → `stop.begin reason=FrontendLost` → `stop.state_locked`가 기록됐다. 이어 MCP가 offline으로 바뀌었다. 이것으로 이 실행의 정지 사유는 확인됐지만, heartbeat가 UI 처리의 어느 내부 단계에서 지연됐는지는 아직 확인하지 않았다.
- Escape로 메뉴가 사라진 뒤 약 10초간 상태 표본 10개 모두 offline이었다. timeout 이후 수락된 pong도 0이다. 정지 후 pong을 거부하는 코드는 확인했지만, 이번 로그에는 늦게 도착해 거부된 pong 호출 자체도 없다. 따라서 회복 실패를 pong 거부만으로 설명하지 않는다.
- 정상 창 닫기 요청에서 `window.close_requested` 이후 **6ms 안에** `service.shutdown.end`, `ipc.shutdown.end`, `shutdown.join.end`, `handle.exit.begin/end`, `app.exit_requested`까지 도달했다. 서비스나 IPC 종료 future가 영원히 기다리는 가설은 이번 실행에서 배제된다. 그러나 supervisor의 정상 종료 대기는 15초 한도로 실패했고 root exit code/EOF/descendant audit는 확인되지 않았다. 이 기록만으로 Tauri/WebView 내부 대기 위치나 앱 root와 supervisor 중 어느 프로세스가 최종 대기의 원인인지 단정하지 않는다.
- 이후 소유 supervisor 정리와 job kill-on-close를 거쳤다. 동일 사용자 권한의 `post-exit-check.json`으로 세 실행의 기록된 앱·자식·adapter·runner PID 잔류 0을 확인했다. 메뉴 실행 receipt의 `forcedCleanup:false`는 정상 종료 증거가 아니다.

`node artifacts/phase5-offline-trace-20261022/analyze.mjs`가 원시 trace/status, 정리 기록, 전체 진단 소스와 바이너리 hash를 대조했다. 메뉴 summary SHA256은 `0b59cd7854a4135b82aff7299e9ec6a91b902a12f637b896c875f1b3f3bed342`, trace SHA256은 `93a11e95103fdac5202470bf2855b5315699a95037afe6b2144cfb80340fc3ea`다. 수집 UTC는 2026-10-21 15시대이며 한국 날짜로 10월 22일이다.

다음 조사는 `app.exit_requested` 이후의 Exit 이벤트/이벤트 루프 반환과, 강제 정리 전 root·WebView·supervisor의 동일 권한 생존 상태에 집중한다. 장시간 시험이나 N/F/M은 재실행하지 않았다. 실제 frontend 상실 차단을 유지하는 수정 설계는 이 종료 문제를 구분한 뒤 정한다. Phase 5 출시 차단은 유지한다.

## 2026-10-23: 한도 중단 후 종료 경계 결과 회수

증거 루트는 `artifacts/phase5-exit-trace-20261022/`다. 실행은 한국 날짜 10월 22일에 완료됐으며, 10월 23일 재개 시 새 시험 없이 기존 결과를 분석하고 소유 프로세스 잔류를 다시 확인했다. 기존 진단 소스에서 `main.rs`의 Exit/Destroyed/종료 허용/반환 로그만 추가했고, `manifest.json`으로 전체 소스와 바이너리를 고정했다. 앱 SHA256은 `06c64e1256da66f8ed39ec2d7dbe153df1b6d5636b46dfea0ead10e2618f522f`, 빌드 exit 0. 제품 소스와 미완성 fuzz는 그대로다.

첫 `menu` 실행은 새 PowerShell 수집기의 닫는 괄호 누락으로 표본 수집에 실패했다. 이 실행을 정상 종료 deadline 검증이나 생존 증거로 사용하지 않는다. 오류를 수정하고 구문 검사와 살아 있는 자체 프로세스 수집을 확인한 뒤 같은 바이너리의 `menu2`를 실행했다. `harness-revision2.json`은 수집기 수정, `harness-revision3.json`은 짧은 메뉴 조건 추가를 기록한다. 최초 manifest의 수집기 hash를 수정 후 파일 hash로 오인하지 않는다.

| 관측 | menu2 | short-menu |
|---|---:|---:|
| 메뉴 열림/닫힘 관측 marker 간격 | 54.204초 | 16.855초 |
| 마지막 수락 pong → timeout 로그 | 30.055초 | 30.046초 |
| 메뉴 닫힘 marker → timeout | 닫히기 28.258초 전 | 닫힌 뒤 9.086초 |
| 정상 창 닫기 요청 → 종료 허용 | 7ms | 7ms |
| 생존 표본의 실제 창 닫기 요청 후 시각 | 2.668초 / 9.330초 | 2.668초 / 9.316초 |
| 각 생존 표본 | 같은 앱 root + 같은 WebView 6개 | 같은 앱 root + 같은 WebView 6개 |
| 최종 Exit 이벤트 / 정상 종료 | 미관측 / 15초 대기 실패 | 미관측 / 15초 대기 실패 |

생존 표본은 같은 실행 권한에서 조회했고 앱·WebView의 PID와 Process.StartTime ticks가 시작 기록과 일치했다. 따라서 감시 프로세스만 남은 현상이 아니라 **앱 자체도 실제 살아 있었다.** `exit-plus2.json`/`exit-plus8.json`이라는 파일명은 예약 지연이며 실제 측정 시각은 표와 JSON의 UTC를 따른다. Node supervisor/runner/adapter 생존도 기록했지만 최초 시작 시각과 대조하지 않은 항목은 root/WebView와 같은 신원 검증으로 주장하지 않는다.

두 실행 모두 서비스·IPC 종료가 완료되고 `app.exit_allowed`까지 도달했으나 `app.exit_event`/`window.destroyed`는 기록되지 않았다. Windows의 Tao `run`은 내부 `run_return` 뒤 `std::process::exit`를 호출하므로, 추가한 `app.run_returned` 로그 부재 자체는 정지 증거가 아니다. `ThreadState/WaitReason` 표본은 호출 스택이 아니며 특정 COM/잠금/라이브러리 줄을 원인으로 확정하지 않는다.

짧은 메뉴 조건은 5초 후 닫기 요청 marker를 만들도록 했지만 실제 조작·관측 간격은 16.855초였다. marker는 키 입력 시각 자체가 아니다. 메뉴가 사라진 뒤에도 창 닫기 요청 전까지 `pong.begin`이 0건이고, 9.086초 뒤 timeout이 발생했다. **정상 창 닫기 요청은 그 timeout보다 2.086초 늦었다.** 따라서 메뉴를 닫아도 heartbeat가 회복되지 않은 관측은 유효하지만, 의도했던 “heartbeat timeout 없이도 종료 실패” 대조는 성립하지 않았다. 이를 통과/확정 결과로 쓰거나 자동 재실행하지 않는다.

`analyze.mjs`가 원시 trace/status/표본을 대조하고 전체 진단 소스·앱 hash 불변을 검증했다. `analysis.json`에는 수치와 원시 파일 hash를 저장했다. 세 실행 모두 `resume-cleanup-check.json`에서 기록된 시작 시각까지 일치하는 소유 프로세스 잔류 0을 확인했다. 강제 정리를 거친 실패 실행을 정상 종료로 바꾸지 않는다.

다음 조사 범위는 메뉴가 사라진 뒤에도 UI heartbeat 처리가 재개되지 않고 종료 허용 이후 최종 Exit로 진행하지 않는 Windows 이벤트 처리 경계다. 실제 호출 스택 또는 최소 이벤트 루프 재현으로 구분해야 하며, 시간 초과값 변경으로 우회하지 않는다. N 독립 사례 0/2, 정식 F/M 미실행과 Phase 5 출시 차단은 유지한다.

## 2026-10-23: Baton 서비스 없는 최소 Tauri 창 재현

`artifacts/phase5-minimal-window-20261023/`에 기존 진단 소스 복사본의 `main.rs`, `dist/index.html`을 바꾸고 `minimal.js/css`만 추가했다. `manifest.json`이 이 네 파일 차이와 전체 소스/실행기/수집기/바이너리 hash를 기록한다. Rust 의존성/lockfile과 Tauri 설정은 유지했으며, Baton 라이브러리의 파일 logger만 사용한다. AppService/SSH/MCP 서버/heartbeat 감시를 생성하거나 실행하지 않는다. 따라서 완전히 독립된 새 Tauri 프로젝트는 아니지만 해당 제품 서비스의 런타임 영향을 제거한 재현이다.

최소 HTML은 1초마다 화면 카운터를 갱신하고 `diagnostic_tick` 명령을 호출한다. 별도 Rust thread는 2초마다 `window.eval`로 `diagnostic_ack` 호출을 요청한다. 정상 창 닫기는 기존과 같은 `prevent_close` → 다른 thread의 `app.exit(0)` 흐름을 사용하되 서비스 종료/정지 플래그/비동기 drain은 없다. `ExitRequested`는 무조건 허용하며 `Exit` 이벤트를 기록한다. 타이머를 늘리거나 종료를 강제 통과시키는 제품 수정은 하지 않았다.

| 항목 | control | menu |
|---|---|---|
| 런타임 SSH/MCP/watchdog/CDP | 모두 0/없음 | 모두 0/없음 |
| 초기 JS tick / eval ack 수신 | 20 / 10 | 24 / 12 이후 중단 |
| 화면 관측 | 메뉴 조작 없음 | 메뉴 열린 화면 tick 27 → 닫힌 화면 tick 47 |
| 메뉴 닫힘 관측 뒤 정상 창 닫기까지 | 해당 없음 | 10.964초 |
| 그 구간 Rust에서 받은 tick / ack | 해당 없음 | 0 / 0, eval 송신 시도 5회 |
| 창 닫기 → ExitRequested 허용 | 2ms | 2ms |
| 최종 Exit 이벤트 / 종료 | 관측 / exit 0, descendant audit verified | 미관측 / 15초 정상 종료 대기 실패 |
| 종료 요청 후 생존 | 정상 종료 | 2.686초 표본에서 동일 root와 동일 WebView 6개 생존 |

메뉴 열림/닫힘 관측 marker 간격은 19.809초다. 화면 관측은 computer-use screenshot에서 읽은 값이며 원시 trace의 마지막 수신 tick 24와 구분한다. 화면 카운터 증가로 JavaScript 타이머와 화면 갱신이 진행한 것은 보이지만, Rust에 명령이 도착하지 않은 정확한 내부 단계까지 설명하지는 못한다. `eval.sent ok=true`도 스크립트 실행 완료 보장이 아니다.

두 실행은 동일 바이너리 `ea5fbca3ba85c6226ecf691d499fea8048b7339be1e2c8b048281b7cbe2738a4`, 동일 WebView `155.0.4283.62`를 사용했다. `analyze.mjs`로 원시 trace/표본, 전체 소스와 실행기·수집기·바이너리 hash를 검증했다. 메뉴 summary SHA256은 `aea53220f4669ea14fdb286bb34309510f0ac181f6444b719ac736fe7c9fe8f9`, trace SHA256은 `bcd16a7c6a75bee7f3b3cf01fcf5e23db594168817196a0715de0955fa62a41e`다. `cleanup-check.json`에서 PID와 시작 시각을 대조한 소유 잔류 0을 확인했다. 메뉴 실패는 supervisor 정리/job kill-on-close를 거쳤으며 정상 종료가 아니다.

**이 조건에서 종료 실패를 만들기 위해 Baton watchdog timeout이나 SSH/MCP 서비스는 필요하지 않다.** 기존 제품의 frontend timeout은 실제 관측된 후속 정지 경로지만 이번 최소 재현에는 없다. 다음 조사 지점은 동일 Windows 창/이벤트 루프의 메시지 전달·종료 진행 경계다. Tauri/Tao의 특정 결함으로 확정하지 않으며, 같은 native automation·job supervisor·창 설정·WebView 조합의 영향도 아직 분리하지 않았다. 하위 루프의 상태/메시지 계측 또는 스택을 확보해 이 경계를 구분한다. Phase 5 인수와 N/F/M 상태는 변경하지 않는다.

## 2026-10-23: Windows 메시지 경계와 메뉴 진입 경로 비교

증거는 `artifacts/phase5-tao-loop-20261023/`와 `artifacts/phase5-tao-paint-20261023/`다. 최소 앱 소스를 각각 별도로 복사하고 Tao 0.35.3의 로컬 복사본에 로그만 추가했다. 제품 작업 파일과 전역 Cargo registry는 수정하지 않았다. 각 manifest는 전체 복사본 hash와 원본 registry hash를 기록한다. 기존 최소 앱 대비 Rust 소스/HTML은 동일하며, 복사본의 Cargo.toml/lockfile 변경은 같은 버전 Tao를 로컬 경로로 연결하는 내용뿐이다. Tao 변경은 `event_loop.rs`, `event_loop/runner.rs` 두 파일이다. 네이티브 조작은 computer-use, 런타임 SSH/MCP/watchdog/CDP는 모두 없다.

첫 계측은 GetMessage/DispatchMessage 전후, runner 상태, callback 전후를 기록했다. 메뉴 없는 control은 `Idle` → `pump.exit.break` → Exit로 정상 종료했다. Alt+Space 실행은 바깥 루프의 `DispatchMessageW(WM_PAINT)` 시작 뒤 반환이 없었다. 같은 UI thread 안에서 UserEvent는 계속 처리되고 `ExitWithCode(0)`도 설정됐지만, `HandlingMainEvents`에 머물러 바깥 루프 종료 검사로 돌아오지 못했다. 로그 12,355건, 정상 종료 15초 대기 실패. 이 두 실행은 한도 중단 전에 완료됐고 재개 시 재실행 없이 결과를 검증했다.

후속 계측은 그 WM_PAINT 내부의 `flush_paint_messages`, PeekMessageW 전후, 선택한 Windows 기본 창 처리 전후만 추가했다. 빌드 exit 0, 앱 SHA256 `60e58d2df3bb6f382b19efbf630fd1449ff0ce1b5347b7d5e913a3612813ca94`. 대조/control, Alt+Space/menu, 제목 표시줄 우클릭/title-menu는 모두 이 바이너리와 WebView 155.0.4283.62를 사용했다. title-menu 실행기는 별도 파일과 `title-menu-harness.json`으로 고정했으며 기존 실행기와 증거를 덮어쓰지 않았다.

| 관측 | Alt+Space | 제목 표시줄 우클릭 |
|---|---|---|
| 메뉴 진입 이벤트 | WM_ENTERMENULOOP 1회 | WM_ENTERMENULOOP 1회 |
| Escape 후 화면 | 메뉴 안 보임, JS 카운터 22→37 | 메뉴 안 보임, JS 카운터 20→36 |
| 실제 메뉴 종료 이벤트 | WM_EXITMENULOOP 0회 | WM_EXITMENULOOP 1회 |
| 메뉴 처리 중 Rust 응답 | 마지막 tick19/ack9 이후 중단 | 실제 메뉴 구간 15.580초 동안 tick16/ack8 |
| 화면에서 메뉴가 사라진 관측 이후 | tick/ack 0/0, WM_ENTERIDLE 16회 지속 | 닫기 요청 전 tick11/ack6 |
| 정상 창 닫기 | 종료 허용 1ms, Exit 없음, 15초 대기 실패 | Exit까지 6ms, exit0, descendant audit verified |
| 종료 후 소유 root/WebView | 강제 정리 뒤 잔류0 | 정상 종료 뒤 잔류0 |

Alt+Space 실행의 원시 호출 순서는 다음과 같다. 이것은 로그와 계측 소스의 경계 순서이며 디버거가 수집한 전체 네이티브 스택은 아니다.

```text
Tao 바깥 DispatchMessageW(WM_PAINT)
  thread_event_target_callback → flush_paint_messages
    PeekMessageW(실제 창, WM_PAINT 범위) 시작
      WM_SYSCHAR(262) → DefWindowProcW 시작
        WM_SYSCOMMAND(274) → DefWindowProcW 시작
          WM_ENTERMENULOOP(529), 이후 UserEvent/WM_ENTERIDLE 처리
          [WM_EXITMENULOOP(530) 없음]
        [기본 처리 반환 없음]
      [기본 처리 반환 없음]
    [PeekMessageW 반환 없음]
  [바깥 DispatchMessageW 반환 없음]
```

`PeekMessageW`가 nonqueued 메시지를 내부에서 처리할 수 있다는 것은 [Microsoft 문서](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-peekmessagew)에 명시돼 있다. [WM_EXITMENULOOP](https://learn.microsoft.com/en-us/windows/win32/menurc/wm-exitmenuloop)는 메뉴 modal loop 종료 알림이다. 따라서 앞선 “메뉴 닫힘” marker는 **화면에서 메뉴가 사라진 관측**으로만 해석해야 한다. 이 실행에서 내부 메뉴 처리가 끝난 뒤에도 고장 났다는 해석은 철회한다. 메뉴 처리가 끝나지 않은 상태에서 다른 메시지와 종료 요청이 중첩 처리된 것이 현재 증거다.

제목 표시줄 메뉴는 같은 자동화 도구의 Escape와 같은 supervisor/창/바이너리에서도 정상 종료했다. 따라서 모든 시스템 메뉴 또는 Escape 도구 자체가 언제나 고장 난다는 설명은 배제된다. 그러나 진입 경로에 따른 focus/키 전달 차이, WebView의 시스템 키 전달 방식은 아직 분리하지 않았다. WebView2는 callback 내부의 동기 중첩 메시지 루프를 지원하지 않는다고 [Microsoft가 설명](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/threading-model#reentrancy)하지만, 이번 WM_SYSCHAR를 보낸 주체와 호출 스택이 확인되지 않았으므로 **WebView2 재진입이 근본 원인이라는 것은 아직 가설**이다. 특정 Tao/Wry 결함이나 수정 방법을 확정하지 않는다.

검증은 두 루트의 `analyze.mjs` 및 후속 루트의 `analyze-title-menu.mjs`로 수행했다. 원시 로그의 순번 연속성·100,000건 로그 제한 미도달·메뉴 경계 수치·전체 소스/바이너리/registry hash·소유 자원 정리를 대조했다. 후속 Alt+Space 로그 12,759건, 제목 표시줄 로그 65,318건. 로그 파일 I/O에 따른 타이밍 영향은 남는다. 후속 Alt+Space summary SHA256 `46c3612d6bfcebed7606421b75370f9ce365cf04abba10c691cc97715ff26b6c`, Tao log SHA256 `dae7307a5a80b4bb12e77175493b1151aaacd55080565614e84c9d4140290b39`. 제목 표시줄 summary SHA256 `68c1237b0a155125114833dc7a174ed938a902776c9c862c5fb9e31d8d990778`.

첫 소스 준비 스크립트는 교체 대상이 유일하지 않아 실행 전에 assertion으로 두 차례 중단했다. 범위를 좁혀 수정한 뒤 빌드했으며 실패한 준비 단계에서 앱은 실행하지 않았다. 후속 control 정리 검사는 기존 WebView PID가 `svchost`로 재사용되어 StartTime 조회가 불가능한 경우에 처음 실패했다. 다른 프로세스 이름으로 신원을 구분하고, 신원을 판정할 수 없으면 실패하도록 검사한 뒤 잔류0을 확인했다. 해당 프로세스에는 종료나 변경 작업을 하지 않았다.

다음 조사는 Alt+Space/WM_SYSCHAR의 송신·focus·동기 전달 경계를 확인하는 것이다. 메뉴를 강제 종료하거나 heartbeat 제한을 늘리는 우회는 적용하지 않았다. 이번 다섯 실행의 소유 자원 정리 완료, 제품/fuzz 변경 없음. N 독립 사례0/2, 정식 F/M 미실행 및 Phase 5 출시 차단 유지.

## 2026-10-23: 동기 메시지 문맥 확인과 큐 전달 가설 검증

`artifacts/phase5-syschar-context-20261023/`는 직전 진단 복사본의 Tao `event_loop.rs`에 InSendMessageEx, GetFocus, GetWindowThreadProcessId, GetClassNameW, GetGUIThreadInfo 결과만 추가했다. 기존 입력/종료 동작은 유지했다. 앱 SHA256 `f81d0cf8d60adb78da743085119c8e79fc20fcd31625fc37a5d6ed22fd7b5384`, 빌드 exit0. 두 메뉴 방식에서 같은 바이너리를 사용했다.

- Alt+Space의 WM_SYSCHAR는 wParam32, lParam536870913, `send_flags=1`이었다. WM_SYSCOMMAND와 메뉴 진입도 같은 전송 문맥이었다. `ISMEX_SEND`가 있고 `ISMEX_REPLIED`가 없으므로 다른 스레드가 응답을 기다리는 상태라는 것은 [InSendMessageEx 문서](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-insendmessageex)로 해석할 수 있다. 이 API는 송신 PID를 알려주지 않으므로 송신 프로세스를 확정하지 않는다.
- 제목 표시줄 메뉴 진입/종료는 `send_flags=0`이었다. 두 실행 모두 포커스는 `Chrome_WidgetWin_1`, 포커스 thread는 앱 UI thread와 다르고, 포커스 PID는 소유 receipt에 기록된 해당 실행의 msedgewebview2 프로세스였다. 단순히 WebView에 포커스가 있다는 사실만으로 실패를 설명할 수 없다. HWND/PID가 같은 실행이라는 뜻은 아니며 각 실행의 신원과 대조했다.
- Alt+Space는 화면에서 메뉴가 사라진 후 tick/ack0/0, 메뉴 종료 이벤트 없음, 정상 종료15초 실패였다. 제목 표시줄 메뉴는 실제 메뉴 종료 이벤트, 이후 tick11/ack5, exit0/descendant audit verified였다.

이후 `artifacts/phase5-syschar-defer-20261023/`의 별도 복사본에서 **응답을 기다리는 다른 스레드의 Alt+Space WM_SYSCHAR만** PostMessageW로 같은 HWND와 인자에 큐잉하고 현재 호출을 반환하는 실험을 했다. 조건은 WM_SYSCHAR, wParam32, Alt context bit, `(InSendMessageEx & 9)==1`이고, 큐잉 실패 시 기존 처리를 유지한다. 나중에 큐에서 꺼낸 메시지는 send_flags0이므로 다시 큐잉하지 않는다. 문맥 계측 복사본과 비교해 `event_loop.rs` 한 파일만 다르다. 앱 SHA256 `97128802034de786bd54555e5b4d8919a7208cfff2eb1c8fca6eb0e404035986`, 빌드 exit0. 제품 파일과 전역 registry는 그대로다.

`check-menu-recovery.mjs`를 먼저 작성해 변경 전 실행에서 `menu_loop_exit_missing`으로 실패하는 것을 확인했다. 검사는 실제 메뉴 종료 이벤트, 화면상 메뉴가 사라진 뒤의 양방향 응답, 최종 Exit/exit0/정상 자식 정리를 요구한다. 변경 후에도 **같은 검사에서 실패**했다.

첫 변경 후 실행 `menu`는 메뉴 열린 screenshot을 확인한 직후 사용자 사용량 한도로 진행이 끊겼다. marker/Escape/정상 닫기 절차를 마치지 못해 실행기가 `menu_not_observed`로 제한시간 종료했다. `interruption-note.json`에 제외 사유를 기록했고, 이 실행의 계속되는 tick 로그를 회복 통과로 사용하지 않았다. 사용자의 명시적 재개 요청 후 같은 바이너리·새 `menu-complete` 디렉터리에서 미완료 검증을 수행했다. 이 실행기 hash는 `continuation-harness.json`에 실행 전 기록했다.

| 변경 후 완결 실행 관측 | 결과 |
|---|---|
| WM_SYSCHAR 처리 | send_flags1 → 큐잉 성공1회 → send_flags0, 로그 간격2ms |
| 메뉴 진입 문맥 | send_flags0, 포커스는 해당 실행의 WebView 창 유지 |
| 화면상 메뉴가 사라진 뒤 닫기 요청 전 응답 | JS tick11 / eval ack6 |
| 실제 메뉴 루프 종료 | WM_EXITMENULOOP 없음 |
| 정상 앱 종료 | 종료 허용1ms, 최종 Exit 없음, 15초 대기 실패 |
| 강제 정리 후 | 소유 root/WebView 잔류0 |

따라서 동기 전달 경로는 이 환경의 응답 중단에 기여하며 이를 분리하면 응답은 유지된다. 그러나 **큐 전달만으로 메뉴 루프와 정상 종료는 해결되지 않는다.** 이를 완성된 수정안으로 채택하지 않는다. 두 현상이 완전히 독립적인 근본 원인이라는 주장도 하지 않는다. 다음은 Escape/키 해제/메뉴 취소 메시지의 전달과 실제 메뉴 루프 종료를 구분하는 조사다. WebView2 callback 재진입이나 특정 라이브러리 결함을 확정한 상태가 아니다.

문맥 진단 `analyze.mjs`가 원시 메시지 순번, 로그 제한 미도달, 문맥 필드와 소유 WebView 신원, 소스/바이너리/registry hash, 단일 파일 변경 범위, continuation 실행기 hash, 종료 전 동일 root/WebView7개 생존 및 사후 잔류0을 검증했다. 변경 후 summary SHA256 `46cbc049f7f5864feb83f2e12a9a18e5e37092d763897a0519541a83565fdf75`, Tao log SHA256 `6b83a3b7b94af745f51a1fcd5b3d7234aa4178284f336d9585faf3372ca24af5`. 모든 로그 파일 I/O와 자동 입력의 영향은 남아 있다.

문맥 진단의 Alt+Space 실패 실행에서는 supervisor 정리 뒤 `process.json`이 없고 `.partial`만 남아 summary의 최종 process 필드도 없었다. 종료 전 `summary.beforeClose`와 `exit-plus2.json`의 신원을 사용해 소유 프로세스 잔류0을 확인했으며, 최종 receipt 부재를 정상 종료로 보정하지 않았다. 제목 표시줄 및 변경 후 완결 실행은 최종 receipt를 확인했다. 불완전 실행 포함 이번 네 실행 정리 완료, 제품/fuzz 변경 및 N/F/M 재실행 없음. Phase 5 출시 차단 유지.

## 2026-10-23 Escape 2회: 메뉴 종료 해석 정정

가설은 첫 Escape가 팝업만 닫고 메뉴 모드를 남긴다는 것이다. 새 소스나 바이너리를 만들지 않고 위 두 바이너리에 각각 Alt+Space → Escape → 화면/로그 관측 → Escape를 수행했다. 기존 실행기의 출력 디렉터리만 `menu-two-escape`로 바꾸고 두 번째 Escape 관측 뒤에만 닫힘 marker를 작성했다. 기존 recovery predicate는 수정하지 않았다. 메뉴가 화면에서 사라진 시각은 관측 marker이고, 실제 메뉴 종료 시각은 WM_EXITMENULOOP 기본 처리 완료 로그를 사용한다.

| 항목 | 동기 전달 원본 | 큐 전달 진단 |
|---|---|---|
| 증거 루트 | `phase5-syschar-context-20261023/menu-two-escape` | `phase5-syschar-defer-20261023/menu-two-escape` |
| 실행 UTC | 07:48:03.921–07:49:16.487 | 07:46:35.305–07:47:50.788 |
| 첫 Escape 화면 | 팝업 숨김, tick36 | 팝업 숨김, tick39 |
| 첫 Escape 뒤 실제 메뉴 종료 | 없음 | 없음 |
| 두 번째 Escape 화면 | 숨김 유지, tick47 | 숨김 유지, tick52 |
| 두 번째 Escape 뒤 실제 메뉴 종료 | WM_EXITMENULOOP 1회 | WM_EXITMENULOOP 1회 |
| 실제 메뉴 루프 구간 | 27.383초 | 25.648초 |
| 해당 구간 Rust 수신 tick/ack | 0/0 | 25/13 |
| 두 번째 관측 marker 뒤 닫기 전 tick/ack | 11/6 | 11/6 |
| 메뉴 종료 → 다음 Rust tick | 11ms | 307ms |
| 창 닫기 요청 → 최종 Exit | 5ms | 5ms |
| 정상 종료 / 자식 audit | true / verified | true / verified |
| 사후 소유 프로세스 잔류 | 0 | 0 |

원본 바이너리 SHA256은 `f81d0cf8d60adb78da743085119c8e79fc20fcd31625fc37a5d6ed22fd7b5384`, 큐 전달은 `97128802034de786bd54555e5b4d8919a7208cfff2eb1c8fca6eb0e404035986`로 이전과 같다. 원본 summary SHA256 `56e421c476ccf038d1762fd445196a9171bfb2ae3ff790f757b7df85ae939be4`, 큐 전달 summary SHA256 `bb992a00613c2d6aeaa78ed886f9455b7e30385e0d6f5b8489a469efaeff711f`. 원본 루트의 `analyze-two-escape.mjs`와 `two-escape-analysis.json`이 전체 snapshot 소스/바이너리 해시, 연속 로그 순번·cap 미도달, marker와 실제 종료 순서, 응답 수, exit0/정상 종료/audit/잔류0을 검증한다. 기존 `check-menu-recovery.mjs`도 두 조건 모두 통과했다.

이 결과로 앞선 **“메뉴가 끝난 뒤에도 영구적으로 응답/종료가 멈춘다”는 해석은 철회한다.** 앞선 실행에서 실제 메뉴 루프가 끝나지 않은 채 닫기를 요청했고 정상 종료 제한시간을 넘긴 사실은 유지한다. 큐 전달이 별도의 종료 결함을 남겼다는 해석도 확정할 수 없다. 원본까지 두 번째 Escape로 복구됐으므로 이번 통과를 큐 전달 수정의 고유 효과로 주장하지 않는다. 큐 전달의 관측 효과는 메뉴 모드 중 양방향 응답 유지다.

한계: 두 실행은 서로 다른 시간의 단회 진단이며 메뉴 유지 시간도 같지 않다. 모두 30초보다 짧고 제품 watchdog/SSH/MCP가 없으므로 실제 Baton의 timeout 또는 기존 N 실패가 해결됐다는 증거가 아니다. 키 down/up과 Escape의 내부 소비 지점을 직접 계측하지 않았으므로 특정 키 해제 버그를 확정하지 않는다. 기존 자동 입력/로그 I/O 영향도 남는다. 큐 전달 실행의 menu-open marker에 tick23을 잘못 기재했으며 실제 화면은27이다. 원본 marker를 덮어쓰지 않고 `menu-open-correction.json`에 정정했고 수치 분석은 해당 tick 전사를 사용하지 않는다.

다음은 최소 앱의 종료 결함 수정을 계속 추가하는 대신, 실제 메뉴 루프 종료를 관측하는 시험 절차와 메뉴 유지 중 제품 heartbeat 정지 문제를 분리하여 검증한다. 제품 후보에 대한 bounded 검증과 변경 범위 검토 전에는 진단 patch를 채택하지 않는다. 제품/fuzz 변경, N/F/M 본시험 재실행 없음. 기존 2시간 실패와 Phase 5 출시 차단 유지.

## 2026-10-23 제품 서비스 경계 검증

증거: `artifacts/phase5-product-menu-20261023`. 기존 `phase5-exit-trace-20261022/source/rust`의 제품 기능/dist에 `phase5-syschar-context-20261023/source/tao`의 로그 계측을 연결했다. 기존 제품 trace 대비 Rust 차이는 Cargo.toml의 Tao path patch와 lock의 해당 source/checksum 제거뿐이다. 큐 전달 개입은 없다. offline/locked release build 통과(43.29초). 앱 SHA256 `bb312a38255deff850509554d15edf968610577529051a282bf7123bfed80d2c`, adapter SHA256 `09823dd5d51cd3b33f286540fe43a03570b3eee81497607a1b5b67336fcb754c`. 세 실행의 WebView receipt 경로 버전은 모두155.0.4283.62다. SSH0/adapter1/CDP0, 별도 데이터 디렉터리와 소유 job을 사용했다. 출시 바이너리의 합격 시험은 아니다.

| 실행 | 실제 메뉴 구간 | 수락 pong | 마지막 pong→timeout | timeout→메뉴 종료 | 메뉴 종료 뒤 상태 | 정상 종료 |
|---|---:|---:|---:|---:|---|---|
| short-menu: Alt+Space | 27.395초 | 0 | 30.054초 | 1.035초 | 20.605초/21표본 offline | exit0·EOF0·audit verified |
| short-control: 중단 실행 | 28.987초 | 0 | 30.063초 | 0.175초 | 107.090초/107표본 offline | 판정 제외 |
| title-long: 제목 표시줄 우클릭 | 62.594초 | 13 | timeout 없음 | 해당 없음 | 19.804초/20표본 online | exit0·EOF0·audit verified |

Alt+Space는 send_flags1, 제목 표시줄은0이었다. 실제 메뉴 종료 뒤 두 Alt+Space 로그에는 `pong.state stopping=true`가 나타나고 수락 pong은 없었다. 완결된 두 실행의 창 닫기 요청→최종 Exit는 각각10ms다. 제목 표시줄 실행은 최초 online 이후 모든 status가 online이었다. **메뉴 루프를 종료하면 앱 자체는 정상 종료할 수 있지만, 이미 발생한 FrontendLost를 자동으로 되돌리지는 않는다.**

`lifecycle.rs`의 소스도 이 순서와 일치한다. 마지막 수락 pong 이후30초에 FrontendLost를 호출하고 stop이 stopping=true를 설정한다. 이후 pong은 stopping이면 거부한다. 기준은 메뉴 진입부터30초가 아니다. 마지막 pong과 메뉴 진입 사이의 시간 때문에 메뉴 구간이30초 미만이어도 제한을 넘는다. 제목 표시줄에서는 더 긴 메뉴 구간에도 응답하므로 메뉴가 오래 열려 있는 것만으로 항상 heartbeat가 멈추는 것도 아니다.

절차 변경: 첫 실행은 짧은 대조로 의도했지만 관측/입력 사이 지연으로 제한을 넘었다(`timing-note.json`). 두 번째도 제한을 넘었고 사용량 중단으로 두 번째 Escape 화면 뒤 최종 marker를 쓰지 못했다. 실행기는 incomplete_menu_observation으로 종료했다. 실제 메뉴 종료 로그는 있으나 정상 종료 판정으로 보정하지 않았다(`interruption-note.json`). 단순 재시도 대신 제목 표시줄 장시간 대조로 입력 경로를 비교했다. **제한 전 제품 Alt+Space 복귀 대조는 아직 미검증**이고 동일 유지 시간으로 통제한 비교도 아니다. 기존 자동 입력/로그 I/O 영향과 SSH0의 한계가 남는다.

`analyze.mjs`/`analysis.json`이 snapshot 전체 소스·앱·실행기·adapter 해시, 로그 연속 순번/cap 미도달, 실제 메뉴 이벤트와 pong/timeout/status 시각, 동일 WebView 경로 버전, 완결 실행 exit/EOF/audit, 세 실행 소유 잔류0을 검증했다. 원시 파일별 해시는 analysis에 보존했다. 완결 Alt+Space summary SHA256 `97309db49ef962d577989ecd962f3a2ed969243a1945b6ca2ac83d281bc8cdbe`, 제목 표시줄 summary SHA256 `e025f2cdf871bded3158e7dd4e8139fea857f025d5750c0cbdda717868e1b98d`.

다음 후보는 동기 Alt+Space 큐 전달을 제품 계측 복사본에만 적용해30초보다 충분히 긴 메뉴 동안 pong/online 유지, 실제 메뉴 종료, 정상 종료 및 제목 표시줄 회귀를 검증하는 것이다. watchdog 연장이나 stopping 자동 해제는 이번 근거로 제안하지 않는다. 제품 patch 채택과 SSH/소유권 포함 N 본시험은 별도 검증이 필요하다. 제품/fuzz 변경 없음, N/F/M 및 기존2시간 실패·출시 차단 유지.
