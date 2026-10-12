import type { TurnContext, TurnDeltas } from './turnTypes';
import { autoAlignCanonStoryProgress, 获取当前剧情分段, 获取激活剧情系列 } from '@/services/storyProgressService';
import { 评估剧情区域连续性, 推断系列区域ID } from '@/models/region';
import { buildStoryAdvanceJudgeApiConfig } from '@/services/storyWeaving';
import { judgeStoryAdvance, type StoryAdvanceJudgement } from '@/services/storyAdvanceJudge';
import { applyStoryArchiveZhikuRuntimeUnlock } from '@/services/zhikuRuntimeUnlock';
import { addImmediateMemory } from './memoryUtils';
import { pushQueueTask } from './workflowTaskRuntime';
import { devLog } from '@/utils/devLog';
import type { 记忆系统 } from '@/models/memory';
import type { NPC记录 } from '@/models/npc';
import {
  applyStoryProgressNpcMemory,
  buildStoryProgressMemoryLine,
  resolveStoryWeavingForBackgroundWrite,
} from './storyWeavingWorkflow';

export async function stage10_storyZhiku(
  ctx: TurnContext,
  d: TurnDeltas,
): Promise<Partial<TurnDeltas>> {
  const { state, userInput, effectiveWorld, assertWorkflowActive, turnCountAtStart, queueTasksMirror, zhikuAtStart } = ctx;
  devLog('stage', 'stage10_storyZhiku.enter', { turn: turnCountAtStart });
  const variableOverrides = d.variableOverrides;
  const displayText = d.displayText as string;
  const worldAfter = d.worldAfter;
  const storyWeavingGate = d.storyWeavingGate;
  let npcAfterCompression = d.npcAfterCompression as NPC记录[];
  const mem = d.mem as 记忆系统;

  const isOpeningSystemTrigger = turnCountAtStart === 1 && userInput.startsWith('[系统]');
  const skipStoryAlignment = isOpeningSystemTrigger || d.isPathAwakeningTurn === true;

  const storyWorld = variableOverrides?.世界 ?? worldAfter ?? effectiveWorld;
  const currentLocation = storyWorld.当前地点 || effectiveWorld.当前地点;
  const continuitySeries = 获取激活剧情系列(state.剧情编织);
  const continuity = !skipStoryAlignment && continuitySeries
    ? 评估剧情区域连续性({
        currentRegionId: storyWorld.当前区域ID || effectiveWorld.当前区域ID,
        currentLocation,
        openingRegionId: storyWorld.开局档案?.地区ID ?? effectiveWorld.开局档案?.地区ID,
        seriesRegionId: 推断系列区域ID(continuitySeries),
      })
    : { hold: false, reasons: [] };
  if (continuity.hold) {
    devLog('stage', 'stage10.continuity_hold', { turn: turnCountAtStart, reasons: continuity.reasons });
  }

  const declaredAdvance = !skipStoryAlignment && !continuity.hold
    ? d.parsedForDisplay?.storyAdvance ?? null
    : null;

  let advanceJudge: StoryAdvanceJudgement | null = null;
  if (state.deviceSettings.gameSettings.剧情编织系统.剧情推进AI判定 && !skipStoryAlignment && !continuity.hold) {
    const judgeSegment = 获取当前剧情分段(state.剧情编织);
    const judgeConfig = judgeSegment
      ? buildStoryAdvanceJudgeApiConfig(state.deviceSettings.gameSettings, state.deviceSettings.apiSettings)
      : null;
    if (judgeSegment && judgeConfig) {
      advanceJudge = await judgeStoryAdvance(judgeConfig, { currentSegment: judgeSegment, body: displayText, playerInput: userInput }, ctx.abortController.signal);
      devLog('stage', 'stage10.advance_judge', {
        completed: advanceJudge?.completed ?? null,
        target: advanceJudge?.actualSegmentId,
        reason: advanceJudge?.reason,
        declaredCompleted: declaredAdvance?.completed ?? null,
        declaredTarget: declaredAdvance?.targetSegment,
      });
    } else if (judgeSegment) {
      devLog('stage', 'stage10.advance_judge.skip', { reason: 'unconfigured' });
    }
  }

  let memoryAfterStoryProgress = variableOverrides?.记忆 ?? mem;
  const storyWeaving = d.storyWeavingForSave ?? state.剧情编织;
  const storyAlignment = skipStoryAlignment || continuity.hold
    ? { system: storyWeaving, changed: false, progressed: false }
    : autoAlignCanonStoryProgress({
        storyWeaving,
        turnCount: turnCountAtStart + 1,
        userInput,
        body: displayText,
        currentLocation,
        gateSnapshot: storyWeavingGate,
        advanceJudge,
        declaredAdvance,
        factEvidence: d.worldFactEvidence,
      });
  const storyProgressMemoryLine = storyAlignment.progressed
    ? buildStoryProgressMemoryLine(state.剧情编织, storyAlignment.system)
    : '';
  let storyWeavingForSave = storyAlignment.system;
  let storyWeavingConcurrentChange = false;
  if (storyAlignment.changed) {
    assertWorkflowActive();
    const resolvedStory = await resolveStoryWeavingForBackgroundWrite({
      workflowBase: state.剧情编织,
      proposed: storyAlignment.system,
    });
    storyWeavingForSave = resolvedStory.system;
    storyWeavingConcurrentChange = resolvedStory.concurrentChange;
    if (!storyWeavingConcurrentChange) {
      state.set剧情编织(storyWeavingForSave);
    } else {
      pushQueueTask(state, 'zhiku', 'success', {
        detail: '检测到剧情编织面板已有更新，本回合后台未覆盖最新导入/分解结果。',
      }, turnCountAtStart, queueTasksMirror);
    }
    assertWorkflowActive();
    if (storyProgressMemoryLine && !storyWeavingConcurrentChange) {
      memoryAfterStoryProgress = addImmediateMemory(memoryAfterStoryProgress, storyProgressMemoryLine, turnCountAtStart + 1);
      const npcAfterStoryProgress = applyStoryProgressNpcMemory(
        npcAfterCompression,
        storyWeavingForSave,
        storyProgressMemoryLine,
        turnCountAtStart + 1,
      );
      if (npcAfterStoryProgress !== npcAfterCompression) {
        npcAfterCompression = npcAfterStoryProgress;
        state.setNPC(npcAfterCompression);
      }
    }
  }
  let zhikuAfterRuntimeUnlock = zhikuAtStart;
  if (storyAlignment.progressed && !storyWeavingConcurrentChange) {
    const zhikuUnlock = applyStoryArchiveZhikuRuntimeUnlock({
      zhiku: zhikuAtStart,
      storyWeaving: storyWeavingForSave,
    });
    if (zhikuUnlock.changed) {
      assertWorkflowActive();
      zhikuAfterRuntimeUnlock = zhikuUnlock.system;
      state.set智库(zhikuAfterRuntimeUnlock);
      assertWorkflowActive();
      pushQueueTask(state, 'zhiku', 'success', {
        detail: `剧情归档已更新智库门禁：${zhikuUnlock.unlocked.slice(0, 3).map((item) => `${item.title}→${item.status}`).join('、')}${zhikuUnlock.unlocked.length > 3 ? ` 等 ${zhikuUnlock.unlocked.length} 项` : ''}。`,
      }, turnCountAtStart, queueTasksMirror);
    }
  }

  devLog('stage', 'stage10_storyZhiku.exit', {
    turn: turnCountAtStart,
    outputs: ['storyWeavingForSave', 'memoryAfterStoryProgress', 'zhikuAfterRuntimeUnlock', 'npcAfterCompression', 'storyProgressMemoryLine'],
  });
  return {
    storyWeavingForSave,
    memoryAfterStoryProgress,
    zhikuAfterRuntimeUnlock,
    npcAfterCompression,
    storyProgressMemoryLine,
  };
}
