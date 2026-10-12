import * as z from 'zod';

export const AI提供商列表 = [
  'openai', 'gemini', 'claude', 'claude_compatible', 'deepseek',
  'baidu', 'opencode', 'mimo', 'ark', 'cline', 'openai_compatible',
] as const;
export type AI提供商 = (typeof AI提供商列表)[number];

import type { 提示词模块 } from './prompts';
import { createBuiltinPromptModules } from '@/data/builtinPromptModules';
import type { 剧情编织API覆盖 } from './storyWeaving';
import type { STPresetEntryV2, TavernPostProcessMode } from './stTypes';

export interface API配置项 {
  id: string;
  name: string;
  provider: AI提供商;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  /** 仅 OpenAI 兼容 / DeepSeek / Claude / Gemini 支持。 */
  topP?: number;
  /** 仅 Gemini 原生支持。 */
  topK?: number;
  /** 当前无 provider 实际消费，预留字段。 */
  topA?: number;
  /** 当前无 provider 实际消费，预留字段。 */
  minP?: number;
  /** OpenAI 兼容 / DeepSeek / Gemini 支持。 */
  repetitionPenalty?: number;
  /** OpenAI 兼容 / DeepSeek / Gemini 支持。 */
  frequencyPenalty?: number;
  /** OpenAI 兼容 / DeepSeek / Gemini 支持。 */
  presencePenalty?: number;
  maxContext?: number;
  retryCount?: number;
  enableClaudeMode?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface API设置 {
  activeConfigId: string | null;
  configs: API配置项[];
}

export function 创建空API设置(): API设置 {
  return { activeConfigId: null, configs: [] };
}

/** 留空字段回退主 API。 */
export type API覆盖字段 = {
  provider: AI提供商 | '';
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  retryCount?: number;
};

/** 留空回退主 API；main 为 null 时仅取覆盖字段（调用方自行判空）。 */
export function resolveApiOverrideFields(
  override: API覆盖字段,
  main: API配置项 | null,
): API覆盖字段 {
  return {
    provider: override.provider || main?.provider || '',
    baseUrl: override.baseUrl.trim() || main?.baseUrl || '',
    apiKey: override.apiKey.trim() || main?.apiKey || '',
    model: override.model.trim() || main?.model || '',
    maxTokens: override.maxTokens ?? main?.maxTokens,
    temperature: override.temperature ?? main?.temperature,
    retryCount: override.retryCount ?? main?.retryCount ?? 2,
  };
}

function normalizeApiOverride<T extends { retryCount?: number }>(input: Partial<T> | undefined, defaults: T): T {
  return {
    ...defaults,
    ...(input ?? {}),
    retryCount: Math.max(0, Math.trunc(input?.retryCount ?? defaults.retryCount ?? 2) || 0),
  };
}

/** 留空字段回退主 API 的同名字段。 */
interface 通用API覆盖 {
  provider: AI提供商;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  retryCount?: number;
}

function 创建空通用API覆盖(): 通用API覆盖 {
  return {
    provider: 'openai_compatible',
    baseUrl: '',
    apiKey: '',
    model: '',
    retryCount: 2,
  };
}

export type 变量API覆盖 = 通用API覆盖;
export const 创建空变量API覆盖 = 创建空通用API覆盖;

export type 新闻API覆盖 = 通用API覆盖;
export const 创建空新闻API覆盖 = 创建空通用API覆盖;

export type 手机API覆盖 = 通用API覆盖;
export const 创建空手机API覆盖 = 创建空通用API覆盖;

export type 智库API覆盖 = 通用API覆盖;
export const 创建空智库API覆盖 = 创建空通用API覆盖;

export type 剧情编织API覆盖设置 = 剧情编织API覆盖;
export const 创建空剧情编织API覆盖 = 创建空通用API覆盖;

const AI提供商Schema = z.enum(AI提供商列表);

const 建忆庭API覆盖Schema = (默认Provider: AI提供商 | '') =>
  z
    .object({
      provider: AI提供商Schema.or(z.literal('')).catch(默认Provider),
      baseUrl: z.string().catch(''),
      apiKey: z.string().catch(''),
      model: z.string().catch(''),
      maxTokens: z.number().int().positive().optional().catch(undefined),
      temperature: z.number().min(0).max(2).optional().catch(undefined),
      retryCount: z.number().int().min(0).catch(2),
    })
    .catch(() => ({
      provider: 默认Provider,
      baseUrl: '',
      apiKey: '',
      model: '',
      retryCount: 2,
    }));

export type 忆庭API覆盖 = z.infer<ReturnType<typeof 建忆庭API覆盖Schema>>;

export function 创建空忆庭API覆盖(): 忆庭API覆盖 {
  return 建忆庭API覆盖Schema('openai_compatible').parse({});
}

export interface 文生图LLMAPI覆盖 {
  provider: AI提供商 | '';
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  retryCount?: number;
}

export function 创建空文生图LLMAPI覆盖(): 文生图LLMAPI覆盖 {
  return {
    provider: '',
    baseUrl: '',
    apiKey: '',
    model: '',
    maxTokens: 1600,
    temperature: 0.45,
    retryCount: 2,
  };
}

export type 原著约束强度 = 'loose' | 'standard' | 'strict';
export type DeepSeek主剧情模式 = 'off' | 'standard' | 'lock_format';
export type 后台任务模式 = 'sequential' | 'parallel';

export interface VisualTextSettings {
  narrationFontSize: number;
  dialogueFontSize: number;
  playerFontSize: number;
}

/**
 * AVG（galgame 式逐句推进）设置。
 *
 * 借鉴自用户的 galgame 前端：正文不再一次性铺开，而是按「一句」为单位，
 * 用滚轮 / 空格 / 回车前进、反向滚动后退。
 */
export interface 逐句推进设置 {
  启用: boolean;
  /** 一次性把本回合全部展开（跳过逐句）。 */
  立即全显: boolean;
}

export interface 游戏设置 {
  wordCountTarget: number;
  narrativePerson: 'first' | 'second' | 'third';
  enableTavernKeeperPersona: boolean;
  enableActionOptions: boolean;
  enableMemoryInjection: boolean;
  enableWorldEvents: boolean;
  enableWorldbookInjection: boolean;
  enableInnerVoice: boolean;
  enableStreaming: boolean;
  devMode: boolean;
  enableClaudeMode: boolean;
  /** 只在主 API 是 DeepSeek 时生效。 */
  deepSeekMainMode: DeepSeek主剧情模式;
  backgroundTaskMode: 后台任务模式;
  enableCacheDiagnostics: boolean;
  enableVariableUpdate: boolean;
  新闻系统: 星际和平周报设置;
  手机系统: 手机系统设置;
  智库系统: 智库系统设置;
  剧情编织系统: 剧情编织系统设置;
  文生图系统: 文生图系统设置;
  记忆系统: 记忆系统设置;
  /** AVG 式逐句推进（可选）。 */
  逐句推进: 逐句推进设置;
  variableApi: 变量API覆盖;
  variableUpdateRequireConfirm: boolean;
  /** @deprecated 用 promptModules 替代。保留字段用于旧存档迁移。 */
  customPrompt: string;
  promptModules: 提示词模块[];
  enableStPreset?: boolean;
  stPresetsV2?: STPresetEntryV2[];

  currentStPresetIdV2?: string | null;

  /** 不代表本项目角色卡。 */
  currentStCharacterId?: number | null;

  stPostProcessMode?: TavernPostProcessMode;

  cotLanguage?: 'zh' | 'en' | 'ja' | 'fr' | 'ru' | 'de' | 'es' | 'it';
  enableCotFakeHistory: boolean;
  enableTagRepair: boolean;
  autoRetryOnError: boolean;
  autoRetryCount: number;
  enableAutoSaveEveryTurn: boolean;
  visualTextSettings: VisualTextSettings;
  enableNsfw: boolean;
  /** 关闭时变量模型不得写入男性身体档案和男性私密字段。 */
  enableMaleNsfwArchive: boolean;
  enableNoControl: boolean;
  /** 与 enableNoControl 互斥。 */
  enablePlayerSpeechExpansion: boolean;
  额外功能: 额外功能设置;
}

export interface 污染词清理设置 {
  enabled: boolean;
  words: string[];
}

export interface 标签块隐藏设置 {
  enabled: boolean;
}

export interface 额外功能设置 {
  污染词清理: 污染词清理设置;
  标签块隐藏: 标签块隐藏设置;
  玩家额外要求: string;
}

export interface 星际和平周报设置 {
  enabled: boolean;
  autoGenerate: boolean;
  api: 新闻API覆盖;
  maxNewEntriesPerTurn: number;
  generateIntervalTurns: number;
}

export interface 手机系统设置 {
  enabled: boolean;
  api: 手机API覆盖;
  autoGenerateSeeds: boolean;
  maxSeedsPerTurn: number;
  contactCooldownTurns: number;
  groupCooldownTurns: number;
  privateArchiveThreshold: number;
  groupArchiveThreshold: number;
}

export interface 智库系统设置 {
  enabled: boolean;
  api: 智库API覆盖;
  原著约束: 原著约束强度;
  maxRelatedEntries: number;
  autoSummarizeOnImport: boolean;
}

export interface 剧情编织系统设置 {
  enabled: boolean;
  api: 剧情编织API覆盖设置;
  chaptersPerSegment: number;
  currentWindow: boolean;
  /** 失败只留诊断、不改动确定性阈值。 */
  剧情推进AI判定: boolean;
  /** 留空复用剧情编织 api，再回退主 API。 */
  推进判定API: 剧情编织API覆盖设置;
  /** 剧情对齐巡检：每隔若干回合用 AI 把近期正文总结与剧情库比对，向前纠正当前段；默认关闭。 */
  剧情对齐巡检: boolean;
  /** 剧情对齐巡检的间隔回合数。 */
  剧情对齐巡检间隔: number;
  /** 旧存档缺省关闭，可手动开启。 */
  世界演变: boolean;
}

/**
 * 文生图系统的设置类型与归一化函数。
 *
 * [FACT] 本文件原先自带一整套 `文生图API配置` / `文生图规则中心设置` / `正文生图设置`
 * 类型与归一化函数。旧实现硬编码 `CheckpointLoaderSimple` / `KSampler` 等
 * class_type 定位 ComfyUI 节点，只能跑一种工作流形状，已整体退役。
 *
 * 新实现（`models/genSystem.ts`）改为**占位符驱动**：工作流里写 `"seed"` 这类
 * 带引号的 token，出图时按名替换，因此任意 API 格式工作流都能用。
 * 这里只保留 `文生图系统` 这个键名，避免存档与四十余个调用点大面积迁移。
 */
export type {
  生图渠道,
  设置页签,
  占位符定义,
  占位符取值,
  提示词预设,
  替换规则集,
  LLM条目,
  LLM预设,
  角色部位字段,
  角色媒体,
  服装条目,
  角色卡,
  角色位置,
  角色启用条目,
  角色启用预设,
  通用角色列表预设,
  通用服装列表预设,
  注入模板集,
  角色AI设置,
  词条,
  词库分组,
  词库子分组,
  已装词库,
  词库树,
  图片缓存条目,
  缓存图片,
  生成参数快照,
  ComfyUI连接设置,
  ComfyUI参数设置,
  ComfyUI档案,
  ComfyUI设置,
  提示词设置,
  LLM设置,
  正文配图设置,
  图片缓存设置,
} from './genSystem';

export {
  生图渠道列表,
  角色部位字段名,
  创建空角色部位字段,
  默认词汇替换,
  创建默认ComfyUI设置,
  创建默认提示词设置,
  创建默认LLM设置,
  创建默认角色AI设置,
  创建默认角色启用预设列表,
  创建默认注入模板列表,
  默认启用预设名,
  默认通用角色列表名,
  默认通用服装列表名,
  默认注入模板名,
  内置注入模板,
  内置注入模板名列表,
  镜像启用列表,
  归一化角色启用条目,
  归一化角色启用预设,
  归一化注入模板集,
  创建默认文生图系统设置,
} from './genSystem';

import {
  创建默认文生图系统设置,
  创建默认注入模板列表,
  默认启用预设名,
  默认通用角色列表名,
  默认通用服装列表名,
  默认注入模板名,
  镜像启用列表,
  归一化角色启用预设,
  归一化注入模板集,
  type 角色启用预设,
  type 通用角色列表预设,
  type 通用服装列表预设,
  type 注入模板集,
  type 文生图系统设置,
} from './genSystem';

export type { 文生图系统设置 };

export function 归一化文生图系统设置(input?: Partial<文生图系统设置>): 文生图系统设置 {
  const defaults = 创建默认文生图系统设置();
  if (!input) return defaults;
  // 「转化器」现在叫「LLM」。旧存档里这个块的名字是 `转化器`，
  // 不迁移的话用户已有的模型/预设配置会在打开设置时被默认值覆盖掉。
  const 旧LLM = (input as { 转化器?: 文生图系统设置['LLM'] }).转化器;
  const LLM输入 = input.LLM ?? 旧LLM;
  const 合并 = { ...defaults, ...input };
  合并.启用 = input.启用 === true;
  合并.渠道 = input.渠道 ?? defaults.渠道;
  合并.角色卡 = input.角色卡 ?? {};

  /*
   * 角色启用：v1 存档只有一个扁平的 `角色启用列表`，没有预设概念。
   * 升级方式是把它收进「默认启用列表」这一个预设里，之后两者保持镜像——
   * 预设是数据源（条目上带各自的图片/音频绑定），扁平的 `角色启用列表`
   * 是给引擎读的视图（`$…$` 匹配、参考图挑选都只认它）。
   */
  const 旧启用列表 = Array.isArray(input.角色启用列表)
    ? input.角色启用列表.map((项) => String(项)).filter(Boolean)
    : [];
  const 启用预设列表: Record<string, 角色启用预设> = {};
  for (const [名称, 预设] of Object.entries(input.角色启用预设列表 ?? {})) {
    启用预设列表[名称] = 归一化角色启用预设(预设);
  }
  if (Object.keys(启用预设列表).length === 0) {
    启用预设列表[默认启用预设名] = 归一化角色启用预设({
      条目: 旧启用列表.map((角色Id) => ({ 角色Id })),
    });
  }
  合并.角色启用预设列表 = 启用预设列表;
  合并.当前启用预设 = typeof input.当前启用预设 === 'string' && 启用预设列表[input.当前启用预设]
    ? input.当前启用预设
    : Object.keys(启用预设列表)[0];
  合并.角色启用列表 = 镜像启用列表(启用预设列表[合并.当前启用预设]);

  const 归一化字符串列表 = (值: unknown): string[] => (
    Array.isArray(值)
      ? 值.filter((项) => 项 !== null && 项 !== undefined).map((项) => String(项)).filter(Boolean)
      : []
  );
  const 通用角色列表: Record<string, 通用角色列表预设> = {};
  for (const [名称, 预设] of Object.entries(input.通用角色列表 ?? {})) {
    通用角色列表[名称] = { 角色: 归一化字符串列表((预设 as 通用角色列表预设 | undefined)?.角色) };
  }
  if (Object.keys(通用角色列表).length === 0) 通用角色列表[默认通用角色列表名] = { 角色: [] };
  合并.通用角色列表 = 通用角色列表;
  合并.当前通用角色列表 = typeof input.当前通用角色列表 === 'string' && 通用角色列表[input.当前通用角色列表]
    ? input.当前通用角色列表
    : Object.keys(通用角色列表)[0];

  const 通用服装列表: Record<string, 通用服装列表预设> = {};
  for (const [名称, 预设] of Object.entries(input.通用服装列表 ?? {})) {
    通用服装列表[名称] = { 服装: 归一化字符串列表((预设 as 通用服装列表预设 | undefined)?.服装) };
  }
  if (Object.keys(通用服装列表).length === 0) 通用服装列表[默认通用服装列表名] = { 服装: [] };
  合并.通用服装列表 = 通用服装列表;
  合并.当前通用服装列表 = typeof input.当前通用服装列表 === 'string' && 通用服装列表[input.当前通用服装列表]
    ? input.当前通用服装列表
    : Object.keys(通用服装列表)[0];

  // 注入模板：内置的四套永远在（缺了补回来），用户自建的同名可覆盖内置。
  const 注入模板列表: Record<string, 注入模板集> = { ...创建默认注入模板列表() };
  for (const [名称, 模板] of Object.entries(input.注入模板列表 ?? {})) {
    注入模板列表[名称] = 归一化注入模板集(模板);
  }
  合并.注入模板列表 = 注入模板列表;
  合并.当前注入模板 = typeof input.当前注入模板 === 'string' && 注入模板列表[input.当前注入模板]
    ? input.当前注入模板
    : 默认注入模板名;

  合并.角色AI = {
    ...defaults.角色AI,
    ...(input.角色AI ?? {}),
    API: { ...defaults.角色AI.API, ...(input.角色AI?.API ?? {}) },
  };

  const comfyui = input.comfyui ?? defaults.comfyui;
  const 档案列表 = comfyui.档案列表 && Object.keys(comfyui.档案列表).length > 0
    ? comfyui.档案列表
    : defaults.comfyui.档案列表;
  合并.comfyui = {
    ...defaults.comfyui,
    ...comfyui,
    档案列表,
    当前档案: 档案列表[comfyui.当前档案] ? comfyui.当前档案 : Object.keys(档案列表)[0],
  };

  合并.提示词 = {
    ...defaults.提示词,
    ...(input.提示词 ?? {}),
    // 固定画风是后加的层级，旧存档没有这一块；缺字段时逐项回退，避免半截对象。
    固定画风: { ...defaults.提示词.固定画风, ...(input.提示词?.固定画风 ?? {}) },
  };
  合并.LLM = { ...defaults.LLM, ...(LLM输入 ?? {}) };
  合并.正文配图 = {
    ...defaults.正文配图,
    ...(input.正文配图 ?? {}),
    每轮上限: Math.max(0, Math.trunc(input.正文配图?.每轮上限 ?? defaults.正文配图.每轮上限) || 0),
    // 旧存档没有这两个显示开关，缺省时沿用默认（显示 + 折叠）。
    默认显示: input.正文配图?.默认显示 !== false,
    默认展开: input.正文配图?.默认展开 === true,
  };
  合并.图片缓存 = {
    ...defaults.图片缓存,
    ...(input.图片缓存 ?? {}),
    保留天数: Math.max(0, Math.trunc(input.图片缓存?.保留天数 ?? defaults.图片缓存.保留天数) || 0),
  };
  return 合并;
}

/** 阈值契约版本：存档缺失或低于此值时按历史默认组合一次性迁移。 */
const 记忆阈值契约版本 = 2;

const 旧版阈值组合: ReadonlyArray<readonly [number, number, number]> = [
  [25, 20, 10],
  [15, 15, 15],
  [10, 30, 50],
  [15, 25, 45],
];

const 旧版NPC默认压缩阈值 = 15;

function 迁移旧版阈值(input: Partial<记忆系统设置>, defaults: 记忆系统设置): Partial<记忆系统设置> {
  const 命中三层 = 旧版阈值组合.some(
    ([即时, 短期, 中期]) =>
      input.即时转短期阈值 === 即时 && input.短期转中期阈值 === 短期 && input.中期转长期阈值 === 中期,
  );
  return {
    ...input,
    即时转短期阈值: 命中三层 ? defaults.即时转短期阈值 : input.即时转短期阈值,
    短期转中期阈值: 命中三层 ? defaults.短期转中期阈值 : input.短期转中期阈值,
    中期转长期阈值: 命中三层 ? defaults.中期转长期阈值 : input.中期转长期阈值,
    NPC记忆压缩阈值: input.NPC记忆压缩阈值 === 旧版NPC默认压缩阈值
      ? defaults.NPC记忆压缩阈值
      : input.NPC记忆压缩阈值,
  };
}

const 记忆系统默认值 = {
  记忆阈值契约版本,
  即时转短期阈值: 10,
  短期转中期阈值: 30,
  中期转长期阈值: 50,
  NPC记忆压缩阈值: 20,
  忆庭启用: true,
    忆庭召回最早触发回合: 10,
    即时转短期提示词: [
      '你是叙事游戏的记忆整理器。请把本批「即时记忆」压缩为适合放入「短期记忆」的摘要。',
      '即时记忆是每回合刚发生的原始记录，可能重复、琐碎或含有未定细节。请合并同类事件，保留最近剧情推进、玩家明确选择、重要对话、获得/失去的物品、状态变化、NPC 态度变化、地点与当前目标。',
      '不要写成流水账，不要保留无意义寒暄，不要添加原文没有的信息。输出 3-6 条要点，每条包含「谁/在哪里/做了什么/造成什么变化」，必要时标明未解决的悬念或待办。',
      '原著角色的单回合沉默、紧张、冷淡、受伤、戒备或少话只能作为当时状态记录，不得压缩成长期人格；长期口吻与行为边界以智库人物主体资料为准。',
    ].join('\n'),
    短期转中期提示词: [
      '你是叙事游戏的阶段记忆管理员。请把多条「短期记忆」压缩为适合放入「中期记忆」的阶段摘要。',
      '中期记忆用于承接最近一段剧情链，而不是永久设定库。请保留任务进展、人物关系的近期变化、玩家明确选择、未解决事项、当前地点/目标、重要物品状态和下一步牵引。',
      '请合并重复内容，删除一次性氛围描写和已经无后续影响的小动作。输出 4-8 条要点，优先写清「事件」「影响」「仍需承接的问题」。',
      '原著角色的单回合沉默、紧张、冷淡、受伤、戒备或少话只能作为当时状态记录，不得压缩成长期人格；长期口吻与行为边界以智库人物主体资料为准。',
    ].join('\n'),
    中期转长期提示词: [
      '你是叙事游戏的长期记忆管理员。请把多条「中期记忆」压缩为稳定、可长期注入 AI 上下文的「长期记忆」。',
      '长期记忆只保留不应被遗忘的事实：主线转折、已确认设定、玩家身份与能力变化、重要承诺、组织关系、关键 NPC 关系、不可逆后果、长期目标和反复出现的伏笔。',
      '请删除一次性场景细节、重复描述、临时情绪和已经解决的小事件。输出 4-8 条结构化要点，优先写清「事实」「影响」「后续牵引」。不要改写成小说段落，也不要添加没有依据的新设定。',
      '不得把原著角色某几回合的临时沉默、紧张、冷淡、受伤或戒备归纳为长期性格改变；若确有关系变化，只写共同经历和当前关系事实。',
    ].join('\n'),
  NPC记忆压缩提示词: [
      '你负责将单个 NPC 的多条原始同行记忆压缩为一条「NPC总结记忆」。',
      '只写该 NPC 自身可知、可感知或可合理记住的事实，让记忆边界停留在该 NPC 的信息范围内；不要写入其他 NPC 才知道的想法、秘密或场外信息。',
      '只总结输入条目里反复出现、已经稳定、或对该 NPC 与玩家的关系/印象/立场/处境有持续影响的内容。优先保留初遇、关键共同经历、称呼变化、承诺与亏欠、信任或冲突原因、好感变化依据、对玩家的独特看法、等待兑现的约定和会影响之后互动的私人细节。',
      '允许概括趋势，但必须能从输入条目直接推出；不要扩写新事件，不要补不存在的动机，不要把关系突然推进或倒退。',
      '若该 NPC 是原著角色，不要把“本回合沉默/紧张/冷淡/受伤/戒备/少话”压缩为长期性格；长期人格、口吻和 OOC 边界以智库人物主体资料为准。',
      '输出必须是 1 段自然中文，不要分点，不要标签，不要代码块，不要前后缀。若输入整体没有稳定可沉淀内容，也输出一句极简事实概括，保持结果非空。字数建议 40-140 字。',
    ].join('\n'),
  忆庭召回条数: 8,
  /** 关闭后记忆压缩不再调用总结 API，始终使用本地摘要（不产生失败草稿）。 */
  启用中短长期API总结: true,
  剧情回忆完整原文条数N: 20,
  忆庭独立精炼: false,
  忆庭命中并存注入: true,
  主剧情历史模式: 'conservative' as const,
    忆庭召回提示词: [
      '你是「忆庭」的回忆检索器。你的任务不是写正文，而是根据玩家当前输入，从回忆库中筛出最相关的回忆档案，供主剧情继续承接。',
      '检索时优先按“时间最近 + 语义最相关”排序。优先匹配：人物、地点、目标、未结事项、冲突对象、承诺、伤势、物品、战斗后果、组织态度、命途变化、正在延续的事件线。',
      '回忆库中的摘要是主要检索材料。遇到多条近似回忆时，优先保留更近、更完整、和当前问题直接相关的条目；不要让措辞华丽或篇幅更长的条目压过真正的承接回忆。',
      '请严格区分强回忆与弱回忆：强回忆是会直接影响当前回合理解、推进行动、人物判断或结果处置的记忆；弱回忆只是背景补充，可以概括带过。',
      '如果同一事件存在连续链条、同一对象多轮互动、同一任务或约定的多个关键节点、或多段冲突与后果串联，请优先把这些条目归入强回忆，必要时可返回 3-6 条甚至更多，只要它们都真正相关。',
      '不要为了精简而漏掉仍在生效的关键前因、承诺、旧伤、旧账、未结事项、上一轮明确结论或会直接改变当前态度的证据。',
      '若回忆条目带有“精炼纪要”或长期纪要标记，请视为跨回合整合后的有效回忆来源；只要内容命中当前输入，就要正常参与强弱判断。',
      '严格只输出两行，不要输出解释、标题、推理过程或多余文本：',
      '强回忆：【回忆序号】|【回忆序号】',
      '弱回忆：【回忆序号】|【回忆序号】',
      '若某类为空，写“无”，例如：强回忆:无',
    ].join('\n'),
    忆庭精炼提示词: [
      '你是「忆庭」的回忆精炼器。你的任务是把多条回合原文压成一份可检索、可回看的历史纪要，而不是写新剧情。',
      '输出必须固定分成三段：<<<TIME>>>、<<<SUMMARY>>>、<<<BODY>>>。TIME 只写一个最早到最晚的时间范围，不要解释。',
      'SUMMARY 只写 3-6 条短句，每条一行，以 - 开头，尽量保持“时间，人物/地点/行动/结果”的索引格式。这里是后续检索的核心，所以要短、准、具体，不能写成长段叙述；每条尽量包含人物、地点、行动、结果、未结事项中的至少三项。',
      'BODY 是备用详细纪要，不是原文层；系统会自行保存真实原文。BODY 可以比 SUMMARY 稍微展开，但只补充已发生事实，不新增事件，不改变因果，不把摘要改写成小说。',
      '必须保留：人物关系变化、称呼变化、关键承诺、重要物品得失、战斗或伤势、未结任务、剧情转折、以及会影响后续选择的事实。',
      '删除重复寒暄、纯氛围描写、已经解决的小细节、以及与当前回忆链无关的噪音。',
      '原著角色的长期人格不要由忆庭精炼改写；单回合沉默、紧张、冷淡、受伤、戒备或少话只能作为当时状态，不能被总结成“长期沉默寡言”等人格结论。',
  ].join('\n'),
};

const 阈值 = z.number().int().min(1);

const 记忆系统设置Schema = z.object({
  记忆阈值契约版本: 阈值.catch(记忆系统默认值.记忆阈值契约版本),
  即时转短期阈值: 阈值.catch(记忆系统默认值.即时转短期阈值),
  短期转中期阈值: 阈值.catch(记忆系统默认值.短期转中期阈值),
  中期转长期阈值: 阈值.catch(记忆系统默认值.中期转长期阈值),
  NPC记忆压缩阈值: 阈值.catch(记忆系统默认值.NPC记忆压缩阈值),
  记忆总结API: 建忆庭API覆盖Schema(''),
  忆庭启用: z.boolean().catch(记忆系统默认值.忆庭启用),
  忆庭召回最早触发回合: 阈值.catch(记忆系统默认值.忆庭召回最早触发回合),
  即时转短期提示词: z.string().catch(记忆系统默认值.即时转短期提示词),
  短期转中期提示词: z.string().catch(记忆系统默认值.短期转中期提示词),
  中期转长期提示词: z.string().catch(记忆系统默认值.中期转长期提示词),
  NPC记忆压缩提示词: z.string().catch(记忆系统默认值.NPC记忆压缩提示词),
  忆庭召回API: 建忆庭API覆盖Schema('openai_compatible'),
  忆庭精炼API: 建忆庭API覆盖Schema('openai_compatible'),
  忆庭召回条数: 阈值.catch(记忆系统默认值.忆庭召回条数),
  启用中短长期API总结: z.boolean().catch(记忆系统默认值.启用中短长期API总结),
  剧情回忆完整原文条数N: 阈值.catch(记忆系统默认值.剧情回忆完整原文条数N),
  忆庭独立精炼: z.boolean().catch(记忆系统默认值.忆庭独立精炼),
  忆庭命中并存注入: z.boolean().catch(记忆系统默认值.忆庭命中并存注入),
  主剧情历史模式: z.enum(['conservative', 'minimal']).catch(记忆系统默认值.主剧情历史模式),
  忆庭召回提示词: z.string().catch(记忆系统默认值.忆庭召回提示词),
  忆庭精炼提示词: z.string().catch(记忆系统默认值.忆庭精炼提示词),
});

export type 记忆系统设置 = z.infer<typeof 记忆系统设置Schema>;

export function 创建默认记忆系统设置(): 记忆系统设置 {
  return 记忆系统设置Schema.parse({});
}

export function 创建默认星际和平周报设置(): 星际和平周报设置 {
  return {
    enabled: true,
    autoGenerate: true,
    api: 创建空新闻API覆盖(),
    maxNewEntriesPerTurn: 3,
    generateIntervalTurns: 5,
  };
}

export function 创建默认手机系统设置(): 手机系统设置 {
  return {
    enabled: true,
    api: 创建空手机API覆盖(),
    // 主动来信默认关闭：多数玩家不希望 NPC 自来。开关只控 NPC 主动来信，不影响玩家主动发消息。
    autoGenerateSeeds: false,
    maxSeedsPerTurn: 2,
    contactCooldownTurns: 3,
    groupCooldownTurns: 5,
    privateArchiveThreshold: 20,
    groupArchiveThreshold: 30,
  };
}

export function 创建默认智库系统设置(): 智库系统设置 {
  return {
    enabled: true,
    api: 创建空智库API覆盖(),
    原著约束: 'standard',
    maxRelatedEntries: 5,
    autoSummarizeOnImport: true,
  };
}

export function 创建默认剧情编织系统设置(): 剧情编织系统设置 {
  return {
    enabled: true,
    api: 创建空剧情编织API覆盖(),
    chaptersPerSegment: 1,
    currentWindow: true,
    剧情推进AI判定: false,
    推进判定API: 创建空剧情编织API覆盖(),
    剧情对齐巡检: false,
    剧情对齐巡检间隔: 6,
    世界演变: true,
  };
}

export function 归一化星际和平周报设置(input?: Partial<星际和平周报设置>): 星际和平周报设置 {
  const defaults = 创建默认星际和平周报设置();
  if (!input) return defaults;
  return {
    ...defaults,
    ...input,
    maxNewEntriesPerTurn: Math.max(1, Math.min(5, Math.trunc(input.maxNewEntriesPerTurn ?? defaults.maxNewEntriesPerTurn) || defaults.maxNewEntriesPerTurn)),
    generateIntervalTurns: Math.max(5, Math.min(10, Math.trunc(input.generateIntervalTurns ?? defaults.generateIntervalTurns) || defaults.generateIntervalTurns)),
    api: normalizeApiOverride(input.api, defaults.api),
  };
}

export function 归一化手机系统设置(input?: Partial<手机系统设置>): 手机系统设置 {
  const defaults = 创建默认手机系统设置();
  if (!input) return defaults;
  return {
    ...defaults,
    ...input,
    api: normalizeApiOverride(input.api, defaults.api),
    maxSeedsPerTurn: Math.max(0, Math.trunc(input.maxSeedsPerTurn ?? defaults.maxSeedsPerTurn)),
    contactCooldownTurns: Math.max(0, Math.trunc(input.contactCooldownTurns ?? defaults.contactCooldownTurns)),
    groupCooldownTurns: Math.max(0, Math.trunc(input.groupCooldownTurns ?? defaults.groupCooldownTurns)),
    privateArchiveThreshold: Math.max(3, Math.trunc(input.privateArchiveThreshold ?? defaults.privateArchiveThreshold)),
    groupArchiveThreshold: Math.max(6, Math.trunc(input.groupArchiveThreshold ?? defaults.groupArchiveThreshold)),
  };
}

export function 归一化智库系统设置(input?: Partial<智库系统设置>): 智库系统设置 {
  const defaults = 创建默认智库系统设置();
  if (!input) return defaults;
  return {
    ...defaults,
    ...input,
    api: normalizeApiOverride(input.api, defaults.api),
    maxRelatedEntries: Math.min(5, Math.max(1, Math.trunc(input.maxRelatedEntries ?? defaults.maxRelatedEntries) || defaults.maxRelatedEntries)),
  };
}

export function 归一化剧情编织系统设置(input?: Partial<剧情编织系统设置>): 剧情编织系统设置 {
  const defaults = 创建默认剧情编织系统设置();
  // 旧档把关：整个对象缺失（含极老档）或字段缺省时世界演变落 false，只有显式开启或新建档才为 true。
  if (!input) return { ...defaults, 世界演变: false };
  return {
    ...defaults,
    ...input,
    api: normalizeApiOverride(input.api, defaults.api),
    chaptersPerSegment: Math.max(1, Math.trunc(input.chaptersPerSegment ?? defaults.chaptersPerSegment) || 1),
    currentWindow: input.currentWindow !== false,
    剧情推进AI判定: input.剧情推进AI判定 === true,
    推进判定API: normalizeApiOverride(input.推进判定API, defaults.推进判定API),
    剧情对齐巡检: input.剧情对齐巡检 === true,
    剧情对齐巡检间隔: Math.max(2, Math.min(30, Math.trunc(input.剧情对齐巡检间隔 ?? defaults.剧情对齐巡检间隔) || defaults.剧情对齐巡检间隔)),
    世界演变: input.世界演变 === true,
  };
}

const 旧版默认记忆系统提示词 = {
  即时转短期提示词: '请把本批即时记忆整理成 1-2 条客观摘要，只保留发生了什么，不写感受。',
  短期转长期提示词: '请把多条短期记忆归纳为更稳定的长期记忆，保留关系、转折和不可逆事实。',
  NPC记忆压缩提示词: '请把与你同行的记忆整理得更凝练，保留称呼、约定、关系变化和关键事件。',
};

const 旧版NPC默认记忆压缩提示词 = [
  '你是伙伴系统的同行记忆整理器。请把某一名 NPC 的「与你同行的记忆」压缩为更凝练但有情感连续性的记录。',
  '必须保留：玩家与该 NPC 的初遇/关键共同经历、称呼变化、约定与亏欠、信任或冲突的原因、好感变化依据、对玩家的独特看法、正在等待兑现的承诺，以及会影响之后互动的私人细节。',
  '删除重复寒暄和纯场景描写。输出 3-6 条要点，每条尽量说明「事件 -> NPC 对玩家的认知/关系影响」。不要把其他 NPC 的记忆混进来，不要让关系突然跳变。',
].join('\n');

/** 默认提示词组：旧存档整组提示词迁移时一次性套用。 */
function 取默认提示词组(defaults: 记忆系统设置) {
  return {
    即时转短期提示词: defaults.即时转短期提示词,
    短期转中期提示词: defaults.短期转中期提示词,
    中期转长期提示词: defaults.中期转长期提示词,
    NPC记忆压缩提示词: defaults.NPC记忆压缩提示词,
    忆庭召回提示词: defaults.忆庭召回提示词,
    忆庭精炼提示词: defaults.忆庭精炼提示词,
  };
}

function 迁移记忆系统设置(input: unknown): Partial<记忆系统设置> {
  const defaults = 创建默认记忆系统设置();
  // 兼容读取：短期转长期阈值/提示词 为废弃兼容字段，经独立结构类型访问以避开废弃成员读取检查。
  const 原始 = (input ?? {}) as Partial<记忆系统设置> & {
    短期转长期阈值?: number;
    短期转长期提示词?: string;
  };
  // 版本戳必须是整数才认：被手改坏的版本一律按旧存档处理。
  const 存档版本 = 原始.记忆阈值契约版本;
  const 已契约 = Number.isInteger(存档版本) && (存档版本 as number) >= 记忆阈值契约版本;
  // 已打戳的存档阈值归玩家所有，不再嗅探；无戳的旧存档按历史默认组合迁移。
  const 阈值来源 = 已契约 ? 原始 : 迁移旧版阈值(原始, defaults);
  const 旧阈值 = 阈值来源 as { 短期转长期阈值?: number };

  const 迁移后: Partial<记忆系统设置> = {
    ...原始,
    即时转短期阈值: 阈值来源.即时转短期阈值,
    短期转中期阈值: 阈值来源.短期转中期阈值 ?? 旧阈值.短期转长期阈值,
    中期转长期阈值: 阈值来源.中期转长期阈值,
    NPC记忆压缩阈值: 阈值来源.NPC记忆压缩阈值,
    中期转长期提示词: 原始.中期转长期提示词 ?? 原始.短期转长期提示词,
  };
  const 使用旧版默认提示词 =
    !原始.即时转短期提示词 ||
    (
      原始.即时转短期提示词 === 旧版默认记忆系统提示词.即时转短期提示词 &&
      原始.短期转长期提示词 === 旧版默认记忆系统提示词.短期转长期提示词 &&
      原始.NPC记忆压缩提示词 === 旧版默认记忆系统提示词.NPC记忆压缩提示词
    );

  if (使用旧版默认提示词) {
    return { ...迁移后, ...取默认提示词组(defaults) };
  }

  if (原始.NPC记忆压缩提示词 === 旧版NPC默认记忆压缩提示词) {
    return { ...迁移后, NPC记忆压缩提示词: defaults.NPC记忆压缩提示词 };
  }

  return 迁移后;
}

export function 归一化记忆系统设置(input?: unknown): 记忆系统设置 {
  return 记忆系统设置Schema.parse(迁移记忆系统设置(input));
}

export function 创建默认游戏设置(): 游戏设置 {
  return {
    wordCountTarget: 500,
    narrativePerson: 'second',
    enableTavernKeeperPersona: true,
    enableActionOptions: false,
    enableMemoryInjection: true,
    enableWorldEvents: true,
    enableWorldbookInjection: true,
    enableInnerVoice: true,
    enableStreaming: true,
    devMode: false,
    enableClaudeMode: false,
    deepSeekMainMode: 'off',
    backgroundTaskMode: 'sequential',
    enableCacheDiagnostics: false,
    enableVariableUpdate: false,
    新闻系统: 创建默认星际和平周报设置(),
    手机系统: 创建默认手机系统设置(),
    智库系统: 创建默认智库系统设置(),
    剧情编织系统: 创建默认剧情编织系统设置(),
    文生图系统: 创建默认文生图系统设置(),
    记忆系统: 创建默认记忆系统设置(),
    // 默认关闭：改成逐句推进是阅读习惯的改变，不该替用户决定。
    逐句推进: { 启用: false, 立即全显: false },
    variableApi: 创建空变量API覆盖(),
    variableUpdateRequireConfirm: false,
    customPrompt: '',
    promptModules: createBuiltinPromptModules(),
    enableCotFakeHistory: true,
    enableTagRepair: true,
    autoRetryOnError: true,
    autoRetryCount: 2,
    enableAutoSaveEveryTurn: true,
    visualTextSettings: 创建默认视觉文本设置(),
    enableNsfw: false,
    enableMaleNsfwArchive: false,
    enableNoControl: true,
    enablePlayerSpeechExpansion: false,
    额外功能: 创建默认额外功能设置(),
    cotLanguage: 'zh',
    enableStPreset: true,
    stPresetsV2: [],
    currentStPresetIdV2: null,
    currentStCharacterId: null,
    stPostProcessMode: '未选择',
  };
}

export function 创建默认视觉文本设置(): VisualTextSettings {
  return {
    narrationFontSize: 15,
    dialogueFontSize: 15,
    playerFontSize: 14,
  };
}

export function 归一化视觉文本设置(input?: Partial<VisualTextSettings>): VisualTextSettings {
  const defaults = 创建默认视觉文本设置();
  const clamp = (value: unknown, fallback: number) => Math.max(13, Math.min(30, Math.trunc(Number(value) || fallback)));
  return {
    narrationFontSize: clamp(input?.narrationFontSize, defaults.narrationFontSize),
    dialogueFontSize: clamp(input?.dialogueFontSize, defaults.dialogueFontSize),
    playerFontSize: clamp(input?.playerFontSize, defaults.playerFontSize),
  };
}

export function 创建默认额外功能设置(): 额外功能设置 {
  return {
    污染词清理: {
      enabled: true,
      words: ['极其'],
    },
    标签块隐藏: {
      enabled: true,
    },
    玩家额外要求: '',
  };
}

export function 归一化额外功能设置(input?: Partial<额外功能设置>): 额外功能设置 {
  const defaults = 创建默认额外功能设置();
  const rawWords = input?.污染词清理?.words;
  const words = Array.isArray(rawWords)
    ? rawWords.map((word) => (word || '').trim()).filter(Boolean)
    : defaults.污染词清理.words;
  return {
    ...defaults,
    ...input,
    污染词清理: {
      ...defaults.污染词清理,
      ...(input?.污染词清理 ?? {}),
      words: words.length ? Array.from(new Set(words)).slice(0, 50) : defaults.污染词清理.words,
    },
    标签块隐藏: {
      ...defaults.标签块隐藏,
      ...(input?.标签块隐藏 ?? {}),
    },
    玩家额外要求: typeof input?.玩家额外要求 === 'string' ? input.玩家额外要求 : defaults.玩家额外要求,
  };
}

export type 主题预设 = 'deepspace' | 'starOceanCyan';
export type 存档类型 = 'manual' | 'auto' | 'backup' | 'imported';

export const LAST_VIEW_STORAGE_KEY = 'lastView';

export interface 存档数据 {
  id: number;
  type: 存档类型;
  timestamp: number;
  turnCount?: number;
  旅人: import('./character').角色数据结构;
  世界: import('./world').世界状态;
  chatHistory: import('./chat').聊天消息[];
  记忆: import('./memory').记忆系统;
  忆庭?: import('./yiting').忆庭系统;
  智库?: import('./zhiku').智库系统;
  手机?: import('./phone').手机系统;
  NPC?: import('./npc').NPC记录[];
  相册?: import('./imageGeneration').相册系统;
  /** @deprecated 不再读取或写入，仅允许旧存档携带后被忽略。 */
  战斗?: unknown;
  新闻?: import('./news').新闻条目[];
  剧情?: import('./plot').剧情节点[];
  剧情编织?: import('./storyWeaving').剧情编织系统;
  /** @deprecated 不再读取或写入，仅允许旧存档携带后被忽略。 */
  阵营?: unknown;
  variableBatches?: import('./variableCommand').变量命令批次[];
  /** 新代码不得直接依赖该字段做跨插件协调；读取统一经 hooks/useGame/turnActionRuntime 的账本适配器。 */
  queueTasks?: import('./queueTask').队列任务记录[];
  /** 随 newest/checkpoint 提交，不走 settings 通道。 */
  macroGlobalVars?: Record<string, string>;
  /** 随 newest/checkpoint 提交，不走 settings 通道。 */
  worldbookTriggerStates?: Record<string, number>;
  /** 活跃叶子 ephemeral 字段，生命周期见 models/leafLifecycle.ts / models/turnRecovery.ts。 */
  turnPhase?: import('./turnRecovery').TurnPhase | null;
  recoveryContext?: import('./turnRecovery').TurnRecoveryContext | null;
}

/** These values never belong to a game save. */
export interface DeviceSettings {
  apiSettings: API设置;
  gameSettings: 游戏设置;
  theme: 主题预设;
  worldbooks: import('./worldbook').世界书[];
}

export type GameData = 存档数据;

export type RuntimeSaveData = 存档数据 & Pick<DeviceSettings, 'apiSettings' | 'gameSettings' | 'theme'>;

export interface SaveEnvelope {
  id: number;
  type: 存档类型;
  timestamp: number;
  turnCount?: number;
  gameData: GameData;
  saveTree?: unknown;
}

/** Legacy flat save fields are accepted only at the migration seam. */
export interface LegacySaveDeviceSettings {
  apiSettings?: API设置;
  gameSettings?: 游戏设置;
  theme?: 主题预设;
  worldbooks?: import('./worldbook').世界书[];
}

export type LegacySaveData = 存档数据 & LegacySaveDeviceSettings;

export function createSaveEnvelope(save: GameData): SaveEnvelope {
  const gameData = save;
  return {
    id: save.id,
    type: save.type,
    timestamp: save.timestamp,
    turnCount: save.turnCount,
    gameData,
    ...(('saveTree' in save && save.saveTree) ? { saveTree: save.saveTree } : {}),
  };
}

export function hydrateSaveEnvelope(envelope: SaveEnvelope, device: DeviceSettings): RuntimeSaveData {
  return {
    ...envelope.gameData,
    id: envelope.id,
    type: envelope.type,
    timestamp: envelope.timestamp,
    turnCount: envelope.turnCount,
    gameSettings: device.gameSettings,
    apiSettings: device.apiSettings,
    theme: device.theme,
  };
}

/** 新格式取顶层两键；旧档的 settings 投影里仍有 gameSettings 残留两键。 */
type 运行态键迁移输入 = 存档数据 | ({
  gameSettings?: 游戏设置 & {
    macroGlobalVars?: Record<string, string>;
    worldbookTriggerStates?: Record<string, number>;
  };
  macroGlobalVars?: Record<string, string>;
  worldbookTriggerStates?: Record<string, number>;
});

/** 顶层两运行态键优先，缺省时从 `gameSettings` 残留读取（旧档），并在返回值里置空原键。纯函数，不回写存储。 */
export function 迁移存档运行态键<T extends 运行态键迁移输入>(
  save: T,
): {
  save: T;
  macroGlobalVars: Record<string, string>;
  worldbookTriggerStates: Record<string, number>;
} {
  const legacySettings = 'gameSettings' in save ? save.gameSettings : undefined;
  const 残留宏变量 = legacySettings?.macroGlobalVars;
  const 残留触发态 = legacySettings?.worldbookTriggerStates;
  const 顶层宏变量 = save.macroGlobalVars;
  const 顶层触发态 = save.worldbookTriggerStates;
  return {
    save: {
      ...save,
      ...(legacySettings ? {
        gameSettings: {
          ...legacySettings,
          macroGlobalVars: undefined,
          worldbookTriggerStates: undefined,
        },
      } : {}),
    },
    macroGlobalVars: (顶层宏变量 && typeof 顶层宏变量 === 'object' ? 顶层宏变量 : 残留宏变量) ?? {},
    worldbookTriggerStates: (顶层触发态 && typeof 顶层触发态 === 'object' ? 顶层触发态 : 残留触发态) ?? {},
  };
}
