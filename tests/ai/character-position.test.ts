import { describe, expect, it } from 'vitest';
import {
  网格转坐标,
  坐标转网格,
  规范化坐标,
  建网格位置,
  建数值位置,
  描述位置,
  网格描述,
  按位置排序序号,
} from '@/services/ai/imageGen/characterPosition';

describe('网格转坐标', () => {
  it('五个格子映射到 0.1..0.9，步长 0.2', () => {
    expect(网格转坐标('a1')).toEqual({ x: 0.1, y: 0.1, grid: 'a1' });
    expect(网格转坐标('c3')).toEqual({ x: 0.5, y: 0.5, grid: 'c3' });
    expect(网格转坐标('e5')).toEqual({ x: 0.9, y: 0.9, grid: 'e5' });
  });

  it('大小写与空白不敏感', () => {
    expect(网格转坐标(' B4 ')?.grid).toBe('b4');
    expect(网格转坐标('B4')).toEqual({ x: 0.3, y: 0.7, grid: 'b4' });
  });

  it('越界或格式不对返回 null', () => {
    expect(网格转坐标('f1')).toBeNull();
    expect(网格转坐标('a6')).toBeNull();
    expect(网格转坐标('a0')).toBeNull();
    expect(网格转坐标('aa1')).toBeNull();
    expect(网格转坐标('')).toBeNull();
    expect(网格转坐标('3c')).toBeNull();
  });
});

describe('坐标转网格', () => {
  it('落在网格点上才转出标记', () => {
    expect(坐标转网格(0.5, 0.5)).toBe('c3');
    expect(坐标转网格(0.1, 0.9)).toBe('a5');
    expect(坐标转网格(0.9, 0.1)).toBe('e1');
  });

  it('不在网格点上返回 null（不硬凑到最近的格子）', () => {
    expect(坐标转网格(0.2, 0.5)).toBeNull();
    expect(坐标转网格(0.5, 0.6)).toBeNull();
    expect(坐标转网格(0, 0)).toBeNull();
  });

  it('浮点误差在容差内仍算命中', () => {
    // 0.1 + 1e-9 与 0.1 相差在容差内 → 判为 a 列；y 用 0.3 落在第 2 行。
    expect(坐标转网格(0.1 + 1e-9, 0.3)).toBe('a2');
    expect(坐标转网格(0.1, 0.3 - 1e-9)).toBe('a2');
  });

  it('超出容差的浮点值不算命中', () => {
    expect(坐标转网格(0.1 + 1e-3, 0.3)).toBeNull();
  });
});

describe('规范化坐标', () => {
  it('夹到 [0,1] 并保留 3 位小数', () => {
    expect(规范化坐标(0.123456)).toBe(0.123);
    expect(规范化坐标(-1)).toBe(0);
    expect(规范化坐标(2)).toBe(1);
    expect(规范化坐标(0.987654)).toBe(0.988);
  });

  it('非有限值退回 0.5', () => {
    // 注意 Infinity 也走这条：isFinite 为假，因此不会被夹到 1。
    expect(规范化坐标(Number.NaN)).toBe(0.5);
    expect(规范化坐标(Number.POSITIVE_INFINITY)).toBe(0.5);
    expect(规范化坐标(Number.NEGATIVE_INFINITY)).toBe(0.5);
  });
});

describe('建位置', () => {
  it('建网格位置时带上 grid 标记', () => {
    expect(建网格位置('c3')).toEqual({ mode: 'grid', x: 0.5, y: 0.5, grid: 'c3' });
  });

  it('非法网格标记返回 null', () => {
    expect(建网格位置('zz9')).toBeNull();
  });

  it('数值落在网格点上时自动吸附为网格模式', () => {
    expect(建数值位置(0.5, 0.5)).toEqual({ mode: 'grid', x: 0.5, y: 0.5, grid: 'c3' });
  });

  it('数值不在网格点上时保持 center 模式', () => {
    const 位置 = 建数值位置(0.2, 0.65);
    expect(位置.mode).toBe('center');
    expect(位置.grid).toBeUndefined();
    expect(位置.x).toBe(0.2);
    expect(位置.y).toBe(0.65);
  });

  it('超范围数值先夹再判断：1 不在网格点上，故仍是 center', () => {
    // 网格只有 0.1/0.3/0.5/0.7/0.9 五个值，1 不在其中。
    expect(建数值位置(5, 5)).toEqual({ mode: 'center', x: 1, y: 1 });
  });

  it('夹到网格点上时会吸附', () => {
    expect(建数值位置(0.5, 0.5)).toEqual({ mode: 'grid', x: 0.5, y: 0.5, grid: 'c3' });
  });
});

describe('描述位置', () => {
  it('空位置说明交给模型决定', () => {
    expect(描述位置(null)).toBe('未指定（交给模型决定）');
    expect(描述位置(undefined)).toBe('未指定（交给模型决定）');
  });

  it('网格位置给出可读方位', () => {
    expect(描述位置(建网格位置('c3'))).toBe('中间·居中（c3）');
    expect(描述位置(建网格位置('a1'))).toBe('最左·最上（a1）');
    expect(描述位置(建网格位置('e5'))).toBe('最右·最下（e5）');
  });

  it('center 模式给出数值', () => {
    expect(描述位置({ mode: 'center', x: 0.2, y: 0.65 })).toBe('数值 (0.2, 0.65)');
  });

  it('grid 模式但标记缺失时退回数值', () => {
    expect(描述位置({ mode: 'grid', x: 0.2, y: 0.2 })).toBe('数值 (0.2, 0.2)');
  });

  it('网格描述对未知标记返回 null', () => {
    expect(网格描述('zz9')).toBeNull();
  });
});

describe('按位置排序序号', () => {
  it('按 x 从左到右排', () => {
    const 结果 = 按位置排序序号([
      { 序号: 1, 位置: { mode: 'center', x: 0.8, y: 0.5 } },
      { 序号: 2, 位置: { mode: 'center', x: 0.2, y: 0.5 } },
      { 序号: 3, 位置: { mode: 'center', x: 0.5, y: 0.5 } },
    ]);
    expect(结果).toEqual([2, 3, 1]);
  });

  it('未指定位置的一律排在后，内部按序号升序', () => {
    const 结果 = 按位置排序序号([
      { 序号: 3, 位置: null },
      { 序号: 1, 位置: { mode: 'center', x: 0.5, y: 0.5 } },
      { 序号: 2, 位置: undefined },
    ]);
    expect(结果).toEqual([1, 2, 3]);
  });

  it('x 相同时按序号升序（稳定）', () => {
    const 结果 = 按位置排序序号([
      { 序号: 5, 位置: { mode: 'center', x: 0.5, y: 0.1 } },
      { 序号: 2, 位置: { mode: 'center', x: 0.5, y: 0.9 } },
    ]);
    expect(结果).toEqual([2, 5]);
  });

  it('空列表返回空', () => {
    expect(按位置排序序号([])).toEqual([]);
  });

  it('不修改入参数组', () => {
    const 原 = [
      { 序号: 1, 位置: { mode: 'center' as const, x: 0.8, y: 0.5 } },
      { 序号: 2, 位置: { mode: 'center' as const, x: 0.2, y: 0.5 } },
    ];
    按位置排序序号(原);
    expect(原.map((项) => 项.序号)).toEqual([1, 2]);
  });
});
