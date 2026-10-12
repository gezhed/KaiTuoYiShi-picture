import 'fake-indexeddb/auto';
/**
 * 落盘字节必须走**旁路表**，不能挂在相册条目上。
 *
 * 我曾为了修「四张只保住一张」把字节塞进归档条目（`{...条目, blob}`）。
 * 手动路径看起来没问题，但自动生图会把新条目直接并进相册、随存档一起写，
 * 而存档与导出都要过 `JSON.parse(JSON.stringify(save))`：
 * `Blob` 过一遍就变成 `{}` —— 字节丢了，存档结构还被弄脏。
 * 这组测试锁死「条目里不许出现 Blob」这件事。
 */
import { describe, expect, it } from 'vitest';
import {
  暂存待落盘字节, 取待落盘字节, 清理待落盘字节, 精简待落盘字节, 待落盘字节数量,
} from '@/utils/pendingAssetBytes';
import { 创建相册图片条目, 添加图片到相册 } from '@/utils/albumActions';
import { 创建空相册系统 } from '@/models/imageGeneration';
import { dataUrlToBlob, clearAlbumAssetObjectUrlCache, getAlbumAssetBlob, hasAlbumAssetBlob } from '@/utils/albumObjectUrl';

const 最小PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

describe('待落盘字节旁路表', () => {
  it('存进去能取出来', () => {
    const blob = dataUrlToBlob(最小PNG);
    if (!blob) throw new Error('测试数据构造失败');
    暂存待落盘字节('asset_x', blob);
    expect(取待落盘字节('asset_x')).toBe(blob);
    清理待落盘字节(['asset_x']);
  });

  it('id 两边的空白不影响查找（避免同图两个键）', () => {
    const blob = dataUrlToBlob(最小PNG);
    if (!blob) throw new Error('测试数据构造失败');
    暂存待落盘字节('  asset_y  ', blob);
    expect(取待落盘字节('asset_y')).toBe(blob);
    expect(待落盘字节数量()).toBeGreaterThan(0);
    清理待落盘字节(['asset_y']);
  });

  it('空 id 或空字节不写入', () => {
    const before = 待落盘字节数量();
    暂存待落盘字节('', dataUrlToBlob(最小PNG) as Blob);
    暂存待落盘字节('asset_z', undefined as unknown as Blob);
    expect(待落盘字节数量()).toBe(before);
  });

  it('清理后取不到（落盘成功即可释放）', () => {
    const blob = dataUrlToBlob(最小PNG);
    if (!blob) throw new Error('测试数据构造失败');
    暂存待落盘字节('asset_clean', blob);
    清理待落盘字节(['asset_clean']);
    expect(取待落盘字节('asset_clean')).toBeUndefined();
  });

  it('精简只保留仍在用的资产', () => {
    const blob = dataUrlToBlob(最小PNG);
    if (!blob) throw new Error('测试数据构造失败');
    暂存待落盘字节('asset_keep', blob);
    暂存待落盘字节('asset_drop', blob);
    精简待落盘字节(['asset_keep']);
    expect(取待落盘字节('asset_keep')).toBe(blob);
    expect(取待落盘字节('asset_drop')).toBeUndefined();
    清理待落盘字节(['asset_keep']);
  });

  it('不受展示缓存回收影响（这正是当初丢图的原因）', () => {
    const blob = dataUrlToBlob(最小PNG);
    if (!blob) throw new Error('测试数据构造失败');
    暂存待落盘字节('asset_survive', blob);
    // 展示缓存被清空 —— 旁路表必须还在。
    clearAlbumAssetObjectUrlCache();
    expect(取待落盘字节('asset_survive')).toBe(blob);
    清理待落盘字节(['asset_survive']);
  });
});

describe('存档提取字节时把旁路表算进去', () => {
  /*
   * 自动配图的落盘在**回合末尾**，而 stripAlbumAssetPayload 靠
   * hasAlbumAssetBlob/getAlbumAssetBlob 判断「有没有字节」。若它们只看展示缓存，
   * 缓存被回收后就会被误判成「没有字节」，dataUrl 引用照留、字节却整批丢。
   */
  it('缓存被清空后 hasAlbumAssetBlob 仍认为有字节', () => {
    const blob = dataUrlToBlob(最小PNG);
    if (!blob) throw new Error('测试数据构造失败');
    暂存待落盘字节('asset_persist', blob);
    clearAlbumAssetObjectUrlCache();
    expect(hasAlbumAssetBlob('asset_persist')).toBe(true);
    清理待落盘字节(['asset_persist']);
  });

  it('缓存被清空后 getAlbumAssetBlob 仍能取回同一份字节', () => {
    const blob = dataUrlToBlob(最小PNG);
    if (!blob) throw new Error('测试数据构造失败');
    暂存待落盘字节('asset_persist2', blob);
    clearAlbumAssetObjectUrlCache();
    expect(getAlbumAssetBlob('asset_persist2')).toBe(blob);
    清理待落盘字节(['asset_persist2']);
  });

  it('两边都没有时判定为没有字节（不能谎报有）', () => {
    clearAlbumAssetObjectUrlCache();
    清理待落盘字节(['asset_none']);
    expect(hasAlbumAssetBlob('asset_none')).toBe(false);
    expect(getAlbumAssetBlob('asset_none')).toBeUndefined();
  });
});

describe('相册条目里不能出现 Blob', () => {  it('归档产生的条目是纯数据，JSON 往返后不丢字段', () => {
    const { entry, asset } = 创建相册图片条目({
      title: '第 1 段',
      src: 最小PNG,
      source: 'generated',
      targetType: 'scene',
      slot: 'scene',
    });
    const 相册 = 添加图片到相册(创建空相册系统(), { asset, entry });

    // 模拟存档/导出的 JSON 往返。
    const 往返 = JSON.parse(JSON.stringify(相册)) as typeof 相册;
    const 回来的条目 = 往返.entries[0] as unknown as Record<string, unknown>;
    const 回来的资产 = 往返.assets[0] as unknown as Record<string, unknown>;

    expect(回来的条目).toBeDefined();
    expect(回来的资产).toBeDefined();
    // 关键：条目里不能有 Blob 字段，否则 JSON 往返会把它变成 {}。
    for (const 值 of Object.values(回来的条目)) {
      expect(值 instanceof Blob).toBe(false);
    }
    for (const 值 of Object.values(回来的资产)) {
      expect(值 instanceof Blob).toBe(false);
    }
    // 也不该有被 stringify 掏空的空对象残留。
    expect(Object.keys(回来的条目).length).toBeGreaterThan(0);
  });

  it('把 Blob 挂在条目上会破坏 JSON 往返（说明为什么不能这么做）', () => {
    const blob = dataUrlToBlob(最小PNG);
    if (!blob) throw new Error('测试数据构造失败');
    const 脏条目 = { id: 'a', title: 'x', blob };
    const 往返 = JSON.parse(JSON.stringify(脏条目)) as Record<string, unknown>;
    // 这就是当初的坑：Blob 变空对象。
    expect(往返.blob).toEqual({});
    expect(往返.blob instanceof Blob).toBe(false);
  });
});
