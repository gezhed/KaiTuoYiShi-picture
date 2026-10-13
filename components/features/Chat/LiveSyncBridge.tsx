import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';

import { setStreamingMessage } from '@/utils/streamingMessageStore';
import { 注册就地同步 } from '@/services/localSave/inPlaceSync';
import { 订阅实时事件, 读取客户端ID } from '@/services/localSave/liveSync';

interface LiveSyncBridgeProps {
  /** 原地载入最新工作区（应用自带的「继续」动作，不重载页面）。 */
  on同步?: () => void;
  /** 主机端：收到遥控端转来的用户输入时，像本机打字一样触发发送。 */
  on远程输入?: (text: string) => void;
}

/**
 * 多端实时同步桥（无界面）：
 * - 遥控端收到主机流式文字 → 写进 streamingMessageStore（聊天列表直接渲染）；
 * - 主机收到遥控端输入 → 触发本地发送；
 * - 收到回合结束 → 原地载入最新工作区（此时变量结算已完成）。
 * 不做任何弹窗/浮层，也不整页重载。
 */
export function LiveSyncBridge({ on同步, on远程输入 }: LiveSyncBridgeProps): ReactElement | null {
  const on同步Ref = useRef(on同步);
  const on远程输入Ref = useRef(on远程输入);
  const 上次同步 = useRef(0);

  useEffect(() => {
    on同步Ref.current = on同步;
    on远程输入Ref.current = on远程输入;
  }, [on同步, on远程输入]);

  // 把「就地同步」注册到全局，供其它非 React 逻辑调用（避免整页重载）。
  useEffect(() => {
    注册就地同步(() => on同步Ref.current?.());
    return () => { 注册就地同步(null); };
  }, []);

  useEffect(() => {
    const 我 = 读取客户端ID();
    return 订阅实时事件((事件) => {
      const 回放 = 事件.replay === true;
      if (!回放 && 事件.clientId === 我) return;

      if (事件.kind === 'stream' && typeof 事件.text === 'string') {
        setStreamingMessage(事件.text);
        return;
      }
      if (事件.kind === 'user-input' && typeof 事件.text === 'string') {
        // 主机端：遥控端发来的输入 → 像用户自己打字一样触发发送。
        if (!回放) on远程输入Ref.current?.(事件.text);
        return;
      }
      if (事件.kind === 'turn-done' || 事件.kind === 'turn-idle') {
        if (回放) return;
        setStreamingMessage('');
        // 冷却：无论什么原因，同步至少间隔 4 秒一次，杜绝风暴。
        const 现在 = Date.now();
        if (现在 - 上次同步.current < 4000) return;
        上次同步.current = 现在;
        on同步Ref.current?.();
      }
    });
  }, []);

  return null;
}
