/**
 * 「刚出图、还没落盘」的图片字节暂存。
 *
 * 为什么需要它：出图是**逐张**的，落盘要等全部出完。而字节原先只放在
 * 展示用的内存缓存里（`albumObjectUrl.assetCache`），那个缓存会被
 * `pruneAlbumAssetCache` 回收，于是早先几张的字节能取不到，只剩最后一张
 *（这就是「四张只保住一张」的成因）。
 *
 * 为什么不直接把字节挂在相册条目上：相册条目会进入存档、云备份与导出，
 * 那些路径里都有 `JSON.parse(JSON.stringify(save))`（见 `services/savePackage.ts`），
 * `Blob` 过一遍就变成 `{}` —— 既丢掉字节，又把存档结构弄脏。
 * 所以字节必须留在**显式**的旁路里，只在落盘那一刻取用。
 *
 * 与展示缓存的区别：这份不会被 prune 回收；落盘成功后由调用方显式清理。
 */

const 待落盘字节 = new Map<string, Blob>();

/** 记下一张刚出好的图；归档当刻调用，此后不再依赖展示缓存。 */
export function 暂存待落盘字节(assetId: string, blob: Blob): void {
  const id = assetId.trim();
  if (!id || !blob) return;
  待落盘字节.set(id, blob);
}

export function 取待落盘字节(assetId: string): Blob | undefined {
  return 待落盘字节.get(assetId.trim());
}

/** 落盘成功后清理，避免同一次会话里无限增长。 */
export function 清理待落盘字节(assetIds: Iterable<string>): void {
  for (const id of assetIds) 待落盘字节.delete(id.trim());
}

/** 只保留还在使用的那些，防止长期游玩累积。 */
export function 精简待落盘字节(retainedAssetIds: Iterable<string>): void {
  const 保留 = new Set(Array.from(retainedAssetIds, (id) => id.trim()).filter(Boolean));
  for (const id of 待落盘字节.keys()) {
    if (!保留.has(id)) 待落盘字节.delete(id);
  }
}

/** 仅供测试与诊断：当前暂存数量。 */
export function 待落盘字节数量(): number {
  return 待落盘字节.size;
}
