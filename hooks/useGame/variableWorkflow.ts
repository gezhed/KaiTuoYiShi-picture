import type { UseGameStateReturn } from '@/hooks/useGameState';
import { callVariableModel, type NsfwBaselineCandidate } from '@/services/ai/variableModel';
import { parseVariableCommands, snapshotVariableState, reduceVariableCommands, commitVariableState, unpackVariableState } from '@/utils/variableExecutor';
import { factsToVariableCommands, parseVariableFacts } from '@/utils/variableFacts';
import { isTravelerPlayerAuthoredVariablePath } from '@/utils/variableRegistry';
import { needsNsfwBaseline } from '@/utils/npcArchiveEnrichment';
import type { NPC记录 } from '@/models/npc';
import {
  事实忽略哨兵键,
  派生变量批次结局,
  解析失败哨兵键,
  type 变量命令批次,
} from '@/models/variableCommand';
import {
  filterCommandsByAppliedFingerprints,
  listAppliedFingerprintsForTurn,
  variableStateFingerprint,
} from '@/utils/variableFingerprint';
import { compactVariableBatchHistory } from '@/utils/longSessionRetention';
import { applyNsfwVariablePolicy } from '@/utils/variableNsfwPolicy';
import { isWorkflowAbortError } from './workflowTransaction';
import { hasApiOverride, resolveApiConfig } from '@/services/apiConfig';
import { buildNpcLedgerUpdateDebug, type NpcLedgerUpdateDebug } from './npcLedgerWorkflow';
import type { TurnReceipt } from './turnReceipt';

interface VariableCalibrationParams {
  state: UseGameStateReturn;
  userInput: string;
  body: string;
  variableDraft?: string;
  receipt: Pick<TurnReceipt, 'turn' | 'assistantMessageId' | 'input'>;
  memorySystemSnapshot: import('@/models/memory').记忆系统;
  travelerSnapshot?: import('@/models/character').角色数据结构;
  worldSnapshot?: import('@/models/world').世界状态;
  signal?: AbortSignal;
  allowYiting?: boolean;
  shouldCommit?: () => boolean;
  queueTasksMirror?: UseGameStateReturn['queueTasks'];
  pathAwakeningTurn?: boolean;
  /**
   * 为真时本步不写任何 React 投影，由调用方在叶子写入成功后统一提交；失败或中止时调用方按捕获快照还原。
   */
  deferProjection?: boolean;
}

export interface VariableCalibrationOverrides {
  旅人?: import('@/models/character').角色数据结构;
  世界?: import('@/models/world').世界状态;
  记忆?: import('@/models/memory').记忆系统;
  忆庭?: import('@/models/yiting').忆庭系统;
  智库?: import('@/models/zhiku').智库系统;
  手机?: import('@/models/phone').手机系统;
  NPC?: import('@/models/npc').NPC记录[];
  新闻?: import('@/models/news').新闻条目[];
  剧情?: import('@/models/plot').剧情节点[];
  batch?: 变量命令批次;
  npcLedgerUpdate?: NpcLedgerUpdateDebug;
}

export interface VariableSettlementError extends Error {
  name: 'VariableSettlementError';
  alreadyReportedByApiLayer?: boolean;
}

export function createVariableSettlementError(
  message: string,
  options?: { cause?: unknown; alreadyReportedByApiLayer?: boolean },
): VariableSettlementError {
  const error = new Error(message) as VariableSettlementError;
  error.name = 'VariableSettlementError';
  if (options?.cause !== undefined) error.cause = options.cause;
  error.alreadyReportedByApiLayer = options?.alreadyReportedByApiLayer;
  return error;
}

export function isVariableSettlementError(value: unknown): value is VariableSettlementError {
  return value instanceof Error && value.name === 'VariableSettlementError';
}

export function buildVariableBatch(
  params: Pick<VariableCalibrationParams, 'receipt'> &
    Omit<变量命令批次, 'id' | 'turn' | 'targetMessageId' | 'timestamp'>,
): 变量命令批次 {
  const { receipt, ...batch } = params;
  return {
    ...batch,
    id: `vbatch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    turn: receipt.turn,
    targetMessageId: receipt.assistantMessageId,
    timestamp: Date.now(),
  };
}

export async function runVariableCalibrationStep(
  params: VariableCalibrationParams,
): Promise<VariableCalibrationOverrides | null> {
  const { state } = params;
  if (!state.deviceSettings.gameSettings.enableVariableUpdate) return null;
  if (!params.body.trim()) return null;

  const variableConfig = resolveApiConfig(state.deviceSettings.apiSettings, state.deviceSettings.gameSettings, 'variable');
  if (!variableConfig) return null;
  const overrodeAny = hasApiOverride(state.deviceSettings.gameSettings.variableApi);

  const stateSnapshot = snapshotVariableState({
    旅人: params.travelerSnapshot ?? state.旅人,
    世界: params.worldSnapshot ?? state.世界,
    记忆: params.memorySystemSnapshot,
    忆庭: state.忆庭,
    智库: state.智库,
    手机: state.手机,
    NPC: state.NPC,
    新闻: state.新闻,
    剧情: state.剧情,
  });

  try {
    const nsfwBaselineCandidates: NsfwBaselineCandidate[] = [];
    if (state.deviceSettings.gameSettings.enableNsfw) {
      const npcRecords = (stateSnapshot.NPC ?? []) as NPC记录[];
      for (const npc of npcRecords) {
        if (nsfwBaselineCandidates.length >= 2) break;
        if (needsNsfwBaseline(npc, undefined, {
          nsfwEnabled: true,
          maleNsfwArchiveEnabled: state.deviceSettings.gameSettings.enableMaleNsfwArchive,
        })) {
          nsfwBaselineCandidates.push({
            npcId: npc.id,
            npcName: npc.姓名 || npc.别名 || '',
            gender: npc.性别,
            appearance: typeof npc.外貌 === 'string' ? npc.外貌 : undefined,
            personality: typeof npc.性格 === 'string' ? npc.性格 : undefined,
            intro: typeof npc.介绍 === 'string' ? npc.介绍 : undefined,
          });
        }
      }
    }
    const { rawText } = await callVariableModel(variableConfig, {
      body: params.body,
      variableDraft: params.variableDraft,
      userInput: params.userInput,
      turnCount: params.receipt.turn,
      state: stateSnapshot,
      nsfwEnabled: state.deviceSettings.gameSettings.enableNsfw,
      maleNsfwArchiveEnabled: state.deviceSettings.gameSettings.enableMaleNsfwArchive,
      nsfwBaselineCandidates,
      signal: params.signal,
      retryCount: state.deviceSettings.gameSettings.variableApi.retryCount ?? 2,
      promptModules: state.deviceSettings.gameSettings.promptModules,
    });
    if (params.signal?.aborted || params.shouldCommit?.() === false) return null;

    // 须在模型返回后计算：整份状态的序列化否则会挡住模型请求。
    const baseStateFingerprint = await variableStateFingerprint(stateSnapshot);

    const parsedFacts = parseVariableFacts(rawText);
    const factCommands = factsToVariableCommands(parsedFacts.facts, stateSnapshot, params.receipt.turn, {
      phoneSeedsEnabled: state.deviceSettings.gameSettings.手机系统.enabled && state.deviceSettings.gameSettings.手机系统.autoGenerateSeeds && !params.pathAwakeningTurn,
      maxPhoneSeedsPerTurn: state.deviceSettings.gameSettings.手机系统.maxSeedsPerTurn,
    });
    const parsedLegacyCommands = parseVariableCommands(rawText);
    const filteredLegacyCommands = parsedLegacyCommands.commands.filter((command) => !isTravelerPlayerAuthoredVariablePath(command.key));
    const skippedTravelerProfileLegacyCount = parsedLegacyCommands.commands.length - filteredLegacyCommands.length;
    const commands = [...factCommands.commands, ...filteredLegacyCommands];
    const parseErrors = [
      ...parsedFacts.parseErrors.map((reason) => `变量事实：${reason}`),
      ...parsedLegacyCommands.parseErrors.map((reason) => `变量命令：${reason}`),
    ];
    const { allowedCommands, rejectedCommands } = applyNsfwVariablePolicy(commands, {
      nsfwEnabled: state.deviceSettings.gameSettings.enableNsfw,
      maleNsfwArchiveEnabled: state.deviceSettings.gameSettings.enableMaleNsfwArchive,
    }, stateSnapshot.NPC as NPC记录[]);
    const appliedFingerprints = listAppliedFingerprintsForTurn(
      state.variableBatches,
      params.receipt.turn,
      params.receipt.assistantMessageId,
    );
    const pending = await filterCommandsByAppliedFingerprints(allowedCommands, appliedFingerprints);
    const pendingCommands = pending.map((item) => item.command);
    const skippedAppliedCount = allowedCommands.length - pending.length;
    const { results, nextState } = reduceVariableCommands(pendingCommands, stateSnapshot);
    if (results.length !== pendingCommands.length) {
      throw new Error(`变量归约回执数量与命令数量不一致（${results.length}/${pendingCommands.length}）`);
    }
    if (params.signal?.aborted || params.shouldCommit?.() === false) return null;

    const errResults = parseErrors.map((reason) => ({
      command: { action: 'set' as const, key: 解析失败哨兵键, value: null },
      ok: false,
      kind: 'error' as const,
      reason,
    }));
    const warningResults = factCommands.warnings.map((reason) => ({
      command: { action: 'set' as const, key: 事实忽略哨兵键, value: null },
      ok: false,
      kind: 'warning' as const,
      reason,
    }));
    const rejectedResults = rejectedCommands.map((item) => ({ ...item, kind: 'rejected' as const }));
    // 回执与命令同序，指纹取自同一次计算。
    const commandResults = results.map((item, index) => ({
      ...item,
      kind: 'command' as const,
      commandFingerprint: pending[index].fingerprint,
    }));
    const allResults = [...errResults, ...warningResults, ...rejectedResults, ...commandResults];
    const npcLedgerUpdate = buildNpcLedgerUpdateDebug({
      facts: parsedFacts.facts,
      commands,
      results: allResults,
      warnings: [
        ...parseErrors,
        ...factCommands.warnings,
        ...rejectedCommands.map((item) => item.reason),
      ],
    });

    const batch = buildVariableBatch({
      receipt: params.receipt,
      source: overrodeAny ? 'calibration' : 'main',
      modelName: variableConfig.model,
      results: allResults,
      report: [
        `变量事实：${parsedFacts.facts.length} 条，生成内部命令 ${factCommands.commands.length} 条。`,
        filteredLegacyCommands.length ? `兼容旧命令：${filteredLegacyCommands.length} 条。` : '兼容旧命令：0 条。',
        skippedTravelerProfileLegacyCount ? `已静默忽略旅人核心档案旧命令：${skippedTravelerProfileLegacyCount} 条。` : '',
        skippedAppliedCount ? `已跳过的已落地命令：${skippedAppliedCount} 条（重跑幂等）。` : '',
        factCommands.warnings.length ? `事实警告：${factCommands.warnings.length} 条。` : '事实警告：0 条。',
        ...factCommands.notes,
      ].filter(Boolean).join('\n'),
      rawText,
      baseStateFingerprint,
      outcome: 派生变量批次结局(allResults),
    });
    if (params.shouldCommit?.() === false) return null;
    if (!params.deferProjection) {
      state.setVariableBatches((prev) => compactVariableBatchHistory([...prev, batch]));
    }

    if (params.signal?.aborted || params.shouldCommit?.() === false) return null;

    const anyApplied = results.some((r) => r.ok);
    const worldSelfHealed = nextState.世界 !== stateSnapshot.世界;
    if (!anyApplied && !worldSelfHealed) return { batch, npcLedgerUpdate };
    if (params.signal?.aborted || params.shouldCommit?.() === false) return null;

    // 传 stateSnapshot 作 initialState：commitVariableState 按引用过滤未改动的 root，
    // 避免覆盖玩家在校准这几秒里在 UI 上做的交互(比如点了「踏入命途狭间」)。
    if (!params.deferProjection) {
      commitVariableState(nextState, stateSnapshot, {
        set旅人: state.set旅人,
        set世界: state.set世界,
        set记忆: state.set记忆,
        set忆庭: params.allowYiting === false ? (() => {}) : state.set忆庭,
        set智库: state.set智库,
        set手机: state.set手机,
        setNPC: state.setNPC,
        set新闻: state.set新闻,
        set剧情: state.set剧情,
      });
    }

    return { ...unpackVariableState(nextState), batch, npcLedgerUpdate };
  } catch (err) {
    if (isWorkflowAbortError(err)) throw err;
    if (params.signal?.aborted || params.shouldCommit?.() === false) return null;
    const errorMessage = err instanceof Error ? err.message : typeof err === 'string' ? err : '变量模型校准失败。';
    throw createVariableSettlementError(errorMessage, {
      cause: err,
      alreadyReportedByApiLayer: Boolean(
        err && typeof err === 'object' && (err as { alreadyReportedByApiLayer?: boolean }).alreadyReportedByApiLayer,
      ),
    });
  }
}

export interface VariableProjectionSnapshot {
  旅人: UseGameStateReturn['旅人'];
  世界: UseGameStateReturn['世界'];
  记忆: UseGameStateReturn['记忆'];
  忆庭: UseGameStateReturn['忆庭'];
  智库: UseGameStateReturn['智库'];
  手机: UseGameStateReturn['手机'];
  NPC: UseGameStateReturn['NPC'];
  新闻: UseGameStateReturn['新闻'];
  剧情: UseGameStateReturn['剧情'];
  variableBatches: 变量命令批次[];
}

export function captureVariableProjectionSnapshot(state: UseGameStateReturn): VariableProjectionSnapshot {
  return {
    旅人: state.旅人,
    世界: state.世界,
    记忆: state.记忆,
    忆庭: state.忆庭,
    智库: state.智库,
    手机: state.手机,
    NPC: state.NPC,
    新闻: state.新闻,
    剧情: state.剧情,
    variableBatches: state.variableBatches,
  };
}

export function restoreVariableProjectionSnapshot(
  state: UseGameStateReturn,
  snapshot: VariableProjectionSnapshot,
): void {
  state.set旅人(snapshot.旅人);
  state.set世界(snapshot.世界);
  state.set记忆(snapshot.记忆);
  state.set忆庭(snapshot.忆庭);
  state.set智库(snapshot.智库);
  state.set手机(snapshot.手机);
  state.setNPC(snapshot.NPC);
  state.set新闻(snapshot.新闻);
  state.set剧情(snapshot.剧情);
  state.setVariableBatches(snapshot.variableBatches);
}

export function projectVariableCalibrationResult(params: {
  state: UseGameStateReturn;
  overrides: VariableCalibrationOverrides;
  batch: 变量命令批次;
  batchesAtStart: 变量命令批次[];
  allowYiting?: boolean;
}): void {
  const { state, overrides, batch, batchesAtStart } = params;
  const initialState = snapshotVariableState(state);
  const nextState = snapshotVariableState({
    旅人: overrides.旅人 ?? state.旅人,
    世界: overrides.世界 ?? state.世界,
    记忆: overrides.记忆 ?? state.记忆,
    忆庭: overrides.忆庭 ?? state.忆庭,
    智库: overrides.智库 ?? state.智库,
    手机: overrides.手机 ?? state.手机,
    NPC: overrides.NPC ?? state.NPC,
    新闻: overrides.新闻 ?? state.新闻,
    剧情: overrides.剧情 ?? state.剧情,
  });
  commitVariableState(nextState, initialState, {
    set旅人: state.set旅人,
    set世界: state.set世界,
    set记忆: state.set记忆,
    set忆庭: params.allowYiting === false ? (() => {}) : state.set忆庭,
    set智库: state.set智库,
    set手机: state.set手机,
    setNPC: state.setNPC,
    set新闻: state.set新闻,
    set剧情: state.set剧情,
  });
  state.setVariableBatches(compactVariableBatchHistory([...batchesAtStart, batch]));
}
