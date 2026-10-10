import { beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applyPresetToTools,
  codexWireApi,
  detectCodexProviderId,
  parseCodexConfig,
  upsertCodexConfig,
} from '../electron/ipc/configWriter';
import type { Preset, ToolId } from '../shared/types';

const preset: Preset = {
  id: 'relay-test',
  name: '测试中转',
  baseUrl: 'https://relay.example.com/v1',
  protocol: 'openai-chat',
  model: 'test-model',
  supports: ['codex', 'claude-code', 'gemini'],
};

let home: string;
const envWrites: Array<[string, string]> = [];
const fakeSetUserEnv = (k: string, v: string) => envWrites.push([k, v]);

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aibox-test-'));
  envWrites.length = 0;
});

describe('codexWireApi', () => {
  it('openai-chat → chat；openai-responses → responses', () => {
    expect(codexWireApi('openai-chat')).toBe('chat');
    expect(codexWireApi('anthropic')).toBe('chat');
    expect(codexWireApi('openai-responses')).toBe('responses');
  });
});

describe('upsertCodexConfig', () => {
  it('空文件：写入顶层键与 provider 表', () => {
    const { content, providerId } = upsertCodexConfig('', preset);
    expect(providerId).toBe('relay-test');
    const parsed = parseCodexConfig(content, providerId);
    expect(parsed.model).toBe('test-model');
    expect(parsed.model_provider).toBe('relay-test');
    expect(parsed.base_url).toBe('https://relay.example.com/v1');
    expect(parsed.env_key).toBe('OPENAI_API_KEY');
    expect(parsed.wire_api).toBe('chat');
  });

  it('沿用既有 provider id，其余章节原样保留（非破坏性）', () => {
    const existing = [
      'model = "old-model"',
      'model_provider = "custom"',
      'model_reasoning_effort = "high"',
      '',
      '[tui]',
      'screen_reader_detection_done = true',
      '',
      '[model_providers.custom]',
      'name = "旧名字"',
      'base_url = "https://old.example.com/v1"',
      'wire_api = "responses"',
      '',
      '[windows]',
      'sandbox = "elevated"',
      '',
    ].join('\r\n');
    const { content, providerId } = upsertCodexConfig(existing, preset);
    expect(providerId).toBe('custom');
    // 既有内容保留
    expect(content).toContain('model_reasoning_effort = "high"');
    expect(content).toContain('[tui]');
    expect(content).toContain('screen_reader_detection_done = true');
    expect(content).toContain('[windows]');
    expect(content).toContain('sandbox = "elevated"');
    // provider 表被就地替换（不重复出现表头）
    expect(content.match(/\[model_providers\.custom\]/g)).toHaveLength(1);
    expect(content).not.toContain('https://old.example.com/v1');
    // CRLF 保持
    expect(content).toContain('\r\n');
    // 读回校验字段
    const parsed = parseCodexConfig(content, providerId);
    expect(parsed.model).toBe('test-model');
    expect(parsed.model_provider).toBe('custom');
    expect(parsed.base_url).toBe('https://relay.example.com/v1');
    expect(parsed.wire_api).toBe('chat');
    // 其它表的同名字段不污染读回
    expect(parsed.sandbox).toBeUndefined();
  });

  it('model_provider 存在但表缺失时（Codex 重写过的情况），补建表', () => {
    const existing = 'model = "gpt-6.1-sol"\nmodel_provider = "custom"\n\n[tui]\nscreen_reader_detection_done = true\n';
    const { content, providerId } = upsertCodexConfig(existing, preset);
    expect(providerId).toBe('custom');
    expect(content.match(/\[model_providers\.custom\]/g)).toHaveLength(1);
    const parsed = parseCodexConfig(content, providerId);
    expect(parsed.base_url).toBe('https://relay.example.com/v1');
  });
});

describe('detectCodexProviderId', () => {
  it('顶层之前有注释也能取到', () => {
    expect(detectCodexProviderId('# hi\nmodel_provider = "abc"\n[tui]\nx = 1\n')).toBe('abc');
    expect(detectCodexProviderId('')).toBeUndefined();
  });
});

describe('applyPresetToTools → codex', () => {
  it('写入并读回一致；写入用户环境变量；pending-restart', () => {
    const report = applyPresetToTools(preset, ['codex'], 'sk-test-key', {
      homeDir: home,
      setUserEnv: fakeSetUserEnv,
    });
    const cfg = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    expect(cfg).toContain('model = "test-model"');
    expect(cfg).toContain('wire_api = "chat"');
    expect(envWrites).toEqual([
      ['OPENAI_API_KEY', 'sk-test-key'],
      ['OPENAI_BASE_URL', 'https://relay.example.com/v1'],
    ]);
    const codexItems = report.items.filter((i) => i.tool === 'codex');
    expect(codexItems.filter((i) => i.status === 'ok')).toHaveLength(5);
    expect(codexItems.filter((i) => i.status === 'pending-restart')).toHaveLength(2);
  });

  it('重复应用保持 provider id 稳定（历史线程可恢复）', () => {
    applyPresetToTools(preset, ['codex'], 'sk-1', { homeDir: home, setUserEnv: fakeSetUserEnv });
    applyPresetToTools(preset, ['codex'], 'sk-2', { homeDir: home, setUserEnv: fakeSetUserEnv });
    const cfg = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    expect(cfg.match(/\[model_providers\.relay-test\]/g)).toHaveLength(1);
    expect(cfg.match(/^model_provider/gm)).toHaveLength(1);
  });

  it('检测到 auth.json 时产出警告', () => {
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
    const report = applyPresetToTools(preset, ['codex'], 'sk-x', {
      homeDir: home,
      setUserEnv: fakeSetUserEnv,
    });
    expect(report.warnings.some((w) => w.includes('auth.json'))).toBe(true);
  });

  it('重复写入会备份旧文件', () => {
    applyPresetToTools(preset, ['codex'], 'sk-1', { homeDir: home, setUserEnv: fakeSetUserEnv });
    applyPresetToTools(preset, ['codex'], 'sk-2', { homeDir: home, setUserEnv: fakeSetUserEnv });
    expect(fs.existsSync(path.join(home, '.codex', 'config.toml.aibox-backup'))).toBe(true);
  });
});

describe('applyPresetToTools → claude-code', () => {
  it('写入 settings.json 并保留其他字段，双变量鉴权', () => {
    const dir = path.join(home, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'dark', env: { KEEP: '1' } }));
    const report = applyPresetToTools(preset, ['claude-code'], 'sk-claude', {
      homeDir: home,
      setUserEnv: fakeSetUserEnv,
    });
    const readback = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    expect(readback.theme).toBe('dark');
    expect(readback.env.KEEP).toBe('1');
    expect(readback.env.ANTHROPIC_BASE_URL).toBe('https://relay.example.com/v1');
    expect(readback.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-claude');
    expect(readback.env.ANTHROPIC_API_KEY).toBe('sk-claude');
    expect(report.items.filter((i) => i.status === 'ok')).toHaveLength(3);
  });
});

describe('applyPresetToTools → gemini', () => {
  it('google 协议写 GEMINI_API_KEY + GOOGLE_GEMINI_BASE_URL', () => {
    const gp: Preset = { ...preset, protocol: 'google' };
    const report = applyPresetToTools(gp, ['gemini'], 'sk-g', { homeDir: home, setUserEnv: fakeSetUserEnv });
    const readback = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'settings.json'), 'utf8'));
    expect(readback.env.GEMINI_API_KEY).toBe('sk-g');
    expect(readback.env.GOOGLE_GEMINI_BASE_URL).toBe('https://relay.example.com/v1');
    expect(report.items.filter((i) => i.status === 'ok')).toHaveLength(2);
  });

  it('openai 兼容协议写 OPENAI_API_KEY + OPENAI_BASE_URL', () => {
    applyPresetToTools(preset, ['gemini'], 'sk-o', { homeDir: home, setUserEnv: fakeSetUserEnv });
    const readback = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'settings.json'), 'utf8'));
    expect(readback.env.OPENAI_API_KEY).toBe('sk-o');
    expect(readback.env.OPENAI_BASE_URL).toBe('https://relay.example.com/v1');
  });
});

describe('applyPresetToTools → 边界', () => {
  it('预设不支持的工具标记 skipped', () => {
    const p: Preset = { ...preset, supports: ['codex'] };
    const report = applyPresetToTools(p, ['codex', 'gemini'] as ToolId[], 'sk-x', {
      homeDir: home,
      setUserEnv: fakeSetUserEnv,
    });
    expect(report.items.find((i) => i.tool === 'gemini')?.status).toBe('skipped');
  });
});
