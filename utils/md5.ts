/**
 * MD5（RFC 1321）。
 *
 * 用途：图片缓存以**提示词原文的 MD5** 作为条目键。该键同时是「同一提示词多次生成
 * 形成有序图廊」的身份来源（st-chatu8 `getItemImg` L4571-L4584 用 CryptoJS.MD5）。
 * 协议本身来自 RFC 1321，与任何实现都不构成衍生关系。
 *
 * 不使用 WebCrypto：`crypto.subtle` 是异步且非安全上下文不可用，而缓存键在
 * 同步的 UI 分支里就要算出来（判断按钮身份、去重）。
 */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = new Uint32Array(64);
for (let i = 0; i < 64; i += 1) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
}

function 左旋(值: number, 位数: number): number {
  return ((值 << 位数) | (值 >>> (32 - 位数))) >>> 0;
}

function 编码Utf8(文本: string): Uint8Array {
  return new TextEncoder().encode(文本);
}

export function md5(输入: string): string {
  return md5Bytes(编码Utf8(输入));
}

/**
 * 字节级入口。
 *
 * 需要它的场合是「输入本来就不是文本」——例如词库解密的 EVP_BytesToKey，
 * 口令与盐都可能含 ≥ 0x80 的字节。若把那些字节塞进字符串再交给 `md5`，
 * UTF-8 编码会把 1 字节变成 2 字节，派生结果全错。
 */
export function md5Bytes(字节: Uint8Array): string {
  const 原始长度 = 字节.length;
  const 补齐长度 = (((原始长度 + 8) >> 6) + 1) * 64;
  const 缓冲 = new Uint8Array(补齐长度);
  缓冲.set(字节);
  缓冲[原始长度] = 0x80;
  const 位长度 = 原始长度 * 8;
  const 视图 = new DataView(缓冲.buffer);
  // 长度以 64 位小端写入；JS 位运算只覆盖 32 位，高位用除法取整。
  视图.setUint32(补齐长度 - 8, 位长度 >>> 0, true);
  视图.setUint32(补齐长度 - 4, Math.floor(位长度 / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const M = new Uint32Array(16);
  for (let 偏移 = 0; 偏移 < 补齐长度; 偏移 += 64) {
    for (let i = 0; i < 16; i += 1) M[i] = 视图.getUint32(偏移 + i * 4, true);

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i += 1) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + 左旋(F, S[i])) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const 输出 = new Uint8Array(16);
  const 输出视图 = new DataView(输出.buffer);
  输出视图.setUint32(0, a0, true);
  输出视图.setUint32(4, b0, true);
  输出视图.setUint32(8, c0, true);
  输出视图.setUint32(12, d0, true);
  return [...输出].map((项) => 项.toString(16).padStart(2, '0')).join('');
}
