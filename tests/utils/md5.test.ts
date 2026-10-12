import { describe, expect, it } from 'vitest';
import { md5 } from '@/utils/md5';

describe('md5', () => {
  it('匹配 RFC 1321 标准测试向量', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
    expect(md5('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')).toBe(
      'd174ab98d277d9f5a5611c2c9f419d9f',
    );
    expect(md5('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).toBe(
      '57edf4a22be3c955ac49da2e2107b67a',
    );
  });

  it('多字节 UTF-8 按字节而非码元哈希', () => {
    // "中文" 的 UTF-8 字节为 e4b8ad e69687，长度 6 字节。
    expect(md5('中文')).toBe('a7bac2239fcdcb3a067903d8077c4a07');
  });

  it('跨 64 字节分块边界保持一致', () => {
    // 期望值取自 Node 内置 crypto 的 MD5，作为独立参照。
    expect(md5('a'.repeat(55))).toBe('ef1772b6dff9a122358552954ad0df65');
    expect(md5('a'.repeat(56))).toBe('3b0c8ac703f828b04c6c197006d17218');
    expect(md5('a'.repeat(64))).toBe('014842d480b571495a4a0363793f7367');
    expect(md5('a'.repeat(80))).toBe('b15af9cdabbaea0516866a33d8fd0f98');
  });
});
