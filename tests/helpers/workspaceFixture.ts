import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { 初始化新局checkpoint, type 新局初始字段 } from '@/hooks/useGame/commitTurn';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import { createGameStateHarness, type GameStateHarness } from './gameStateHarness';
import { 创建空角色 } from '@/models/character';
import { 创建空世界状态 } from '@/models/world';
import { 创建空记忆系统 } from '@/models/memory';
import { 创建空忆庭系统 } from '@/models/yiting';
import { 创建空智库系统 } from '@/models/zhiku';
import { 创建空手机系统 } from '@/models/phone';
import { 创建空相册系统 } from '@/models/imageGeneration';
import { 归一化剧情编织系统 } from '@/models/storyWeaving';

export async function resetWorkspaceDatabase(): Promise<void> {
  const names = new Set<string>(['TimeJourneyDB']);
  try {
    const idb = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
    if (typeof idb.databases === 'function') {
      const infos = await idb.databases();
      for (const info of infos) if (info.name) names.add(info.name);
    }
  } catch {
  }
  for (const name of names) {
    await new Promise<void>((resolve) => {
      try {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

beforeEach(async () => {
  await resetWorkspaceDatabase();
});

export function buildWorkspaceFields(overrides: Partial<新局初始字段> = {}): 新局初始字段 {
  return {
    turnCount: 1,
    chatHistory: [],
    macroGlobalVars: {},
    worldbookTriggerStates: {},
    turnPhase: 'awaitingLanding',
    recoveryContext: null,
    queueTasks: [],
    variableBatches: [],
    NPC: [],
    新闻: [],
    剧情: [],
    相册: 创建空相册系统(),
    手机: 创建空手机系统(),
    智库: 创建空智库系统(),
    忆庭: 创建空忆庭系统(),
    记忆: 创建空记忆系统(),
    世界: 创建空世界状态(),
    旅人: 创建空角色(),
    剧情编织: 归一化剧情编织系统(undefined),
    ...overrides,
  };
}

export async function seedWorkspace(
  state: UseGameStateReturn,
  overrides: Partial<新局初始字段> = {},
): Promise<void> {
  const fields = buildWorkspaceFields(overrides);
  await 初始化新局checkpoint(fields, state);
  state.set旅人(fields.旅人);
  state.set世界(fields.世界);
  state.setChatHistory(fields.chatHistory);
  state.set记忆(fields.记忆);
  state.set忆庭(fields.忆庭 ?? 创建空忆庭系统());
  state.set智库(fields.智库 ?? 创建空智库系统());
  state.set手机(fields.手机 ?? 创建空手机系统());
  state.setNPC(fields.NPC ?? []);
  state.set相册(fields.相册 ?? 创建空相册系统());
  state.set新闻(fields.新闻 ?? []);
  state.set剧情(fields.剧情 ?? []);
  state.set剧情编织(fields.剧情编织 ?? 归一化剧情编织系统(undefined));
  state.setVariableBatches(fields.variableBatches ?? []);
  state.setQueueTasks(fields.queueTasks ?? []);
  state.setTurnCount(fields.turnCount ?? 1);
  state.setTurnPhase(fields.turnPhase ?? null);
  state.activeWorkflow.setRecovery(fields.recoveryContext ?? null);
}

export async function seedDefaultWorkspace(
  overrides: Partial<新局初始字段> = {},
): Promise<GameStateHarness> {
  const harness = createGameStateHarness();
  await seedWorkspace(harness.state, overrides);
  return harness;
}
