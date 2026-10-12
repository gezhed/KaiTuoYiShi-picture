import type { 聊天消息 } from '@/models/chat';

export interface 可修复回合 {
  turn: number;
  targetMessageId: string;
}

function 回合正文(message: 聊天消息): string {
  return message.parsedResponse?.body ?? message.content;
}

export function 列出可修复回合(
  messages: readonly 聊天消息[],
  limit = 40,
): 可修复回合[] {
  const results: 可修复回合[] = [];
  for (let index = messages.length - 1; index >= 0 && results.length < limit; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant' || message.isStreaming) continue;
    if (!回合正文(message).trim()) continue;
    const 原始回合 = message.gameTime;
    const 数值回合 = 原始回合 === undefined || 原始回合.trim() === '' ? Number.NaN : Number(原始回合);
    const turn = Number.isFinite(数值回合) && 数值回合 >= 0 ? Math.trunc(数值回合) : index + 1;
    results.push({ turn, targetMessageId: message.id });
  }
  return results;
}
