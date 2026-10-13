/**
 * 多端实时通道（P1）：同一本地服务上的一条 SSE 事件总线。
 *
 * 用途：发消息那台（主机）把「回合开始 / 流式文字片段 / 落盘完成」逐条 publish，
 * 其它设备（手机）订阅后能实时看到同一场生成的状态与文字，并据此自动拉取最新状态。
 *
 * 仅由 vite 中间件导入；内存态，进程重启即清空。仅保留最近 N 条供刷新后回放。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface 实时事件 {
  seq: number;
  kind: string;
  [键: string]: unknown;
}

const 保留条数 = 300;
const 心跳毫秒 = 15000;

const 事件表: 实时事件[] = [];
const 订阅者 = new Set<ServerResponse>();
let 序号 = 0;
let 心跳: ReturnType<typeof setInterval> | null = null;

function 停止心跳(): void {
  if (心跳 !== null) {
    clearInterval(心跳);
    心跳 = null;
  }
}

/** 发布一条实时事件，并推给所有订阅者。 */
export function 发布实时事件(载荷: Record<string, unknown>): 实时事件 {
  序号 += 1;
  const 事件 = { seq: 序号, ...载荷 } as 实时事件;
  事件表.push(事件);
  if (事件表.length > 保留条数) 事件表.splice(0, 事件表.length - 保留条数);
  const 帧 = `data: ${JSON.stringify(事件)}\n\n`;
  for (const 响应 of [...订阅者]) {
    try {
      响应.write(帧);
    } catch {
      订阅者.delete(响应);
    }
  }
  return 事件;
}

/** 当前最近事件快照（诊断用）。 */
export function 读取实时事件(): 实时事件[] {
  return [...事件表];
}

/** 处理 `GET /api/live/stream`：先回放最近事件，再持续推送增量。 */
export function 处理实时订阅(req: IncomingMessage, res: ServerResponse): void {
  const 响应 = res;
  响应.statusCode = 200;
  响应.setHeader('content-type', 'text/event-stream; charset=utf-8');
  响应.setHeader('cache-control', 'no-cache, no-transform');
  响应.setHeader('connection', 'keep-alive');
  响应.setHeader('x-accel-buffering', 'no');
  响应.write('retry: 2000\n\n');
  for (const 事件 of 事件表) {
    响应.write(`data: ${JSON.stringify(事件)}\n\n`);
  }
  订阅者.add(响应);
  if (心跳 === null) {
    心跳 = setInterval(() => {
      for (const 订阅 of [...订阅者]) {
        try {
          订阅.write(': ping\n\n');
        } catch {
          订阅者.delete(订阅);
        }
      }
      if (!订阅者.size) 停止心跳();
    }, 心跳毫秒);
  }
  const 清理 = (): void => {
    订阅者.delete(响应);
    if (!订阅者.size) 停止心跳();
  };
  req.on('close', 清理);
  req.on('aborted', 清理);
}
