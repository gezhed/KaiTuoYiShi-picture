import type { 世界事件实例, 世界事实, 剧情编织系统, 剧情编织运行时 } from '@/models/storyWeaving';
import { 归一化剧情编织运行时 } from '@/models/storyWeaving';
import { appendWorldEvents } from '@/utils/worldEvents';
import { 合并世界事实 } from '@/utils/storyFactIdentity';
import { 投影排期事件 } from '@/services/storyRuntimeProjection';
import { 扫描到期世界事件, 退回未决事件 } from '@/services/dueEventScanner';
import { 裁决世界演变 } from '@/services/worldEvolutionAdjudicator';
import { runWorldEvolutionStep } from '@/services/worldEvolution';
import { 事实摘要, 可展示世界事件, 构造世界事实视图 } from '@/services/storyFactConsumerView';
import { applyWorldFactNpcMemory } from '@/services/worldFactNpcMemory';
import { 获取激活剧情系列 } from '@/services/storyProgressService';
import { buildStoryWeavingApiConfig } from '@/services/storyWeaving';
import { pushQueueTask } from './workflowTaskRuntime';
import type { TurnContext, TurnDeltas } from './turnTypes';

/** 无变化时须原样返回 baseSystem，不制造新的存档对象。 */
function 写回运行时(
  baseSystem: 剧情编织系统,
  runtime: 剧情编织运行时,
  patch: Partial<Pick<剧情编织运行时, 'worldEvents' | 'factLedger' | 'runtimeRevision'>>,
): 剧情编织系统 {
  const unchanged = (patch.worldEvents ?? runtime.worldEvents) === runtime.worldEvents
    && (patch.factLedger ?? runtime.factLedger) === runtime.factLedger
    && (patch.runtimeRevision ?? runtime.runtimeRevision) === runtime.runtimeRevision;
  if (unchanged) return baseSystem;
  return { ...baseSystem, 运行时: { ...runtime, ...patch, updatedAt: Date.now() } };
}

function 展示文本(events: 世界事件实例[], facts: 世界事实[], 游戏日: number, baseSystem: 剧情编织系统): string[] {
  const knownByEvent = new Map(
    facts.filter((fact) => fact.playerKnown).map((fact) => [fact.sourceEventInstanceId, fact]),
  );
  const activeSeries = 获取激活剧情系列(baseSystem);
  const 当前组号 = baseSystem.当前进度?.当前分段组号 ?? activeSeries?.当前分段组号;
  const displayable = 可展示世界事件(
    events.filter((event) => event.status === 'resolved' && event.resolvedAt === 游戏日),
    baseSystem.系列列表,
    当前组号,
  );
  return displayable
    .map((event) => event.outcome || 事实摘要(knownByEvent.get(event.eventInstanceId)?.payload ?? {}))
    .filter(Boolean);
}

export async function stage9b_worldEvolution(ctx: TurnContext, d: TurnDeltas): Promise<Partial<TurnDeltas>> {
  const { state, effectiveWorld, assertWorkflowActive, turnCountAtStart, queueTasksMirror } = ctx;
  const settings = state.deviceSettings.gameSettings.剧情编织系统;
  const baseSystem = d.storyWeavingForSave ?? state.剧情编织;
  const runtime = 归一化剧情编织运行时(baseSystem.运行时);
  const worldForWrite = { ...(d.variableOverrides?.世界 ?? d.worldAfter ?? effectiveWorld) };
  const 游戏日 = Math.max(1, Math.trunc(worldForWrite.开拓天数 || 1));
  const projected = 投影排期事件(baseSystem, runtime, 游戏日, worldForWrite.当前日期);
  const clues = (d.parsedForDisplay?.worldEvents ?? []).filter((text) => typeof text === 'string' && text.trim());
  const gated = settings.enabled && settings.currentWindow && settings.世界演变
    && !ctx.isOpeningSystemTrigger && d.isPathAwakeningTurn !== true;

  if (!gated) {
    return { storyWeavingForSave: 写回运行时(baseSystem, runtime, { worldEvents: projected }) };
  }

  // 旧档线索：最近 ≤6 条世界全局事件同样参与演变，排在本回合线索之后。
  const legacyLabels = worldForWrite.全局事件
    .filter((text) => typeof text === 'string' && text.trim())
    .slice(-6)
    .map((text) => `旧档世界事件：${text.trim()}`);

  const scanned = 扫描到期世界事件(projected, runtime.runtimeRevision, 游戏日);
  pushQueueTask(state, 'world_evolution', 'pending', {
    detail: scanned.dueInstanceIds.length || clues.length
      ? '正在处理到期事件与动态世界线索。'
      : '正在检查本回合是否有待处理世界演变。',
    cancellable: true,
  }, turnCountAtStart, queueTasksMirror);

  const result = await runWorldEvolutionStep({
    config: buildStoryWeavingApiConfig(state.deviceSettings.gameSettings, state.deviceSettings.apiSettings),
    events: scanned.events,
    dueInstanceIds: scanned.dueInstanceIds,
    clues: [...clues, ...legacyLabels],
    当前游戏日: 游戏日,
    signal: ctx.abortController.signal,
  });
  assertWorkflowActive();

  if (!result.ok) {
    pushQueueTask(state, 'world_evolution', 'failed', { detail: result.failureReason }, turnCountAtStart, queueTasksMirror);
    return { storyWeavingForSave: 写回运行时(baseSystem, runtime, { worldEvents: 退回未决事件(scanned.events) }) };
  }
  if (result.skipped) {
    pushQueueTask(state, 'world_evolution', 'skipped', { detail: '没有到期事件或世界演变线索，已跳过。' }, turnCountAtStart, queueTasksMirror);
    return { storyWeavingForSave: 写回运行时(baseSystem, runtime, { worldEvents: scanned.events }) };
  }

  const runtimeRevision = runtime.runtimeRevision + 1;
  const resolvableInstanceIds = Array.from(new Set([
    ...scanned.dueInstanceIds,
    ...scanned.events.filter((event) => event.status === 'scheduled').map((event) => event.eventInstanceId),
  ]));
  const adjudicated = 裁决世界演变({
    candidates: result.candidates,
    events: scanned.events,
    dueInstanceIds: scanned.dueInstanceIds,
    resolvableInstanceIds,
    runtimeRevision,
    当前游戏日: 游戏日,
  });
  if (!adjudicated.ok) {
    pushQueueTask(state, 'world_evolution', 'failed', { detail: adjudicated.message }, turnCountAtStart, queueTasksMirror);
    return { storyWeavingForSave: 写回运行时(baseSystem, runtime, { worldEvents: 退回未决事件(scanned.events) }) };
  }

  const factLedger = 合并世界事实(runtime.factLedger, adjudicated.facts);
  const labels = 展示文本(adjudicated.events, adjudicated.facts, 游戏日, baseSystem);
  const worldFactEvidence = Array.from(new Set([
    ...adjudicated.events
      .filter((event) => (event.status === 'resolved' || event.status === 'superseded') && event.resolvedAt === 游戏日)
      .map((event) => (event.outcome ?? '').trim()),
    ...adjudicated.facts.filter((fact) => fact.playerKnown).map((fact) => 事实摘要(fact.payload)),
  ].filter((text) => text.length > 0))).slice(0, 8);
  let worldAfter = d.worldAfter;
  let variableOverrides = d.variableOverrides;
  if (labels.length) {
    const mergedWorld = { ...worldForWrite, 全局事件: appendWorldEvents(worldForWrite.全局事件, labels) };
    worldAfter = mergedWorld;
    if (variableOverrides?.世界) variableOverrides = { ...variableOverrides, 世界: mergedWorld };
  }
  pushQueueTask(state, 'world_evolution', 'success', {
    detail: `世界演变已结算：${adjudicated.facts.length} 条事实，${labels.length} 条玩家可见。`,
  }, turnCountAtStart, queueTasksMirror);
  const npcSource = d.npcAfterCompression ?? [];
  const npcAfterCompression = applyWorldFactNpcMemory(npcSource, adjudicated.facts, turnCountAtStart + 1);
  if (npcAfterCompression !== npcSource) {
    state.setNPC(npcAfterCompression);
  }
  return {
    storyWeavingForSave: 写回运行时(baseSystem, runtime, { worldEvents: adjudicated.events, factLedger, runtimeRevision }),
    worldFactView: 构造世界事实视图(factLedger, adjudicated.facts),
    worldFactEvidence,
    npcAfterCompression,
    worldAfter,
    variableOverrides,
  };
}
