/**
 * 直连被 CORS 挡住时的同源中转兜底。
 *
 * 实机现象（Google AI Studio 的 Build 部署出来的中转）：
 *
 *   获取模型列表失败：
 *   https://cola.amily49.cc/v1/models -> Failed to fetch
 *   https://cola.amily49.cc/models -> Failed to fetch
 *
 * 实测那个域名对所有响应都不带 `Access-Control-Allow-Origin`，`OPTIONS` 预检直接回 401。
 * 浏览器因此连状态码都拿不到，只能抛 `TypeError: Failed to fetch`——换 Key、换模型名都没用。
 * SillyTavern 能连是因为它有自己的 Node 后端转发。
 *
 * 兜底规则：只在**网络层**失败时改走同源 `/api/ai/proxy`；已经拿到状态码的报错不许走，
 * 否则会把「Key 错了」这种真错掩盖成「中转不通」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { API配置项 } from '@/models/settings';

vi.mock('@/services/storage/settings', () => ({
  saveSetting: vi.fn(() => Promise.resolve()),
  saveSettings: vi.fn(() => Promise.resolve()),
  loadSetting: vi.fn(() => Promise.resolve(null)),
  deleteSetting: vi.fn(() => Promise.resolve()),
}));

const 配置: API配置项 = {
  id: 'c1',
  name: 'AI Studio 中转',
  provider: 'openai_compatible',
  baseUrl: 'https://relay.example.test/v1',
  apiKey: 'sk-test',
  model: 'gemini-2.5-flash',
  createdAt: 0,
  updatedAt: 0,
};

/** `本地可用` 是模块级粘性缓存，每个用例都要拿一份干净模块。 */
async function 载入案例() {
  vi.resetModules();
  const relay = await import('@/services/ai/aiRelayClient');
  const models = await import('@/services/ai/openAICompatibleModels');
  const client = await import('@/services/ai/chatCompletionClient');
  return { relay, models, client };
}

function 取载荷(init?: RequestInit): Record<string, unknown> {
  const 体 = init?.body;
  return typeof 体 === 'string' ? (JSON.parse(体) as Record<string, unknown>) : {};
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('模型列表：直连 CORS 失败后改走同源中转', () => {
  it('直连抛 Failed to fetch 时经 /api/ai/proxy 取回列表', async () => {
    const { models } = await 载入案例();
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      if (String(input) === '/api/ai/proxy') {
        const 载荷 = 取载荷(init);
        expect(载荷.url).toBe('https://relay.example.test/v1/models');
        expect(载荷.method).toBe('GET');
        expect((载荷.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
        return jsonResponse({ data: [{ id: 'gemini-2.5-flash' }, { id: 'gemini-2.5-pro' }] });
      }
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const 列表 = await models.fetchOpenAICompatibleModels('https://relay.example.test/v1', 'sk-test');

    expect(列表).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    expect(fetchMock.mock.calls.filter(([u]) => String(u) === '/api/ai/proxy')).toHaveLength(1);
  });

  it('直连能通时不去碰中转', async () => {
    const { models } = await 载入案例();
    const fetchMock = vi.fn<(input: unknown) => Promise<Response>>(
      () => Promise.resolve(jsonResponse({ data: [{ id: 'm1' }] })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const 列表 = await models.fetchOpenAICompatibleModels('https://relay.example.test/v1', 'sk-test');

    expect(列表).toEqual(['m1']);
    expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/ai/proxy')).toBe(false);
  });

  it('已经拿到状态码的失败不走中转（不掩盖真错）', async () => {
    const { models } = await 载入案例();
    const fetchMock = vi.fn<(input: unknown) => Promise<Response>>(
      () => Promise.resolve(jsonResponse({ error: { message: 'Invalid API key' } }, 401)),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(models.fetchOpenAICompatibleModels('https://relay.example.test/v1', 'sk-bad'))
      .rejects.toThrow('401');
    expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/ai/proxy')).toBe(false);
  });
});

describe('非流式补全：同一个兜底', () => {
  it('直连 Failed to fetch 时经中转拿到正文', async () => {
    const { client } = await 载入案例();
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      if (String(input) === '/api/ai/proxy') {
        const 载荷 = 取载荷(init);
        expect(载荷.url).toBe('https://relay.example.test/v1/chat/completions');
        expect(载荷.method).toBe('POST');
        expect(String(载荷.body)).toContain('gemini-2.5-flash');
        return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '中转回来的正文' } }] });
      }
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const 文本 = await client.chatCompletionNonStream(配置, {
      messages: [{ role: 'user', content: '你好' }],
    });

    expect(文本).toBe('中转回来的正文');
  });

  it('本地没有中转端点时原样抛出 Failed to fetch', async () => {
    const { client } = await 载入案例();
    const fetchMock = vi.fn((input: unknown) => {
      if (String(input) === '/api/ai/proxy') {
        // 静态托管下这会被 SPA 兜底成 index.html。
        return Promise.resolve(new Response('<!doctype html>',
          { status: 200, headers: { 'content-type': 'text/html' } }));
      }
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(client.chatCompletionNonStream(配置, {
      messages: [{ role: 'user', content: '你好' }],
    })).rejects.toThrow('Failed to fetch');
  });
});

describe('兜底的边界', () => {
  it('同源路径不套中转', async () => {
    const { relay } = await 载入案例();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await relay.直连失败后经中转('/api/opencode', { method: 'POST', body: '{}' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('中转端点 404 时返回 null，不抛错', async () => {
    const { relay } = await 载入案例();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 404 }))));

    expect(await relay.直连失败后经中转('https://relay.example.test/v1/models', {})).toBeNull();
  });

  it('探到没有中转之后不再逐个请求重试', async () => {
    const { relay } = await 载入案例();
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 404 })));
    vi.stubGlobal('fetch', fetchMock);

    expect(await relay.直连失败后经中转('https://a.test/v1/models', {})).toBeNull();
    expect(await relay.直连失败后经中转('https://b.test/v1/models', {})).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('显式开启的优先中转仍需请求体（模型列表是 GET，不走这条）', async () => {
    const { relay } = await 载入案例();
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);

    expect(await relay.尝试本地中转('https://a.test/v1/models', { method: 'GET' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
