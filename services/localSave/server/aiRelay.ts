/**
 * B：服务端接管 AI 流式传输。
 *
 * 浏览器把「上游 URL + 请求头 + 请求体」交给这里 → 服务端发起上游请求 → **边流式回传发起端、
 * 边把正文片段广播到实时通道**（所有设备因此看到同一条上游真实流）。
 *
 * 仅由 vite 中间件导入；不驻留任何状态。上游失败按原样透传，调用方负责回退。
 */
import { 发布实时事件 } from './liveBus';

export interface AI中转请求 {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function 是记录(值: unknown): 值 is Record<string, unknown> {
  return Boolean(值) && typeof 值 === 'object' && !Array.isArray(值);
}

/** 从任意形状里尽量读出可见文本（字符串 / 数组 / {text|content|output_text}）。 */
function 读候选文本(值: unknown): string {
  if (typeof 值 === 'string') return 值;
  if (Array.isArray(值)) return 值.map((项) => 读候选文本(项)).join('');
  if (是记录(值)) {
    const 拼接 = 值.text ?? 值.content ?? 值.output_text;
    if (typeof 拼接 === 'string') return 拼接;
    if (Array.isArray(拼接)) return 拼接.map((项) => 读候选文本(项)).join('');
  }
  return '';
}

/** 从一段（可能不完整的）SSE 文本里抽取可见正文片段（不含思维链/reasoning）。 */
function 抽取正文片段(文本: string): string {
  let 出 = '';
  for (const 行 of 文本.split('\n')) {
    const 修剪 = 行.trim();
    if (!修剪.startsWith('data:')) continue;
    const 数据 = 修剪.slice('data:'.length).trim();
    if (!数据 || 数据 === '[DONE]') continue;
    let 对象: Record<string, unknown>;
    try {
      const 解析: unknown = JSON.parse(数据);
      if (!是记录(解析)) continue;
      对象 = 解析;
    } catch {
      continue;
    }
    const 类型 = typeof 对象.type === 'string' ? 对象.type : '';
    if (/thinking|reasoning/i.test(类型)) continue;

    const 选择项 = 对象.choices;
    const 首个 = Array.isArray(选择项) && 是记录(选择项[0]) ? 选择项[0] : undefined;
    const 增量 = 首个 && 是记录(首个.delta) ? 首个.delta : undefined;
    const 增量块 = 增量 ? (增量.content ?? 增量.text) : undefined;
    if (增量块 !== undefined && typeof 增量块 !== 'string' && !Array.isArray(增量块)) continue;

    const 片段 =
      读候选文本(增量块)
      || 读候选文本(首个?.text)
      || 读候选文本(对象.delta)
      || 读候选文本(对象.output_text)
      || 读候选文本(对象.text)
      || 读候选文本(对象.content);
    if (片段) 出 += 片段;
  }
  return 出;
}

/** 转发一次 AI 流式请求：回传字节原样给发起端，同时把正文片段广播出去。 */
export async function 转发AI流(请求: AI中转请求, 断开信号?: AbortSignal): Promise<Response> {
  const 上游 = await fetch(请求.url, {
    method: 请求.method ?? 'POST',
    headers: 请求.headers,
    body: 请求.body,
    signal: 断开信号,
  });
  if (!上游.body) return 上游;

  const 读端 = 上游.body.getReader();
  const 解码 = new TextDecoder();
  let 累积 = '';
  发布实时事件({ kind: 'typing', source: 'server' });

  const 流 = new ReadableStream<Uint8Array>({
    async pull(控制器) {
      const { done, value } = await 读端.read();
      if (done) {
        发布实时事件({ kind: 'turn-done', source: 'server' });
        控制器.close();
        return;
      }
      控制器.enqueue(value);
      const 增量 = 抽取正文片段(解码.decode(value, { stream: true }));
      if (增量) {
        累积 += 增量;
        发布实时事件({ kind: 'stream', source: 'server', text: 累积 });
      }
    },
    cancel() {
      void 读端.cancel();
    },
  });

  return new Response(流, {
    status: 上游.status,
    headers: {
      'content-type': 上游.headers.get('content-type') ?? 'text/event-stream; charset=utf-8',
    },
  });
}
