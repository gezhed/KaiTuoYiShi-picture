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

/** 本端是不是「主机」：走 localhost 打开的那台才是（它跑生成、拥有状态）；从局域网 IP 进来的（手机）是遥控/显示端。 */
export function 是主机端(): boolean {
  const 主机 = globalThis.location.hostname;
  return 主机 === 'localhost' || 主机 === '127.0.0.1' || 主机 === '::1' || 主机 === '[::1]';
}

/** 遥控端把用户输入转给主机（不发本地）。 */
export async function 发送远程输入(text: string): Promise<void> {
  await 发布实时事件({ kind: 'user-input', source: 'remote', text });
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
