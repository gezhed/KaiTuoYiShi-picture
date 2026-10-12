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
  /**
   * 正文生图的阶段：先让 LLM 写提示词，再逐张出图。
   *
   * 两者等待时间差一个数量级（LLM 几十秒、每张图几十秒），只显示「正在生成」
   * 用户无法判断是不是卡住了。由生图链路在推任务时写明，界面（回合动作视图）
   * 直接读它，而不是去猜图片状态或匹配 detail 文本。
   */
  阶段?: '等提示词' | '出图中';
}
