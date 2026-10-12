import { describe, expect, it } from 'vitest';
import type { 角色卡 } from '@/models/genSystem';
import {
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
  it('system 就是提示词，user 里带要求与现有角色卡', () => {
    const 消息 = 构建角色特征消息({
      要求: '流萤，星核猎手少女，银白长发',
      角色: 建角色({ nameCN: '流萤', facialFeatures: 'green eyes' }),
      提示词: '【提示词】',
    });
    expect(消息).toHaveLength(2);
    expect(消息[0]).toEqual({ role: 'system', content: '【提示词】' });
    expect(消息[1].role).toBe('user');
    expect(消息[1].content).toContain('流萤，星核猎手少女，银白长发');
    expect(消息[1].content).toContain('中文名称: 流萤');
    expect(消息[1].content).toContain('五官外貌: green eyes');
  });

  it('空角色卡时不发送「现有设定」，只说明需要从零生成', () => {
    const 消息 = 构建角色特征消息({ 要求: '随便一个角色', 角色: 建角色(), 提示词: 'P' });
    expect(消息[1].content).toContain('（空白，需要从零生成全部字段）');
    expect(消息[1].content).not.toContain('五官外貌:');
  });

  it('带生成上下文时一并附上', () => {
    const 消息 = 构建角色特征消息({ 要求: 'x', 提示词: 'P', 生成上下文: '上一轮的世界书触发' });
    expect(消息[1].content).toContain('上一轮的世界书触发');
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
    const 结果 = await 生成角色特征(依赖, { 要求: '流萤', 提示词: 'P' });
    expect(结果.字段.nameCN).toBe('流萤');
    expect(结果.服装).toHaveLength(1);
    expect(结果.原始回复).toBe(合法回复);
  });

  it('模型跑偏时不抛错，把原始回复交回界面', async () => {
    const 依赖: 生成角色特征依赖 = { 请求: () => Promise.resolve('（空回复）') };
    const 结果 = await 生成角色特征(依赖, { 要求: '流萤', 提示词: 'P' });
    expect(解析有内容(结果)).toBe(false);
    expect(结果.原始回复).toBe('（空回复）');
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
    await 生成角色特征(依赖, { 要求: '流萤', 提示词: 'P' }, 控制器.signal);
    expect(收到).toBe(控制器.signal);
  });
});
