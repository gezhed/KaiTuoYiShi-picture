import { describe, expect, it } from 'vitest';

import { 生成二维码 } from '@/utils/qrEncode';

/**
 * 金色基线：`Hello`（字节模式、纠错级别 M、版本 1、掩码 2）的标准矩阵。
 * 已对照 goQR.me 在线接口逐格核验一致（含掩码选择）。
 */
const 金色Hello = [
  '111111100111101111111',
  '100000100000101000001',
  '101110101010101011101',
  '101110101010001011101',
  '101110101100101011101',
  '100000101101001000001',
  '111111101010101111111',
  '000000001010000000000',
  '101111100101001111100',
  '000100001001111001101',
  '001111100110101101110',
  '001001011011111001100',
  '011100111110100100001',
  '000000001000100101000',
  '111111100101010010110',
  '100000101010000111110',
  '101110101001010010010',
  '101110101101111101000',
  '101110101100101100100',
  '100000100101111011100',
  '111111101100100010010',
];

function 转字符串行(qr: { modules: boolean[][] }): string[] {
  return qr.modules.map((row) => row.map((v) => (v ? '1' : '0')).join(''));
}

describe('二维码编码器', () => {
  it('Hello（字节模式 v1-M）与标准矩阵逐格一致', () => {
    const qr = 生成二维码('Hello');
    expect(qr).not.toBeNull();
    if (!qr) return;
    expect(qr.size).toBe(21);
    expect(转字符串行(qr)).toEqual(金色Hello);
  });

  it('三个定位图形与右下暗模块就位', () => {
    const qr = 生成二维码('Hello');
    expect(qr).not.toBeNull();
    if (!qr) return;
    const 定位角: Array<[number, number]> = [[0, 0], [14, 0], [0, 14]];
    for (const [左上x, 左上y] of 定位角) {
      expect(qr.modules[左上y][左上x]).toBe(true);
      expect(qr.modules[左上y + 6]?.[左上x + 6]).toBe(true);
      expect(qr.modules[左上y + 1]?.[左上x + 1]).toBe(false);
    }
    // 第 8 列、倒数第 8 行是恒暗模块
    expect(qr.modules[qr.size - 8][8]).toBe(true);
  });

  it('超出容量返回 null', () => {
    expect(生成二维码('x'.repeat(500))).toBeNull();
  });
});
