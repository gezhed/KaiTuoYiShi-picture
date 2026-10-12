export function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function proxyHeaders(upstream?: Response): Headers {
  const headers = new Headers();
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type');
  headers.set('cache-control', 'no-store');
  headers.set('content-type', upstream?.headers.get('content-type') || 'application/json; charset=utf-8');
  return headers;
}

export interface SimpleProxyDef<TBody extends { baseUrl?: string; apiKey?: string }> {
  缺字段提示: string;
  构建上游地址: (payload: TBody) => string;
  构建上游请求: (payload: TBody, apiKey: string) => RequestInit;
}

/** 四家简单代理（ark/cline/pioneer/opencode）共用的请求骨架：解析→验空→转发→透传。 */
export async function handleSimpleProxyRequest<TBody extends { baseUrl?: string; apiKey?: string }>(
  request: Request,
  def: SimpleProxyDef<TBody>,
): Promise<Response> {
  let payload: TBody;
  try {
    payload = await request.json() as TBody;
  } catch {
    return new Response(JSON.stringify({ error: '请求体不是有效 JSON。' }), {
      status: 400,
      headers: proxyHeaders(),
    });
  }

  const baseUrl = readText(payload.baseUrl);
  const apiKey = readText(payload.apiKey);
  if (!baseUrl || !apiKey) {
    return new Response(JSON.stringify({ error: def.缺字段提示 }), {
      status: 400,
      headers: proxyHeaders(),
    });
  }

  try {
    const upstream = await fetch(def.构建上游地址(payload), def.构建上游请求(payload, apiKey));
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: proxyHeaders(upstream),
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 502,
      headers: proxyHeaders(),
    });
  }
}
