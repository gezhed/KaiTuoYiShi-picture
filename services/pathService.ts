import type { 命途ID } from '@/models/journey';
import type { 角色数据结构 } from '@/models/character';
import type { 世界状态 } from '@/models/world';
import type { 命途增量, 命途进度, 命途阶段 } from '@/models/path';
import {
  STAGE_PROGRESS_MAX,
  DAILY_PROGRESS_CAP,
  创建命途进度,
  FORGET_RATE_BY_STAGE,
} from '@/models/path';

function findPathIndex(paths: 命途进度[], id: 命途ID): number {
  return paths.findIndex((p) => p.id === id);
}

function bumpProgress(prog: 命途进度, delta: number): 命途进度 {
  if (delta === 0) return prog;
  let stage: 命途阶段 = prog.阶段;
  let progress = prog.进度 + delta;
  let 待升阶 = prog.待升阶 ?? false;

  if (delta > 0 && progress >= STAGE_PROGRESS_MAX) {
    progress = STAGE_PROGRESS_MAX - 1;
    待升阶 = true;
  }
  while (progress < 0 && stage > 0) {
    progress += STAGE_PROGRESS_MAX;
    stage = (stage - 1) as 命途阶段;
    待升阶 = false;
  }
  if (stage === 0 && progress < 0) progress = 0;

  return { ...prog, 阶段: stage, 进度: progress, 待升阶 };
}

export interface 推进结果 {
  traveler: 角色数据结构;
  applied: number;
  capped: boolean;
  ready: boolean;
  message?: string;
}

export function 推进命途进度(
  traveler: 角色数据结构,
  pathId: 命途ID,
  delta: number,
  currentDate: string,
  options: { bypassDailyCap?: boolean } = {},
): 推进结果 {
  const paths = traveler.命途列表;
  const idx = findPathIndex(paths, pathId);
  if (idx < 0) {
    return { traveler, applied: 0, capped: false, ready: false, message: '尚未踏上此命途' };
  }

  const prog = paths[idx];

  if (delta < 0) {
    const next = [...paths];
    next[idx] = bumpProgress(prog, delta);
    return {
      traveler: { ...traveler, 命途列表: next },
      applied: delta,
      capped: false,
      ready: false,
    };
  }

  if (delta === 0) {
    return { traveler, applied: 0, capped: false, ready: prog.待升阶 ?? false };
  }

  if (prog.待升阶) {
    return {
      traveler,
      applied: 0,
      capped: true,
      ready: true,
      message: '命途进度已满,正等待「命途狭间」之引,无法再行积累',
    };
  }

  const sameDay = (prog.今日日期 ?? '') === currentDate;
  const todayAccum = sameDay ? (prog.今日累计 ?? 0) : 0;

  let applied = delta;
  let capped = false;
  if (!options.bypassDailyCap) {
    const remaining = Math.max(0, DAILY_PROGRESS_CAP - todayAccum);
    if (remaining <= 0) {
      return {
        traveler,
        applied: 0,
        capped: true,
        ready: false,
        message: '今天已经在这方面有所感悟了,一时间没有太多突破',
      };
    }
    if (delta > remaining) {
      applied = remaining;
      capped = true;
    }
  }

  const bumped = bumpProgress(prog, applied);
  const nextRecord: 命途进度 = {
    ...bumped,
    今日累计: todayAccum + applied,
    今日日期: currentDate,
  };

  const nextPaths = [...paths];
  nextPaths[idx] = nextRecord;

  return {
    traveler: { ...traveler, 命途列表: nextPaths },
    applied,
    capped,
    ready: nextRecord.待升阶 ?? false,
    message: capped
      ? '今天已经在这方面有所感悟了,一时间没有太多突破'
      : nextRecord.待升阶
        ? '命途进度已满,即将迎来「命途狭间」之引'
        : undefined,
  };
}

export function awakenPath(
  traveler: 角色数据结构,
  pathId: 命途ID,
  options: { awakenedAt?: string; notes?: string; primary?: boolean } = {},
): { traveler: 角色数据结构; isNew: boolean } {
  const paths = [...(traveler.命途列表)];
  const existingIdx = findPathIndex(paths, pathId);
  const awakenedAt = options.awakenedAt ?? '';

  if (existingIdx >= 0) {
    if (options.primary) {
      const updated = paths.map((p, i) => ({ ...p, 是否主命途: i === existingIdx }));
      return { traveler: { ...traveler, 命途列表: updated }, isNew: false };
    }
    return { traveler, isNew: false };
  }

  const newRecord = 创建命途进度(
    pathId,
    Boolean(options.primary),
    awakenedAt,
    options.notes ?? '剧情中踏上',
  );

  let updated = paths;
  if (newRecord.是否主命途) {
    updated = paths.map((p) => ({ ...p, 是否主命途: false }));
  }
  updated = [...updated, newRecord];

  return {
    traveler: { ...traveler, 命途列表: updated, 主命途: newRecord.是否主命途 ? pathId : traveler.主命途 },
    isNew: true,
  };
}

export function applyPathDeltas(
  traveler: 角色数据结构,
  deltas: 命途增量[],
  awakenedAt: string,
  options: { currentDate?: string; bypassDailyCap?: boolean } = {},
): {
  traveler: 角色数据结构;
  awakenedPathIds: 命途ID[];
  forgottenLosses: { pathId: 命途ID; loss: number; reason: 'forget' }[];
} {
  let next = traveler;
  const awakenedPathIds: 命途ID[] = [];
  const forgottenLosses: { pathId: 命途ID; loss: number; reason: 'forget' }[] = [];

  for (const d of deltas) {
    if (d.newPath) {
      const res = awakenPath(next, d.pathId, {
        awakenedAt,
        notes: d.reason,
        primary: d.setPrimary,
      });
      next = res.traveler;
      if (res.isNew) awakenedPathIds.push(d.pathId);
    } else if (d.setPrimary) {
      const idx = findPathIndex(next.命途列表, d.pathId);
      if (idx >= 0) {
        const paths = (next.命途列表).map((p, i) => ({ ...p, 是否主命途: i === idx }));
        next = { ...next, 命途列表: paths, 主命途: d.pathId };
      }
    }

    if (d.progressDelta) {
      const idx = findPathIndex(next.命途列表, d.pathId);
      if (idx >= 0) {
        const progressResult = 推进命途进度(
          next,
          d.pathId,
          d.progressDelta,
          options.currentDate ?? awakenedAt,
          { bypassDailyCap: options.bypassDailyCap },
        );
        next = progressResult.traveler;

        if (progressResult.applied > 0) {
          const forgetLosses = computeForgetting(next, d.pathId, progressResult.applied);

          for (const fl of forgetLosses) {
            const i = findPathIndex(next.命途列表, fl.pathId);
            if (i >= 0) {
              const ps = [...(next.命途列表)];
              ps[i] = bumpProgress(ps[i], -fl.loss);
              next = { ...next, 命途列表: ps };
              forgottenLosses.push({ pathId: fl.pathId, loss: fl.loss, reason: 'forget' });
            }
          }
        }
      }
    }
  }

  return { traveler: next, awakenedPathIds, forgottenLosses };
}

export function computeForgetting(
  traveler: 角色数据结构,
  advancedPathId: 命途ID,
  appliedDelta: number,
): { pathId: 命途ID; loss: number }[] {
  const paths = traveler.命途列表;
  const advanced = paths.find((p) => p.id === advancedPathId);
  if (!advanced) return [];
  const rate = FORGET_RATE_BY_STAGE[advanced.阶段];
  if (rate <= 0 || appliedDelta <= 0) return [];

  const losses: { pathId: 命途ID; loss: number }[] = [];
  for (const p of paths) {
    if (p.id === advancedPathId) continue;
    if (p.是否主命途) continue;
    const loss = Math.round(appliedDelta * rate);
    if (loss > 0) losses.push({ pathId: p.id, loss });
  }
  return losses;
}

export function manualBumpProgress(
  traveler: 角色数据结构,
  pathId: 命途ID,
  delta: number,
): 角色数据结构 {
  const idx = findPathIndex(traveler.命途列表, pathId);
  if (idx < 0) return traveler;
  const paths = [...(traveler.命途列表)];
  paths[idx] = bumpProgress(paths[idx], delta);
  return { ...traveler, 命途列表: paths };
}

export function setPrimaryPath(
  traveler: 角色数据结构,
  pathId: 命途ID,
): 角色数据结构 {
  const paths = (traveler.命途列表).map((p) => ({ ...p, 是否主命途: p.id === pathId }));
  return { ...traveler, 命途列表: paths, 主命途: pathId };
}

export { 解析命途ID } from '@/data/pathCatalog';

export function 踏入命途狭间(world: 世界状态): 世界状态 {
  if (!world.待触发狭间) return world;
  if (world.进行中狭间) return world;
  return { ...world, 进行中狭间: world.待触发狭间, 待触发狭间: undefined };
}

export function 拒绝命途狭间(world: 世界状态): 世界状态 {
  if (!world.待触发狭间) return world;
  return { ...world, 待触发狭间: undefined };
}

/**
 * 不检查 `待升阶`：狭间出题与升阶之间变量模型可能把它误清为 false（它没有狭间语义），
 * 真正的状态机门是世界.进行中狭间。
 */
export function 升阶(
  traveler: 角色数据结构,
  pathId: 命途ID,
): { traveler: 角色数据结构; ok: boolean; reason?: string } {
  const paths = traveler.命途列表;
  const idx = findPathIndex(paths, pathId);
  if (idx < 0) return { traveler, ok: false, reason: '尚未踏上此命途' };

  const prog = paths[idx];
  if (prog.阶段 >= 3) {
    return { traveler, ok: false, reason: '伪令使是自然修行的天花板,跨入令使须星神亲临授力' };
  }

  const nextStage = (prog.阶段 + 1) as 命途阶段;
  const next: 命途进度 = {
    ...prog,
    阶段: nextStage,
    进度: 0,
    待升阶: false,
    今日累计: 0,
    今日日期: prog.今日日期 ?? '',
  };
  const nextPaths = [...paths];
  nextPaths[idx] = next;
  return { traveler: { ...traveler, 命途列表: nextPaths }, ok: true };
}

export function 星神授力(
  traveler: 角色数据结构,
  pathId: 命途ID,
): { traveler: 角色数据结构; ok: boolean; reason?: string } {
  const paths = traveler.命途列表;
  const idx = findPathIndex(paths, pathId);
  if (idx < 0) return { traveler, ok: false, reason: '旅人尚未踏上此命途,星神之力无所附' };

  const prog = paths[idx];
  if (prog.阶段 === 4) return { traveler, ok: false, reason: '已是令使,无可再授' };

  const next: 命途进度 = {
    ...prog,
    阶段: 4,
    进度: 0,
    待升阶: false,
    今日累计: 0,
  };
  const nextPaths = [...paths];
  nextPaths[idx] = next;
  return { traveler: { ...traveler, 命途列表: nextPaths }, ok: true };
}

export type 狭间评判 = '升阶';

export function 应用狭间结果(
  traveler: 角色数据结构,
  pathId: 命途ID,
  judgement: 狭间评判,
): { traveler: 角色数据结构; ok: boolean; reason?: string } {
  void judgement;
  const prog = (traveler.命途列表).find((p) => p.id === pathId);
  if (prog?.阶段 === 3) return 星神授力(traveler, pathId);
  return 升阶(traveler, pathId);
}
