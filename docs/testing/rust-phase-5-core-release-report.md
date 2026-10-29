# Rust Phase 5: 릴리스 모형·경쟁 조건 검증

실행 2026-10-13, 결과 회수·검토 2026-10-14 KST. 기준 `5ae72b5`와 아래 시험 변경. **10,000시드 × 500이벤트 모형 검증과 경쟁 조건 17개 × 100회가 통과했다.** 승인된 검증 설계 §3의 릴리스 모형·고정 장벽 반복 항목을 완료한다. 전체 Phase 5나 제품 배포 승인은 아니다.

## 변경과 대상

기존 core 모형 시험의 반복 횟수만 helper 인자로 추출했다. 기본 `model_1000_seeds_200_events`와 1,000×200 예산·출력 형식은 유지했다. `release-verification` feature를 명시하면 `model_release_10000_seeds_500_events`가 추가된다. 해당 feature는 시험 포함 여부에만 사용하며 제품 동작은 바꾸지 않는다.

기존 독립 참조 모델, 관측값 전체 비교, 이벤트 종류·거부 경로 coverage assertions, 큐·버퍼 상한, 실패 seed·최소화 이벤트열 출력을 그대로 사용했다. 기존 race 코드와 동기화 장벽도 수정하지 않았다. 제품 버그 수정이 아니므로 새 RED 재현을 주장하지 않는다.

Windows x64, Rust/Cargo stable 1.88, `CARGO_INCREMENTAL=0`, Cargo release 최적화 빌드로 실행했다. 증거는 `artifacts/phase5-core-release-20261013/`에 있다. source.json의 Cargo/lock/core 소스·시험 36개 파일 해시를 실행 후 대조해 일치함을 확인했다. 초기 source 목록은 첫 core 실행 시작 후 수집했고, 그 구간에 소스를 수정하지 않았다. 완전한 빌드 전/후 자동 snapshot runner를 사용한 것은 아니다.

## 결과

| 항목 | 관측 |
|---|---|
| release core 전체 suite | **105 pass, 0 fail, 0 ignored**, `core-release.log` |
| 기본 모형 시험 | 1,000시드, 200,000이벤트 통과 |
| 릴리스 모형 시험 | seed 0~9,999, 각 500개, 총 **5,000,000이벤트** 일치 |
| 릴리스 모형의 성공/거부 관측 | 성공 1,362,715 / 거부 3,637,285; 합계 5,000,000 |
| 전환 중 상태 관측 | 48,869건; 이벤트와 별도의 상태 관측 수 |
| 주요 거부 경로 | 오래된 epoch 읽기 358, 오래된 stream 읽기 327, 오래된 view resize 93,890 |
| 경쟁 조건 suite | **17개 × 100회 = 1,700개 사례 실행**, 모든 회차 exit 0·실패/skip/filter 0 |
| fmt / core all-targets clippy | exit 0, clippy `-D warnings` |
| 독립 변경 검토 | 기본 예산·오라클·최소화 보존 확인, 수정 필요 지적 없음 |

race 반복은 2026-10-13 20:10:43~20:11:12 KST에 실행됐다. `race-summary.json`의 100개 결과와 각 `races-N.log`의 17개 통과를 대조했다. 전체 core suite에서 실행한 race 1회는 이 100회에 포함하지 않았다. 실행기는 실패하면 즉시 중단하도록 작성했고 실패 재시도로 통과시킨 회차는 없다.

기존 race suite에는 다음 고정 순서 관측이 포함된다.

- 쓰기 시작을 확인한 뒤 미전송 항목을 추가하고 회수: 기존 쓰기만 완료, 대기 입력은 전송되지 않음.
- 입력 호출의 첫 poll 뒤 회수를 먼저 처리: transport 송신 0회.
- 쓰기가 정체된 상태의 회수·종료: 가상 시간 5초 경계에서 닫힘과 transport drop, 종료가 새 5초 기한을 추가하지 않음.
- 대기 읽기와 회수·재전달: 옛 epoch 거부와 비공개 출력 비노출.
- 실제 2-worker async runtime의 쓰기 중 회수, 불확실한 쓰기 결과의 자동 재전송 없음.

## 재현 명령

```text
cargo +stable test --manifest-path rust/Cargo.toml --offline --locked --release -p baton-core --all-targets --features release-verification -- --nocapture
cargo +stable test --manifest-path rust/Cargo.toml --offline --locked --release -p baton-core --test races --features release-verification -- --nocapture
```

두 번째 명령을 `run-races.ps1`이 100회 실행하고 매 회차 로그·종료 코드·시간을 보존했다. 별도 새 실행에서는 기존 증거 폴더를 재사용하지 않는다. 이번 재개에서는 완료된 시험을 다시 실행하지 않고 결과·소스 일치만 확인했다.

## 범위와 다음 항목

고정 prefix와 기존 상태·입력 분포를 재사용한 결정적 모형 시험이다. 500만 이벤트가 모두 고유하거나 모든 상태·스케줄을 포함한다는 뜻은 아니다. race의 대부분은 가상 시간과 제어된 transport이며 실제 SSH·OS 프로세스 종료 시험을 대신하지 않는다.

독립 리뷰 최초 시도는 사용량 한도로 검토 전에 실패했고, 2026-10-14 재개 뒤 같은 범위 검토를 완료했다. 리뷰어가 시험을 별도로 반복하지는 않았다.

별도로 남은 항목은 4개 입력면 각 30분 퍼징, 2시간 부하, 전체 앱/어댑터/SSH 프로세스 수명 100회, 실제 Windows 환경·물리 IME/DPI·다른 사용자 경계 및 하네스 최종 수용 판단이다. 미해결 초기화 실패 출시 차단도 유지한다. 다음 자동 검증 대상은 4개 입력면의 퍼징 준비·실행이다.
