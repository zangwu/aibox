import * as https from 'node:https';
import { URL } from 'node:url';
import type { Preset, Protocol } from '../../shared/types';

/**
 * 预设连通性测试：用真实 key 对中转站发一次最小请求。
 * 仅 2xx 视为通过；401/403 鉴权失败；其余返回可读原因。
 */

export interface TestResult {
  ok: boolean;
  message: string;
  checkedAt: number;
}

interface RequestOpts {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

function request(opts: RequestOpts): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const doReq = (u: string, redirects = 0) => {
      const parsed = new URL(u);
      const req = https.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: opts.method,
          headers: { 'user-agent': 'aibox-test', 'content-type': 'application/json', ...opts.headers },
          timeout: opts.timeoutMs ?? 20_000,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (redirects > 3) return reject(new Error('重定向过多'));
            return doReq(new URL(res.headers.location, u).href, redirects + 1);
          }
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: body.slice(0, 400) }));
        },
      );
      req.on('timeout', () => req.destroy(new Error('请求超时')));
      req.on('error', reject);
      if (opts.body) req.write(opts.body);
      req.end();
    };
    doReq(opts.url);
  });
}

function describe(status: number, body: string): string {
  if (status === 401 || status === 403) return `鉴权失败（HTTP ${status}），请检查 key 是否有效`;
  if (status === 404) return '端点不存在（HTTP 404），请检查 Base URL';
  if (status === 429) return '触发限流（HTTP 429）';
  if (status >= 500) return `服务端错误（HTTP ${status}）`;
  return `HTTP ${status}${body ? `：${body.slice(0, 120)}` : ''}`;
}

export async function testPresetKey(
  preset: Pick<Preset, 'baseUrl' | 'protocol' | 'model'>,
  apiKey: string,
): Promise<TestResult> {
  const base = preset.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  let attempts: Array<() => Promise<{ status: number; body: string }>> = [];

  if (preset.protocol === 'openai-chat') {
    headers.Authorization = `Bearer ${apiKey}`;
    attempts = [
      () =>
        request({
          method: 'POST',
          url: `${base}/chat/completions`,
          headers,
          body: JSON.stringify({ model: preset.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
        }),
    ];
  } else if (preset.protocol === 'openai-responses') {
    headers.Authorization = `Bearer ${apiKey}`;
    attempts = [
      () =>
        request({
          method: 'POST',
          url: `${base}/responses`,
          headers,
          body: JSON.stringify({ model: preset.model, input: 'hi', max_output_tokens: 16 }),
        }),
    ];
  } else if (preset.protocol === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    const mk = (url: string) => () =>
      request({
        method: 'POST',
        url,
        headers,
        body: JSON.stringify({ model: preset.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
    // 不同中转站对 base 的约定不同：有的已含 /v1/messages，有的需要追加
    attempts = [mk(`${base}/messages`), mk(`${base}/v1/messages`)];
  } else {
    // google：list models 即可鉴权
    attempts = [
      () => request({ method: 'GET', url: `${base}/models?key=${encodeURIComponent(apiKey)}`, headers }),
    ];
  }

  let last: { status: number; body: string } | null = null;
  for (const attempt of attempts) {
    try {
      last = await attempt();
      if (last.status >= 200 && last.status < 300) {
        return { ok: true, message: `连通性测试通过（HTTP ${last.status}）`, checkedAt: Date.now() };
      }
      // 404 时换下一个候选端点；其余状态直接定论
      if (last.status !== 404) {
        return { ok: false, message: describe(last.status, last.body), checkedAt: Date.now() };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 网络层错误（ECONNREFUSED/超时/DNS）→ 换候选；都失败则返回最后一个
      last = { status: 0, body: msg };
    }
  }
  if (last && last.status === 0) {
    return { ok: false, message: `无法连接：${last.body}`, checkedAt: Date.now() };
  }
  return { ok: false, message: last ? describe(last.status, last.body) : '测试失败', checkedAt: Date.now() };
}

export type { Protocol };
