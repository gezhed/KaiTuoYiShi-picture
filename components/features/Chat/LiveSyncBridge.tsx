import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';

import { setStreamingMessage } from '@/utils/streamingMessageStore';
import { 订阅实时事件, 读取客户端ID } from '@/services/localSave/liveSync';

export interface 镜像消息 {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface LiveSyncBridgeProps {
  /**
   * 遥控端：把主机的这一回合追加到本地聊天——**纯显示**。
   * 绝不调用「载入存档」：那会在头未封版时 fork 出新存档树，导致存档与内存无限膨胀。
   */
  on追加消息?: (消息: 镜像消息) => void;
  /** 主机端：收到遥控端发来的输入时，像本机打字一样触发发送。 */
  on远程输入?: (text: string) => void;
}

/**
 * 多端实时同步桥（无界面）：
 * - 遥控端收到主机流式文字 → 写进 streamingMessageStore（聊天列表实时渲染）；
 * - 主机收到遥控端输入 → 触发本地发送；
 * - 回合结束 → 遥控端把这段正文**追加**成一条消息（不载入、不分叉、不写盘）。
 */
export function LiveSyncBridge({ on追加消息, on远程输入 }: LiveSyncBridgeProps): ReactElement | null {
  const on追加Ref = useRef(on追加消息);
  const on输入Ref = useRef(on远程输入);
  const 流文本 = useRef('');

  useEffect(() => {
    on追加Ref.current = on追加消息;
    on输入Ref.current = on远程输入;
  }, [on追加消息, on远程输入]);

  useEffect(() => {
    const 我 = 读取客户端ID();
    return 订阅实时事件((事件) => {
      const 回放 = 事件.replay === true;
      if (!回放 && 事件.clientId === 我) return;

      if (事件.kind === 'stream' && typeof 事件.text === 'string') {
        流文本.current = 事件.text;
        setStreamingMessage(事件.text);
        return;
      }
      if (事件.kind === 'user-input' && typeof 事件.text === 'string') {
        if (!回放) on输入Ref.current?.(事件.text);
        return;
      }
      if (事件.kind === 'turn-done' || 事件.kind === 'turn-idle') {
        if (回放) return;
        setStreamingMessage('');
        const 文本 = 流文本.current.trim();
        流文本.current = '';
        if (文本) {
          on追加Ref.current?.({
            id: `remote-ai-${Date.now()}`,
            role: 'assistant',
            content: 文本,
            timestamp: Date.now(),
          });
        }
      }
    });
  }, []);

  return null;
}
