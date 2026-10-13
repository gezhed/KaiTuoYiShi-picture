import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';

import { setStreamingMessage } from '@/utils/streamingMessageStore';
import { 注册就地同步 } from '@/services/localSave/inPlaceSync';
import { 订阅实时事件, 读取客户端ID } from '@/services/localSave/liveSync';

interface LiveSyncBridgeProps {
  /** 原地载入最新工作区（应用自带的「继续」动作，不重载页面）。缺省时退化为手动刷新按钮。 */
  on同步?: () => void;
  /** 主机端：收到遥控端转来的用户输入时，像本机打字一样触发发送。 */
  on远程输入?: (text: string) => void;
}

/**
 * 观众端实时同步：
 * - `stream`：写入 streamingMessageStore → 聊天列表直接渲染成"生成中"消息；回放亦可（刷新后恢复显示）；
 * - `typing`：显示「另一台设备正在输入…」；
 * - `turn-done`：清空本地流式文字，并**原地载入最新工作区**（调用应用的 handleContinue，不整页重载）；
 *   无 on同步 时退化为一个手动「刷新同步」按钮。
 *
 * 只在「本会话真见过生成」时才同步；空闲结束一律不触发——避免跨设备互相触发。
 */
export function LiveSyncBridge({ on同步, on远程输入 }: LiveSyncBridgeProps): ReactElement | null {
  const [正在输入, set正在输入] = useState(false);
  const [提示, set提示] = useState('');
  const [可刷新, set可刷新] = useState(false);
  const 见过活动 = useRef(false);
  const on同步Ref = useRef(on同步);
  const on远程输入Ref = useRef(on远程输入);

  // 回调存到 ref：订阅只建立一次，避免父组件每次渲染都重连 SSE。
  useEffect(() => {
    on同步Ref.current = on同步;
    on远程输入Ref.current = on远程输入;
  }, [on同步, on远程输入]);

  // 把「就地同步」注册到全局，供跨设备弹条等非 React 浮层调用（避免整页重载）。
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
        if (!回放) 见过活动.current = true;
        set正在输入(false);
        set可刷新(false);
        set提示(回放 ? '（该生成可能因刷新而中断）' : '');
        setStreamingMessage(事件.text);
        return;
      }
      if (事件.kind === 'typing') {
        if (!回放) 见过活动.current = true;
        set正在输入(true);
        set提示('');
        return;
      }
      if (事件.kind === 'user-input' && typeof 事件.text === 'string') {
        // 主机端：遥控端发来的输入 → 像用户自己打字一样触发发送。
        if (!回放) on远程输入Ref.current?.(事件.text);
        return;
      }
      if (事件.kind === 'turn-done' || 事件.kind === 'turn-idle') {
        set正在输入(false);
        set提示('');
        setStreamingMessage('');
        if (!回放 && 见过活动.current) {
          见过活动.current = false;
          if (on同步Ref.current) on同步Ref.current();
          else set可刷新(true);
        }
      }
    });
  }, []);

  if (!正在输入 && !提示 && !可刷新) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        zIndex: 2147483000,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        maxWidth: 'min(92vw, 560px)',
        padding: '8px 14px',
        borderRadius: 10,
        background: 'rgba(22,26,36,0.97)',
        border: '1px solid rgba(126,180,255,0.45)',
        color: '#e8eef8',
        font: '13px/1.5 system-ui, -apple-system, sans-serif',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      }}
    >
      <span>{正在输入 ? '另一台设备正在输入…' : (提示 || '本回合已结束')}</span>
      {可刷新 && (
        <button
          type="button"
          onClick={() => { window.location.reload(); }}
          style={{
            padding: '4px 10px',
            borderRadius: 7,
            border: '1px solid rgba(126,180,255,0.55)',
            background: 'rgba(126,180,255,0.16)',
            color: '#cfe4ff',
            cursor: 'pointer',
            font: 'inherit',
            flexShrink: 0,
          }}
        >
          刷新同步
        </button>
      )}
    </div>
  );
}
