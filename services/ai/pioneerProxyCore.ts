import { handleSimpleProxyRequest, readText } from './proxyCoreShared';

type PioneerProxyBody = {
  baseUrl?: string;
  apiKey?: string;
  kind?: 'chat' | 'models';
  body?: unknown;
};

export function normalizePioneerBaseUrl(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, '');
  base = base.split('?')[0] ?? base;
  base = base
    .replace(/\/v1\/chat\/completions$/i, '/v1')
    .replace(/\/v1\/models$/i, '/v1')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '');
  if (/^https:\/\/api\.pioneer\.ai$/i.test(base)) return `${base}/v1`;
  return base;
}

export function isPioneerBaseUrl(baseUrl: string): boolean {
  return /^https:\/\/api\.pioneer\.ai(?:\/|$)/i.test(baseUrl.trim());
}

export function assertPioneerBaseUrl(baseUrl: string): string {
  const base = normalizePioneerBaseUrl(baseUrl);
  if (!/^https:\/\/api\.pioneer\.ai\/v1$/i.test(base)) {
    throw new Error('仅允许代理 Pioneer OpenAI 兼容接口：https://api.pioneer.ai/v1。');
  }
  return base;
}

const pioneerProxyDef = {
  缺字段提示: '缺少 Pioneer Base URL 或 API Key。',
  构建上游地址: (payload: PioneerProxyBody): string => {
    const base = assertPioneerBaseUrl(readText(payload.baseUrl));
    if (payload.kind === 'models') return `${base}/models`;
    return `${base}/chat/completions`;
  },
  构建上游请求: (payload: PioneerProxyBody, apiKey: string): RequestInit => ({
    method: payload.kind === 'models' ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: payload.kind === 'models' ? undefined : JSON.stringify(payload.body ?? {}),
  }),
};

export function handlePioneerProxyRequest(request: Request): Promise<Response> {
  return handleSimpleProxyRequest(request, pioneerProxyDef);
}
