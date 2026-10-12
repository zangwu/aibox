import { describe, expect, it } from 'vitest';
import { detectCatalog } from '../electron/ipc/tools';

describe('detectCatalog 本机实测', () => {
  it('能检出已装 CLI 与桌面/插件形态', async () => {
    const cards = await detectCatalog({}, { force: true });
    const by = (id: string) => cards.find((c) => c.id === id)!;

    const codex = by('codex');
    expect(codex.installed).toBe(true);
    expect(codex.path).toMatch(/codex/i);
    expect(codex.desktop?.available).toBe(true);

    const kilo = by('kilo');
    expect(kilo.desktop?.available).toBe(true);
    if (kilo.desktop?.vscodeInstalled) {
      expect(kilo.desktop.installed).toBe(true);
    }

    const deepseek = by('deepseek');
    expect(deepseek.desktop?.available).toBe(true);
    expect(deepseek.agent).toBe(true);
  }, 60_000);
});
