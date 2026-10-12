// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  参考类型标题,
  归一化参考强度,
  构造参考载荷,
  参考组可用,
  截断参考,
} from '@/services/ai/imageGen/novelaiReference';
import type { 角色参考条目 } from '@/models/genSystem';

function 建条目(覆盖: Partial<角色参考条目> = {}): 角色参考条目 {
  return { 媒体Id: 'm1', 类型: 'character', 强度: 0.6, 保真度: 0.6, ...覆盖 };
}

describe('参考类型标题', () => {
  it('三种类型映射到上游的 base_caption', () => {
    expect(参考类型标题('character')).toBe('character');
    expect(参考类型标题('character_style')).toBe('character&style');
    expect(参考类型标题('style')).toBe('style');
  });
});

describe('归一化参考强度', () => {
  it('未开启归一化时按总和分摊', () => {
    const 结果 = 归一化参考强度([0.6, 0.6], 'nai-diffusion-4-full', false);
    expect(结果[0]).toBeCloseTo(0.5, 6);
    expect(结果[1]).toBeCloseTo(0.5, 6);
  });

  it('总和不超过 1 时原样返回', () => {
    expect(归一化参考强度([0.3, 0.4], 'nai-diffusion-4-full', false)).toEqual([0.3, 0.4]);
  });

  it('只要总和恰好为 1 就不动', () => {
    expect(归一化参考强度([0.5, 0.5], 'nai-diffusion-4-full', false)).toEqual([0.5, 0.5]);
  });

  it('开启归一化 + 4.5 full/curated 时反而不归一化（上游语义）', () => {
    // 这条最反直觉：开关打开时把归一化交给 NAI 自己做。
    expect(归一化参考强度([0.6, 0.6], 'nai-diffusion-4-5-full', true)).toEqual([0.6, 0.6]);
    expect(归一化参考强度([0.6, 0.6], 'nai-diffusion-4-5-curated', true)).toEqual([0.6, 0.6]);
  });

  it('开启归一化但模型不是 4.5 时仍按总和分摊', () => {
    const 结果 = 归一化参考强度([0.6, 0.6], 'nai-diffusion-4-full', true);
    expect(结果[0]).toBeCloseTo(0.5, 6);
  });

  it('4.5 但归一化关闭时也分摊（两个条件都要满足才跳过）', () => {
    const 结果 = 归一化参考强度([0.6, 0.6], 'nai-diffusion-4-5-full', false);
    expect(结果[0]).toBeCloseTo(0.5, 6);
  });

  it('负数被夹到 0 再参与分摊', () => {
    const 结果 = 归一化参考强度([-1, 2], 'nai-diffusion-4-full', false);
    expect(结果[0]).toBe(0);
    expect(结果[1]).toBe(1);
  });

  it('非有限值当 0 处理', () => {
    expect(归一化参考强度([Number.NaN, Number.POSITIVE_INFINITY], 'nai-diffusion-4-full', false))
      .toEqual([0, 0]);
  });

  it('全为 0 时不做除零', () => {
    expect(归一化参考强度([0, 0], 'nai-diffusion-4-full', false)).toEqual([0, 0]);
  });

  it('空数组返回空数组', () => {
    expect(归一化参考强度([], 'nai-diffusion-4-full', false)).toEqual([]);
  });
});

describe('构造参考载荷', () => {
  const Uuid = (() => {
    let 序号 = 0;
    return () => `uuid_${序号 += 1}`;
  })();

  it('图片放 _cached 数组，非 _cached 的保持为空', () => {
    const 片段 = 构造参考载荷([建条目()], ['data:image/png;base64,AA'], 1, Uuid);
    expect(片段.director_reference_images).toEqual([]);
    expect(片段.director_reference_images_cached).toHaveLength(1);
    expect(片段.director_reference_images_cached[0].data).toBe('data:image/png;base64,AA');
    expect(typeof 片段.director_reference_images_cached[0].cache_secret_key).toBe('string');
  });

  it('每条参考生成互不相同的 cache_secret_key', () => {
    const 片段 = 构造参考载荷(
      [建条目({ 媒体Id: 'a' }), 建条目({ 媒体Id: 'b' })],
      ['d1', 'd2'],
      1,
      Uuid,
    );
    const 键 = 片段.director_reference_images_cached.map((项) => 项.cache_secret_key);
    expect(new Set(键).size).toBe(2);
  });

  it('描述带 base_caption 与 legacy_uc:false', () => {
    const 片段 = 构造参考载荷([建条目({ 类型: 'style' })], ['d'], 1, Uuid);
    expect(片段.director_reference_descriptions[0]).toEqual({
      caption: { base_caption: 'style', char_captions: [] },
      legacy_uc: false,
    });
  });

  it('信息提取按条目数展开为同一个值', () => {
    const 片段 = 构造参考载荷(
      [建条目({ 媒体Id: 'a' }), 建条目({ 媒体Id: 'b' })],
      ['d1', 'd2'],
      0.7,
      Uuid,
    );
    expect(片段.director_reference_information_extracted).toEqual([0.7, 0.7]);
  });

  it('次要强度发的是 1 - 强度，而不是存储里的保真度', () => {
    const 片段 = 构造参考载荷([建条目({ 强度: 0.6, 保真度: 0.9 })], ['d'], 1, Uuid);
    expect(片段.director_reference_strength_values).toEqual([0.6]);
    expect(片段.director_reference_secondary_strength_values[0]).toBeCloseTo(0.4, 6);
  });

  it('图片比条目少时按少的截断（不产生错位的载荷）', () => {
    const 片段 = 构造参考载荷(
      [建条目({ 媒体Id: 'a' }), 建条目({ 媒体Id: 'b' })],
      ['d1'],
      1,
      Uuid,
    );
    expect(片段.director_reference_images_cached).toHaveLength(1);
    expect(片段.director_reference_descriptions).toHaveLength(1);
    expect(片段.director_reference_strength_values).toHaveLength(1);
  });

  it('条目比图片少时同理', () => {
    const 片段 = 构造参考载荷([建条目()], ['d1', 'd2'], 1, Uuid);
    expect(片段.director_reference_images_cached).toHaveLength(1);
    expect(片段.director_reference_descriptions).toHaveLength(1);
  });

  it('空输入产出全空的六个数组', () => {
    const 片段 = 构造参考载荷([], [], 1, Uuid);
    expect(片段.director_reference_images_cached).toEqual([]);
    expect(片段.director_reference_descriptions).toEqual([]);
    expect(片段.director_reference_information_extracted).toEqual([]);
    expect(片段.director_reference_strength_values).toEqual([]);
    expect(片段.director_reference_secondary_strength_values).toEqual([]);
  });
});

describe('参考组可用', () => {
  it('至少一条带媒体 id 的条目才算可用', () => {
    expect(参考组可用(undefined)).toBe(false);
    expect(参考组可用([])).toBe(false);
    expect(参考组可用([建条目({ 媒体Id: '   ' })])).toBe(false);
    expect(参考组可用([建条目()])).toBe(true);
  });
});

describe('截断参考', () => {
  it('不超过上限时不丢弃', () => {
    const 列表 = [1, 2, 3, 4].map((序号) => 建条目({ 媒体Id: `m${序号}` }));
    expect(截断参考(列表).丢弃数).toBe(0);
    expect(截断参考(列表).保留).toHaveLength(4);
  });

  it('超过上限时保留前 4 条并报出丢弃数', () => {
    const 列表 = [1, 2, 3, 4, 5, 6].map((序号) => 建条目({ 媒体Id: `m${序号}` }));
    const 结果 = 截断参考(列表);
    expect(结果.保留).toHaveLength(4);
    expect(结果.保留.map((项) => 项.媒体Id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(结果.丢弃数).toBe(2);
  });
});
