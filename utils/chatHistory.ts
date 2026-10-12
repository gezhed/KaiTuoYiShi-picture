import type { 聊天消息 } from '@/models/chat';

export function findPreviousUserInput(history: readonly 聊天消息[], assistantId: string): string {
  const assistantIndex = history.findIndex((item) => item.id === assistantId);
  if (assistantIndex < 0) return '';
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (history[index].role === 'user') return history[index].content;
  }
  return '';
}
