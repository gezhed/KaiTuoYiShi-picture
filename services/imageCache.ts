/**
 * 图片缓存（以提示词为键的有序图廊）。
 *
 * 派生自 st-chatu8（智绘姬）的 IndexedDB 图库（index.js L3952-L5800 的
 * `utils/database.js`：`getItemImg` L4571、`setItemImg` L4622、
 * `getMergedAndSortedImages` L4011、`deleteImage` L5479）。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：原实现有服务器存储（酒馆 `/api/images/*`）与本地存储两条路径，
 *   这里只保留本地 IndexedDB；原实现把条目元数据与图片字节拆在两个库里
 *   （`configDatabase` 的元数据 + `tupianhuancun` 的 blob），这里同样拆分，
 *   但把图廊顺序显式存进条目的 `imageIds`，避免依赖遍历顺序。
 *
 * 键的语义与来源一致：**条目 id 是提示词原文的 MD5**，因此同一提示词的多次
 * 生成累积为一条有序图廊，而不是互相覆盖。
 */

import type { 缓存图片, 图片缓存条目, 生成参数快照 } from '@/models/genSystem';
import { devLogError } from '@/utils/devLog';
import { md5 } from '@/utils/md5';
import { blob转数据地址 } from '@/utils/blobEncoding';

const DB_NAME = 'KaiTuoYiShiImageCache';
const DB_VERSION = 1;
export const 缓存条目表 = 'imageCacheEntries';
export const 缓存图片表 = 'imageCacheImages';

let dbPromise: Promise<IDBDatabase> | null = null;

export function 打开图片缓存库(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const 请求 = indexedDB.open(DB_NAME, DB_VERSION);
    请求.onupgradeneeded = () => {
      const db = 请求.result;
      if (!db.objectStoreNames.contains(缓存条目表)) {
        db.createObjectStore(缓存条目表, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(缓存图片表)) {
        const 表 = db.createObjectStore(缓存图片表, { keyPath: 'id' });
        表.createIndex('entryId', 'entryId', { unique: false });
      }
    };
    请求.onsuccess = () => {
      const db = 请求.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    请求.onerror = () => {
      dbPromise = null;
      reject(请求.error ?? new Error('图片缓存库打开失败。'));
    };
  });
  return dbPromise;
}

function 包装<结果>(请求: IDBRequest<结果>): Promise<结果> {
  return new Promise((resolve, reject) => {
    请求.onsuccess = () => resolve(请求.result);
    请求.onerror = () => reject(请求.error ?? new Error('图片缓存操作失败。'));
  });
}

function 事务完成(事务: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    事务.oncomplete = () => resolve();
    事务.onerror = () => reject(事务.error ?? new Error('图片缓存事务失败。'));
    事务.onabort = () => reject(事务.error ?? new Error('图片缓存事务中止。'));
  });
}

export function 计算缓存键(提示词: string): string {
  return md5(提示词);
}

export async function 读取缓存条目(键: string): Promise<图片缓存条目 | null> {
  const db = await 打开图片缓存库();
  const 事务 = db.transaction(缓存条目表, 'readonly');
  const 结果 = await 包装<图片缓存条目 | undefined>(事务.objectStore(缓存条目表).get(键));
  return 结果 ?? null;
}

/**
 * 把一张图片追加进以提示词为键的条目。
 *
 * 条目不存在时创建；存在时把新图片 id 追加到 `imageIds` 末尾，保持生成顺序。
 */
export async function 追加缓存图片(
  提示词: string,
  图片: Blob,
  元数据: { mimeType?: string; width?: number; height?: number; genParams?: 生成参数快照 },
): Promise<{ 条目: 图片缓存条目; 图片: 缓存图片 }> {
  const 键 = 计算缓存键(提示词);
  const db = await 打开图片缓存库();
  const 图片Id = `${键}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const 时间 = Date.now();

  const 事务 = db.transaction([缓存条目表, 缓存图片表], 'readwrite');
  const 条目表 = 事务.objectStore(缓存条目表);
  const 现有 = await 包装<图片缓存条目 | undefined>(条目表.get(键));
  const 条目: 图片缓存条目 = 现有
    ? { ...现有, imageIds: [...现有.imageIds, 图片Id], updatedAt: 时间 }
    : { id: 键, prompt: 提示词, imageIds: [图片Id], createdAt: 时间, updatedAt: 时间 };

  const 记录: 缓存图片 = {
    id: 图片Id,
    entryId: 键,
    mimeType: 元数据.mimeType || 图片.type || 'image/png',
    width: 元数据.width,
    height: 元数据.height,
    size: 图片.size,
    genParams: 元数据.genParams,
    createdAt: 时间,
  };

  条目表.put(条目);
  事务.objectStore(缓存图片表).put({ ...记录, blob: 图片 });
  await 事务完成(事务);
  return { 条目, 图片: 记录 };
}

export async function 读取缓存图片(图片Id: string): Promise<{ 记录: 缓存图片; blob: Blob } | null> {
  const db = await 打开图片缓存库();
  const 事务 = db.transaction(缓存图片表, 'readonly');
  const 结果 = await 包装<(缓存图片 & { blob?: Blob }) | undefined>(事务.objectStore(缓存图片表).get(图片Id));
  if (!结果?.blob) return null;
  const { blob, ...记录 } = 结果;
  return { 记录, blob };
}

export async function 读取缓存图片数据地址(图片Id: string): Promise<string> {
  const 结果 = await 读取缓存图片(图片Id);
  if (!结果) return '';
  return blob转数据地址(结果.blob);
}

/** 由图廊索引取图；索引越界时夹到有效范围（对齐来源 L4591-L4595 的钳制行为）。 */
export async function 读取缓存条目某张(键: string, 索引 = 0): Promise<{ 条目: 图片缓存条目; 图片: 缓存图片; blob: Blob } | null> {
  const 条目 = await 读取缓存条目(键);
  if (!条目 || 条目.imageIds.length === 0) return null;
  const 位置 = Math.max(0, Math.min(条目.imageIds.length - 1, Math.trunc(索引)));
  const 结果 = await 读取缓存图片(条目.imageIds[位置]);
  if (!结果) return null;
  return { 条目, 图片: 结果.记录, blob: 结果.blob };
}

export async function 删除缓存图片(图片Id: string): Promise<void> {
  const db = await 打开图片缓存库();
  const 事务 = db.transaction([缓存条目表, 缓存图片表], 'readwrite');
  const 图片表 = 事务.objectStore(缓存图片表);
  const 记录 = await 包装<(缓存图片 & { blob?: Blob }) | undefined>(图片表.get(图片Id));
  图片表.delete(图片Id);
  if (记录?.entryId) {
    const 条目表 = 事务.objectStore(缓存条目表);
    const 条目 = await 包装<图片缓存条目 | undefined>(条目表.get(记录.entryId));
    if (条目) {
      const 剩余 = 条目.imageIds.filter((项) => 项 !== 图片Id);
      if (剩余.length === 0) 条目表.delete(条目.id);
      else 条目表.put({ ...条目, imageIds: 剩余, updatedAt: Date.now() });
    }
  }
  await 事务完成(事务);
}

export async function 删除缓存条目(键: string): Promise<void> {
  const db = await 打开图片缓存库();
  const 事务 = db.transaction([缓存条目表, 缓存图片表], 'readwrite');
  const 图片表 = 事务.objectStore(缓存图片表);
  const 索引 = 图片表.index('entryId');
  const 待删 = await 包装<IDBValidKey[]>(索引.getAllKeys(IDBKeyRange.only(键)));
  for (const 图片Id of 待删) 图片表.delete(图片Id);
  事务.objectStore(缓存条目表).delete(键);
  await 事务完成(事务);
}

export async function 清空图片缓存(): Promise<void> {
  const db = await 打开图片缓存库();
  const 事务 = db.transaction([缓存条目表, 缓存图片表], 'readwrite');
  事务.objectStore(缓存条目表).clear();
  事务.objectStore(缓存图片表).clear();
  await 事务完成(事务);
}

export interface 缓存统计 {
  条目数: number;
  图片数: number;
  总字节: number;
}

export async function 统计图片缓存(): Promise<缓存统计> {
  const db = await 打开图片缓存库();
  const 事务 = db.transaction([缓存条目表, 缓存图片表], 'readonly');
  const 条目数 = await 包装<number>(事务.objectStore(缓存条目表).count());
  const 图片列表 = await 包装<Array<缓存图片 & { blob?: Blob }>>(事务.objectStore(缓存图片表).getAll());
  return {
    条目数,
    图片数: 图片列表.length,
    总字节: 图片列表.reduce((累计, 项) => 累计 + (项.blob?.size ?? 项.size ?? 0), 0),
  };
}

/** 按条目更新时间清理过期图片；`保留天数 <= 0` 表示永久保留。 */
export async function 清理过期缓存(保留天数: number): Promise<number> {
  if (!Number.isFinite(保留天数) || 保留天数 <= 0) return 0;
  const 截止 = Date.now() - 保留天数 * 24 * 60 * 60 * 1000;
  const db = await 打开图片缓存库();
  const 事务 = db.transaction(缓存条目表, 'readonly');
  const 条目列表 = await 包装<图片缓存条目[]>(事务.objectStore(缓存条目表).getAll());
  const 过期 = 条目列表.filter((项) => 项.updatedAt < 截止);
  for (const 条目 of 过期) {
    try {
      await 删除缓存条目(条目.id);
    } catch (错误) {
      devLogError('save', 'purge-entry-failed', 错误, { 键: 条目.id });
    }
  }
  return 过期.length;
}
