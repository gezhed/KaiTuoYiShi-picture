import type { TurnContext, TurnDeltas } from './turnTypes';
import type { 聊天消息 } from '@/models/chat';
import type { 新闻条目 } from '@/models/news';
import type { 忆庭系统 } from '@/models/yiting';
import type { 手机系统 } from '@/models/phone';
import type { 相册系统 } from '@/models/imageGeneration';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import type { 记忆系统设置, 星际和平周报设置, 文生图系统设置 } from '@/models/settings';
import type { YitingArchiveSource } from '@/services/yitingArchive';
import type { 忆庭召回结果 } from '@/services/yitingRetrieval';
import { buildRecentTurnWindowForNews, runNewsGenerationStep } from './newsWorkflow';
import { 构造世界事实视图, type 世界事实视图 } from '@/services/storyFactConsumerView';
import { buildYitingArchiveEntry } from '@/services/yitingArchive';
import { resolveApiConfig } from '@/services/apiConfig';
import { buildFallbackPhoneSeed } from './phoneWorkflow';
import { 生成消息插图 } from './illustrationWorkflow';
import { pushQueueTask } from './workflowTaskRuntime';
import { isMemorySystemNoise, upsertRecallEntry } from './memoryUtils';
import { 创建默认记忆系统设置 } from '@/models/settings';
import { devLog } from '@/utils/devLog';

interface NewsJobParams {
  newsSettings: 星际和平周报设置 | undefined;
  worldFactView?: 世界事实视图 | null;
  shouldRunNews: boolean;
  newsInterval: number;
  shouldRunOpeningNews: boolean;
  state: TurnContext['state'];
  displayText: string;
  userInput: string;
  finalHistory: 聊天消息[];
  storyWeavingForSave: 剧情编织系统;
  abortController: AbortController;
  isCurrentWorkflow: () => boolean;
  assertWorkflowActive: () => void;
  turnCountAtStart: number;
  queueTasksMirror: TurnContext['queueTasksMirror'];
}
interface NewsJobResult { newsAfterGeneration: 新闻条目[] | null; }

interface YitingJobParams {
  turnRecallSource: YitingArchiveSource;
  memorySettings: 记忆系统设置;
  abortController: AbortController;
  state: TurnContext['state'];
  yitingBase: 忆庭系统;
  yitingPreview: 忆庭召回结果 | null;
  yitingEnabled: boolean;
  yitingRecallEnabled: boolean;
  assertWorkflowActive: () => void;
  turnCountAtStart: number;
  queueTasksMirror: TurnContext['queueTasksMirror'];
}
interface YitingJobResult { yitingAfterTurnRecall: 忆庭系统; }

interface PhoneJobParams {
  state: TurnContext['state'];
  phoneAfterFallbackSeed: 手机系统;
  npcAfterCompression: NonNullable<TurnDeltas['npcAfterCompression']>;
  userInput: string;
  displayText: string;
  skipPhoneSeeds: boolean;
  turnCountAtStart: number;
  queueTasksMirror: TurnContext['queueTasksMirror'];
}
interface PhoneJobResult { phoneAfterFallbackSeed: 手机系统; }

interface NarrativeJobParams {
  state: TurnContext['state'];
  aiMsg: 聊天消息;
  displayText: string;
  abortController: AbortController;
  finalHistory: 聊天消息[];
  assertWorkflowActive: () => void;
  turnCountAtStart: number;
  queueTasksMirror: TurnContext['queueTasksMirror'];
}
interface NarrativeJobResult { finalHistoryForSave: 聊天消息[]; 相册After?: 相册系统; }

/**
 * 正文自动配图的准入判断。
 *
 * 抽成纯函数是为了能直接测：它有三个条件（总开关、正文配图开关、模式是否为 auto），
 * 任何一个不满足都会**静默返回**，用户看到的就是「自动生图模式没有去请求生图」。
 * 所以这里除了给出结论，还要给出**原因**，让调用方把原因报到队列里，而不是让人猜。
 */
export function 判定正文配图门禁(
  文生图系统: 文生图系统设置 | undefined,
): { 放行: boolean; 原因?: string } {
  if (!文生图系统) return { 放行: false, 原因: '还没有文生图系统设置。' };
  if (!文生图系统.启用) return { 放行: false, 原因: '文生图总开关没有打开。' };
  const 正文配图 = 文生图系统.正文配图;
  if (!正文配图) return { 放行: false, 原因: '缺少正文配图设置。' };
  if (!正文配图.启用) return { 放行: false, 原因: '「正文自动配图」没有打开。' };
  if (正文配图.模式 !== 'auto') return { 放行: false, 原因: '正文配图当前是手动模式，自动生图不会触发。' };
  return { 放行: true };
}

function 合并忆庭系统(base: 忆庭系统, override?: 忆庭系统): 忆庭系统 {
  if (!override) return base;
  const merged = [...base.回忆档案];
  for (const entry of override.回忆档案) {
    if (!merged.some((item) => item.id === entry.id)) {
      merged.push(entry);
    }
  }
  return { ...override, 回忆档案: merged };
}

async function runNewsBackgroundJob(p: NewsJobParams): Promise<NewsJobResult> {
  if (!p.newsSettings?.enabled || !p.newsSettings.autoGenerate) {
    pushQueueTask(p.state, 'news', 'skipped', {
      detail: '星际和平周报未开启，已跳过。',
    }, p.turnCountAtStart, p.queueTasksMirror);
    return { newsAfterGeneration: null };
  }
  if (!p.shouldRunNews) {
    pushQueueTask(p.state, 'news', 'skipped', {
      detail: `未到新闻触发间隔（每 ${p.newsInterval} 回合一次），已跳过。`,
    }, p.turnCountAtStart, p.queueTasksMirror);
    return { newsAfterGeneration: null };
  }
  pushQueueTask(p.state, 'news', 'pending', {
    detail: p.shouldRunOpeningNews
      ? '开局首回合正在先处理一次星际和平周报。'
      : `正在调用星际和平周报独立 API（读取最近 ${p.newsInterval} 回合）。`,
    cancellable: true,
  }, p.turnCountAtStart, p.queueTasksMirror);
  const newsGenerationResult = await runNewsGenerationStep({
    state: p.state,
    traveler: p.state.旅人,
    world: p.state.世界,
    news: p.state.新闻,
    npcRecords: p.state.NPC,
    plotNodes: p.state.剧情,
    storyWeaving: p.state.剧情编织,
    turnCountAtStart: p.turnCountAtStart,
    mainBody: p.displayText,
    userInput: p.userInput,
    recentTurns: buildRecentTurnWindowForNews(p.finalHistory, p.userInput, p.displayText, p.newsInterval),
    worldFactView: p.worldFactView ?? 构造世界事实视图(p.storyWeavingForSave.运行时?.factLedger ?? []),
    storyWeavingSnapshot: p.storyWeavingForSave,
    signal: p.abortController.signal,
    shouldCommit: p.isCurrentWorkflow,
  });
  const generatedNews = newsGenerationResult?.news;
  p.assertWorkflowActive();
  if (newsGenerationResult?.changed && generatedNews) p.state.set新闻(generatedNews);
  const newsAfterGeneration = generatedNews ?? p.state.新闻;
  pushQueueTask(p.state, 'news', 'success', {
    detail: newsGenerationResult?.changed
      ? `星际和平周报已更新，当前共 ${newsAfterGeneration.length} 条新闻记录。`
      : newsGenerationResult
        ? '星际和平周报本回合没有可写新闻变化。'
        : '星际和平周报未生成有效结果。',
  }, p.turnCountAtStart, p.queueTasksMirror);
  return { newsAfterGeneration };
}

async function runYitingArchiveJob(p: YitingJobParams): Promise<YitingJobResult> {
  const turnRecallEntryResult = await buildYitingArchiveEntry(
    p.turnRecallSource,
    p.memorySettings,
    resolveApiConfig(p.state.deviceSettings.apiSettings, p.state.deviceSettings.gameSettings, 'yitingArchive'),
    p.abortController.signal,
    p.memorySettings.忆庭召回API.retryCount,
    p.state.deviceSettings.gameSettings.promptModules,
  );
  p.assertWorkflowActive();
  const turnRecallEntry = turnRecallEntryResult.entry;
  const yitingAfterTurnRecall = upsertRecallEntry(p.yitingBase, turnRecallEntry);
  pushQueueTask(p.state, 'memory', 'success', {
    detail: turnRecallEntryResult.usedFallback ? '忆庭纪要已使用主回复小总结入库。' : '忆庭纪要已由独立模型压缩并入库。',
  }, p.turnCountAtStart, p.queueTasksMirror);
  if (!p.yitingEnabled) {
    pushQueueTask(p.state, 'yiting', 'skipped', {
      detail: '忆庭召回已关闭，但入库仍已执行。',
    }, p.turnCountAtStart, p.queueTasksMirror);
  } else if (!p.yitingRecallEnabled) {
    pushQueueTask(p.state, 'yiting', 'skipped', {
      detail: `未到第${p.memorySettings.忆庭召回最早触发回合 + 1}回合，忆庭召回已跳过。`,
    }, p.turnCountAtStart, p.queueTasksMirror);
  } else if (p.yitingPreview?.entries.length) {
    pushQueueTask(p.state, 'yiting', 'success', {
      detail: p.yitingPreview.usedModel ? '忆庭召回已由独立模型完成。' : '忆庭召回已由本地摘要检索完成。',
    }, p.turnCountAtStart, p.queueTasksMirror);
  } else {
    pushQueueTask(p.state, 'yiting', 'success', {
      detail: '忆庭已检索，本回合没有命中相关档案。',
    }, p.turnCountAtStart, p.queueTasksMirror);
  }
  return { yitingAfterTurnRecall };
}

function runPhoneFallbackJob(p: PhoneJobParams): Promise<PhoneJobResult> {
  let phone = p.phoneAfterFallbackSeed;
  if (!p.skipPhoneSeeds && p.state.deviceSettings.gameSettings.手机系统.enabled && p.state.deviceSettings.gameSettings.手机系统.autoGenerateSeeds) {
    const fallbackSeed = buildFallbackPhoneSeed({
      phone,
      npcs: p.npcAfterCompression,
      turn: p.turnCountAtStart + 1,
      userInput: p.userInput,
      body: p.displayText,
      maxSeedsPerTurn: p.state.deviceSettings.gameSettings.手机系统.maxSeedsPerTurn,
      contactCooldownTurns: p.state.deviceSettings.gameSettings.手机系统.contactCooldownTurns,
    });
    if (fallbackSeed) {
      phone = {
        ...phone,
        messageSeeds: [...phone.messageSeeds, fallbackSeed],
        unreadTotal: phone.unreadTotal + 1,
      };
      pushQueueTask(p.state, 'phone', 'success', {
        detail: `已补充低频主动来信种子：${fallbackSeed.title}。`,
      }, p.turnCountAtStart, p.queueTasksMirror);
    }
  }
  return Promise.resolve({ phoneAfterFallbackSeed: phone });
}

async function runNarrativeImageJob(p: NarrativeJobParams): Promise<NarrativeJobResult> {
  const fh = p.finalHistory;
  const 文生图系统 = p.state.deviceSettings.gameSettings.文生图系统 as 文生图系统设置 | undefined;
  const 门禁 = 判定正文配图门禁(文生图系统);
  if (!门禁.放行) {
    // 不静默返回：用户开了自动模式却在别处被拦下时，必须能看到被谁拦的。
    pushQueueTask(p.state, 'narrative_image_parse', 'skipped', {
      detail: `本回合未自动生图：${门禁.原因}`,
    }, p.turnCountAtStart, p.queueTasksMirror);
    return { finalHistoryForSave: fh };
  }
  const targetMessageId = p.aiMsg.id;

  const 结果 = await 生成消息插图(p.state, targetMessageId, p.displayText, undefined, {
    signal: p.abortController.signal,
  });
  p.assertWorkflowActive();

  if (结果.插图.length === 0) {
    pushQueueTask(p.state, 'narrative_image_parse', 'failed', {
      detail: 结果.提示词诊断 ?? '正文配图没有产出任何插图。',
      targetMessageId,
    }, p.turnCountAtStart, p.queueTasksMirror);
    return { finalHistoryForSave: fh, 相册After: 结果.相册 };
  }

  const 下一份历史 = p.finalHistory.map((msg) =>
    msg.id === targetMessageId && msg.role === 'assistant'
      ? { ...msg, narrativeImages: [...(msg.narrativeImages ?? []), ...结果.插图] }
      : msg,
  );
  pushQueueTask(
    p.state,
    'narrative_image_generate',
    结果.失败数 === 0 ? 'success' : 'failed',
    {
      detail: 结果.失败数 === 0
        ? `正文插图生成完成：${结果.成功数} 张。`
        : `正文插图生成：成功 ${结果.成功数} 张，失败 ${结果.失败数} 张。`,
      targetMessageId,
    },
    p.turnCountAtStart,
    p.queueTasksMirror,
  );
  return { finalHistoryForSave: 下一份历史, 相册After: 结果.相册 };
}

export async function stage11_backgroundJobs(
  ctx: TurnContext,
  d: TurnDeltas,
): Promise<Partial<TurnDeltas>> {
  const { state, userInput, effectiveWorld, abortController, assertWorkflowActive, isCurrentWorkflow, turnCountAtStart, queueTasksMirror, phoneAtStart } = ctx;
  devLog('stage', 'stage11_backgroundJobs.enter', { turn: turnCountAtStart });
  const displayText = d.displayText as string;
  const finalHistory = d.finalHistory as 聊天消息[];
  const npcAfterCompression = d.npcAfterCompression as NonNullable<TurnDeltas['npcAfterCompression']>;
  const yitingWithCompression = d.yitingWithCompression as 忆庭系统;
  const variableOverrides = d.variableOverrides;
  const storyWeavingForSave = d.storyWeavingForSave ?? state.剧情编织;
  const aiMsg = d.aiMsg as 聊天消息;
  const parsedForDisplay = d.parsedForDisplay as NonNullable<TurnDeltas['parsedForDisplay']>;
  const openingNewsPreprocessed = d.openingNewsPreprocessed ?? false;
  const openingNewsForSave = d.openingNewsForSave ?? null;
  const yitingPreview = d.yitingPreview;
  const yitingEnabled = d.yitingEnabled ?? false;
  const yitingRecallEnabled = d.yitingRecallEnabled ?? false;
  const storyProgressMemoryLine = d.storyProgressMemoryLine ?? '';
  const isOpeningSystemTrigger = turnCountAtStart === 1 && userInput.startsWith('[系统]');
  const memorySettings = (state.deviceSettings.gameSettings.记忆系统 as 记忆系统设置 | undefined) ?? 创建默认记忆系统设置();

  const newsSettings = state.deviceSettings.gameSettings.新闻系统 as 星际和平周报设置 | undefined;
  const newsEnabled = Boolean(newsSettings?.enabled && newsSettings.autoGenerate);
  const newsInterval = Math.max(5, Math.min(10, Math.trunc(newsSettings?.generateIntervalTurns ?? 5) || 5));
  const newsTurn = turnCountAtStart + 1;
  const shouldRunOpeningNews = isOpeningSystemTrigger && newsEnabled;
  const shouldRunNews = newsEnabled && d.isPathAwakeningTurn !== true && ((shouldRunOpeningNews && !openingNewsPreprocessed) || (newsTurn > 0 && newsTurn % newsInterval === 0));
  const yitingBase = 合并忆庭系统(yitingWithCompression, variableOverrides?.忆庭);
  const turnRecallSource = {
    turn: turnCountAtStart,
    userInput,
    body: displayText,
    memory: parsedForDisplay.memory,
    worldEvents: storyProgressMemoryLine && !isMemorySystemNoise(storyProgressMemoryLine)
      ? [...parsedForDisplay.worldEvents, storyProgressMemoryLine]
      : parsedForDisplay.worldEvents,
    actionOptions: parsedForDisplay.actionOptions,
    gameTime: effectiveWorld.当前日期 || undefined,
    gameClock: effectiveWorld.当前时间 || undefined,
    location: effectiveWorld.当前地点 || undefined,
  };

  const phoneAfterFallbackSeedBase = variableOverrides?.手机 ?? phoneAtStart;

  const newsParams: NewsJobParams = {
    newsSettings, shouldRunNews, newsInterval, shouldRunOpeningNews,
    state, displayText, userInput, finalHistory,
    storyWeavingForSave, abortController, isCurrentWorkflow, assertWorkflowActive, turnCountAtStart, queueTasksMirror,
    worldFactView: d.worldFactView,
  };
  const yitingParams: YitingJobParams = {
    turnRecallSource, memorySettings, abortController, state,
    yitingBase, yitingPreview: yitingPreview ?? null, yitingEnabled,
    yitingRecallEnabled, assertWorkflowActive, turnCountAtStart, queueTasksMirror,
  };
  const phoneParams: PhoneJobParams = {
    state, phoneAfterFallbackSeed: phoneAfterFallbackSeedBase, npcAfterCompression, userInput, displayText,
    skipPhoneSeeds: d.isPathAwakeningTurn === true, turnCountAtStart, queueTasksMirror,
  };
  const narrativeParams: NarrativeJobParams = {
    state, aiMsg, displayText, abortController, finalHistory,
    assertWorkflowActive, turnCountAtStart, queueTasksMirror,
  };

  const backgroundTaskMode = state.deviceSettings.gameSettings.backgroundTaskMode as TurnContext['state']['deviceSettings']['gameSettings']['backgroundTaskMode'] | undefined;
  let newsAfterGeneration: 新闻条目[] | null;
  let yitingAfterTurnRecall: 忆庭系统;
  let phoneAfterFallbackSeed: 手机系统;
  let finalHistoryForSave: 聊天消息[];
  let 相册After: 相册系统 | undefined;
  if ((backgroundTaskMode ?? 'sequential') === 'parallel') {
    const [newsRes, yitingRes, phoneRes, narrativeRes] = await Promise.all([
      runNewsBackgroundJob(newsParams),
      runYitingArchiveJob(yitingParams),
      runPhoneFallbackJob(phoneParams),
      runNarrativeImageJob(narrativeParams),
    ]);
    newsAfterGeneration = newsRes.newsAfterGeneration ?? openingNewsForSave;
    yitingAfterTurnRecall = yitingRes.yitingAfterTurnRecall;
    phoneAfterFallbackSeed = phoneRes.phoneAfterFallbackSeed;
    finalHistoryForSave = narrativeRes.finalHistoryForSave;
    相册After = narrativeRes.相册After;
  } else {
    const newsRes = await runNewsBackgroundJob(newsParams);
    newsAfterGeneration = newsRes.newsAfterGeneration ?? openingNewsForSave;
    const yitingRes = await runYitingArchiveJob(yitingParams);
    yitingAfterTurnRecall = yitingRes.yitingAfterTurnRecall;
    const phoneRes = await runPhoneFallbackJob(phoneParams);
    phoneAfterFallbackSeed = phoneRes.phoneAfterFallbackSeed;
    const narrativeRes = await runNarrativeImageJob(narrativeParams);
    finalHistoryForSave = narrativeRes.finalHistoryForSave;
    相册After = narrativeRes.相册After;
  }

  devLog('stage', 'stage11_backgroundJobs.exit', {
    turn: turnCountAtStart,
    outputs: ['newsAfterGeneration', 'yitingAfterTurnRecall', 'phoneAfterFallbackSeed', 'finalHistoryForSave', '相册After'],
  });
  return {
    newsAfterGeneration,
    yitingAfterTurnRecall,
    phoneAfterFallbackSeed,
    finalHistoryForSave,
    相册After,
  };
}
