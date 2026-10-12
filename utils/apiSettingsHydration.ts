import type { API设置, API配置项 } from '@/models/settings';
import { 创建空API设置 } from '@/models/settings';
import { isPlainRecord } from '@/utils/storageUtils';

/**
 * API 设置的加载时信任边界（#29 首个边界）。
 * 永不抛错：结构损坏整块回空设置；引用悬空仅修正指针。
 * 边界之后内部代码只管信任 `activeConfigId` 指向有效项或为 null。
 */
export function hydratePersistedApiSettings(value: unknown): API设置 {
  if (!isPlainRecord(value)) return 创建空API设置();
  const configs = Array.isArray(value.configs)
    ? value.configs.filter(
        (item): item is API配置项 => isPlainRecord(item) && typeof item.id === 'string' && item.id !== '',
      )
    : [];
  const activeConfigId = typeof value.activeConfigId === 'string' && configs.some((item) => item.id === value.activeConfigId)
    ? value.activeConfigId
    : configs[0]?.id ?? null;
  return { activeConfigId, configs };
}
