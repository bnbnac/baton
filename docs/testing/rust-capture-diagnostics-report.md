# 제품 터미널 글자 획 누락: 캡처 경로 비교

2026-10-11 KST. **같은 제품 WebView의 직접 캡처에는 글자 획이 온전했고, Windows 창 캡처에는 누락됐다. 제품 렌더러 결함이라는 판단을 내릴 근거가 없어 제품 변경 없이 이번 의심을 해소한다.** 모든 DPI·IME·글꼴 인수를 완료했다는 뜻은 아니다.

[제품 UI smoke](rust-phase-5-product-ui-report.md)의 작은 터미널 글자에서 획이 빠지는 현상이 발견됐다. SSH/MCP 문자열은 정상이었으므로 인코딩 오류로 단정하지 않았다. 제품 CSS와 xterm 초기화를 확인한 뒤 동일 화면을 서로 다른 경로에서 관측했다.

격리된 `baton-normal` 시험 프로세스에만 WebView 원격 디버깅 포트를 부여했다. `127.0.0.1:56667`의 대상 중 URL이 `http://tauri.localhost/`인 페이지 하나만 선택해 CDP `Page.captureScreenshot`과 읽기 전용 DOM/스타일 조회를 수행했다. 제품 소스·글꼴·DOM·렌더링 옵션을 변경하지 않았고, 이후 수명 비교 실행에는 디버깅 옵션을 넣지 않았다. 실제 사용자 WebView 데이터나 브라우저 세션에는 접근하지 않았다.

| 관측 | 결과 |
|---|---|
| [WebView 직접 캡처](../../artifacts/phase5-life03-20261011/webview-direct.png) | 1770×1230, 작은 terminal 글자가 온전함 |
| [Windows 창 캡처](../../artifacts/phase5-life03-20261011/window-capture.png) | 1183×851, 제목 표시줄 포함, 같은 글자의 일부 획이 누락됨 |
| [DOM/배율 정보](../../artifacts/phase5-life03-20261011/render-metrics.json) | viewport 1180×820 CSS px, devicePixelRatio 1.5, xterm 행 높이 15.3125px |
| DOM 문자열 | OpenSSH 환영 문구와 일치 |

두 캡처의 고정된 터미널 영역을 비교했다. 직접 캡처를 CSS 크기로 줄였을 때 nearest 방식의 평균 절대 오차는 5.27, bilinear 9.51, bicubic 8.94, Lanczos 9.20이었다([계산 결과](../../artifacts/phase5-life03-20261011/capture-comparison.json)). 이는 축소·샘플링 경로에서 얇은 획이 빠진다는 설명과 맞지만, 캡처 도구 내부의 정확한 보간 알고리즘을 증명하는 수치는 아니다.

따라서 이 축소된 Windows 캡처만 보고 xterm 글꼴·행간을 수정하거나 화면 표시 회귀로 처리하지 않는다. 향후 작은 글자 품질 판정에는 원본 물리 픽셀 캡처를 함께 사용한다. 현재 관측은 150% 환경에서 영어·한국어 UI와 영어 터미널을 비교한 것이며, 물리 IME 또는 100/150/200% 전환 인수의 대체 증거로 확대하지 않는다. 시험 종료 후 디버깅 포트의 리스너가 없음을 확인했다.
