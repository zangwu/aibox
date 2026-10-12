import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { deepResolve } from '../electron/ipc/tools';

const FIX = path.join(process.cwd(), '_nonstd', 'bin');
const CUSTOM_CMD = path.join(FIX, 'mycodex.cmd');

describe('非标准安装路径检测', () => {
  beforeAll(() => {
    fs.mkdirSync(FIX, { recursive: true });
    if (!fs.existsSync(CUSTOM_CMD)) fs.writeFileSync(CUSTOM_CMD, '@echo off\r\necho fake\r\n');
  });

  it('PATH 没有时 extraDirs 也能命中', async () => {
    // 故意找一个只存在于 FIX 的名字
    const hit = await deepResolve('mycodex', [FIX]);
    expect(hit).toBeTruthy();
    expect(hit!.toLowerCase()).toContain('mycodex');
  });

  it('完全不存在的命令返回 undefined', async () => {
    const hit = await deepResolve('definitely-not-a-tool-xyz', [FIX]);
    expect(hit).toBeUndefined();
  });

  it('标准 PATH 中的 codex 可被解析（若已安装）', async () => {
    const hit = await deepResolve('codex', []);
    // 测试环境可能未装，这里只验证不抛错
    if (hit) expect(hit.toLowerCase()).toContain('codex');
  });
});
