/**
 * ComfyUI 错误格式化。
 *
 * 派生自 st-chatu8（智绘姬）`formatComfyUIApiError`（index.js L51011-L51057）。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：原函数只接在视频链路上（调用点 L51732/L51771/L51950/L52002），
 *   普通生图链路只抛出原始 HTTP 响应体。这里把它抽成纯函数并同时用于两条链路。
 */

export const ComfyUI默认错误文案 = 'ComfyUI 请求失败';

function 读取文本(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function 读取节点错误摘要(节点错误: unknown): string {
  if (!节点错误 || typeof 节点错误 !== 'object') return '';
  const 片段: string[] = [];
  for (const [节点号, 节点] of Object.entries(节点错误 as Record<string, unknown>)) {
    if (!节点 || typeof 节点 !== 'object') continue;
    const 记录 = 节点 as { class_type?: unknown; errors?: unknown };
    const 类型 = 读取文本(记录.class_type);
    const 错误列表 = Array.isArray(记录.errors) ? 记录.errors : [];
    const 消息 = 错误列表
      .map((条目) => {
        if (!条目 || typeof 条目 !== 'object') return '';
        const 项 = 条目 as { message?: unknown; details?: unknown };
        return 读取文本(项.message) || 读取文本(项.details);
      })
      .filter(Boolean)
      .join('; ');
    片段.push(`节点 #${节点号}${类型 ? ` (${类型})` : ''}: ${消息 || '参数无效'}`);
  }
  return 片段.length > 0 ? `\n【节点详情】${片段.join(' | ')}` : '';
}

export function 格式化ComfyUI错误(错误体: unknown, 默认文案 = ComfyUI默认错误文案): string {
  if (错误体 === null || 错误体 === undefined) return 默认文案;

  let 解析后: unknown = 错误体;
  if (typeof 解析后 === 'string') {
    const 原文 = 解析后;
    try {
      解析后 = JSON.parse(原文);
    } catch {
      return 原文;
    }
  }
  if (typeof 解析后 !== 'object' || 解析后 === null) return String(解析后);

  const 记录 = 解析后 as {
    error?: unknown;
    node_errors?: unknown;
    messages?: unknown;
    status_str?: unknown;
    exception_message?: unknown;
    message?: unknown;
    errorMessage?: unknown;
  };

  if (记录.error) {
    const 错误 = typeof 记录.error === 'object' && 记录.error !== null
      ? (记录.error as { type?: unknown; message?: unknown; details?: unknown })
      : null;
    const 类型 = 记录.error === null ? '' : 读取文本(错误?.type);
    const 消息 = 读取文本(错误?.message) || 读取文本(错误?.details) || 读取文本(记录.error);
    return `ComfyUI 校验失败 [${类型 || 'Prompt Error'}]: ${消息}${读取节点错误摘要(记录.node_errors)}`;
  }

  if (Array.isArray(记录.messages)) {
    for (const 条目 of 记录.messages) {
      if (!Array.isArray(条目) || 条目[0] !== 'execution_error') continue;
      const 信息 = (条目[1] ?? {}) as {
        node_id?: unknown;
        node_type?: unknown;
        exception_type?: unknown;
        exception_message?: unknown;
      };
      const 节点号 = 信息.node_id ? `节点 #${String(信息.node_id)}` : '';
      const 节点类型 = 信息.node_type ? ` [${String(信息.node_type)}]` : '';
      const 异常类型 = 信息.exception_type ? ` (${String(信息.exception_type)})` : '';
      const 异常消息 = 读取文本(信息.exception_message);
      return `ComfyUI 节点执行出错: ${节点号}${节点类型}${异常类型} - ${异常消息}`.trim();
    }
  }

  if (记录.status_str === 'error' && 记录.exception_message) {
    return `ComfyUI 任务执行出错: ${String(记录.exception_message)}`;
  }

  return 读取文本(记录.message) || 读取文本(记录.errorMessage) || 默认文案;
}

/** `Failed to fetch` / `Load failed` 在跨域或服务不可达时由浏览器抛出。 */
export function 规范化ComfyUI异常消息(原始消息: string): string {
  if (原始消息 === 'Failed to fetch' || 原始消息 === 'Load failed') {
    return `ComfyUI 请求失败，可能是服务不可达、跨域、代理异常或返回了无效响应: ${原始消息}`;
  }
  return 原始消息;
}
