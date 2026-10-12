import { describe, expect, it } from 'vitest';
import type { 角色AI设置, 角色卡 } from '@/models/genSystem';
import { 创建默认角色AI消息 } from '@/models/genSystem';
import {
  诊断空回,
  合并生成字段,
  构建角色特征消息,
  服装草稿转条目,
  生成角色特征,
  解析人物区块,
  解析有内容,
  角色卡为空,
  角色卡转人物文本,
  type 生成角色特征依赖,
} from '@/services/ai/imageGen/characterFeature';

function 建角色(覆盖: Partial<角色卡> = {}): 角色卡 {
  return {
    id: 'char_1',
    enabled: true,
    aliases: [],
    outfits: [],
    selectedOutfitId: '',
    photoMedia: [],
    audioMedia: [],
    selectedPhotoId: '',
    selectedAudioId: '',
    photoPrompt: '',
    sendPhoto: false,
    位置: null,
    createdAt: 0,
    updatedAt: 0,
    nameCN: '',
    nameEN: '',
    characterTraits: '',
    facialFeatures: '',
    facialFeaturesBack: '',
    upperBodySFW: '',
    upperBodySFWBack: '',
    fullBodySFW: '',
    fullBodySFWBack: '',
    upperBodyNSFW: '',
    upperBodyNSFWBack: '',
    fullBodyNSFW: '',
    fullBodyNSFWBack: '',
    negative: '',
    ...覆盖,
  };
}

/** 生效的角色 AI 配置：默认序列（含破甲）+ 不重试。 */
function 建角色AI(覆盖: Partial<角色AI设置> = {}): 角色AI设置 {
  return {
    消息: 创建默认角色AI消息(),
    附加要求: '',
    温度: 0.9,
    最大输出: 12288,
    重试次数: 0,
    API: { provider: '', baseUrl: '', apiKey: '', model: '' },
    ...覆盖,
  };
}

const 合法回复 = [
  '好的，这是按格式生成的角色：',
  '<人物>',
  '中文名称:流萤',
  '英文名称:Firefly',
  '角色特征:silver hair（银色长发）, young girl（少女）',
  '五官外貌:long silver hair（银色长发）, green eyes（绿色眼睛）',
  '五官外貌背面:silver hair back（银色发丝）',
  '上半身SFW:white coat（白色外套）',
  '上半身SFW背面:white coat back（外套背面）',
  '下半身SFW:black short skirt（黑色短裙）',
  '下半身SFW背面:black skirt back（裙摆背面）',
  '上半身NSFW:small breasts（小胸）',
  '上半身NSFW背面:bare back（光洁背部）',
  '下半身NSFW:slender legs（纤细的双腿）',
  '下半身NSFW背面:round ass（圆润的臀部）',
  '</人物>',
  '<服装>',
  '中文名称:战斗服',
  '英文名称:battle suit',
  '归属人:Firefly',
  '上半身:battle top（战斗上衣）',
  '上半身背面:battle top back',
  '下半身:battle skirt（战斗短裙）',
  '下半身背面:battle skirt back',
  '</服装>',
].join('\n');

describe('解析人物区块', () => {
  it('解析 14 个字段中的 13 个部位字段与角色特征', () => {
    const 结果 = 解析人物区块(合法回复);
    expect(结果.字段.nameCN).toBe('流萤');
    expect(结果.字段.nameEN).toBe('Firefly');
    expect(结果.字段.characterTraits).toBe('silver hair（银色长发）, young girl（少女）');
    expect(结果.字段.facialFeatures).toContain('green eyes');
    expect(结果.字段.upperBodySFW).toBe('white coat（白色外套）');
    expect(结果.字段.fullBodySFWBack).toBe('black skirt back（裙摆背面）');
    expect(结果.字段.upperBodyNSFWBack).toBe('bare back（光洁背部）');
    expect(结果.未识别).toEqual([]);
    expect(解析有内容(结果)).toBe(true);
  });

  it('剥掉思维链，只取正文里的区块', () => {
    const 回复 = '<thinking>\n<人物>\n中文名称:假的\n</人物>\n</thinking>\n<人物>\n中文名称:真的\n</人物>';
    expect(解析人物区块(回复).字段.nameCN).toBe('真的');
  });

  it('兼容全角冒号/逗号与带括号、空格的键名', () => {
    const 回复 = '<人物>\n中文名称：流萤\n五官外貌（正面）：green eyes\n下半身 SFW 背面：skirt back\n</人物>';
    const 结果 = 解析人物区块(回复);
    expect(结果.字段.nameCN).toBe('流萤');
    expect(结果.字段.facialFeatures).toBe('green eyes');
    expect(结果.字段.fullBodySFWBack).toBe('skirt back');
  });

  it('修掉上游记录过的错别字键名（下半身NSWebcam 等）', () => {
    const 回复 = [
      '<人物>',
      '中文名称:流萤',
      '下半身NSWebcam:typo value',
      '上半身NSFW_背面:upper back',
      '</人物>',
    ].join('\n');
    const 结果 = 解析人物区块(回复);
    expect(结果.字段.fullBodyNSFWBack).toBe('typo value');
    expect(结果.字段.upperBodyNSFWBack).toBe('upper back');
    expect(结果.未识别).toEqual([]);
  });

  it('不认识的键名回报到未识别里，不写进字段', () => {
    const 结果 = 解析人物区块('<人物>\n中文名称:流萤\n发色:silver\n</人物>');
    expect(结果.字段.nameCN).toBe('流萤');
    expect(结果.未识别).toEqual(['发色']);
  });

  it('服装块解析成草稿，背面两段兜进全身', () => {
    const 结果 = 解析人物区块(合法回复);
    expect(结果.服装).toHaveLength(1);
    const 草稿 = 结果.服装[0];
    expect(草稿.name).toBe('战斗服');
    expect(草稿.英文名称).toBe('battle suit');
    expect(草稿.归属人).toBe('Firefly');
    expect(草稿.上半身背面).toBe('battle top back');
    expect(草稿.全身).toBe('battle top back, battle skirt back');
  });

  it('完全没有区块时解析为空，不算有内容', () => {
    const 结果 = 解析人物区块('我不太明白你的意思。');
    expect(结果.字段).toEqual({});
    expect(结果.服装).toEqual([]);
    expect(解析有内容(结果)).toBe(false);
  });
});

describe('服装草稿转条目', () => {
  it('带上可选的英文名称/归属人/背面字段', () => {
    const 条目 = 服装草稿转条目({
      name: '战斗服', 英文名称: 'battle suit', 归属人: 'Firefly',
      上半身: 'a', 上半身背面: 'b', 下半身: 'c', 下半身背面: 'd', 全身: 'b, d', 负面: 'bad',
    }, 'o1');
    expect(条目).toMatchObject({
      id: 'o1', name: '战斗服', 英文名称: 'battle suit', 归属人: 'Firefly',
      上半身: 'a', 上半身背面: 'b', 下半身: 'c', 下半身背面: 'd', 全身: 'b, d', 负面: 'bad',
    });
  });
});

describe('构建角色特征消息', () => {
  it('默认消息序列带破甲，且顺序即预设顺序（system 会被合并）', () => {
    const 消息 = 构建角色特征消息({
      要求: '流萤，星核猎手少女，银白长发',
      角色: 建角色({ nameCN: '流萤', facialFeatures: 'green eyes' }),
      角色AI: 建角色AI(),
    });
    // 破甲（system）+ 框架 + 规格 相邻同角色合并成一条 system；
    // 中间夹着 assistant（增强定义）与 user（用户人设），所以至少三段。
    expect(消息.filter((项) => 项.role === 'system').length).toBeGreaterThanOrEqual(1);
    const 全部文本 = 消息.map((项) => 项.content).join('\n');
    expect(全部文本).toContain('小克:头好疼，我是谁？');
    // 载入噪声（ST 的 roll 宏 + 随机字符串）不该原样带进来。
    expect(全部文本).not.toContain('{{roll');
    expect(全部文本).not.toContain('sfafafd');
    expect(全部文本).toContain('正在载入');
    expect(全部文本).toContain('载入完成！');
    expect(全部文本).toContain('<人物>');
    expect(消息.at(-1)?.role).toBe('user');
    expect(消息.at(-1)?.content).toContain('流萤，星核猎手少女，银白长发');
    expect(消息.at(-1)?.content).toContain('中文名称: 流萤');
    expect(消息.at(-1)?.content).toContain('五官外貌: green eyes');
  });

  it('停用的消息不发出（讨论模式默认停用）', () => {
    const 消息 = 构建角色特征消息({ 要求: 'x', 角色AI: 建角色AI() });
    expect(消息.map((项) => 项.content).join('\n')).not.toContain('讨论完毕，开始设计');

    const 开启讨论 = 构建角色特征消息({
      要求: 'x',
      角色AI: 建角色AI({
        消息: 创建默认角色AI消息().map((项) => (项.id === 'discuss-mode' ? { ...项, enabled: true } : 项)),
      }),
    });
    expect(开启讨论.map((项) => 项.content).join('\n')).toContain('<talk>');
  });

  it('附加要求插在序列之后、本次任务之前', () => {
    const 消息 = 构建角色特征消息({ 要求: 'x', 角色AI: 建角色AI({ 附加要求: '额外要求：不要写翅膀' }) });
    const 文本 = 消息.map((项) => 项.content).join('\n');
    expect(文本).toContain('额外要求：不要写翅膀');
    // 任务段仍在最后一条 user 里（附加要求与它相邻会被合并成同一条 user，属预期）。
    expect(消息.at(-1)?.content).toContain('额外要求：不要写翅膀');
  });

  it('空角色卡时不发送「现有设定」，只说明需要从零生成', () => {
    const 消息 = 构建角色特征消息({ 要求: '随便一个角色', 角色: 建角色(), 角色AI: 建角色AI() });
    const 任务 = 消息.at(-1)?.content ?? '';
    expect(任务).toContain('（空白，需要从零生成全部字段）');
    expect(任务).not.toContain('【当前角色卡（可以改写');
  });

  it('带生成上下文时一并附上', () => {
    const 消息 = 构建角色特征消息({ 要求: 'x', 角色AI: 建角色AI(), 生成上下文: '上一轮的世界书触发' });
    expect(消息.at(-1)?.content).toContain('上一轮的世界书触发');
  });
});

describe('诊断空回', () => {
  it('安全拦截给出「换模型/中转」的处置', () => {
    expect(诊断空回({ sawReasoning: false, sawVisibleContent: false, selectedModel: 'x', finishReason: 'SAFETY' }))
      .toContain('安全策略');
  });

  it('额度耗尽点名最大输出与讨论模式', () => {
    const 文本 = 诊断空回({
      sawReasoning: false, sawVisibleContent: false, selectedModel: 'x',
      finishReason: 'MAX_TOKENS', 请求最大输出: 8192,
    });
    expect(文本).toContain('额度');
    expect(文本).toContain('8192');
    expect(文本).toContain('讨论模式');
  });

  it('只回推理内容时点名中转分流', () => {
    expect(诊断空回({ sawReasoning: true, sawVisibleContent: false, selectedModel: 'x' }))
      .toContain('reasoning_content');
  });

  it('prompt_tokens=0 时指出请求没到模型', () => {
    expect(诊断空回({
      sawReasoning: false, sawVisibleContent: false, selectedModel: 'x',
      响应结构: 'choices=1, prompt_tokens=0, completion_tokens=0',
    })).toContain('没有到达模型');
  });

  it('没有诊断信息时给通用兜底文案', () => {
    expect(诊断空回(undefined)).toContain('最大输出');
  });
});

describe('角色卡转人物文本 / 角色卡为空', () => {
  it('输出 14 行字段', () => {
    const 文本 = 角色卡转人物文本(建角色({ nameCN: '流萤', negative: 'bad hands' }));
    expect(文本.startsWith('<人物>')).toBe(true);
    expect(文本).toContain('中文名称: 流萤');
    expect(文本).toContain('角色特征: ');
    expect(文本.trimEnd().endsWith('</人物>')).toBe(true);
  });

  it('空卡判定', () => {
    expect(角色卡为空(建角色())).toBe(true);
    expect(角色卡为空(建角色({ nameCN: '流萤' }))).toBe(false);
    expect(角色卡为空(undefined)).toBe(true);
  });
});

describe('合并生成字段', () => {
  it('只写选中字段，未选中的保持原值', () => {
    const 角色 = 建角色({ nameCN: '旧名', facialFeatures: '旧五官' });
    const 下一份 = 合并生成字段(角色, { nameCN: '新名', facialFeatures: '新五官' }, ['nameCN']);
    expect(下一份.nameCN).toBe('新名');
    expect(下一份.facialFeatures).toBe('旧五官');
  });

  it('生成值为空时不覆盖已有内容（模型漏字段/被审查时尤其重要）', () => {
    const 角色 = 建角色({ upperBodyNSFW: '原内容' });
    const 下一份 = 合并生成字段(角色, { upperBodyNSFW: '   ' }, ['upperBodyNSFW']);
    expect(下一份.upperBodyNSFW).toBe('原内容');
  });
});

describe('生成角色特征（端到端，替换模型调用）', () => {
  it('把模型回复解析成字段与服装', async () => {
    const 依赖: 生成角色特征依赖 = { 请求: () => Promise.resolve(合法回复) };
    const 结果 = await 生成角色特征(依赖, { 要求: '流萤', 角色AI: 建角色AI() });
    expect(结果.字段.nameCN).toBe('流萤');
    expect(结果.服装).toHaveLength(1);
    expect(结果.原始回复).toBe(合法回复);
    expect(结果.重试次数).toBe(0);
    expect(结果.诊断).toBeUndefined();
  });

  it('第一次空回时按重试次数重问，第二次成功', async () => {
    let 次数 = 0;
    const 依赖: 生成角色特征依赖 = {
      请求: () => {
        次数 += 1;
        return Promise.resolve(次数 === 1 ? '' : 合法回复);
      },
    };
    const 结果 = await 生成角色特征(依赖, { 要求: '流萤', 角色AI: 建角色AI({ 重试次数: 2 }) });
    expect(次数).toBe(2);
    expect(结果.重试次数).toBe(1);
    expect(结果.字段.nameCN).toBe('流萤');
  });

  it('重试用尽仍为空回：不抛错，交回原文与诊断', async () => {
    let 次数 = 0;
    const 依赖: 生成角色特征依赖 = {
      请求: () => { 次数 += 1; return Promise.resolve('（空回复）'); },
      取诊断: () => ({
        sawReasoning: false, sawVisibleContent: false, selectedModel: 'x', finishReason: 'MAX_TOKENS',
      }),
    };
    const 结果 = await 生成角色特征(依赖, { 要求: '流萤', 角色AI: 建角色AI({ 重试次数: 1 }) });
    expect(次数).toBe(2);
    expect(解析有内容(结果)).toBe(false);
    expect(结果.原始回复).toBe('（空回复）');
    expect(结果.诊断).toContain('额度');
  });

  it('重试次数为 0 时只问一次', async () => {
    let 次数 = 0;
    const 依赖: 生成角色特征依赖 = { 请求: () => { 次数 += 1; return Promise.resolve('x'); } };
    await 生成角色特征(依赖, { 要求: '流萤', 角色AI: 建角色AI({ 重试次数: 0 }) });
    expect(次数).toBe(1);
  });

  it('把 signal 透传给调用方', async () => {
    const 控制器 = new AbortController();
    let 收到: AbortSignal | undefined;
    const 依赖: 生成角色特征依赖 = {
      请求: (_消息, signal) => {
        收到 = signal;
        return Promise.resolve(合法回复);
      },
    };
    await 生成角色特征(依赖, { 要求: '流萤', 角色AI: 建角色AI() }, 控制器.signal);
    expect(收到).toBe(控制器.signal);
  });
});
