import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGameState, type UseGameStateReturn } from '@/hooks/useGameState';
import { executeSendWorkflow } from '@/hooks/useGame/sendWorkflow';
import { executeResumeWorkflow } from '@/hooks/useGame/resumeWorkflow';
import { 初始化新局checkpoint } from '@/hooks/useGame/commitTurn';
import { retryQueueTask } from '@/hooks/useGame/workflowRetry';
import { cancelActiveWorkflow } from '@/hooks/useGame/workflowTransaction';
import { buildContextSnapshot, type ContextSnapshotKind } from '@/hooks/useGame/contextSnapshot';
import { addImmediateMemory, autoCompressMemorySystemWithArchivesAsync, compressNpcMemoryLedger } from '@/hooks/useGame/memoryUtils';
import { ignoreMemoryDraft, retryMemoryDraft } from '@/hooks/useGame/memoryRecovery';
import { analyzeTavernRegexScript, dryRunTavernRegexScript, extractTavernRegexScripts } from '@/hooks/useGame/tavernRegexProcessor';
import type { TavernRegexDryRunResult, TavernRegexScriptSafety } from '@/contracts/ai';
import { beginSession, clearActiveSaveTreeMetaIfMatches, delete存档目标, handleBranchFromSave, handleLoadById, handleLoadLatest, hydrate, prepareHydration, resetWorkflowProjection, resolve存档删除目标, type 存档删除目标 } from '@/hooks/useGame/saveLoadWorkflow';
import type { API设置, API配置项, 存档数据 } from '@/models/settings';
import type { 存档树元信息 } from '@/utils/saveTree';
import type { 队列任务ID, 队列任务记录 } from '@/models/queueTask';
import type { 开局整理档案 } from '@/models/world';
import { 提取NPC同行记忆文本列表, type NPC同行记忆条目 } from '@/models/npc';
import type { STRegexScript } from '@/models/stTypes';
import { deleteLegacyBackupSaves, deleteSaveTree, forkSaveTreeLeaf, loadActiveLeaf, loadSaveTree } from '@/services/storage/saveTree';
import { getSaveCatalogSnapshot, loadSave, loadSaveForCloudTransfer, loadSaveIdByNodeId, saveGame } from '@/services/storage/saveCrud';
import { exportSavePackage, exportSaveTreePackage, importSaveFileAsMany } from '@/services/storage/importExport';
import { repairSaveDatabase, startSaveCatalogRepair } from '@/services/storage/catalogMaintenance';
import { loadSetting, saveSetting } from '@/services/storage/settings';
import { 剥离检查点队列任务 } from '@/services/storage/saveSummary';
import { subscribeSaveCatalogRepair } from '@/services/storage/saveCatalogRepair';
import type { SaveCatalogRepairResult, SaveCatalogRepairScope, SaveCatalogRepairState, SaveCatalogSnapshot, SaveListItemSummary } from '@/contracts/storage';
import type { CloudTransferSaveBundle } from '@/contracts/cloudSave';
import { abandonTurnRecovery } from '@/hooks/useGame/recoveryActions';
import { buildPersistedStoryWeavingSystem } from '@/data/storyWeavingPreset';
import { ZHIKU_CHARACTER_REBUILD_MIGRATION_KEY, buildPersistedZhikuSystem, loadAllBundledZhikuPresets, mergeBundledZhikuSystem } from '@/data/zhikuPreset';
import { parseOpeningArchiveWithAI } from '@/services/ai/openingArchive';
import type { OpeningPlayerPreset, OpeningPresetDraft } from '@/models/opening';
import { OPENING_PLAYER_PRESETS_KEY, normalizeOpeningPresets } from '@/models/opening';
import { setStreamingMessage } from '@/utils/streamingMessageStore';
import { devLog, devLogError } from '@/utils/devLog';
import { TURN_STATUS_IDLE } from '@/hooks/useGame/turnStatus';
import {
  派生回合动作视图,
  评估回合动作执行,
  type TurnActionsApi,
  type 回合动作ID,
  type 回合动作上下文,
  type 回合动作执行结局,
} from '@/hooks/useGame/turnActionRuntime';
import type { 聊天消息 } from '@/models/chat';
import { pushQueueTask } from '@/hooks/useGame/workflowTaskRuntime';
import { 提交变量修复计划 } from '@/hooks/useGame/variableRepairWorkflow';
import { useVariableRepairCenter, type 变量修复中心动作 } from '@/hooks/useGame/variableRepairCenter';
import { isWorkflowAbortError } from '@/hooks/useGame/workflowTransaction';
import { 重新解析变量计划 } from '@/services/variableRepair';
import { snapshotVariableState } from '@/utils/variableExecutor';
import { variableStateFingerprint } from '@/utils/variableFingerprint';
import { findPreviousUserInput } from '@/utils/chatHistory';
import { 发送远程输入, 是主机端 } from '@/services/localSave/liveSync';
import type { 变量修复计划, 变量修复回执 } from '@/models/variableRepair';
import { buildPhoneApiConfig, generatePhoneReply } from '@/services/ai/phoneService';
import { generateSkillDraft } from '@/services/ai/skillGenerator';
import { generateTravelerTemplate } from '@/services/ai/travelerTemplate';
import { resolveApiConfig, resolveMainApiConfig } from '@/services/apiConfig';
import { parseActionOptionsBlock } from '@/services/ai/responseParser';
import { 生成消息插图, 重生成消息单张插图, 保存插图结果, 标记插图为生成中, 标记插图失败 } from '@/hooks/useGame/illustrationWorkflow';
import { 合并重跑提示词 } from '@/services/ai/imageGen/illustrationPipeline';
import type { 战技生成草稿, 战技生成上下文, TravelerTemplateContext, TravelerTemplateDraft } from '@/contracts/ai';
import type { 手机回复上下文, PhoneMemoryCommitInput } from '@/contracts/phone';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import { 归一化智库系统, type 智库系统 } from '@/models/zhiku';
import { createInitialWorkspace, type 新局工作区字段集 } from '@/services/newGameInitialization';
import { OPENING_INPUT, deriveOpeningDraftContext, isOpeningLanded, shouldStartOpening } from '@/models/opening';

export interface UseGameReturn {
  state: UseGameStateReturn;
  actions: {
    handleSend: (text: string) => Promise<void>;
    handleStartOpening: () => Promise<void>;
    handleAbort: () => void;
    handleCancelTask: (id: 队列任务ID) => void;
    handleResumeRecovery: () => Promise<boolean>;
    handleAbandonRecovery: () => Promise<void>;
    handleRetryRecovery: () => Promise<void>;
    handleUndoRecovery: () => Promise<string | null>;
    handleNewGame: () => void;
    handleContinue: () => Promise<boolean>;
    handleLoadSave: (id: number) => Promise<boolean>;
    handleBranch: (id: number) => Promise<boolean>;
    handleGoHome: () => void;
    handleReroll: () => Promise<string | undefined>;
    turnActions: TurnActionsApi;
    变量修复: {
      计划: 变量修复计划 | null;
      回执: 变量修复回执 | null;
      提交中: boolean;
      提交: (confirmedItemIds: string[]) => Promise<void>;
      关闭: () => void;
    };
    变量修复中心: 变量修复中心动作;
    handleRetryQueueTask: (task: 队列任务记录, mode?: 'retry' | 'reroll') => Promise<void>;
    handleRestartOpening: () => Promise<void>;
    getContextSnapshot: (kind?: ContextSnapshotKind) => ReturnType<typeof buildContextSnapshot>;
    handlePhoneMemoryCommit: (input: PhoneMemoryCommitInput) => Promise<void>;
    handleRetryMemoryDraft: (draftId: string) => Promise<void>;
    handleIgnoreMemoryDraft: (draftId: string) => Promise<void>;
    handleGeneratePhoneReply: (apiConfig: API设置, context: 手机回复上下文) => Promise<string>;
    handleDeleteSave: (save: SaveListItemSummary) => Promise<boolean>;
    handleDeleteSaveTree: (rootId: string) => Promise<void>;
    handleClearActiveSaveTreeMeta: (target?: { rootId?: string; nodeId?: string } | null) => void;
    handleGetSaveCatalogSnapshot: () => Promise<SaveCatalogSnapshot>;
    handleStartSaveCatalogRepair: (scope?: SaveCatalogRepairScope) => Promise<SaveCatalogRepairResult>;
    handleSubscribeSaveCatalogRepair: (listener: (state: SaveCatalogRepairState) => void) => () => void;
    handleRepairSaveDatabase: () => Promise<void>;
    handleDeleteLegacyBackupSaves: () => Promise<number>;
    handleGetSaveForExport: (id: number) => Promise<存档数据 | null>;
    handleGetSaveTreeForExport: (rootId: string) => Promise<存档数据[]>;
    handlePersistImportedSave: (data: 存档数据) => Promise<number>;
    handleExportSavePackage: (id: number) => Promise<void>;
    handleExportActiveLeafPackage: () => Promise<number | null>;
    handleExportSaveTreePackage: (rootId: string) => Promise<void>;
    handleImportSaveFileAsMany: (file: File) => Promise<number>;
    handleLoadSaveForCloudTransfer: (id: number) => Promise<CloudTransferSaveBundle | null>;
    handleExtractTavernRegexScripts: (rawPreset: unknown) => STRegexScript[];
    handleAnalyzeTavernRegexScript: (script: STRegexScript) => TavernRegexScriptSafety;
    handleDryRunTavernRegexScript: (script: STRegexScript, sampleText: string) => TavernRegexDryRunResult;
    handleLoadOpeningPresets: () => Promise<OpeningPlayerPreset[]>;
    handleSaveOpeningPresets: (presets: OpeningPlayerPreset[]) => Promise<OpeningPlayerPreset[]>;
    handleParseOpeningArchive: (draft: OpeningPresetDraft) => Promise<开局整理档案 | null>;
    handlePrepareNewGame: (draft: OpeningPresetDraft) => Promise<boolean>;
    handleSaveStoryWeaving: (system: 剧情编织系统) => Promise<void>;
    handleGenerateSkillDraft: (apiConfig: API配置项, context: 战技生成上下文) => Promise<战技生成草稿>;
    handleGenerateTravelerTemplate: (context: TravelerTemplateContext) => Promise<TravelerTemplateDraft>;
    handleParseActionOptionsBlock: (text: string) => string[];
    handleSaveZhikuSystem: (system: 智库系统) => Promise<void>;
    handleZhikuMigration: (current: 智库系统) => Promise<智库系统>;
    handleGenerateIllustrations: (
      messageId: string,
      options?: { 只重新生成提示词?: boolean; signal?: AbortSignal },
    ) => Promise<import('@/services/ai/imageGen/illustrationPipeline').生成正文插图结果>;
    handleRegenerateIllustration: (
      messageId: string,
      插图: import('@/models/chat').叙事插图,
      options?: { 新提示词正文?: string; 覆盖尺寸?: { 宽度: number; 高度: number } | null; signal?: AbortSignal },
    ) => Promise<import('@/models/chat').叙事插图>;
    handleRerollIllustrationPrompts: (
      messageId: string,
      options?: { signal?: AbortSignal },
    ) => Promise<import('@/models/chat').叙事插图[]>;
  };
  canRerollWithTree: boolean;
  rerollParentStatus: 'pending' | 'valid' | 'invalid';
}

function 投影新局工作区(s: UseGameStateReturn, workspace: 新局工作区字段集): void {
  s.set旅人(workspace.旅人);
  s.set世界(workspace.世界);
  s.setChatHistory(workspace.chatHistory);
  s.set记忆(workspace.记忆);
  s.set忆庭(workspace.忆庭);
  s.set智库(workspace.智库);
  s.set手机(workspace.手机);
  s.setNPC(workspace.NPC);
  s.set相册(workspace.相册);
  s.set新闻(workspace.新闻);
  s.set剧情(workspace.剧情);
  s.set剧情编织(workspace.剧情编织);
  s.setVariableBatches(workspace.variableBatches);
  s.setQueueTasks(workspace.queueTasks);
  s.setTurnCount(workspace.turnCount);
  s.setTurnPhase(workspace.turnPhase ?? null);
  s.activeWorkflow.setRecovery(workspace.recoveryContext ?? null);
}

export function useGame(): UseGameReturn {
  const state = useGameState();
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const getActiveConfig = useCallback((): API配置项 | null => {
    const s = stateRef.current;
    const config = resolveApiConfig(s.deviceSettings.apiSettings, s.deviceSettings.gameSettings, 'main');
    if (config && !s.deviceSettings.apiSettings.activeConfigId) {
      s.setDeviceApiSettings((prev) => ({ ...prev, activeConfigId: config.id }));
    }
    return config;
  }, []);

  const sendWithCleanReroll = useCallback(async (
    text: string,
    rerollContext: { nonce: string; previousResponse: string } | null,
  ) => {
    await executeSendWorkflow(text, {
      state: stateRef.current,
      getActiveConfig,
      onAfterSend: () => {
        stateRef.current.activeWorkflow.rerollContextRef.current = null;
      },
      rerollContext,
    });
  }, [getActiveConfig]);

  const handleSend = useCallback(
    async (text: string) => {
      // 非主机（手机遥控端）：任何发送（包括开局派发、动作选项等内部路径）都不本地生成，
      // 一律转给主机去跑——从源头断开“双份生成”。
      if (!是主机端()) {
        await 发送远程输入(text);
        return;
      }
      const s = stateRef.current;
      // 不先放弃旧恢复现场的话，未落地回合的用户消息会与新回合叠加。
      if (s.activeWorkflow.recovery || s.turnPhase) {
        const abandoned = await abandonTurnRecovery(s);
        if (!abandoned.ok) {
          s.activeWorkflow.setTurnStatus({ kind: 'failed', text: '旧回合现场清理失败，未发送新消息，请重试。', failCount: 1 });
          return;
        }
      }
      await sendWithCleanReroll(text, stateRef.current.activeWorkflow.rerollContextRef.current);
    },
    [sendWithCleanReroll],
  );

  const handleStartOpening = useCallback(async () => {
    const s = stateRef.current;
    if (!shouldStartOpening({
      turnPhase: s.turnPhase,
      openingLanded: isOpeningLanded(s.turnCount, s.chatHistory),
      hasRecovery: Boolean(s.activeWorkflow.recovery),
    })) return;
    // 在途守卫：StrictMode 双跑 effect 会第二次派发，且开局不抢占其他工作流。
    if (s.activeWorkflow.abortControllerRef.current) return;
    s.setTurnPhase(null);
    await sendWithCleanReroll(OPENING_INPUT, null);
  }, [sendWithCleanReroll]);

  const handleAbort = useCallback(() => {
    cancelActiveWorkflow(stateRef.current);
  }, []);

  const handleCancelTask = useCallback((id: 队列任务ID) => {
    cancelActiveWorkflow(stateRef.current, { taskId: id });
  }, []);

  const handleResumeRecovery = useCallback(async (): Promise<boolean> => {
    const s = stateRef.current;
    if (s.activeWorkflow.loading || s.activeWorkflow.pendingVariable) return false;
    s.activeWorkflow.abortControllerRef.current?.abort();
    return executeResumeWorkflow({
      state: s,
      getState: () => stateRef.current,
      getActiveConfig,
      onAfterSend: () => {
        stateRef.current.activeWorkflow.rerollContextRef.current = null;
      },
      rerollContext: null,
    });
  }, [getActiveConfig]);

  const handleAbandonRecovery = useCallback(async (): Promise<void> => {
    const s = stateRef.current;
    await abandonTurnRecovery(s);
    s.activeWorkflow.setTurnStatus(TURN_STATUS_IDLE);
  }, []);

  const handleRetryRecovery = useCallback(async (): Promise<void> => {
    const s = stateRef.current;
    if (s.turnPhase !== 'awaitingLanding' || !s.activeWorkflow.recovery) return;
    if (!getActiveConfig()) {
      alert('请先在设置中配置至少一个 API 接口。');
      return;
    }
    const abandoned = await abandonTurnRecovery(s);
    if (!abandoned.ok || !abandoned.text) {
      s.activeWorkflow.setTurnStatus({ kind: 'failed', text: '重试前清理旧回合现场失败，请刷新后重试。', failCount: 1 });
      return;
    }
    await sendWithCleanReroll(abandoned.text, null);
  }, [getActiveConfig, sendWithCleanReroll]);

  const handleUndoRecovery = useCallback(async (): Promise<string | null> => {
    const s = stateRef.current;
    if (s.turnPhase !== 'awaitingLanding' || !s.activeWorkflow.recovery) return null;
    const abandoned = await abandonTurnRecovery(s);
    if (!abandoned.ok) {
      s.activeWorkflow.setTurnStatus({ kind: 'failed', text: '撤销失败，请重试。', failCount: 1 });
      return null;
    }
    return abandoned.text;
  }, []);

  const handleNewGame = useCallback(() => {
    const s = stateRef.current;
    void abandonTurnRecovery(s);
    s.setView('new_game');
  }, []);

  const handleContinue = useCallback(async (): Promise<boolean> => {
    return handleLoadLatest(stateRef.current);
  }, []);

  const handleLoadSave = useCallback(async (id: number): Promise<boolean> => {
    const ok = await handleLoadById(id, stateRef.current);
    devLog('save', 'save-load-by-id', { id, ok });
    return ok;
  }, []);

  const handleBranch = useCallback(async (id: number): Promise<boolean> => {
    return handleBranchFromSave(id, stateRef.current);
  }, []);

  const handleGoHome = useCallback(() => {
    const s = stateRef.current;
    cancelActiveWorkflow(s);
    s.setView('home');
  }, []);

  // 不能直接 fork 直接父检查点：commitTurn 每回合末尾已封版当前叶子，父检查点含本轮输入与副作用，
  // 必须上溯到第一个「不含本轮输入」的检查点。
  const handleReroll = useCallback(async (): Promise<string | undefined> => {
    const s = stateRef.current;
    if (s.activeWorkflow.loading || s.activeWorkflow.pendingVariable) {
      s.activeWorkflow.setTurnStatus({ kind: 'stopped', text: '后台结算尚未完成，稍等完成后再重roll，避免记忆/忆庭/变量写入错位。' });
      return;
    }
    s.activeWorkflow.abortControllerRef.current?.abort();
    s.activeWorkflow.abortControllerRef.current = null;
    const history = s.chatHistory;

    let lastUserIdx = -1;
    let lastAiIdx = -1;
    const lastMsg = history.at(-1);
    if (lastMsg && lastMsg.role === 'user') {
      lastUserIdx = history.length - 1;
    } else {
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'assistant') {
          lastAiIdx = i;
          break;
        }
      }
      if (lastAiIdx === -1) return;
      for (let i = lastAiIdx - 1; i >= 0; i--) {
        if (history[i].role === 'user') {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx === -1) return;
    }
    const userInput = history[lastUserIdx].content;
    const rerolledUserMsgId = history[lastUserIdx].id;

    const active = await loadActiveLeaf();
    const leaf = active.status === 'ok' ? active.leaf : null;
    const tree = (leaf as { saveTree?: 存档树元信息 | null } | null)?.saveTree;
    if (!leaf || !tree?.rootId || !tree.parentNodeId) {
      s.activeWorkflow.setTurnStatus({ kind: 'stopped', text: '当前工作区缺少可回退的父检查点，无法重roll。' });
      return;
    }

    let forkTargetNodeId: string | null = tree.parentNodeId;
    const disableReroll = (text: string) => {
      s.activeWorkflow.setTurnStatus({ kind: 'stopped', text });
      s.setActiveTreeMeta((prev) => {
        if (!prev || prev.rootId !== tree.rootId || prev.nodeId !== tree.nodeId) return prev;
        const { parentNodeId: _removedParentNodeId, ...rest } = prev;
        void _removedParentNodeId;
        return rest;
      });
    };
    try {
      for (let guard = 0; guard < 32; guard++) {
        const parentSaveId = await loadSaveIdByNodeId(forkTargetNodeId);
        const parentSave = parentSaveId ? await loadSave(parentSaveId) : null;
        const parentTree = (parentSave as { saveTree?: 存档树元信息 | null } | null)?.saveTree;
        if (!parentSave || !parentTree) {
          devLogError('turn', 'reroll-parent-missing', new Error(`父检查点缺失：${forkTargetNodeId}`), { rootId: tree.rootId });
          disableReroll('父检查点缺失，无法重roll。');
          return;
        }
        if (parentTree.rootId !== tree.rootId) {
          devLogError('turn', 'reroll-root-mismatch', new Error(`父检查点 rootId 与当前工作区不一致：${parentTree.rootId}`), {
            rootId: tree.rootId,
            parentRootId: parentTree.rootId,
            forkTargetNodeId,
          });
          disableReroll('父检查点不属于当前存档树，无法重roll。');
          return;
        }
        const containsRerolledUser = Array.isArray(parentSave.chatHistory)
          && parentSave.chatHistory.some((msg) => msg.id === rerolledUserMsgId);
        if (!containsRerolledUser) break;
        if (!parentTree.parentNodeId) break;
        forkTargetNodeId = parentTree.parentNodeId;
      }

      if (!forkTargetNodeId) {
        devLogError('turn', 'reroll-fork-target-missing', new Error('未找到可回退的父检查点。'));
        s.activeWorkflow.setTurnStatus({ kind: 'stopped', text: '未找到可回退的父检查点，无法重roll。' });
        return;
      }

      const fork = await forkSaveTreeLeaf({
        rootId: tree.rootId,
        targetNodeId: forkTargetNodeId,
        branchName: '重roll分支',
      });
      devLog('turn', 'reroll-forked-leaf', {
        rootId: tree.rootId,
        fromCheckpoint: forkTargetNodeId,
        abandonedLeaf: tree.nodeId,
        headNodeId: fork.headNodeId,
      });
      if (!fork.headNodeId) {
        devLogError('turn', 'reroll-fork-head-missing', new Error('分叉返回空 headNodeId。'));
        s.activeWorkflow.setTurnStatus({ kind: 'stopped', text: '分叉叶子创建失败，重roll失败，请重试。' });
        return;
      }

      const newLeafSaveId = await loadSaveIdByNodeId(fork.headNodeId);
      const newLeaf = newLeafSaveId ? await loadSave(newLeafSaveId) : null;
      if (!newLeaf) {
        devLogError('turn', 'reroll-hydrate-leaf-missing', new Error(`分叉叶子数据缺失：${fork.headNodeId}`));
        s.activeWorkflow.setTurnStatus({ kind: 'stopped', text: '分叉叶子数据缺失，重roll失败，请重试。' });
        return;
      }
      resetWorkflowProjection(s);
      hydrate(await prepareHydration(newLeaf), s);

      if (lastAiIdx >= 0) {
        const previousResponse = history[lastAiIdx].parsedResponse?.body || history[lastAiIdx].content || '';
        s.activeWorkflow.rerollContextRef.current = {
          nonce: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          previousResponse,
        };
      } else {
        s.activeWorkflow.rerollContextRef.current = null;
      }

      setStreamingMessage('');
      s.activeWorkflow.setTurnStatus({
        kind: 'stopped',
        text: lastAiIdx >= 0
          ? '已回滚到上一回合发送前，可修改后重新发送。'
          : '已回滚到本回合发送前，可修改后重新发送。',
      });
      return userInput;
    } catch (err) {
      devLogError('turn', 'reroll-failed', err, { rootId: tree.rootId, targetCheckpoint: forkTargetNodeId });
      s.activeWorkflow.setTurnStatus({ kind: 'stopped', text: `重roll失败：${err instanceof Error ? err.message : '未知错误'}，请重试。` });
      return;
    }
  }, []);

  const { activeTreeMeta, rerollParentStatus } = state;
  const canRerollWithTree = Boolean(activeTreeMeta?.rootId && activeTreeMeta.parentNodeId)
    && rerollParentStatus === 'valid';

  const [变量修复计划, set变量修复计划] = useState<变量修复计划 | null>(null);
  const [变量修复回执, set变量修复回执] = useState<变量修复回执 | null>(null);
  const [变量修复提交中, set变量修复提交中] = useState(false);
  const 变量修复AbortRef = useRef<AbortController | null>(null);

  const handle重新解析变量 = useCallback(async (message: 聊天消息) => {
    const s = stateRef.current;
    const mainConfig = getActiveConfig();
    const turn = Number(message.gameTime) || s.turnCount;
    const 报告 = (status: 'pending' | 'success' | 'failed' | 'cancelled', detail: string) => pushQueueTask(
      s, 'variable_reparse', status, { detail, turn, targetMessageId: message.id },
    );
    if (!mainConfig) {
      报告('failed', '请先在设置中配置至少一个 API 接口，再重新解析变量。');
      return;
    }
    const controller = new AbortController();
    变量修复AbortRef.current?.abort();
    变量修复AbortRef.current = controller;
    const 上一条输入 = findPreviousUserInput(s.chatHistory, message.id);
    报告('pending', '正在重新解析历史回合的变量。');
    try {
      const variableConfig = resolveApiConfig(s.deviceSettings.apiSettings, s.deviceSettings.gameSettings, 'variable');
      if (!variableConfig) {
        报告('failed', '请先在设置中配置至少一个 API 接口，再重新解析变量。');
        return;
      }
      const stateSnapshot = snapshotVariableState(s);
      const plan = await 重新解析变量计划({
        message,
        turn,
        stateSnapshot,
        baseStateFingerprint: await variableStateFingerprint(stateSnapshot),
        batches: s.variableBatches,
        mainApiConfig: variableConfig,
        userInput: 上一条输入,
        nsfwEnabled: s.deviceSettings.gameSettings.enableNsfw,
        maleNsfwArchiveEnabled: s.deviceSettings.gameSettings.enableMaleNsfwArchive,
        retryCount: s.deviceSettings.gameSettings.variableApi.retryCount ?? 2,
        promptModules: s.deviceSettings.gameSettings.promptModules,
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      set变量修复计划(plan);
      set变量修复回执(null);
      报告('success', `重新解析完成：共 ${plan.items.length} 条修复项。`);
    } catch (error) {
      if (isWorkflowAbortError(error) || controller.signal.aborted) {
        报告('cancelled', '已取消变量重新解析。');
        return;
      }
      devLogError('net', '变量重新解析失败', error, { turn, targetMessageId: message.id });
      报告('failed', `变量重新解析失败：${(error as Error).message}`);
    } finally {
      if (变量修复AbortRef.current === controller) 变量修复AbortRef.current = null;
    }
  }, [getActiveConfig]);

  const handle提交变量修复 = useCallback(async (confirmedItemIds: string[]) => {
    if (!变量修复计划) return;
    set变量修复提交中(true);
    try {
      const receipt = await 提交变量修复计划({
        state: stateRef.current,
        plan: 变量修复计划,
        confirmedItemIds,
      });
      if (receipt.code === 'OK') {
        set变量修复计划(null);
        set变量修复回执(null);
        return;
      }
      set变量修复回执(receipt);
    } finally {
      set变量修复提交中(false);
    }
  }, [变量修复计划]);

  const 变量修复中心 = useVariableRepairCenter({
    getState: () => stateRef.current,
    sessionEpoch: state.activeWorkflow.sessionEpoch,
    pushQueueTask,
  });

  const handle关闭变量修复 = useCallback(() => {
    变量修复AbortRef.current?.abort();
    变量修复AbortRef.current = null;
    set变量修复计划(null);
    set变量修复回执(null);
  }, []);

  const turnActionExecute = useCallback(
    async (
      message: 聊天消息,
      id: 回合动作ID,
      context: 回合动作上下文,
    ): Promise<回合动作执行结局> => {
      const outcome = 评估回合动作执行(message, id, context);
      if (outcome.kind === 'refused') {
        const s = stateRef.current;
        pushQueueTask(s, outcome.taskId, 'failed', {
          detail: outcome.detail,
          turn: Number(message.gameTime) || s.turnCount,
          targetMessageId: message.id,
        });
        return outcome;
      }
      if (id === 'regenerate_snapshot') {
        const 目标消息 = stateRef.current.chatHistory.find((项) => 项.id === message.id);
        const 回合 = Number(message.gameTime) || stateRef.current.turnCount;
        // 先落一条 pending 任务：没有它，从点击到出图之间界面上**完全没有反馈**，
        // 用户看到的就是「点了没反应」（实际反馈过两次）。它同时驱动卡片的「正在生成…」。
        pushQueueTask(stateRef.current, 'narrative_image_parse', 'pending', {
          detail: '正在请求 LLM 生成插图提示词…',
          turn: 回合,
          targetMessageId: message.id,
        });
        // 必须自己接住异常：调用方是 `void 执行(...)`（即发即忘），抛出去没人接。
        try {
          const 结果 = await 生成消息插图(
            stateRef.current,
            message.id,
            目标消息?.parsedResponse?.body.trim() || 目标消息?.content.trim() || message.content,
            undefined,
            {
              // 出图阶段单独报一条：只留一条「正在请求 LLM…」的话，出图那几十秒里
              // 界面看不出还在干活，用户会以为卡住了。
              // 只报第一次（完成数 0），后续每张不再刷屏，终局另有 success/failed。
              on进度: (事件) => {
                if (事件.阶段 !== '出图' || (事件.完成数 ?? 0) > 0) return;
                pushQueueTask(stateRef.current, 'narrative_image_generate', 'pending', {
                  detail: `正在逐张出图（共 ${事件.总数 ?? 0} 张）…`,
                  turn: 回合,
                  targetMessageId: message.id,
                  阶段: '出图中',
                });
              },
            },
          );
          // 把 LLM 的**原文**一并留下：解析失败时用户需要看到模型到底回了什么，
          // 否则只能靠猜「是没返回，还是返回了但格式不对」。
          const 原文 = 结果.原始回复 ?? '';
          if (结果.插图.length === 0) {
            pushQueueTask(stateRef.current, 'narrative_image_parse', 'failed', {
              detail: 结果.提示词诊断 ?? 'LLM 没有产出任何插图提示词。',
              rawText: 原文,
              turn: 回合,
              targetMessageId: message.id,
            });
          } else {
            // 必须把插图**写回消息**：渲染层只看 `message.narrativeImages`，
            // 不写回去的话图已经生成、相册里也有，正文里却什么都看不到
            //（这正是「生成成功了但根本没插入进正文」的实际反馈）。
            const 下一份历史 = stateRef.current.chatHistory.map((项) => (
              项.id === message.id ? { ...项, narrativeImages: 结果.插图 } : 项
            ));
            stateRef.current.setChatHistory(下一份历史);
            stateRef.current.set相册(结果.相册);
            // 手动生图在回合之外，没有 commitTurn 兜底，必须自己落盘，
            // 否则重新进入后图和相册都会消失。返回值是回读校验结果，
            // 直接写进队列文案，用户就能当场看到「到底存下来没有」。
            const 落盘 = await 保存插图结果(stateRef.current, 下一份历史, 结果.相册, 结果.新增条目);
            pushQueueTask(stateRef.current, 'narrative_image_parse', 'success', {
              detail: `LLM 返回 ${结果.插图.length} 条插图提示词，成功 ${结果.成功数} 张。`
                + `落盘：${落盘.回读确认数}/${落盘.资产数} 张${落盘.成功 ? '（已确认）' : `（未确认：${落盘.原因 ?? '未知'}）`}`,
              rawText: 原文,
              turn: 回合,
              targetMessageId: message.id,
            });
          }
        } catch (错误) {
          const 原因 = 错误 instanceof Error ? 错误.message : String(错误);
          pushQueueTask(stateRef.current, 'narrative_image_parse', 'failed', {
            detail: 原因,
            turn: 回合,
            targetMessageId: message.id,
          });
          devLog('turn', 'narrative-image-manual-failed', { 消息Id: message.id, 原因 });
        }
      } else {
        await handle重新解析变量(message);
      }
      return { kind: 'ran' };
    },
    [getActiveConfig, handle重新解析变量],
  );
  const turnActions = useMemo<TurnActionsApi>(
    () => ({ 视图状态: 派生回合动作视图, 执行: turnActionExecute }),
    [turnActionExecute],
  );

  const handleRetryQueueTask = useCallback(async (task: 队列任务记录, mode: 'retry' | 'reroll' = 'retry') => {
    await retryQueueTask(stateRef.current, getActiveConfig, task, mode);
  }, [getActiveConfig]);

  const handleRestartOpening = useCallback(async () => {
    const s = stateRef.current;
    devLog('save', 'new-game-initialize-start', { entry: 'restart' });
    beginSession(s);
    const { workspace } = createInitialWorkspace({ mode: 'restart', current: s });
    投影新局工作区(s, workspace);
    void saveSetting('storyWeavingSystem', buildPersistedStoryWeavingSystem(workspace.剧情编织));
    await 初始化新局checkpoint(workspace, s);
    s.activeWorkflow.setSessionEpoch((e) => e + 1);
  }, []);

  const getContextSnapshot = useCallback((kind?: ContextSnapshotKind) => {
    return buildContextSnapshot(stateRef.current, kind);
  }, []);

  const handlePhoneMemoryCommit = useCallback(async (input: PhoneMemoryCommitInput): Promise<void> => {
    const s = stateRef.current;
    const trimmed = input.summary.trim();
    if (!trimmed) return;
    const normalizedSummary = trimmed.startsWith('【手机】') ? trimmed : `【手机】${trimmed}`;
    const alreadyInMemory = s.记忆.即时记忆.some((item) => item.includes(trimmed))
      || s.记忆.短期记忆.some((item) => item.includes(trimmed))
      || s.记忆.中期记忆.some((item) => item.includes(trimmed))
      || s.记忆.长期记忆.some((item) => item.includes(trimmed));
    if (!input.force && alreadyInMemory) return;
    devLog('ui', 'phone-memory-commit-start', { npcId: input.npcId ?? null, force: Boolean(input.force) });
    const memoryApiConfig = resolveApiConfig(s.deviceSettings.apiSettings, s.deviceSettings.gameSettings, 'memoryCompression');
    const withImmediate = addImmediateMemory(s.记忆, normalizedSummary, s.turnCount);
    const compression = await autoCompressMemorySystemWithArchivesAsync(
      withImmediate,
      s.turnCount,
      s.deviceSettings.gameSettings.记忆系统,
      memoryApiConfig,
    );
    s.set记忆(compression.memory);
    if (compression.failedDraft) {
      devLog('ui', 'phone-memory-compress-failed', {
        draftId: compression.failedDraft.id,
        kind: compression.failedDraft.kind,
      });
    }
    if (compression.archives.length) {
      s.set忆庭((prevYiting) => ({
        ...prevYiting,
        回忆档案: [...prevYiting.回忆档案, ...compression.archives],
      }));
    }
    if (input.npcId) {
      s.setNPC((prev) =>
        prev.map((npc) => {
          if (npc.id !== input.npcId) return npc;
          if (!input.force && 提取NPC同行记忆文本列表(npc).some((item) => item.includes(trimmed))) return npc;
          const nextEntry: NPC同行记忆条目 = {
            id: `npc_mem_phone_${s.turnCount}_${Math.random().toString(36).slice(2, 6)}`,
            回合: s.turnCount,
            摘要: trimmed,
            来源: '手机',
            关联NPCID: [npc.id],
          };
          const ledgerCompression = compressNpcMemoryLedger({
            npcId: npc.id,
            entries: [...(npc.同行记忆 ?? []), nextEntry],
            summaries: npc.总结记忆 ?? [],
            threshold: s.deviceSettings.gameSettings.记忆系统.NPC记忆压缩阈值,
            prompt: s.deviceSettings.gameSettings.记忆系统.NPC记忆压缩提示词,
            turn: s.turnCount,
            source: '手机',
          });
          return {
            ...npc,
            同行记忆: ledgerCompression.memories,
            总结记忆: ledgerCompression.summaries,
            最近互动: trimmed,
            共同经历: [...new Set([...(npc.共同经历 ?? []), trimmed])].slice(-8),
            对玩家长期印象: npc.对玩家长期印象 || '与玩家保持手机联系，已形成可承接的私下互动。',
            最近回合: s.turnCount,
          };
        }),
      );
    }
    devLog('ui', 'phone-memory-commit-done', { npcId: input.npcId ?? null, archives: compression.archives.length });
  }, []);

  const handleRetryMemoryDraft = useCallback(async (draftId: string): Promise<void> => {
    await retryMemoryDraft(stateRef.current, draftId);
  }, []);

  const handleIgnoreMemoryDraft = useCallback(async (draftId: string): Promise<void> => {
    await ignoreMemoryDraft(stateRef.current, draftId);
  }, []);

  const handleGeneratePhoneReply = useCallback(async (
    apiConfig: API设置,
    context: 手机回复上下文,
  ): Promise<string> => {
    const s = stateRef.current;
    try {
      const config = buildPhoneApiConfig(s.deviceSettings.gameSettings, apiConfig);
      if (!config) return '';
      devLog('net', 'phone-reply-generate-start', { chatId: context.chat.id, type: context.chat.type });
      const reply = await generatePhoneReply(
        config,
        context,
        config.retryCount ?? 2,
        s.deviceSettings.gameSettings.promptModules,
      );
      devLog('net', 'phone-reply-generate-done', { chatId: context.chat.id, messages: reply.messages.length });
      return reply.messages.join('\n');
    } catch (err) {
      devLogError('net', 'phone-reply-generate-failed', err, { chatId: context.chat.id });
      return '';
    }
  }, []);

  const handleDeleteSave = useCallback(async (save: SaveListItemSummary): Promise<boolean> => {
    let deleteTarget: 存档删除目标;
    try {
      deleteTarget = await resolve存档删除目标(save);
    } catch (err) {
      devLogError('save', 'save-delete-plan-failed', err, { id: save.id });
      throw err;
    }
    const confirmMessage = deleteTarget.cascadeCount !== null && deleteTarget.cascadeCount > 1
      ? `确定删除这个存档及其子节点？将级联删除 ${deleteTarget.cascadeCount} 个存档，此操作不可恢复。`
      : '确定删除这个存档？此操作不可恢复。';
    if (!confirm(confirmMessage)) return false;
    devLog('save', 'save-delete-cascade', { id: save.id, cascadeCount: deleteTarget.cascadeCount });
    await delete存档目标(save.id, deleteTarget, stateRef.current);
    return true;
  }, []);

  const handleDeleteSaveTree = useCallback(async (rootId: string): Promise<void> => {
    await deleteSaveTree(rootId);
    clearActiveSaveTreeMetaIfMatches({ rootId }, stateRef.current);
    devLog('save', 'save-delete-tree', { rootId });
  }, []);

  const handleClearActiveSaveTreeMeta = useCallback((target?: { rootId?: string; nodeId?: string } | null): void => {
    clearActiveSaveTreeMetaIfMatches(target ?? null, stateRef.current);
  }, []);

  const handleGetSaveCatalogSnapshot = useCallback(async (): Promise<SaveCatalogSnapshot> => {
    return getSaveCatalogSnapshot();
  }, []);

  const handleStartSaveCatalogRepair = useCallback(async (scope: SaveCatalogRepairScope = 'missing-only'): Promise<SaveCatalogRepairResult> => {
    return startSaveCatalogRepair(scope);
  }, []);

  const handleSubscribeSaveCatalogRepair = useCallback(
    (listener: (state: SaveCatalogRepairState) => void): (() => void) => {
      return subscribeSaveCatalogRepair(listener);
    },
    [],
  );

  const handleRepairSaveDatabase = useCallback(async (): Promise<void> => {
    await repairSaveDatabase();
  }, []);

  const handleDeleteLegacyBackupSaves = useCallback(async (): Promise<number> => {
    const deleted = await deleteLegacyBackupSaves();
    devLog('save', 'legacy-backups-deleted', { deleted });
    return deleted;
  }, []);

  const handleGetSaveForExport = useCallback(async (id: number): Promise<存档数据 | null> => {
    return loadSave(id);
  }, []);

  const handleGetSaveTreeForExport = useCallback(async (rootId: string): Promise<存档数据[]> => {
    return loadSaveTree(rootId);
  }, []);

  const handlePersistImportedSave = useCallback(async (data: 存档数据): Promise<number> => {
    return saveGame(剥离检查点队列任务(data));
  }, []);

  const handleExportSavePackage = useCallback(async (id: number): Promise<void> => {
    const save = await handleGetSaveForExport(id);
    if (save) await exportSavePackage(save);
  }, [handleGetSaveForExport]);

  const handleExportActiveLeafPackage = useCallback(async (): Promise<number | null> => {
    const active = await loadActiveLeaf();
    const leaf = active.status === 'ok' ? active.leaf : null;
    if (!leaf) return null;
    await exportSavePackage(leaf);
    return leaf.id;
  }, []);

  const handleExportSaveTreePackage = useCallback(async (rootId: string): Promise<void> => {
    const treeSaves = await handleGetSaveTreeForExport(rootId);
    if (treeSaves.length) await exportSaveTreePackage(treeSaves);
  }, [handleGetSaveTreeForExport]);

  const handleImportSaveFileAsMany = useCallback(async (file: File): Promise<number> => {
    const imported = await importSaveFileAsMany(file);
    const now = Date.now();
    for (const [index, data] of imported.entries()) {
      await handlePersistImportedSave({ ...data, id: 0, type: 'imported', timestamp: now + index });
    }
    devLog('save', 'import-save-persisted', { imported: imported.length });
    return imported.length;
  }, [handlePersistImportedSave]);

  const handleLoadSaveForCloudTransfer = useCallback(async (id: number): Promise<CloudTransferSaveBundle | null> => {
    return loadSaveForCloudTransfer(id);
  }, []);

  const handleExtractTavernRegexScripts = useCallback((rawPreset: unknown): STRegexScript[] => {
    return extractTavernRegexScripts(rawPreset);
  }, []);

  const handleAnalyzeTavernRegexScript = useCallback((script: STRegexScript): TavernRegexScriptSafety => {
    return analyzeTavernRegexScript(script);
  }, []);

  const handleDryRunTavernRegexScript = useCallback((script: STRegexScript, sampleText: string): TavernRegexDryRunResult => {
    return dryRunTavernRegexScript(script, sampleText);
  }, []);

  const handleLoadOpeningPresets = useCallback(async (): Promise<OpeningPlayerPreset[]> => {
    const saved = await loadSetting<OpeningPlayerPreset[]>(OPENING_PLAYER_PRESETS_KEY);
    return normalizeOpeningPresets(saved);
  }, []);

  const handleSaveOpeningPresets = useCallback(async (presets: OpeningPlayerPreset[]): Promise<OpeningPlayerPreset[]> => {
    const normalized = normalizeOpeningPresets(presets);
    await saveSetting(OPENING_PLAYER_PRESETS_KEY, normalized);
    return normalized;
  }, []);

  const handleParseOpeningArchive = useCallback(async (draft: OpeningPresetDraft): Promise<开局整理档案 | null> => {
    if (draft.openingSource === 'official_preset') return null;
    const config = getActiveConfig();
    if (!config) return null;
    const { freeOpeningInput } = deriveOpeningDraftContext(draft);
    devLog('net', 'opening-archive-parse-start', { source: draft.openingSource });
    const parsed = await parseOpeningArchiveWithAI(
      config,
      {
        regionName: freeOpeningInput.regionName,
        chapterName: freeOpeningInput.chapterName,
        chapterSummary: freeOpeningInput.chapterSummary,
        playerText: freeOpeningInput.playerText,
        defaultLocationHint: freeOpeningInput.defaultLocationHint,
        defaultDateHint: freeOpeningInput.defaultDateHint,
        defaultTimeHint: freeOpeningInput.defaultTimeHint,
        priorStoryState: freeOpeningInput.priorStoryState,
        planetSource: freeOpeningInput.planetSource,
        mainlineEnabled: freeOpeningInput.mainlineEnabled,
        keyNpcs: freeOpeningInput.keyNpcs,
        sourceLabel: draft.openingSource === 'workshop' ? '创意工坊开局' : '自由开局',
      },
      config.retryCount ?? 2,
    );
    devLog('net', 'opening-archive-parse-done', { source: draft.openingSource });
    return parsed;
  }, [getActiveConfig]);

  const handlePrepareNewGame = useCallback(async (draft: OpeningPresetDraft): Promise<boolean> => {
    const s = stateRef.current;
    if (!resolveMainApiConfig(s.deviceSettings.apiSettings)) {
      alert('请先在设置中配置至少一个 API 接口，再开始旅途。');
      return false;
    }
    devLog('save', 'new-game-initialize-start', { entry: 'start' });
    const bundledStoryWeaving = s.presetLoad.story.status === 'ready' ? s.presetLoad.story.value : null;
    const { workspace } = createInitialWorkspace({ mode: 'fresh', draft, current: s, bundledStoryWeaving });
    投影新局工作区(s, workspace);
    try {
      await saveSetting('storyWeavingSystem', buildPersistedStoryWeavingSystem(workspace.剧情编织));
    } catch (err) {
      devLogError('save', 'story-weaving-new-game-fallback', err, { entry: 'start' });
    }
    await 初始化新局checkpoint(workspace, s);
    devLog('save', 'new-game-initialize-done', { entry: 'start' });
    return true;
  }, []);

  const handleSaveStoryWeaving = useCallback(async (system: 剧情编织系统): Promise<void> => {
    await saveSetting('storyWeavingSystem', buildPersistedStoryWeavingSystem(system));
    devLog('save', 'story-weaving-saved', { seriesCount: system.系列列表.length });
  }, []);

  const handleSaveZhikuSystem = useCallback(async (system: 智库系统): Promise<void> => {
    const normalized = 归一化智库系统(system);
    const total = normalized.条目.length;
    const builtin = normalized.条目.filter((entry) => entry.builtin).length;
    const custom = total - builtin;
    try {
      await saveSetting('zhikuSystem', buildPersistedZhikuSystem(normalized));
      devLog('save', 'zhiku-system-saved', { total, builtin, custom });
    } catch (err) {
      devLogError('save', 'zhiku-system-save-failed', err, { total, builtin, custom });
      throw err;
    }
  }, []);

  // 迁移标记在加载成功之后才写：加载失败不留半状态。
  const handleZhikuMigration = useCallback(async (current: 智库系统): Promise<智库系统> => {
    devLog('save', 'zhiku-migration-start', {});
    try {
      const bundled = await loadAllBundledZhikuPresets({ cacheBust: Date.now() });
      const savedMigrationAt = await loadSetting<number>(ZHIKU_CHARACTER_REBUILD_MIGRATION_KEY);
      const migrationAt = savedMigrationAt ?? Date.now();
      const next = mergeBundledZhikuSystem(bundled, 归一化智库系统(current), migrationAt);
      if (!savedMigrationAt) {
        await saveSetting(ZHIKU_CHARACTER_REBUILD_MIGRATION_KEY, migrationAt);
      }
      await saveSetting('zhikuSystem', buildPersistedZhikuSystem(next));
      const total = next.条目.length;
      const builtin = next.条目.filter((entry) => entry.builtin).length;
      devLog('save', 'zhiku-migration-done', { total, builtin, custom: total - builtin, migrationAt });
      return next;
    } catch (err) {
      devLogError('save', 'zhiku-migration-failed', err, {});
      throw err;
    }
  }, []);

  const handleGenerateSkillDraft = useCallback(async (
    apiConfig: API配置项,
    context: 战技生成上下文,
  ): Promise<战技生成草稿> => {
    try {
      devLog('net', 'skill-draft-generate-start', { slotKind: context.slotKind, slotIndex: context.slotIndex });
      const draft = await generateSkillDraft(apiConfig, context);
      devLog('net', 'skill-draft-generate-done', { slotKind: context.slotKind, slotIndex: context.slotIndex });
      return draft;
    } catch (err) {
      devLogError('net', 'skill-draft-generate-failed', err, { slotKind: context.slotKind, slotIndex: context.slotIndex });
      throw err;
    }
  }, []);

  const handleGenerateTravelerTemplate = useCallback(async (
    context: TravelerTemplateContext,
  ): Promise<TravelerTemplateDraft> => {
    const config = getActiveConfig();
    if (!config) throw new Error('请先在设置中配置至少一个 API 接口。');
    try {
      devLog('net', 'traveler-template-generate-start', {});
      const draft = await generateTravelerTemplate(config, context);
      devLog('net', 'traveler-template-generate-done', {});
      return draft;
    } catch (err) {
      devLogError('net', 'traveler-template-generate-failed', err, {});
      throw err;
    }
  }, [getActiveConfig]);

  const handleParseActionOptionsBlock = useCallback((text: string): string[] => {
    return parseActionOptionsBlock(text);
  }, []);

  /** 为一轮正文生成插图（可多张）。`只重新生成提示词` 时只重问 LLM，不重出图。 */
  const handleGenerateIllustrations = useCallback(async (
    messageId: string,
    options?: { 只重新生成提示词?: boolean; signal?: AbortSignal },
  ) => {
    const 消息 = stateRef.current.chatHistory.find((项) => 项.id === messageId);
    const 正文 = 消息?.parsedResponse?.body.trim() || 消息?.content.trim() || '';
    if (!消息 || !正文) throw new Error('未找到可配图的正文。');
    try {
      devLog('net', 'illustrations-generate-start', { messageId, 只重新生成提示词: options?.只重新生成提示词 === true });
      const 结果 = await 生成消息插图(
        stateRef.current,
        messageId,
        正文,
        消息.narrativeImages,
        options,
      );
      devLog('net', 'illustrations-generate-done', { messageId, 成功: 结果.成功数, 失败: 结果.失败数 });
      return 结果;
    } catch (err) {
      devLogError('net', 'illustrations-generate-failed', err, { messageId });
      throw err;
    }
  }, []);

  /** 重出单张插图并写回消息；可带编辑后的提示词与手动尺寸。 */
  const handleRegenerateIllustration = useCallback(async (
    messageId: string,
    插图: import('@/models/chat').叙事插图,
    options?: { 新提示词正文?: string; 覆盖尺寸?: { 宽度: number; 高度: number } | null; signal?: AbortSignal },
  ): Promise<import('@/models/chat').叙事插图> => {
    const 回合 = Number(
      stateRef.current.chatHistory.find((项) => 项.id === messageId)?.gameTime,
    ) || stateRef.current.turnCount;
    /*
     * 点下去立刻给反馈，两件事一起做：
     *   ① 把这张标成 generating —— 卡片换成「正在生成…」占位，那个分支不渲染按钮，
     *      所以不可能重复点（用户反馈过「没有提示、会多次点击」）；
     *   ② 落一条 pending 任务 —— 回合动作视图据此把整轮的按钮也置灰。
     */
    stateRef.current.setChatHistory(标记插图为生成中(stateRef.current.chatHistory, messageId, 插图.id));
    pushQueueTask(stateRef.current, 'narrative_image_generate', 'pending', {
      detail: options?.新提示词正文 !== undefined ? '正在用修改后的提示词重出这一张…' : '正在重新生成这一张…',
      turn: 回合,
      targetMessageId: messageId,
      阶段: '出图中',
    });
    try {
      devLog('net', 'illustration-regenerate-start', { id: 插图.id });
      const 结果 = await 重生成消息单张插图(stateRef.current, 插图, options);
      const 下一份历史 = stateRef.current.chatHistory.map((项) => (
        项.id === messageId
          ? { ...项, narrativeImages: (项.narrativeImages ?? []).map((候选) => (候选.id === 插图.id ? 结果.插图 : 候选)) }
          : 项
      ));
      stateRef.current.set相册(结果.相册);
      stateRef.current.setChatHistory(下一份历史);
      // 单张重生同样发生在回合之外，不落盘的话重新进入就会丢。
      const 落盘 = await 保存插图结果(stateRef.current, 下一份历史, 结果.相册, 结果.新增条目);
      pushQueueTask(
        stateRef.current,
        'narrative_image_generate',
        结果.插图.status === 'failed' ? 'failed' : 'success',
        {
          detail: 结果.插图.status === 'failed'
            ? `重新生成失败：${结果.插图.error ?? '未知原因'}`
            : `已重新生成这一张。落盘：${落盘.回读确认数}/${落盘.资产数} 张${落盘.成功 ? '（已确认）' : `（未确认：${落盘.原因 ?? '未知'}）`}`,
          turn: 回合,
          targetMessageId: messageId,
        },
      );
      devLog('net', 'illustration-regenerate-done', { id: 插图.id, status: 结果.插图.status });
      return 结果.插图;
    } catch (err) {
      // 抛错前把这张还原成失败态：否则它会永远停在「正在生成…」，
      // 连重试按钮都回不来（卡片那个分支没有任何操作入口）。
      const 失败原因 = err instanceof Error ? err.message : String(err);
      stateRef.current.setChatHistory(标记插图失败(stateRef.current.chatHistory, messageId, 插图.id, 失败原因));
      pushQueueTask(stateRef.current, 'narrative_image_generate', 'failed', {
        detail: `重新生成失败：${失败原因}`,
        turn: 回合,
        targetMessageId: messageId,
      });
      devLogError('net', 'illustration-regenerate-failed', err, { id: 插图.id });
      throw err;
    }
  }, []);

  /**
   * 只重跑本回合的插图提示词（保留已出好的图），用于「对提示词不满意重新生成」。
   *
   * 与 `handleGenerateIllustrations` 的区别：这里**不**重新解析正文锚点，
   * 沿用已有插图的锚点与次序，只替换提示词文本，因此不会打乱图与正文的对应关系。
   */
  const handleRerollIllustrationPrompts = useCallback(async (
    messageId: string,
    options?: { signal?: AbortSignal },
  ): Promise<import('@/models/chat').叙事插图[]> => {
    const 消息 = stateRef.current.chatHistory.find((项) => 项.id === messageId);
    const 正文 = 消息?.parsedResponse?.body.trim() || 消息?.content.trim() || '';
    if (!消息 || !正文) throw new Error('未找到可配图的正文。');
    const 已有 = 消息.narrativeImages ?? [];
    if (已有.length === 0) throw new Error('本回合还没有插图，先出图再重跑提示词。');
    // 落一条 pending：少了它，从点击到写回之间界面上**没有任何反馈**，
    // 用户看到的就是「按下去没用」（实际反馈过）。它同时驱动卡片的运行态文案。
    const 回合 = Number(消息.gameTime) || stateRef.current.turnCount;
    pushQueueTask(stateRef.current, 'narrative_image_parse', 'pending', {
      detail: '正在重跑插图提示词（保留已有图片）…',
      turn: 回合,
      targetMessageId: messageId,
    });
    try {
      devLog('net', 'illustration-prompts-reroll-start', { messageId, 图数: 已有.length });
      const 结果 = await 生成消息插图(
        stateRef.current,
        messageId,
        正文,
        已有,
        { 只重新生成提示词: true, signal: options?.signal },
      );
      // 新提示词逐张并回旧插图：只换提示词，保留原图与锚点。
      const 合并后 = 合并重跑提示词(已有, 结果.插图);
      const 下一份历史 = stateRef.current.chatHistory.map((项) => (
        项.id === messageId ? { ...项, narrativeImages: 合并后 } : 项
      ));
      stateRef.current.setChatHistory(下一份历史);
      const 落盘 = await 保存插图结果(stateRef.current, 下一份历史, stateRef.current.相册, 结果.新增条目);
      // 提示词是否真的换了，要能被确认：卡片上不再显示提示词，所以这里报出来。
      const 变化数 = 合并后.filter((项, 序号) => 项.prompt !== 已有[序号]?.prompt).length;
      pushQueueTask(stateRef.current, 'narrative_image_parse', 'success', {
        detail: 变化数 > 0
          ? `已重写 ${变化数}/${合并后.length} 张的提示词（图片保留）。`
            + `落盘：${落盘.回读确认数}/${落盘.资产数} 张`
          : 'LLM 这次给出的提示词与原来相同，没有变化。可再点一次重跑。',
        rawText: 结果.原始回复,
        turn: 回合,
        targetMessageId: messageId,
      });
      devLog('net', 'illustration-prompts-reroll-done', { messageId, 图数: 合并后.length, 变化数 });
      return 合并后;
    } catch (err) {
      pushQueueTask(stateRef.current, 'narrative_image_parse', 'failed', {
        detail: `重跑插图提示词失败：${err instanceof Error ? err.message : String(err)}`,
        turn: 回合,
        targetMessageId: messageId,
      });
      devLogError('net', 'illustration-prompts-reroll-failed', err, { messageId });
      throw err;
    }
  }, []);

  const actions = useMemo(() => ({
    handleSend,
    handleStartOpening,
    handleAbort,
    handleCancelTask,
    handleResumeRecovery,
    handleAbandonRecovery,
    handleRetryRecovery,
    handleUndoRecovery,
    handleNewGame,
    handleContinue,
    handleLoadSave,
    handleBranch,
    handleGoHome,
    handleReroll,
    turnActions,
    变量修复: {
      计划: 变量修复计划,
      回执: 变量修复回执,
      提交中: 变量修复提交中,
      提交: handle提交变量修复,
      关闭: handle关闭变量修复,
    },
    变量修复中心,
    handleRetryQueueTask,
    handleRestartOpening,
    getContextSnapshot,
    handlePhoneMemoryCommit,
    handleRetryMemoryDraft,
    handleIgnoreMemoryDraft,
    handleGeneratePhoneReply,
    handleDeleteSave,
    handleDeleteSaveTree,
    handleClearActiveSaveTreeMeta,
    handleGetSaveCatalogSnapshot,
    handleStartSaveCatalogRepair,
    handleSubscribeSaveCatalogRepair,
    handleRepairSaveDatabase,
    handleDeleteLegacyBackupSaves,
    handleGetSaveForExport,
    handleGetSaveTreeForExport,
    handlePersistImportedSave,
    handleExportSavePackage,
    handleExportActiveLeafPackage,
    handleExportSaveTreePackage,
    handleImportSaveFileAsMany,
    handleLoadSaveForCloudTransfer,
    handleExtractTavernRegexScripts,
    handleAnalyzeTavernRegexScript,
    handleDryRunTavernRegexScript,
    handleLoadOpeningPresets,
    handleSaveOpeningPresets,
    handleParseOpeningArchive,
    handlePrepareNewGame,
    handleSaveStoryWeaving,
    handleGenerateSkillDraft,
    handleGenerateTravelerTemplate,
    handleParseActionOptionsBlock,
    handleSaveZhikuSystem,
    handleZhikuMigration,
    handleGenerateIllustrations,
    handleRegenerateIllustration,
    handleRerollIllustrationPrompts,
  }), [
    handleSend,
    handleStartOpening,
    handleAbort,
    handleCancelTask,
    handleResumeRecovery,
    handleAbandonRecovery,
    handleRetryRecovery,
    handleUndoRecovery,
    handleNewGame,
    handleContinue,
    handleLoadSave,
    handleBranch,
    handleGoHome,
    handleReroll,
    turnActions,
    变量修复计划,
    变量修复回执,
    变量修复提交中,
    handle提交变量修复,
    handle关闭变量修复,
    变量修复中心,
    handleRetryQueueTask,
    handleRestartOpening,
    getContextSnapshot,
    handlePhoneMemoryCommit,
    handleRetryMemoryDraft,
    handleIgnoreMemoryDraft,
    handleGeneratePhoneReply,
    handleDeleteSave,
    handleDeleteSaveTree,
    handleClearActiveSaveTreeMeta,
    handleGetSaveCatalogSnapshot,
    handleStartSaveCatalogRepair,
    handleSubscribeSaveCatalogRepair,
    handleRepairSaveDatabase,
    handleDeleteLegacyBackupSaves,
    handleGetSaveForExport,
    handleGetSaveTreeForExport,
    handlePersistImportedSave,
    handleExportSavePackage,
    handleExportActiveLeafPackage,
    handleExportSaveTreePackage,
    handleImportSaveFileAsMany,
    handleLoadSaveForCloudTransfer,
    handleExtractTavernRegexScripts,
    handleAnalyzeTavernRegexScript,
    handleDryRunTavernRegexScript,
    handleLoadOpeningPresets,
    handleSaveOpeningPresets,
    handleParseOpeningArchive,
    handlePrepareNewGame,
    handleSaveStoryWeaving,
    handleGenerateSkillDraft,
    handleGenerateTravelerTemplate,
    handleParseActionOptionsBlock,
    handleSaveZhikuSystem,
    handleZhikuMigration,
    handleGenerateIllustrations,
    handleRegenerateIllustration,
    handleRerollIllustrationPrompts,
  ]);

  return {
    state,
    actions,
    canRerollWithTree,
    rerollParentStatus,
  };
}
