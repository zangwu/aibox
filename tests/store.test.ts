import { beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** 内置预设收藏/备注必须走覆盖层，绝不能复制副本（历史 bug 回归测试） */
describe('store 覆盖层', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aibox-store-'));
    process.env.AIBOX_DATA_DIR = dir;
  });

  it('内置预设加收藏不产生副本，且覆盖层可读回', async () => {
    const store = await import('../electron/store');
    const presets = await import('../electron/ipc/presets');

    const before = store.allPresets().filter((p) => p.id.startsWith('openrouter'));
    expect(before).toHaveLength(1);
    expect(before[0].builtin).toBe(true);

    // 模拟卡片点击收藏：builtin 预设整体回传保存
    const target = before[0];
    const after = presets.saveUserPreset({ ...target, favorite: true });
    const openrouters = after.filter((p) => p.id.startsWith('openrouter'));
    expect(openrouters).toHaveLength(1);
    expect(openrouters[0].favorite).toBe(true);
    expect(openrouters[0].builtin).toBe(true);

    // 评分与备注同样不产生副本
    const after2 = presets.saveUserPreset({ ...openrouters[0], localRating: 4, userNote: '快' });
    expect(after2.filter((p) => p.id.startsWith('openrouter'))).toHaveLength(1);
    expect(after2.find((p) => p.id === 'openrouter')?.localRating).toBe(4);
    expect(after2.find((p) => p.id === 'openrouter')?.userNote).toBe('快');

    // 持久化验证（重载缓存后仍在）
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    expect(raw.presets.filter((p: { id: string }) => p.id.startsWith('openrouter'))).toHaveLength(0);
    expect(raw.presetOverrides.openrouter.favorite).toBe(true);
  });

  it('用户预设正常增删改', async () => {
    const presets = await import('../electron/ipc/presets');
    const userPreset = {
      id: 'my-relay',
      name: '我的中转',
      baseUrl: 'https://x.example.com/v1',
      protocol: 'openai-chat' as const,
      model: 'm1',
      supports: ['codex' as const],
    };
    let list = presets.saveUserPreset(userPreset);
    expect(list.find((p) => p.id === 'my-relay')?.builtin).toBe(false);
    list = presets.saveUserPreset({ ...userPreset, favorite: true });
    expect(list.filter((p) => p.id === 'my-relay')).toHaveLength(1);
    expect(list.find((p) => p.id === 'my-relay')?.favorite).toBe(true);
  });
});
