/**
 * 共享类型：渲染进程 / 主进程 / 单测共用。
 * 注意：本文件及 shared/ 下所有模块不得 import electron，保证可在 vitest 中直接运行。
 */

export type ToolId = 'codex' | 'claude-code' | 'gemini';

export type Protocol = 'anthropic' | 'openai-chat' | 'openai-responses' | 'google';

/** 配置写入校验单项状态 */
export type VerifyStatus = 'ok' | 'pending-restart' | 'error' | 'skipped';

export interface Preset {
  /** 唯一 id，如 "relay-deepseek" */
  id: string;
  /** 显示名 */
  name: string;
  /** API base url，含 /v1（google 协议除外） */
  baseUrl: string;
  /** 协议类型 */
  protocol: Protocol;
  /**
   * 默认模型 id（如 "deepseek-chat"）。
   * 计划 v1 类型遗漏此字段，但 Codex config.toml 的 model 写入必需，故补充。
   */
  model: string;
  /** 支持的工具 */
  supports: ToolId[];
  /** 官方备注（如“需 Responses API”） */
  note?: string;
  /** 风险提示文案（内置预设必填） */
  riskHint?: string;
  website?: string;
  /** 本地用户备注 */
  userNote?: string;
  /** 本机保存的 key（仅存本机，绝不进入分享码） */
  savedKey?: string;
  /** key 已通过连通性测试 */
  keyVerified?: boolean;
  /** 最近验证时间 */
  verifiedAt?: number;
  /** 本地收藏 */
  favorite?: boolean;
  /** 本地星级（仅存本机） */
  localRating?: 1 | 2 | 3 | 4 | 5;
  /** 内置标记：内置预设不可删除/编辑，只能收藏、备注、评分 */
  builtin?: boolean;
}

export interface CliInfo {
  installed: boolean;
  path?: string;
  version?: string;
}

export interface DesktopInfo {
  installed: boolean;
  path?: string;
  /** 微软商店包 FamilyName（如 Codex 桌面版） */
  packageFamilyName?: string;
}

export interface ToolInfo {
  id: ToolId;
  name: string;
  cli: CliInfo;
  desktop: DesktopInfo;
  /** npm 全局包名（安装器用） */
  npmPackage: string;
}

export interface ApplyReportItem {
  tool: ToolId;
  /** 写入目标，如 ~/.codex/config.toml */
  target: string;
  field: string;
  status: VerifyStatus;
  /** 人类可读说明 */
  detail: string;
}

export interface ApplyReport {
  presetId: string;
  presetName: string;
  appliedAt: number;
  items: ApplyReportItem[];
  /** 非致命提醒，如检测到 ~/.codex/auth.json 需删除 */
  warnings: string[];
}

export interface Subscription {
  id: string;
  url: string;
  enabled: boolean;
  lastFetchedAt?: number;
  lastError?: string;
}

/** 内置预设的本地覆盖层：收藏/备注/评分/已存 key 按 id 挂接，不复制预设本体 */
export interface PresetLocalOverrides {
  userNote?: string;
  favorite?: boolean;
  localRating?: 1 | 2 | 3 | 4 | 5;
  savedKey?: string;
  keyVerified?: boolean;
  verifiedAt?: number;
}

/** 盒子自身持久化数据（%APPDATA%/aibox/config.json） */
export interface BoxConfig {
  schemaVersion: 1;
  presets: Preset[];
  /** 内置预设 id → 本地字段覆盖 */
  presetOverrides: Record<string, PresetLocalOverrides>;
  subscriptions: Subscription[];
  lastApply: Partial<Record<ToolId, ApplyReport>>;
  portableNode?: { version: string; path: string; downloadedAt: number };
}

export type InstallStage =
  | 'check-node'
  | 'download-node'
  | 'extract-node'
  | 'npm-install'
  | 'verify'
  | 'done'
  | 'error';

export interface InstallProgress {
  tool: ToolId;
  stage: InstallStage;
  percent?: number;
  message: string;
}

/** 自动更新状态（推送） */
export interface UpdaterStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
  version: string;
  latestVersion?: string;
  percent?: number;
  message?: string;
}

/** preload 暴露给渲染进程的 API（window.aibox） */
export interface AiboxApi {
  detectTools(): Promise<ToolInfo[]>;
  listPresets(): Promise<Preset[]>;
  savePreset(preset: Preset): Promise<Preset[]>;
  removePreset(id: string): Promise<Preset[]>;
  importShareCode(code: string): Promise<Preset[]>;
  /** 预设连通性测试（用真实 key 发一次最小请求） */
  testPresetKey(
    preset: Pick<Preset, 'baseUrl' | 'protocol' | 'model'>,
    apiKey: string,
  ): Promise<{ ok: boolean; message: string }>;
  /** 系统浏览器打开外链 */
  openExternal(url: string): Promise<{ ok: boolean; message: string }>;
  addSubscription(url: string): Promise<Preset[]>;
  toggleSubscription(id: string, enabled: boolean): Promise<Preset[]>;
  removeSubscription(id: string): Promise<Preset[]>;
  applyPreset(presetId: string, tools: ToolId[], apiKey: string): Promise<ApplyReport>;
  installCli(tool: ToolId): Promise<{ ok: boolean; message: string }>;
  onInstallProgress(cb: (p: InstallProgress) => void): () => void;
  launch(tool: ToolId, kind: 'cli' | 'desktop'): Promise<{ ok: boolean; message: string }>;
  /** 关闭并重启工具（配置写入后一键生效） */
  restartTool(tool: ToolId): Promise<{ ok: boolean; message: string }>;
  openStorePage(tool: ToolId): Promise<{ ok: boolean; message: string }>;
  broadcastEnvChange(): Promise<{ ok: boolean; message: string }>;
  getPortableNodeStatus(): Promise<{ installed: boolean; version?: string; path?: string }>;
  setupPortableNode(): Promise<{ ok: boolean; message: string }>;
  getLogs(): Promise<string[]>;
  getAppInfo(): Promise<{ version: string; isPackaged: boolean }>;
  checkUpdates(): Promise<{ ok: boolean; message: string }>;
  installUpdate(): Promise<{ ok: boolean; message: string }>;
  onUpdaterStatus(cb: (s: UpdaterStatus) => void): () => void;
  getMeta(): Promise<{
    lastApply: Partial<Record<ToolId, ApplyReport>>;
    subscriptions: Subscription[];
    portableNode: { installed: boolean; version?: string; path?: string };
  }>;
}
