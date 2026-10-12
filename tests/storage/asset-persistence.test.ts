// @vitest-environment jsdom
/**
 * 图片字节必须真正落进 `saveAssets` —— 否则重新进入后图与相册一起消失。
 *
 * 真实反馈过两次。根因：`stripSaveAssetPayloadForStorage` 只把
 * `相册.assets[].dataUrl` 改写成 `asset:<id>` 引用，**不保存字节**；
 * 字节由调用方写进独立的 `saveAssets` store。
 * `createLeafNode`（新建叶子）与 `saveGameInternal`（整档保存）都做了，
 * 而 `putHeadRow`（改活跃叶子）漏了 —— 手动生图正是走这条路。
 *
 * 这里锁定两个层次的契约：
 *   ① `extractSaveAssetRecords` 能从「引用 + 内存 blob」里提出字节记录；
 *   ② 只留引用、内存里也没有 blob 时提不出记录（说明字节真的没落盘）。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearAlbumAssetObjectUrlCache,
  getAlbumAssetCacheStats,
  rememberAlbumAssetBlob,
} from '@/utils/albumObjectUrl';
import { extractSaveAssetRecords, materializeSaveAssetRecords } from '@/utils/saveAssetStorage';
import { 创建相册资源引用 } from '@/utils/albumActions';
import type { 存档数据 } from '@/models/settings';
import type { 相册系统 } from '@/models/imageGeneration';

/** 1x1 PNG，够小又是真图片。 */
const 最小PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function 建存档(相册: 相册系统): 存档数据 {
  return { 相册 } as unknown as 存档数据;
}

function 建相册(assetId: string, dataUrl: string): 相册系统 {
  return {
    assets: [{
      id: assetId,
      dataUrl,
      source: 'generated',
      nsfw: false,
      createdAt: Date.now(),
      status: 'ready',
    }],
    entries: [{
      id: 'album_1',
      assetId,
      title: '正文插图',
      targetType: 'scene',
      slot: 'scene',
      tags: [],
      nsfw: false,
      createdAt: Date.now(),
      referenceTargets: [],
    }],
    tasks: [],
  } as 相册系统;
}

describe('图片字节的落盘提取', () => {
  beforeEach(() => {
    clearAlbumAssetObjectUrlCache();
  });

  it('内存里有 blob 时能提取出完整记录（这条是落盘的前提）', () => {
    const assetId = 'asset_test_1';
    rememberAlbumAssetBlob(assetId, new Blob(['fake-png-bytes'], { type: 'image/png' }));
    // 存档里存的是引用，字节在内存缓存里。
    const 存档 = 建存档(建相册(assetId, 创建相册资源引用(assetId)));

    const 记录 = extractSaveAssetRecords(存档);
    expect(记录).toHaveLength(1);
    expect(记录[0].id).toBe(assetId);
    expect(记录[0].blob).toBeInstanceOf(Blob);
    expect(记录[0].blob?.size).toBeGreaterThan(0);
    // 有 blob 时不该再退回去存 base64，否则存档会膨胀。
    expect(记录[0].dataUrl).toBeUndefined();
  });

  it('只有引用、内存里也没 blob 时提不出记录（即字节没落盘）', () => {
    const 存档 = 建存档(建相册('asset_missing', 创建相册资源引用('asset_missing')));
    const 记录 = extractSaveAssetRecords(存档);
    // 这正是当初的现象：相册条目还在，但字节永远取不回来。
    expect(记录).toHaveLength(0);
  });

  it('dataUrl 里直接嵌了图片时也能提取（内联 base64 的旧数据）', () => {
    const 存档 = 建存档(建相册('asset_inline', 最小PNG));
    const 记录 = extractSaveAssetRecords(存档);
    expect(记录).toHaveLength(1);
    expect(记录[0].blob ?? 记录[0].dataUrl).toBeTruthy();
  });

  it('materializeSaveAssetRecords 会把 blob 缓存起来，供加载时还原', () => {
    const 存档 = 建存档(建相册('asset_inline2', 最小PNG));
    const 记录 = materializeSaveAssetRecords(extractSaveAssetRecords(存档));
    // 还原阶段依赖「记录里的字节回到内存缓存」这件事。
    expect(getAlbumAssetCacheStats().size).toBeGreaterThan(0);
    expect(记录.every((项) => !项.dataUrl || 项.blob)).toBe(true);
  });

  it('多条资产各自独立，不会互相覆盖', () => {
    const 相册: 相册系统 = {
      assets: [
        { id: 'a1', dataUrl: 最小PNG, source: 'generated', nsfw: false, createdAt: 1, status: 'ready' },
        { id: 'a2', dataUrl: 最小PNG, source: 'generated', nsfw: false, createdAt: 2, status: 'ready' },
      ],
      entries: [],
      tasks: [],
    } as unknown as 相册系统;
    const 记录 = extractSaveAssetRecords(建存档(相册));
    expect(记录.map((项) => 项.id).sort()).toEqual(['a1', 'a2']);
  });

  it('没有相册时不抛错', () => {
    expect(extractSaveAssetRecords({} as unknown as 存档数据)).toEqual([]);
    expect(extractSaveAssetRecords(建存档({ assets: [], entries: [], tasks: [] } as unknown as 相册系统))).toEqual([]);
  });
});
