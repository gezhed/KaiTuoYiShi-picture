/**
 * 本地落盘的核心机制验证：IDB 写穿透镜像是否真的在事务提交时捕获 put/add/delete/clear，
 * 以及中止事务是否被正确丢弃。这是本地落盘「不丢数据」成立的前提，故按行为钉死。
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { installDbWriteSink, type DbWriteBatch } from '@/services/storage/idbWriteMirror';
import { openDB, SAVES_STORE, SETTINGS_STORE } from '@/services/storage/dbConnection';

function runTx(db: IDBDatabase, storeName: string, body: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    body(tx.objectStore(storeName));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error instanceof Error ? tx.error : new Error('IDB 事务失败'));
    tx.onabort = () => reject(tx.error instanceof Error ? tx.error : new Error('IDB 事务中止'));
  });
}

describe('本地落盘 · IDB 写穿透镜像', () => {
  it('事务提交时按主键上报 put 与 delete', async () => {
    const batches: DbWriteBatch[] = [];
    installDbWriteSink((batch) => batches.push(batch));
    const db = await openDB();

    await runTx(db, SETTINGS_STORE, (store) => {
      store.put({ key: 'a', value: 1 });
      store.put({ key: 'b', value: 2 });
      store.delete('a');
    });

    const batch = batches.at(-1);
    expect(batch?.puts.map((put) => put.key).sort()).toEqual(['a', 'b']);
    expect(batch?.deletes).toEqual([{ store: SETTINGS_STORE, key: 'a' }]);
    expect(batch?.clears).toEqual([]);
  });

  it('add 的自动主键在请求成功后补齐', async () => {
    const batches: DbWriteBatch[] = [];
    installDbWriteSink((batch) => batches.push(batch));
    const db = await openDB();

    await runTx(db, SAVES_STORE, (store) => {
      store.add({ type: 'manual', timestamp: 1 });
    });

    const put = batches.at(-1)?.puts.at(0);
    expect(typeof put?.key).toBe('number');
  });

  it('被中止的事务不产生落盘批次', async () => {
    const batches: DbWriteBatch[] = [];
    installDbWriteSink((batch) => batches.push(batch));
    const db = await openDB();

    await new Promise<void>((resolve) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      tx.objectStore(SETTINGS_STORE).put({ key: 'aborted', value: 1 });
      tx.onabort = () => resolve();
      tx.abort();
    });

    expect(batches.some((batch) => batch.puts.some((put) => put.key === 'aborted'))).toBe(false);
  });

  it('clear 上报为整表清空', async () => {
    const batches: DbWriteBatch[] = [];
    installDbWriteSink((batch) => batches.push(batch));
    const db = await openDB();

    await runTx(db, SETTINGS_STORE, (store) => { store.clear(); });

    expect(batches.at(-1)?.clears).toContain(SETTINGS_STORE);
  });
});
