import { describe, expect, it } from 'vitest';
import {
  组装单图提示词,
  组装分角色提示词,
  取提示词预设,
  重写提示词标记,
} from '@/services/ai/imageGen/generateIllustration';
import type { 角色匹配上下文 } from '@/services/ai/imageGen/characterPrompt';
import type { 角色卡, 文生图系统设置 } from '@/models/genSystem';
import { 创建默认文生图系统设置 } from '@/models/genSystem';

function 建设置(改写?: (设置: 文生图系统设置) => void): 文生图系统设置 {
  const 设置 = 创建默认文生图系统设置();
  设置.启用 = true;
  设置.渠道 = 'comfyui';
  const 档案 = 设置.comfyui.档案列表['默认'];
  档案.连接.地址 = 'http://localhost:8188';
  档案.参数.模型 = 'model.safetensors';
  设置.提示词.预设列表['默认'] = {
    正面固定: 'fixed positive',
    fixedPromptEnd: '',
    负面固定: 'fixed negative',
    // 预设自带的负面质量词优先于全局设置。
    正面质量: 'best quality',
    负面质量: 'worst quality',
    createdAt: 0,
    updatedAt: 0,
  };
  改写?.(设置);
  return 设置;
}

const 空角色上下文: 角色匹配上下文 = { 启用列表: [], 全部角色: {} };

describe('取提示词预设', () => {
  it('取当前预设', () => {
    const 设置 = 建设置();
    expect(取提示词预设(设置).名称).toBe('默认');
  });

  it('预设缺失时抛错', () => {
    const 设置 = 建设置();
    设置.提示词.当前预设 = '不存在';
    expect(() => 取提示词预设(设置)).toThrow(/未能找到所选的固定提示词预设/);
  });

  it('随机预设开启时从列表里抽一个', () => {
    const 设置 = 建设置((项) => {
      项.提示词.预设列表['第二'] = { ...项.提示词.预设列表['默认'], 正面固定: 'other' };
      项.提示词.随机预设 = true;
    });
    const 名称 = 取提示词预设(设置).名称;
    expect(['默认', '第二']).toContain(名称);
  });

  it('预设列表为空时抛错', () => {
    const 设置 = 建设置((项) => {
      项.提示词.预设列表 = {};
    });
    expect(() => 取提示词预设(设置)).toThrow(/固定提示词预设未配置/);
  });
});

describe('组装单图提示词', () => {
  it('按 固定 + 主体 + 质量 顺序组装正面，UCP 在前组装负面', () => {
    const 组装 = 组装单图提示词(建设置(), 'image###1girl, solo###', 空角色上下文);
    expect(组装.正向提示词).toBe('fixed positive, 1girl, solo, best quality');
    expect(组装.负向提示词).toBe('worst quality, fixed negative');
  });

  it('替换规则生效并把插入段落到正确位置', () => {
    const 设置 = 建设置((项) => {
      项.提示词.替换规则列表['默认'] = {
        规则文本: 'solo=替换|alone\n触发=前置前|PRE\n触发=最后置|POST',
        createdAt: 0,
        updatedAt: 0,
      };
    });
    const 组装 = 组装单图提示词(设置, 'image###1girl, solo, 触发###', 空角色上下文);
    expect(组装.正向提示词).toBe('PRE, fixed positive, 1girl, alone, 触发, best quality, POST');
  });

  it('从提示词里剥出尺寸并回报', () => {
    const 组装 = 组装单图提示词(建设置(), 'image###1girl, 960x1280###', 空角色上下文);
    expect(组装.宽度).toBe(960);
    expect(组装.高度).toBe(1280);
    expect(组装.正向提示词).toContain('1girl');
    expect(组装.正向提示词).not.toContain('960x1280');
  });

  it('自主分辨率关闭时不采纳尺寸', () => {
    const 设置 = 建设置((项) => {
      项.comfyui.自主分辨率 = false;
    });
    const 组装 = 组装单图提示词(设置, 'image###1girl, 960x1280###', 空角色上下文);
    expect(组装.宽度).toBeNull();
    expect(组装.正向提示词).not.toContain('960x1280');
  });

  it('覆盖尺寸优先于提示词里的尺寸', () => {
    const 组装 = 组装单图提示词(建设置(), 'image###1girl, 960x1280###', 空角色上下文, {
      宽度: 512,
      高度: 512,
    });
    expect(组装.宽度).toBe(512);
    // 覆盖时不再剥，尺寸文本留在提示词里。
    expect(组装.正向提示词).toContain('960x1280');
  });

  it('角色替换与角色负面分别进入正负提示词', () => {
    const 角色: 角色卡 = {
      id: 'x',
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
      characterTraits: 'silver hair',
      facialFeatures: '',
      facialFeaturesBack: '',
      upperBodySFW: 'white coat',
      upperBodySFWBack: '',
      fullBodySFW: '',
      fullBodySFWBack: '',
      upperBodyNSFW: '',
      upperBodyNSFWBack: '',
      fullBodyNSFW: '',
      fullBodyNSFWBack: '',
      negative: 'bad hands',
    };
    const 上下文: 角色匹配上下文 = { 启用列表: ['流萤'], 全部角色: { 流萤: 角色 } };
    const 组装 = 组装单图提示词(建设置(), 'image###$流萤-sfw-upperbody$###', 上下文);
    expect(组装.正向提示词).toContain('silver hair, white coat');
    expect(组装.负向提示词).toBe('worst quality, fixed negative, bad hands');
  });

  it('配置档案不存在时抛错', () => {
    const 设置 = 建设置((项) => {
      项.comfyui.当前档案 = '不存在';
    });
    expect(() => 组装单图提示词(设置, 'image###a###', 空角色上下文)).toThrow(/ComfyUI 配置档案不存在/);
  });

  it('回报使用的预设名与主体提示词', () => {
    const 组装 = 组装单图提示词(建设置(), 'image###1girl###', 空角色上下文);
    expect(组装.预设名称).toBe('默认');
    expect(组装.主体提示词).toBe('1girl');
  });
});

describe('组装分角色提示词', () => {
  it('走替换类规则', () => {
    const 设置 = 建设置((项) => {
      项.提示词.替换规则列表['默认'] = { 规则文本: 'solo=替换|alone', createdAt: 0, updatedAt: 0 };
    });
    expect(组装分角色提示词(设置, 'solo')).toBe('alone');
  });

  it('没有规则集时原样返回', () => {
    const 设置 = 建设置((项) => {
      项.提示词.替换规则列表 = {};
    });
    expect(组装分角色提示词(设置, 'solo')).toBe('solo');
  });
});

describe('重写提示词标记', () => {
  it('把编辑后的正文包回标记并归一化标点', () => {
    expect(重写提示词标记('1girl，solo')).toBe('image###1girl, solo###');
  });
});
