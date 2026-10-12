import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyPresetToTools } from '../electron/ipc/configWriter';

describe('重装 Codex 后配置写入', () => {
  const home = path.join(os.tmpdir(), 'aibox-test-home-' + Date.now());
  beforeAll(() => fs.mkdirSync(home, { recursive: true }));
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  it('写入 ~/.codex/config.toml 并读回一致', () => {
    const preset = {
      id: 'relay-test',
      name: '测试中转',
      baseUrl: 'https://api.example.com/v1',
      protocol: 'openai-chat' as const,
      model: 'gpt-4o-mini',
      supports: ['codex' as const],
    };
    const fakeEnv: Record<string, string> = {};
    const report = applyPresetToTools(preset, ['codex'], 'sk-test-key', {
      homeDir: home,
      setUserEnv: (k, v) => {
        fakeEnv[k] = v;
        return true;
      },
    });
    const cfg = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    expect(cfg).toContain('model_provider');
    expect(cfg).toContain('wire_api');
    expect(fakeEnv.OPENAI_API_KEY).toBe('sk-test-key');
    expect(report.items.filter((i) => i.tool === 'codex' && i.status === 'ok').length).toBeGreaterThan(0);
  });
});
