// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  解密词库文本,
  派生密钥与iv,
  归一化密文负载,
  词库口令,
} from '@/services/vocabulary/decrypt';

const 词库目录 = resolve(__dirname, '../../../st-chatu8-main/tagData');

function 读取词库文件(名称: string): Uint8Array | null {
  const 路径 = resolve(词库目录, 名称);
  if (!existsSync(路径)) return null;
  return new Uint8Array(readFileSync(路径));
}

describe('归一化密文负载', () => {
  it('识别真正的二进制密文并原样返回', () => {
    const 原始 = new Uint8Array(20);
    'Salted__'.split('').forEach((字符, i) => { 原始[i] = 字符.charCodeAt(0); });
    expect(归一化密文负载(原始)).toBe(原始);
  });

  it('把 base64 文本解回字节（上游 tagData 的实际形态）', () => {
    const 原文 = new Uint8Array([0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f, 1, 2, 3]);
    let 二进制 = '';
    原文.forEach((字节) => { 二进制 += String.fromCharCode(字节); });
    const 编码 = btoa(二进制);
    expect(归一化密文负载(new TextEncoder().encode(编码))).toEqual(原文);
  });

  it('既不是二进制也不是 base64 时原样返回', () => {
    const 原始 = new TextEncoder().encode('这不是密文');
    expect(归一化密文负载(原始)).toEqual(原始);
  });
});

describe('派生密钥与iv', () => {
  it('产出请求的长度，且密钥与 IV 段落不同', async () => {
    const 结果 = 派生密钥与iv(词库口令, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 48);
    expect(结果).toHaveLength(48);
    expect(结果.slice(0, 32)).not.toEqual(结果.slice(32, 48));
  });

  it('同一口令与盐下结果稳定（可复现）', async () => {
    const 盐 = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
    expect(派生密钥与iv(词库口令, 盐, 48)).toEqual(派生密钥与iv(词库口令, 盐, 48));
  });

  it('不同盐给出不同密钥材料', async () => {
    const 甲 = 派生密钥与iv(词库口令, new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1]), 48);
    const 乙 = 派生密钥与iv(词库口令, new Uint8Array([2, 2, 2, 2, 2, 2, 2, 2]), 48);
    expect(甲).not.toEqual(乙);
  });

  it('字节级派生：含 ≥ 0x80 的盐不会被 UTF-8 往返破坏', async () => {
    // 用同一个盐的两次调用必须一致；若内部走字符串 UTF-8 编码，长度会漂移。
    const 盐 = new Uint8Array([0xff, 0xfe, 0x01, 0x80, 0x7f, 0x00, 0xab, 0xcd]);
    const 甲 = 派生密钥与iv(词库口令, 盐, 48);
    expect(甲).toHaveLength(48);
    expect(甲).toEqual(派生密钥与iv(词库口令, 盐, 48));
  });
});

describe('解密上游真实词库文件', () => {
  const 扁平 = 读取词库文件('danbooru_001.json');
  const 分层 = 读取词库文件('tag_NSFW001.json');

  it('缺少 Salted__ 头时报出可读错误', async () => {
    // 长度需 ≥ 16 才会走到魔数检查；内容刻意不是 base64。
    await expect(解密词库文本(new TextEncoder().encode('!!!!!!!!!!!!!!!!!!!!'))).rejects.toThrow(/Salted__/);
  });

  it('文件过短时报错', async () => {
    await expect(解密词库文本(new Uint8Array([1, 2, 3]))).rejects.toThrow(/太短/);
  });

  it.skipIf(!扁平)('danbooru_001.json 解出扁平词条表', async () => {
    const 结果 = await 解密词库文本(扁平 as Uint8Array);
    const 数据 = 结果.数据 as { danbooru_tag?: Array<Record<string, unknown>> };
    expect(Array.isArray(数据.danbooru_tag)).toBe(true);
    const 首条 = 数据.danbooru_tag?.[0];
    expect(首条).toBeTruthy();
    // 上游实测字段：id_index / tag / color_id / translate / hot / aliases。
    expect(typeof 首条?.tag).toBe('string');
    expect(typeof 首条?.translate).toBe('string');
    expect(typeof 首条?.hot).toBe('number');
    expect(数据.danbooru_tag?.length).toBeGreaterThan(100);
  });

  it.skipIf(!分层)('tag_NSFW001.json 解出分层结构', async () => {
    const 结果 = await 解密词库文本(分层 as Uint8Array);
    const 数据 = 结果.数据 as {
      tag_groups?: Array<{ name?: string; subgroups?: unknown[] }>;
      tag_tags?: Array<{ text?: string; desc?: string }>;
    };
    expect(Array.isArray(数据.tag_groups)).toBe(true);
    expect(Array.isArray(数据.tag_tags)).toBe(true);
    expect(数据.tag_groups?.[0]?.name).toBe('NSFW');
    expect(数据.tag_tags?.length).toBeGreaterThan(10);
    expect(typeof 数据.tag_tags?.[0]?.text).toBe('string');
  });

  it.skipIf(!扁平)('口令错误时报出可读错误而不是抛底层异常', async () => {
    await expect(解密词库文本(扁平 as Uint8Array, 'wrong-key')).rejects.toThrow(/口令或填充校验不通过/);
  });
});
