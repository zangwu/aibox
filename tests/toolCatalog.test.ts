import { describe, expect, it } from 'vitest';
import {
  AGENT_ARGS,
  DESKTOP_TOOL_IDS,
  MANAGED_TOOL_IDS,
  TOOL_CATALOG,
  findTool,
} from '../shared/toolCatalog';
import { computeScore, computeVolume } from '../electron/ipc/heat';

describe('toolCatalog 精品目录', () => {
  it('只保留高热度名单', () => {
    const ids = TOOL_CATALOG.map((t) => t.id).sort();
    expect(ids).toEqual(
      ['claude-code', 'codex', 'deepseek', 'kilo', 'mimo'].sort(),
    );
  });

  it('id 唯一且都是 agent 客户端', () => {
    const ids = TOOL_CATALOG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TOOL_CATALOG) {
      expect(t.cmd || t.desktop, t.id).toBeTruthy();
      expect(AGENT_ARGS[t.id], t.id).toBeTruthy();
    }
  });

  it('受管含 Codex/Claude/DeepSeek', () => {
    expect(MANAGED_TOOL_IDS.sort()).toEqual(['claude-code', 'codex', 'deepseek']);
  });

  it('Kilo / DeepSeek 有桌面形态', () => {
    expect(findTool('kilo')?.desktop?.channel).toBe('vscode');
    expect(findTool('deepseek')?.desktop).toBeTruthy();
    expect(DESKTOP_TOOL_IDS.length).toBeGreaterThanOrEqual(5);
  });
});

describe('热度 volume', () => {
  it('volume 无 100 上限', () => {
    expect(computeVolume(undefined, 450_000, undefined)).toBe(450_000);
    expect(computeScore(80_000, 300_000)).toBe(100);
  });
});
