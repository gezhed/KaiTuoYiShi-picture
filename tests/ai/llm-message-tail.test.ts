// @vitest-environment jsdom
/**
 * 消息链必须以 user 轮结尾。
 *
 * 实测报错：`API Error 400 ... "Requests ending with a model turn are not supported."`
 * 原因：社区预设的最后一条通常是 assistant 的**示例输出**，正文靠 `{{正文}}` 占位符
 * 填在中间某条里，于是整条链以 model 轮收尾。Gemini 一类接口直接拒收。
 *
 * 这里同时用**用户真实预设文件**与合成样例锁定修复。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { 构建LLM消息, 填充占位符, 诊断解析失败 } from '@/services/ai/imageGen/illustrationAgent';
import { 创建默认LLM设置 } from '@/models/genSystem';
import type { LLM条目, LLM设置 } from '@/models/genSystem';

function 读取预设(文件名: string): unknown | null {
  try {
    return JSON.parse(readFileSync(resolve(__dirname, `../../../${文件名}`), 'utf8')) as unknown;
  } catch {
    return null;
  }
}

const 预设2 = 读取预设('llm预设2.json');
const 预设1 = 读取预设('llm预设.json');

function 建条目(补丁: Partial<LLM条目> & { content: string }): LLM条目 {
  return {
    id: `e_${Math.random().toString(36).slice(2, 8)}`,
    name: '条目',
    role: 'user',
    enabled: true,
    触发方式: 'always',
    触发词: [],
    与触发: false,
    ...补丁,
  };
}

function 建设置(entries: LLM条目[], 当前预设 = '默认'): LLM设置 {
  const 设置 = 创建默认LLM设置();
  设置.启用 = true;
  设置.当前预设 = 当前预设;
  设置.预设列表 = {
    [当前预设]: { entries, createdAt: 0, updatedAt: 0 },
  };
  return 设置;
}

/** 从导出信封 / 预设表里取出第一个可用预设的 entries，并补齐导入时的默认字段。 */
function 取条目(数据: unknown): LLM条目[] {
  return 找原始条目(数据).map((项, 下标) => 建条目({
    id: typeof 项.id === 'string' && 项.id ? 项.id : `raw_${下标}`,
    name: typeof 项.name === 'string' ? 项.name : `条目 ${下标 + 1}`,
    role: 项.role === 'assistant' || 项.role === 'system' ? 项.role : 'user',
    content: String(项.content ?? ''),
  }));
}

function 找原始条目(数据: unknown): Array<Record<string, unknown>> {
  if (!数据 || typeof 数据 !== 'object') return [];
  const 根 = 数据 as Record<string, unknown>;
  if (Array.isArray(根.entries)) return 根.entries as Array<Record<string, unknown>>;
  if (Array.isArray(根.messages)) return 根.messages as Array<Record<string, unknown>>;
  if (根.data) return 找原始条目(根.data);
  for (const 值 of Object.values(根)) {
    const 命中 = 找原始条目(值);
    if (命中.length > 0) return 命中;
  }
  return [];
}

const 输入 = { 正文: '她站在窗前，看着外面的街灯。' };

describe('一般行为', () => {
  it('末条是 assistant 时补一条 user，且带上正文', () => {
    const 消息 = 构建LLM消息(
      建设置([
        建条目({ content: '把正文转成提示词' }),
        建条目({ role: 'assistant', content: '示例输出：<images>…</images>' }),
      ]),
      输入,
    );
    expect(消息[消息.length - 1].role).toBe('user');
    expect(消息[消息.length - 1].content).toContain(输入.正文);
  });

  it('末条是 system 时也补 user', () => {
    const 消息 = 构建LLM消息(
      建设置([
        建条目({ role: 'system', content: '你是视觉导演' }),
        建条目({ role: 'system', content: '输出格式：<images>' }),
      ]),
      输入,
    );
    expect(消息[消息.length - 1].role).toBe('user');
  });

  it('本来就以 user 结尾时不追加，且相邻 user 会被合并成一条', () => {
    const 消息 = 构建LLM消息(
      建设置([
        建条目({ content: '把下面正文转成提示词：' }),
        建条目({ content: '正文：{{正文}}' }),
      ]),
      输入,
    );
    // 两条 user 合并成一条，没有多余的追加。
    expect(消息).toHaveLength(1);
    expect(消息[0].role).toBe('user');
    expect(消息[0].content).toContain('把下面正文转成提示词');
    expect(消息[0].content).toContain(输入.正文);
    // 正文只出现一次——既没被重复追加，也没被合并丢内容。
    expect(消息[0].content.split(输入.正文).length - 1).toBe(1);
  });

  it('正文为空时也给一条可回答的 user 轮', () => {
    const 消息 = 构建LLM消息(
      建设置([建条目({ role: 'assistant', content: '示例' })]),
      { 正文: '' },
    );
    expect(消息[消息.length - 1].role).toBe('user');
    expect(消息[消息.length - 1].content.trim().length).toBeGreaterThan(0);
  });

  it('无论预设怎么排，结果都以 user 结尾', () => {
    const 组合: LLM条目[][] = [
      [建条目({ content: 'a' })],
      [建条目({ role: 'assistant', content: 'a' })],
      [建条目({ role: 'system', content: 'a' })],
      [建条目({ content: 'a' }), 建条目({ role: 'assistant', content: 'b' })],
      [建条目({ role: 'assistant', content: 'a' }), 建条目({ role: 'assistant', content: 'b' })],
    ];
    for (const entries of 组合) {
      const 消息 = 构建LLM消息(建设置(entries), 输入);
      expect(消息[消息.length - 1].role, `末条 role 应为 user：${JSON.stringify(entries.map((e) => e.role))}`)
        .toBe('user');
    }
  });
});

describe('合并相邻同角色消息（上游 mergeAdjacentMessages）', () => {
  it('相邻同角色用换行合并', () => {
    const 消息 = 构建LLM消息(
      建设置([
        建条目({ content: '第一段' }),
        建条目({ content: '第二段' }),
        建条目({ role: 'assistant', content: '示例' }),
      ]),
      输入,
    );
    // 两条 user 合并成一条，assistant 之后补 user。
    expect(消息.map((项) => 项.role)).toEqual(['user', 'assistant', 'user']);
    expect(消息[0].content).toContain('第一段');
    expect(消息[0].content).toContain('第二段');
    expect(消息[0].content).toContain('\n');
  });

  it('不同角色之间不合并', () => {
    const 消息 = 构建LLM消息(
      建设置([
        建条目({ role: 'system', content: 'S' }),
        建条目({ content: 'U' }),
        建条目({ role: 'assistant', content: 'A' }),
        建条目({ content: 'U2' }),
      ]),
      输入,
    );
    // system → user → assistant → user（已以 user 结尾，不追加）
    expect(消息.map((项) =>项.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('内容为空的条目被丢掉，不占一个 message', () => {
    const 消息 = 构建LLM消息(
      建设置([
        建条目({ content: '正文：{{正文}}' }),
        建条目({ content: '   ' }),
        建条目({ content: '' }),
      ]),
      输入,
    );
    expect(消息).toHaveLength(1);
    expect(消息[0].content).toContain(输入.正文);
  });

  it('合并后不会留下空内容的消息', () => {
    const 消息 = 构建LLM消息(
      建设置([
        建条目({ content: 'a' }),
        建条目({ content: '  ' }),
        建条目({ content: 'b' }),
      ]),
      输入,
    );
    for (const 项 of 消息) expect(项.content.trim().length).toBeGreaterThan(0);
  });
});

describe('展开 {{roll N}} 占位符（上游 processRollPlaceholders）', () => {
  it('{{roll N}} 被换成随机串，不留字面量', () => {
    const 消息 = 构建LLM消息(
      建设置([建条目({ content: '种子={{roll 1999999}} 正文：{{正文}}' })]),
      输入,
    );
    const 内容 = 消息[0].content;
    expect(内容).not.toContain('{{roll');
    expect(内容).toContain('种子=');
    const 捕获 = 内容.match(/种子=([A-Za-z0-9]{8})/);
    expect(捕获, `应产生 8 位随机串，实际：${内容}`).not.toBeNull();
  });

  it('支持 {{roll 1d20}} 形式与大小写', () => {
    const 消息 = 构建LLM消息(
      建设置([建条目({ content: 'a={{roll 1d20}} b={{ROLL 20}}' })]),
      输入,
    );
    expect(消息[0].content).not.toMatch(/\{\{roll/i);
    expect(消息[0].content).toMatch(/a=[A-Za-z0-9]{8} b=[A-Za-z0-9]{8}/);
  });

  it('多个占位符各自替换，不共用同一个值', () => {
    const 内容 = 构建LLM消息(
      建设置([建条目({ content: '{{roll 99999999}}{{roll 99999999}}{{roll 99999999}}{{roll 99999999}}{{roll 99999999}}{{roll 99999999}}' })]),
      输入,
    )[0].content;
    const 值 = 内容.match(/[A-Za-z0-9]{8}/g) ?? [];
    expect(值).toHaveLength(6);
    // 8 位串碰巧全同的概率极低；全同说明实现没在每次匹配时取新随机数。
    expect(new Set(值).size).toBeGreaterThan(1);
  });

  it('不含占位符的内容不受影响', () => {
    const 内容 = 构建LLM消息(建设置([建条目({ content: '普通内容，没有掷骰。' })]), 输入)[0].content;
    expect(内容).toBe('普通内容，没有掷骰。');
  });

  it.skipIf(!预设2)('真实预设里不再残留任何 {{roll', () => {
    const 消息 = 构建LLM消息(建设置(取条目(预设2)), 输入);
    for (const 项 of 消息) expect(项.content).not.toMatch(/\{\{roll/i);
  });
});

describe('空回的成因诊断（靠 finishReason 区分）', () => {
  it('SAFETY：报安全拦截，并说明本应用无法绕过', () => {
    const 诊断 = 诊断解析失败('', { finishReason: 'SAFETY', sawVisibleContent: false, selectedModel: 'gemini-3f' });
    expect(诊断.原因).toBe('empty');
    expect(诊断.文案).toContain('安全策略');
    expect(诊断.文案).toContain('SAFETY');
  });

  it('MAX_TOKENS：指出思维链吃掉了额度，并指向「最大输出」', () => {
    const 诊断 = 诊断解析失败('', { finishReason: 'MAX_TOKENS', sawVisibleContent: false, selectedModel: 'gemini-3.1p' });
    expect(诊断.文案).toContain('MAX_TOKENS');
    expect(诊断.文案).toContain('最大输出');
  });

  it('只回了 reasoning_content：指出是分流，而不是模型没答', () => {
    const 诊断 = 诊断解析失败('', { sawReasoning: true, sawVisibleContent: false, selectedModel: 'gemini-3f' });
    expect(诊断.文案).toContain('reasoning_content');
  });

  it('SAFETY 优先于 reasoning 判定（两者同时出现时以拦截为准）', () => {
    const 诊断 = 诊断解析失败('', { finishReason: 'SAFETY', sawReasoning: true, selectedModel: 'x' });
    expect(诊断.文案).toContain('安全策略');
  });

  it('没有任何诊断信息时仍给可执行的建议，而不是只说「返回为空」', () => {
    const 诊断 = 诊断解析失败('');
    expect(诊断.原因).toBe('empty');
    expect(诊断.文案).toContain('最大输出');
  });

  it('有 finishReason 但非已知值时把原值带出来', () => {
    const 诊断 = 诊断解析失败('', { finishReason: 'RECITATION', selectedModel: 'x' });
    expect(诊断.文案).toContain('RECITATION');
  });

  it('prompt_tokens=0 时点明「请求没到模型」，避免继续白调提示词', () => {
    const 诊断 = 诊断解析失败('', {
      finishReason: 'stop',
      selectedModel: 'gemini-3-flash-preview',
      响应结构: '{choices=[1× {message={content=""}, finish_reason="stop"}], usage={prompt_tokens=0, completion_tokens=0}}',
    });
    expect(诊断.文案).toContain('没有到达模型');
    expect(诊断.文案).toContain('中转');
  });

  it('prompt_tokens 非 0 时不显示「没到模型」的提示', () => {
    const 诊断 = 诊断解析失败('', {
      finishReason: 'stop',
      响应结构: '{usage={prompt_tokens=1234, completion_tokens=0}}',
    });
    expect(诊断.文案).not.toContain('没有到达模型');
  });

  it('带出本次请求的最大输出，便于判断是否因值过大被拒', () => {
    const 诊断 = 诊断解析失败('', { finishReason: 'stop', 请求最大输出: 32768 });
    expect(诊断.文案).toContain('32768');
  });

  it('非空回复不按空回处理（不受 finishReason 影响）', () => {
    // 用真正命中「仍在处理」判据的文案；重点是 finishReason 不会把非空回复误判成空回。
    const 诊断 = 诊断解析失败('正在处理上一条请求，请稍候', { finishReason: 'STOP', selectedModel: 'x' });
    expect(诊断.原因).toBe('still_processing');
    expect(诊断.文案).toContain('稍后');
  });
});

describe('用用户真实预设文件验证', () => {
  it.skipIf(!预设1)('llm预设.json：排序后仍以 assistant 收尾，因此补一条 user', () => {
    const entries = 取条目(预设1);
    expect(entries.length).toBeGreaterThan(0);
    // 这个文件的原始顺序是 user / assistant / user —— 注意**最后一条是 user**，
    // 但排序把 assistant 放到最后（示例输出必须在待回答之前），所以链条反而需要补一条。
    // 这正是「不能只看文件里最后一条的 role」的原因。
    expect(entries[entries.length - 1].role).toBe('user');
    expect(entries.some((项) => 项.role === 'assistant')).toBe(true);

    const 消息 = 构建LLM消息(建设置(entries), 输入);
    expect(消息[消息.length - 1].role).toBe('user');
    expect(消息).toHaveLength(entries.length + 1);
  });

  it.skipIf(!预设2)('llm预设2.json：大量同角色条目被合并成很少几条 message', () => {
    const entries = 取条目(预设2);
    expect(entries.length).toBeGreaterThan(3);
    const 消息 = 构建LLM消息(建设置(entries), 输入);

    // 这是关键修复：逐条发出去会变成几十上百条 message，Gemini 直接 429 或回空。
    // 社区预设把说明拆成大量同角色条目，合并后应该只剩个位数。
    expect(消息.length).toBeLessThanOrEqual(5);
    expect(消息.length).toBeLessThan(entries.length);
    for (const 项 of 消息) expect(项.content.trim().length).toBeGreaterThan(0);
  });

  it.skipIf(!预设2)('llm预设2.json：原末条是 assistant，修复后以 user 结尾', () => {
    const entries = 取条目(预设2);
    expect(entries.length).toBeGreaterThan(0);
    // 先确认原始预设确实以 assistant 结尾（这正是报错的原因）。
    expect(entries[entries.length - 1].role).toBe('assistant');

    const 消息 = 构建LLM消息(建设置(entries), 输入);
    expect(消息[消息.length - 1].role).toBe('user');
    expect(消息[消息.length - 1].content).toContain(输入.正文);
  });
});

describe('占位符填充顺序（排序权重）', () => {
  it('system 在前、assistant 在后，保持示例输出的位置', () => {
    const 消息 = 构建LLM消息(
      建设置([
        建条目({ role: 'assistant', content: 'A' }),
        建条目({ role: 'user', content: 'U' }),
        建条目({ role: 'system', content: 'S' }),
      ]),
      输入,
    );
    // 排序后 system → user → assistant，再补一条 user。
    expect(消息.map((项) => 项.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('未启用条目被排除', () => {
    const 消息 = 构建LLM消息(
      建设置([
        建条目({ content: '启用' }),
        建条目({ content: '停用', enabled: false }),
        建条目({ role: 'assistant', content: '示例' }),
      ]),
      输入,
    );
    expect(消息.some((项) => 项.content === '停用')).toBe(false);
  });

  it('全部停用时抛错而不是发空请求', () => {
    expect(() => 构建LLM消息(
      建设置([建条目({ content: 'x', enabled: false })]),
      输入,
    )).toThrow(/没有任何启用的条目/);
  });

  it('占位符被替换，未知占位符留空', () => {
    expect(填充占位符('正文={{正文}} 上下文={{上下文}}', { 正文: 'B', 上下文: 'C' }))
      .toBe('正文=B 上下文=C');
  });
});
