import type { API配置项 } from '@/models/settings';
import { devLog } from '@/utils/devLog';
import type { ChatCompletionRequest, CompatibleStreamTextState, StreamCallbacks } from './chatCompletionTypes';
import { emitUsageFromResponse } from './chatCompletionUsage';

export function parseClaudeTextResponse(json: unknown): string {
  const data = json as { content?: Array<{ type?: string; text?: string } | null> };
  return (data.content ?? [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part?.text ?? '')
    .join('');
}

function hasReasoningPayload(value: unknown, depth = 0): boolean {
  if (depth > 8 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => hasReasoningPayload(item, depth + 1));
  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';
  if (record.thought === true || /^(thinking|reasoning|thinking_delta|reasoning_delta)$/i.test(type)) return true;
  for (const [key, child] of Object.entries(record)) {
    if (/^(reasoning(?:_content)?|thinking(?:_content)?)$/i.test(key) && child !== null && child !== undefined && child !== '') return true;
    if (hasReasoningPayload(child, depth + 1)) return true;
  }
  return false;
}

function readCompatibleTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => readCompatibleTextContent(part))
      .join('');
  }
  if (!content || typeof content !== 'object') return '';
  const part = content as Record<string, any>;
  const type = typeof part.type === 'string' ? part.type : '';
  if (part.thought === true || /^(thinking|reasoning|thinking_delta|reasoning_delta)$/i.test(type)) {
    return '';
  }
  if (typeof part.text === 'string') return part.text;
  if (typeof part.output_text === 'string') return part.output_text;
  if (typeof part.content === 'string') return part.content;
  if (Array.isArray(part.content)) return readCompatibleTextContent(part.content);
  return '';
}

// 顺序即优先级，不得调整。
const DELTA_TEXT_EXTRACTORS: Array<(parsed: Record<string, any>) => string> = [
  (p) => readCompatibleTextContent(p.choices?.[0]?.delta?.content),
  (p) => readCompatibleTextContent(p.choices?.[0]?.delta?.text),
  (p) => readCompatibleTextContent(p.choices?.[0]?.text),
  (p) => readCompatibleTextContent(p.delta?.text),
  (p) => readCompatibleTextContent(p.delta?.content),
  (p) => readCompatibleTextContent(p.delta),
  (p) => parseOpenCodeGeminiText(p),
  (p) => readCompatibleTextContent(p.output_text),
  (p) => readCompatibleTextContent(p.text),
  (p) => readCompatibleTextContent(p.content),
];

export function readOpenAICompatibleStreamDelta(parsed: any, state: CompatibleStreamTextState): string {
  const streamState = state;
  if (hasReasoningPayload(parsed)) streamState.sawReasoning = true;
  if (parsed?.type === 'content_block_start') {
    const blockType = parsed.content_block?.type;
    streamState.currentBlockIsThinking = blockType === 'thinking' || blockType === 'reasoning';
    if (streamState.currentBlockIsThinking) return '';
    return readCompatibleTextContent(parsed.content_block?.text ?? parsed.content_block?.content ?? parsed.content_block);
  }
  if (parsed?.type === 'content_block_delta') {
    const deltaType = parsed.delta?.type;
    if (deltaType === 'thinking_delta' || deltaType === 'reasoning_delta' || streamState.currentBlockIsThinking) return '';
    return readCompatibleTextContent(parsed.delta?.text ?? parsed.delta?.content ?? parsed.delta);
  }
  if (parsed?.type === 'content_block_stop') {
    streamState.currentBlockIsThinking = false;
    return '';
  }
  if (
    parsed?.type === 'response.output_text.delta' ||
    parsed?.type === 'response.text.delta' ||
    parsed?.type === 'response.content_part.delta'
  ) {
    return readCompatibleTextContent(parsed.delta?.text ?? parsed.delta ?? parsed.text);
  }

  const choice = parsed?.choices?.[0];
  const delta = choice?.delta;
  if (delta?.type === 'thinking_delta' || delta?.type === 'reasoning_delta' || delta?.thought === true) {
    return '';
  }
  for (const extract of DELTA_TEXT_EXTRACTORS) {
    const text = extract(parsed);
    if (text) return text;
  }
  return '';
}

function readFinishReason(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const data = parsed as {
    choices?: Array<{ finish_reason?: unknown }>;
    type?: string;
    delta?: { stop_reason?: unknown };
    stop_reason?: unknown;
    candidates?: Array<{ finishReason?: unknown }>;
  };
  const choice = data.choices?.at(0);
  if (choice && typeof choice.finish_reason === 'string' && choice.finish_reason) {
    return choice.finish_reason;
  }
  if (data.type === 'message_delta') {
    const stopReason = data.delta?.stop_reason;
    if (typeof stopReason === 'string' && stopReason) return stopReason;
  }
  if (typeof data.stop_reason === 'string' && data.stop_reason) {
    return data.stop_reason;
  }
  const candidate = data.candidates?.at(0);
  if (candidate && typeof candidate.finishReason === 'string' && candidate.finishReason) {
    return candidate.finishReason;
  }
  return undefined;
}

/**
 * 从 `tool_calls` 的参数里取出正文。
 *
 * 智绘姬系预设明确要求「不要 Text/Content 直出，改用 toolcall 回复」，
 * 于是模型的可见文本是**空**的，正文全在 `tool_calls[0].function.arguments` 里
 * （形如 `{"thought_and_context":"…"}`）。只读 `content` 就会把它当成空回——
 * 实测 `finishReason=stop` 且正文为空，正是这种情况。
 *
 * 字段按上游 `fields` 的默认顺序取：`thought_and_context` → `thought` → `content`；
 * 都取不到时退回整个 arguments 字符串，宁可多给也不要丢内容。
 */
function readToolCallText(choice: unknown): string {
  const 记录 = choice as { message?: { tool_calls?: unknown }; tool_calls?: unknown } | undefined;
  const 调用列表 = 记录?.message?.tool_calls ?? 记录?.tool_calls;
  if (!Array.isArray(调用列表) || 调用列表.length === 0) return '';

  const 片段: string[] = [];
  for (const 调用 of 调用列表) {
    const 参数 = (调用 as { function?: { arguments?: unknown } })?.function?.arguments;
    if (typeof 参数 === 'string' && 参数.trim()) {
      片段.push(从参数串取正文(参数));
    } else if (参数 && typeof 参数 === 'object') {
      片段.push(从参数对象取正文(参数 as Record<string, unknown>));
    }
  }
  return 片段.filter((项) => 项.trim().length > 0).join('\n');
}

function 从参数串取正文(原始: string): string {
  try {
    return 从参数对象取正文(JSON.parse(原始) as Record<string, unknown>);
  } catch {
    // 参数不是合法 JSON 时整串当作正文，避免丢内容。
    return 原始;
  }
}

function 从参数对象取正文(参数: Record<string, unknown>): string {
  for (const 键 of ['thought_and_context', 'thought', 'content', 'text']) {
    const 值 = 参数[键];
    if (typeof 值 === 'string' && 值.trim()) return 值;
  }
  const 全部 = Object.values(参数).filter((项): 项 is string => typeof 项 === 'string' && 项.trim().length > 0);
  return 全部.join('\n');
}

export function parseOpenAICompatibleTextResponse(json: unknown): string {
  const data = json as {
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
    message?: { content?: unknown };
    output_text?: unknown;
    text?: unknown;
    content?: unknown;
  };
  const choice = data.choices?.at(0);
  return (
    readCompatibleTextContent(choice?.message?.content) ||
    readToolCallText(choice) ||
    readCompatibleTextContent(choice?.text) ||
    readCompatibleTextContent(data.message?.content) ||
    parseClaudeTextResponse(json) ||
    parseOpenCodeResponsesText(json) ||
    parseOpenCodeGeminiText(json) ||
    readCompatibleTextContent(data.output_text) ||
    readCompatibleTextContent(data.text) ||
    readCompatibleTextContent(data.content)
  );
}

export function reportOpenAICompatibleDiagnostics(
  json: unknown,
  text: string,
  config: API配置项,
  request: ChatCompletionRequest,
): void {
  request.onResponseDiagnostics?.({
    sawReasoning: hasReasoningPayload(json),
    sawVisibleContent: text.trim().length > 0,
    finishReason: readFinishReason(json),
    selectedModel: config.model,
    响应结构: 描述响应结构(json),
    请求最大输出: request.maxTokens ?? config.maxTokens,
  });
}

/**
 * 只描述**键结构与是否为空**，不装原始正文（正文可能几十 KB，进日志会拖垮界面）。
 * 空回排查需要的正是这几个字段的存在性与取值，而不是内容本身。
 */
export function 描述响应结构(json: unknown, 深度 = 0): string {
  if (深度 > 3) return '…';
  if (Array.isArray(json)) {
    return json.length === 0 ? '[]' : `[${json.length}× ${描述响应结构(json[0], 深度 + 1)}]`;
  }
  if (!json || typeof json !== 'object') {
    if (typeof json === 'string') return json.trim() ? `"${json.length}字"` : '空串';
    return String(json);
  }
  const 记录 = json as Record<string, unknown>;
  const 片段 = Object.entries(记录).map(([键, 值]) => {
    if (值 === null) return `${键}=null`;
    if (typeof 值 === 'string') {
      // 短串直接给值（`finish_reason=stop` 这种是关键信息），长串只给长度避免刷屏。
      return 值.length <= 40 ? `${键}=${JSON.stringify(值)}` : `${键}="…${值.length}字"`;
    }
    if (typeof 值 !== 'object') return `${键}=${String(值)}`;
    return `${键}=${描述响应结构(值, 深度 + 1)}`;
  });
  return `{${片段.join(', ')}}`;
}

async function readSseTextStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: {
    provider: string;
    config: API配置项;
    request: ChatCompletionRequest;
    extractText: (parsed: unknown) => string;
    onDelta: (text: string) => void;
    onFinishReason?: (reason: string) => void;
  },
): Promise<string> {
  const { provider, config, request, extractText, onDelta, onFinishReason } = options;
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';
  let skippedMalformedLines = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        let parsed: ReturnType<JSON['parse']>;
        try {
          parsed = JSON.parse(data);
        } catch {
          skippedMalformedLines += 1;
          continue;
        }
        emitUsageFromResponse(parsed, config, request);
        const text = extractText(parsed);
        if (text) {
          fullText += text;
          onDelta(text);
        }
        const fr = readFinishReason(parsed);
        if (fr) onFinishReason?.(fr);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (skippedMalformedLines > 0) {
    devLog('net', 'sse-skip-malformed-lines', { provider, count: skippedMalformedLines });
  }
  return fullText;
}

export async function runSseStream(
  response: Response,
  options: {
    provider: string;
    config: API配置项;
    request: ChatCompletionRequest;
    callbacks: StreamCallbacks;
    extractText: (parsed: any, state: CompatibleStreamTextState) => string;
  },
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');
  const state: CompatibleStreamTextState = { currentBlockIsThinking: false, sawReasoning: false };
  let finishReason: string | undefined;
  const fullText = await readSseTextStream(reader, {
    provider: options.provider,
    config: options.config,
    request: options.request,
    extractText: (parsed) => options.extractText(parsed, state),
    onDelta: (text) => options.callbacks.onDelta(text),
    onFinishReason: (fr) => {
      finishReason = fr;
      options.callbacks.onFinishReason?.(fr);
    },
  });
  options.request.onResponseDiagnostics?.({
    sawReasoning: state.sawReasoning,
    sawVisibleContent: fullText.trim().length > 0,
    finishReason,
    selectedModel: options.config.model,
  });
  options.callbacks.onDone();
  return fullText;
}

export function parseOpenCodeResponsesText(json: unknown): string {
  const data = json as {
    output_text?: string;
    text?: string;
    choices?: Array<{ message?: { content?: string } }>;
    output?: Array<{
      content?: Array<{ type?: string; text?: string; content?: string } | null>;
    }>;
  };
  if (typeof data.output_text === 'string') return data.output_text;
  if (typeof data.text === 'string') return data.text;
  const fromOutput = (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part?.type === 'output_text' || part?.type === 'text' || typeof part?.text === 'string')
    .map((part) => part?.text ?? part?.content ?? '')
    .join('');
  if (fromOutput) return fromOutput;
  return readCompatibleTextContent(data.choices?.[0]?.message?.content);
}

export function parseOpenCodeGeminiText(json: unknown): string {
  const data = json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
  return (data.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('');
}
