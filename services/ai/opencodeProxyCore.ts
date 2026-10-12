import { handleSimpleProxyRequest, readText } from './proxyCoreShared';

type OpenCodeProxyBody = {
  baseUrl?: string;
  apiKey?: string;
  kind?: 'chat' | 'models';
  endpoint?: 'chat' | 'messages' | 'responses' | 'gemini';
  body?: unknown;
  model?: string;
  stream?: boolean;
};

function normalizeOpenCodeBaseUrl(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, '');
  base = base.split('?')[0] ?? base;
  base = base
    .replace(/\/zen\/go\/v1/i, '/zen/v1')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/messages$/i, '')
    .replace(/\/responses$/i, '')
    .replace(/\/models\/[^/]+(?::(?:stream)?generateContent)?$/i, '')
    .replace(/\/models$/i, '');
  if (/^https:\/\/opencode\.ai$/i.test(base)) return `${base}/zen/v1`;
  if (/^https:\/\/opencode\.ai\/zen$/i.test(base)) return `${base}/v1`;
  return base;
}

function assertOpenCodeBaseUrl(baseUrl: string): string {
  const base = normalizeOpenCodeBaseUrl(baseUrl);
  if (!/^https:\/\/opencode\.ai\/zen\/v1(?:\/|$)/i.test(base)) {
    throw new Error('仅允许代理 OpenCode Zen：opencode.ai/zen/v1。');
  }
  return base;
}

function buildOpenCodeUpstreamUrl(payload: OpenCodeProxyBody): string {
  const base = assertOpenCodeBaseUrl(readText(payload.baseUrl));
  if (payload.kind === 'models') return `${base}/models`;

  const endpoint = payload.endpoint ?? 'chat';
  if (endpoint === 'messages') return `${base}/messages`;
  if (endpoint === 'responses') return `${base}/responses`;
  if (endpoint === 'gemini') {
    const model = encodeURIComponent(readText(payload.model));
    if (!model) throw new Error('缺少 OpenCode Zen Gemini 模型 ID。');
    return `${base}/models/${model}:${payload.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
  }
  return `${base}/chat/completions`;
}

function openCodeUpstreamHeaders(payload: OpenCodeProxyBody): HeadersInit {
  const apiKey = readText(payload.apiKey);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (payload.endpoint === 'messages') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  }
  if (payload.endpoint === 'gemini') {
    headers['x-goog-api-key'] = apiKey;
  }
  return headers;
}

const opencodeProxyDef = {
  缺字段提示: '缺少 OpenCode Zen Base URL 或 API Key。',
  构建上游地址: buildOpenCodeUpstreamUrl,
  构建上游请求: (payload: OpenCodeProxyBody, apiKey: string): RequestInit => ({
    method: payload.kind === 'models' ? 'GET' : 'POST',
    headers: openCodeUpstreamHeaders({ ...payload, apiKey }),
    body: payload.kind === 'models' ? undefined : JSON.stringify(payload.body ?? {}),
  }),
};

export function handleOpenCodeProxyRequest(request: Request): Promise<Response> {
  return handleSimpleProxyRequest(request, opencodeProxyDef);
}
