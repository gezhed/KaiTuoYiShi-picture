import { describe, expect, it } from 'vitest';
import {
  解析NovelAI坐标,
  解析NovelAI种子,
  NovelAI默认SkipCfg,
  构造NovelAI载荷,
  构造V4载荷,
  解析分角色提示词,
  提取场景构图,
} from '@/services/ai/imageGen/novelaiPayload';
import {
  创建默认NovelAI设置,
  NovelAI参数版本,
  NovelAI支持分角色,
} from '@/models/genSystem';

const 固定随机 = () => 12345;

function 建设置(覆盖: Partial<ReturnType<typeof 创建默认NovelAI设置>> = {}) {
  return { ...创建默认NovelAI设置(), ...覆盖 };
}

describe('解析NovelAI坐标', () => {
  it('5×5 网格：a-e 映射 x、1-5 映射 y，步长 0.2 从 0.1 起', () => {
    expect(解析NovelAI坐标('a1')).toEqual({ x: 0.1, y: 0.1 });
    expect(解析NovelAI坐标('c3')).toEqual({ x: 0.5, y: 0.5 });
    expect(解析NovelAI坐标('e5')).toEqual({ x: 0.9, y: 0.9 });
    expect(解析NovelAI坐标('B4')).toEqual({ x: 0.3, y: 0.7 });
  });

  it('显式数值对，支持花括号与全角逗号', () => {
    expect(解析NovelAI坐标('{-0.25, 0.75}')).toEqual({ x: 0, y: 0.75 });
    expect(解析NovelAI坐标('0.1，0.9')).toEqual({ x: 0.1, y: 0.9 });
    expect(解析NovelAI坐标('1,1')).toEqual({ x: 1, y: 1 });
    expect(解析NovelAI坐标('2, 2')).toEqual({ x: 1, y: 1 });
  });

  it('保留 3 位小数', () => {
    expect(解析NovelAI坐标('0.123456,0.987654')).toEqual({ x: 0.123, y: 0.988 });
  });

  it('认不出来时返回空对象（交给模型自己排）', () => {
    expect(解析NovelAI坐标('')).toEqual({});
    expect(解析NovelAI坐标(undefined)).toEqual({});
    expect(解析NovelAI坐标('乱写')).toEqual({});
    // 只给一个数不算数值对。
    expect(解析NovelAI坐标('0.5')).toEqual({});
  });

  it('网格优先于数值：含字母行时按网格解', () => {
    expect(解析NovelAI坐标('c3')).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('解析NovelAI种子', () => {
  it('0 / -1 / 空 / 非数字都视为随机', () => {
    for (const 输入 of [0, -1, '', '0', '-1', 'abc', undefined]) {
      expect(解析NovelAI种子(输入, 固定随机)).toBe(12345);
    }
  });

  it('正数原样取整', () => {
    expect(解析NovelAI种子(999, 固定随机)).toBe(999);
    expect(解析NovelAI种子('42.9', 固定随机)).toBe(42);
  });
});

describe('NovelAI默认SkipCfg', () => {
  it('按模型给出三个不同档位', () => {
    expect(NovelAI默认SkipCfg('nai-diffusion-4-full')).toBe(19);
    expect(NovelAI默认SkipCfg('nai-diffusion-4-5-full')).toBe(59.04722600415217);
    expect(NovelAI默认SkipCfg('nai-diffusion-4-curated-preview')).toBe(19.343056794463642);
    expect(NovelAI默认SkipCfg('nai-diffusion-3')).toBe(19.343056794463642);
  });
});

describe('模型能力判定', () => {
  it('v5 用 params_version 4，其余 3', () => {
    expect(NovelAI参数版本('nai-diffusion-5-full')).toBe(4);
    expect(NovelAI参数版本('nai-diffusion-4-5-full')).toBe(3);
    expect(NovelAI参数版本('nai-diffusion-3')).toBe(3);
  });

  it('只有 v4/v5 支持分角色载荷', () => {
    expect(NovelAI支持分角色('nai-diffusion-4-full')).toBe(true);
    expect(NovelAI支持分角色('nai-diffusion-5-full')).toBe(true);
    expect(NovelAI支持分角色('nai-diffusion-3')).toBe(false);
  });
});

describe('构造NovelAI载荷', () => {
  it('发出上游要求的全部基础字段', () => {
    const 载荷 = 构造NovelAI载荷({
      设置: 建设置(),
      正向提示词: 'a girl',
      负向提示词: 'bad',
    }, 固定随机);

    expect(载荷).toMatchObject({
      params_version: 3,
      width: 1024,
      height: 1024,
      scale: 5,
      sampler: 'k_euler_ancestral',
      steps: 28,
      n_samples: 1,
      ucPreset: 3,
      qualityToggle: true,
      controlnet_strength: 1,
      legacy: false,
      legacy_uc: false,
      add_original_image: true,
      noise_schedule: 'karras',
      legacy_v3_extend: false,
      negative_prompt: 'bad',
      normalize_reference_strength_multiple: false,
    });
    expect(载荷.seed).toBe(12345);
  });

  it('参考图族字段必须存在且为空数组（缺失时服务端拒绝）', () => {
    const 载荷 = 构造NovelAI载荷({ 设置: 建设置(), 正向提示词: 'a', 负向提示词: '' }, 固定随机);
    expect(载荷.reference_image_multiple).toEqual([]);
    expect(载荷.reference_information_extracted_multiple).toEqual([]);
    expect(载荷.reference_strength_multiple).toEqual([]);
    expect(载荷.reference_image_multiple_cached).toEqual([]);
  });

  it('不发 msgpack 流式字段', () => {
    const 载荷 = 构造NovelAI载荷({ 设置: 建设置(), 正向提示词: 'a', 负向提示词: '' }, 固定随机);
    expect(载荷).not.toHaveProperty('stream');
  });

  it('sm_dyn 在 sm 关闭时强制为 false', () => {
    const 载荷 = 构造NovelAI载荷({
      设置: 建设置({ sm: false, sm_dyn: true }),
      正向提示词: 'a',
      负向提示词: '',
    }, 固定随机);
    expect(载荷.sm).toBe(false);
    expect(载荷.sm_dyn).toBe(false);
  });

  it('sm 打开时 sm_dyn 才可能为 true', () => {
    const 载荷 = 构造NovelAI载荷({
      设置: 建设置({ sm: true, sm_dyn: true }),
      正向提示词: 'a',
      负向提示词: '',
    }, 固定随机);
    expect(载荷.sm_dyn).toBe(true);
  });

  it('多样性增强关闭时 skip_cfg_above_sigma 发 null', () => {
    const 载荷 = 构造NovelAI载荷({
      设置: 建设置({ 多样性增强: false }),
      正向提示词: 'a',
      负向提示词: '',
    }, 固定随机);
    expect(载荷.skip_cfg_above_sigma).toBeNull();
  });

  it('覆盖尺寸与种子优先于设置', () => {
    const 载荷 = 构造NovelAI载荷({
      设置: 建设置(),
      正向提示词: 'a',
      负向提示词: '',
      宽度: 832,
      高度: 1216,
      种子: 777,
    }, 固定随机);
    expect(载荷.width).toBe(832);
    expect(载荷.height).toBe(1216);
    expect(载荷.seed).toBe(777);
  });

  it('AI 默认位置开启时不使用坐标', () => {
    const 载荷 = 构造NovelAI载荷({
      设置: 建设置({ AI默认位置: true }),
      正向提示词: 'a',
      负向提示词: '',
    }, 固定随机);
    expect(载荷.use_coords).toBe(false);
  });

  it('AI 默认位置关闭时启用坐标', () => {
    const 载荷 = 构造NovelAI载荷({
      设置: 建设置({ AI默认位置: false }),
      正向提示词: 'a',
      负向提示词: '',
    }, 固定随机);
    expect(载荷.use_coords).toBe(true);
  });

  it('旧模型（nai-diffusion-3）不发 v4 字段，characterPrompts 为空数组', () => {
    const 载荷 = 构造NovelAI载荷({
      设置: 建设置({ 模型: 'nai-diffusion-3' }),
      正向提示词: 'a',
      负向提示词: '',
      分角色: [{ prompt: 'x' }],
    }, 固定随机);
    expect(载荷.characterPrompts).toEqual([]);
    expect(载荷).not.toHaveProperty('v4_prompt');
    expect(载荷).not.toHaveProperty('v4_negative_prompt');
  });

  it('v4 模型发 v4_prompt / v4_negative_prompt', () => {
    const 载荷 = 构造NovelAI载荷({
      设置: 建设置({ 模型: 'nai-diffusion-4-5-full', AI默认位置: false }),
      正向提示词: 'scene',
      负向提示词: 'bad',
      分角色: [{ prompt: '1girl, solo', uc: 'lowres', coordinates: { x: 0.3, y: 0.3 } }],
    }, 固定随机);
    const v4 = 载荷.v4_prompt as { caption: { base_caption: string; char_captions: Array<{ char_caption: string; centers: unknown[] }> }; use_coords: boolean; use_order: boolean };
    expect(v4.caption.base_caption).toBe('scene');
    expect(v4.use_coords).toBe(true);
    expect(v4.use_order).toBe(true);
    // 分角色里 1girl 被改写成 girl。
    expect(v4.caption.char_captions[0].char_caption).toBe('girl, solo');
    expect(v4.caption.char_captions[0].centers[0]).toEqual({ x: 0.3, y: 0.3 });

    const 负 = 载荷.v4_negative_prompt as { caption: { base_caption: string }; legacy_uc: boolean };
    expect(负.caption.base_caption).toBe('bad');
    expect(负.legacy_uc).toBe(false);
  });

  it('AI 默认位置会把坐标抹成空对象，与上游一致', () => {
    const v4 = 构造V4载荷({
      正向提示词: 's',
      负向提示词: 'n',
      分角色: [{ prompt: 'girl', coordinates: { x: 0.9, y: 0.9 } }],
      使用坐标: false,
    });
    expect(v4.characterPrompts[0].center).toEqual({});
    expect(v4.v4_prompt.caption.char_captions[0].centers[0]).toEqual({});
  });

  it('空提示词的分角色被过滤掉', () => {
    const v4 = 构造V4载荷({
      正向提示词: 's',
      负向提示词: 'n',
      分角色: [{ prompt: '  ' }, { prompt: 'girl' }],
      使用坐标: true,
    });
    expect(v4.characterPrompts).toHaveLength(1);
    expect(v4.characterPrompts[0].prompt).toBe('girl');
  });

  it('网格坐标经解析后进入 characterPrompts[].center', () => {
    const 分角色 = 解析分角色提示词('Character 1 Prompt:1girl|centers:c3;');
    分角色[0].coordinates = { x: 0.5, y: 0.5 };
    const v4 = 构造V4载荷({ 正向提示词: 's', 负向提示词: 'n', 分角色, 使用坐标: true });
    expect(v4.characterPrompts[0].center).toEqual({ x: 0.5, y: 0.5 });
    expect(v4.v4_prompt.caption.char_captions[0].centers[0]).toEqual({ x: 0.5, y: 0.5 });
  });

  it('载荷输入里的参考片段覆盖基础空数组', () => {
    const 载荷 = 构造NovelAI载荷({
      设置: 建设置({ 模型: 'nai-diffusion-4-full' }),
      正向提示词: 'a',
      负向提示词: '',
      参考: {
        director_reference_images_cached: [{ cache_secret_key: 'k', data: 'D' }],
        director_reference_strength_values: [0.6],
      },
    }, 固定随机);
    expect(载荷.director_reference_images_cached).toEqual([{ cache_secret_key: 'k', data: 'D' }]);
    expect(载荷.director_reference_strength_values).toEqual([0.6]);
  });

  it('不给参考片段时基础载荷里没有 director_reference 字段', () => {
    const 载荷 = 构造NovelAI载荷({
      设置: 建设置({ 模型: 'nai-diffusion-4-full' }),
      正向提示词: 'a',
      负向提示词: '',
    }, 固定随机);
    expect(载荷).not.toHaveProperty('director_reference_images_cached');
  });
});

describe('解析分角色提示词', () => {
  it('解析 Character N Prompt / UC / centers', () => {
    const 文本 = 'Scene Composition:night city;Character 1 Prompt:1girl, solo|centers:c3;Character 1 UC:lowres;Character 2 Prompt:1boy|centers:a1;';
    const 结果 = 解析分角色提示词(文本);
    expect(结果).toHaveLength(2);
    expect(结果[0]).toEqual({ prompt: '1girl, solo', uc: 'lowres', coordinates: { x: 0.5, y: 0.5 } });
    expect(结果[1].prompt).toBe('1boy');
    expect(结果[1].coordinates).toEqual({ x: 0.1, y: 0.1 });
  });

  it('按序号升序返回，即使正文顺序打乱', () => {
    const 文本 = 'Character 2 Prompt:b;Character 1 Prompt:a;';
    expect(解析分角色提示词(文本).map((项) => 项.prompt)).toEqual(['a', 'b']);
  });

  it('没有 centers 时坐标为空对象', () => {
    expect(解析分角色提示词('Character 1 Prompt:a;')[0].coordinates).toEqual({});
  });

  it('UC 写在 Prompt 之前也能归并到同一角色', () => {
    const 文本 = 'Character 1 UC:bad;Character 1 Prompt:a;';
    const 结果 = 解析分角色提示词(文本);
    expect(结果).toHaveLength(1);
    expect(结果[0].uc).toBe('bad');
  });

  it('没有分角色段时返回空数组', () => {
    expect(解析分角色提示词('就是一段普通提示词')).toEqual([]);
    expect(解析分角色提示词('')).toEqual([]);
  });
});

describe('提取场景构图', () => {
  it('取出 Scene Composition 段', () => {
    expect(提取场景构图('Scene Composition:night city, rain;Character 1 Prompt:a;')).toBe('night city, rain');
  });

  it('没有该段时返回空串', () => {
    expect(提取场景构图('普通提示词')).toBe('');
    expect(提取场景构图('')).toBe('');
  });
});
