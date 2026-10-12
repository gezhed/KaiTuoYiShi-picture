/**
 * 路 A「磁盘为读取真相」的启动判定验证：IDB 空必须回灌、同步点一致则跳过、
 * 磁盘前进则以磁盘覆盖、服务不可用则静默降级。这些分支决定「清缓存后是否还能读回存档」，
 * 任一分支判错都可能丢档，故按行为钉死。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_SAVE_STORE_NAMES } from '@/services/localSave/saveStoreSchema';

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
    clear: () => { map.clear(); },
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
  };
}

interface FakeHealth {
  ok: boolean;
  hasData: boolean;
  dbVersion: number | null;
  updatedAt: number | null;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function installFetch(health: FakeHealth | null, pages: Record<string, unknown[]>): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = requestUrl(input);
    calls.push(url);
    if (health === null) return Promise.reject(new Error('offline'));
    const headers = { 'content-type': 'application/json' };
    if (url.includes('/health')) {
      return Promise.resolve(new Response(JSON.stringify(health), { status: 200, headers }));
    }
    const store = url.match(/\/store\/([^?/]+)/)?.[1] ?? '';
    return Promise.resolve(new Response(JSON.stringify({ ok: true, store, rows: pages[store] ?? [], nextAfterKey: null }), {
      status: 200,
      headers,
    }));
  }));
  return calls;
}

async function openDb() {
  const mod = await import('@/services/storage/dbConnection');
  const db = await mod.openDB();
  return { db, mod };
}

async function clearAllStores(): Promise<void> {
  const { db } = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...LOCAL_SAVE_STORE_NAMES], 'readwrite');
    for (const store of LOCAL_SAVE_STORE_NAMES) tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error instanceof Error ? tx.error : new Error('clear failed'));
  });
}

async function putSave(row: Record<string, unknown>): Promise<void> {
  const { db, mod } = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(mod.SAVES_STORE, 'readwrite');
    tx.objectStore(mod.SAVES_STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error instanceof Error ? tx.error : new Error('put failed'));
  });
}

async function readSaveIds(): Promise<unknown[]> {
  const { db, mod } = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(mod.SAVES_STORE, 'readonly');
    const req = tx.objectStore(mod.SAVES_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error instanceof Error ? req.error : new Error('keys failed'));
  });
}

async function bootstrap() {
  const { bootstrapDiskPersistence, isDiskPersistenceEnabled } = await import('@/services/storage/diskPersistence');
  await bootstrapDiskPersistence();
  return isDiskPersistenceEnabled();
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('localStorage', makeStorage());
  await clearAllStores();
});

describe('本地落盘 · 启动回灌判定（路 A）', () => {
  it('本地服务不可用：静默降级为纯 IDB，不抛错', async () => {
    installFetch(null, {});
    expect(await bootstrap()).toBe(false);
  });

  it('IDB 为空且磁盘有数据：从磁盘回灌', async () => {
    installFetch({ ok: true, hasData: true, dbVersion: 10, updatedAt: 5000 }, {
      saves: [{ id: 11, type: 'manual', timestamp: 1 }],
    });
    expect(await bootstrap()).toBe(true);
    expect(await readSaveIds()).toEqual([11]);
  });

  it('IDB 与磁盘同步点一致：跳过回灌（不请求 store 分页）', async () => {
    await putSave({ id: 1, type: 'manual', timestamp: 1 });
    globalThis.localStorage.setItem('kty.localSave.syncedDiskUpdatedAt', '5000');
    const calls = installFetch({ ok: true, hasData: true, dbVersion: 10, updatedAt: 5000 }, {
      saves: [{ id: 99, type: 'manual', timestamp: 1 }],
    });
    await bootstrap();
    expect(calls.some((url) => url.includes('/store/'))).toBe(false);
    expect(await readSaveIds()).toEqual([1]);
  });

  it('磁盘在同步点之后前进：以磁盘覆盖 IDB', async () => {
    await putSave({ id: 1, type: 'manual', timestamp: 1 });
    globalThis.localStorage.setItem('kty.localSave.syncedDiskUpdatedAt', '4000');
    installFetch({ ok: true, hasData: true, dbVersion: 10, updatedAt: 5000 }, {
      saves: [{ id: 99, type: 'manual', timestamp: 2 }],
    });
    await bootstrap();
    expect(await readSaveIds()).toEqual([99]);
  });
});
