import { afterEach } from 'vitest';
import type { 图片资源, 相册条目, 图片生成任务 } from '@/models/imageGeneration';
import { clearAlbumAssetObjectUrlCache } from '@/utils/albumObjectUrl';

export type AlbumAssetSource = Pick<图片资源, 'dataUrl' | 'url' | 'localRef'>;

export function makeAlbumAsset(overrides: Partial<图片资源> & { id: string }): 图片资源 {
  return {
    source: 'upload',
    nsfw: false,
    createdAt: 1,
    status: 'ready',
    ...overrides,
  };
}

export function makeAlbumEntry(overrides: Partial<相册条目> & { id: string; assetId: string }): 相册条目 {
  return {
    title: overrides.id,
    targetType: 'npc',
    slot: 'avatar_profile',
    tags: [],
    nsfw: false,
    createdAt: 1,
    referenceTargets: [],
    ...overrides,
  };
}

export function makeAlbumTask(overrides: Partial<图片生成任务> & { id: string }): 图片生成任务 {
  return {
    targetType: 'npc',
    targetId: 'npc-1',
    slot: 'avatar_profile',
    source: 'manual',
    status: 'success',
    backend: 'sd_webui',
    nsfw: false,
    prompt: '测试提示词',
    retryCount: 0,
    createdAt: 1,
    ...overrides,
  };
}

export function albumAssetMapOf(
  assets: 图片资源[] | Array<{ id: string; url?: string; dataUrl?: string; localRef?: string }>,
): Map<string, AlbumAssetSource> {
  const map = new Map<string, AlbumAssetSource>();
  for (const asset of assets) {
    map.set(asset.id, { url: asset.url, dataUrl: asset.dataUrl, localRef: asset.localRef });
  }
  return map;
}

export function registerAlbumCacheTeardown(): void {
  afterEach(() => {
    clearAlbumAssetObjectUrlCache();
  });
}
