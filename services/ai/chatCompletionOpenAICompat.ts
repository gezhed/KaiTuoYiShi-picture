import { appendApiErrorReport } from './apiErrorReportService';
import { buildArkProxyBody, normalizeArkBaseUrl } from './arkProxyCore';
import { buildClineProxyBody, normalizeClineBaseUrl } from './clineProxyCore';
import { normalizePioneerBaseUrl } from './pioneerProxyCore';
import type { API配置项 } from '@/models/settings';
import { buildOpenAICompatibleChatUrl, isArkConfig, isBaiduQianfanConfig, isClineConfig, isMimoConfig, isPioneerConfig, normalizeMimoBaseUrl, normalizeOpenAICompatibleModel } from './chatCompletionProvider';
import { readOpenAICompatibleStreamDelta, runSseStream } from './chatCompletionStream';
import type { ChatCompletionRequest, ChatMessagePayload, StreamCallbacks } from './chatCompletionTypes';

type SamplingFieldNames = {
  topP?: string;
  topK?: string;
  repetitionPenalty?: string;
  frequencyPenalty?: string;
  presencePenalty?: string;
};

export function applySamplingParams(
  target: Record<string, unknown>,
  names: SamplingFieldNames,
  request: ChatCompletionRequest,
  config: API配置项,
): void {
  const topP = request.topP ?? config.topP;
  if (names.topP && typeof topP === 'number') target[names.topP] = topP;
  const topK = request.topK ?? config.topK;
  if (names.topK && typeof topK === 'number') target[names.topK] = topK;
  const repPenalty = request.repetitionPenalty ?? config.repetitionPenalty;
  if (names.repetitionPenalty && typeof repPenalty === 'number') target[names.repetitionPenalty] = repPenalty;
  const freqPenalty = request.frequencyPenalty ?? config.frequencyPenalty;
  if (names.frequencyPenalty && typeof freqPenalty === 'number') target[names.frequencyPenalty] = freqPenalty;
  const presPenalty = request.presencePenalty ?? config.presencePenalty;
  if (names.presencePenalty && typeof presPenalty === 'number') target[names.presencePenalty] = presPenalty;
}

export function buildOpenAICompatibleRequestBody(
  config: API配置项,
  messages: ChatMessagePayload[],
  request: ChatCompletionRequest,
  stream: boolean,
  includeUsage: boolean = true,
): Record<string, unknown> {
  const isMimo = isMimoConfig(config);
  const body: Record<string, unknown> = {
    model: normalizeOpenAICompatibleModel(config),
    messages,
    stream,
  };
  if (isMimo) {
    body.max_completion_tokens = request.maxTokens ?? config.maxTokens ?? 2048;
    body.thinking = { type: 'disabled' };
  } else {
    body.max_tokens = request.maxTokens ?? config.maxTokens ?? 2048;
    body.temperature = request.temperature ?? config.temperature ?? 0.8;
    applySamplingParams(body, {
      topP: 'top_p',
      frequencyPenalty: 'frequency_penalty',
      presencePenalty: 'presence_penalty',
      repetitionPenalty: 'repetition_penalty',
    }, request, config);
    const maxCtx = request.maxContext ?? config.maxContext;
    if (typeof maxCtx === 'number') body.max_context_tokens = maxCtx;
  }
  if (stream && includeUsage && request.onUsage) {
    body.stream_options = { include_usage: true };
  }
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    body.tools = request.tools;
    if (request.toolChoice !== undefined) body.tool_choice = request.toolChoice;
    if (typeof request.parallelToolCalls === 'boolean') body.parallel_tool_calls = request.parallelToolCalls;
  }
  return body;
}

/** Cline 端点不接受 stream_options、惩罚参数与 max_context_tokens 等扩展字段。 */
export function buildClineRequestBody(
  config: API配置项,
  messages: ChatMessagePayload[],
  request: ChatCompletionRequest,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model.trim(),
    messages,
    stream,
    temperature: request.temperature ?? config.temperature ?? 0.8,
  };
  const maxTokens = request.maxTokens ?? config.maxTokens;
  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
    body.max_tokens = maxTokens;
  }
  return body;
}

export function isStreamUsageOptionUnsupported(status: number, text: string): boolean {
  if (![400, 404, 422].includes(status)) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('stream_options') ||
    lower.includes('stream options') ||
    lower.includes('include_usage') ||
    lower.includes('include usage') ||
    lower.includes('unsupported parameter') ||
    lower.includes('unknown parameter') ||
    lower.includes('unrecognized parameter') ||
    lower.includes('invalid parameter') ||
    lower.includes('extra_forbidden') ||
    lower.includes('not support')
  );
}

function buildMimoAuthHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'api-key': apiKey,
  };
}

function buildQianfanProxyBody(config: API配置项, body: Record<string, unknown>): string {
  return JSON.stringify({
    kind: 'chat',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    body,
  });
}

function buildPioneerProxyBody(config: API配置项, body: Record<string, unknown>): string {
  return JSON.stringify({
    kind: 'chat',
    baseUrl: normalizePioneerBaseUrl(config.baseUrl),
    apiKey: config.apiKey,
    body,
  });
}

export function formatOpenAICompatibleError(config: API配置项, status: number, text: string): Error {
  if (isClineConfig(config)) {
    const hint = (() => {
      if (status === 401) return '请检查 Cline API Key；模型 ID 需要使用 provider/model 格式，例如 cline-pass/kimi-k3。';
      if (status === 402) return 'Cline 账户余额不足，请到 Cline 控制台充值或切换可用模型。';
      if (status === 403) return '当前 Cline API Key 没有访问所选模型的权限。';
      if (status === 404) return '请检查 Cline Base URL 是否为 https://api.cline.bot/api/v1，以及模型 ID 是否存在。';
      return '请检查 Cline Base URL、API Key、模型 ID 和账户额度。';
    })();
    return new Error(`Cline API Error ${status}: ${hint}\n${text}`);
  }
  if (isArkConfig(config)) {
    const lower = text.toLowerCase();
    const hint = (() => {
      if (lower.includes('modelnotopen') || lower.includes('model not open')) {
        return '火山方舟模型服务未开通，请到火山方舟控制台开通对应模型后再试。';
      }
      if (status === 401 || status === 403) return '请检查火山方舟 API Key、访问权限和模型服务是否已开通。';
      if (status === 404) return '请检查火山方舟模型 ID、Base URL 是否为 https://ark.cn-beijing.volces.com/api/v3。';
      return '请检查火山方舟 Base URL、模型 ID、API Key、余额和模型服务开通状态。';
    })();
    return new Error(`火山方舟 API Error ${status}: ${hint}\n${text}`);
  }
  if (isBaiduQianfanConfig(config)) {
    const model = config.model.trim();
    const normalized = normalizeOpenAICompatibleModel(config);
    const aliasHint = model && model !== normalized
      ? `已将模型名 ${model} 按百度千帆兼容规则归一为 ${normalized}；`
      : '';
    const lower = text.toLowerCase();
    const hint = (() => {
      if (status === 401 || status === 403) return '请检查百度千帆 API Key、账号权限和 Coding Plan 模型权限；如果错误码是 coding_plan_api_key_not_allowed，说明某个独立 API 仍在用 /v2，代理会自动补试 /v2/coding。';
      if (status === 404) return `${aliasHint}官方 GLM-5.1 的 model 参数接入点 ID 是 glm-5.1；Coding Plan Key 必须继续使用 /v2/coding，系统只会在该路径下尝试大小写别名。若仍 404，请检查该 API Key 的千帆模型列表是否实际包含 glm-5.1，或账号是否开通该模型。`;
      if (status === 400 && (lower.includes('model') || lower.includes('parameter') || lower.includes('1210'))) {
        return `${aliasHint}请优先确认模型 ID 填 glm-5.1；如果仍失败，说明当前千帆账号或 Coding Plan 对该模型/参数未开放。`;
      }
      return `${aliasHint}请检查百度千帆 Base URL、模型 ID、Key 与账号权限。`;
    })();
    return new Error(`百度千帆 API Error ${status}: ${hint}\n${text}`);
  }
  return new Error(`API Error ${status}: ${text}`);
}

export async function fetchWithApiErrorReport(
  config: API配置项,
  source: string,
  url: string,
  requestMode: 'stream' | 'non-stream' | 'models' | 'test' | 'unknown',
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error && typeof error === 'object') {
      (error as Error & { alreadyReportedByApiLayer?: boolean }).alreadyReportedByApiLayer = true;
    }
    void appendApiErrorReport({
      source,
      config,
      requestUrl: url,
      requestMode,
      error,
    });
    throw error;
  }
}

export async function errorText(response: Response): Promise<string> {
  return response.text().catch(() => '');
}

/**
 * 读取非流式响应体并解析 JSON。部分中转/“假流式”模型会在 HTTP 200 下返回字面量 undefined 等非 JSON 内容，
 * 直接 response.json() 会抛出难懂的 `"undefined" is not valid JSON`；这里统一给出可读错误并记入诊断。
 */
export async function readJsonResponseBody(
  response: Response,
  config: API配置项,
  url: string,
  source: string,
): Promise<unknown> {
  const raw = await response.text().catch(() => '');
  try {
    return JSON.parse(raw);
  } catch {
    const preview = raw.trim().slice(0, 200).replace(/\s+/g, ' ') || '（空响应）';
    const error = new Error(`接口返回了非 JSON 响应（HTTP ${response.status}）：${preview}`);
    (error as { alreadyReportedByApiLayer?: boolean }).alreadyReportedByApiLayer = true;
    void appendApiErrorReport({
      source,
      config,
      status: response.status,
      requestUrl: url,
      requestMode: 'non-stream',
      error,
      responseText: raw,
    });
    throw error;
  }
}

/** 调用方如需先做降级判断，先 errorText 再调用。 */
export function throwApiError(
  config: API配置项,
  source: string,
  url: string,
  requestMode: 'stream' | 'non-stream' | 'models' | 'test' | 'unknown',
  status: number,
  text: string,
  format: (status: number, text: string) => Error,
): Promise<never> {
  void appendApiErrorReport({ source, config, status, requestUrl: url, requestMode, responseText: text });
  throw format(status, text);
}

type OpenAICompatibleTransport = {
  url: string;
  upstreamUrl: string;
  headers: HeadersInit;
  body: string;
};

export function buildOpenAICompatibleTransport(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
  stream: boolean,
  includeUsage: boolean = true,
): OpenAICompatibleTransport {
  const isCline = isClineConfig(config);
  const upstreamBaseUrl = isArkConfig(config)
    ? normalizeArkBaseUrl(config.baseUrl)
    : isPioneerConfig(config)
      ? normalizePioneerBaseUrl(config.baseUrl)
      : isCline
        ? normalizeClineBaseUrl(config.baseUrl)
        : isMimoConfig(config)
          ? normalizeMimoBaseUrl(config.baseUrl)
          : config.baseUrl;
  const upstreamUrl = buildOpenAICompatibleChatUrl(upstreamBaseUrl);
  const requestBody = isCline
    ? buildClineRequestBody(config, messages, request, stream)
    : buildOpenAICompatibleRequestBody(config, messages, request, stream, includeUsage);
  const proxied = isArkConfig(config)
    ? { url: '/api/ark', body: buildArkProxyBody(config, requestBody) }
    : isBaiduQianfanConfig(config)
      ? { url: '/api/qianfan', body: buildQianfanProxyBody(config, requestBody) }
      : isPioneerConfig(config)
        ? { url: '/api/pioneer', body: buildPioneerProxyBody(config, requestBody) }
        : isCline
          ? { url: '/api/cline', body: buildClineProxyBody(config, requestBody) }
          : { url: upstreamUrl, body: JSON.stringify(requestBody) };
  return {
    ...proxied,
    upstreamUrl,
    headers: isMimoConfig(config)
      ? buildMimoAuthHeaders(config.apiKey)
      : { 'Content-Type': 'application/json', ...(proxied.url.startsWith('/api/') ? {} : { Authorization: `Bearer ${config.apiKey}` }) },
  };
}

export async function streamOpenAICompatible(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
  callbacks: StreamCallbacks,
  includeUsage: boolean = true,
): Promise<string> {
  const transport = buildOpenAICompatibleTransport(config, messages, request, true, includeUsage);
  const response = await fetchWithApiErrorReport(config, '聊天补全', transport.url, 'stream', {
    method: 'POST',
    headers: transport.headers,
    body: transport.body,
    signal: request.signal,
  });

  if (!response.ok) {
    const text = await errorText(response);
    if (includeUsage && isStreamUsageOptionUnsupported(response.status, text)) {
      console.warn('[token-usage] 当前流式接口不支持 stream_options.include_usage，已自动降级为不请求 usage 的流式请求。');
      return streamOpenAICompatible(config, messages, request, callbacks, false);
    }
    await throwApiError(config, '聊天补全', transport.upstreamUrl, 'stream', response.status, text,
      (status, responseText) => formatOpenAICompatibleError(config, status, responseText));
  }

  return runSseStream(response, {
    provider: 'openai',
    config,
    request,
    callbacks,
    extractText: readOpenAICompatibleStreamDelta,
  });
}
