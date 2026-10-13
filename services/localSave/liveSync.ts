/**
 * 多端实时同步客户端（P1）：发布（主机）与订阅（观众）。
 *
 * 依赖 `/api/live/*` 中间件（见 vite.config.ts 与 services/localSave/server/liveBus.ts）。
 * 通道不可用时全部静默降级，不影响游戏本体。
 */
export interface 实时事件 {
  seq: number;
  kind: string;
  [键: string]: unknown;
}

const 前缀 = '/api/live';

/** 本标签页的客户端标识：发布时附带，订阅时用来忽略自己发出的事件（避免主机自刷）。 */
const 客户端ID = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export function 读取客户端ID(): string {
  return 客户端ID;
}

/** 发布一条实时事件；通道不可用时静默忽略。 */
export async function 发布实时事件(载荷: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${前缀}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...载荷, clientId: 客户端ID }),
    });
  } catch {
    // 实时通道只是增强，不可用则忽略。
  }
}

/** 订阅实时事件；返回取消订阅的函数。EventSource 断线会自动重连。 */
export function 订阅实时事件(收到: (事件: 实时事件) => void): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  const 源 = new EventSource(`${前缀}/stream`);
  源.onmessage = (消息: MessageEvent<string>) => {
    try {
      收到(JSON.parse(消息.data) as 实时事件);
    } catch {
      // 忽略坏帧。
    }
  };
  源.onerror = () => {
    // EventSource 自带重连，这里不处理。
  };
  return () => 源.close();
}
