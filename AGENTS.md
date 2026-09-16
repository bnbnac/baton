# Repository rules

- PR은 squash merge로 병합한다. GitHub 저장소에서는 squash만 허용한다.
- Force push를 금지한다. `--force`, `--force-with-lease`, `+refspec` 등으로 원격 이력을 덮어쓰지 않는다. 이미 push한 변경의 수정은 새 커밋으로 추가한다.
- PR 병합 후 작업 브랜치를 삭제한다. GitHub의 원격 head 브랜치 자동 삭제를 사용하며, `main`은 삭제하지 않는다. 로컬 브랜치는 병합 완료와 미반영 작업이 없음을 확인한 뒤 정리한다.

## Enforcement status

2026-09-16: squash-only와 머지 후 원격 브랜치 자동 삭제는 GitHub 설정에 적용했다. 현재 비공개 저장소 요금제에서는 ruleset/branch protection API가 403으로 거부되어 force push의 서버 강제 차단은 적용하지 못했다. 위 금지 규칙은 작업 지침이며 서버 보호가 활성화됐다는 뜻이 아니다. 요금제가 지원하면 모든 브랜치의 non-fast-forward push를 차단하는 규칙을 적용하고 확인한다.
