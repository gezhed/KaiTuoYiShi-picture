import type { UseGameStateReturn } from '@/hooks/useGameState';
import { type 回合快照 } from '@/models/chat';
import { parseResponse } from '@/services/ai/responseParser';
import { appendApiErrorReport } from '@/services/ai/apiErrorReportService';
import { saveSetting } from '@/services/storage/settings';
import { loadActiveLeaf } from '@/services/storage/saveTree';
import type { TurnRecoveryContext } from '@/models/turnRecovery';
import { devLog, devLogError } from '@/utils/devLog';
import { type VisibilityBufferedPublisher } from '@/utils/visibilityBufferedPublisher';
import { createRafCoalescedSetter } from '@/utils/rafCoalescedSetter';
import { setStreamingMessage } from '@/utils/streamingMessageStore';
import { 踏入命途狭间 } from '@/services/pathService';
import { OPENING_TURN_INSTRUCTION, buildAwakeningEnterInstruction } from './mainRequestFinalizer';
import { buildPersistedStoryWeavingSystem } from '@/data/storyWeavingPreset';
import { restorePreTurnSnapshot } from './turnSnapshot';
import { pushQueueTask } from './workflowTaskRuntime';
import type { TurnContext, TurnDeltas, WorkflowSendCallbacks } from './turnTypes';
import { TURN_STATUS_IDLE } from './turnStatus';
import { stage1_turnStart } from './stage1_turnStart';
import { stage2_preModel } from './stage2_preModel';
import { stage3_promptAssembly } from './stage3_promptAssembly';
import { stage4_aiRequest } from './stage4_aiRequest';
import { stage5_replyLanding } from './stage5_replyLanding';
import { projectRecovery } from './recoveryActions';
import { runTurnTail } from './turnTail';
import { isVariableSettlementError } from './variableWorkflow';
import { writeTurnLeaf } from './workflowTransaction';
import { ensureHeadLeafWritable, resetWorkflowProjection } from './saveLoadWorkflow';

export interface SendWorkflowDeps extends WorkflowSendCallbacks {
  state: UseGameStateReturn;
  getState?: () => UseGameStateReturn;
}

export async function executeSendWorkflow(
  userInput: string,
  deps: SendWorkflowDeps,
): Promise<void> {
  const { state } = deps;
  const turnCountAtStart = state.turnCount;
  const variableBatchesAtStart = state.variableBatches;
  const queueTasksMirror = [...state.queueTasks];
  const rawConfig = deps.getActiveConfig();
  if (!rawConfig) {
    alert('请先在设置中配置至少一个 API 接口。');
    return;
  }
  const config = rawConfig;
  const isOpeningSystemTrigger = turnCountAtStart === 1 && userInput.startsWith('[系统]');
  const openingInstruction = OPENING_TURN_INSTRUCTION;

  // 须在快照/作用域/systemPrompt 计算之前先把 世界.待触发狭间 转成 世界.进行中狭间——
  // 否则 currentScope 拿不到 pathAwakening,系统提示词不会切到狭间问答模块,AI 出不了题。
  const isAwakeningEnterTrigger = userInput === '[系统] 踏入命途狭间';
  let effectiveWorld: typeof state.世界 = state.世界;
  if (isAwakeningEnterTrigger && state.世界.待触发狭间) {
    effectiveWorld = 踏入命途狭间(state.世界);
    state.set世界(effectiveWorld);
  }
  const awakeningPathId = isAwakeningEnterTrigger ? effectiveWorld.进行中狭间 : undefined;
  const awakeningInstruction = awakeningPathId
    ? buildAwakeningEnterInstruction(awakeningPathId)
    : '';

  state.activeWorkflow.abortControllerRef.current?.abort();
  const abortController = new AbortController();
  state.activeWorkflow.abortControllerRef.current = abortController;
  const isCurrentWorkflow = () => state.activeWorkflow.abortControllerRef.current === abortController;
  const assertWorkflowActive = () => {
    if (abortController.signal.aborted || !isCurrentWorkflow()) {
      throw new DOMException('Workflow aborted', 'AbortError');
    }
  };

  devLog('turn', 'workflow-start', {
    role: 'main',
    turn: turnCountAtStart,
    isOpeningSystemTrigger,
    input: userInput.slice(0, 48),
  });
  deps.onBeforeSend?.();
  state.activeWorkflow.setLoading(true);
  setStreamingMessage('');
  state.activeWorkflow.setTurnStatus({ kind: 'searching', text: '忆庭召回 / 智库检索中' });
  state.activeWorkflow.setLiveRecallSummary('智库召回：检索中\n记忆召回：检索中');
  state.activeWorkflow.setLiveRecallFullContent('');
  pushQueueTask(state, 'main_story', 'pending', { detail: '正在调用主剧情模型。', cancellable: true }, turnCountAtStart, queueTasksMirror);
  let pendingVariableStarted = false;
  let keepTurnStatus = false;
  let rollbackSnapshotOnAbort: 回合快照 | null = null;
  let visibilityPublisher: VisibilityBufferedPublisher | null = null;
  const streamMessageSetter = createRafCoalescedSetter((value: string) => {
    if (isCurrentWorkflow()) setStreamingMessage(value);
  });
  const startTime = Date.now();

  const d: TurnDeltas = {};
  const ctx: TurnContext = {
    state, userInput,
    deps,
    config, mainStoryConfig: config,
    isOpeningSystemTrigger,
    isAwakeningEnterTrigger,
    awakeningPathId,
    awakeningInstruction,
    openingInstruction,
    effectiveWorld, turnCountAtStart, variableBatchesAtStart, queueTasksMirror,
    worldAtStart: state.世界,
    travelerAtStart: state.旅人,
    zhikuAtStart: state.智库,
    phoneAtStart: state.手机,
    abortController,
    isCurrentWorkflow,
    assertWorkflowActive,
    streamMessageSetter,
    rollbackSnapshotOnAbort,
  };

  try {
    const newest = await ensureHeadLeafWritable(state);
    const headNodeId = newest.headNodeId;
    if (!headNodeId) {
      throw new Error('回合写叶子失败：无法建立活跃叶子工作区。');
    }

    const s1 = await stage1_turnStart(ctx, headNodeId, userInput, effectiveWorld);
    const preTurnSnapshot = s1.preTurnSnapshot;
    const userMsg = s1.userMsg;
    rollbackSnapshotOnAbort = preTurnSnapshot;
    const updatedHistory = s1.updatedHistory;

    Object.assign(d, { preTurnSnapshot, userMsg, updatedHistory });

    Object.assign(d, await stage2_preModel(ctx, d));

    const s3 = stage3_promptAssembly(ctx, d);
    Object.assign(d, s3);
    const apiMessages = s3.apiMessages;

    const s4 = await stage4_aiRequest(ctx, d, visibilityPublisher);
    Object.assign(d, s4.deltas);
    visibilityPublisher = s4.visibilityPublisher;
    let streamedText = s4.streamedText;
    const { result, streamEventCount, preview: previewDriver } = s4;
    d.rawFullText = result.fullText;

    visibilityPublisher?.flush();

    if (abortController.signal.aborted || !isCurrentWorkflow()) return;

    Object.assign(d, await stage5_replyLanding(ctx, d, result, streamedText, streamEventCount, previewDriver, startTime, headNodeId));
    if (d.pendingVariableStarted) pendingVariableStarted = true;

    const landedAssistantId = d.aiMsg?.id;
    if (!landedAssistantId) {
      throw new Error('S5 后缺少落地助手消息 id。');
    }
    const settleRecovery: TurnRecoveryContext = { ...s1.recoveryContext, assistantMessageId: landedAssistantId };
    await writeTurnLeaf(ctx, headNodeId, {
      chatHistory: d.finalHistory,
      turnCount: turnCountAtStart + 1,
      turnPhase: 'settling',
      recoveryContext: settleRecovery,
      macroGlobalVars: d.macroGlobalVarsAfterTurn ?? state.macroGlobalVars,
      worldbookTriggerStates: d.worldbookTriggerStatesAfterTurn ?? state.worldbookTriggerStates,
    });
    projectRecovery(state, 'settling', settleRecovery);

    result.fullText = '';
    result.parsed = parseResponse('');
    result.usage = undefined;
    apiMessages.length = 0;
    streamedText = '';
    await runTurnTail(ctx, d, newest);

  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError' || abortController.signal.aborted) {
      if (!isCurrentWorkflow()) return;
      // 新鲜开局（awaitingLanding + 无恢复上下文）也如实投影：否则派发谓词在刷新前无法重发开局。
      const active = await loadActiveLeaf();
      const leafPhase = active.status === 'ok' ? (active.leaf.turnPhase ?? null) : null;
      const leafRecovery = active.status === 'ok' ? (active.leaf.recoveryContext ?? null) : null;
      projectRecovery(state, leafPhase, leafRecovery);
      if (rollbackSnapshotOnAbort && leafPhase !== 'settling') {
        const rollbackStoryWeaving = restorePreTurnSnapshot(state, rollbackSnapshotOnAbort);
        await saveSetting('storyWeavingSystem', buildPersistedStoryWeavingSystem(rollbackStoryWeaving));
      }
      if (leafPhase === 'settling') {
        state.activeWorkflow.setTurnStatus(TURN_STATUS_IDLE);
        devLog('recover', 'abort-keep-settlement', { turn: turnCountAtStart });
      } else {
        state.activeWorkflow.setTurnStatus({ kind: 'stopped', text: '已停止生成，本回合尚未落地，可重试或撤销。' });
        devLog('recover', 'abort-keep-awaiting-landing', { turn: turnCountAtStart });
      }
      keepTurnStatus = true;
    } else {
      devLogError('turn', 'executeSendWorkflow.catch', err);
      keepTurnStatus = true;
      const detail = err instanceof Error ? err.message : '主流程调用失败。';
      const settlementFailure = isVariableSettlementError(err);
      const alreadyReportedByApiLayer = Boolean(
        err && typeof err === 'object' && (err as { alreadyReportedByApiLayer?: boolean }).alreadyReportedByApiLayer,
      );
      if (!alreadyReportedByApiLayer) {
        void appendApiErrorReport({
          source: settlementFailure ? '变量结算工作流' : '主剧情工作流',
          config,
          requestMode: state.deviceSettings.gameSettings.enableStreaming ? 'stream' : 'non-stream',
          error: err,
        });
      }
      const failCount = state.deviceSettings.gameSettings.autoRetryOnError ? Math.max(1, state.deviceSettings.gameSettings.autoRetryCount) : 1;
      state.activeWorkflow.setTurnStatus(settlementFailure
        ? { kind: 'failed', text: '变量结算失败，可继续结算。', failCount: 1 }
        : { kind: 'failed', text: `主流程失败：${detail}`, failCount });
      if (!settlementFailure) {
        pushQueueTask(state, 'main_story', 'failed', {
          detail,
          failCount,
        });
      }
    }
  } finally {
    visibilityPublisher?.dispose();
    streamMessageSetter.cancel();
    if (isCurrentWorkflow()) {
      resetWorkflowProjection(state, { keepTurnStatus });
      if (!pendingVariableStarted) {
        pushQueueTask(state, 'memory', 'idle', { detail: '主剧情未完成，本轮后台任务未启动。' });
        pushQueueTask(state, 'variable', 'idle', { detail: '主剧情未完成，本轮后台任务未启动。' });
        pushQueueTask(state, 'news', 'idle', { detail: '主剧情未完成，本轮后台任务未启动。' });
        pushQueueTask(state, 'autosave', 'idle', { detail: '主剧情未完成，本轮后台任务未启动。' });
      }
      state.activeWorkflow.abortControllerRef.current = null;
      deps.onAfterSend?.();
      devLog('turn', 'workflow-end', {
        role: 'main',
        turn: turnCountAtStart,
        keepTurnStatus,
        pendingVariableStarted,
      });
    }
  }
}
