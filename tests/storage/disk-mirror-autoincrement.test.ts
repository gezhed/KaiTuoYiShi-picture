/**
 * 回归：autoIncrement 的 add 行在落盘前必须补回真实主键。
 * 否则服务端按行内 keyPath 取名失败、静默跳过，磁盘备份会缺失真正装进度的存档行。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface CapturedRequest {
  url: string;
  body: unknown;
}

let captured: CapturedRequest[] = [];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function installFetch(): void {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const raw = init?.body;
    let body: unknown = null;
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    captured.push({ url, body });
    const headers = { 'content-type': 'application/json' };
    if (url.includes('/health')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, hasData: false, dbVersion: 10, updatedAt: null }), { status: 200, headers }));
    }
    if (url.includes('/mutate')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, updatedAt: Date.now() }), { status: 200, headers }));
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true, rows: [], nextAfterKey: null }), { status: 200, headers }));
  }));
}

function readMutateSavesRow(body: unknown): { id?: unknown } | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const puts = (body as { puts?: unknown }).puts;
  if (!puts || typeof puts !== 'object') return undefined;
  const saves = (puts as { saves?: unknown }).saves;
  if (!Array.isArray(saves) || !saves.length) return undefined;
  const first: unknown = saves[0];
  return first && typeof first === 'object' ? first : undefined;
}

beforeEach(() => {
  vi.resetModules();
  captured = [];
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  } satisfies Storage);
});

describe('本地落盘 · autoIncrement 行补主键', () => {
  it('add 进 saves 的行，落盘请求里带上了 IDB 生成的真实主键', async () => {
    installFetch();
    const { bootstrapDiskPersistence } = await import('@/services/storage/diskPersistence');
    await bootstrapDiskPersistence();

    const { openDB, SAVES_STORE } = await import('@/services/storage/dbConnection');
    const db = await openDB();
    let addedId = 0;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SAVES_STORE, 'readwrite');
      const request = tx.objectStore(SAVES_STORE).add({ type: 'manual', timestamp: 1 });
      request.onsuccess = () => { addedId = request.result as number; };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error instanceof Error ? tx.error : new Error('tx failed'));
    });

    await new Promise((resolve) => setTimeout(resolve, 450));

    const mutate = captured.find((item) => item.url.includes('/mutate') && readMutateSavesRow(item.body));
    const row = readMutateSavesRow(mutate?.body);
    expect(typeof row?.id).toBe('number');
    expect(row?.id).toBe(addedId);
  });
});
