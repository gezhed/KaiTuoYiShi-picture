import { describe, expect, it } from 'vitest';
import {
  归一化名称,
  计算匹配分,
  查找最佳角色,
  查找最佳服装,
  拼装角色替换,
  处理角色提示词,
  清理提示词,
  归一化触发文本,
  命中启用角色,
  取别名列表,
  type 角色匹配上下文,
} from '@/services/ai/imageGen/characterPrompt';
import type { 角色卡 } from '@/models/genSystem';

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

function 建上下文(角色列表: 角色卡[], 启用列表?: string[]): 角色匹配上下文 {
  const 全部角色: Record<string, 角色卡> = {};
  for (const 角色 of 角色列表) 全部角色[角色.nameCN] = 角色;
  return { 全部角色, 启用列表: 启用列表 ?? 角色列表.map((角色) => 角色.nameCN) };
}

describe('归一化名称', () => {
  it('小写、连字符转空格、压空白', () => {
    expect(归一化名称('  Fire-Fly  ')).toBe('fire fly');
    expect(归一化名称('a\u3000b')).toBe('a b');
  });

  it('弯引号与重音符号统一成直引号', () => {
    expect(归一化名称('O\u2019Brien')).toBe("o'brien");
    expect(归一化名称('O\u2018Brien')).toBe("o'brien");
    expect(归一化名称('O\u02BCBrien')).toBe("o'brien");
    expect(归一化名称('O`Brien')).toBe("o'brien");
    expect(归一化名称('O\u00B4Brien')).toBe("o'brien");
  });

  it('直引号保持不变', () => {
    expect(归一化名称("O'Brien")).toBe("o'brien");
  });
});

describe('计算匹配分', () => {
  it('完全相等 1000 + 预设名长度', () => {
    expect(计算匹配分('abc', 'abc')).toBe(1003);
  });

  it('输入包含预设名 100 + 预设名长度', () => {
    expect(计算匹配分('abcde', 'abc')).toBe(103);
  });

  it('预设名包含输入 50 + 输入长度', () => {
    expect(计算匹配分('abc', 'abcdef')).toBe(53);
  });

  it('无关为 0，任一侧为空也为 0', () => {
    expect(计算匹配分('abc', 'xyz')).toBe(0);
    expect(计算匹配分('', 'abc')).toBe(0);
  });
});

describe('取别名列表', () => {
  it('nameCN 与 nameEN 都按 | 切分', () => {
    expect(取别名列表(建角色({ nameCN: '流萤|萨姆', nameEN: 'Firefly|SAM' })))
      .toEqual(['流萤', '萨姆', 'Firefly', 'SAM']);
  });
});

describe('查找最佳角色', () => {
  it('启用列表内命中优先', () => {
    const 甲 = 建角色({ nameCN: '流萤' });
    const 乙 = 建角色({ nameCN: '流萤火' });
    const 命中 = 查找最佳角色('流萤', 建上下文([甲, 乙], ['流萤火', '流萤']));
    expect(命中?.nameCN).toBe('流萤');
  });

  it('启用列表没命中时回退到全部角色', () => {
    const 甲 = 建角色({ nameCN: '流萤' });
    const 命中 = 查找最佳角色('流萤', 建上下文([甲], []));
    expect(命中?.nameCN).toBe('流萤');
  });

  it('完全相等优先于包含关系', () => {
    const 精确 = 建角色({ nameCN: 'sam' });
    const 包含 = 建角色({ nameCN: 'samuel' });
    expect(查找最佳角色('sam', 建上下文([精确, 包含]))?.nameCN).toBe('sam');
  });

  it('完全无关返回 null', () => {
    expect(查找最佳角色('完全无关', 建上下文([建角色({ nameCN: '流萤' })]))).toBeNull();
  });
});

describe('查找最佳服装', () => {
  it('在启用角色的服装里找', () => {
    const 角色 = 建角色({
      nameCN: '流萤',
      outfits: [{ id: 'o1', name: '战斗服', 上半身: 'battle top', 下半身: 'battle skirt', 全身: '', 负面: '' }],
    });
    expect(查找最佳服装('战斗服', 建上下文([角色]))?.name).toBe('战斗服');
  });

  it('没有启用角色时回退全部角色的服装', () => {
    const 角色 = 建角色({
      nameCN: '流萤',
      outfits: [{ id: 'o1', name: '便服', 上半身: 'casual', 下半身: '', 全身: '', 负面: '' }],
    });
    expect(查找最佳服装('便服', 建上下文([角色], []))?.name).toBe('便服');
  });
});

describe('拼装角色替换', () => {
  const 角色 = 建角色({
    nameCN: '流萤',
    characterTraits: 'silver hair',
    facialFeatures: 'green eyes',
    facialFeaturesBack: 'back hair',
    upperBodySFW: 'white coat',
    upperBodySFWBack: 'coat back',
    fullBodySFW: 'white skirt',
    fullBodySFWBack: 'skirt back',
    upperBodyNSFW: 'nsfw chest',
    negative: 'bad hands',
  });

  it('按档位与镜头方向拼装', () => {
    expect(拼装角色替换(角色, { upper: 'sfw', lower: 'sfw', fromBehind: false }).提示词)
      .toBe('silver hair, green eyes, white coat, white skirt');
  });

  it('背后视角取 *Back 字段', () => {
    expect(拼装角色替换(角色, { upper: 'sfw', lower: 'sfw', fromBehind: true }).提示词)
      .toBe('silver hair, back hair, coat back, skirt back');
  });

  it('hidden 档位不拼该部位；面部随上半身一起给（对齐上游）', () => {
    // 两个部位都 hidden：只剩角色特征。上游的后缀形式 `if (format.upper)`、
    // JSON 形式 `if (upperState !== "hidden")` 都是「要上半身才带脸」——
    // 否则「只要下半身」的写法会连脸一起注入，模型顺势给上半身镜头。
    expect(拼装角色替换(角色, { upper: 'hidden', lower: 'hidden', fromBehind: false }).提示词)
      .toBe('silver hair');
    expect(拼装角色替换(角色, { upper: 'hidden', lower: 'sfw', fromBehind: false }).提示词)
      .toBe('silver hair, white skirt');
    expect(拼装角色替换(角色, { upper: 'hidden', lower: 'sfw', fromBehind: true }).提示词)
      .toBe('silver hair, skirt back');
  });

  it('构图词原样拼在最后（用来限定取景）', () => {
    expect(拼装角色替换(角色, { upper: 'sfw', lower: 'hidden', fromBehind: false, framing: 'upper body' }).提示词)
      .toBe('silver hair, green eyes, white coat, upper body');
    expect(拼装角色替换(角色, { upper: 'hidden', lower: 'nsfw', fromBehind: false, framing: 'lower body' }).提示词)
      .toBe('silver hair, lower body');
  });

  it('nsfw 档位走 nsfw 字段，负面词单独返回', () => {
    const 结果 = 拼装角色替换(角色, { upper: 'nsfw', lower: 'hidden', fromBehind: false });
    expect(结果.提示词).toBe('silver hair, green eyes, nsfw chest');
    expect(结果.角色负面).toBe('bad hands');
  });
});

describe('处理角色提示词', () => {
  const 角色 = 建角色({
    nameCN: '流萤|萨姆',
    nameEN: 'Firefly',
    characterTraits: 'silver hair',
    upperBodySFW: 'white coat',
    fullBodySFW: 'white skirt',
    negative: 'bad hands',
  });
  const 上下文 = 建上下文([角色]);

  it('JSON 角色形式（有 angle 键）走部位替换', () => {
    const 输入 = '$流萤-sfw-upperbody-sfw-lowerbody$';
    expect(处理角色提示词(输入, 上下文).提示词).toBe('silver hair, white coat, white skirt');
  });

  it('别名参与匹配', () => {
    expect(处理角色提示词('$Firefly-sfw-upperbody$', 上下文).提示词).toBe('silver hair, white coat');
  });

  it('未识别的段原样保留，不吞掉', () => {
    expect(处理角色提示词('$不存在的人-sfw-upperbody$', 上下文).提示词)
      .toBe('$不存在的人-sfw-upperbody$');
    expect(处理角色提示词('$裸名字$', 上下文).提示词).toBe('$裸名字$');
  });

  it('角色负面词单独返回，不混进正面', () => {
    const 结果 = 处理角色提示词('$流萤-sfw-upperbody$', 上下文);
    expect(结果.提示词).not.toContain('bad hands');
    expect(结果.角色负面).toBe('bad hands');
  });

  it('多个角色段的负面词以逗号汇聚', () => {
    const 乙 = 建角色({ nameCN: '三月七', characterTraits: 'pink hair', negative: 'extra fingers' });
    const 结果 = 处理角色提示词('$流萤-sfw-upperbody$ 和 $三月七-sfw-upperbody$', 建上下文([角色, 乙]));
    expect(结果.角色负面).toBe('bad hands, extra fingers');
  });

  it('换行先转成逗号', () => {
    expect(处理角色提示词('开头\n$流萤-sfw-upperbody$', 上下文).提示词)
      .toBe('开头, silver hair, white coat');
  });

  it('服装形式（无 angle 键）走服装替换', () => {
    const 带服装 = 建角色({
      nameCN: '流萤',
      outfits: [{ id: 'o1', name: '战斗服', 上半身: 'battle top', 下半身: 'battle skirt', 全身: 'full battle', 负面: '' }],
    });
    const 结果 = 处理角色提示词('$战斗服-upperbody-lowerbody$', 建上下文([带服装]));
    expect(结果.提示词).toBe('battle top, battle skirt');
  });

  it('只要下半身时不再带脸（这正是「只出镜下半身」的关键）', () => {
    const 带脸 = 建角色({
      nameCN: '流萤',
      characterTraits: 'silver hair',
      facialFeatures: 'green eyes',
      fullBodySFW: 'white skirt',
    });
    const 上下文2 = 建上下文([带脸]);
    expect(处理角色提示词('$流萤-sfw-lowerbody$', 上下文2).提示词).toBe('silver hair, white skirt');
    expect(处理角色提示词('$流萤-sfw-upperbody$', 上下文2).提示词).toBe('silver hair, green eyes');
  });

  it('JSON 形式的 framing 原样拼出构图词', () => {
    const 输入 = '$' + JSON.stringify({ name: '流萤', angle: '', upperBody: 'sfw', lowerBody: 'hidden', framing: 'upper body' }) + '$';
    expect(处理角色提示词(输入, 上下文).提示词).toBe('silver hair, white coat, upper body');

    const 下半身 = '$' + JSON.stringify({ name: '流萤', angle: '', upperBody: 'hidden', lowerBody: 'sfw', framing: 'lower body' }) + '$';
    // 这个上下文里下半身 SFW 是「white skirt」，且不再带脸。
    expect(处理角色提示词(下半身, 上下文).提示词).toBe('silver hair, white skirt, lower body');
  });

  it('构图词也认 构图 / frame / camera 几个写法', () => {
    for (const 键 of ['framing', 'frame', 'camera', '构图']) {
      const 输入 = '$' + JSON.stringify({ name: '流萤', angle: '', upperBody: 'sfw', [键]: 'cowboy shot' }) + '$';
      expect(处理角色提示词(输入, 上下文).提示词, 键).toBe('silver hair, white coat, cowboy shot');
    }
  });

  it('服装标签同样支持构图词', () => {
    const 带服装 = 建角色({
      nameCN: '流萤',
      outfits: [{ id: 'o1', name: '战斗服', 上半身: 'battle top', 下半身: 'battle skirt', 全身: '', 负面: '' }],
    });
    // 服装也按「写了才拼」算：只写 upperBody 就只给上衣。
    const 只有上半身 = '$' + JSON.stringify({ name: '战斗服', upperBody: 'visible', framing: 'upper body' }) + '$';
    expect(处理角色提示词(只有上半身, 建上下文([带服装])).提示词).toBe('battle top, upper body');
    const 两件都显 = '$' + JSON.stringify({ name: '战斗服', upperBody: 'visible', lowerBody: 'visible', framing: 'cowboy shot' }) + '$';
    expect(处理角色提示词(两件都显, 建上下文([带服装])).提示词).toBe('battle top, battle skirt, cowboy shot');
  });

  it('服装后缀：-upperbody 只给上衣、-lowerbody 只给下装（对齐上游 hasUpper/hasLower）', () => {
    const 带服装 = 建角色({
      nameCN: '流萤',
      outfits: [{ id: 'o1', name: '战斗服', 上半身: 'battle top', 下半身: 'battle skirt', 全身: 'full battle', 负面: '' }],
    });
    const 上下文2 = 建上下文([带服装]);
    expect(处理角色提示词('$战斗服-upperbody$', 上下文2).提示词).toBe('battle top');
    expect(处理角色提示词('$战斗服-lowerbody$', 上下文2).提示词).toBe('battle skirt');
    expect(处理角色提示词('$战斗服-upperbody-lowerbody$', 上下文2).提示词).toBe('battle top, battle skirt');
  });

  it('JSON 形式带 angle 时识别为角色而非服装', () => {
    const 输入 = '$' + JSON.stringify({ name: '流萤', angle: 'from behind', upperBody: 'sfw' }) + '$';
    const 结果 = 处理角色提示词(输入, 上下文);
    expect(结果.提示词).toContain('silver hair');
  });

  it('JSON 形式不带 angle 时识别为服装', () => {
    const 带服装 = 建角色({
      nameCN: '流萤',
      outfits: [{ id: 'o1', name: '便服', 上半身: 'casual top', 下半身: 'casual skirt', 全身: '', 负面: '' }],
    });
    const 输入 = '$' + JSON.stringify({ name: '便服', upperBody: 'visible', lowerBody: 'visible' }) + '$';
    expect(处理角色提示词(输入, 建上下文([带服装])).提示词).toBe('casual top, casual skirt');
  });
});

describe('清理提示词', () => {
  it('压掉重复与首尾逗号', () => {
    expect(清理提示词('a,,, b, , c,')).toBe('a, b, c');
    expect(清理提示词(',a')).toBe('a');
  });

  it('换行转换行符加空格', () => {
    expect(清理提示词('a\r\nb')).toBe('a, b');
  });
});

describe('启用列表子串触发', () => {
  const 甲 = 建角色({ nameCN: '流萤|萨姆', nameEN: 'Firefly' });
  const 乙 = 建角色({ nameCN: '三月七', nameEN: 'March 7th' });
  const 上下文 = 建上下文([甲, 乙]);

  it('归一化触发文本去掉所有空白并小写', () => {
    expect(归一化触发文本(' 流 萤 ')).toBe('流萤');
    expect(归一化触发文本('March 7th')).toBe('march7th');
  });

  it('可以一次命中多个角色', () => {
    const 命中 = 命中启用角色('流萤和三月七都出场了', 上下文);
    expect(命中.map((角色) => 角色.nameEN).sort()).toEqual(['Firefly', 'March 7th']);
  });

  it('要求角色在启用列表里', () => {
    expect(命中启用角色('流萤', 建上下文([甲], []))).toEqual([]);
  });

  it('空白差异不影响命中', () => {
    expect(命中启用角色('March7th appears', 上下文).map((角色) => 角色.nameEN)).toEqual(['March 7th']);
  });

  it('空触发文本返回空数组', () => {
    expect(命中启用角色('   ', 上下文)).toEqual([]);
  });
});
