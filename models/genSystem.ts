/**
 * 文生图（智绘姬移植版）数据模型。
 *
 * 派生自 st-chatu8（智绘姬）`utils/config.js` 的 `defaultSettings`（L2437-L3215）、
 * `utils/characterprompt.js` 的 `CHARACTER_FIELDS`（L33113-L33128）与
 * `defaultCharacterSettings`（L24604-L24700）。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：把原插件的扁平 extension_settings 对象改写为 TypeScript 类型与
 *   归一化函数；原插件把 320 个键混在一个对象里，这里按域拆分为
 *   设置 / 角色卡 / 词库 / 缓存 四组，并删除了视频（RunningHub、ComfyUI 视频）
 *   与尚未接入的渠道字段。
 *
 * 命名沿用移植方的领域中文，与来源字段名保持可对照关系（见每条注释）。
 */

import { 人物生成默认提示词 } from '@/prompts/cot/characterFeaturePrompt';

/** 生图渠道。第一轮只实现 ComfyUI；其余为后续轮次登记位。 */
export type 生图渠道 = 'comfyui' | 'novelai' | 'sd' | 'banana' | 'runninghub';

export const 生图渠道列表: 生图渠道[] = ['comfyui', 'novelai', 'sd', 'banana', 'runninghub'];

/** 设置面板的页签，对齐原插件 `html/settings/*.html`。 */
export type 设置页签 = 'overview' | 'comfyui' | 'prompt' | 'character' | 'vocabulary' | 'cache' | 'logs' | 'about';

export interface 占位符定义 {
  占位符: string;
  名称: string;
  匹配键: string[];
  类型: 'number' | 'string';
}

/** 生成期传给 `替换工作流占位符` 的取值集。 */
export interface 占位符取值 {
  seed: number | string;
  steps: number | string;
  cfgScale: number | string;
  samplerName: string;
  scheduler: string;
  width: number | string;
  height: number | string;
  prompt: string;
  negativePrompt: string;
  modelName: string;
  vae: string;
  clip: string;
  ipaPreset: string;
  ipaWeight: number | string;
  ipaFaceWeight: number | string;
  ipaDetailStrength: number | string;
  ipaAtmosphereStrength: number | string;
  referenceImage: string;
  inpaintImage?: string;
  inpaintMask?: string;
  inpaintDenoise?: number | string;
  inpaintPositive?: string;
  inpaintNegative?: string;
}

/* ------------------------------------------------------------------ *
 * 固定提示词预设（来源：settings.yushe / yusheid_*）
 * ------------------------------------------------------------------ */

/** 原插件 `yushe[name]`。`fixedPrompt` 支持 `<lora:name:weight>` 文本标签。 */
export interface 提示词预设 {
  正面固定: string;
  /** 追加在正面主体之后的收尾片段（来源 `fixedPrompt_end`，语义未变，保持原名以免误配）。 */
  fixedPromptEnd: string;
  负面固定: string;
  正面质量: string;
  负面质量: string;
  createdAt: number;
  updatedAt: number;
}

/** 提示词替换规则集（来源：settings.prompt_replace）。 */
export interface 替换规则集 {
  /** 规则原文，每行一条：`触发词 = 动作 | 值 [@if(条件)]`。 */
  规则文本: string;
  createdAt: number;
  updatedAt: number;
}

/** LLM（LLM 生成插图提示词）的上下文条目，来源 `test_context_profiles[].entries[]`。 */
export interface LLM条目 {
  id: string;
  name: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  enabled: boolean;
  触发方式: 'always' | 'keyword' | 'manual';
  触发词: string[];
  与触发: boolean;
}

export interface LLM预设 {
  entries: LLM条目[];
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ *
 * 角色卡（来源：defaultCharacterSettings / CHARACTER_FIELDS）
 * ------------------------------------------------------------------ */

/**
 * 原插件 `CHARACTER_FIELDS`（L33113-L33128）的 14 个部位字段 + 负面。
 *
 * 保留两个历史命名陷阱，不做「纠偏」，否则老预设导入后字段会错位：
 * - `fullBodySFW*` / `fullBodyNSFW*` 实际承载**下半身**（界面文案为「下半身」）。
 * - `negative` 未进入原插件默认值与导出加密字段列表，导入导出时按明文处理。
 */
export interface 角色部位字段 {
  nameCN: string;
  nameEN: string;
  characterTraits: string;
  facialFeatures: string;
  facialFeaturesBack: string;
  upperBodySFW: string;
  upperBodySFWBack: string;
  fullBodySFW: string;
  fullBodySFWBack: string;
  upperBodyNSFW: string;
  upperBodyNSFWBack: string;
  fullBodyNSFW: string;
  fullBodyNSFWBack: string;
  negative: string;
}

export const 角色部位字段名: (keyof 角色部位字段)[] = [
  'nameCN', 'nameEN', 'characterTraits',
  'facialFeatures', 'facialFeaturesBack',
  'upperBodySFW', 'upperBodySFWBack',
  'fullBodySFW', 'fullBodySFWBack',
  'upperBodyNSFW', 'upperBodyNSFWBack',
  'fullBodyNSFW', 'fullBodyNSFWBack',
  'negative',
];

/** 单张媒体（角色卡参考图 / 音频）。来源 `normalizeMediaEntry` L24485-L24498。 */
export interface 角色媒体 {
  id: string;
  name: string;
  /** 缓存库中的图片 id；图片本体不进设置，避免设置膨胀。 */
  cacheImageId?: string;
  mimeType?: string;
  用途: 'reference' | 'photo' | 'audio';
}

/** 服装预设条目。来源 `settings.outfitPresets[<id>]` L24645-L24664。 */
export interface 服装条目 {
  id: string;
  name: string;
  上半身: string;
  下半身: string;
  全身: string;
  负面: string;
  /**
   * 以下四项是可选扩展：上游的服装还有「英文名称 / 归属人 / 上半身背面 / 下半身背面」，
   * 而本仓库早先只落了四段正文。旧存档没有这些字段，缺省按空串处理；
   * 有了它们，`from behind` 视角与注入模板 `{nameEN}` / `{upperBodyBack}` 才有真实内容。
   */
  英文名称?: string;
  归属人?: string;
  上半身背面?: string;
  下半身背面?: string;
}

/**
 * NovelAI 角色参考条目。来源 `settings.charRefGroups[组].references[]`
 * （`ensureCharRefGroups` L92392-L92439）。
 *
 * 注意 `保真度` **不上行**：上游把 `fidelity` 存起来但发送的是 `1 - strength`
 * （L84068）。保留该字段是为了与上游设置结构一致、便于导入旧配置。
 */
export interface 角色参考条目 {
  媒体Id: string;
  类型: 'character' | 'character_style' | 'style';
  /** 0..1，发送为 `director_reference_strength_values`。 */
  强度: number;
  /** 0..1；存储用，不发送。 */
  保真度: number;
}

/** NovelAI 角色参考组。上游上限 4 张（L93410-L93414）。 */
export interface 角色参考组 {
  references: 角色参考条目[];
  createdAt: number;
  updatedAt: number;
}

/** 上游硬上限：每组最多 4 张参考图。 */
export const 角色参考上限 = 4;

export interface 角色卡 extends 角色部位字段 {
  id: string;
  enabled: boolean;
  /** 别名，`|` 分隔；参与名称匹配。 */
  aliases: string[];
  outfits: 服装条目[];
  selectedOutfitId: string;
  photoMedia: 角色媒体[];
  audioMedia: 角色媒体[];
  selectedPhotoId: string;
  selectedAudioId: string;
  photoPrompt: string;
  sendPhoto: boolean;
  /**
   * NovelAI 角色参考组；其它渠道用自己的参考图机制。
   *
   * 可选：早期版本创建的角色卡没有这个字段，归一化时补默认空组。
   */
  参考组?: 角色参考组;
  /** 归一化后的角色位置（原插件由 `centersToCoordinates` 从提示词文本解析）。 */
  位置: 角色位置 | null;
  createdAt: number;
  updatedAt: number;
}

/** 角色位置：数值坐标 [0,1]，或 5×5 网格标记（如 `c3`）。 */
export interface 角色位置 {
  mode: 'center' | 'grid';
  x: number;
  y: number;
  grid?: string;
}

export function 创建空角色部位字段(): 角色部位字段 {
  return {
    nameCN: '',
    nameEN: '',
    characterTraits: '',
    facialFeatures: '',
    facialFeaturesBack: '',
    upperBodySFW: '',
    upperBodySFWBack: '',
    fullBodySFW: '',
    fullBodySFWBack: '',
    upperBodyNSFW: '',
    upperBodyNSFWBack: '',
    fullBodyNSFW: '',
    fullBodyNSFWBack: '',
    negative: '',
  };
}

/* ------------------------------------------------------------------ *
 * 角色启用列表 / 通用列表 / 提示词注入模板 / 角色 AI
 * （来源：`characterEnablePresets` L24667-L24686、`characterCommonPresets`、
 *   `outfitEnablePresets`、`injectionTemplates` L29628-L29755、`characterAI` L24688）
 * ------------------------------------------------------------------ */

/**
 * 启用列表里的一条角色记录。
 *
 * 上游的条目是**对象**而不是裸名字（`normalizeCharacterEnableEntry` L24528-L24543）：
 * 每条可以各自绑定一张图片与一段音频，注入 `{{角色启用列表}}` 时用条目上的
 * 覆盖值，没有再回退到角色卡自己的照片/音频。裸字符串是旧格式，归一化时补齐。
 */
export interface 角色启用条目 {
  角色Id: string;
  /** 覆盖角色卡选中的照片；空串表示回退角色卡。 */
  图片媒体Id: string;
  音频媒体Id: string;
  图片描述: string;
  音频描述: string;
}

/** 一个启用列表预设。`绑定*` 是上游的「绑定角色卡 / 绑定聊天记录」，仅作标记与提示。 */
export interface 角色启用预设 {
  条目: 角色启用条目[];
  绑定角色卡: string;
  绑定聊天: string;
}

/** 通用角色列表（`characterCommonPresets[id].characters`）。 */
export interface 通用角色列表预设 {
  角色: string[];
}

/** 通用服装启用列表（`outfitEnablePresets[id].outfits`）。 */
export interface 通用服装列表预设 {
  服装: string[];
}

/**
 * 提示词注入模板（`injectionTemplates.presets[id]`）。
 *
 * `{变量}` 占位符由 `应用注入模板` 渲染；**整行占位符全为空时该行被丢掉**，
 * 全部占位行都被丢掉时整体返回空串（`applyInjectionTemplate` L29201-L29230）。
 */
export interface 注入模板集 {
  角色列表: string;
  卡内服装: string;
  通用角色列表: string;
  通用服装列表: string;
}

/**
 * 角色 AI（`characterAI` L24688）：一键生成角色特征用的提示词与采样参数。
 *
 * 上游还有 `model` 字段，本应用改为与出图 LLM 一致的四段式 API 覆盖：
 * 留空即回退「文生图 → LLM 预设」的接口，再回退主 API。
 */
export interface 角色AI设置 {
  提示词: string;
  温度: number;
  最大输出: number;
  API: { provider: string; baseUrl: string; apiKey: string; model: string };
}

export const 默认启用预设名 = '默认启用列表';
export const 默认通用角色列表名 = '默认通用角色列表';
export const 默认通用服装列表名 = '默认服装列表';
export const 默认注入模板名 = '默认方案';

/**
 * 上游内置的四套注入模板（`SYSTEM_INJECTION_TEMPLATES` L29634-L29755），逐字收录。
 *
 * 差异说明：上游只有「默认方案」是内建默认，其余三套（含 `视频注入`）在
 * `ensureInjectionTemplatesInit` 里注册。本应用一并内建，但默认当前模板取
 * 「默认方案」——上游把当前模板指向「视频注入」是因为它有自己的视频链路，本应用没有。
 */
export const 内置注入模板: Record<string, 注入模板集> = {
  默认方案: {
    角色列表: [
      '中文名称：{nameCN}',
      '英文名称：{nameEN}',
      '角色特征：{traits}',
      '五官外貌（正面）：{facial}',
      '五官外貌（背面）：{facialBack}',
      '上半身SFW（正面）：{upperSFW}',
      '上半身SFW（背面）：{upperSFWBack}',
      '下半身SFW（正面）：{lowerSFW}',
      '下半身SFW（背面）：{lowerSFWBack}',
      '上半身NSFW（正面）：{upperNSFW}',
      '上半身NSFW（背面）：{upperNSFWBack}',
      '下半身NSFW（正面）：{lowerNSFW}',
      '下半身NSFW（背面）：{lowerNSFWBack}',
      '服装列表：{outfits}',
      '角色图片：[{imageId}] {imageDesc}',
      '角色音频：[{audioId}] {audioDesc}',
    ].join('\n'),
    卡内服装: [
      '  中文名称：{nameCN}',
      '  英文名称：{nameEN}',
      '  上半身（正面）：{upperBody}',
      '  上半身（背面）：{upperBodyBack}',
      '  下半身（正面）：{lowerBody}',
      '  下半身（背面）：{lowerBodyBack}',
    ].join('\n'),
    通用角色列表: '{nameCN} {nameEN}',
    通用服装列表: [
      '中文名称：{nameCN}',
      '英文名称：{nameEN}',
      '上半身（正面）：{upperBody}',
      '上半身（背面）：{upperBodyBack}',
      '下半身（正面）：{lowerBody}',
      '下半身（背面）：{lowerBodyBack}',
    ].join('\n'),
  },
  'Tavern XML 格式': {
    角色列表: [
      '<character id="{nameEN}" cn="{nameCN}">',
      '  [Traits] {traits}',
      '  [Face] Front: {facial}',
      '  [Face] Back: {facialBack}',
      '  [SFW] Upper: {upperSFW}',
      '  [SFW] Lower: {lowerSFW}',
      '  [NSFW] Upper: {upperNSFW}',
      '  [NSFW] Lower: {lowerNSFW}',
      '  [Outfits]{outfits}',
      '  [Image] {imageId}: {imageDesc}',
      '  [Audio] {audioId}: {audioDesc}',
      '</character>',
    ].join('\n'),
    卡内服装: [
      '  <outfit id="{nameEN}" cn="{nameCN}">',
      '    [Upper] {upperBody}',
      '    [Lower] {lowerBody}',
      '  </outfit>',
    ].join('\n'),
    通用角色列表: '<common_character id="{nameEN}" cn="{nameCN}" />',
    通用服装列表: [
      '<common_outfit id="{nameEN}" cn="{nameCN}">',
      '  [Upper] {upperBody}',
      '  [Lower] {lowerBody}',
      '</common_outfit>',
    ].join('\n'),
  },
  'Markdown 极简卡片': {
    角色列表: [
      '### {nameCN}（{nameEN}）',
      '- 特征：{traits}',
      '- 五官：{facial}',
      '- 上半身：{upperSFW}',
      '- 下半身：{lowerSFW}',
      '- 上半身NSFW：{upperNSFW}',
      '- 下半身NSFW：{lowerNSFW}',
      '- 服装：{outfits}',
      '- 图片：[{imageId}] {imageDesc}',
      '- 音频：[{audioId}] {audioDesc}',
    ].join('\n'),
    卡内服装: [
      '  - **{nameCN}**（{nameEN}）',
      '    - 上半身：{upperBody}',
      '    - 下半身：{lowerBody}',
    ].join('\n'),
    通用角色列表: '- {nameCN}（{nameEN}）',
    通用服装列表: [
      '### {nameCN}（{nameEN}）',
      '- 上半身：{upperBody}',
      '- 下半身：{lowerBody}',
    ].join('\n'),
  },
  视频注入: {
    角色列表: [
      '<character id="{nameEN}" cn="{nameCN}">',
      '  [Traits] {traits}',
      '  [image_id]:{imageId} 说明:{imageDesc}',
      '  [audio_id]:{audioId} 说明:{audioDesc}',
      '  [Face] Front: {facial}',
      '  [Face] Back: {facialBack}',
      '  [SFW] Upper: {upperSFW}',
      '  [SFW] Lower: {lowerSFW}',
      '  [NSFW] Upper: {upperNSFW}',
      '  [NSFW] Lower: {lowerNSFW}',
      '  [Outfits]{outfits}',
      '</character>',
    ].join('\n'),
    卡内服装: [
      '  <outfit id="{nameEN}" cn="{nameCN}">',
      '    [Upper] {upperBody}',
      '    [Lower] {lowerBody}',
      '  </outfit>',
    ].join('\n'),
    通用角色列表: '<common_character id="{nameEN}" cn="{nameCN}" />',
    通用服装列表: [
      '<common_outfit id="{nameEN}" cn="{nameCN}">',
      '  [Upper] {upperBody}',
      '  [Lower] {lowerBody}',
      '</common_outfit>',
    ].join('\n'),
  },
};

export const 内置注入模板名列表 = Object.keys(内置注入模板);

/** 归一化一条启用条目：裸字符串（旧格式）补齐成对象。 */
export function 归一化角色启用条目(input: unknown): 角色启用条目 | null {
  if (typeof input === 'string') {
    const 名 = input.trim();
    return 名 ? { 角色Id: 名, 图片媒体Id: '', 音频媒体Id: '', 图片描述: '', 音频描述: '' } : null;
  }
  if (!input || typeof input !== 'object') return null;
  const 源 = input as Record<string, unknown>;
  // 上游接受的别名：`characterPresetName || name || presetName`（L24538）。
  const 角色Id = String(源.角色Id ?? 源.characterPresetName ?? 源.name ?? 源.presetName ?? '').trim();
  if (!角色Id) return null;
  return {
    角色Id,
    图片媒体Id: String(源.图片媒体Id ?? 源.imageFileId ?? ''),
    音频媒体Id: String(源.音频媒体Id ?? 源.audioFileId ?? ''),
    图片描述: String(源.图片描述 ?? 源.imageDescription ?? ''),
    音频描述: String(源.音频描述 ?? 源.audioDescription ?? ''),
  };
}

export function 归一化角色启用预设(input: unknown): 角色启用预设 {
  const 源 = (input ?? {}) as Record<string, unknown>;
  const 原条目 = Array.isArray(源.条目)
    ? 源.条目
    : Array.isArray(源.characters)
      ? 源.characters
      : [];
  const 条目: 角色启用条目[] = [];
  const 已见 = new Set<string>();
  for (const 项 of 原条目) {
    const 归一 = 归一化角色启用条目(项);
    if (!归一 || 已见.has(归一.角色Id)) continue;
    已见.add(归一.角色Id);
    条目.push(归一);
  }
  return {
    条目,
    绑定角色卡: String(源.绑定角色卡 ?? 源.bindCharacterCard ?? ''),
    绑定聊天: String(源.绑定聊天 ?? 源.bindChatId ?? ''),
  };
}

/** 启用预设 → 扁平的 id 列表（`角色启用列表` 是它镜像出来的供引擎读取的视图）。 */
export function 镜像启用列表(预设: 角色启用预设 | undefined): string[] {
  return (预设?.条目 ?? []).map((项) => 项.角色Id).filter(Boolean);
}

export function 归一化注入模板集(input: unknown): 注入模板集 {
  const 源 = (input ?? {}) as Record<string, unknown>;
  const 默认 = 内置注入模板[默认注入模板名];
  return {
    角色列表: String(源.角色列表 ?? 源.characterListTemplate ?? 默认.角色列表),
    卡内服装: String(源.卡内服装 ?? 源.innerOutfitTemplate ?? 默认.卡内服装),
    通用角色列表: String(源.通用角色列表 ?? 源.commonCharacterListTemplate ?? 默认.通用角色列表),
    通用服装列表: String(源.通用服装列表 ?? 源.enableOutfitListTemplate ?? 默认.通用服装列表),
  };
}

export function 创建默认角色启用预设列表(): Record<string, 角色启用预设> {
  return { [默认启用预设名]: { 条目: [], 绑定角色卡: '', 绑定聊天: '' } };
}

export function 创建默认注入模板列表(): Record<string, 注入模板集> {
  const 结果: Record<string, 注入模板集> = {};
  for (const [名称, 模板] of Object.entries(内置注入模板)) 结果[名称] = { ...模板 };
  return 结果;
}

/* ------------------------------------------------------------------ *
 * 词库（来源：tagData/*.json 解密后的结构、IndexedDB 模式 L5042-L5097）
 * ------------------------------------------------------------------ */

/** 扁平词库条目（`danbooru_NNN.json` 的 `danbooru_tag[]`）。 */
export interface 词条 {
  name: string;
  translation: string;
  /** 热度；`-1` 表示未知，排序时置顶（与来源一致）。 */
  hot: number;
  fileName: string;
  subgroupId?: number;
}

export interface 词库分组 {
  idIndex: number;
  name: string;
  color: string;
  fileName: string;
}

export interface 词库子分组 {
  idIndex: number;
  groupId: number;
  name: string;
  color: string;
  fileName: string;
}

export interface 已装词库 {
  fileName: string;
  tagCount: number;
  installedDate: number;
}

/** 词库树（`getTagsTreeData` L6499-L6547 的返回结构）。 */
export interface 词库树 {
  groups: Array<词库分组 & { subgroups: Array<词库子分组 & { tags: Array<{ text: string; desc: string }> }> }>;
}

/* ------------------------------------------------------------------ *
 * 图片缓存（来源：IndexedDB `chatu8_gallery` / `tupianhuancun` 与
 *          `setItemImg` / `getMergedAndSortedImages`）
 * ------------------------------------------------------------------ */

/**
 * 缓存条目。来源以 **提示词原文的 MD5** 为键（`getItemImg` L4571-L4584），
 * 因此同一提示词的多次生成会累积成一条有序图廊。
 */
export interface 图片缓存条目 {
  /** 提示词 MD5。 */
  id: string;
  prompt: string;
  imageIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface 缓存图片 {
  id: string;
  entryId: string;
  mimeType: string;
  width?: number;
  height?: number;
  size?: number;
  /** 生成参数快照，供「查看生成参数」使用。 */
  genParams?: 生成参数快照;
  createdAt: number;
}

export interface 生成参数快照 {
  渠道: 生图渠道;
  模型?: string;
  预设?: string;
  正向提示词?: string;
  负向提示词?: string;
  宽度?: number;
  高度?: number;
  种子?: number;
  步数?: number;
  采样器?: string;
  调度器?: string;
  cfg?: number;
}

/* ------------------------------------------------------------------ *
 * 设置主体
 * ------------------------------------------------------------------ */

/** ComfyUI 连接与并发。来源 `comfyuiUrl` / `comfyui_max_concurrency` / `comfyui_timeout`。 */
export interface ComfyUI连接设置 {
  地址: string;
  最大并发: number;
  /** 秒。来源 `comfyui_timeout`，默认 1800。 */
  超时秒数: number;
  保活: boolean;
}

/** ComfyUI 生成参数。来源 `MODEL_NAME` / `comfyui_*` / `cfg_comfyui`。 */
export interface ComfyUI参数设置 {
  模型: string;
  采样器: string;
  调度器: string;
  vae: string;
  clip: string;
  宽度: number;
  高度: number;
  步数: number;
  种子: number;
  cfg: number;
  ipa预设: string;
  ipa权重: number;
  ipa面部权重: number;
  ipa细节强度: number;
  氛围强度: number;
  重绘强度: number;
}

/** 一个 ComfyUI 配置档案，对齐 `comfyui_profiles[<name>]`。 */
export interface ComfyUI档案 {
  连接: ComfyUI连接设置;
  参数: ComfyUI参数设置;
  /** 当前使用的 API 格式工作流 JSON 文本。 */
  工作流Json: string;
}

export interface ComfyUI设置 {
  当前档案: string;
  档案列表: Record<string, ComfyUI档案>;
  /** AI 自主决定分辨率：允许模型在提示词里写 `960x1280` 覆盖全局尺寸。 */
  自主分辨率: boolean;
  参考图上传: boolean;
}

/** 提示词设置。来源 `yushe` / `prompt_replace` / `AQT_*` / `UCP_*`。 */
export interface 提示词设置 {
  预设列表: Record<string, 提示词预设>;
  当前预设: string;
  随机预设: boolean;
  替换规则列表: Record<string, 替换规则集>;
  当前替换规则: string;
  正面质量: string;
  负面质量: string;
  /** NSFW 词汇替换（来源 `aiReplacement` / `word_replacement_profiles`）。 */
  词汇替换: string;
  /**
   * 固定画风：跨预设生效的固定提示词。
   *
   * 与「预设里的固定片段」的区别：预设是按作品/场景切换的，而画风是**一直要**的，
   * 换预设时不该跟着变。所以单独一层，永远叠加在最外侧。
   */
  固定画风: 固定画风设置;
}

export interface 固定画风设置 {
  启用: boolean;
  /** 前置：拼在整条正面提示词最前面（画风锚点一般放这里）。 */
  前置: string;
  /** 后置：拼在正面提示词末尾、质量词之前。 */
  后置: string;
  /** 负面：并入负面提示词，排在预设负面之后。 */
  负面: string;
}

/** LLM设置。来源 `test_context_profiles` / `llm_profiles`。 */
export interface LLM设置 {
  启用: boolean;
  当前预设: string;
  预设列表: Record<string, LLM预设>;
  温度: number;
  重试次数: number;
  /**
   * 单次回复的输出上限（token）。
   *
   * 必须可配且默认给足：社区预设要求一次产出多张图的提示词，
   * 每张可能几百 token，给 4096 会在半途被截断（实测现象），
   * 而截断的回复里往往连一个完整的 `image###…###` 都没有，看起来就像「没输出」。
   */
  最大输出: number;
  /** 留空回退主 API。 */
  API: { provider: string; baseUrl: string; apiKey: string; model: string };
}

/** NovelAI 设置。来源 `novelaiApi` / `novelaimode` / `novelai_*` / `nai3*`（L2642-L2739、L84480-L84518）。 */
export interface NovelAI设置 {
  地址: string;
  Token: string;
  /** 模型 id，如 `nai-diffusion-4-5-full` / `nai-diffusion-5-full`。 */
  模型: string;
  宽度: number;
  高度: number;
  步数: number;
  /** 提示词关联性（`nai3Scale`）。 */
  关联性: number;
  采样器: string;
  噪点表: string;
  种子: number;
  cfgRescale: number;
  /** 动态阈值（`nai3Deceisp`）。 */
  动态阈值: boolean;
  /** Variety Boost（`nai3Variety`），关闭时 `skip_cfg_above_sigma` 发 null。 */
  多样性增强: boolean;
  sm: boolean;
  sm_dyn: boolean;
  /** AI 默认角色位置（`AI_use_coords`）：开启时忽略解析出的坐标。 */
  AI默认位置: boolean;
  /** `normalizeRefStrength`：开启后 4.5 full/curated 反而交给 NAI 自己归一化。 */
  参考强度归一化: boolean;
  /** 参考图的信息提取量（`InformationExtracted`），0..1。 */
  信息提取: number;
  /**
   * 参考模式：`character` 发图片（Director Reference，字段 `director_reference_*`），
   * `vibe` 发编码串（字段 `reference_image_multiple_cached`）。
   * 两者互斥——同一份载荷同时带两套字段没有意义，也会让服务端行为难以预测。
   */
  参考模式: 'character' | 'vibe';
}

/** SD WebUI（A1111 / Forge）设置。来源 `sdUrl` / `sd_*` / `restoreFaces`（L2647-L2691、L80070-L80109）。 */
export interface SD设置 {
  地址: string;
  /** 基础认证，`user:pass` 形式；留空则不发。 */
  认证: string;
  模型: string;
  采样器: string;
  调度器: string;
  VAE: string;
  宽度: number;
  高度: number;
  步数: number;
  cfg: number;
  种子: number;
  /** CLIP_stop_at_last_layers。 */
  CLIP跳过层: number;
  /** restore_faces。 */
  面部修复: boolean;
  /** Hires fix。 */
  高清修复: boolean;
  高清放大算法: string;
  高清放大倍数: number;
  高清第二轮步数: number;
  高清去噪强度: number;
  /** ADetailer 面部重绘，需要装对应扩展。 */
  ADetailer: boolean;
}

/**
 * Banana / Grok 设置。来源 `banana.*`（L3073 `imageSize` 等）与
 * `generateBananaImage` 的载荷段（L48300-L48435）。
 *
 * 上游走 OpenAI 兼容的「独立纯文生图接口」`/v1/images/generations`；
 * 带参考图时改走 `/v1/images/edits`。本应用目前只做前者。
 */
export interface Banana设置 {
  地址: string;
  APIKey: string;
  模型: string;
  /** `宽x高`，如 `1024x1024`；`imagen*` 模型会忽略它。 */
  尺寸: string;
  /** 自定义 generations 端点；留空则按 `地址` 推导。 */
  自定义端点: string;
  /** 响应里是否要求 b64；`none` 表示不发该字段。 */
  响应格式: 'none' | 'url' | 'b64_json';
  /**
   * 参考图的发送形态。`form_data` 是上游默认（multipart 文件上传），
   * 部分中转站只认 `json`（把参考图塞进载荷的 image 字段）。
   */
  编辑格式: 'form_data' | 'json';
  /** 是否启用参考图（走 `/v1/images/edits`）。 */
  参考图上传: boolean;
}

export interface 文生图系统设置 {
  启用: boolean;
  渠道: 生图渠道;
  comfyui: ComfyUI设置;
  novelai: NovelAI设置;
  sd: SD设置;
  banana: Banana设置;
  提示词: 提示词设置;
  LLM: LLM设置;
  角色卡: Record<string, 角色卡>;
  /**
   * 当前启用的角色 id 列表。
   *
   * 它是**当前启用预设的镜像**：真正的数据在 `角色启用预设列表[当前启用预设]`，
   * 每次改预设都会同步这一份。保留扁平视图是为了让出图引擎（`$…$` 匹配、
   * 参考图挑选、NovelAI Vibe）不必关心预设概念。
   */
  角色启用列表: string[];
  角色启用预设列表: Record<string, 角色启用预设>;
  当前启用预设: string;
  /** `{{通用角色启用列表}}` 的数据源。 */
  通用角色列表: Record<string, 通用角色列表预设>;
  当前通用角色列表: string;
  /** `{{通用服装启用列表}}` 的数据源。 */
  通用服装列表: Record<string, 通用服装列表预设>;
  当前通用服装列表: string;
  注入模板列表: Record<string, 注入模板集>;
  当前注入模板: string;
  /** 一键生成角色特征。 */
  角色AI: 角色AI设置;
  /** 正文自动配图：每条正文最多几张、触发时机。 */
  正文配图: 正文配图设置;
  图片缓存: 图片缓存设置;
  显示插件提示: boolean;
  /** 兼容旧资源槽位的开关，见 models/imageGeneration 的槽位枚举。 */
  沿用槽位归档: boolean;
}

export interface 正文配图设置 {
  启用: boolean;
  模式: 'auto' | 'manual';
  /** 每条正文最多生成几张；`0` 表示不限制（由模型输出的图数决定）。 */
  每轮上限: number;
  /** 触发时机，对齐原插件 GENERATION_ENDED 之后的行为。 */
  时机: 'immediate' | 'queue_background';
  插入原文: boolean;
  /** 默认是否在正文里显示插图。关闭后插图只以一行折叠条存在，点开才显示。 */
  默认显示: boolean;
  /** 默认展开（直接显示图片）还是折叠（只显示一行标题）。 */
  默认展开: boolean;
}

export interface 图片缓存设置 {
  启用: boolean;
  /** 保留天数；`0` 表示永久。 */
  保留天数: number;
  转存JPEG: boolean;
}

export function 创建默认ComfyUI设置(): ComfyUI设置 {
  return {
    当前档案: '默认',
    档案列表: {
      默认: {
        连接: { 地址: 'http://localhost:8188', 最大并发: 10, 超时秒数: 1800, 保活: true },
        参数: {
          模型: '连接后选择',
          采样器: '连接后选择',
          调度器: '连接后选择',
          vae: '连接后选择',
          clip: '连接后选择',
          宽度: 1024,
          高度: 1024,
          步数: 28,
          种子: 0,
          cfg: 6,
          ipa预设: 'STANDARD (medium strength)',
          ipa权重: 0.8,
          ipa面部权重: 1.1,
          ipa细节强度: 0.8,
          氛围强度: 0.8,
          重绘强度: 0.75,
        },
        工作流Json: '',
      },
    },
    自主分辨率: true,
    参考图上传: true,
  };
}

/** 默认 NSFW 词汇替换，逐字来自 `defaultSettings` L2470-L2471。 */
export const 默认词汇替换 = [
  '肉棒=🥒',
  '小穴=🌸',
  '女孩=♀👶🏻',
  '少女=♀🧒🏻',
  '男孩=♂👶🏻',
  '正太=♂👶🏻',
  '小孩子=👧🏻',
  '乱伦=⚠️💘',
  '色情=🔞',
  '岁=🎄',
  '小学=🏬',
  '小学生=🧒🏻',
  '女儿=👧🏼',
  '儿子=👦🏼',
  '萝莉=♀👶🏻',
  '幼女=♀👶🏻',
].join('\n');

export function 创建默认提示词设置(): 提示词设置 {
  return {
    预设列表: {
      默认: {
        正面固定: '',
        fixedPromptEnd: '',
        负面固定: '',
        正面质量: 'best quality, amazing quality, very aesthetic, absurdres',
        负面质量: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
    当前预设: '默认',
    随机预设: false,
    替换规则列表: { 默认: { 规则文本: '', createdAt: Date.now(), updatedAt: Date.now() } },
    当前替换规则: '默认',
    正面质量: 'best quality, amazing quality, very aesthetic, absurdres',
    负面质量: '',
    词汇替换: 默认词汇替换,
    固定画风: 创建默认固定画风设置(),
  };
}

export function 创建默认固定画风设置(): 固定画风设置 {
  return {
    // 默认关闭：安装后不该悄悄改变出图结果。
    启用: false,
    前置: '',
    后置: '',
    负面: '',
  };
}

export function 创建默认LLM设置(): LLM设置 {
  return {
    启用: false,
    当前预设: '默认',
    预设列表: { 默认: { entries: [], createdAt: Date.now(), updatedAt: Date.now() } },
    温度: 0.7,
    重试次数: 2,
    // 一次要产出多张图的提示词，给足余量；32k 是当前主流模型的常见上限。
    最大输出: 32768,
    API: { provider: '', baseUrl: '', apiKey: '', model: '' },
  };
}

/** 一键生成角色特征用的默认配置：提示词取「人物生成」（见 prompts/cot/characterFeaturePrompt.ts）。 */
export function 创建默认角色AI设置(): 角色AI设置 {
  return {
    提示词: 人物生成默认提示词,
    温度: 0.9,
    // 一次要产出 14 个部位字段，且每个字段都是 tag 串；给不足会在半途被截断。
    最大输出: 8192,
    API: { provider: '', baseUrl: '', apiKey: '', model: '' },
  };
}

/** NovelAI 默认值，逐项来自上游 defaultSettings（L2642-L2739）与载荷默认（L84480-L84518）。 */
export function 创建默认NovelAI设置(): NovelAI设置 {
  return {
    地址: 'https://image.novelai.net',
    Token: '',
    模型: 'nai-diffusion-4-5-full',
    宽度: 1024,
    高度: 1024,
    步数: 28,
    关联性: 5,
    采样器: 'k_euler_ancestral',
    噪点表: 'karras',
    种子: 0,
    cfgRescale: 0.18,
    动态阈值: false,
    多样性增强: true,
    sm: false,
    sm_dyn: false,
    AI默认位置: true,
    参考强度归一化: false,
    信息提取: 1,
    参考模式: 'character',
  };
}

/** 上游 NovelAI 采样器白名单（L84488 注释与 novelai.html 选项）。 */
export const NovelAI采样器列表 = [
  'k_euler',
  'k_euler_ancestral',
  'k_dpm_2',
  'k_dpm_2_ancestral',
  'k_dpmpp_2m',
  'k_dpmpp_2s_ancestral',
  'k_dpmpp_sde',
  'ddim_v3',
] as const;

/** 上游噪点表选项（`Schedule`）。 */
export const NovelAI噪点表列表 = ['native', 'karras', 'exponential', 'polyexponential'] as const;

/** 支持 v4 分角色载荷的模型前缀；`nai-diffusion-3` 及更早走旧字段。 */
export const NovelAI_V4模型前缀 = ['nai-diffusion-4', 'nai-diffusion-5'] as const;

/** v5 系列用 `params_version: 4`，其余为 3（L84482）。 */
export function NovelAI参数版本(模型: string): 3 | 4 {
  return 模型.includes('nai-diffusion-5') ? 4 : 3;
}

/** 只有 v4/v5 模型才接受 `v4_prompt` / `characterPrompts`（L84519）。 */
export function NovelAI支持分角色(模型: string): boolean {
  return NovelAI_V4模型前缀.some((前缀) => 模型.startsWith(前缀));
}

/** SD 默认值，逐项来自上游 defaultSettings（L2647-L2691）与载荷默认（L80070-L80096）。 */
export function 创建默认SD设置(): SD设置 {
  return {
    地址: 'http://127.0.0.1:7860',
    认证: '',
    模型: '',
    采样器: 'Euler a',
    调度器: 'Automatic',
    VAE: 'Automatic',
    宽度: 1024,
    高度: 1024,
    步数: 28,
    cfg: 7,
    种子: -1,
    CLIP跳过层: 1,
    面部修复: false,
    高清修复: false,
    高清放大算法: 'Latent',
    高清放大倍数: 1,
    高清第二轮步数: 0,
    高清去噪强度: 0.7,
    ADetailer: false,
  };
}

/** 上游设置里的高清放大算法选项。 */
export const SD放大算法列表 = [
  'Latent',
  'Latent (nearest)',
  'Latent (nearest-exact)',
  'R-ESRGAN 4x+',
  'R-ESRGAN 4x+ Anime6B',
  'ESRGAN_4x',
  'SwinIR_4x',
  'LDSR',
] as const;

/** Banana / Grok 默认值，来自上游 `banana: { imageSize: '1024x1024' }`（L3073）。 */
export function 创建默认Banana设置(): Banana设置 {
  return {
    地址: 'https://api.openai.com',
    APIKey: '',
    模型: 'gpt-image-1',
    尺寸: '1024x1024',
    自定义端点: '',
    响应格式: 'none',
    编辑格式: 'form_data',
    参考图上传: true,
  };
}

/** 上游 banana 尺寸下拉里的预设（banana.html 的 image-size 选项）。 */
export const Banana尺寸列表 = [
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '1280x720',
  '720x1280',
  '960x1280',
  '1216x832',
  '832x1216',
] as const;

export function 创建默认文生图系统设置(): 文生图系统设置 {
  return {
    启用: false,
    渠道: 'comfyui',
    comfyui: 创建默认ComfyUI设置(),
    novelai: 创建默认NovelAI设置(),
    sd: 创建默认SD设置(),
    banana: 创建默认Banana设置(),
    提示词: 创建默认提示词设置(),
    LLM: 创建默认LLM设置(),
    角色卡: {},
    角色启用列表: [],
    角色启用预设列表: 创建默认角色启用预设列表(),
    当前启用预设: 默认启用预设名,
    通用角色列表: { [默认通用角色列表名]: { 角色: [] } },
    当前通用角色列表: 默认通用角色列表名,
    通用服装列表: { [默认通用服装列表名]: { 服装: [] } },
    当前通用服装列表: 默认通用服装列表名,
    注入模板列表: 创建默认注入模板列表(),
    当前注入模板: 默认注入模板名,
    角色AI: 创建默认角色AI设置(),
    正文配图: {
      启用: false,
      模式: 'manual',
      每轮上限: 0,
      时机: 'queue_background',
      插入原文: false,
      // 默认显示但折叠：正文里只占一行，想看再展开，避免大图刷屏。
      默认显示: true,
      默认展开: false,
    },
    图片缓存: { 启用: true, 保留天数: 0, 转存JPEG: false },
    显示插件提示: true,
    沿用槽位归档: true,
  };
}
