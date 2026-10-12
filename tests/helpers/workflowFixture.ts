import { loadActiveLeaf } from '@/services/storage/saveTree';
import { 创建空解析回复, type 聊天消息, type 解析后回复 } from '@/models/chat';
import type { 队列任务记录 } from '@/models/queueTask';
import type { TurnRecoveryContext } from '@/models/turnRecovery';

export function userMessage(id: string, content = '继续前进'): 聊天消息 {
  return { id, role: 'user', content, timestamp: 1 };
}

export function assistantMessage(id: string, body = '正文内容'): 聊天消息 {
  return {
    id,
    role: 'assistant',
    content: body,
    timestamp: 2,
    gameTime: '2',
    parsedResponse: { ...创建空解析回复(), body, rawText: body },
  };
}

export function latestTask(
  queueTasks: 队列任务记录[],
  id: 队列任务记录['id'],
): 队列任务记录 | undefined {
  return [...queueTasks].reverse().find((task) => task.id === id);
}

export async function loadActiveLeafOrThrow() {
  const active = await loadActiveLeaf();
  if (active.status !== 'ok') throw new Error(`活跃叶子不可读：${active.status}`);
  return active;
}

export function parsedStub(body: string): 解析后回复 {
  return { body } as unknown as 解析后回复;
}

export function recoveryFor(
  input: string,
  userMessageId: string,
  extra: Partial<TurnRecoveryContext> = {},
  turnAtStart = 1,
): TurnRecoveryContext {
  return { turnAtStart, userInput: input, userMessageId, ...extra };
}
