# Changelog

本文件记录 AI Box 的重要变更。  
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- 研发工作流：阶段 × 功能模块看板、评论迭代、G1–G5 门禁
- DeepSeek Harness 协作：选工作区、完全权限、CDP 发送、`dsh headless`
- 工具面板精简高热度客户端（Codex / Claude / DeepSeek / Kilo / MiMo）

### Changed
- 热度显示公开调用量原始数字（npm 周下载 / Stars / VS Code 安装）
- 预设分享码强制脱敏，不携带 API Key

## [0.2.1] - 2026-10-12

### Added
- 开源仓库结构：README 功能截图、CONTRIBUTING、LICENSE（MIT）
- GitHub Releases 热更新通道（`latest.yml` + 安装包）
- `scripts/ui-smoke*.py` 与研发工作流数据落盘到项目 `.aibox/`

### Fixed
- Windows 下 `npm.cmd` / `code.cmd` 直接 spawn 导致 `EINVAL`
- 卸载 CLI 前先结束进程，避免文件占用导致卸载失败
- 工作区切换未校验导致 Harness 写错目录

### Changed
- 仅展示真实存在的桌面 / CLI 形态；卡片按热度排序
- 去掉与「禅道」无关的表述

## [0.2.0] - 2026-10-11

### Added
- 工具检测、预设写入、安装启动、Agent 会话、浏览器页签
- 基础自动化更新（electron-updater）

[Unreleased]: https://github.com/zangwu/aibox/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/zangwu/aibox/releases/tag/v0.2.1
[0.2.0]: https://github.com/zangwu/aibox/releases/tag/v0.2.0
