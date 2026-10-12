/**
 * 词库持久化。
 *
 * 派生自 st-chatu8（智绘姬）index.js L5042-L5097 的 IndexedDB 模式与
 * `installVocabulary` L6338-L6449 / `uninstallVocabulary` L6450-L6484 /
 * `getInstalledVocabularies` L6485-L6498。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-15；
 *   修改目的：① 上游把词条摊成 `tags` 表靠 cursor 全表扫检索；这里保持同一表
 *   结构（便于将来互通），但检索走内存索引，落库只为跨会话复用。
 *   ② 修掉上游安装/卸载不对称：上游安装按内容判定分层（L6340），卸载按文件名
 *   判定（L6452），导致卸载 `tag_NSFW001.json` 会残留它的分组行。此处两侧都按内容。
 */

import type { 已装词库, 词库分组, 词库子分组, 词条 } from '@/models/genSystem';
import { 解析词库数据, type 解析后的词库 } from './vocabulary';
import { devLogError } from '@/utils/devLog';

const DB_NAME = 'KaiTuoYiShiVocabulary';
const DB_VERSION = 1;
export const 词条表 = 'tags';
export const 分组表 = 'groups';
export const 子分组表 = 'subgroups';
export const 词库表 = 'vocabularies';

let dbPromise: Promise<IDBDatabase> | null = null;

export function 打开词库库(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const 请求 = indexedDB.open(DB_NAME, DB_VERSION);
    请求.onupgradeneeded = () => {
      const db = 请求.result;
      if (!db.objectStoreNames.contains(词条表)) {
        const 表 = db.createObjectStore(词条表, { keyPath: 'id', autoIncrement: true });
        表.createIndex('fileName', 'fileName', { unique: false });
      }
      if (!db.objectStoreNames.contains(分组表)) {
        const 表 = db.createObjectStore(分组表, { keyPath: 'id', autoIncrement: true });
        表.createIndex('fileName', 'fileName', { unique: false });
      }
      if (!db.objectStoreNames.contains(子分组表)) {
        const 表 = db.createObjectStore(子分组表, { keyPath: 'id', autoIncrement: true });
        表.createIndex('fileName', 'fileName', { unique: false });
      }
      if (!db.objectStoreNames.contains(词库表)) {
        db.createObjectStore(词库表, { keyPath: 'fileName' });
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
      reject(请求.error ?? new Error('词库库打开失败。'));
    };
  });
  return dbPromise;
}

function 包装<结果>(请求: IDBRequest<结果>): Promise<结果> {
  return new Promise((resolve, reject) => {
    请求.onsuccess = () => resolve(请求.result);
    请求.onerror = () => reject(请求.error ?? new Error('词库操作失败。'));
  });
}

function 事务完成(事务: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    事务.oncomplete = () => resolve();
    事务.onerror = () => reject(事务.error ?? new Error('词库事务失败。'));
    事务.onabort = () => reject(事务.error ?? new Error('词库事务中止。'));
  });
}

/** 删掉某个文件名的全部行。两侧都按内容判定，避免上游那种残留。 */
async function 清除文件行(db: IDBDatabase, 文件名: string): Promise<void> {
  const 事务 = db.transaction([词条表, 分组表, 子分组表], 'readwrite');
  for (const 表名 of [词条表, 分组表, 子分组表]) {
    const 表 = 事务.objectStore(表名);
    const 索引 = 表.index('fileName');
    const 键 = await 包装<IDBValidKey[]>(索引.getAllKeys(IDBKeyRange.only(文件名)));
    for (const 主键 of 键) 表.delete(主键);
  }
  await 事务完成(事务);
}

export interface 安装结果 {
  文件名: string;
  词条数: number;
  分组数: number;
  子分组数: number;
  分层: boolean;
}

/** 安装一份已解密的词库。重复安装同一文件名会先清空旧行。 */
export async function 安装词库(文件名: string, 数据: unknown): Promise<安装结果> {
  const 解析: 解析后的词库 = 解析词库数据(文件名, 数据);
  if (解析.词条.length === 0) {
    throw new Error(`词库 ${文件名} 里没有可用的词条，请确认选的是 st-chatu8 的 tagData 文件。`);
  }
  const db = await 打开词库库();
  await 清除文件行(db, 文件名);

  const 事务 = db.transaction([词条表, 分组表, 子分组表, 词库表], 'readwrite');
  const 词条表句柄 = 事务.objectStore(词条表);
  for (const 词条 of 解析.词条) 词条表句柄.add(词条);
  const 分组句柄 = 事务.objectStore(分组表);
  for (const 组 of 解析.分组) 分组句柄.add(组);
  const 子分组句柄 = 事务.objectStore(子分组表);
  for (const 子 of 解析.子分组) 子分组句柄.add(子);
  事务.objectStore(词库表).put({
    fileName: 文件名,
    tagCount: 解析.词条.length,
    installedDate: Date.now(),
  } satisfies 已装词库);
  await 事务完成(事务);

  return {
    文件名,
    词条数: 解析.词条.length,
    分组数: 解析.分组.length,
    子分组数: 解析.子分组.length,
    分层: 解析.分层,
  };
}

export async function 卸载词库(文件名: string): Promise<void> {
  const db = await 打开词库库();
  await 清除文件行(db, 文件名);
  const 事务 = db.transaction(词库表, 'readwrite');
  事务.objectStore(词库表).delete(文件名);
  await 事务完成(事务);
}

export async function 列出已装词库(): Promise<已装词库[]> {
  const db = await 打开词库库();
  const 事务 = db.transaction(词库表, 'readonly');
  const 列表 = await 包装<已装词库[]>(事务.objectStore(词库表).getAll());
  return 列表.sort((甲, 乙) => 甲.fileName.localeCompare(乙.fileName));
}

export async function 清空词库(): Promise<void> {
  const db = await 打开词库库();
  const 事务 = db.transaction([词条表, 分组表, 子分组表, 词库表], 'readwrite');
  for (const 表名 of [词条表, 分组表, 子分组表, 词库表]) 事务.objectStore(表名).clear();
  await 事务完成(事务);
}

export interface 词库内容 {
  词条: 词条[];
  分组: 词库分组[];
  子分组: 词库子分组[];
}

/** IndexedDB 行会带上自增主键；存储时不用它，读回来时类型上允许存在。 */
type 带主键<T> = T & { id?: number };

/** 读出全部词条与分组，供建内存检索索引。 */
export async function 读取词库内容(): Promise<词库内容> {
  const db = await 打开词库库();
  const 事务 = db.transaction([词条表, 分组表, 子分组表], 'readonly');
  const [词条列表, 分组列表, 子分组列表] = await Promise.all([
    包装<Array<带主键<词条>>>(事务.objectStore(词条表).getAll()),
    包装<Array<带主键<词库分组>>>(事务.objectStore(分组表).getAll()),
    包装<Array<带主键<词库子分组>>>(事务.objectStore(子分组表).getAll()),
  ]);
  return {
    词条: 词条列表.map(({ id: _id, ...项 }) => 项),
    分组: 分组列表.map(({ id: _id, ...项 }) => 项),
    子分组: 子分组列表.map(({ id: _id, ...项 }) => 项),
  };
}

/** 当前词库总量，用于界面展示与「是否需要重建索引」判断。 */
export async function 统计词库(): Promise<{ 词条数: number; 词库数: number }> {
  const db = await 打开词库库();
  const 事务 = db.transaction([词条表, 词库表], 'readonly');
  const [词条数, 词库数] = await Promise.all([
    包装<number>(事务.objectStore(词条表).count()),
    包装<number>(事务.objectStore(词库表).count()),
  ]);
  return { 词条数, 词库数 };
}

/** 批量导入；单个文件失败不打断其余文件，失败清单由返回值给出。 */
export async function 批量安装词库(
  文件列表: Array<{ 文件名: string; 数据: unknown }>,
): Promise<{ 成功: 安装结果[]; 失败: Array<{ 文件名: string; 原因: string }> }> {
  const 成功: 安装结果[] = [];
  const 失败: Array<{ 文件名: string; 原因: string }> = [];
  for (const 文件 of 文件列表) {
    try {
      成功.push(await 安装词库(文件.文件名, 文件.数据));
    } catch (错误) {
      const 原因 = 错误 instanceof Error ? 错误.message : String(错误);
      失败.push({ 文件名: 文件.文件名, 原因 });
      devLogError('save', 'vocabulary-install-failed', 错误, { 文件名: 文件.文件名 });
    }
  }
  return { 成功, 失败 };
}
