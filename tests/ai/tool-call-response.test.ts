// @vitest-environment jsdom
/**
 * toolcall 回复解析测试。
 *
 * 实测报错：Gemini 3f 返回空内容且 `finishReason=stop`。
 * 根因是预设明确要求「不要使用 Text/Content 直出，而是使用 %TOOL_NAME% toolcall 工具回复」——
 * 模型的可见文本本来就是空的，正文全在 `tool_calls[0].function.arguments` 里。
 * 只读 `content` 就必然判定为空回，而 `finishReason` 还是正常的 `stop`，
 * 所以既不报错也看不出成因。
 */
import { describe, expect, it } from 'vitest';
import { parseOpenAICompatibleTextResponse, 描述响应结构 } from '@/services/ai/chatCompletionStream';
import { buildOpenAICompatibleRequestBody } from '@/services/ai/chatCompletionOpenAICompat';
import { 思考工具声明, 替换工具名, 默认工具名 } from '@/services/ai/imageGen/illustrationAgent';

describe('从 tool_calls 里取正文', () => {
  it('取 thought_and_context 字段', () => {
    const 载荷 = {
      choices: [{
        finish_reason: 'stop',
        message: {
          content: '',
          tool_calls: [{
            type: 'function',
            function: {
              name: 'thought_and_context',
              arguments: JSON.stringify({ thought_and_context: '<images><image>x</image></images>' }),
            },
          }],
        },
      }],
    };
    expect(parseOpenAICompatibleTextResponse(载荷)).toContain('<images>');
  });

  it('content 非空时优先用 content，不碰 tool_calls', () => {
    const 载荷 = {
      choices: [{
        message: {
          content: '直出文本',
          tool_calls: [{ function: { arguments: '{"thought_and_context":"工具里的"}' } }],
        },
      }],
    };
    expect(parseOpenAICompatibleTextResponse(载荷)).toBe('直出文本');
  });

  it('取不到 thought_and_context 时退回其它字段', () => {
    const 载荷 = {
      choices: [{ message: { content: null, tool_calls: [{ function: { arguments: '{"thought":"只有思考"}' } }] } }],
    };
    expect(parseOpenAICompatibleTextResponse(载荷)).toBe('只有思考');
  });

  it('arguments 不是合法 JSON 时整串返回，不丢内容', () => {
    const 载荷 = {
      choices: [{ message: { content: '', tool_calls: [{ function: { arguments: '不是 JSON 的正文' } }] } }],
    };
    expect(parseOpenAICompatibleTextResponse(载荷)).toBe('不是 JSON 的正文');
  });

  it('多个 tool_calls 全部拼接', () => {
    const 载荷 = {
      choices: [{
        message: {
          content: '',
          tool_calls: [
            { function: { arguments: '{"thought_and_context":"第一段"}' } },
            { function: { arguments: '{"thought_and_context":"第二段"}' } },
          ],
        },
      }],
    };
    const 文本 = parseOpenAICompatibleTextResponse(载荷);
    expect(文本).toContain('第一段');
    expect(文本).toContain('第二段');
  });

  it('arguments 已是对象时也能取（部分中转会这样返回）', () => {
    const 载荷 = {
      choices: [{ message: { content: '', tool_calls: [{ function: { arguments: { thought_and_context: '对象形式' } } }] } }],
    };
    expect(parseOpenAICompatibleTextResponse(载荷)).toBe('对象形式');
  });

  it('没有 tool_calls 时行为不变', () => {
    const 载荷 = { choices: [{ message: { content: '普通回复' } }] };
    expect(parseOpenAICompatibleTextResponse(载荷)).toBe('普通回复');
  });

  it('tool_calls 全为空内容时仍返回空（不编内容）', () => {
    const 载荷 = {
      choices: [{ message: { content: '', tool_calls: [{ function: { arguments: '{"thought_and_context":"   "}' } }] } }],
    };
    expect(parseOpenAICompatibleTextResponse(载荷)).toBe('');
  });
});

describe('响应结构摘要（空回时判断内容在哪）', () => {
  it('空回响应会暴露 tool_calls 的存在与长度', () => {
    const 载荷 = {
      choices: [{
        finish_reason: 'stop',
        message: { role: 'assistant', content: '', tool_calls: [{ function: { arguments: '{"a":"b"}' } }] },
      }],
      usage: { total_tokens: 10 },
    };
    const 结构 = 描述响应结构(载荷);
    expect(结构).toContain('tool_calls');
    expect(结构).toContain('content=""');
    expect(结构).toContain('finish_reason="stop"');
  });

  it('不把正文装进去（只报长度）', () => {
    const 长文 = 'x'.repeat(5000);
    const 结构 = 描述响应结构({ choices: [{ message: { content: 长文 } }] });
    expect(结构).toContain('5000字');
    expect(结构).not.toContain(长文);
  });

  it('短字符串给出原值（finish_reason 这类关键信息不能只给长度）', () => {
    expect(描述响应结构({ finish_reason: 'stop' })).toContain('finish_reason="stop"');
  });

  it('区分空串与 null', () => {
    expect(描述响应结构({ a: '', b: null })).toContain('a=""');
    expect(描述响应结构({ a: '', b: null })).toContain('b=null');
  });

  it('数组报出长度与元素结构', () => {
    expect(描述响应结构({ choices: [{ x: 1 }] })).toContain('choices=[1×');
  });

  it('深层嵌套有深度上限，不会无限展开', () => {
    let 深: unknown = { v: '底' };
    for (let i = 0; i < 12; i += 1) 深 = { n: 深 };
    const 结构 = 描述响应结构(深);
    expect(结构).toContain('…');
    expect(结构.length).toBeLessThan(400);
  });

  it('非对象输入不抛错', () => {
    expect(() => 描述响应结构(undefined)).not.toThrow();
    expect(() => 描述响应结构(42)).not.toThrow();
    expect(描述响应结构('abc')).toBe('"3字"');
  });
});

describe('请求体里的工具字段', () => {
  const 基础配置 = {
    id: 'c1', name: '测试', provider: 'openai_compatible' as const,
    baseUrl: 'https://example.com/v1', apiKey: 'k', model: 'gemini-3-flash-preview',
    createdAt: 0, updatedAt: 0,
  };

  it('声明 tools 时一并带上 tool_choice 与 parallel_tool_calls', () => {
    const 体 = buildOpenAICompatibleRequestBody(
      基础配置,
      [{ role: 'user', content: 'hi' }],
      {
        messages: [{ role: 'user', content: 'hi' }],
        tools: 思考工具声明,
        toolChoice: { type: 'function', function: { name: 默认工具名 } },
        parallelToolCalls: false,
      },
      false,
    );
    expect(体.tools).toEqual(思考工具声明);
    // 关键：只给 tools 列表，模型仍可选择回文本；必须用 tool_choice 强制。
    expect(体.tool_choice).toEqual({ type: 'function', function: { name: 默认工具名 } });
    expect(体.parallel_tool_calls).toBe(false);
  });

  it('没有 tools 时不写入任何工具字段（不影响其它调用）', () => {
    const 体 = buildOpenAICompatibleRequestBody(
      基础配置,
      [{ role: 'user', content: 'hi' }],
      { messages: [{ role: 'user', content: 'hi' }] },
      false,
    );
    expect(体.tools).toBeUndefined();
    expect(体.tool_choice).toBeUndefined();
    expect(体.parallel_tool_calls).toBeUndefined();
  });

  it('tools 为空数组时同样不写入', () => {
    const 体 = buildOpenAICompatibleRequestBody(
      基础配置,
      [{ role: 'user', content: 'hi' }],
      { messages: [{ role: 'user', content: 'hi' }], tools: [] },
      false,
    );
    expect(体.tools).toBeUndefined();
  });
});

describe('工具声明与 %TOOL_NAME% 替换', () => {
  it('工具声明的结构符合 OpenAI 兼容格式', () => {
    expect(思考工具声明).toHaveLength(1);
    const 工具 = 思考工具声明[0];
    expect(工具.type).toBe('function');
    expect(工具.function.name).toBe(默认工具名);
    expect(工具.function.parameters.required).toEqual(['thought_and_context']);
  });

  it('%TOOL_NAME% 被替换成真实工具名', () => {
    const 结果 = 替换工具名([{ role: 'user', content: '使用 %TOOL_NAME% 工具回复' }], 默认工具名);
    expect(结果[0].content).toBe('使用 thought_and_context 工具回复');
    expect(结果[0].content).not.toContain('%TOOL_NAME%');
  });

  it('不带百分号的 TOOL_NAME% 也替换（对齐上游 L20074）', () => {
    const 结果 = 替换工具名([{ role: 'user', content: '使用 TOOL_NAME% 回复' }], 默认工具名);
    expect(结果[0].content).toBe('使用 thought_and_context 回复');
  });

  it('没有占位符时内容不变', () => {
    const 结果 = 替换工具名([{ role: 'user', content: '普通内容' }], 默认工具名);
    expect(结果[0].content).toBe('普通内容');
  });
});
