import { contextBridge, ipcRenderer } from 'electron';
import type { AiboxApi, Preset, ToolId } from '../shared/types';

/** 渲染进程唯一入口：window.aibox */
const api: AiboxApi = {
  detectTools: (force?: boolean) => ipcRenderer.invoke('tools:detect', force),
  listPresets: () => ipcRenderer.invoke('presets:list'),
  savePreset: (preset: Preset) => ipcRenderer.invoke('presets:save', preset),
  removePreset: (id: string) => ipcRenderer.invoke('presets:remove', id),
  importShareCode: (code: string) => ipcRenderer.invoke('presets:importShare', code),
  testPresetKey: (preset, apiKey) => ipcRenderer.invoke('presets:testKey', preset, apiKey),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  addSubscription: (url: string) => ipcRenderer.invoke('presets:addSubscription', url),
  toggleSubscription: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('presets:toggleSubscription', id, enabled),
  removeSubscription: (id: string) => ipcRenderer.invoke('presets:removeSubscription', id),
  applyPreset: (presetId: string, tools: ToolId[], apiKey: string) =>
    ipcRenderer.invoke('apply:apply', presetId, tools, apiKey),
  installCli: (tool: ToolId) => ipcRenderer.invoke('installer:installCli', tool),
  uninstallCli: (tool: string) => ipcRenderer.invoke('installer:uninstallCli', tool),
  onInstallProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p as Parameters<typeof cb>[0]);
    ipcRenderer.on('installer:progress', listener);
    return () => ipcRenderer.removeListener('installer:progress', listener);
  },
  launch: (tool: ToolId, kind: 'cli' | 'desktop') => ipcRenderer.invoke('launcher:launch', tool, kind),
  restartTool: (tool: ToolId) => ipcRenderer.invoke('launcher:restart', tool),
  openStorePage: (tool: ToolId) => ipcRenderer.invoke('launcher:openStorePage', tool),
  broadcastEnvChange: () => ipcRenderer.invoke('env:broadcast'),
  getPortableNodeStatus: () => ipcRenderer.invoke('installer:portableStatus'),
  setupPortableNode: () => ipcRenderer.invoke('installer:setupPortableNode'),
  getLogs: () => ipcRenderer.invoke('logs:get'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  checkUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, s: unknown) => cb(s as Parameters<typeof cb>[0]);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
  refreshHeat: () => ipcRenderer.invoke('heat:refresh'),
  toggleToolFavorite: (id: string) => ipcRenderer.invoke('tools:toggleFavorite', id),
  workflowListProjects: () => ipcRenderer.invoke('workflow:listProjects'),
  workflowCreateProject: (input: unknown) => ipcRenderer.invoke('workflow:createProject', input),
  workflowUpdateProject: (id: string, patch: unknown) => ipcRenderer.invoke('workflow:updateProject', id, patch),
  workflowUpsertModule: (projectId: string, mod: unknown) => ipcRenderer.invoke('workflow:upsertModule', projectId, mod),
  workflowListItems: (projectId?: string) => ipcRenderer.invoke('workflow:listItems', projectId),
  workflowGetItem: (id: string) => ipcRenderer.invoke('workflow:getItem', id),
  workflowCreateItem: (input: unknown) => ipcRenderer.invoke('workflow:createItem', input),
  workflowTransition: (id: string, to: string, phase?: string) => ipcRenderer.invoke('workflow:transition', id, to, phase),
  workflowAddComment: (id: string, body: string, kind?: string, author?: string) =>
    ipcRenderer.invoke('workflow:addComment', id, body, kind, author),
  workflowSetGate: (id: string, gate: string, ok: boolean, note?: string) =>
    ipcRenderer.invoke('workflow:setGate', id, gate, ok, note),
  workflowConfirmBaseline: (projectId: string, title: string, bodyMd: string) =>
    ipcRenderer.invoke('workflow:confirmBaseline', projectId, title, bodyMd),
  workflowListBaselines: (projectId: string) => ipcRenderer.invoke('workflow:listBaselines', projectId),
  workflowAcquireLock: (projectId: string, itemId: string) => ipcRenderer.invoke('workflow:acquireLock', projectId, itemId),
  workflowReleaseLock: (projectId: string, itemId: string) => ipcRenderer.invoke('workflow:releaseLock', projectId, itemId),
  workflowGetLock: (projectId: string) => ipcRenderer.invoke('workflow:getLock', projectId),
  workflowWriteBrief: (repoPath: string, itemId: string) => ipcRenderer.invoke('workflow:writeBrief', repoPath, itemId),
  workflowLaunchHarness: (workspacePath: string) => ipcRenderer.invoke('workflow:launchHarness', workspacePath),
  workflowSendHarness: (itemId: string) => ipcRenderer.invoke('workflow:sendHarness', itemId),
  workflowOpenFolder: (folder: string) => ipcRenderer.invoke('workflow:openFolder', folder),
  workflowHarnessHeadless: (itemId: string) => ipcRenderer.invoke('workflow:harnessHeadless', itemId),
  agentStart: (tool: ToolId, prompt: string, cwd?: string, hasHistory?: boolean) =>
    ipcRenderer.invoke('agent:start', tool, prompt, cwd, Boolean(hasHistory)),
  agentStop: (tool: ToolId) => ipcRenderer.invoke('agent:stop', tool),
  loadChats: (tool: ToolId) => ipcRenderer.invoke('chats:load', tool),
  saveChats: (tool: ToolId, turns: Array<{ role: 'user' | 'agent'; text: string }>) =>
    ipcRenderer.invoke('chats:save', tool, turns),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  onAgentOutput: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p as Parameters<typeof cb>[0]);
    ipcRenderer.on('agent:output', listener);
    return () => ipcRenderer.removeListener('agent:output', listener);
  },
  onAgentEnd: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p as Parameters<typeof cb>[0]);
    ipcRenderer.on('agent:end', listener);
    return () => ipcRenderer.removeListener('agent:end', listener);
  },
  getMeta: () => ipcRenderer.invoke('meta:get'),
};

contextBridge.exposeInMainWorld('aibox', api);
