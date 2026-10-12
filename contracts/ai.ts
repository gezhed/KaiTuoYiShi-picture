import type { 角色数据结构 } from '@/models/character';
import type { 命途ID } from '@/models/journey';
import type { 命途阶段 } from '@/models/path';

export type TavernRegexScriptKind = 'prompt_preprocess' | 'output_postprocess' | 'display_replace' | 'blocked';

export interface TavernRegexScriptSafety {
  kind: TavernRegexScriptKind;
  disabled: boolean;
  risky: boolean;
  blocksProtocolTags: boolean;
  reason: string;
}

export interface TavernRegexDryRunResult {
  ok: boolean;
  safety: TavernRegexScriptSafety;
  matches: number;
  before: string;
  after: string;
  warnings: string[];
  error?: string;
}

export interface TravelerTemplateContext {
  storyModeName?: string;
  openingSourceLabel?: string;
  openingRegionName?: string;
  openingChapterName?: string;
  openingLocationHint?: string;
  openingMainlineEnabled?: boolean;
  openingEntryText?: string;
  existingName?: string;
  existingAlias?: string;
  existingGender?: string;
  existingAge?: number;
  existingBirthday?: string;
  userPrompt?: string;
}

export interface TravelerTemplateDraft {
  name: string;
  alias: string;
  gender: string;
  age: number;
  birthday: string;
  appearance: string;
  personality: string;
  background: string;
}

export interface 战技生成上下文 {
  traveler: 角色数据结构;
  slotKind: 'normal' | 'path';
  slotIndex: number;
  pathId?: 命途ID;
  pathStage?: 命途阶段;
  existingSkillNames?: string[];
  currentDraft?: Partial<战技生成草稿>;
  userHint?: string;
}

export interface 战技生成草稿 {
  名称: string;
  描述: string;
  来源: string;
  关键词: string[];
  消耗: string;
  冷却: string;
  备注: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  nsfw?: boolean;
  size?: string;
  referenceImages?: ImageReferenceInput[];
  referenceStrength?: number;
  signal?: AbortSignal;
}

export interface ImageReferenceInput {
  id?: string;
  src: string;
  weight?: number;
  role?: 'character' | 'style' | 'composition';
}

export interface ImageGenerationResult {
  src: string;
  mimeType?: string;
  model?: string;
  backend?: string;
  originalUrl?: string;
}

export interface 解析上下文 {
  body: string;
  traveler?: {
    name: string;
    gender?: string;
    appearance?: string;
    identity?: string;
    anchorPrompt?: string;
  };
  playerAppearanceMode?: 'off' | 'auto' | 'force';
  presentNpcs?: Array<{ name: string; appearance?: string; clothing?: string }>;
}

export interface 场景图解析结果 {
  title: string;
  location: string;
  atmosphere: string;
  subject: string;
  camera: string;
  avoid: string;
  prompt: string;
  negativePrompt: string;
  rawText: string;
}

export interface 故事快照解析结果 {
  title: string;
  characters: string[];
  location: string;
  atmosphere: string;
  action: string;
  camera: string;
  avoid: string;
  prompt: string;
  negativePrompt: string;
  rawText: string;
}

export interface CharacterAnchorExtractInput {
  name: string;
  kind: 'traveler' | 'npc';
  sourceText: string;
  requirement?: string;
}

export interface ImagePromptTokenizerInput {
  title: string;
  mode: string;
  sourceText: string;
  basePrompt: string;
  baseNegative: string;
  extraRequirement?: string;
  anchorMode?: boolean;
  anchorSummary?: string;
}

export interface ImagePromptTokenizerResult {
  prompt: string;
  negative: string;
}
