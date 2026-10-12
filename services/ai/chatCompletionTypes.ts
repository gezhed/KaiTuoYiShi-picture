import type { DeepSeekAttemptDiagnostics, DeepSeekRecoverySummary } from './deepSeekRecovery';
import type { 回合Token消耗 } from '@/models/chat';

export interface StreamCallbacks {
  onDelta: (delta: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
  onFinishReason?: (reason: string) => void;
}

export type ChatMessagePayload = { role: string; content: string; prefix?: boolean };


export interface ChatCompletionRequest {
  messages: ChatMessagePayload[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  topA?: number;
  minP?: number;
  repetitionPenalty?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxContext?: number;
  signal?: AbortSignal;
  onUsage?: (usage: ChatCompletionUsage) => void;
  prefixMode?: boolean;
  prefixContent?: string;
  deepSeekRecovery?: 'auto' | 'disabled';
  onDeepSeekRecovery?: (summary: DeepSeekRecoverySummary) => void;
  onResponseDiagnostics?: (diagnostics: DeepSeekAttemptDiagnostics) => void;
  /**
   * OpenAI 兼容的 `tools` 声明原样透传。
   *
   * 为什么需要：部分社区预设（智绘姬系）明确要求模型**只能用 toolcall 回复**，
   * 且预设里用 `%TOOL_NAME%` 指代工具名。不声明工具时模型会遵守「不要直出文本」，
   * 于是返回空内容且 `finishReason=stop`——看起来完全像模型没答，实际是我们没给工具。
   */
  tools?: unknown[];
  /**
   * OpenAI 兼容的 `tool_choice` 原样透传。
   *
   * 只给 `tools` 列表**不足以**让模型调用工具——它完全可以改成普通文本回复。
   * 预设明确要求「只用 toolcall 回复」时必须显式指定具体工具来强制。
   */
  toolChoice?: unknown;
  /** 关闭并行工具调用；顺序思考的场景下并行只会让结果不可预测。 */
  parallelToolCalls?: boolean;
}

export type ChatCompletionUsage = Partial<Omit<回合Token消耗, 'source'>> & {
  source: 'api';
};

export type CompatibleStreamTextState = {
  currentBlockIsThinking: boolean;
  sawReasoning: boolean;
};

export type UsageLike = Record<string, any>;
