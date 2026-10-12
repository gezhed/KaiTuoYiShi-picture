import { describe, expect, it } from 'vitest';
import {
  填充占位符,
  构建LLM消息,
  诊断解析失败,
  修复回复格式,
  生成插图提示词,
  截断插图数量,
  占位符清单,
  type 调用LLM依赖,
  type LLM输入,
  type LLM消息,
} from '@/services/ai/imageGen/illustrationAgent';
import type { LLM条目, LLM设置 } from '@/models/genSystem';

function 建条目(覆盖: Partial<LLM条目> & { content: string }): LLM条目 {
  return {
    id: 覆盖.id ?? 覆盖.content.slice(0, 8),
    name: 覆盖.name ?? '条目',
    role: 覆盖.role ?? 'system',
    content: 覆盖.content,
    enabled: 覆盖.enabled ?? true,
    触发方式: 覆盖.触发方式 ?? 'always',
    触发词: 覆盖.触发词 ?? [],
    与触发: 覆盖.与触发 ?? false,
  };
}

function 建设置(条目列表: LLM条目[], 重试次数 = 2): LLM设置 {
  return {
    启用: true,
    当前预设: '默认',
    预设列表: { 默认: { entries: 条目列表, createdAt: 0, updatedAt: 0 } },
    温度: 0.7,
    重试次数,
    最大输出: 32768,
    API: { provider: '', baseUrl: '', apiKey: '', model: '' },
  };
}

const 空输入: LLM输入 = { 正文: '她抬头看雨。' };

function 建依赖(回复列表: string[]): { 依赖: 调用LLM依赖; 次数: () => number } {
  let 索引 = 0;
  return {
    依赖: {
      请求: async () => {
        const 回复 = 回复列表[Math.min(索引, 回复列表.length - 1)] ?? '';
        索引 += 1;
        return 回复;
      },
    },
    次数: () => 索引,
  };
}

describe('填充占位符', () => {
  it('替换全部已知占位符', () => {
    const 模板 = '正文={{正文}} 上下文={{上下文}} 需求={{用户需求}} 角色={{角色启用列表}}';
    expect(填充占位符(模板, { 正文: 'A', 上下文: 'B', 用户需求: 'C', 角色启用列表: 'D' }))
      .toBe('正文=A 上下文=B 需求=C 角色=D');
  });

  it('缺失的字段替换为空串而不是保留占位符', () => {
    expect(填充占位符('{{世界书触发}}|{{秒数}}|{{视频秒数}}', 空输入)).toBe('||');
  });

  it('占位符清单与实现一致', () => {
    for (const 键 of 占位符清单) {
      const 输出 = 填充占位符(`${键}`, { 正文: '' });
      expect(输出).not.toContain('{{');
    }
  });
});

describe('构建LLM消息', () => {
  it('system 在前、user 在后，按角色排序', () => {
    const 设置 = 建设置([
      建条目({ role: 'user', content: 'U' }),
      建条目({ role: 'system', content: 'S' }),
    ]);
    expect(构建LLM消息(设置, 空输入)).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'U' },
    ]);
  });

  /**
   * 只取预设条目本身，去掉末尾自动补的「以 user 轮结尾」指令。
   *
   * 这一组测的是**条目筛选**（启停、触发词），而末尾指令是恒定追加的一条，
   * 混在里面会让计数断言失焦。它本身的行为由 `llm-message-tail.test.ts` 覆盖。
   */
  const 预设消息 = (设置: LLM设置) => {
    const 全部 = 构建LLM消息(设置, 空输入);
    const 末条 = 全部[全部.length - 1];
    return 末条 && 末条.content.startsWith('现在') ? 全部.slice(0, -1) : 全部;
  };

  it('跳过未启用条目', () => {
    const 设置 = 建设置([
      建条目({ role: 'system', content: 'S' }),
      建条目({ role: 'user', content: 'U', enabled: false }),
    ]);
    expect(预设消息(设置)).toHaveLength(1);
  });

  it('触发方式 always 始终命中', () => {
    expect(预设消息(建设置([建条目({ content: 'S' })]))).toHaveLength(1);
  });

  it('触发方式 keyword 按触发词过滤', () => {
    const 设置 = 建设置([
      建条目({ content: 'S', 触发方式: 'keyword', 触发词: ['雨'] }),
      建条目({ content: 'T', 触发方式: 'keyword', 触发词: ['雪'] }),
    ]);
    expect(预设消息(设置).map((项) => 项.content)).toEqual(['S']);
  });

  it('与触发要求全部触发词命中', () => {
    const 设置 = 建设置([
      建条目({ content: 'S', 触发方式: 'keyword', 触发词: ['雨', '抬头'], 与触发: true }),
    ]);
    expect(预设消息(设置)).toHaveLength(1);
    const 设置2 = 建设置([
      建条目({ content: 'S', 触发方式: 'keyword', 触发词: ['雨', '雪'], 与触发: true }),
    ]);
    expect(() => 构建LLM消息(设置2, 空输入)).toThrow(/都没有触发/);
  });

  it('触发方式 manual 不参与自动构建', () => {
    expect(() => 构建LLM消息(建设置([建条目({ content: 'S', 触发方式: 'manual' })]), 空输入))
      .toThrow(/都没有触发/);
  });

  it('预设不存在或条目为空时抛错', () => {
     const 设置 = 建设置([]);
     expect(() => 构建LLM消息(设置, 空输入)).toThrow(/没有任何启用的条目/);
     设置.当前预设 = '不存在';
     expect(() => 构建LLM消息(设置, 空输入)).toThrow(/预设不存在/);
  });
});

describe('诊断解析失败', () => {
  it('空回复', () => {
    expect(诊断解析失败('').原因).toBe('empty');
    expect(诊断解析失败('   ').原因).toBe('empty');
  });

  it('仍在处理中', () => {
    expect(诊断解析失败('正在处理上一条请求').原因).toBe('still_processing');
    expect(诊断解析失败('Please wait').原因).toBe('still_processing');
  });

  it('有容器无子块', () => {
    expect(诊断解析失败('<images></images>').原因).toBe('missing_container_children');
  });

  it('完全没有标记', () => {
    expect(诊断解析失败('这是一段普通回复').原因).toBe('no_tags');
  });

  it('有标记但缺锚点', () => {
    expect(诊断解析失败('image###1girl###').原因).toBe('missing_anchor_or_tag');
  });
});

describe('修复回复格式', () => {
  it('给裸标记补上容器', () => {
    const 修复 = 修复回复格式('regex:行\nimage###A###');
    expect(修复).toContain('<images>');
    expect(修复).toContain('</images>');
  });

  it('补上缺失的结束标签', () => {
    expect(修复回复格式('<images><image>x</image>')).toContain('</images>');
  });

  it('全角尖括号归一', () => {
    expect(修复回复格式('＜images＞')).toBe('<images>');
  });

  it('已是完整格式时不重复包裹', () => {
    const 完整 = '<images><image>regex:a\nimage###A###</image></images>';
    expect(修复回复格式(完整)).toBe(完整);
  });
});

describe('生成插图提示词', () => {
  const 合法回复 = '<images><image>regex:她抬头\nimage###1girl, rain###</image></images>';

  it('一次成功时重试次数为 0', async () => {
    const { 依赖, 次数 } = 建依赖([合法回复]);
    const 结果 = await 生成插图提示词(依赖, { 回复: '她抬头看雨。', 输入: 空输入, 设置: 建设置([建条目({ content: 'S' })]) });
    expect(结果.插图).toHaveLength(1);
    expect(结果.重试次数).toBe(0);
    expect(次数()).toBe(1);
  });

  it('第一次无法解析时重试，第二次成功', async () => {
    const { 依赖, 次数 } = 建依赖(['没有标记', 合法回复]);
    const 结果 = await 生成插图提示词(依赖, { 回复: '她抬头看雨。', 输入: 空输入, 设置: 建设置([建条目({ content: 'S' })]) });
    expect(结果.插图).toHaveLength(1);
    expect(结果.重试次数).toBe(1);
    expect(次数()).toBe(2);
  });

  it('全部失败时返回空插图与诊断而不抛错', async () => {
    const { 依赖, 次数 } = 建依赖(['没有标记']);
    const 结果 = await 生成插图提示词(依赖, { 回复: '她抬头看雨。', 输入: 空输入, 设置: 建设置([建条目({ content: 'S' })], 2) });
    expect(结果.插图).toEqual([]);
    expect(结果.诊断?.原因).toBe('no_tags');
    expect(次数()).toBe(3);
  });

  it('重试次数为 0 时只请求一次', async () => {
    const { 依赖, 次数 } = 建依赖(['没有标记']);
    await 生成插图提示词(依赖, { 回复: 'x', 输入: 空输入, 设置: 建设置([建条目({ content: 'S' })], 0) });
    expect(次数()).toBe(1);
  });

  it('词汇替换在解析之前生效', async () => {
    const 带违禁词 = '<images><image>regex:她抬头\nimage###肉棒, 1girl###</image></images>';
    const { 依赖 } = 建依赖([带违禁词]);
    const 结果 = await 生成插图提示词(依赖, {
      回复: '她抬头看雨。',
      输入: 空输入,
      设置: 建设置([建条目({ content: 'S' })]),
      词汇替换映射: '肉棒=🥒',
    });
    expect(结果.插图[0].tag).toContain('🥒');
    expect(结果.插图[0].tag).not.toContain('肉棒');
  });

  it('缺容器与结束标签时靠格式修复也能解析出来', async () => {
    const { 依赖 } = 建依赖(['<image>regex:她抬头\nimage###1girl, rain###</image>']);
    const 结果 = await 生成插图提示词(依赖, { 回复: '她抬头看雨。', 输入: 空输入, 设置: 建设置([建条目({ content: 'S' })]) });
    expect(结果.插图).toHaveLength(1);
    expect(结果.插图[0].regex).toBe('她抬头');
  });

  it('一次回复里多张图全部保留（一正文多图）', async () => {
    const 多图 = [
      '<images>',
      '<image>regex:第一行\nimage###A###</image>',
      '<image>regex:第二行\nimage###B###</image>',
      '<image>regex:第三行\nimage###C###</image>',
      '</images>',
    ].join('\n');
    const { 依赖 } = 建依赖([多图]);
    const 结果 = await 生成插图提示词(依赖, { 回复: 'x', 输入: 空输入, 设置: 建设置([建条目({ content: 'S' })]) });
    expect(结果.插图).toHaveLength(3);
  });

  it('每张图可以带各自的分辨率', async () => {
    const 多图 = [
      '<images>',
      '<image>regex:a\nimage###A, 960x1280###</image>',
      '<image>regex:b\nimage###B, 1024x1024###</image>',
      '</images>',
    ].join('\n');
    const { 依赖 } = 建依赖([多图]);
    const 结果 = await 生成插图提示词(依赖, { 回复: 'x', 输入: 空输入, 设置: 建设置([建条目({ content: 'S' })]) });
    expect(结果.插图[0].tag).toContain('960x1280');
    expect(结果.插图[1].tag).toContain('1024x1024');
  });

  it('把正文与上下文注入消息', async () => {
    let 捕获: LLM消息[] = [];
    const 依赖: 调用LLM依赖 = {
      请求: async (消息) => {
        捕获 = 消息;
        return 合法回复;
      },
    };
    await 生成插图提示词(依赖, {
      回复: '正文内容',
      输入: { 正文: '正文内容', 上下文: '上下文内容' },
      设置: 建设置([建条目({ content: 'B={{正文}} C={{上下文}}' })]),
    });
    expect(捕获[0].content).toBe('B=正文内容 C=上下文内容');
  });
});

describe('截断插图数量', () => {
  const 三张 = [
    { regex: 'a', tag: 'A' },
    { regex: 'b', tag: 'B' },
    { regex: 'c', tag: 'C' },
  ];

  it('上限大于 0 时截断', () => {
    expect(截断插图数量(三张, 2)).toHaveLength(2);
  });

  it('上限为 0 或负数表示不限制', () => {
    expect(截断插图数量(三张, 0)).toHaveLength(3);
    expect(截断插图数量(三张, -1)).toHaveLength(3);
  });
});
