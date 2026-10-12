import type { 聊天消息, 叙事插图 } from '@/models/chat';
import type { 队列任务ID, 队列任务记录 } from '@/models/queueTask';

export type 回合动作ID = 'regenerate_snapshot' | 'reparse_variables';

export interface 回合动作策略 {
  readonly id: 回合动作ID;
  readonly taskIds: readonly 队列任务ID[];
  readonly retryable: boolean;
  readonly requiresIdle: boolean;
}

export const 回合动作策略表: Record<回合动作ID, 回合动作策略> = {
  regenerate_snapshot: {
    id: 'regenerate_snapshot',
    taskIds: ['narrative_image_parse', 'narrative_image_generate'],
    retryable: true,
    requiresIdle: true,
  },
  reparse_variables: {
    id: 'reparse_variables',
    taskIds: ['variable_reparse'],
    retryable: false,
    requiresIdle: true,
  },
};

const 可重试队列任务ID: ReadonlySet<队列任务ID> = new Set(
  Object.values(回合动作策略表)
    .filter((策略) => 策略.retryable)
    .flatMap((策略) => 策略.taskIds)
    .concat(['variable', 'news']),
);

export function 队列任务可重试(id: 队列任务ID): boolean {
  return 可重试队列任务ID.has(id);
}

export interface 回合动作视图 {
  visible: boolean;
  enabled: boolean;
  running: boolean;
  detail?: string;
  /** LLM 的原始回复；解析失败时用户需要看到模型到底回了什么。 */
  rawText?: string;
  /**
   * 当前阶段，供界面区分是在等 LLM 写提示词还是在逐张出图。
   *
   * 两者等待时间差一个数量级（LLM 几十秒、出图每张几十秒），
   * 只显示「正在生成」用户无法判断是不是卡住了。
   */
  阶段?: '等提示词' | '出图中';
}

export interface 回合动作上下文 {
  queueTasks: readonly 队列任务记录[];
  busy: boolean;
  正文生图手动模式: boolean;
  变量更新启用: boolean;
}

const 空视图: Partial<Record<回合动作ID, 回合动作视图>> = Object.freeze({});

export function 派生回合动作视图(
  message: 聊天消息,
  context: 回合动作上下文,
): Partial<Record<回合动作ID, 回合动作视图>> {
  if (message.role !== 'assistant') return 空视图;
  const views: Partial<Record<回合动作ID, 回合动作视图>> = {};

  const images: 叙事插图[] = message.narrativeImages ?? [];
  if (images.length > 0 || context.正文生图手动模式) {
    const 最新任务 = 查询最新动作任务(
      context.queueTasks,
      回合动作策略表.regenerate_snapshot.taskIds,
      message.id,
    );
    const running = 最新任务?.status === 'pending'
      || images.some((image) => image.status === 'generating');
    views.regenerate_snapshot = {
      visible: true,
      enabled: !running,
      running,
      ...(最新任务?.status === 'failed' && 最新任务.detail ? { detail: 最新任务.detail } : {}),
      ...(最新任务?.rawText ? { rawText: 最新任务.rawText } : {}),
      // 有图片正在生成说明 LLM 那一步已经过了；否则就是在等提示词。
      ...(running ? { 阶段: images.some((image) => image.status === 'generating') ? '出图中' as const : '等提示词' as const } : {}),
    };
  }

  const 有正文 = Boolean(message.parsedResponse?.body.trim() || message.content.trim());
  if (有正文) {
    const 最新任务 = 查询最新动作任务(
      context.queueTasks,
      回合动作策略表.reparse_variables.taskIds,
      message.id,
    );
    const running = 最新任务?.status === 'pending';
    views.reparse_variables = {
      visible: true,
      enabled: context.变量更新启用 && !running,
      running,
      ...(!context.变量更新启用
        ? { detail: '变量更新未启用。' }
        : 最新任务?.status === 'failed' && 最新任务.detail
          ? { detail: 最新任务.detail }
          : {}),
    };
  }

  return Object.keys(views).length > 0 ? views : 空视图;
}

export function 查询最新动作任务(
  queueTasks: readonly 队列任务记录[],
  taskIds: readonly 队列任务ID[],
  messageId: string,
): 队列任务记录 | undefined {
  for (let index = queueTasks.length - 1; index >= 0; index -= 1) {
    const task = queueTasks[index];
    if (!taskIds.includes(task.id)) continue;
    if (task.targetMessageId !== messageId) continue;
    return task;
  }
  return undefined;
}

export interface TurnActionsApi {
  视图状态: (message: 聊天消息, context: 回合动作上下文) => Partial<Record<回合动作ID, 回合动作视图>>;
  执行: (message: 聊天消息, id: 回合动作ID, context: 回合动作上下文) => Promise<回合动作执行结局>;
}

export type 回合动作执行结局 =
  | { kind: 'ran' }
  | { kind: 'refused'; taskId: 队列任务ID; detail: string };

export const 回合动作忙时文案: Record<回合动作ID, string> = {
  regenerate_snapshot: '当前有任务进行中，请等待完成后再重新生成。',
  reparse_variables: '当前有任务进行中，请等待完成后再重新解析。',
};

export function 评估回合动作执行(
  message: 聊天消息,
  id: 回合动作ID,
  context: 回合动作上下文,
): 回合动作执行结局 {
  const 策略 = 回合动作策略表[id];
  const 忙时 = (策略.requiresIdle && context.busy)
    || 查询最新动作任务(context.queueTasks, 策略.taskIds, message.id)?.status === 'pending';
  if (忙时) return { kind: 'refused', taskId: 策略.taskIds[0], detail: 回合动作忙时文案[id] };
  return { kind: 'ran' };
}
