import { describe, expect, it } from 'vitest';
import { 归一化文生图系统设置 } from '@/models/settings';
import { 人物生成默认提示词 } from '@/prompts/cot/characterFeaturePrompt';
import { 人物生成预设消息 } from '@/models/genSystem';
import {
  默认启用预设名,
  默认通用角色列表名,
  默认通用服装列表名,
  默认注入模板名,
} from '@/models/genSystem';

/**
 * 角色管理预设化后的归一化契约。
 *
 * 关键不变式：`角色启用列表` 是「当前启用预设」的镜像，任何来源的输入
 * （v1 的扁平列表 / 预设 + 扁平列表 / 只有预设）归一化之后都必须自洽——
 * 出图引擎只认那一份扁平列表。
 */
describe('归一化文生图系统设置：角色启用列表', () => {
  it('v1 的扁平列表升级成「默认启用列表」预设，并保持顺序', () => {
    const 设置 = 归一化文生图系统设置({ 角色启用列表: ['b', 'a'] });
    expect(设置.当前启用预设).toBe(默认启用预设名);
    expect(设置.角色启用预设列表[默认启用预设名].条目.map((项) => 项.角色Id)).toEqual(['b', 'a']);
    expect(设置.角色启用列表).toEqual(['b', 'a']);
    expect(设置.角色启用预设列表[默认启用预设名].条目[0]).toMatchObject({
      图片媒体Id: '', 音频媒体Id: '', 图片描述: '', 音频描述: '',
    });
  });

  it('预设才是数据源：预设与扁平列表不一致时以预设为准', () => {
    const 设置 = 归一化文生图系统设置({
      角色启用列表: ['旧的扁平值'],
      角色启用预设列表: {
        我的清单: {
          // 故意用「对象条目 + 旧格式裸字符串」混排，验证归一化两种都吃。
          条目: [
            { 角色Id: '流萤', 图片媒体Id: 'm1', 图片描述: '看向镜头' },
            '三月七',
          ] as never,
          绑定角色卡: '流萤',
          绑定聊天: 'chat-1',
        },
      },
      当前启用预设: '我的清单',
    });
    expect(设置.角色启用列表).toEqual(['流萤', '三月七']);
    expect(设置.角色启用预设列表.我的清单.绑定角色卡).toBe('流萤');
    expect(设置.角色启用预设列表.我的清单.条目[0].图片媒体Id).toBe('m1');
  });

  it('当前预设指向不存在的名字时回退到第一个预设', () => {
    const 设置 = 归一化文生图系统设置({
      角色启用预设列表: { A: { 条目: ['x'] as never, 绑定角色卡: '', 绑定聊天: '' } },
      当前启用预设: '不存在',
    });
    expect(设置.当前启用预设).toBe('A');
    expect(设置.角色启用列表).toEqual(['x']);
  });

  it('重复角色只保留第一次出现', () => {
    const 设置 = 归一化文生图系统设置({ 角色启用列表: ['a', 'a', 'b'] });
    expect(设置.角色启用列表).toEqual(['a', 'b']);
  });
});

describe('归一化文生图系统设置：通用列表与注入模板', () => {
  it('空设置时给出默认的通用列表与四套注入模板', () => {
    const 设置 = 归一化文生图系统设置(undefined);
    expect(Object.keys(设置.通用角色列表)).toEqual([默认通用角色列表名]);
    expect(Object.keys(设置.通用服装列表)).toEqual([默认通用服装列表名]);
    expect(设置.当前注入模板).toBe(默认注入模板名);
    expect(Object.keys(设置.注入模板列表)).toEqual(['默认方案', 'Tavern XML 格式', 'Markdown 极简卡片', '视频注入']);
  });

  it('内置模板永远补回来，用户自建模板按名字覆盖', () => {
    const 设置 = 归一化文生图系统设置({
      注入模板列表: { 我的模板: { 角色列表: '自定义 {nameCN}' } as never },
      当前注入模板: '我的模板',
    });
    expect(设置.注入模板列表.默认方案.角色列表).toContain('中文名称：{nameCN}');
    expect(设置.注入模板列表.我的模板).toMatchObject({
      角色列表: '自定义 {nameCN}',
      卡内服装: 设置.注入模板列表.默认方案.卡内服装,
    });
    expect(设置.当前注入模板).toBe('我的模板');
  });

  it('通用列表的条目只保留字符串', () => {
    const 设置 = 归一化文生图系统设置({
      通用角色列表: { L: { 角色: ['a', 3, '', null] as unknown as string[] } },
      当前通用角色列表: 'L',
    });
    expect(设置.通用角色列表.L.角色).toEqual(['a', '3']);
  });
});

describe('归一化文生图系统设置：角色 AI', () => {
  it('默认是**空白**预设（新版走导入制），参数给足', () => {
    const 设置 = 归一化文生图系统设置(undefined);
    expect(设置.角色AI.消息).toEqual([]);
    expect(设置.角色AI.附加要求).toBe('');
    expect(设置.角色AI.最大输出).toBeGreaterThanOrEqual(8192);
    expect(设置.角色AI.重试次数).toBeGreaterThanOrEqual(0);
  });

  it('「人物生成」预设序列（导入文件的内容）带破甲与两套格式规格，讨论模式停用', () => {
    const 消息 = 人物生成预设消息();
    expect(消息.length).toBeGreaterThanOrEqual(8);
    const 启用 = 消息.filter((项) => 项.enabled !== false);
    const 文本 = 启用.map((项) => 项.content).join('\n');
    expect(文本).toContain('小克:头好疼，我是谁？');
    expect(文本).toContain('<人物>');
    expect(文本).toContain('上半身SFW');
    expect(文本).toContain('下半身NSFW背面');
    expect(文本).toContain('<服装>');
    expect(消息.find((项) => 项.id === 'discuss-mode')?.enabled).toBe(false);
  });

  it('升级路径：旧存档带 `提示词` 时补上「人物生成」序列（不让老用户静默失去破甲）', () => {
    const 设置 = 归一化文生图系统设置({ 角色AI: { 提示词: '旧的内置提示词' } as never });
    expect(设置.角色AI.消息.length).toBeGreaterThanOrEqual(8);
    expect(设置.角色AI.消息.map((项) => 项.content).join('\n')).toContain('小克:头好疼，我是谁？');
    // 旧提示词与内置那条不同 → 当作附加要求保留。
    expect(设置.角色AI.附加要求).toBe('旧的内置提示词');
  });

  it('旧存档的单条提示词：没改过就丢弃（默认序列已含同一条）', () => {
    const 设置 = 归一化文生图系统设置({
      角色AI: { 提示词: 人物生成默认提示词 } as never,
    });
    expect(设置.角色AI.附加要求).toBe('');
    expect(设置.角色AI.消息.length).toBeGreaterThanOrEqual(8);
  });

  it('旧存档的单条提示词：改过就当作附加要求保留', () => {
    const 设置 = 归一化文生图系统设置({
      角色AI: { 提示词: '我自己写的规格：只写 SFW 字段' } as never,
    });
    expect(设置.角色AI.附加要求).toBe('我自己写的规格：只写 SFW 字段');
  });

  it('消息序列会被裁剪：空内容丢掉、未知 role 退回 system', () => {
    const 设置 = 归一化文生图系统设置({
      角色AI: {
        消息: [
          { id: 'a', role: '乱写', content: '内容 A', enabled: true },
          { id: 'b', role: 'user', content: '   ', enabled: true },
          { id: 'c', role: 'assistant', content: '内容 C', enabled: false },
        ],
      } as never,
    });
    expect(设置.角色AI.消息).toHaveLength(2);
    expect(设置.角色AI.消息[0].role).toBe('system');
    expect(设置.角色AI.消息[1]).toMatchObject({ role: 'assistant', content: '内容 C', enabled: false });
  });

  it('旧存档的部分字段缺失时逐项回退，不会留下半截对象', () => {
    const 设置 = 归一化文生图系统设置({ 角色AI: { 温度: 0.3 } as never });
    expect(设置.角色AI.温度).toBe(0.3);
    expect(设置.角色AI.API).toEqual({ provider: '', baseUrl: '', apiKey: '', model: '' });
    // 没有 `提示词` 也没有 `消息` → 空白（新装形态）。
    expect(设置.角色AI.消息).toEqual([]);
  });

  it('API 覆盖字段合并保留', () => {
    const 设置 = 归一化文生图系统设置({ 角色AI: { API: { model: 'gpt-x' } } as never });
    expect(设置.角色AI.API.model).toBe('gpt-x');
    expect(设置.角色AI.API.baseUrl).toBe('');
  });
});
