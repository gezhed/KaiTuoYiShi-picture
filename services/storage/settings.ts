import { openDB, SETTINGS_STORE } from './dbConnection';
import { toError } from '@/utils/storageUtils';

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await saveSettings([[key, value]]);
}

export async function saveSettings(entries: ReadonlyArray<readonly [key: string, value: unknown]>): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE);
    try {
      for (const [key, value] of entries) {
        store.put({ key, value: 剥离游戏设置运行态键(key, value) });
      }
    } catch (error) {
      tx.abort();
      reject(toError(error));
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(toError(tx.error));
    tx.onabort = () => reject(toError(tx.error ?? new Error('设置批量写入已中止。')));
  });
}

export async function loadSetting<T>(key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readonly');
    const request = tx.objectStore(SETTINGS_STORE).get(key);
    request.onsuccess = () => {
      const result = request.result as { value?: T } | undefined;
      resolve(result?.value ?? null);
    };
    request.onerror = () => reject(toError(request.error));
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await deleteIndexedSetting(key);
}

function 剥离游戏设置运行态键(key: string, value: unknown): unknown {
  if (key !== 'gameSettings') return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  if (!('macroGlobalVars' in source) && !('worldbookTriggerStates' in source)) return value;
  const { macroGlobalVars: _macro, worldbookTriggerStates: _trigger, ...rest } = source;
  void _macro;
  void _trigger;
  return rest;
}

async function deleteIndexedSetting(key: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(toError(tx.error));
  });
}
