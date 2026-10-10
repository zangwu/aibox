import type { AiboxApi } from '../../shared/types';

declare global {
  interface Window {
    aibox: AiboxApi;
  }
}

/** 渲染进程统一 IPC 入口；纯浏览器预览时给出可读错误 */
export function aibox(): AiboxApi {
  if (!window.aibox) {
    throw new Error('window.aibox 不可用：请通过 npm run dev 在 Electron 中运行');
  }
  return window.aibox;
}

export type { Preset, ToolId, ToolInfo, ApplyReport, ApplyReportItem, Subscription, InstallProgress, UpdaterStatus } from '../../shared/types';
export { encodeShareCode } from '../../shared/presetSchema';
