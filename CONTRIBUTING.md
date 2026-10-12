# 贡献指南

## 分支模型（GitHub Flow + develop）

| 分支 | 用途 |
|------|------|
| `main` | 稳定可发布；对应 GitHub Release |
| `develop` | 日常集成，优先合入 |
| `feature/*` | 功能开发，完成后开 PR → `develop` |
| `fix/*` | 缺陷修复，可直合 `main`（hotfix）并同步 `develop` |

```text
feature/xxx  ──PR──►  develop  ──PR──►  main  ──tag──►  Release
```

## 开发流程

1. 从 `develop` 拉分支：`git checkout -b feature/你的功能 develop`
2. 自检：`npm test` + `npm run typecheck`
3. 改 UI 建议打包后跑 `python scripts/ui-smoke-full.py`
4. PR 说明：动机 / 改动 / 验证方式

## 禁止提交

- API Key、`config.json`、个人中转站地址
- `release/`、`local-data/`、`test-wf-*/`、`.playwright-cli/`

## 发版

1. `package.json` 升版本
2. `npm run dist`
3. 合入 `main`，打 tag `vX.Y.Z`
4. GitHub Release 上传 `aibox-setup.exe` + `latest.yml`（热更新）
