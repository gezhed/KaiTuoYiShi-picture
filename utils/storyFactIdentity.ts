// 身份不得包含标题、数组下标或当前时间；同一内容必得同一 factId。
import type { 世界事实 } from '@/models/storyWeaving';
import { 世界事实上限 } from '@/models/storyWeaving';
import { stableStringify } from '@/utils/stableHash';

/** 重投影须复用同一 ID。 */
export function 世界事件实例ID(seriesId: string, segmentId: string): string {
  return `we:${seriesId}:${segmentId}`;
}

export function 世界事实身份(input: {
  sourceEventInstanceId: string;
  sourceRevision: number;
  factType: string;
  payload: Record<string, unknown>;
}): string {
  return stableStringify({
    eventInstanceId: input.sourceEventInstanceId,
    sourceRevision: Math.max(0, Math.trunc(input.sourceRevision)),
    factType: input.factType,
    payload: input.payload,
  });
}

export function 合并世界事实(现有: 世界事实[], 新增: 世界事实[], 上限 = 世界事实上限): 世界事实[] {
  const seen = new Set(现有.map((fact) => fact.factId));
  const merged = [...现有];
  for (const fact of 新增) {
    if (seen.has(fact.factId)) continue;
    seen.add(fact.factId);
    merged.push(fact);
  }
  return merged.slice(-上限);
}
