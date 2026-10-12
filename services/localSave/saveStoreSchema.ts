/**
 * 本地文件落盘的存储 schema：内核共享，服务端与客户端都必须与此一致。
 * 恶意/意外混入 node: 依赖会污染浏览器构建，本文件只能放纯常量。
 */

/** 与 IndexedDB 中的存储同名、同 keyPath；本地文件按「每个主键一个文件」落盘。 */
export const LOCAL_SAVE_STORE_KEY_PATHS = {
  saves: 'id',
  saveSummaries: 'id',
  saveAssets: 'id',
  saveNodeDeltas: 'nodeId',
  settings: 'key',
  newestStory: 'key',
} as const;

export type LocalSaveStoreName = keyof typeof LOCAL_SAVE_STORE_KEY_PATHS;

export const LOCAL_SAVE_STORE_NAMES = Object.keys(LOCAL_SAVE_STORE_KEY_PATHS) as LocalSaveStoreName[];

export const LOCAL_SAVE_MANIFEST_VERSION = 1;

export const LOCAL_SAVE_API_PREFIX = '/api/saves';

export function localSaveStoreKeyPath(store: LocalSaveStoreName): string {
  return LOCAL_SAVE_STORE_KEY_PATHS[store];
}

export function isLocalSaveStoreName(value: string): value is LocalSaveStoreName {
  return Object.prototype.hasOwnProperty.call(LOCAL_SAVE_STORE_KEY_PATHS, value);
}

/** 单次 mutate 请求的图：按 store 分组的新增/覆盖与删除。 */
export interface LocalSaveMutation {
  /** 由客户端写入的 DB 版本，仅用于回灌时的兼容性告警。 */
  dbVersion?: number;
  updatedAt?: number;
  puts?: Partial<Record<LocalSaveStoreName, unknown[]>>;
  deletes?: Partial<Record<LocalSaveStoreName, Array<string | number>>>;
  clears?: LocalSaveStoreName[];
}
