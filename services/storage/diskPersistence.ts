/**
 * 本地落盘的客户端编排：把 IDB 写穿透镜像合并、防抖后写进 save/ 目录，
 * 并在每次启动、浏览器缓存被清空后从磁盘回灌整个数据库。
 *
 * 真相归属：磁盘是持久真相，IndexedDB 只是本次会话的加速缓存；两者由写穿透保持同步。
 * 服务端不可用时（例如部署到线上）全部静默降级为纯 IndexedDB，行为与改造前一致。
 */
import { openDB, SAVES_STORE } from './dbConnection';
import { installDbWriteSink, type DbWriteBatch } from './idbWriteMirror';
import {
  LOCAL_SAVE_API_PREFIX,
  LOCAL_SAVE_STORE_NAMES,
  isLocalSaveStoreName,
  localSaveStoreKeyPath,
  type LocalSaveMutation,
  type LocalSaveStoreName,
} from '@/services/localSave/saveStoreSchema';
import { UNIFIED_ID_DB_VERSION } from '@/utils/id';
import { toError } from '@/utils/storageUtils';
import { devLog, devLogError } from '@/utils/devLog';

const FLUSH_DELAY_MS = 250;
const FLUSH_RETRY_MS = 3000;
const PAGE_LIMIT = 50;
const MAX_PENDING_OPS = 4000;
const SYNC_MARKER_KEY = 'kty.localSave.syncedDiskUpdatedAt';
/** 镜像修复版本：与本值不一致时触发一次全量重灌，修补历史遗漏（如 autoIncrement 行未落盘）。 */
const MIRROR_VERSION_KEY = 'kty.localSave.mirrorVersion';
const MIRROR_VERSION = '2';

type PutOp = { type: 'put'; value: unknown; key: IDBValidKey };
type DeleteOp = { type: 'delete'; key: IDBValidKey };
type PendingOp = PutOp | DeleteOp;

let enabled = false;
let suspended = false;
let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const pendingOps = new Map<LocalSaveStoreName, Map<string, PendingOp>>();
const pendingClears = new Set<LocalSaveStoreName>();

export function isDiskPersistenceEnabled(): boolean {
  return enabled;
}

function readLocalStorage(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // 隐私模式等场景 localStorage 不可用：退化为每次启动都尝试回灌，不丢数据。
  }
}

function readSyncMarker(): string | null {
  return readLocalStorage(SYNC_MARKER_KEY);
}

function writeSyncMarker(updatedAt: number): void {
  writeLocalStorage(SYNC_MARKER_KEY, String(updatedAt));
}

/** 主键字符串化：IDB 主键可为字符串、数字、Date 或数组，直接 String() 会把对象变成 [object Object]。 */
function keyToString(key: IDBValidKey): string {
  if (typeof key === 'string') return key;
  if (typeof key === 'number') return String(key);
  if (key instanceof Date) return String(key.getTime());
  if (Array.isArray(key)) return key.map((part) => keyToString(part)).join('\u0001');
  return JSON.stringify(key);
}

/**
 * autoIncrement 的 add 行在写入时还没有主键，磁盘文件名与回灌都依赖它；
 * 落盘前把真实主键补回值里，服务端才能定名、回灌的行才完整。
 */
function withKeyPath(value: unknown, keyPath: string, key: IDBValidKey): unknown {
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record[keyPath] !== undefined && record[keyPath] !== null) return value;
  return { ...record, [keyPath]: key };
}

function pendingOpCount(): number {
  let total = 0;
  for (const map of pendingOps.values()) total += map.size;
  return total + pendingClears.size;
}

function ensureStoreMap(store: string): Map<string, PendingOp> | null {
  if (!isLocalSaveStoreName(store)) return null;
  let map = pendingOps.get(store);
  if (!map) {
    map = new Map();
    pendingOps.set(store, map);
  }
  return map;
}

function handleBatch(batch: DbWriteBatch): void {
  if (!enabled || suspended) return;
  for (const store of batch.clears) {
    if (isLocalSaveStoreName(store)) pendingClears.add(store);
  }
  for (const put of batch.puts) {
    if (put.key === null) continue;
    const map = ensureStoreMap(put.store);
    if (map) map.set(keyToString(put.key), { type: 'put', value: put.value, key: put.key });
  }
  for (const del of batch.deletes) {
    const map = ensureStoreMap(del.store);
    if (map) map.set(keyToString(del.key), { type: 'delete', key: del.key });
  }
  scheduleFlush();
}

function scheduleFlush(): void {
  if (retryTimer !== null) return;
  if (pendingOpCount() >= MAX_PENDING_OPS) {
    void flush();
    return;
  }
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

function scheduleRetry(): void {
  if (retryTimer !== null || !enabled) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (pendingOpCount() > 0) void flush();
  }, FLUSH_RETRY_MS);
}

interface PendingSnapshot {
  mutation: LocalSaveMutation;
  puts: Map<LocalSaveStoreName, PutOp[]>;
  deletes: Map<LocalSaveStoreName, DeleteOp[]>;
  clears: LocalSaveStoreName[];
}

function snapshotPending(): PendingSnapshot {
  const mutation: LocalSaveMutation = {
    dbVersion: UNIFIED_ID_DB_VERSION,
    updatedAt: Date.now(),
    puts: {},
    deletes: {},
    clears: [],
  };
  const putsByStore: Partial<Record<LocalSaveStoreName, unknown[]>> = {};
  const deletesByStore: Partial<Record<LocalSaveStoreName, string[]>> = {};
  const putsMap = new Map<LocalSaveStoreName, PutOp[]>();
  const deletesMap = new Map<LocalSaveStoreName, DeleteOp[]>();
  for (const [store, map] of pendingOps) {
    const keyPath = localSaveStoreKeyPath(store);
    const storePuts: unknown[] = [];
    const storeDeletes: string[] = [];
    const storePutOps: PutOp[] = [];
    const storeDeleteOps: DeleteOp[] = [];
    for (const op of map.values()) {
      if (op.type === 'put') {
        storePuts.push(withKeyPath(op.value, keyPath, op.key));
        storePutOps.push(op);
      } else {
        storeDeletes.push(keyToString(op.key));
        storeDeleteOps.push(op);
      }
    }
    if (storePuts.length) {
      putsByStore[store] = storePuts;
      putsMap.set(store, storePutOps);
    }
    if (storeDeletes.length) {
      deletesByStore[store] = storeDeletes;
      deletesMap.set(store, storeDeleteOps);
    }
  }
  mutation.puts = putsByStore;
  mutation.deletes = deletesByStore;
  const clears = pendingClears.size ? [...pendingClears] : [];
  if (clears.length) mutation.clears = clears;
  pendingOps.clear();
  pendingClears.clear();
  return { mutation, puts: putsMap, deletes: deletesMap, clears };
}

function mergeBack(snapshot: PendingSnapshot): void {
  for (const store of snapshot.clears) pendingClears.add(store);
  for (const [store, ops] of snapshot.puts) {
    const map = ensureStoreMap(store);
    if (!map) continue;
    for (const op of ops) {
      const key = keyToString(op.key);
      if (!map.has(key)) map.set(key, op);
    }
  }
  for (const [store, ops] of snapshot.deletes) {
    const map = ensureStoreMap(store);
    if (!map) continue;
    for (const op of ops) {
      const key = keyToString(op.key);
      if (!map.has(key)) map.set(key, op);
    }
  }
}

async function flush(): Promise<void> {
  if (flushing || !enabled) return;
  if (pendingOpCount() === 0) return;
  flushing = true;
  const snapshot = snapshotPending();
  try {
    const response = await fetch(`${LOCAL_SAVE_API_PREFIX}/mutate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot.mutation),
    });
    if (!response.ok) throw new Error(`落盘失败：HTTP ${response.status}`);
    const data = await response.json() as { updatedAt?: number };
    if (typeof data.updatedAt === 'number') writeSyncMarker(data.updatedAt);
  } catch (error) {
    mergeBack(snapshot);
    devLogError('save', 'disk-mirror-flush-failed', error, { pending: pendingOpCount() });
    scheduleRetry();
  } finally {
    flushing = false;
  }
}

async function fetchHealth(): Promise<{ ok: boolean; hasData: boolean; dbVersion: number | null; updatedAt: number | null } | null> {
  try {
    const response = await fetch(`${LOCAL_SAVE_API_PREFIX}/health`);
    if (!response.ok) return null;
    const data = await response.json() as { ok?: boolean; hasData?: boolean; dbVersion?: number | null; updatedAt?: number | null };
    if (!data.ok) return null;
    return {
      ok: true,
      hasData: data.hasData === true,
      dbVersion: data.dbVersion ?? null,
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : null,
    };
  } catch {
    return null;
  }
}

async function countIdbSaves(): Promise<number> {
  const db = await openDB();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(SAVES_STORE, 'readonly');
    const request = tx.objectStore(SAVES_STORE).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(toError(request.error));
  });
}

function readAllRows(db: IDBDatabase, store: LocalSaveStoreName): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
    request.onerror = () => reject(toError(request.error));
  });
}

async function restoreStore(store: LocalSaveStoreName, db: IDBDatabase): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(toError(tx.error));
    tx.onabort = () => reject(toError(tx.error));
  });
  let after: string | null = null;
  let restored = 0;
  for (;;) {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (after !== null) params.set('after', after);
    const response = await fetch(`${LOCAL_SAVE_API_PREFIX}/store/${store}?${params.toString()}`);
    if (!response.ok) break;
    const page = await response.json() as { rows?: unknown[]; nextAfterKey?: string | null };
    const rows = Array.isArray(page.rows) ? page.rows : [];
    if (rows.length) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const objectStore = tx.objectStore(store);
        for (const row of rows) objectStore.put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(toError(tx.error));
        tx.onabort = () => reject(toError(tx.error));
      });
      restored += rows.length;
    }
    if (!page.nextAfterKey) break;
    after = page.nextAfterKey;
  }
  return restored;
}

/** 用磁盘整库覆盖 IDB：每个 store 先清空再分页拉取。仅在磁盘确为权威时调用。 */
async function syncFromDisk(diskDbVersion: number | null): Promise<number> {
  if (diskDbVersion !== null && diskDbVersion !== UNIFIED_ID_DB_VERSION) {
    devLog('save', 'disk-restore-version-mismatch', {
      diskDbVersion,
      currentDbVersion: UNIFIED_ID_DB_VERSION,
    });
  }
  const db = await openDB();
  let restored = 0;
  for (const store of LOCAL_SAVE_STORE_NAMES) {
    restored += await restoreStore(store, db);
  }
  return restored;
}

/** 把 IDB 全部现有行重灌到磁盘：用于修补历史遗漏，确保磁盘与 IDB 首次对齐。 */
async function flushAllFromIdb(): Promise<void> {
  const db = await openDB();
  for (const store of LOCAL_SAVE_STORE_NAMES) {
    const rows = await readAllRows(db, store);
    if (!rows.length) continue;
    const map = ensureStoreMap(store);
    if (!map) continue;
    const keyPath = localSaveStoreKeyPath(store);
    for (const row of rows) {
      const rawKey = row[keyPath] as IDBValidKey | null | undefined;
      if (rawKey === undefined || rawKey === null) continue;
      map.set(keyToString(rawKey), { type: 'put', value: row, key: rawKey });
    }
  }
  await flush();
}

/**
 * 客户端入口在渲染前调用：装好写穿透镜像，并保证“磁盘为读取真相”。
 * 判定策略（宁可保留、绝不误清）：
 * - IDB 为空（被清缓存）→ 必须从磁盘回灌。
 * - IDB 非空且磁盘自上次同步点后又前进 → 磁盘为准，回灌覆盖。
 * - 其余情况（含未标记的 IDB）保留 IDB，交给镜像把磁盘追平，避免误清更晚的数据。
 * 任何失败都不得阻断启动——本地落盘只是增强，不是运行前提。
 */
export async function bootstrapDiskPersistence(): Promise<void> {
  installDbWriteSink(handleBatch);
  suspended = true;
  try {
    const health = await fetchHealth();
    if (!health) return;
    enabled = true;
    if (health.hasData) {
      const idbSaves = await countIdbSaves();
      const syncedAt = readSyncMarker();
      const diskAdvanced = syncedAt !== null
        && health.updatedAt !== null
        && syncedAt !== String(health.updatedAt);
      const shouldRestore = idbSaves === 0 || diskAdvanced;
      if (!shouldRestore) {
        devLog('save', 'disk-sync-skipped', { idbSaves, syncedAt, diskUpdatedAt: health.updatedAt });
      } else {
        const compatible = health.dbVersion === null || health.dbVersion === UNIFIED_ID_DB_VERSION;
        if (!compatible && idbSaves > 0) {
          // 迁移后的 IDB 不能被旧格式磁盘覆盖；由后续正常写入把磁盘升到新版本。
          devLog('save', 'disk-sync-skipped-version-mismatch', {
            diskDbVersion: health.dbVersion,
            currentDbVersion: UNIFIED_ID_DB_VERSION,
          });
        } else {
          const restored = await syncFromDisk(health.dbVersion);
          if (health.updatedAt !== null) writeSyncMarker(health.updatedAt);
          devLog('save', 'disk-sync-complete', { rows: restored, idbSavesBefore: idbSaves });
        }
      }
    }
  } catch (error) {
    devLogError('save', 'disk-bootstrap-failed', error);
  } finally {
    suspended = false;
  }
  try {
    if (enabled && readLocalStorage(MIRROR_VERSION_KEY) !== MIRROR_VERSION) {
      await flushAllFromIdb();
      writeLocalStorage(MIRROR_VERSION_KEY, MIRROR_VERSION);
      devLog('save', 'disk-mirror-repaired', { version: MIRROR_VERSION });
    }
  } catch (error) {
    devLogError('save', 'disk-mirror-repair-failed', error);
  }
}

export interface TurnTranscriptInput {
  turn: number;
  traveler?: string;
  body: string;
}

/** 每回合正文落一份磁盘记录；同一回合重 roll 时以同名文件覆盖，保持幂等。 */
export async function writeTurnTranscript(input: TurnTranscriptInput): Promise<void> {
  if (!enabled) return;
  const body = input.body.trim();
  if (!body) return;
  try {
    await fetch(`${LOCAL_SAVE_API_PREFIX}/transcript`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turn: input.turn, traveler: input.traveler, body }),
    });
  } catch (error) {
    devLogError('save', 'disk-transcript-write-failed', error, { turn: input.turn });
  }
}
