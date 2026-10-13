import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

import { setStreamingMessage } from '@/utils/streamingMessageStore';
import { 订阅实时事件, 读取客户端ID } from '@/services/localSave/liveSync';

/**
 * 观众端实时同步：
 * - `stream`：写入 streamingMessageStore → 聊天列表直接渲染成"生成中"消息；回放亦可（刷新后恢复显示）；
 * - `typing`：显示「另一台设备正在输入…」；
 * - `turn-done`：清空本地流式文字。**不做任何自动重载**——只弹一个「点此刷新同步」按钮。
 *
 * 为什么去掉自动重载：自动重载一旦判断失误就会跨设备互相触发，形成疯狂刷新、把正文冲掉。
 * 刷新必须由人点，才不可能失控。
 */
export function LiveSyncBridge(): ReactElement | null {
  const [正在输入, set正在输入] = useState(false);
  const [提示, set提示] = useState('');
  const [可刷新, set可刷新] = useState(false);

  useEffect(() => {
    const 我 = 读取客户端ID();
    return 订阅实时事件((事件) => {
      const 回放 = 事件.replay === true;
      if (!回放 && 事件.clientId === 我) return;

      if (事件.kind === 'stream' && typeof 事件.text === 'string') {
        set正在输入(false);
        set可刷新(false);
        set提示(回放 ? '（该生成可能因刷新而中断）' : '');
        setStreamingMessage(事件.text);
        return;
      }
      if (事件.kind === 'typing') {
        set正在输入(true);
        set提示('');
        return;
      }
      if (事件.kind === 'turn-done' || 事件.kind === 'turn-idle') {
        set正在输入(false);
        set提示('');
        setStreamingMessage('');
        if (!回放) set可刷新(true);
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
          点此刷新同步
        </button>
      )}
    </div>
  );
}
