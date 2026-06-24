# Saion Design Tokens

Saion 디자인 토큰을 관리하는 저장소입니다.

## Files

- `tokens/tokens.json`: 디자인 토큰 소스
- `CHANGELOG.md`: `main` 반영 기준 토큰 변경 이력
- `.github/workflows/notify-discord-on-token-update.yml`: 디스코드 알림 및 체인지로그 갱신 워크플로

## Workflow

`main` 브랜치에 `tokens/tokens.json` 변경이 푸시되면 GitHub Actions가 실행됩니다.

- `CHANGELOG.md`를 자동 갱신합니다.
- 디스코드 웹훅으로 변경 알림을 보냅니다.
- 체인지로그는 토큰 경로 기준으로 `Added`, `Changed`, `Removed`를 분류해 기록합니다.
