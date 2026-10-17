/**
 * B 客户端：把 AI 请求交给本地服务端中转（服务端转发上游，流式还会广播正文给多端）。
 *
 * 两种用途：
 *   ① 显式开启（`kty.aiRelay = on`）→ 流式请求**优先**走中转，多端同看一条流；
 *   ② 直连撞网络错误（绝大多数是 CORS：中转站没发 `Access-Control-Allow-Origin`）
 *      → 自动改走同源中转兜底，不需要用户开开关，也不要求有请求体（模型列表是 GET）。
 *
 * 本地服务不可用（例如部署到 Cloudflare Pages）时一律返回 null，调用方回退直连。
 * 只改传输通道，不碰解析/业务。
 *
 * 为什么兜底必须存在：`Failed to fetch` 在浏览器里是**没有响应**的意思。第三方中转
 * 若不给 CORS 头（Google AI Studio 的 Build 部署、不少自建反代都是这样），
 * 前端无论怎么填 Key 都拿不到数据；SillyTavern 能连是因为它有自己的 Node 后端转发。
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

/**
 * 提交一次中转请求。
 *
 * `本地可用 === false` 是粘性的：探到本地没有服务端（静态托管）之后就不再逐个请求重试，
 * 否则每次网络失败都要多打一次注定 404 的请求。
 */
async function 提交中转(路径: string, url: string, init: RequestInit): Promise<Response | null> {
  if (本地可用 === false) return null;
  const 载荷 = JSON.stringify({
    url,
    method: init.method ?? 'GET',
    headers: 归一化请求头(init.headers),
    body: typeof init.body === 'string' && init.body ? init.body : undefined,
  });
  try {
    const 响应 = await fetch(路径, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 载荷,
      signal: init.signal ?? undefined,
    });
    if (!响应.ok) {
      本地可用 = false;
      return null;
    }
    // 静态托管的 SPA 兜底会把 index.html 当 200 返回；类型不对就当没有中转。
    const 类型 = (响应.headers.get('content-type') ?? '').toLowerCase();
    if (!类型.includes('json') && !类型.includes('event-stream')) {
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

/** 显式开启时，让流式请求优先走本地中转；不可用或失败返回 null（调用方回退直连）。 */
export async function 尝试本地中转(url: string, init: RequestInit): Promise<Response | null> {
  if (!中转已启用()) return null;
  if (typeof init.body !== 'string' || !init.body) return null;
  return 提交中转('/api/ai/stream', url, init);
}

/**
 * 直连失败之后的中转兜底。
 *
 * 只在网络层失败（CORS / DNS / TLS）时调用；已经拿到 HTTP 状态码的失败**不要**走这里——
 * 那说明连通性是好的，换通道只会掩盖真正的报错。
 */
export async function 直连失败后经中转(url: string, init: RequestInit): Promise<Response | null> {
  // 同源路径（`/api/opencode` 之类）本来就没有 CORS，再套一层没有意义。
  if (!/^https?:/i.test(url)) return null;
  return 提交中转('/api/ai/proxy', url, init);
}

/**
 * 带 CORS 兜底的 fetch：直连在网络层失败时改走同源中转，两边都不行才抛原错。
 *
 * 模型列表的**每个**供应商分支都要走这个。只给「OpenAI 兼容」那条补兜底，
 * 就会出现「其他 API 能拉到、主 API 拉不到」这种只差一个供应商选项的怪现象。
 */
export async function 带兜底取(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (错误) {
    const 兜底 = await 直连失败后经中转(url, init);
    if (兜底) return 兜底;
    throw 错误;
  }
}
