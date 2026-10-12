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

export async function readStoreRows(
  store: LocalSaveStoreName,
  options: { afterKey?: string | null; limit?: number; root?: string } = {},
): Promise<StoreRowsPage> {
  const root = options.root ?? resolveSaveRoot();
  const afterKey = options.afterKey ?? null;
  const limit = Math.max(1, options.limit ?? 25);
  const keys = await listStoreKeys(store, root);
  const candidates = afterKey === null
    ? keys
    : keys.filter((key) => compareStoreKeys(key, afterKey) > 0);
  const page = candidates.slice(0, limit);
  const rows: unknown[] = [];
  for (const key of page) {
    try {
      rows.push(JSON.parse(await fs.readFile(path.join(storeDir(root, store), encodeStoreKey(key)), 'utf8')));
    } catch {
      // 单行读坏不应让整次回灌失败：跳过该行，其余照常恢复。
    }
  }
  return {
    rows,
    nextAfterKey: candidates.length > limit ? page[page.length - 1] ?? null : null,
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
