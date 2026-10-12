import type { 世界书, 世界书导出数据 } from '@/models/worldbook';
import { normalizeWorldbooks } from '@/utils/worldbook';

export interface BundledWorldbookPreset {
  id: string;
  title: string;
  description: string;
  path: string;
}

export const bundledWorldbookPresets: BundledWorldbookPreset[] = [];

export async function loadBundledWorldbookPreset(
  preset: BundledWorldbookPreset,
): Promise<世界书[]> {
  const response = await fetch(preset.path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${preset.title} 读取失败(HTTP ${response.status})`);
  }
  const data = (await response.json()) as 世界书导出数据;
  if (!Array.isArray(data.books)) {
    throw new Error(`${preset.title} 文件结构异常`);
  }
  return normalizeWorldbooks(data.books);
}

export async function loadAllBundledWorldbookPresets(): Promise<世界书[]> {
  if (!bundledWorldbookPresets.length) return [];
  const payloads = await Promise.all(
    bundledWorldbookPresets.map((preset) => loadBundledWorldbookPreset(preset)),
  );
  return payloads.flat();
}

