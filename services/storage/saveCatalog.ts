import type { 存档类型 } from '@/models/settings';
import type { 存档树元信息 } from '@/utils/saveTree';
import type { SaveCatalogSnapshot, SaveListItemSummary } from '@/contracts/storage';

export const SAVE_CATALOG_VERSION = 2 as const;

export type SaveCatalogVisibility =
  | 'visible'
  | 'hidden-delta-base'
  | 'legacy-backup'
  | 'unreadable';

export interface VisibleSaveCatalogRecord extends SaveListItemSummary {
  catalogVersion: typeof SAVE_CATALOG_VERSION;
  visibility: 'visible';
}

export interface LegacyBackupCatalogRecord extends SaveListItemSummary {
  catalogVersion: typeof SAVE_CATALOG_VERSION;
  visibility: 'legacy-backup';
  type: 'backup';
}

export interface HiddenDeltaBaseCatalogRecord {
  id: number;
  catalogVersion: typeof SAVE_CATALOG_VERSION;
  visibility: 'hidden-delta-base';
  type?: 存档类型;
  timestamp?: number;
}

export interface UnreadableSaveCatalogRecord {
  id: number;
  catalogVersion: typeof SAVE_CATALOG_VERSION;
  visibility: 'unreadable';
  type?: 存档类型;
  timestamp?: number;
  lastErrorCode: string;
  failedAt: number;
  retryCount: number;
}

export type SaveCatalogRecord =
  | VisibleSaveCatalogRecord
  | LegacyBackupCatalogRecord
  | HiddenDeltaBaseCatalogRecord
  | UnreadableSaveCatalogRecord;

export function createCatalogRecordFromSummary(
  summary: SaveListItemSummary,
): VisibleSaveCatalogRecord | LegacyBackupCatalogRecord {
  if (summary.type === 'backup') {
    return {
      ...summary,
      catalogVersion: SAVE_CATALOG_VERSION,
      visibility: 'legacy-backup',
      type: 'backup',
    };
  }
  return {
    ...summary,
    catalogVersion: SAVE_CATALOG_VERSION,
    visibility: 'visible',
  };
}

export function createHiddenDeltaBaseCatalogRecord(input: {
  id: number;
  type?: 存档类型;
  timestamp?: number;
}): HiddenDeltaBaseCatalogRecord {
  return {
    id: input.id,
    catalogVersion: SAVE_CATALOG_VERSION,
    visibility: 'hidden-delta-base',
    ...(input.type ? { type: input.type } : {}),
    ...(typeof input.timestamp === 'number' ? { timestamp: input.timestamp } : {}),
  };
}

export function createUnreadableSaveCatalogRecord(input: {
  id: number;
  error: unknown;
  retryCount?: number;
}): UnreadableSaveCatalogRecord {
  return {
    id: input.id,
    catalogVersion: SAVE_CATALOG_VERSION,
    visibility: 'unreadable',
    lastErrorCode: getCatalogErrorCode(input.error),
    failedAt: Date.now(),
    retryCount: Math.max(1, Math.floor(input.retryCount ?? 1)),
  };
}

export function normalizeSaveCatalogRecord(value: unknown): SaveCatalogRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = normalizePositiveInteger(raw.id);
  if (!id) return null;

  if (raw.visibility === 'hidden-delta-base') {
    return createHiddenDeltaBaseCatalogRecord({
      id,
      type: normalizeOptionalSaveType(raw.type),
      timestamp: normalizeOptionalTimestamp(raw.timestamp),
    });
  }
  if (raw.visibility === 'unreadable') {
    return {
      id,
      catalogVersion: SAVE_CATALOG_VERSION,
      visibility: 'unreadable',
      ...(normalizeOptionalSaveType(raw.type) ? { type: normalizeOptionalSaveType(raw.type) } : {}),
      ...(normalizeOptionalTimestamp(raw.timestamp) !== undefined
        ? { timestamp: normalizeOptionalTimestamp(raw.timestamp) }
        : {}),
      lastErrorCode: typeof raw.lastErrorCode === 'string' && raw.lastErrorCode.trim()
        ? raw.lastErrorCode.trim().slice(0, 80)
        : 'unknown',
      failedAt: normalizeOptionalTimestamp(raw.failedAt) ?? Date.now(),
      retryCount: Math.max(1, Math.floor(Number(raw.retryCount) || 1)),
    };
  }

  const summary = normalizeSaveListItemSummary(raw);
  if (!summary) return null;
  return createCatalogRecordFromSummary(summary);
}

export function buildSaveCatalogSnapshot(
  records: SaveCatalogRecord[],
  saveKeys: IDBValidKey[],
): SaveCatalogSnapshot {
  const saveIds = Array.from(new Set(
    saveKeys
      .map((key) => normalizePositiveInteger(key))
      .filter((id): id is number => Boolean(id)),
  ));
  const saveIdSet = new Set(saveIds);
  const byId = new Map<number, SaveCatalogRecord>();
  for (const record of records) {
    if (record.id > 0) byId.set(record.id, record);
  }

  const items: SaveListItemSummary[] = [];
  const legacyBackups: SaveListItemSummary[] = [];
  const unreadableIds: number[] = [];
  let hiddenBaseCount = 0;

  /*
   * 目录以**摘要**为准，而不是以「已加载到浏览器的存档」为准。
   *
   * 以前这里是遍历 saveIds（= 浏览器里已有的存档行）再去查摘要，
   * 于是：磁盘版为了省内存只预载最新 3 份存档时，目录就只剩 3 条 ——
   * 界面上表现为「存档全没了」，而磁盘上的摘要其实是齐的。
   * 现在只要摘要在，就进目录；存档本体按需从磁盘读（loadRawSave 已支持）。
   */
  for (const record of byId.values()) {
    if (record.id <= 0) continue;
    if (record.visibility === 'visible') items.push(stripCatalogMetadata(record));
    else if (record.visibility === 'legacy-backup') legacyBackups.push(stripCatalogMetadata(record));
    else if (record.visibility === 'hidden-delta-base') hiddenBaseCount += 1;
    else unreadableIds.push(record.id);
  }

  const pendingIds = saveIds.filter((id) => !byId.has(id)).sort((a, b) => b - a);
  // 按需读取模式下（摘要有、存档行没预载）不算“陈旧目录”，否则会被当成垃圾清掉。
  const onDemandMode = byId.size > saveIds.length;
  const staleCatalogIds = onDemandMode
    ? []
    : Array.from(byId.keys())
      .filter((id) => !saveIdSet.has(id))
      .sort((a, b) => b - a);

  return {
    items: sortSummaries(items),
    legacyBackups: sortSummaries(legacyBackups),
    pendingIds,
    unreadableIds: unreadableIds.sort((a, b) => b - a),
    staleCatalogIds,
    hiddenBaseCount,
    totalStoredCount: saveIds.length,
    catalogComplete: pendingIds.length === 0 && unreadableIds.length === 0,
  };
}

function stripCatalogMetadata(
  record: VisibleSaveCatalogRecord | LegacyBackupCatalogRecord,
): SaveListItemSummary {
  const { catalogVersion: _catalogVersion, visibility: _visibility, ...summary } = record;
  void _catalogVersion;
  void _visibility;
  return summary;
}

function normalizeSaveListItemSummary(raw: Record<string, unknown>): SaveListItemSummary | null {
  if ('chatHistory' in raw) return null;
  const id = normalizePositiveInteger(raw.id);
  const timestamp = normalizeOptionalTimestamp(raw.timestamp);
  if (!id || timestamp === undefined) return null;
  const saveTree = raw.saveTree && typeof raw.saveTree === 'object'
    ? raw.saveTree as 存档树元信息
    : undefined;
  return {
    id,
    type: normalizeSaveType(raw.type),
    timestamp,
    ...(saveTree ? { saveTree } : {}),
    ...(raw.unsealedHead === true ? { unsealedHead: true } : {}),
    travelerName: normalizeText(raw.travelerName),
    turnCount: Math.max(0, Math.floor(Number(raw.turnCount) || 0)),
    worldPeriodName: normalizeText(raw.worldPeriodName),
    currentDate: normalizeText(raw.currentDate),
    currentTime: normalizeText(raw.currentTime),
    currentLocation: normalizeText(raw.currentLocation),
    lastSummary: normalizeText(raw.lastSummary),
    sizeBytes: Math.max(0, Number(raw.sizeBytes) || 0),
  };
}

function sortSummaries(list: SaveListItemSummary[]): SaveListItemSummary[] {
  return [...list].sort((a, b) => b.timestamp - a.timestamp || b.id - a.id);
}

function normalizeSaveType(value: unknown): 存档类型 {
  return value === 'auto' || value === 'backup' || value === 'imported' ? value : 'manual';
}

function normalizeOptionalSaveType(value: unknown): 存档类型 | undefined {
  if (value === 'manual' || value === 'auto' || value === 'backup' || value === 'imported') return value;
  return undefined;
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeOptionalTimestamp(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getCatalogErrorCode(error: unknown): string {
  if (error instanceof DOMException && error.name) return error.name.slice(0, 80);
  if (error instanceof Error && error.name) return error.name.slice(0, 80);
  return 'unknown';
}
