/**
 * 服务端本地落盘的文件读写层。仅由 vite 中间件与未来的独立本地服务导入，
 * 浏览器构建（客户端）绝不导入本文件——它依赖 node:fs。
 *
 * 落盘形态：每行一个文件，键即文件名（URL 编码）。这样单行损坏只影响该行，
 * 且每回合只重写变化的那几行，不会随回合数线性膨胀写入量。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  LOCAL_SAVE_MANIFEST_VERSION,
  LOCAL_SAVE_STORE_NAMES,
  localSaveStoreKeyPath,
  type LocalSaveMutation,
  type LocalSaveStoreName,
} from '../saveStoreSchema';

const SAVE_DIR_NAME = 'save';
const TRANSCRIPT_DIR_NAME = 'transcript';

export interface LocalSaveManifest {
  app: 'kaituoyishi';
  version: number;
  dbVersion: number | null;
  updatedAt: number;
}

export interface LocalTranscriptEntry {
  turn: number;
  traveler?: string;
  body: string;
}

export function resolveSaveRoot(): string {
  return path.resolve(process.cwd(), SAVE_DIR_NAME);
}

function storeDir(root: string, store: LocalSaveStoreName): string {
  return path.join(root, 'store', store);
}

/** 资产（图片等二进制）目录：与存档同根，但独立于逐行 JSON。 */
const ASSET_DIR_NAME = 'assets';

function assetDir(root: string): string {
  return path.join(root, ASSET_DIR_NAME);
}

/** 资产文件名白名单：只允许安全字符，堵死路径穿越。 */
function safeAssetName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 160) return null;
  if (trimmed === '.' || trimmed === '..') return null;
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  return trimmed;
}

function guessAssetMime(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

/** 读一份资产；不存在或名字非法返回 null。 */
export async function readAssetFile(
  name: string,
  root = resolveSaveRoot(),
): Promise<{ data: Buffer; mime: string } | null> {
  const safe = safeAssetName(name);
  if (!safe) return null;
  try {
    const data = await fs.readFile(path.join(assetDir(root), safe));
    return { data, mime: guessAssetMime(safe) };
  } catch {
    return null;
  }
}

/** 写一份资产（原子写）；名字非法返回 null。返回实际落盘的文件名。 */
export async function writeAssetFile(
  name: string,
  data: Buffer,
  root = resolveSaveRoot(),
): Promise<string | null> {
  const safe = safeAssetName(name);
  if (!safe) return null;
  const dir = assetDir(root);
  await fs.mkdir(dir, { recursive: true });
  // 先写临时文件再改名：避免半截文件被当成有效资产。
  const tmp = path.join(dir, `.${safe}.${Date.now().toString(36)}.tmp`);
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, path.join(dir, safe));
  return safe;
}

/** 删除一份资产；名字非法返回 false。 */
export async function deleteAssetFile(name: string, root = resolveSaveRoot()): Promise<boolean> {
  const safe = safeAssetName(name);
  if (!safe) return false;
  try {
    await fs.rm(path.join(assetDir(root), safe), { force: true });
    return true;
  } catch {
    return false;
  }
}

function manifestPath(root: string): string {
  return path.join(root, 'manifest.json');
}

function transcriptDir(root: string): string {
  return path.join(root, TRANSCRIPT_DIR_NAME);
}

function encodeStoreKey(key: string | number): string {
  // `%` 与编码后的字符都是合法文件名字符，nodeId / settings 键都无需再哈希。
  return `${encodeURIComponent(String(key))}.json`;
}

function decodeStoreKey(fileName: string): string {
  return decodeURIComponent(fileName.replace(/\.json$/i, ''));
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Windows 上 rename 覆盖已存在文件的行为因 libuv 版本而异，失败时退化为先删后改名。 */
async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, data, 'utf8');
  try {
    await fs.rename(tmpPath, filePath);
  } catch {
    await fs.rm(filePath, { force: true });
    await fs.rename(tmpPath, filePath);
  }
}

function compareStoreKeys(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  const aNumeric = Number.isFinite(na) && /^-?\d+$/.test(a);
  const bNumeric = Number.isFinite(nb) && /^-?\d+$/.test(b);
  if (aNumeric && bNumeric) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

export async function readManifest(root = resolveSaveRoot()): Promise<LocalSaveManifest | null> {
  try {
    const raw = await fs.readFile(manifestPath(root), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Partial<LocalSaveManifest>;
    return {
      app: 'kaituoyishi',
      version: typeof record.version === 'number' ? record.version : LOCAL_SAVE_MANIFEST_VERSION,
      dbVersion: typeof record.dbVersion === 'number' ? record.dbVersion : null,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export async function hasLocalSaveData(root = resolveSaveRoot()): Promise<boolean> {
  return (await readManifest(root)) !== null;
}

/** 统计每个 store 已落盘的行数（文件名个数），用于诊断哪一层缺数据。 */
export async function countStoreRows(root = resolveSaveRoot()): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const store of LOCAL_SAVE_STORE_NAMES) {
    result[store] = (await listStoreKeys(store, root)).length;
  }
  return result;
}

export async function listStoreKeys(store: LocalSaveStoreName, root = resolveSaveRoot()): Promise<string[]> {
  try {
    const entries = await fs.readdir(storeDir(root, store));
    return entries
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .map(decodeStoreKey)
      .sort(compareStoreKeys);
  } catch {
    return [];
  }
}

export interface StoreRowsPage {
  rows: unknown[];
  nextAfterKey: string | null;
}

/** 读取单个主键对应的行；不存在返回 null。 */
export async function readStoreRow(
  store: LocalSaveStoreName,
  key: string | number,
  root = resolveSaveRoot(),
): Promise<unknown> {
  try {
    const raw = await fs.readFile(path.join(storeDir(root, store), encodeStoreKey(key)), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function readStoreRows(
  store: LocalSaveStoreName,
  options: { afterKey?: string | null; limit?: number; maxBytes?: number; tail?: number; root?: string } = {},
): Promise<StoreRowsPage> {
  const root = options.root ?? resolveSaveRoot();
  // tail：从最新往回取，条数不超过 N、总字节不超过上限（至少带最新 1 行）。
  if (options.tail !== undefined) {
    const 键列表 = await listStoreKeys(store, root);
    const 上限字节 = options.maxBytes ?? 48_000_000;
    const 行: unknown[] = [];
    let 字节 = 0;
    for (let i = 键列表.length - 1; i >= 0 && 行.length < options.tail; i -= 1) {
      let raw: string;
      try {
        raw = await fs.readFile(path.join(storeDir(root, store), encodeStoreKey(键列表[i])), 'utf8');
      } catch {
        continue;
      }
      // 用真实字节数（中文 1 字符≈3 字节，用 .length 会把上限放大三倍）。
      const 本行字节 = Buffer.byteLength(raw, 'utf8');
      if (行.length > 0 && 字节 + 本行字节 > 上限字节) break;
      字节 += 本行字节;
      try {
        行.unshift(JSON.parse(raw));
      } catch {
        // 跳过读坏的行
      }
    }
    return { rows: 行, nextAfterKey: null };
  }
  const afterKey = options.afterKey ?? null;
  const limit = Math.max(1, options.limit ?? 25);
  const maxBytes = Math.max(1, options.maxBytes ?? 4_000_000);
  const keys = await listStoreKeys(store, root);
  const candidates = afterKey === null
    ? keys
    : keys.filter((key) => compareStoreKeys(key, afterKey) > 0);
  const rows: unknown[] = [];
  let bytes = 0;
  let consumed = 0;
  for (const key of candidates) {
    if (rows.length >= limit) break;
    let raw: string;
    try {
      raw = await fs.readFile(path.join(storeDir(root, store), encodeStoreKey(key)), 'utf8');
    } catch {
      consumed += 1; // 读坏的行也跳过并前进，避免死循环
      continue;
    }
    // 单行可能很大（存档本体可达数 MB）：保证至少带回一行，否则一页永远装不下、回灌永久卡死。
    const 本行字节 = Buffer.byteLength(raw, 'utf8');
    if (rows.length > 0 && bytes + 本行字节 > maxBytes) break;
    try {
      rows.push(JSON.parse(raw));
    } catch {
      consumed += 1;
      continue;
    }
    bytes += Buffer.byteLength(raw, 'utf8');
    consumed += 1;
  }
  return {
    rows,
    nextAfterKey: consumed < candidates.length ? candidates[consumed - 1] ?? null : null,
  };
}

async function writeManifest(root: string, next: LocalSaveManifest): Promise<void> {
  await atomicWriteFile(manifestPath(root), JSON.stringify(next, null, 2));
}

export async function applyMutation(
  mutation: LocalSaveMutation,
  root = resolveSaveRoot(),
): Promise<void> {
  const knownStores = new Set<string>(LOCAL_SAVE_STORE_NAMES);
  for (const store of mutation.clears ?? []) {
    if (!knownStores.has(store)) continue;
    await fs.rm(storeDir(root, store), { recursive: true, force: true });
  }
  for (const [store, rows] of Object.entries(mutation.puts ?? {})) {
    if (!knownStores.has(store) || !Array.isArray(rows)) continue;
    const keyPath = localSaveStoreKeyPath(store as LocalSaveStoreName);
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const key = (row as Record<string, unknown>)[keyPath];
      if (key === undefined || key === null) continue;
      await atomicWriteFile(
        path.join(storeDir(root, store as LocalSaveStoreName), encodeStoreKey(key as string | number)),
        JSON.stringify(row),
      );
    }
  }
  for (const [store, keys] of Object.entries(mutation.deletes ?? {})) {
    if (!knownStores.has(store) || !Array.isArray(keys)) continue;
    for (const key of keys) {
      await fs.rm(
        path.join(storeDir(root, store as LocalSaveStoreName), encodeStoreKey(key)),
        { force: true },
      );
    }
  }
  const previous = await readManifest(root);
  await writeManifest(root, {
    app: 'kaituoyishi',
    version: LOCAL_SAVE_MANIFEST_VERSION,
    dbVersion: mutation.dbVersion ?? previous?.dbVersion ?? null,
    updatedAt: mutation.updatedAt ?? Date.now(),
  });
}

export async function writeTranscript(
  entry: LocalTranscriptEntry,
  root = resolveSaveRoot(),
): Promise<string> {
  const turn = Math.max(0, Math.floor(entry.turn));
  const fileName = `turn-${String(turn).padStart(4, '0')}.md`;
  const filePath = path.join(transcriptDir(root), fileName);
  const lines = [
    `# 开拓轶事 · 第 ${turn} 回合`,
    entry.traveler ? `旅人：${entry.traveler}` : null,
    '',
    '---',
    '',
    entry.body.trim(),
    '',
  ].filter((line): line is string => line !== null);
  await atomicWriteFile(filePath, lines.join('\n'));
  return filePath;
}

export async function wipeAll(root = resolveSaveRoot()): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}
