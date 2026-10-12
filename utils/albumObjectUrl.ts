import { 取待落盘字节 } from './pendingAssetBytes';

const DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;
interface AlbumAssetCacheEntry {
  blob: Blob;
  mimeType?: string;
  objectUrl?: string;
}

const assetCache = new Map<string, AlbumAssetCacheEntry>();

export function isDataImageUrl(value: unknown): value is string {
  return typeof value === 'string' && DATA_IMAGE_RE.test(value.trimStart());
}

export function dataUrlToBlob(dataUrl: string): Blob | null {
  if (!dataUrl.startsWith('data:')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mimeType = header.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream';
  try {
    const binary = header.includes(';base64') ? atob(body) : decodeURIComponent(body);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  } catch {
    return null;
  }
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Blob 转 dataUrl 失败'));
    reader.readAsDataURL(blob);
  });
}

export function rememberAlbumAssetBlob(assetId: string, blob: Blob, mimeType?: string): void {
  const id = assetId.trim();
  if (!id) return;
  const existing = assetCache.get(id);
  if (existing && existing.blob === blob) {
    if (mimeType && !existing.mimeType) existing.mimeType = mimeType;
    return;
  }
  if (existing?.objectUrl) {
    URL.revokeObjectURL(existing.objectUrl);
  }
  assetCache.set(id, {
    blob,
    mimeType: mimeType || blob.type || existing?.mimeType,
  });
}

export function rememberAlbumAssetFromDataUrl(assetId: string, dataUrl: string): Blob | null {
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return null;
  rememberAlbumAssetBlob(assetId, blob, blob.type);
  return blob;
}

export function getAlbumAssetBlob(assetId: string): Blob | undefined {
  const id = assetId.trim();
  /*
   * 先看旁路暂存：那是「刚出图、还没落盘」的权威来源，且不会被 prune 回收。
   * 展示缓存只作兜底 —— 它随时可能被 `pruneAlbumAssetCache` 清掉，
   * 而自动配图的落盘发生在回合末尾，正好横跨这段窗口（「只剩最后一张」的成因）。
   */
  return 取待落盘字节(id) ?? assetCache.get(id)?.blob;
}

export function hasAlbumAssetBlob(assetId: string): boolean {
  const id = assetId.trim();
  // 与 getAlbumAssetBlob 保持同一口径：旁路暂存也算「有字节」，
  // 否则 stripAlbumAssetPayload 会在缓存被回收后把 dataUrl 误判成「无字节」而丢弃。
  return 取待落盘字节(id) !== undefined || assetCache.has(id);
}

export function resolveAlbumAssetDisplayUrl(assetId: string): string | undefined {
  const entry = assetCache.get(assetId.trim());
  if (!entry) return undefined;
  if (!entry.objectUrl) {
    entry.objectUrl = URL.createObjectURL(entry.blob);
  }
  return entry.objectUrl;
}

export function revokeAlbumAsset(assetId: string): void {
  const id = assetId.trim();
  const entry = assetCache.get(id);
  if (!entry) return;
  if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  assetCache.delete(id);
}

export function revokeAlbumAssets(assetIds: Iterable<string>): void {
  for (const id of assetIds) revokeAlbumAsset(id);
}

export function pruneAlbumAssetCache(retainedAssetIds: Iterable<string>): void {
  const retained = new Set(Array.from(retainedAssetIds, (id) => id.trim()).filter(Boolean));
  for (const id of assetCache.keys()) {
    if (!retained.has(id)) revokeAlbumAsset(id);
  }
}

export function clearAlbumAssetObjectUrlCache(): void {
  for (const entry of assetCache.values()) {
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
  assetCache.clear();
}

export function getAlbumAssetCacheStats(): { size: number; objectUrls: number; totalBytes: number } {
  let objectUrls = 0;
  let totalBytes = 0;
  for (const entry of assetCache.values()) {
    if (entry.objectUrl) objectUrls += 1;
    totalBytes += entry.blob.size;
  }
  return { size: assetCache.size, objectUrls, totalBytes };
}

export function materializeAlbumRuntimePayload<T extends { assets: Array<{ id: string; dataUrl?: string; size?: number }> }>(album: T): T {
  const assets = album.assets.map((asset) => {
    if (!asset.id) return asset;
    if (asset.dataUrl && asset.dataUrl.startsWith('data:')) {
      const blob = rememberAlbumAssetFromDataUrl(asset.id, asset.dataUrl);
      if (!blob) return asset;
      return {
        ...asset,
        dataUrl: `asset:${asset.id}`,
        size: asset.size ?? blob.size,
      };
    }
    return asset;
  });
  const changed = album.assets.some((asset, index) => assets[index] !== asset);
  return changed ? { ...album, assets } : album;
}

export function pickAssetDisplayUrl(asset: {
  id?: string;
  dataUrl?: string;
  url?: string;
  localRef?: string;
  originalUrl?: string;
}): string | undefined {
  if (asset.id) {
    const cached = resolveAlbumAssetDisplayUrl(asset.id);
    if (cached) return cached;
  }
  const dataUrl = asset.dataUrl?.trim();
  if (dataUrl) {
    if (dataUrl.startsWith('asset:')) {
      const assetId = dataUrl.slice('asset:'.length).trim() || asset.id;
      if (assetId) {
        const objectUrl = resolveAlbumAssetDisplayUrl(assetId);
        if (objectUrl) return objectUrl;
      }
    } else if (isDataImageUrl(dataUrl) && asset.id) {
      rememberAlbumAssetFromDataUrl(asset.id, dataUrl);
      return resolveAlbumAssetDisplayUrl(asset.id) ?? dataUrl;
    } else if (!isDataImageUrl(dataUrl)) {
      return dataUrl;
    } else {
      return dataUrl;
    }
  }
  return asset.url?.trim() || asset.localRef?.trim() || asset.originalUrl?.trim() || undefined;
}
