/**
 * IndexedDB 写穿透镜像。通过数据库级 Proxy 单点拦截 object store 的 put/add/delete/clear，
 * 不侵入 services/storage 的任何写入函数——所有写入天然都经过 IDB 这一条漏斗。
 *
 * 事务语义：批次在事务 complete 时才交给 sink；abort/error 的写入不落盘。
 * 未安装 sink 时（测试与未启用本地落盘的环境）返回原对象，零开销、零行为变化。
 */
import { devLogError } from '@/utils/devLog';

export interface DbWritePut {
  store: string;
  value: unknown;
  /** 记录时未知（autoIncrement 新主键）为 null，请求成功后补齐。 */
  key: IDBValidKey | null;
}

export interface DbWriteDelete {
  store: string;
  key: IDBValidKey;
}

export interface DbWriteBatch {
  puts: DbWritePut[];
  deletes: DbWriteDelete[];
  clears: string[];
}

type DbWriteSink = (batch: DbWriteBatch) => void;

let sink: DbWriteSink | null = null;

export function installDbWriteSink(next: DbWriteSink): void {
  sink = next;
}

function isConcreteKey(value: unknown): value is IDBValidKey {
  return typeof value === 'string'
    || typeof value === 'number'
    || value instanceof Date
    || Array.isArray(value);
}

/** 反射读取属性：函数绑定到目标对象，其余原样返回，避免把 Proxy 当 this。 */
function readMember(target: object, prop: string | symbol): unknown {
  const value: unknown = Reflect.get(target, prop, target);
  return typeof value === 'function' ? value.bind(target) : value;
}

function recordPut(
  store: IDBObjectStore,
  value: unknown,
  explicitKey: IDBValidKey | undefined,
  batch: DbWriteBatch,
): DbWritePut {
  let key: IDBValidKey | null = explicitKey ?? null;
  const keyPath = store.keyPath;
  if (key === null && typeof keyPath === 'string' && value !== null && typeof value === 'object') {
    const candidate = (value as Record<string, unknown>)[keyPath];
    if (candidate !== undefined && candidate !== null) key = candidate as IDBValidKey;
  }
  const record: DbWritePut = { store: store.name, value, key };
  batch.puts.push(record);
  return record;
}

function wrapObjectStore(store: IDBObjectStore, batch: DbWriteBatch): IDBObjectStore {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'put') {
        return (value: unknown, key?: IDBValidKey): IDBRequest<IDBValidKey> => {
          recordPut(target, value, key, batch);
          return target.put(value, key);
        };
      }
      if (prop === 'add') {
        return (value: unknown, key?: IDBValidKey): IDBRequest<IDBValidKey> => {
          const record = recordPut(target, value, key, batch);
          const request = target.add(value, key);
          if (record.key === null) {
            request.addEventListener('success', () => { record.key = request.result; });
          }
          return request;
        };
      }
      if (prop === 'delete') {
        return (query: IDBValidKey | IDBKeyRange): IDBRequest<undefined> => {
          if (isConcreteKey(query)) batch.deletes.push({ store: target.name, key: query });
          return target.delete(query);
        };
      }
      if (prop === 'clear') {
        return (): IDBRequest<undefined> => {
          batch.clears.push(target.name);
          return target.clear();
        };
      }
      return readMember(target, prop);
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
}

function wrapTransaction(tx: IDBTransaction): IDBTransaction {
  const batch: DbWriteBatch = { puts: [], deletes: [], clears: [] };
  tx.addEventListener('complete', () => {
    if (!batch.puts.length && !batch.deletes.length && !batch.clears.length) return;
    try {
      sink?.(batch);
    } catch (error) {
      devLogError('save', 'disk-mirror-sink-failed', error);
    }
  });
  return new Proxy(tx, {
    get(target, prop) {
      if (prop === 'objectStore') {
        return (name: string): IDBObjectStore => wrapObjectStore(target.objectStore(name), batch);
      }
      return readMember(target, prop);
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
}

function wrapDatabase(db: IDBDatabase): IDBDatabase {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'transaction') {
        return (...args: unknown[]): IDBTransaction =>
          wrapTransaction((target.transaction as (...a: unknown[]) => IDBTransaction)(...args));
      }
      return readMember(target, prop);
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
}

export function wrapDatabaseIfMirroring(db: IDBDatabase): IDBDatabase {
  if (!sink) return db;
  try {
    return wrapDatabase(db);
  } catch (error) {
    devLogError('save', 'disk-mirror-wrap-failed', error);
    return db;
  }
}
