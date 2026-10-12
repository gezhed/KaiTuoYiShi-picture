import type { NPC账本选择结果 } from './npc';

export type 消息角色 = 'user' | 'assistant' | 'system';

/** 「本回合 user 发送之前」的变量切片快照，用于 reroll 回滚。只在最近一条 assistant message 上持久化，生成新 assistant 时清掉上一条的 snapshot，避免存档膨胀。 */
export interface 回合快照 {
  旅人: unknown;
  世界: unknown;
  记忆: unknown;
  忆庭?: unknown;
  智库?: unknown;
  手机?: unknown;
  NPC: unknown[];
  相册?: unknown;
  新闻: unknown[];
  剧情: unknown[];
  剧情编织?: unknown;
  variableBatches: unknown[];
  queueTasks?: unknown[];
  turnCount: number;
}

export interface 聊天消息 {
  id: string;
  role: 消息角色;
  content: string;
  timestamp: number;
  gameTime?: string;
  parsedResponse?: 解析后回复;
  inputTokens?: number;
  outputTokens?: number;
  tokenUsage?: 回合Token消耗;
  responseDurationSec?: number;
  isStreaming?: boolean;
  debugContext?: {
    systemPrompt: string;
    messages: Array<{ role: 消息角色; content: string }>;
    recallPreview?: string;
    recallSummary?: string;
    recallFullContent?: string;
    deepSeekMainMode?: 'off' | 'standard' | 'lock_format';
    deepSeekCotFakeHistorySkipped?: boolean;
    deepSeekPrefixMode?: boolean;
    deepSeekProtocolIssues?: string[];
    deepSeekMainOriginalModel?: string;
    deepSeekMainAdaptedModel?: string;
    stV2Attempted?: boolean;
    stV2Used?: boolean;
    stV2FallbackReason?: string;
    rerollSimilarity?: number;
    rerollSimilarityRetried?: boolean;
    cachePrefixDiagnostics?: 缓存前缀诊断;
    mainRequestMode?: 'stream' | 'non-stream';
    yitingRecallPreview?: string;
    yitingRecallRawText?: string;
    yitingRecallUsedModel?: boolean;
    zhikuRecallPreview?: string;
    zhikuRecallInjection?: string;
    zhikuRecallRawText?: string;
    zhikuRecallUsedModel?: boolean;
    npcLedgerInjection?: {
      selectedNames: string[];
      skippedNames: Array<{ name: string; reason: string }>;
      injected: Array<{
        name: string;
        reason: string[];
        fields: string[];
        hasRecentInteraction: boolean;
        hasMustRemember: boolean;
        hasUnresolvedItems: boolean;
      }>;
    };
    npcLedgerUpdate?: {
      updatedNames: string[];
      memoryAppended: string[];
      ledgerFieldsUpdated: string[];
      summaryTriggered: string[];
      warnings: string[];
    };
    npcLedgerSelectionRaw?: NPC账本选择结果;
  };
  preTurnSnapshot?: 回合快照;
  narrativeImages?: 叙事插图[];
}

export interface 叙事插图 {
  id: string;
  dataUrl: string;
  type: 'scene' | 'character';
  kind?: 'snapshot' | 'scene' | 'character';
  prompt: string;
  negativePrompt?: string;
  description?: string;
  status: 'generating' | 'done' | 'failed';
  error?: string;
  assetId?: string;
}

export interface 缓存前缀诊断 {
  currentPromptTokens: number;
  previousPromptTokens?: number;
  commonPrefixChars: number;
  commonPrefixTokens: number;
  commonPrefixRate: number;
  firstDiffCurrentSection: string;
  firstDiffPreviousSection?: string;
  firstDiffCurrentExcerpt: string;
  firstDiffPreviousExcerpt?: string;
  changedTailTokens: number;
  largestChangedSections: Array<{
    label: string;
    tokens: number;
  }>;
}

export interface 回合Token消耗 {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  uncachedTokens?: number;
  cacheHitRate?: number;
  source: 'api' | 'estimate' | 'mixed';
  provider?: string;
  model?: string;
  usageFormat?: string;
  usagePath?: string;
  rawUsageKeys?: string[];
  cacheDiagnostic?: string;
  rawUsage?: unknown;
}

export interface 解析后回复 {
  thinking: string;
  body: string;
  memory: string;
  commands: Record<string, unknown>;
  worldEvents: string[];
  actionOptions: string[];
  variableDraft: string;
  storyPlan: string;
  /** 只是候选信号：只有正文背书后才能参与分段归档/跳段。 */
  storyAdvance?: { completed: boolean; targetSegment?: string; basis?: string };
  awakenInvite: string;
  awakenQuestions: string;
  awakenJudgement: string;
  /** 出题/评判回合对应的命途 ID；进行中狭间 在评判落地后会被清空，故单独落库。 */
  awakenPathId: string;
  rawText: string;
}

export function 创建空解析回复(): 解析后回复 {
  return {
    thinking: '',
    body: '',
    memory: '',
    commands: {},
    worldEvents: [],
    actionOptions: [],
    variableDraft: '',
    storyPlan: '',
    awakenInvite: '',
    awakenQuestions: '',
    awakenJudgement: '',
    awakenPathId: '',
    rawText: '',
  };
}

let messageCounter = 0;

export function 创建聊天消息(
  role: 消息角色,
  content: string,
  extra?: Partial<聊天消息>,
): 聊天消息 {
  return {
    id: `msg_${Date.now()}_${++messageCounter}`,
    role,
    content,
    timestamp: Date.now(),
    ...extra,
  };
}
