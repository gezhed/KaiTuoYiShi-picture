/**
 * 思考型模型 vs 强制 tool_choice。
 *
 * 实机报错：
 *   API Error 400: {"error":{"message":"Thinking mode does not support this tool_choice",
 *   "type":"invalid_request_error","param":null,"code":"invalid_request_error"}}
 *
 * 出自「正文配图 → 生成提示词」：智绘姬系预设要求模型只用 toolcall 回复，
 * 那边就把 `tool_choice` 写成了 `{ type: 'function', function: { name } }`（硬约束）。
 * 而思考模式（Anthropic extended thinking / DeepSeek reasoner / Qwen thinking …）
 * 只接受 `auto` / `none`，硬约束在网关就被 400 掉，正文一个字都发不出去。
 *
 * 这里锁住两层兜底：模型名预判，以及收到报文后的自动降级重试。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import { isForcedToolChoice, isForcedToolChoiceUnsupportedError } from '@/services/ai/chatCompletionProvider';
import { 思考工具声明, 提示词工具约束, 是否思考型模型, 默认工具名 } from '@/services/ai/imageGen/illustrationAgent';
import type { API配置项 } from '@/models/settings';

vi.mock('@/services/storage/settings', () => ({
  saveSetting: vi.fn(() => Promise.resolve()),
  saveSettings: vi.fn(() => Promise.resolve()),
  loadSetting: vi.fn(() => Promise.resolve(null)),
  deleteSetting: vi.fn(() => Promise.resolve()),
}));

const 配置: API配置项 = {
  id: 'c1',
  name: '中转',
  provider: 'openai_compatible',
  baseUrl: 'https://relay.example.test/v1',
  apiKey: 'sk-test',
  model: 'some-relay-model',
  createdAt: 0,
  updatedAt: 0,
};

const 提问 = {
  messages: [{ role: 'user' as const, content: '把这段正文转成插图提示词' }],
  tools: 思考工具声明,
  toolChoice: { type: 'function', function: { name: 默认工具名 } },
  parallelToolCalls: false,
};

const 思考模式报错 = JSON.stringify({
  error: {
    message: 'Thinking mode does not support this tool_choice',
    type: 'invalid_request_error',
    param: null,
    code: 'invalid_request_error',
  },
});

function 取请求体(mock: { mock: { calls: unknown[][] } }, 序号: number): Record<string, unknown> {
  const init = mock.mock.calls[序号][1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe('强制 tool_choice 的判据', () => {
  it('只有 required 与指名函数算硬约束', () => {
    expect(isForcedToolChoice({ type: 'function', function: { name: 默认工具名 } })).toBe(true);
    expect(isForcedToolChoice('required')).toBe(true);
    expect(isForcedToolChoice('auto')).toBe(false);
    expect(isForcedToolChoice('none')).toBe(false);
    expect(isForcedToolChoice(undefined)).toBe(false);
  });

  it('认得实机那条报文', () => {
    expect(isForcedToolChoiceUnsupportedError(
      new Error(`API Error 400: ${思考模式报错}`),
    )).toBe(true);
  });

  it('中英文与其它家的措辞都能认出来', () => {
    expect(isForcedToolChoiceUnsupportedError(
      new Error('{"error":{"message":"tool_choice is not supported when reasoning is enabled"}}'),
    )).toBe(true);
    expect(isForcedToolChoiceUnsupportedError(
      new Error('tool_choice: 思考模式下不支持指定工具'),
    )).toBe(true);
  });

  it('不相关的报错不误判（否则会把鉴权失败也重发一遍）', () => {
    expect(isForcedToolChoiceUnsupportedError(new Error('API Error 401: {"error":{"message":"Invalid API key"}}'))).toBe(false);
    expect(isForcedToolChoiceUnsupportedError(new Error('API Error 429: rate limit exceeded'))).toBe(false);
    expect(isForcedToolChoiceUnsupportedError(undefined)).toBe(false);
  });
});

describe('按模型名预判思考型模型', () => {
  it('认得常见命名', () => {
    for (const 名 of [
      'deepseek-reasoner',
      'qwen3-thinking',
      'kimi-k2-reasoning',
      'o1-preview',
      'o3-mini',
      'glm-4.6-distill',
    ]) {
      expect(是否思考型模型(名), 名).toBe(true);
    }
  });

  it('普通模型不误伤', () => {
    for (const 名 of [
      'deepseek-chat',
      'gpt-4o',
      'gemini-2.5-flash',
      'claude-sonnet-4-5',
      'qwen3-max',
      '',
    ]) {
      expect(是否思考型模型(名), 名).toBe(false);
    }
  });

  it('「正文配图 → 生成提示词」按模型挑约束：思考型给 auto，其它仍强制', () => {
    // 非思考型保持硬约束——预设禁止直出文本时必须强制，否则会空回。
    expect(提示词工具约束('deepseek-chat')).toEqual({ type: 'function', function: { name: 默认工具名 } });
    expect(提示词工具约束('gemini-3-flash-preview')).toEqual({ type: 'function', function: { name: 默认工具名 } });
    // 思考型退成软约束，避免在网关就被 400。
    expect(提示词工具约束('deepseek-reasoner')).toBe('auto');
    expect(提示词工具约束('qwen3-thinking')).toBe('auto');
    expect(提示词工具约束('o3-mini')).toBe('auto');
  });
});

describe('收到「思考模式不支持 tool_choice」后自动降级重试', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('去掉硬约束改成 auto 重发，并返回第二次的正文', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(思考模式报错, {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: '<images><image>x</image></images>' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const 文本 = await chatCompletionNonStream(配置, 提问);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(取请求体(fetchMock, 0).tool_choice).toEqual({ type: 'function', function: { name: 默认工具名 } });
    // 降级的是「强制」，不是「可用」：工具声明必须留着，模型仍可调它。
    expect(取请求体(fetchMock, 1).tool_choice).toBe('auto');
    expect(取请求体(fetchMock, 1).tools).toEqual(思考工具声明);
    expect(文本).toContain('<images>');
  });

  it('降级后只重发一次，不会来回递归', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(思考模式报错, {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(chatCompletionNonStream(配置, 提问)).rejects.toThrow('API Error 400');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(取请求体(fetchMock, 0).tool_choice).toEqual({ type: 'function', function: { name: 默认工具名 } });
    expect(取请求体(fetchMock, 1).tool_choice).toBe('auto');
  });

  it('本来就没强制时，400 原样抛出、不重发', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(思考模式报错, {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(chatCompletionNonStream(配置, { ...提问, toolChoice: 'auto' }))
      .rejects.toThrow('API Error 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('鉴权失败这类 400/401 不触发降级', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: 'Invalid API key', type: 'invalid_request_error' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(chatCompletionNonStream(配置, 提问)).rejects.toThrow('API Error 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
