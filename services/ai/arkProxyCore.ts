import { handleSimpleProxyRequest, readText } from './proxyCoreShared';

type ArkProxyBody = {
  baseUrl?: string;
  apiKey?: string;
  kind?: 'chat' | 'models';
  body?: unknown;
};

export function normalizeArkBaseUrl(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, '');
  base = base.split('?')[0] ?? base;
  base = base
    .replace(/\/api\/v3\/chat\/completions$/i, '/api/v3')
    .replace(/\/api\/v3\/models$/i, '/api/v3')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '');
  if (/^https:\/\/ark\.cn-beijing\.volces\.com$/i.test(base)) return `${base}/api/v3`;
  return base;
}

export function isArkBaseUrl(baseUrl: string): boolean {
  return /^https:\/\/ark\.cn-beijing\.volces\.com(?:\/|$)/i.test(baseUrl.trim());
}

export function assertArkBaseUrl(baseUrl: string): string {
  const base = normalizeArkBaseUrl(baseUrl);
  if (!/^https:\/\/ark\.cn-beijing\.volces\.com\/api\/v3$/i.test(base)) {
    throw new Error('仅允许代理火山方舟 OpenAI 兼容接口：https://ark.cn-beijing.volces.com/api/v3。');
  }
  return base;
}

export function buildArkProxyBody(config: { baseUrl: string; apiKey: string }, body: Record<string, unknown>): string {
  return JSON.stringify({
    kind: 'chat',
    baseUrl: normalizeArkBaseUrl(config.baseUrl),
    apiKey: config.apiKey,
    body,
  });
}

const arkProxyDef = {
  缺字段提示: '缺少火山方舟 Base URL 或 API Key。',
  构建上游地址: (payload: ArkProxyBody): string => {
    const base = assertArkBaseUrl(readText(payload.baseUrl));
    if (payload.kind === 'models') return `${base}/models`;
    return `${base}/chat/completions`;
  },
  构建上游请求: (payload: ArkProxyBody, apiKey: string): RequestInit => ({
    method: payload.kind === 'models' ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: payload.kind === 'models' ? undefined : JSON.stringify(payload.body ?? {}),
  }),
};

export function handleArkProxyRequest(request: Request): Promise<Response> {
  return handleSimpleProxyRequest(request, arkProxyDef);
}
