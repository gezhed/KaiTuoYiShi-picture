import type { 存档数据 } from './settings';

export type 工作区字段集 = Pick<
  存档数据,
  | '旅人'
  | '世界'
  | 'chatHistory'
  | '记忆'
  | '忆庭'
  | '智库'
  | '手机'
  | 'NPC'
  | '相册'
  | '新闻'
  | '剧情'
  | '剧情编织'
  | 'variableBatches'
  | 'queueTasks'
  | 'turnCount'
  | 'macroGlobalVars'
  | 'worldbookTriggerStates'
  | 'turnPhase'
  | 'recoveryContext'
>;

export const NEWEST_STORY_STORE_KEY = 'newest';

export interface NewestStory记录 {
  key: typeof NEWEST_STORY_STORE_KEY;
  headNodeId: string | null;
  /** 崩溃窗口（封版后、写指针前）待采纳的子叶 nodeId：commitTurn 建叶前登记，指针移动时清空；恢复侧按此认领，不按保存 ID 猜测。 */
  pendingChildNodeId: string | null;
  updatedAt: number;
}

export function 创建空NewestStory记录(): NewestStory记录 {
  return {
    key: NEWEST_STORY_STORE_KEY,
    headNodeId: null,
    pendingChildNodeId: null,
    updatedAt: Date.now(),
  };
}

/** 指针移动即上一次提交协议结束，同一次写入清空待采纳子叶身份（登记与采纳只存在于一次提交的崩溃窗口内）。 */
export function 指向NewestStory记录(
  record: NewestStory记录,
  headNodeId: string | null,
): NewestStory记录 {
  return {
    ...record,
    headNodeId,
    pendingChildNodeId: null,
    updatedAt: Date.now(),
  };
}

export function 登记待采纳子叶(
  record: NewestStory记录,
  childNodeId: string | null,
): NewestStory记录 {
  return {
    ...record,
    pendingChildNodeId: childNodeId,
    updatedAt: Date.now(),
  };
}

function 是普通对象(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 旧格式键（baseCheckpointId / story / branchName）不读取——由 MIGRATIONS v10 物化后清除，残留旧键在此被忽略（幂等兜底）。 */
export function 归一化NewestStory记录(input?: unknown): NewestStory记录 {
  const raw = 是普通对象(input) ? (input as Record<string, unknown>) : null;
  if (!raw) return 创建空NewestStory记录();
  const headNodeId = raw.headNodeId;
  const pendingChildNodeId = raw.pendingChildNodeId;
  return {
    key: NEWEST_STORY_STORE_KEY,
    headNodeId: typeof headNodeId === 'string' && headNodeId.trim() ? headNodeId.trim() : null,
    pendingChildNodeId:
      typeof pendingChildNodeId === 'string' && pendingChildNodeId.trim()
        ? pendingChildNodeId.trim()
        : null,
    updatedAt:
      typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : Date.now(),
  };
}
