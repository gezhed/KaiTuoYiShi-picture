import { describe, expect, it } from 'vitest';
import { 创建默认文生图系统设置, 内置注入模板, 内置注入模板名列表 } from '@/models/genSystem';
import type { 角色卡, 服装条目, 文生图系统设置 } from '@/models/genSystem';
import {
  应用注入模板,
  取服装注入数据,
  取角色注入数据,
  生成通用服装列表文本,
  生成通用角色列表文本,
  生成角色列表文本,
  生成注入预览,
} from '@/services/ai/imageGen/characterInjection';

function 建角色(覆盖: Partial<角色卡> & { nameCN: string }): 角色卡 {
  return {
    id: 覆盖.nameCN,
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

function 建服装(覆盖: Partial<服装条目> & { id: string; name: string }): 服装条目 {
  return { 上半身: '', 下半身: '', 全身: '', 负面: '', ...覆盖 };
}

/** 把角色挂进设置，并按顺序放入当前启用预设。 */
function 建系统(角色列表: 角色卡[]): 文生图系统设置 {
  const 系统 = 创建默认文生图系统设置();
  for (const 角色 of 角色列表) 系统.角色卡[角色.id] = 角色;
  const 条目 = 角色列表.map((角色) => ({
    角色Id: 角色.id, 图片媒体Id: '', 音频媒体Id: '', 图片描述: '', 音频描述: '',
  }));
  系统.角色启用预设列表[系统.当前启用预设] = { 条目, 绑定角色卡: '', 绑定聊天: '' };
  系统.角色启用列表 = 角色列表.map((角色) => 角色.id);
  return 系统;
}

describe('应用注入模板', () => {
  it('整行占位符全空时丢掉该行，其余占位符替换成空串', () => {
    const 模板 = '中文名称：{nameCN}\n年龄：{age}\n英文名称：{nameEN}';
    expect(应用注入模板(模板, { nameCN: '流萤', nameEN: '' })).toBe('中文名称：流萤');
  });

  it('不含占位符的行原样保留', () => {
    expect(应用注入模板('表头\n中文名称：{nameCN}', { nameCN: '流萤' })).toBe('表头\n中文名称：流萤');
  });

  it('所有占位行都被丢掉时整体返回空串（上游 L29226）', () => {
    expect(应用注入模板('中文名称：{nameCN}\n英文名称：{nameEN}', {})).toBe('');
  });

  it('没有占位符时原样返回（包括空模板）', () => {
    expect(应用注入模板('纯文本', {})).toBe('纯文本');
    expect(应用注入模板('', { a: 'b' })).toBe('');
  });
});

describe('取角色注入数据', () => {
  it('同时提供 full* 与 lower* 两套别名，英文名只取第一个别名', () => {
    const 数据 = 取角色注入数据(建角色({
      nameCN: '流萤|Firefly',
      nameEN: 'Firefly|Sam',
      fullBodySFW: 'long legs',
    }));
    expect(数据.nameEN).toBe('Firefly');
    expect(数据.fullSFW).toBe('long legs');
    expect(数据.lowerSFW).toBe('long legs');
  });
});

describe('取服装注入数据', () => {
  it('背面字段缺省时回退到全身', () => {
    const 数据 = 取服装注入数据(建服装({
      id: 'o1', name: '战斗服', 上半身: 'battle top', 下半身: 'battle skirt', 全身: 'full battle',
    }));
    expect(数据.upperBody).toBe('battle top');
    expect(数据.upperBodyBack).toBe('full battle');
    expect(数据.lowerBodyBack).toBe('full battle');
  });

  it('有背面字段时优先用背面字段', () => {
    const 数据 = 取服装注入数据(建服装({
      id: 'o2', name: '便服', 上半身: 'casual', 全身: 'legacy',
      上半身背面: 'casual back', 下半身背面: 'skirt back',
    }));
    expect(数据.upperBodyBack).toBe('casual back');
    expect(数据.fullBodyBack).toBe('skirt back');
  });
});

describe('生成角色列表文本', () => {
  it('没有启用角色时给出上游文案', () => {
    expect(生成角色列表文本(创建默认文生图系统设置())).toBe('（暂无启用的角色）');
  });

  it('默认模板渲染出已填字段，空字段所在行被省略', () => {
    const 系统 = 建系统([建角色({
      nameCN: '流萤',
      nameEN: 'Firefly',
      characterTraits: 'silver hair',
      facialFeatures: 'green eyes',
    })]);
    const 文本 = 生成角色列表文本(系统);
    expect(文本).toContain('中文名称：流萤');
    expect(文本).toContain('英文名称：Firefly');
    expect(文本).toContain('角色特征：silver hair');
    expect(文本).toContain('五官外貌（正面）：green eyes');
    // 没填的部位（如上半身 SFW）不该留下空键值对。
    expect(文本).not.toContain('上半身SFW（正面）');
    expect(文本).not.toContain('角色图片：');
  });

  it('条目上绑定的图片会覆盖角色卡的选择', () => {
    const 系统 = 建系统([建角色({
      nameCN: '流萤',
      photoMedia: [{ id: 'm1', name: '默认照片', 用途: 'photo' }],
      selectedPhotoId: 'm1',
    })]);
    系统.角色启用预设列表[系统.当前启用预设].条目[0].图片媒体Id = 'm1';
    系统.角色启用预设列表[系统.当前启用预设].条目[0].图片描述 = '笑起来的照片';
    expect(生成角色列表文本(系统)).toContain('角色图片：[m1] 笑起来的照片');
  });

  it('给了触发文本就只保留命中的角色', () => {
    const 系统 = 建系统([
      建角色({ nameCN: '流萤', characterTraits: 'silver hair' }),
      建角色({ nameCN: '三月七', characterTraits: 'pink hair' }),
    ]);
    const 命中 = 生成角色列表文本(系统, '流萤抬起头看了一眼舷窗外。');
    expect(命中).toContain('流萤');
    expect(命中).not.toContain('三月七');

    expect(生成角色列表文本(系统, '没有任何人名的一句话')).toBe('（暂无被触发的角色）');
  });

  it('与文档一致：触发判定是纯子串，名字出现在词里也算命中', () => {
    const 系统 = 建系统([建角色({ nameCN: '萤', characterTraits: 'x' })]);
    expect(生成角色列表文本(系统, '流萤')).toContain('萤');
  });
});

describe('生成通用角色列表文本 / 通用服装列表文本', () => {
  it('空列表给出上游文案', () => {
    const 系统 = 创建默认文生图系统设置();
    expect(生成通用角色列表文本(系统)).toBe('暂未配置通用角色');
    expect(生成通用服装列表文本(系统)).toBe('暂未配置通用服装');
  });

  it('通用角色用简模板，一行一个', () => {
    const 系统 = 建系统([
      建角色({ nameCN: '流萤', nameEN: 'Firefly' }),
      建角色({ nameCN: '三月七', nameEN: 'March 7th' }),
    ]);
    系统.通用角色列表[系统.当前通用角色列表] = { 角色: ['流萤', '三月七'] };
    expect(生成通用角色列表文本(系统)).toBe('流萤 Firefly\n三月七 March 7th');
  });

  it('通用服装取服装池里的 id', () => {
    const 服装 = 建服装({ id: 'o1', name: '战斗服', 上半身: 'battle top', 下半身: 'battle skirt' });
    const 系统 = 建系统([建角色({ nameCN: '流萤', outfits: [服装] })]);
    系统.通用服装列表[系统.当前通用服装列表] = { 服装: ['o1'] };
    const 文本 = 生成通用服装列表文本(系统);
    expect(文本).toContain('中文名称：战斗服');
    expect(文本).toContain('上半身（正面）：battle top');
    expect(文本).toContain('下半身（正面）：battle skirt');
  });
});

describe('生成注入预览', () => {
  it('回报命中的角色与别名', () => {
    const 系统 = 建系统([建角色({ nameCN: '流萤|Firefly', characterTraits: 'x' })]);
    const 预览 = 生成注入预览(系统, 'Firefly 落地');
    expect(预览.命中).toEqual([{ 角色Id: '流萤|Firefly', 别名: 'Firefly' }]);
    expect(预览.角色列表).toContain('Firefly');
  });
});

describe('内置注入模板', () => {
  it('四套内置方案都在，且默认方案是当前默认', () => {
    expect(内置注入模板名列表).toEqual(['默认方案', 'Tavern XML 格式', 'Markdown 极简卡片', '视频注入']);
    const 系统 = 创建默认文生图系统设置();
    expect(系统.当前注入模板).toBe('默认方案');
    expect(系统.注入模板列表['默认方案'].角色列表).toBe(内置注入模板['默认方案'].角色列表);
  });
});
