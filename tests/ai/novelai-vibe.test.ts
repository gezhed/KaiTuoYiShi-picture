import { describe, expect, it } from 'vitest';
import {
  Vibe编码键,
  Vibe模型已知,
  提取Vibe编码,
  构造Vibe载荷,
  解析Vibe条目数据,
  取Vibe条目,
} from '@/services/ai/imageGen/novelaiVibe';
import { 创建默认文生图系统设置 } from '@/models/genSystem';
import type { 角色卡 } from '@/models/genSystem';

describe('Vibe编码键', () => {
  it('按上游顺序判定，curated 先于 full', () => {
    // 这一条最容易写错：4-5-curated 同时匹配 "4-5" 与 "curated"。
    expect(Vibe编码键('nai-diffusion-4-5-curated')).toBe('v4-5curated');
    expect(Vibe编码键('nai-diffusion-4-5-full')).toBe('v4-5full');
    expect(Vibe编码键('nai-diffusion-4-curated-preview')).toBe('v4curated');
    expect(Vibe编码键('nai-diffusion-4-full')).toBe('v4full');
    expect(Vibe编码键('nai-diffusion-3')).toBe('v3');
  });

  it('未知模型退回 v4-5curated（与上游一致）', () => {
    expect(Vibe编码键('some-new-model')).toBe('v4-5curated');
    expect(Vibe编码键('')).toBe('v4-5curated');
  });

  it('Vibe模型已知 只认五个已知族', () => {
    expect(Vibe模型已知('nai-diffusion-4-5-full')).toBe(true);
    expect(Vibe模型已知('nai-diffusion-3')).toBe(true);
    expect(Vibe模型已知('sd-xl')).toBe(false);
  });
});

describe('提取Vibe编码', () => {
  // params 与 encoding 平级——这是上游结构（L83923-L83932），
  // 规格书误写成 encoding 的子节点。
  const 典型文件 = {
    encodings: {
      'v4-5full': {
        abc123: {
          encoding: { data: 'ENCODING_DATA' },
          params: { information_extracted: 0.8 },
        },
      },
    },
  };

  it('取出对应模型的编码串与信息提取量', () => {
    const 结果 = 提取Vibe编码(典型文件, 'nai-diffusion-4-5-full');
    expect(结果.编码).toBe('ENCODING_DATA');
    expect(结果.信息提取量).toBe(0.8);
    expect(结果.错误).toBeUndefined();
  });

  it('params 放在 encoding 里面时取不到（照错结构写会静默退回 1）', () => {
    const 错结构 = {
      encodings: { 'v4-5full': { k: { encoding: { data: 'E', params: { information_extracted: 0.8 } } } } },
    };
    const 结果 = 提取Vibe编码(错结构, 'nai-diffusion-4-5-full');
    expect(结果.编码).toBe('E');
    expect(结果.信息提取量).toBe(1);
  });

  it('encoding 直接是字符串时也认', () => {
    const 结果 = 提取Vibe编码({
      encodings: { v4full: { k: { encoding: 'PLAIN' } } },
    }, 'nai-diffusion-4-full');
    expect(结果.编码).toBe('PLAIN');
    // 缺 params 时默认 1。
    expect(结果.信息提取量).toBe(1);
  });

  it('只取该模型下的第一个条目', () => {
    const 结果 = 提取Vibe编码({
      encodings: { v4full: { 第一: { encoding: 'FIRST' }, 第二: { encoding: 'SECOND' } } },
    }, 'nai-diffusion-4-full');
    expect(结果.编码).toBe('FIRST');
  });

  it('模型不匹配时报出可用键，便于换模型或换文件', () => {
    const 结果 = 提取Vibe编码(典型文件, 'nai-diffusion-3');
    expect(结果.编码).toBeNull();
    expect(结果.错误).toContain('v3');
    expect(结果.错误).toContain('v4-5full');
  });

  it('缺 encodings 时提示选错文件', () => {
    expect(提取Vibe编码({ foo: 1 }, 'nai-diffusion-4-full').错误).toContain('.naiv4vibe');
  });

  it('非对象输入报错', () => {
    expect(提取Vibe编码(null, 'nai-diffusion-4-full').编码).toBeNull();
    expect(提取Vibe编码('x', 'nai-diffusion-4-full').错误).toBeTruthy();
  });

  it('模型下没有条目时报错', () => {
    expect(提取Vibe编码({ encodings: { v4full: {} } }, 'nai-diffusion-4-full').错误)
      .toContain('没有任何条目');
  });

  it('缺少 encoding 字段时报结构无效（与上游 L83924 一致）', () => {
    expect(提取Vibe编码({ encodings: { v4full: { k: {} } } }, 'nai-diffusion-4-full').错误)
      .toContain('缺少 encoding 字段');
    expect(提取Vibe编码({ encodings: { v4full: { k: { encoding: null } } } }, 'nai-diffusion-4-full').错误)
      .toContain('缺少 encoding 字段');
  });

  it('编码为空字符串时报错', () => {
    expect(提取Vibe编码({ encodings: { v4full: { k: { encoding: '' } } } }, 'nai-diffusion-4-full').错误)
      .toBe('编码字段为空。');
  });

  it('params 不是对象时信息提取量退回 1', () => {
    const 结果 = 提取Vibe编码({ encodings: { v4full: { k: { encoding: 'E', params: 5 } } } }, 'nai-diffusion-4-full');
    expect(结果.信息提取量).toBe(1);
  });

  it('information_extracted 为 0 时退回 1（上游用 || 1）', () => {
    const 结果 = 提取Vibe编码({
      encodings: { v4full: { k: { encoding: 'E', params: { information_extracted: 0 } } } },
    }, 'nai-diffusion-4-full');
    expect(结果.信息提取量).toBe(1);
  });
});

describe('构造Vibe载荷', () => {
  const Uuid = (() => {
    let 序号 = 0;
    return () => `u${序号 += 1}`;
  })();

  it('三条数组按下标对应，非 cached 的保持为空', () => {
    const 片段 = 构造Vibe载荷(
      [{ 强度: 0.6 }, { 强度: 0.4 }],
      ['E1', 'E2'],
      [1, 0.8],
      Uuid,
    );
    expect(片段.reference_image_multiple).toEqual([]);
    expect(片段.reference_image_multiple_cached.map((项) => 项.data)).toEqual(['E1', 'E2']);
    expect(片段.reference_strength_multiple).toEqual([0.6, 0.4]);
    expect(片段.reference_information_extracted_multiple).toEqual([1, 0.8]);
    expect(new Set(片段.reference_image_multiple_cached.map((项) => 项.cache_secret_key)).size).toBe(2);
  });

  it('长度不一致时按短的截断（避免强度配错图）', () => {
    const 片段 = 构造Vibe载荷([{ 强度: 0.6 }, { 强度: 0.4 }], ['E1'], [1, 1], Uuid);
    expect(片段.reference_image_multiple_cached).toHaveLength(1);
    expect(片段.reference_strength_multiple).toHaveLength(1);
    expect(片段.reference_information_extracted_multiple).toHaveLength(1);
  });

  it('空输入产出空数组', () => {
    const 片段 = 构造Vibe载荷([], [], [], Uuid);
    expect(片段.reference_image_multiple_cached).toEqual([]);
    expect(片段.reference_strength_multiple).toEqual([]);
  });
});

describe('解析Vibe条目数据', () => {
  it('把条目里的 JSON 文本解成编码', () => {
    const 结果 = 解析Vibe条目数据(
      { 媒体Id: JSON.stringify({ encodings: { v4full: { k: { encoding: 'E' } } } }), 类型: 'style', 强度: 0.6, 保真度: 0.6 },
      'nai-diffusion-4-full',
    );
    expect(结果.编码).toBe('E');
  });

  it('非法 JSON 报出可读错误', () => {
    const 结果 = 解析Vibe条目数据(
      { 媒体Id: '不是 JSON', 类型: 'style', 强度: 0.6, 保真度: 0.6 },
      'nai-diffusion-4-full',
    );
    expect(结果.编码).toBeNull();
    expect(结果.错误).toContain('不是合法 JSON');
  });

  it('空条目直接报错', () => {
    const 结果 = 解析Vibe条目数据(
      { 媒体Id: '   ', 类型: 'style', 强度: 0.6, 保真度: 0.6 },
      'nai-diffusion-4-full',
    );
    expect(结果.错误).toBe('Vibe 条目为空。');
  });
});

describe('取Vibe条目', () => {
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

  function 建设置(角色: 角色卡, 模式: 'character' | 'vibe') {
    const 设置 = 创建默认文生图系统设置();
    设置.novelai.参考模式 = 模式;
    设置.角色卡 = { [角色.id]: 角色 };
    设置.角色启用列表 = [角色.id];
    return 设置;
  }

  it('参考模式为 vibe 时取出该角色的条目', () => {
    const 角色 = 建角色({
      参考组: {
        references: [{ 媒体Id: '{"encodings":{}}', 类型: 'style', 强度: 0.6, 保真度: 0.6 }],
        createdAt: 0,
        updatedAt: 0,
      },
    });
    const 结果 = 取Vibe条目(建设置(角色, 'vibe'));
    expect(结果).toHaveLength(1);
    expect(结果[0].角色名).toBe('流萤');
  });

  it('参考模式为 character 时不取 Vibe', () => {
    const 角色 = 建角色({
      参考组: {
        references: [{ 媒体Id: '{"encodings":{}}', 类型: 'style', 强度: 0.6, 保真度: 0.6 }],
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(取Vibe条目(建设置(角色, 'character'))).toEqual([]);
  });

  it('没有参考组时返回空', () => {
    expect(取Vibe条目(建设置(建角色(), 'vibe'))).toEqual([]);
  });

  it('超过上限时截到 4 条', () => {
    const 条目 = [1, 2, 3, 4, 5].map(() => ({
      媒体Id: '{"encodings":{}}', 类型: 'style' as const, 强度: 0.6, 保真度: 0.6,
    }));
    const 角色 = 建角色({ 参考组: { references: 条目, createdAt: 0, updatedAt: 0 } });
    expect(取Vibe条目(建设置(角色, 'vibe'))).toHaveLength(4);
  });

  it('跳过媒体 id 为空的条目', () => {
    const 角色 = 建角色({
      参考组: {
        references: [{ 媒体Id: '  ', 类型: 'style', 强度: 0.6, 保真度: 0.6 }],
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(取Vibe条目(建设置(角色, 'vibe'))).toEqual([]);
  });
});
