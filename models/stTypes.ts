import type { 消息角色 } from './chat';

export interface STWorldInfoEntry {
  uid: number;
  key: string[];
  keysecondary: string[];
  comment: string;
  content: string;
  constant: boolean;
  vectorized: boolean;
  selective: boolean;
  order: number;
  position: number;
  disable: number[];
  enabled: boolean;
  addMemo: boolean;
  displayIndex: number;
  group: string;
  groupOverride: boolean;
  groupWeight: number;
  depth: number;
  logic: number;
  useGroup: boolean;
  automationId?: string;
  comment_A?: string;
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
  probability?: number;
  delay?: number;
  cooldown?: number;
  scanDepth?: number;
  recursive?: boolean;
  recursionDepth?: number;
}

export interface STPresetFull {
  prompts?: unknown[];
  prompt_order?: unknown[];
  world_info?: STWorldInfoEntry[];
  regex_scripts?: STRegexScript[] | Record<string, STRegexScript>;
}

/** 高风险能力，运行时需走受限兼容层。 */
export interface STRegexScript {
  id?: string;
  script_name?: string;
  scriptName?: string;
  name?: string;
  find_regex?: string;
  findRegex?: string;
  replace_string?: string;
  replaceString?: string;
  disabled?: boolean;
  placement?: unknown;
  trim_strings?: string[];
  trimStrings?: string[];
  markdownOnly?: boolean;
  promptOnly?: boolean;
  runOnEdit?: boolean;
  substituteRegex?: number;
  minDepth?: number | null;
  maxDepth?: number | null;
  [key: string]: unknown;
}

export type STMessageRole = 消息角色;

export interface STPresetPrompt {
  identifier: string;
  name?: string;
  role: STMessageRole;
  content: string;
  system_prompt?: boolean;
  injection_position?: number;
  injection_depth?: number;
  injection_order?: number;
  forbid_overrides?: boolean;
  [key: string]: unknown;
}

export interface STPresetOrderSlot {
  identifier: string;
  enabled: boolean;
}

export interface STPresetOrder {
  character_id: number;
  order: STPresetOrderSlot[];
}

export interface STPreset {
  prompts: STPresetPrompt[];
  prompt_order: STPresetOrder[];
  world_info?: STWorldInfoEntry[] | Record<string, STWorldInfoEntry>;
  /** 导入时保留，默认不执行。 */
  regex_scripts?: STRegexScript[] | Record<string, STRegexScript>;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  repetition_penalty?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  [key: string]: unknown;
}

export interface STPresetEntryV2 {
  id: string;
  name: string;
  preset: STPreset;
  characterId?: number | null;
  importedAt: number;
  updatedAt: number;
  isBuiltin?: boolean;
}

export type TavernPostProcessMode = '未选择' | '单一用户' | '严格' | '半严格';

export interface TavernInternalMessage {
  role: STMessageRole;
  content: string;
  source: 'preset' | 'worldbook' | 'history' | 'latest_input' | 'persona' | 'format_guard' | 'cot_guard' | 'compat_guard';
}

export interface TavernMessage {
  role: STMessageRole;
  content: string;
}
