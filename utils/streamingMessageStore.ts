import { useSyncExternalStore } from 'react';

let text = '';
const listeners = new Set<() => void>();

export function getStreamingMessage(): string {
  return text;
}

export function setStreamingMessage(value: string): void {
  if (text === value) return;
  // 空串视为「显式清空」（重试 / 新一轮 / 回合落地）。
  if (value === '') {
    resetStreamingMessage();
    return;
  }
  /*
   * 单调守卫：流式预览只允许向前推进。
   * 新值是当前值的严格前缀，说明有某条晚到的写入想把它「退回去」——
   * 直接丢弃，否则界面上就会看到正文跳回一个字再重打。
   */
  if (value.length < text.length && text.startsWith(value)) return;
  text = value;
  for (const listener of listeners) listener();
}

/** 显式清空。清空是唯一允许「倒退」的路径。 */
export function resetStreamingMessage(): void {
  if (text === '') return;
  text = '';
  for (const listener of listeners) listener();
}

export function subscribeStreamingMessage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useStreamingMessage(): string {
  return useSyncExternalStore(subscribeStreamingMessage, getStreamingMessage, getStreamingMessage);
}
