import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';

import { setStreamingMessage } from '@/utils/streamingMessageStore';
import { 订阅实时事件, 读取客户端ID } from '@/services/localSave/liveSync';

/**
 * 观众端实时同步（P2/P3）：
 * - `stream`：写入 streamingMessageStore → 聊天列表直接渲染成"生成中"消息（回放亦可，用于刷新后恢复显示）；
 * - `typing`：显示「另一台设备正在输入…」；
 * - `turn-done`：清空本地流式文字；**仅当这是现场事件（非回放）**才延时自动重载拉取（防重载循环）。
 *
 * 主机侧的发布在 ChatList；本组件忽略自己发出的现场事件，主机不会自刷。
 */
export function LiveSyncBridge(): ReactElement | null {
  const [正在输入, set正在输入] = useState(false);
  const [提示, set提示] = useState('');
  const 重载计时 = useRef<number | null>(null);

  useEffect(() => {
    const 我 = 读取客户端ID();
    return 订阅实时事件((事件) => {
      const 回放 = 事件.replay === true;
      if (!回放 && 事件.clientId === 我) return;

      if (事件.kind === 'stream' && typeof 事件.text === 'string') {
        set正在输入(false);
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
        // 只有「现场」的结束才触发自动重载：回放的结束不能重载，否则刷新后会无限重载。
        if (!回放 && 重载计时.current === null) {
          重载计时.current = window.setTimeout(() => { window.location.reload(); }, 1800);
        }
      }
    });
  }, []);

  const 文案 = 正在输入 ? '另一台设备正在输入…' : 提示;
  if (!文案) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        zIndex: 2147483000,
        padding: '8px 14px',
        borderRadius: 10,
        background: 'rgba(22,26,36,0.97)',
        border: '1px solid rgba(126,180,255,0.45)',
        color: '#e8eef8',
        font: '13px/1.5 system-ui, -apple-system, sans-serif',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      }}
    >
      {文案}
    </div>
  );
}
