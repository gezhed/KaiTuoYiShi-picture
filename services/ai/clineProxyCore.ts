import { handleSimpleProxyRequest, readText } from './proxyCoreShared';

type ClineProxyBody = {
  baseUrl?: string;
  apiKey?: string;
  body?: unknown;
};

export function normalizeClineBaseUrl(baseUrl: string): string {
  // 先剥离查询串再去尾斜杠：`.../v1/?x=1` 这类地址先去斜杠会留下 `v1/`。
  let base = (baseUrl.trim().split('?')[0] ?? '').replace(/\/+$/, '');
  base = base
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models(?:\/.*)?$/i, '');
  if (/^https:\/\/api\.cline\.bot$/i.test(base)) return `${base}/api/v1`;
  if (/\/api$/i.test(base)) return `${base}/v1`;
  return base;
}

export function isClineBaseUrl(baseUrl: string): boolean {
  return /^https:\/\/api\.cline\.bot(?:\/|$)/i.test(baseUrl.trim());
}

/** 防止同源代理被当作任意上游跳板。 */
export function assertClineBaseUrl(baseUrl: string): string {
  const base = normalizeClineBaseUrl(baseUrl);
  if (!/^https:\/\/api\.cline\.bot\/api\/v1$/i.test(base)) {
    throw new Error('仅允许代理 Cline API：https://api.cline.bot/api/v1。');
  }
  return base;
}

export function buildClineProxyBody(
  config: { baseUrl: string; apiKey: string },
  body: Record<string, unknown>,
): string {
  return JSON.stringify({
    baseUrl: normalizeClineBaseUrl(config.baseUrl),
    apiKey: config.apiKey,
    body,
  });
}

const clineProxyDef = {
  缺字段提示: '缺少 Cline Base URL 或 API Key。',
  构建上游地址: (payload: ClineProxyBody): string =>
    `${assertClineBaseUrl(readText(payload.baseUrl))}/chat/completions`,
  构建上游请求: (payload: ClineProxyBody, apiKey: string): RequestInit => ({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload.body ?? {}),
  }),
};

export function handleClineProxyRequest(request: Request): Promise<Response> {
  return handleSimpleProxyRequest(request, clineProxyDef);
}
