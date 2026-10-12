import { 归一化参与者名单, type 世界事件实例, type 世界事实 } from '@/models/storyWeaving';
import { 世界事实身份 } from '@/utils/storyFactIdentity';

export interface 世界演变候选事实 {
  factType: string;
  payload?: Record<string, unknown>;
  playerKnown?: boolean;
  participants?: string[];
}

export interface 世界演变候选 {
  eventInstanceId: string;
  action: 'resolve' | 'reschedule' | 'ignore';
  dueAt?: number;
  outcome?: string;
  facts?: 世界演变候选事实[];
  note?: string;
}

export type 世界演变裁决结果 =
  | { ok: true; events: 世界事件实例[]; facts: 世界事实[] }
  | { ok: false; message: string };

export function 裁决世界演变(params: {
  candidates: 世界演变候选[];
  events: 世界事件实例[];
  dueInstanceIds: string[];
  resolvableInstanceIds?: string[];
  runtimeRevision: number;
  当前游戏日: number;
}): 世界演变裁决结果 {
  const resolvable = new Set(params.resolvableInstanceIds ?? params.dueInstanceIds);
  const byId = new Map(params.events.map((event) => [event.eventInstanceId, event]));
  for (const candidate of params.candidates) {
    const target = byId.get(candidate.eventInstanceId);
    if (!target || !resolvable.has(candidate.eventInstanceId)) {
      return { ok: false, message: `候选引用了不可结算事件：${candidate.eventInstanceId || '(空)'}` };
    }
    if (!['resolve', 'reschedule', 'ignore'].includes(candidate.action)) {
      return { ok: false, message: `候选动作非法：${candidate.action}` };
    }
    if (target.status === 'resolved' || target.status === 'missed' || target.status === 'superseded') {
      return { ok: false, message: `候选引用了已终态事件：${candidate.eventInstanceId}` };
    }
    if (candidate.action === 'resolve' && target.status === 'scheduled') {
      const outcome = candidate.outcome?.trim() || candidate.note?.trim();
      if (!outcome) {
        return { ok: false, message: `提前解决必须给出 outcome：${candidate.eventInstanceId}` };
      }
    }
  }

  const now = Date.now();
  const facts: 世界事实[] = [];
  const candidateById = new Map(params.candidates.map((candidate) => [candidate.eventInstanceId, candidate]));
  const next = params.events.map((event) => {
    const candidate = candidateById.get(event.eventInstanceId);
    if (!candidate) return event;
    const outcome = candidate.outcome?.trim() || candidate.note?.trim() || undefined;
    if (candidate.action === 'reschedule') {
      return {
        ...event,
        status: 'scheduled' as const,
        dueAt: Math.max(params.当前游戏日 + 1, Math.trunc(candidate.dueAt ?? params.当前游戏日 + 1)),
        resolutionKey: undefined,
        outcome,
        updatedAt: now,
      };
    }
    if (candidate.action === 'ignore') {
      return { ...event, status: 'missed' as const, outcome, resolvedAt: params.当前游戏日, updatedAt: now };
    }
    for (const fact of candidate.facts ?? []) {
      const factType = typeof fact.factType === 'string' ? fact.factType.trim() : '';
      if (!factType) continue;
      const payload = fact.payload ?? {};
      const participants = 归一化参与者名单(fact.participants);
      facts.push({
        factId: 世界事实身份({
          sourceEventInstanceId: event.eventInstanceId,
          sourceRevision: params.runtimeRevision,
          factType,
          payload,
        }),
        factType,
        payload,
        sourceEventInstanceId: event.eventInstanceId,
        playerKnown: fact.playerKnown === true,
        committedAt: params.当前游戏日,
        origin: event.status === 'scheduled' ? 'player_early' : 'world_evolution',
        ...(participants ? { participants } : {}),
      });
    }
    if (event.status === 'scheduled') {
      return {
        ...event,
        status: 'superseded' as const,
        outcome,
        resolvedAt: params.当前游戏日,
        updatedAt: now,
      };
    }
    return {
      ...event,
      status: 'resolved' as const,
      outcome,
      resolvedAt: params.当前游戏日,
      updatedAt: now,
    };
  });

  return { ok: true, events: next, facts };
}
