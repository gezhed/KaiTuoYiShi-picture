import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { 工作区字段集 } from '@/models/newestStory';
import type { 队列任务ID, 队列任务记录, 队列任务状态 } from '@/models/queueTask';
import { loadActiveLeaf, writeLeafNode } from '@/services/storage/saveTree';
import { devLog } from '@/utils/devLog';
import { setStreamingMessage } from '@/utils/streamingMessageStore';
import { ensureHeadLeafWritable, resetWorkflowProjection } from './saveLoadWorkflow';
import { cancelPendingQueueTasks, pushQueueTask, type 队列任务补丁 } from './workflowTaskRuntime';
import type { TurnStatus } from './turnStatus';

/** 保留字段级覆盖语义：undefined 不得覆盖叶子已有值。 */
export function cleanLeafPatch(patch: Partial<工作区字段集>): Partial<工作区字段集> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== 'undefined') cleaned[key] = value;
  }
  return cleaned;
}

export async function writeTurnLeaf(
  ctx: { assertWorkflowActive: () => void },
  headNodeId: string | null,
  patch: Partial<工作区字段集>,
): Promise<void> {
  ctx.assertWorkflowActive();
  if (!headNodeId) throw new Error('写回合叶子失败：活跃叶子指针为空。');
  await writeLeafNode(headNodeId, cleanLeafPatch(patch));
  ctx.assertWorkflowActive();
}

export function isWorkflowAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export interface WorkflowTransaction {
  signal: AbortSignal;
  isCurrent: () => boolean;
  assertActive: () => void;
  pushTask: (id: 队列任务ID, status: 队列任务状态, patch?: 队列任务补丁, turn?: number) => void;
  writeLeaf: (patch: Partial<工作区字段集>) => Promise<void>;
  settle: (finalStatus?: TurnStatus) => void;
}

export async function beginWorkflowTransaction(
  state: UseGameStateReturn,
  opts: { turnStatus: TurnStatus },
): Promise<WorkflowTransaction | null> {
  const aw = state.activeWorkflow;
  if (aw.loading || aw.pendingVariable) return null;
  aw.abortControllerRef.current?.abort();
  const controller = new AbortController();
  aw.abortControllerRef.current = controller;
  aw.setLoading(true);
  aw.setTurnStatus(opts.turnStatus);
  const isCurrent = () => aw.abortControllerRef.current === controller;
  const assertActive = () => {
    if (controller.signal.aborted || !isCurrent()) {
      throw new DOMException('Workflow aborted', 'AbortError');
    }
  };

  let headNodeId: string | null = null;
  let queueTasks: 队列任务记录[] = [];
  try {
    const newest = await ensureHeadLeafWritable(state);
    assertActive();
    const active = await loadActiveLeaf();
    assertActive();
    if (!newest.headNodeId || active.status !== 'ok') {
      throw new Error('独立工作流失败：无法建立可写的活跃叶子工作区。');
    }
    headNodeId = newest.headNodeId;
    queueTasks = [...(active.leaf.queueTasks ?? [])];
  } catch (error) {
    if (isCurrent()) {
      aw.abortControllerRef.current = null;
      resetWorkflowProjection(state);
    }
    throw error;
  }

  return {
    signal: controller.signal,
    isCurrent,
    assertActive,
    pushTask: (id, status, patch, turn) => {
      if (!isCurrent()) return;
      pushQueueTask(state, id, status, patch, turn, queueTasks);
    },
    writeLeaf: async (patch) => {
      assertActive();
      const nodeId = headNodeId;
      if (!nodeId) throw new Error('独立工作流失败：活跃叶子未就绪。');
      await writeLeafNode(nodeId, cleanLeafPatch({ ...patch, queueTasks }));
      devLog('turn', 'workflow-leaf-write', { nodeId, fields: Object.keys(patch) });
    },
    settle: (finalStatus) => {
      if (!isCurrent()) return;
      aw.abortControllerRef.current = null;
      resetWorkflowProjection(state, { keepTurnStatus: Boolean(finalStatus) });
      if (finalStatus) aw.setTurnStatus(finalStatus);
    },
  };
}

export function cancelActiveWorkflow(
  state: UseGameStateReturn,
  opts?: { taskId?: 队列任务ID },
): void {
  const aw = state.activeWorkflow;
  const controller = aw.abortControllerRef.current;
  if (controller) controller.abort();
  cancelPendingQueueTasks(state);
  setStreamingMessage('');
  if (controller) {
    devLog('turn', 'workflow-cancel', { taskId: opts?.taskId ?? null });
    return;
  }
  // 无在途控制器但瞬时态卡死：强制复位，否则 loading/取消按钮成孤儿。
  if (aw.loading || aw.pendingVariable) {
    resetWorkflowProjection(state);
  }
}
