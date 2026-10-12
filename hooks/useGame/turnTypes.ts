import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { API配置项, DeepSeek主剧情模式 } from '@/models/settings';
import type { 聊天消息, 回合快照 } from '@/models/chat';
import type { 新闻条目 } from '@/models/news';
import type { 世界状态 } from '@/models/world';
import type { 角色数据结构 } from '@/models/character';
import type { 记忆系统 } from '@/models/memory';
import type { 忆庭系统 } from '@/models/yiting';
import type { 手机系统 } from '@/models/phone';
import type { NPC记录, NPC账本选择结果 } from '@/models/npc';
import type { 智库系统 } from '@/models/zhiku';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import type { 相册系统 } from '@/models/imageGeneration';
import type { 解析后回复 } from '@/models/chat';
import type { MacroContext } from '@/utils/macroEngine';
import type { 忆庭召回结果 } from '@/services/yitingRetrieval';
import type { 智库检索结果 } from '@/services/zhikuRetrieval';
import type { 剧情编织门禁快照, 剧情编织注入诊断 } from '@/services/storyWeaving';
import type { 世界事实视图 } from '@/services/storyFactConsumerView';
import type { STPresetEntryV2 } from '@/models/stTypes';
import type { ChatModuleMessage } from './promptAssembly';
import type { VariableCalibrationOverrides } from './variableWorkflow';
import type { TurnReceipt } from './turnReceipt';

export interface WorkflowSendCallbacks {
  getActiveConfig: () => API配置项 | null;
  onBeforeSend?: () => void;
  onAfterSend?: () => void;
  rerollContext?: { nonce: string; previousResponse: string } | null;
}

export interface TurnContext {
  state: UseGameStateReturn;
  userInput: string;
  deps: WorkflowSendCallbacks;
  config: API配置项;
  mainStoryConfig: API配置项;
  isOpeningSystemTrigger: boolean;
  isAwakeningEnterTrigger: boolean;
  awakeningPathId: string | undefined;
  awakeningInstruction: string;
  openingInstruction: string;
  effectiveWorld: 世界状态;
  worldAtStart: 世界状态;
  travelerAtStart: 角色数据结构;
  zhikuAtStart: 智库系统;
  phoneAtStart: 手机系统;
  turnCountAtStart: number;
  variableBatchesAtStart: UseGameStateReturn['variableBatches'];
  queueTasksMirror: UseGameStateReturn['queueTasks'];

  abortController: AbortController;
  isCurrentWorkflow: () => boolean;
  assertWorkflowActive: () => void;
  streamMessageSetter: ReturnType<typeof import('@/utils/rafCoalescedSetter').createRafCoalescedSetter>;

  rollbackSnapshotOnAbort: 回合快照 | null;
}

export interface TurnDeltas {
  preTurnSnapshot?: 回合快照;
  userMsg?: 聊天消息;
  updatedHistory?: 聊天消息[];

  awakeningPhase?: 'question' | 'judgement' | undefined;
  isPathAwakeningTurn?: boolean;
  currentTriggerType?: 'swipe' | 'opening' | 'normal';
  macroCtx?: MacroContext;
  macroGlobalVarsAfterTurn?: Record<string, string>;
  worldbookTriggerStatesAfterTurn?: Record<string, number>;
  openingNewsPreprocessed?: boolean;
  openingNewsForSave?: 新闻条目[] | null;
  yitingPreview?: 忆庭召回结果 | null;
  zhikuPreview?: 智库检索结果 | null;
  yitingEnabled?: boolean;
  yitingRecallEnabled?: boolean;
  zhikuRecallEnabled?: boolean;
  storyWeavingGate?: 剧情编织门禁快照 | null;
  storyWeavingDiagnostics?: 剧情编织注入诊断 | null;
  npcLedgerSelection?: NPC账本选择结果;
  recallSummaryForTurn?: string;
  recallFullContentForTurn?: string;

  chatModuleMessages?: ChatModuleMessage[];

  systemPrompt?: string;
  apiMessages?: 聊天消息[];
  tavernV2Messages?: 聊天消息[] | null;
  tavernV2Error?: Error | null;
  shouldTryTavernV2?: boolean;

  deepSeekMainActive?: boolean;
  deepSeekLockFormat?: boolean;
  deepSeekMainMode?: DeepSeek主剧情模式;
  effectivePrefixMode?: boolean;
  effectivePrefixContent?: string;
  mainRequestMode?: 'stream' | 'non-stream';
  maxAttempts?: number;
  currentPresetV2ForStage?: STPresetEntryV2 | null;

  rawFullText?: string;
  displayText?: string;
  parsedForDisplay?: 解析后回复 | null;
  deepSeekProtocolIssuesForTurn?: string[];
  rerollSimilarityForTurn?: number | undefined;
  rerollSimilarityRetried?: boolean;

  aiMsg?: 聊天消息;
  finalHistory?: 聊天消息[];
  receipt?: TurnReceipt;

  mem?: 记忆系统;
  yitingWithCompression?: 忆庭系统;

  worldAfter?: 世界状态;
  travelerAfter?: 角色数据结构;

  variableOverrides?: VariableCalibrationOverrides | null;
  pendingVariableStarted?: boolean;

  npcAfterCompression?: NPC记录[];

  storyWeavingForSave?: 剧情编织系统 | null;
  memoryAfterStoryProgress?: 记忆系统 | null;
  storyProgressMemoryLine?: string;
  zhikuAfterRuntimeUnlock?: 智库系统 | null;
  worldFactView?: 世界事实视图 | null;
  worldFactEvidence?: string[] | null;

  newsAfterGeneration?: 新闻条目[] | null;
  yitingAfterTurnRecall?: 忆庭系统;
  phoneAfterFallbackSeed?: 手机系统;
  finalHistoryForSave?: 聊天消息[];
  相册After?: 相册系统;

}

type TurnAfterReplyFields = 'aiMsg' | 'finalHistory' | 'receipt' | 'parsedForDisplay' | 'displayText';
export type TurnAfterReply = Omit<TurnDeltas, TurnAfterReplyFields> & {
  [K in TurnAfterReplyFields]-?: NonNullable<TurnDeltas[K]>;
};

export function requireTurnAfterReply(d: TurnDeltas): TurnAfterReply {
  if (!d.aiMsg || !d.finalHistory || !d.receipt || !d.parsedForDisplay || typeof d.displayText !== 'string') {
    throw new Error('回合结算必须先完成回复落地。');
  }
  return d as TurnAfterReply;
}
