# AI Box

本地 **AI 客户端管理盒子**：聚合中转站预设、一键写入 Codex / Claude / DeepSeek 配置，内置研发工作流并可对接 DeepSeek Harness。

> 单机运行 · 配置只写本机 · 预设分享码 **不含 API Key**

---

## 功能

| 模块 | 说明 |
|------|------|
| **工具面板** | Codex / Claude / DeepSeek Harness / Kilo / MiMo：安装检测、启动、卸载、热度 |
| **预设市场** | 中转站预设管理、连通性测试、收藏/备注；**分享码自动脱敏 key** |
| **研发工作流** | 需求/任务/测试、阶段×功能模块看板、评论迭代、G1–G5 门禁 |
| **Harness 协作** | 一键发送到 DeepSeek 桌面端（选工作区→完全权限→发送）或 `dsh headless` 全自动 |
| **热更新** | electron-updater，从 GitHub Releases 拉 `latest.yml` |

---

## 安装

### Windows（推荐）

1. 到 [Releases](../../releases) 下载 `aibox-setup.exe`
2. 安装后运行「AI Box」
3. 初次使用：工具面板「刷新热度」→ 预设市场填好 key

### 从源码构建

```bash
git clone <本仓库>
cd aibox
npm install
npm run dist          # 产出 release/aibox-setup.exe 与 win-unpacked
```

开发模式：

```bash
npm run dev           # Vite + Electron
```

测试：

```bash
npm test              # vitest
npm run typecheck
python scripts/ui-smoke-full.py   # 需先启动打包版并开调试端口
```

---

## 预设与密钥

- 本地保存在 `%APPDATA%\aibox\config.json`（**勿提交仓库**）
- **分享码 `aibox1:` 只含 baseUrl/协议/模型，不含 savedKey**
- 自建中转站（如个人域名）请只留在本机预设，不要写进文档示例里的真实 key

示例（仅结构）：

```json
{
  "name": "我的中转",
  "baseUrl": "https://api.example.com/v1",
  "protocol": "openai-chat",
  "model": "gpt-4o-mini",
  "supports": ["codex", "deepseek"]
}
```

---

## 研发工作流（简）

1. **研发 → 新建项目**（会创建本地目录与 `.aibox/workflow.json`）
2. **新建工作项**（阶段/模块/验收）
3. **确认需求文档（G1）** 后可发给 Harness
4. 详情里：
   - **生成简报** — 写入 `.dsh-inbox/`
   - **发送到 Harness** — 选工作区 + 完全权限 + 自动发送（需桌面端与 CDP）
   - **全自动执行** — `dsh headless`（注入预设里 DeepSeek 的 key）
5. 人审 **通过 / 不通过**（G5）

项目数据在项目目录下，便于备份：

```text
<你的项目>/
  README.md
  .aibox/workflow.json
  .dsh-inbox/   .dsh-outbox/
```

### DeepSeek Harness 全自动

- 桌面协作：发送链会切工作区并尝试「完全权限」
- Headless：`resources/runtime/cli/bin/dsh.cmd headless "<任务>"`
- API Key 从 **预设市场中 DeepSeek 相关预设的 savedKey** 自动注入（`DEEPSEEK_API_KEY`）

---

## 热更新

- 渠道：`generic` + GitHub Releases 附件 `latest.yml`
- 配置：`electron-builder.config.cjs` 的 `publish.url`
- 设置页「检查更新」→ 下载后点安装

发版步骤：

```bash
npm run dist
# 将 release/aibox-setup.exe 与 latest.yml 上传到 GitHub Release
```

---

## 目录结构

```text
electron/          主进程 / preload / IPC
src/               渲染层（工具、预设、研发、设置…）
shared/            类型、工具目录、预设 schema（无 electron 依赖）
scripts/           构建、UI 冒烟、Harness CDP 脚本
tests/             vitest
docs/              设计文档（工作流 v3 等）
```

---

## 隐私与安全

- 不上传预设 key、备注、评分
- 工作流数据默认写在 **你的项目目录**
- 自动更新仅从配置的 Release 地址拉包
- 建议：Fork 后自行修改 `publish` 与 `appId` 再发布

---

## License

MIT（见 `LICENSE`）

---

## 贡献

Issue / PR 均欢迎。改 UI 后请跑 `npm test` + `npm run typecheck`。
