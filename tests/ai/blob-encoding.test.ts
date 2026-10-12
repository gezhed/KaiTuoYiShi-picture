// @vitest-environment jsdom
/**
 * Blob → data URL 的编码实现。
 *
 * 背景：原先 7 处各自用 `FileReader.readAsDataURL`。它是宿主环境的实现，
 * 会拿自己 realm 的 `Blob` 做 `instanceof` 校验；而 `fetch(...).blob()`
 * 返回的是运行时（undici）的 Blob，某些 Node / jsdom 版本组合下两者不同源，于是：
 *   Failed to execute 'readAsDataURL' on 'FileReader': parameter 1 is not of type 'Blob'
 *   Failed to execute 'append' on 'FormData': parameter 1/2 is not of type 'Blob'
 * 下游朋友拿这份代码去优化时撞上 14 个测试失败，一度被当成产品缺陷。
 *
 * 现在统一走 `utils/blobEncoding` 的纯字节实现。这里锁死它确实等价、且不再依赖 FileReader。
 */
import { describe, expect, it, vi } from 'vitest';
import { blob转数据地址, 字节转Base64, 规范化Blob } from '@/utils/blobEncoding';

const 源字节 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0x7f]);

describe('字节转Base64', () => {
  it('与 btoa 直接编码一致', () => {
    const 二进制 = String.fromCharCode(...源字节);
    expect(字节转Base64(源字节)).toBe(btoa(二进制));
  });

  it('空字节得到空串', () => {
    expect(字节转Base64(new Uint8Array([]))).toBe('');
  });

  it('大数组不会爆调用栈（分块拼接的意义）', () => {
    // 1MB：一次性 String.fromCharCode(...arr) 会 RangeError。
    const 大 = new Uint8Array(1024 * 1024).fill(0x41);
    expect(() => 字节转Base64(大)).not.toThrow();
    expect(字节转Base64(大).length).toBeGreaterThan(1024 * 1024);
  });

  it('含 0x00 与高位字节也能正确编码（不能当成字符串处理）', () => {
    const 往返 = atob(字节转Base64(源字节));
    expect([...往返].map((c) => c.charCodeAt(0))).toEqual([...源字节]);
  });
});

describe('blob转数据地址', () => {
  it('产出可解析的 data URL，且字节逐位一致', async () => {
    const blob = new Blob([源字节], { type: 'image/png' });
    const 地址 = await blob转数据地址(blob);
    expect(地址.startsWith('data:image/png;base64,')).toBe(true);
    const 解码 = atob(地址.slice(地址.indexOf(',') + 1));
    expect([...解码].map((c) => c.charCodeAt(0))).toEqual([...源字节]);
  });

  it('没有 type 时退回 application/octet-stream（而不是产出畸形 URL）', async () => {
    const blob = new Blob([源字节]);
    const 地址 = await blob转数据地址(blob);
    expect(地址.startsWith('data:application/octet-stream;base64,')).toBe(true);
  });

  it('**完全不使用 FileReader**', async () => {
    const spy = vi.spyOn(globalThis, 'FileReader');
    const blob = new Blob([源字节], { type: 'image/png' });
    await blob转数据地址(blob);
    expect(spy, '又用回 FileReader 了，跨 realm 的老问题会回来').not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('能读 fetch 回来的 Blob（跨 realm 场景的正身）', async () => {
    const 响应 = await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==');
    const blob = await 响应.blob();
    const 地址 = await blob转数据地址(blob);
    expect(地址.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('规范化Blob', () => {
  it('重包之后仍是 Blob，且字节不变', async () => {
    const blob = new Blob([源字节], { type: 'image/png' });
    const 重包 = await 规范化Blob(blob);
    expect(重包).toBeInstanceOf(Blob);
    expect(重包.type).toBe('image/png');
    expect(new Uint8Array(await 重包.arrayBuffer())).toEqual(源字节);
  });

  it('重包后的 Blob 能安全交给 FormData（跨 realm 报错的正解）', async () => {
    const 响应 = await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==');
    const 表单 = new FormData();
    const 重包 = await 规范化Blob(await 响应.blob());
    expect(() => 表单.append('image', 重包, 'image.png')).not.toThrow();
    expect(表单.get('image')).toBeInstanceOf(Blob);
  });

  it('没有 type 时也能构造出 Blob（不能传空字符串）', async () => {
    const 重包 = await 规范化Blob(new Blob([源字节]));
    expect(重包.size).toBe(源字节.length);
    expect(重包.type).toBe('application/octet-stream');
  });
});
