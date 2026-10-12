import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import type {
  变量修复草稿,
  变量修复草稿项,
  变量修复草稿状态,
} from '@/models/variableRepairBatch';
import {
  完成扫描状态,
  推进草稿项,
  构建变量修复草稿,
  草稿是否过期,
} from '@/models/variableRepairBatch';
import type { 变量修复计划, 变量修复回执 } from '@/models/variableRepair';
import { 提交变量修复计划 } from '@/hooks/useGame/variableRepairWorkflow';
import { 列出可修复回合 } from '@/services/variableHistoryRepair';
import { 重新解析变量计划 } from '@/services/variableRepair';
import {
  清除变量修复草稿,
  保存变量修复草稿,
  读取变量修复草稿,
} from '@/services/storage/variableRepairDraft';
import { snapshotVariableState } from '@/utils/variableExecutor';
import { variableStateFingerprint } from '@/utils/variableFingerprint';
import { findPreviousUserInput } from '@/utils/chatHistory';
import { pushQueueTask as 推入队列账本 } from '@/hooks/useGame/workflowTaskRuntime';
import { isWorkflowAbortError } from '@/hooks/useGame/workflowTransaction';
import { resolveApiConfig } from '@/services/apiConfig';

const 扫描上限 = 40;

interface 中心状态 {
  草稿: 变量修复草稿 | null;
  草稿Epoch: number;
  扫描中: boolean;
  提交中: boolean;
  诊断: string | null;
}

const 空中心状态: 中心状态 = { 草稿: null, 草稿Epoch: -1, 扫描中: false, 提交中: false, 诊断: null };

export interface 变量修复中心动作 {
  草稿: 变量修复草稿 | null;
  扫描中: boolean;
  提交中: boolean;
  诊断: string | null;
  开始扫描: () => void;
  暂停: () => void;
  继续: () => void;
  取消: () => void;
  提交选择: (selection: Record<string, string[]>) => Promise<void>;
  清除: () => void;
}

export interface VariableRepairCenterParams {
  getState: () => UseGameStateReturn;
  sessionEpoch: number;
  pushQueueTask: typeof 推入队列账本;
}

interface 扫描中止持有 {
  controller: AbortController;
  mode: 'pause' | 'cancel';
}

function 代已作废(代Ref: { current: number }, 代: number): boolean {
  return 代Ref.current !== 代;
}

function 会话草稿(状态: 中心状态, epoch: number): 变量修复草稿 | null {
  return 状态.草稿Epoch === epoch ? 状态.草稿 : null;
}

function 选择值(selection: Record<string, string[]>, id: string): string[] {
  const ids = selection[id];
  return Array.isArray(ids) ? ids : [];
}

export function useVariableRepairCenter(params: VariableRepairCenterParams): 变量修复中心动作 {
  const { getState, pushQueueTask, sessionEpoch } = params;
  const [状态, set状态] = useState<中心状态>(空中心状态);
  const 状态Ref = useRef(状态);
  const 中止Ref = useRef<扫描中止持有 | null>(null);
  const 已挂载Ref = useRef(false);
  const 扫描代Ref = useRef(0);

  const 合并状态 = useCallback((patch: Partial<中心状态>) => {
    const next = { ...状态Ref.current, ...patch };
    状态Ref.current = next;
    set状态(next);
  }, []);

  useEffect(() => {
    if (!已挂载Ref.current) {
      已挂载Ref.current = true;
      void (async () => {
        const { draft, issues } = await 读取变量修复草稿();
        if (!draft) {
          if (issues.length > 0) 合并状态({ 诊断: `本地草稿已损坏并被丢弃：${issues[0]}` });
          return;
        }
        const 指纹 = await variableStateFingerprint(snapshotVariableState(getState()));
        if (草稿是否过期(draft, 指纹)) {
          await 清除变量修复草稿().catch(() => undefined);
          合并状态({ 诊断: '上次扫描草稿基于旧的变量状态，已自动清除。请重新扫描。' });
          return;
        }
        if (issues.length > 0) {
          合并状态({ 诊断: `本地草稿部分损坏，已丢弃坏项：${issues[0]}` });
          await 保存变量修复草稿(draft).catch(() => undefined);
        }
        合并状态({ 草稿: draft, 草稿Epoch: sessionEpoch });
      })();
    }
  });

  const 恢复EpochRef = useRef(sessionEpoch);
  useEffect(() => {
    if (已挂载Ref.current && 恢复EpochRef.current !== sessionEpoch) {
      恢复EpochRef.current = sessionEpoch;
      扫描代Ref.current += 1;
      中止Ref.current?.controller.abort();
      中止Ref.current = null;
      合并状态({ 草稿: null, 诊断: null, 扫描中: false, 提交中: false });
      void 清除变量修复草稿().catch(() => undefined);
    }
  }, [sessionEpoch, 合并状态]);

  const 报告队列 = useCallback((detail: string, turn: number | undefined) => {
    pushQueueTask(getState(), 'variable_reparse', 'pending', { detail, turn });
  }, [getState, pushQueueTask]);

  const 收场 = useCallback(async (target: 变量修复草稿, holder: 扫描中止持有) => {
    中止Ref.current = null;
    const state: 变量修复草稿状态 = holder.mode === 'pause' ? 'paused' : 'cancelled';
    const next: 变量修复草稿 = { ...target, state, updatedAt: Date.now() };
    合并状态({ 草稿: next, 扫描中: false });
    await 保存变量修复草稿(next).catch(() => undefined);
    报告队列(state === 'paused' ? '变量修复扫描已暂停。' : '变量修复扫描已取消。', next.项[0]?.turn);
  }, [合并状态, 报告队列]);

  const 逐项扫描 = useCallback(async (controller: AbortController, holder: 扫描中止持有, 代: number) => {
    const base = 会话草稿(状态Ref.current, sessionEpoch);
    if (!base) return;
    let 工作稿 = base;
    // 设备设置在整轮扫描内不变，配置只解析一次；判空仍留在循环内，保持逐项失败的既有反馈。
    const variableConfig = resolveApiConfig(getState().deviceSettings.apiSettings, getState().deviceSettings.gameSettings, 'variable');
    for (const item of base.项) {
      if (controller.signal.aborted || 代已作废(扫描代Ref, 代)) break;
      if (item.status !== 'pending' && item.status !== 'scanning') continue;
      工作稿 = 推进草稿项(工作稿, item.targetMessageId, { status: 'scanning' });
      合并状态({ 草稿: 工作稿 });
      try {
        const s = getState();
        const message = s.chatHistory.find((entry) => entry.id === item.targetMessageId);
        if (!message) throw new Error('历史消息已不存在。');
        if (!variableConfig) throw new Error('请先在设置中配置至少一个 API 接口，再重新解析变量。');
        const plan = await 重新解析变量计划({
          message,
          turn: item.turn,
          stateSnapshot: snapshotVariableState(s),
          baseStateFingerprint: base.指纹,
          batches: s.variableBatches,
          mainApiConfig: variableConfig,
          userInput: findPreviousUserInput(s.chatHistory, item.targetMessageId),
          nsfwEnabled: s.deviceSettings.gameSettings.enableNsfw,
          maleNsfwArchiveEnabled: s.deviceSettings.gameSettings.enableMaleNsfwArchive,
          retryCount: s.deviceSettings.gameSettings.variableApi.retryCount ?? 2,
          promptModules: s.deviceSettings.gameSettings.promptModules,
          signal: controller.signal,
        });
        if (代已作废(扫描代Ref, 代)) return;
        工作稿 = 推进草稿项(工作稿, item.targetMessageId, { status: 'ready', 计划: plan });
      } catch (error) {
        if (isWorkflowAbortError(error) || holder.controller.signal.aborted) break;
        工作稿 = 推进草稿项(工作稿, item.targetMessageId, {
          status: 'failed',
          错误: error instanceof Error ? error.message : '未知错误。',
        });
      }
      if (代已作废(扫描代Ref, 代)) return;
      合并状态({ 草稿: 工作稿 });
      await 保存变量修复草稿(工作稿).catch(() => undefined);
    }
    if (代已作废(扫描代Ref, 代)) return;
    if (controller.signal.aborted) {
      await 收场(工作稿, holder);
      return;
    }
    const settled: 变量修复草稿 = { ...工作稿, state: 完成扫描状态(工作稿), updatedAt: Date.now() };
    中止Ref.current = null;
    合并状态({ 草稿: settled, 扫描中: false });
    await 保存变量修复草稿(settled).catch(() => undefined);
    const failed = settled.项.filter((item) => item.status === 'failed').length;
    报告队列(
      failed === 0
        ? `变量修复扫描完成：${settled.项.length} 个回合。`
        : `变量修复扫描完成，${failed} 个回合失败。`,
      settled.项[0]?.turn,
    );
  }, [getState, 报告队列, 收场, 合并状态, sessionEpoch]);

  const 开始扫描 = useCallback(() => {
    if (状态Ref.current.扫描中 || 状态Ref.current.提交中) return;
    扫描代Ref.current += 1;
    const 代 = 扫描代Ref.current;
    合并状态({ 草稿: null, 草稿Epoch: sessionEpoch });
    const targets = 列出可修复回合(getState().chatHistory, 扫描上限);
    if (targets.length === 0) {
      合并状态({ 诊断: '没有可修复的历史助手回合。' });
      return;
    }
    void (async () => {
      const 指纹 = await variableStateFingerprint(snapshotVariableState(getState()));
      if (代已作废(扫描代Ref, 代)) return;
      const draft = 构建变量修复草稿(targets, 指纹);
      合并状态({ 草稿: draft, 草稿Epoch: sessionEpoch });
      await 保存变量修复草稿(draft).catch(() => undefined);
      const controller = new AbortController();
      const holder: 扫描中止持有 = { controller, mode: 'pause' };
      中止Ref.current = holder;
      合并状态({ 扫描中: true, 诊断: null });
      报告队列(`正在扫描 ${targets.length} 个历史回合的变量。`, draft.项[0]?.turn);
      await 逐项扫描(controller, holder, 代);
    })();
  }, [getState, 报告队列, 逐项扫描, 合并状态, sessionEpoch]);

  const 继续 = useCallback(() => {
    if (状态Ref.current.扫描中 || 状态Ref.current.提交中) return;
    const draft = 会话草稿(状态Ref.current, sessionEpoch);
    if (!draft) return;
    if (!draft.项.some((item) => item.status === 'pending' || item.status === 'scanning')) {
      合并状态({ 诊断: '没有待扫描的回合。' });
      return;
    }
    扫描代Ref.current += 1;
    const 代 = 扫描代Ref.current;
    const resumed: 变量修复草稿 = { ...draft, state: 'scanning', updatedAt: Date.now() };
    const controller = new AbortController();
    const holder: 扫描中止持有 = { controller, mode: 'pause' };
    中止Ref.current = holder;
    合并状态({ 草稿: resumed, 草稿Epoch: sessionEpoch, 扫描中: true, 诊断: null });
    void 逐项扫描(controller, holder, 代);
  }, [逐项扫描, 合并状态, sessionEpoch]);

  const 暂停 = useCallback(() => {
    const holder = 中止Ref.current;
    if (!holder) return;
    holder.mode = 'pause';
    holder.controller.abort();
  }, []);

  const 取消 = useCallback(() => {
    const holder = 中止Ref.current;
    if (!holder) return;
    holder.mode = 'cancel';
    holder.controller.abort();
  }, []);

  const 清除 = useCallback(() => {
    扫描代Ref.current += 1;
    中止Ref.current?.controller.abort();
    中止Ref.current = null;
    合并状态({ 草稿: null, 诊断: null, 扫描中: false, 提交中: false });
    void 清除变量修复草稿().catch(() => undefined);
  }, [合并状态]);

  const 提交选择 = useCallback(async (selection: Record<string, string[]>) => {
    const draft = 会话草稿(状态Ref.current, sessionEpoch);
    if (!draft || 状态Ref.current.提交中 || 状态Ref.current.扫描中) return;
    const targets = draft.项.filter(
      (item): item is 变量修复草稿项 & { 计划: 变量修复计划 } =>
        item.status === 'ready' && item.计划 !== undefined && 选择值(selection, item.targetMessageId).length > 0,
    );
    if (targets.length === 0) return;
    合并状态({ 提交中: true });
    const failures: string[] = [];
    try {
      for (const item of targets) {
        const receipt: 变量修复回执 = await 提交变量修复计划({
          state: getState(),
          plan: item.计划,
          confirmedItemIds: 选择值(selection, item.targetMessageId),
        });
        if (receipt.code === 'OK') continue;
        if (receipt.code === 'BUSY') {
          合并状态({ 诊断: '当前有任务进行中，提交已暂停。请等待完成后重试。' });
          return;
        }
        failures.push(`第 ${item.turn} 回合：${receipt.detail}`);
      }
    } finally {
      合并状态({ 提交中: false });
    }
    if (failures.length > 0) {
      合并状态({ 诊断: failures.join('；') });
      return;
    }
    const completed: 变量修复草稿 = { ...draft, state: 'completed', updatedAt: Date.now() };
    合并状态({ 草稿: completed });
    void 清除变量修复草稿().catch(() => undefined);
  }, [getState, 合并状态, sessionEpoch]);

  return {
    草稿: 状态.草稿Epoch === sessionEpoch ? 状态.草稿 : null,
    扫描中: 状态.草稿Epoch === sessionEpoch && 状态.扫描中,
    提交中: 状态.草稿Epoch === sessionEpoch && 状态.提交中,
    诊断: 状态.诊断,
    开始扫描,
    暂停,
    继续,
    取消,
    提交选择,
    清除,
  };
}
