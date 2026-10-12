import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { 队列任务ID, 队列任务记录, 队列任务状态 } from '@/models/queueTask';

export interface 队列任务补丁 {
  title?: string;
  subtitle?: string;
  detail?: string;
  rawText?: string;
  turn?: number;
  targetMessageId?: string;
  targetBatchId?: string;
  retryHint?: string;
  failCount?: number;
  retrying?: boolean;
  cancellable?: boolean;
  cancelled?: boolean;
  /** 正文生图的阶段，界面据此显示「等提示词」还是「逐张出图」。 */
  阶段?: '等提示词' | '出图中';
}

export const QUEUE_TASK_TITLES: Record<队列任务ID, string> = {
  main_story: '主剧情生成',
  memory: '记忆整理',
  variable: '变量生成',
  variable_reparse: '变量重解析',
  news: '星际和平周报',
  world_evolution: '世界演变',
  yiting: '忆庭召回',
  zhiku: '智库检索',
  phone: '手机来信',
  autosave: '自动存档',
  narrative_image_parse: '故事快照解析',
  narrative_image_generate: '故事快照生成',
};

const QUEUE_TASK_SUBTITLES: Record<队列任务ID, string> = {
  main_story: '主 API 输出正文与行动选项',
  memory: '即时记忆写入与自动压缩',
  variable: '解析正文并落地变量命令',
  variable_reparse: '重解析历史回合并预览修复计划',
  news: '独立 API 推演新闻与后台事件',
  world_evolution: '结算到期事件与动态世界线索并物化事实',
  narrative_image_parse: '从正文提取故事快照提示词',
  narrative_image_generate: '调用生图 API 生成故事快照',
  yiting: '后续接入回忆检索队列',
  zhiku: '独立 API 检索原著资料',
  phone: '主动来信种子与通讯入口',
  autosave: '写入最近自动存档',
};

export function pushQueueTask(
  state: UseGameStateReturn,
  id: 队列任务ID,
  status: 队列任务状态,
  patch?: 队列任务补丁,
  turn?: number,
  queueTasksMirror?: UseGameStateReturn['queueTasks'],
) {
  const task: UseGameStateReturn['queueTasks'][number] = {
    id,
    title: patch?.title ?? QUEUE_TASK_TITLES[id],
    subtitle: patch?.subtitle ?? QUEUE_TASK_SUBTITLES[id],
    turn: turn ?? patch?.turn ?? state.turnCount,
    timestamp: Date.now(),
    status,
    detail: patch?.detail,
    rawText: patch?.rawText,
    targetMessageId: patch?.targetMessageId,
    targetBatchId: patch?.targetBatchId,
    retryHint: patch?.retryHint,
    failCount: patch?.failCount,
    retrying: patch?.retrying,
    cancellable: patch?.cancellable,
    cancelled: patch?.cancelled,
    阶段: patch?.阶段,
  };
  state.setQueueTasks((prev) => [...prev.slice(-24), task]);
  if (queueTasksMirror) {
    queueTasksMirror.splice(0, Math.max(0, queueTasksMirror.length - 24));
    queueTasksMirror.push(task);
  }
}

/**
 * 幂等：只把最新状态仍为 pending 的任务追加 cancelled，避免取消后队列残留「永远处理中」的孤儿条目。
 */
export function cancelPendingQueueTasks(state: UseGameStateReturn): void {
  state.setQueueTasks((prev) => {
    const latest = new Map<队列任务ID, 队列任务记录>();
    for (const task of prev) latest.set(task.id, task);
    const cancelled: 队列任务记录[] = [];
    for (const [id, task] of latest) {
      if (task.status !== 'pending') continue;
      cancelled.push({
        id,
        title: QUEUE_TASK_TITLES[id],
        subtitle: task.subtitle,
        turn: task.turn,
        timestamp: Date.now(),
        status: 'cancelled',
        detail: '玩家已取消本次任务。',
        targetMessageId: task.targetMessageId,
        targetBatchId: task.targetBatchId,
        cancelled: true,
      });
    }
    return cancelled.length > 0 ? [...prev, ...cancelled] : prev;
  });
}
