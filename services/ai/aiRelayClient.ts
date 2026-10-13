/**
 * B 客户端：把 AI 流式请求交给本地服务端中转（服务端转发上游 + 广播正文给多端）。
 *
 * 本地服务不可用（例如部署到 Cloudflare Pages）时返回 null，调用方回退为直连上游。
 * 只改"传输通道"，不碰解析/业务，保证任何情况下都有直连兜底。
 */
let 本地可用: boolean | null = null;

/** 中转开关：默认关闭——AI 直连，确保游戏本体绝不受中转任何问题影响。
 *  开启：浏览器控制台执行 localStorage.setItem('kty.aiRelay','on') 后刷新。 */
function 中转已启用(): boolean {
  try {
    return globalThis.localStorage.getItem('kty.aiRelay') === 'on';
  } catch {
    return false;
  }
}

function 归一化请求头(原始: RequestInit['headers']): Record<string, string> {
  const 头: Record<string, string> = {};
  if (!原始) return 头;
  if (原始 instanceof Headers) {
    原始.forEach((值, 键) => { 头[键] = 值; });
  } else if (Array.isArray(原始)) {
    for (const [键, 值] of 原始) 头[键] = 值;
  } else {
    for (const [键, 值] of Object.entries(原始)) {
      if (typeof 值 === 'string') 头[键] = 值;
    }
  }
  return 头;
}

/** 经本地服务端中转一次流式请求；不可用或失败时返回 null（调用方回退直连）。 */
export async function 尝试本地中转(url: string, init: RequestInit): Promise<Response | null> {
  if (!中转已启用()) return null;
  if (本地可用 === false) return null;
  if (typeof init.body !== 'string' || !init.body) return null;
  const 载荷 = JSON.stringify({
    url,
    method: init.method ?? 'POST',
    headers: 归一化请求头(init.headers),
    body: init.body,
  });
  try {
    const 响应 = await fetch('/api/ai/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 载荷,
      signal: init.signal ?? undefined,
    });
    if (!响应.ok) {
      本地可用 = false;
      return null;
    }
    本地可用 = true;
    return 响应;
  } catch {
    本地可用 = false;
    return null;
  }
}
