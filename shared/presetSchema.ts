import { z } from 'zod';
import type { Preset } from './types';

export const toolIdSchema = z.enum(['codex', 'claude-code', 'gemini']);

export const protocolSchema = z.enum(['anthropic', 'openai-chat', 'openai-responses', 'google']);

export const presetSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-_]*$/, 'id 只允许小写字母/数字/-/_'),
  name: z.string().min(1).max(60),
  baseUrl: z.string().url(),
  protocol: protocolSchema,
  model: z.string().min(1).max(120),
  supports: z.array(toolIdSchema).min(1),
  note: z.string().max(500).optional(),
  riskHint: z.string().max(500).optional(),
  website: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  userNote: z.string().max(1000).optional(),
  savedKey: z.string().max(500).optional(),
  keyVerified: z.boolean().optional(),
  verifiedAt: z.number().optional(),
  favorite: z.boolean().optional(),
  localRating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  builtin: z.boolean().optional(),
});

/** 预设数组校验（内置模板 / 订阅拉取 / 分享码导入共用） */
export const presetListSchema = z.array(presetSchema);

export function parsePreset(data: unknown): Preset {
  return presetSchema.parse(data) as Preset;
}

export function parsePresetList(data: unknown): Preset[] {
  const list = presetListSchema.parse(data);
  // 去重：同 id 后者覆盖前者（订阅更新场景）
  const map = new Map<string, Preset>();
  for (const p of list) map.set(p.id, p);
  return [...map.values()];
}

/** 订阅源格式：{ "presets": Preset[] } */
export const subscriptionPayloadSchema = z.object({
  presets: presetListSchema,
});

const SHARE_PREFIX = 'aibox1:';

/**
 * 分享码编码：aibox1:<base64url(json)>
 * 仅包含可分享字段，不携带用户本地备注/收藏/评分。
 */
export function encodeShareCode(preset: Preset): string {
  const shareable = {
    id: preset.id,
    name: preset.name,
    baseUrl: preset.baseUrl,
    protocol: preset.protocol,
    model: preset.model,
    supports: preset.supports,
    note: preset.note,
    website: preset.website,
  };
  const json = JSON.stringify(shareable);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  return SHARE_PREFIX + b64;
}

/** 解析分享码；失败抛出带中文说明的 Error */
export function decodeShareCode(code: string): Preset {
  const trimmed = code.trim();
  if (!trimmed.startsWith(SHARE_PREFIX)) {
    throw new Error('分享码格式不正确：应以 aibox1: 开头');
  }
  let json: string;
  try {
    json = Buffer.from(trimmed.slice(SHARE_PREFIX.length), 'base64url').toString('utf8');
  } catch {
    throw new Error('分享码解码失败：base64 内容损坏');
  }
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('分享码解码失败：不是合法 JSON');
  }
  try {
    return presetSchema.parse(data) as Preset;
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join('; ') : String(e);
    throw new Error(`分享码预设校验失败：${msg}`);
  }
}
