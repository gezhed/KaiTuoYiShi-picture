/**
 * 角色媒体库（参考图 / 照片 / 音频）。
 *
 * 派生自 st-chatu8（智绘姬）`utils/configDatabase.js` 的图片与音频存取：
 *   `saveConfigImage` L7446、`getConfigImage` L7540、`deleteConfigImage` L7555、
 *   `saveConfigAudio` L7552、`getConfigAudio` L7549，以及 `normalizeMediaEntry` L24485-L24498。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-15；
 *   修改目的：上游把媒体字节存进设置同库的 `config_images`，与配置数据混在一起；
 *   这里拆成独立库，理由是媒体体量大且与存档无关——清空词库/缓存时不该连带
 *   影响角色的参考图，反之亦然。条目本身仍只存 id 与元信息，字节留在库里，
 *   这样设置对象不会随上参考图而膨胀（上游同样只在设置里留 id）。
 */

import type { 角色媒体 } from '@/models/genSystem';
import { devLog } from '@/utils/devLog';

const DB_NAME = 'KaiTuoYiShiCharacterMedia';
const DB_VERSION = 1;
export const 媒体表 = 'mediaBlobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function 打开媒体库(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const 请求 = indexedDB.open(DB_NAME, DB_VERSION);
    请求.onupgradeneeded = () => {
      const db = 请求.result;
      if (!db.objectStoreNames.contains(媒体表)) {
        db.createObjectStore(媒体表, { keyPath: 'id' });
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
      reject(请求.error ?? new Error('角色媒体库打开失败。'));
    };
  });
  return dbPromise;
}

function 包装<结果>(请求: IDBRequest<结果>): Promise<结果> {
  return new Promise((resolve, reject) => {
    请求.onsuccess = () => resolve(请求.result);
    请求.onerror = () => reject(请求.error ?? new Error('角色媒体操作失败。'));
  });
}

function 事务完成(事务: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    事务.oncomplete = () => resolve();
    事务.onerror = () => reject(事务.error ?? new Error('角色媒体事务失败。'));
    事务.onabort = () => reject(事务.error ?? new Error('角色媒体事务中止。'));
  });
}

/** 单张媒体上限，与上游图片上传路径的量级一致（12 MB）。 */
export const 媒体大小上限字节 = 12 * 1024 * 1024;

export function 生成媒体Id(): string {
  return `media_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface 保存媒体参数 {
  角色Id: string;
  blob: Blob;
  name: string;
  用途?: 角色媒体['用途'];
}

export async function 保存角色媒体(参数: 保存媒体参数): Promise<角色媒体> {
  if (参数.blob.size > 媒体大小上限字节) {
    throw new Error(`单个文件不能超过 ${Math.round(媒体大小上限字节 / 1024 / 1024)} MB。`);
  }
  if (参数.blob.size === 0) throw new Error('文件内容为空。');
  const id = 生成媒体Id();
  const db = await 打开媒体库();
  const 事务 = db.transaction(媒体表, 'readwrite');
  事务.objectStore(媒体表).put({
    id,
    characterId: 参数.角色Id,
    blob: 参数.blob,
    mimeType: 参数.blob.type || 'application/octet-stream',
    createdAt: Date.now(),
  });
  await 事务完成(事务);
  return {
    id,
    name: 参数.name || '未命名',
    mimeType: 参数.blob.type || undefined,
    用途: 参数.用途 ?? (参数.blob.type.startsWith('audio/') ? 'audio' : 'photo'),
  };
}

export async function 读取角色媒体(媒体Id: string): Promise<Blob | null> {
  const db = await 打开媒体库();
  const 事务 = db.transaction(媒体表, 'readonly');
  const 记录 = await 包装<{ blob?: Blob } | undefined>(事务.objectStore(媒体表).get(媒体Id));
  return 记录?.blob ?? null;
}

export async function 读取角色媒体数据地址(媒体Id: string): Promise<string> {
  const blob = await 读取角色媒体(媒体Id);
  if (!blob) return '';
  return new Promise<string>((resolve, reject) => {
    const 读取器 = new FileReader();
    读取器.onload = () => resolve(typeof 读取器.result === 'string' ? 读取器.result : '');
    读取器.onerror = () => reject(读取器.error ?? new Error('读取角色媒体失败。'));
    读取器.readAsDataURL(blob);
  });
}

export async function 删除角色媒体(媒体Id: string): Promise<void> {
  const db = await 打开媒体库();
  const 事务 = db.transaction(媒体表, 'readwrite');
  事务.objectStore(媒体表).delete(媒体Id);
  await 事务完成(事务);
}

/** 批量清理：删掉角色已不再引用的媒体，避免卸载角色后字节留在库里。 */
export async function 清理孤立媒体(保留Id集合: Set<string>): Promise<number> {
  const db = await 打开媒体库();
  const 事务 = db.transaction(媒体表, 'readwrite');
  const 表 = 事务.objectStore(媒体表);
  const 全部 = await 包装<Array<{ id: string }>>(表.getAll());
  let 删除数 = 0;
  for (const 记录 of 全部) {
    if (保留Id集合.has(记录.id)) continue;
    表.delete(记录.id);
    删除数 += 1;
  }
  await 事务完成(事务);
  if (删除数 > 0) devLog('save', 'character-media-orphans-purged', { 删除数 });
  return 删除数;
}

/** 统计占用，供界面展示。 */
export async function 统计角色媒体(): Promise<{ 数量: number; 总字节: number }> {
  const db = await 打开媒体库();
  const 事务 = db.transaction(媒体表, 'readonly');
  const 全部 = await 包装<Array<{ blob?: Blob }>>(事务.objectStore(媒体表).getAll());
  return {
    数量: 全部.length,
    总字节: 全部.reduce((累计, 项) => 累计 + (项.blob?.size ?? 0), 0),
  };
}
