import { describe, expect, it } from 'vitest';
import {
  decodeShareCode,
  encodeShareCode,
  parsePresetList,
  presetSchema,
} from '../shared/presetSchema';
import type { Preset } from '../shared/types';

const valid = {
  id: 'relay-foo',
  name: 'Foo 中转',
  baseUrl: 'https://foo.example.com/v1',
  protocol: 'openai-chat',
  model: 'foo-model',
  supports: ['codex'],
};

describe('presetSchema', () => {
  it('合法预设通过', () => {
    expect(presetSchema.parse(valid).id).toBe('relay-foo');
  });

  it('非法 id / url / 空 supports 被拒绝', () => {
    expect(() => presetSchema.parse({ ...valid, id: 'Bad Id!' })).toThrow();
    expect(() => presetSchema.parse({ ...valid, baseUrl: 'not-a-url' })).toThrow();
    expect(() => presetSchema.parse({ ...valid, supports: [] })).toThrow();
  });

  it('parsePresetList 去重且后者覆盖', () => {
    const list = parsePresetList([
      { ...valid, name: 'A' },
      { ...valid, name: 'B' },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('B');
  });
});

describe('分享码', () => {
  it('编码 → 解码往返一致，且不带本地字段', () => {
    const preset = { ...valid, userNote: 'secret-note', favorite: true, localRating: 5 } as Preset;
    const decoded = decodeShareCode(encodeShareCode(preset));
    expect(decoded.id).toBe('relay-foo');
    expect(decoded.name).toBe('Foo 中转');
    expect(decoded.userNote).toBeUndefined();
    expect(decoded.favorite).toBeUndefined();
    expect(decoded.localRating).toBeUndefined();
  });

  it('前缀错误 / 内容损坏给出中文错误', () => {
    expect(() => decodeShareCode('hello-world')).toThrow('aibox1:');
    expect(() => decodeShareCode('aibox1:%%%not-base64%%%')).toThrow();
    expect(() => decodeShareCode(`aibox1:${Buffer.from('{"id":1}').toString('base64url')}`)).toThrow('校验失败');
  });
});
