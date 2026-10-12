// 新增动作/任务时：不要扩大该字段语义，任务策略声明在 hooks/useGame/turnActionRuntime；读取统一经该模块的账本适配器，不要再写第二套「读 queueTasks」逻辑。

export type 队列任务ID = 'main_story' | 'memory' | 'variable' | 'variable_reparse' | 'news' | 'world_evolution' | 'yiting' | 'zhiku' | 'phone' | 'autosave' | 'narrative_image_parse' | 'narrative_image_generate';
export type 队列任务状态 = 'pending' | 'success' | 'failed' | 'idle' | 'skipped' | 'cancelled';

export interface 队列任务记录 {
  id: 队列任务ID;
  title: string;
  subtitle?: string;
  turn: number;
  timestamp: number;
  status: 队列任务状态;
  detail?: string;
  rawText?: string;
  targetMessageId?: string;
  targetBatchId?: string;
  retryHint?: string;
  failCount?: number;
  retrying?: boolean;
  cancellable?: boolean;
  cancelled?: boolean;
}
