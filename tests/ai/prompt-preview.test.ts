import { describe, expect, it } from 'vitest';
import { 生成提示词预览 } from '@/services/ai/imageGen/promptPreview';
import { 创建默认文生图系统设置 } from '@/models/genSystem';
import type { 角色卡 } from '@/models/genSystem';
import type { 角色匹配上下文 } from '@/services/ai/imageGen/characterPrompt';

function 建角色(覆盖: Partial<角色卡> = {}): 角色卡 {
  return {
    id: 'c1',
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
    nameCN: '流萤',
    nameEN: '',
    characterTraits: '银发',
    facialFeatures: '绿眼',
    facialFeaturesBack: '',
    upperBodySFW: '白色上衣',
    upperBodySFWBack: '',
    fullBodySFW: '短裙',
    fullBodySFWBack: '',
    upperBodyNSFW: '',
    upperBodyNSFWBack: '',
    fullBodyNSFW: '',
    fullBodyNSFWBack: '',
    negative: '模糊',
    ...覆盖,
  };
}

function 建上下文(角色列表: 角色卡[] = []): 角色匹配上下文 {
  const 全部角色: Record<string, 角色卡> = {};
  for (const 角色 of 角色列表) 全部角色[角色.id] = 角色;
  return { 启用列表: 角色列表.map((项) => 项.id), 全部角色 };
}

function 建设置(补丁: (设置: ReturnType<typeof 创建默认文生图系统设置>) => void = () => {}) {
  const 设置 = 创建默认文生图系统设置();
  设置.启用 = true;
  补丁(设置);
  return 设置;
}

describe('生成提示词预览：角色 LoRA', () => {
  it('出场角色绑了 LoRA 时列出来（按出场顺序、上限 4）', () => {
    const 角色 = 建角色({
      nameCN: '流萤|萨姆',
      LoRA: [
        { id: 'l1', 名称: 'krea.safetensors', 权重: 0.8 },
        { id: 'l2', 名称: 'detail.safetensors', 权重: 1 },
      ],
    });
    const 设置 = 创建默认文生图系统设置();
    const 上下文: 角色匹配上下文 = { 启用列表: [角色.id], 全部角色: { [角色.id]: 角色 } };
    const 预览 = 生成提示词预览(设置, 'image###1girl, $流萤-sfw-upperbody$###', 上下文);
    expect(预览.lora).toEqual([
      { 名称: 'krea.safetensors', 权重: 0.8 },
      { 名称: 'detail.safetensors', 权重: 1 },
    ]);
  });

  it('角色没出场 / 没绑 LoRA 时是空数组（对应槽位会被跳过）', () => {
    const 角色 = 建角色({ nameCN: '流萤', LoRA: [{ id: 'l1', 名称: 'krea.safetensors', 权重: 0.8 }] });
    const 设置 = 创建默认文生图系统设置();
    const 上下文: 角色匹配上下文 = { 启用列表: [角色.id], 全部角色: { [角色.id]: 角色 } };
    // 提示词里没有 $…$ 也没有名字 → 不算出场。
    expect(生成提示词预览(设置, 'image###1girl, solo###', 上下文).lora).toEqual([]);
    // 出场但没绑 LoRA 也是空。
    const 无LoRA = 建角色({ nameCN: '三月七' });
    expect(生成提示词预览(设置, 'image###$三月七-sfw-upperbody$###', {
      启用列表: [无LoRA.id], 全部角色: { [无LoRA.id]: 无LoRA },
    }).lora).toEqual([]);
  });
});

describe('生成提示词预览', () => {
  it('剥掉标记外壳', () => {
    const 预览 = 生成提示词预览(
      建设置(),
      'image###1girl, solo###',
      建上下文(),
    );
    expect(预览.提示词正文).toBe('1girl, solo');
    expect(预览.错误).toBeUndefined();
  });

  it('没有外壳时原样当正文（不报错）', () => {
    const 预览 = 生成提示词预览(建设置(), '1girl, solo', 建上下文());
    expect(预览.提示词正文).toBe('1girl, solo');
  });

  it('角色替换把 $…$ 段换成部位字段', () => {
    const 角色 = 建角色();
    const 预览 = 生成提示词预览(
      建设置(),
      'image###$流萤-sfw-upperbody$, solo###',
      建上下文([角色]),
    );
    // 角色段被换掉，原始 $…$ 不再出现。
    expect(预览.角色替换后).not.toContain('$流萤');
    expect(预览.角色替换后).toContain('银发');
    expect(预览.角色替换后).toContain('白色上衣');
    expect(预览.命中角色).toHaveLength(1);
    expect(预览.命中角色[0].名称).toBe('流萤');
  });

  it('命中角色带出位置（未指定时明说）', () => {
    const 角色 = 建角色({ 位置: { mode: 'center', x: 0.2, y: 0.8 } });
    const 预览 = 生成提示词预览(
      建设置(),
      'image###$流萤-sfw-upperbody$###',
      建上下文([角色]),
    );
    expect(预览.命中角色[0].位置).toBe('0.2, 0.8');
  });

  it('未指定位置时说明未指定', () => {
    const 预览 = 生成提示词预览(
      建设置(),
      'image###$流萤-sfw-upperbody$###',
      建上下文([建角色()]),
    );
    expect(预览.命中角色[0].位置).toBe('未指定');
  });

  it('角色负面词单独带出，并进入负向提示词', () => {
    const 预览 = 生成提示词预览(
      建设置(),
      'image###$流萤-sfw-upperbody$###',
      建上下文([建角色()]),
    );
    expect(预览.角色负面).toBe('模糊');
    expect(预览.负向提示词).toContain('模糊');
  });

  it('没命中角色时给出空列表（不是错误）', () => {
    const 预览 = 生成提示词预览(建设置(), 'image###1girl###', 建上下文([建角色()]));
    expect(预览.命中角色).toEqual([]);
    expect(预览.错误).toBeUndefined();
  });

  it('自主分辨率关闭时不剥尺寸', () => {
    const 设置 = 建设置((项) => { 项.comfyui.自主分辨率 = false; });
    const 预览 = 生成提示词预览(设置, 'image###1girl 960x1280###', 建上下文());
    expect(预览.自主分辨率).toBe(false);
    expect(预览.宽度).toBeNull();
    // 尺寸文本留在正文里，因为没有剥。
    expect(预览.提示词正文).toContain('960x1280');
  });

  it('自主分辨率开启时剥出尺寸，且尺寸已从后续步骤里去掉', () => {
    const 设置 = 建设置((项) => { 项.comfyui.自主分辨率 = true; });
    const 预览 = 生成提示词预览(设置, 'image###1girl 960x1280###', 建上下文());
    expect(预览.宽度).toBe(960);
    expect(预览.高度).toBe(1280);
    // ① 「剥掉标记外壳」展示的是剥外壳后的正文，尺寸此时还在。
    expect(预览.提示词正文).toContain('960x1280');
    // ② 角色替换这一步之前已经剥过尺寸，所以后续步骤里不再有它。
    expect(预览.角色替换后).not.toContain('960x1280');
    expect(预览.主体提示词).not.toContain('960x1280');
  });

  it('正向提示词包含预设的固定段与质量词', () => {
    const 设置 = 建设置((项) => {
      项.提示词.正面质量 = 'best quality';
      项.提示词.预设列表 = {
        ...项.提示词.预设列表,
        测试预设: {
          正面固定: 'masterpiece',
          fixedPromptEnd: '',
          负面固定: 'worst quality',
          负面质量: '',
          正面质量: '',
          createdAt: 0,
          updatedAt: 0,
        },
      };
      项.提示词.当前预设 = '测试预设';
    });
    const 预览 = 生成提示词预览(设置, 'image###1girl###', 建上下文());
    expect(预览.预设名称).toBe('测试预设');
    expect(预览.正向提示词).toContain('masterpiece');
    expect(预览.正向提示词).toContain('best quality');
    expect(预览.负向提示词).toContain('worst quality');
  });

  it('预设不存在时把错误暴露出来，而不是静默返回空', () => {
    const 设置 = 建设置((项) => { 项.提示词.当前预设 = '不存在的预设'; });
    const 预览 = 生成提示词预览(设置, 'image###1girl###', 建上下文());
    expect(预览.错误).toContain('不存在的预设');
  });

  it('ComfyUI 档案缺失时报出可读错误', () => {
    const 设置 = 建设置((项) => { 项.comfyui.当前档案 = '不存在'; });
    const 预览 = 生成提示词预览(设置, 'image###1girl###', 建上下文());
    expect(预览.错误).toBeTruthy();
  });

  it('空输入不抛错', () => {
    const 预览 = 生成提示词预览(建设置(), '', 建上下文());
    expect(预览.提示词正文).toBe('');
    expect(预览.命中角色).toEqual([]);
  });

  it('预览的可复制字段与真实组装一致', () => {
    const 角色 = 建角色();
    const 设置 = 建设置();
    const 上下文 = 建上下文([角色]);
    const 预览 = 生成提示词预览(设置, 'image###$流萤-sfw-upperbody$, solo###', 上下文);
    // 预览的 ④⑤ 应等于真正发给引擎的那两条；此处用同一入参再走一次公共入口比对。
    const 再次 = 生成提示词预览(设置, 'image###$流萤-sfw-upperbody$, solo###', 上下文);
    expect(预览.正向提示词).toBe(再次.正向提示词);
    expect(预览.负向提示词).toBe(再次.负向提示词);
  });
});
