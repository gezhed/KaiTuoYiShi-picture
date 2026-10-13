import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

import { 订阅实时事件 } from '@/services/localSave/liveSync';

type 远程状态 = 'idle' | 'typing' | 'stream';

/**
 * 观众端实时浮层（P1）：订阅实时通道，显示"另一台设备正在输入 / 正在生成"的实时文字。
 * 主机侧的发布在 ChatList（它持有流式文字）。
 */
export function LiveSyncBridge(): ReactElement | null {
  const [远程文本, set远程文本] = useState('');
  const [状态, set状态] = useState<远程状态>('idle');

  useEffect(
    () => 订阅实时事件((事件) => {
      if (事件.kind === 'stream' && typeof 事件.text === 'string') {
        const 文本 = 事件.text;
        if (文本) {
          set远程文本(文本);
          set状态('stream');
        }
      } else if (事件.kind === 'typing') {
        set远程文本('');
        set状态('typing');
      } else if (事件.kind === 'turn-done' || 事件.kind === 'turn-idle') {
        set远程文本('');
        set状态('idle');
      }
    }),
    [],
  );

  if (状态 === 'idle') return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        zIndex: 2147483000,
        maxWidth: 'min(92vw, 560px)',
        maxHeight: '38vh',
        overflow: 'auto',
        padding: '10px 14px',
        borderRadius: 10,
        background: 'rgba(22,26,36,0.97)',
        border: '1px solid rgba(126,180,255,0.45)',
        color: '#e8eef8',
        font: '13px/1.6 system-ui, -apple-system, sans-serif',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ opacity: 0.7, fontSize: 11, marginBottom: 6 }}>
        {状态 === 'typing' ? '另一台设备正在输入…' : '另一台设备正在生成…'}
      </div>
      {远程文本 && <div style={{ whiteSpace: 'pre-wrap' }}>{远程文本.slice(-1000)}</div>}
    </div>
  );
}
