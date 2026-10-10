import { contextBridge, ipcRenderer } from 'electron';
import type { AiboxApi, Preset, ToolId } from '../shared/types';

/** 渲染进程唯一入口：window.aibox */
const api: AiboxApi = {
  detectTools: () => ipcRenderer.invoke('tools:detect'),
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
  getMeta: () => ipcRenderer.invoke('meta:get'),
};

contextBridge.exposeInMainWorld('aibox', api);
