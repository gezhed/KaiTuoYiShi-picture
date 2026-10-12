import { DEEPSEEK_FINAL_CONTENT_GUARD, executeWithDeepSeekRecovery } from './deepSeekRecovery';
import type { DeepSeekAttemptDiagnostics } from './deepSeekRecovery';
import type { API配置项 } from '@/models/settings';
import { completionClaudeNonStream, streamClaude } from './chatCompletionClaude';
import { streamGemini } from './chatCompletionGemini';
import { buildOpenAICompatibleTransport, errorText, fetchWithApiErrorReport, formatOpenAICompatibleError, readJsonResponseBody, streamOpenAICompatible, throwApiError } from './chatCompletionOpenAICompat';
import { completionOpenCodeNonStream, streamOpenCode } from './chatCompletionOpenCode';
import { buildMessages, detectProvider, isDeepSeekPrefixUnsupportedError, mergePrefixResult, stripDeepSeekPrefixMessages, withPrefixMessages } from './chatCompletionProvider';
import { parseOpenAICompatibleTextResponse, reportOpenAICompatibleDiagnostics } from './chatCompletionStream';
import type { ChatCompletionRequest, StreamCallbacks } from './chatCompletionTypes';
import { emitUsageFromResponse } from './chatCompletionUsage';
export type { StreamCallbacks, ChatCompletionRequest, ChatCompletionUsage } from './chatCompletionTypes';

export async function chatCompletion(
  config: API配置项,
  request: ChatCompletionRequest,
  callbacks: StreamCallbacks,
): Promise<string> {
  const recovered = await executeWithDeepSeekRecovery(config, {
    disabled: request.deepSeekRecovery === 'disabled',
    maxTokens: request.maxTokens ?? config.maxTokens,
    onSummary: request.onDeepSeekRecovery,
    execute: async (attemptConfig, attemptOptions) => {
      let reported = false;
      let finishReason: string | undefined;
      let diagnostics: DeepSeekAttemptDiagnostics = {
        sawReasoning: false,
        sawVisibleContent: false,
        selectedModel: attemptConfig.model,
      };
      const reportDiagnostics = (next: DeepSeekAttemptDiagnostics): void => {
        reported = true;
        diagnostics = next;
      };
      const messages = attemptOptions.appendRecoveryInstruction
        ? [...request.messages, { role: 'user', content: DEEPSEEK_FINAL_CONTENT_GUARD }]
        : request.messages;
      const attemptRequest: ChatCompletionRequest = {
        ...request,
        messages,
        maxTokens: attemptOptions.maxTokens,
        deepSeekRecovery: 'disabled',
        onResponseDiagnostics: reportDiagnostics,
      };
      const text = await chatCompletionOnce(attemptConfig, attemptRequest, {
        onDelta: callbacks.onDelta,
        onDone: () => {},
        onError: callbacks.onError,
        onFinishReason: (reason) => { finishReason = reason; },
      });
      if (!reported) {
        diagnostics = {
          sawReasoning: false,
          sawVisibleContent: text.trim().length > 0,
          finishReason,
          selectedModel: attemptConfig.model,
        };
      } else if (!diagnostics.finishReason && finishReason) {
        diagnostics = { ...diagnostics, finishReason };
      }
      return { text, diagnostics };
    },
  });

  if (recovered.diagnostics.finishReason) {
    callbacks.onFinishReason?.(recovered.diagnostics.finishReason);
  }
  request.onResponseDiagnostics?.(recovered.diagnostics);
  callbacks.onDone();
  return recovered.text;
}
async function chatCompletionOnce(
  config: API配置项,
  request: ChatCompletionRequest,
  callbacks: StreamCallbacks,
): Promise<string> {
  const provider = detectProvider(config);
  const msgs = buildMessages(request.systemPrompt, request.messages);

  if (provider === 'mimo') {
    return streamOpenAICompatible(config, msgs, request, callbacks);
  }
  if (provider === 'opencode') {
    return streamOpenCode(config, msgs, request, callbacks);
  }
  if (provider === 'deepseek') {
    const payload = withPrefixMessages(config, msgs, request);
    try {
      const text = await streamOpenAICompatible(payload.config, payload.messages, request, callbacks);
      return mergePrefixResult(payload.prefix, text);
    } catch (error) {
      if (payload.prefix && isDeepSeekPrefixUnsupportedError(error)) {
        console.warn('[DeepSeek Prefix] 当前接口不支持 prefix，已自动降级为标准模式。', error);
        return streamOpenAICompatible(config, stripDeepSeekPrefixMessages(msgs), { ...request, prefixMode: false }, callbacks);
      }
      throw error;
    }
  }
  if (provider === 'claude') {
    return streamClaude(config, msgs, request, callbacks);
  }
  if (provider === 'gemini') {
    return streamGemini(config, msgs, request, callbacks);
  }
  return streamOpenAICompatible(config, msgs, request, callbacks);
}
export async function chatCompletionNonStream(
  config: API配置项,
  request: ChatCompletionRequest,
): Promise<string> {
  const recovered = await executeWithDeepSeekRecovery(config, {
    disabled: request.deepSeekRecovery === 'disabled',
    maxTokens: request.maxTokens ?? config.maxTokens,
    onSummary: request.onDeepSeekRecovery,
    execute: async (attemptConfig, attemptOptions) => {
      let reported = false;
      let diagnostics: DeepSeekAttemptDiagnostics = {
        sawReasoning: false,
        sawVisibleContent: false,
        selectedModel: attemptConfig.model,
      };
      const messages = attemptOptions.appendRecoveryInstruction
        ? [...request.messages, { role: 'user', content: DEEPSEEK_FINAL_CONTENT_GUARD }]
        : request.messages;
      const text = await chatCompletionNonStreamOnce(attemptConfig, {
        ...request,
        messages,
        maxTokens: attemptOptions.maxTokens,
        deepSeekRecovery: 'disabled',
        onResponseDiagnostics: (next) => {
          reported = true;
          diagnostics = next;
        },
      });
      if (!reported) {
        diagnostics = {
          sawReasoning: false,
          sawVisibleContent: text.trim().length > 0,
          selectedModel: attemptConfig.model,
        };
      }
      return { text, diagnostics };
    },
  });
  request.onResponseDiagnostics?.(recovered.diagnostics);
  return recovered.text;
}
async function chatCompletionNonStreamOnce(
  config: API配置项,
  request: ChatCompletionRequest,
): Promise<string> {
  const provider = detectProvider(config);
  const msgs = buildMessages(request.systemPrompt, request.messages);

  if (provider === 'opencode') {
    return completionOpenCodeNonStream(config, msgs, request);
  }
  if (provider === 'claude') {
    return completionClaudeNonStream(config, msgs, request);
  }
  if (provider === 'gemini') {
    return chatCompletionOnce(config, request, {
      onDelta: () => {},
      onDone: () => {},
      onError: () => {},
    });
  }

  const deepSeekPayload = provider === 'deepseek'
    ? withPrefixMessages(config, msgs, request)
    : { config, messages: msgs, prefix: '' };

  const transport = buildOpenAICompatibleTransport(deepSeekPayload.config, deepSeekPayload.messages, request, false);
  const response = await fetchWithApiErrorReport(deepSeekPayload.config, '非流式补全', transport.url, 'non-stream', {
    method: 'POST',
    headers: transport.headers,
    body: transport.body,
    signal: request.signal,
  });

  if (!response.ok) {
    const text = await errorText(response);
    const error = formatOpenAICompatibleError(deepSeekPayload.config, response.status, text);
    if (deepSeekPayload.prefix && isDeepSeekPrefixUnsupportedError(error)) {
      console.warn('[DeepSeek Prefix] 当前接口不支持 prefix，已自动降级为标准模式。', error);
      return chatCompletionNonStreamOnce(config, {
        ...request,
        prefixMode: false,
        prefixContent: undefined,
      });
    }
    await throwApiError(deepSeekPayload.config, '非流式补全', transport.upstreamUrl, 'non-stream', response.status, text,
      (status, responseText) => formatOpenAICompatibleError(deepSeekPayload.config, status, responseText));
  }

  const json = await readJsonResponseBody(response, deepSeekPayload.config, transport.upstreamUrl, '非流式补全');
  emitUsageFromResponse(json, deepSeekPayload.config, request);
  const text = parseOpenAICompatibleTextResponse(json);
  reportOpenAICompatibleDiagnostics(json, text, deepSeekPayload.config, request);
  return mergePrefixResult(deepSeekPayload.prefix, text);
}
