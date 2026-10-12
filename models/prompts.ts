export type 提示词模块类目 = 'cot' | 'format' | 'persona' | 'devmode' | 'jailbreak' | 'style' | 'custom';

/** 模块注入场景：calibration 为独立模型提示词展示（新闻、手机、智库、变量、剧情编织等），不注入主剧情。 */
export type 提示词模块作用域 = 'main' | 'opening' | 'battle' | 'pathAwakening' | 'calibration' | 'all';

export interface 提示词模块 {
  id: string;
  title: string;
  description: string;
  category: 提示词模块类目;
  content: string;
  enabled: boolean;
  builtin: boolean;
  order: number;
  /** 空数组等价于 ['all']（运行时兜底）。 */
  scope: 提示词模块作用域[];
  openingSourceGate?: ('official_preset' | 'free' | 'workshop')[];
  role?: 'system' | 'user' | 'assistant';
  injectionPosition?: 0 | 1;
  injectionDepth?: number;
  injectionOrder?: number;
  injectionTrigger?: string[];
  source?: 'builtin' | 'user';
  replaceable?: 'builtin' | 'builtin_toggleable' | 'replaceable' | 'extensible';
  replaceMode?: 'replace' | 'coexist';
  createdAt: number;
  updatedAt: number;
}

export const BUILTIN_PROMPT_MODULE_IDS = [
  'builtin_dev_mode',
  'builtin_narrator_persona',
  'builtin_opening_cot',
  'builtin_preset_opening_cot',
  'builtin_free_opening_cot',
  'builtin_main_plot_cot',
  'builtin_path_awakening_cot',
  'builtin_news_cot',
  'builtin_news_worldbook',
  'builtin_news_output_format',
  'builtin_zhiku_cot',
  'builtin_zhiku_output_format',
  'builtin_yiting_recall',
  'builtin_yiting_archive_format',
  'builtin_phone_worldbook',
  'builtin_phone_style',
  'builtin_phone_cot',
  'builtin_phone_output_format',
  'builtin_story_weaving_worldbook',
  'builtin_story_weaving_cot',
  'builtin_story_weaving_output_format',
  'builtin_variable_worldbook',
  'builtin_variable_cot',
  'builtin_variable_output_format',
  'builtin_companion_archive_worldbook',
  'builtin_response_format',
  'builtin_action_options',
  'builtin_no_control',
  'builtin_player_speech_expansion',
  'builtin_npc_autonomy',
  'builtin_npc_ledger_continuity',
  'builtin_writing_style',
  'builtin_writing_style_hsr',
  'builtin_writing_style_baimiao',
  'builtin_writing_style_custom',
  'builtin_perspective_first',
  'builtin_perspective_second',
  'builtin_perspective_third',
  'builtin_nsfw',
  'builtin_emotion_protocol',
  'builtin_cognitive_isolation',
  'builtin_rule_first_turn',
  'builtin_rule_narrative_general',
  'builtin_rule_forbidden_phrases',
  'builtin_rule_emotion_realism',
  'builtin_rule_battle_narration',
  'builtin_rule_time_progression',
  'builtin_rule_power_system',
  'builtin_rule_awakening_interrogation',
] as const;

export const CALIBRATION_BUILTIN_PREFIXES = {
  news: 'builtin_news_',
  phone: 'builtin_phone_',
  zhiku: 'builtin_zhiku_',
  yiting: 'builtin_yiting_',
  variable: 'builtin_variable_',
  companionArchive: 'builtin_companion_archive_',
  storyWeaving: 'builtin_story_weaving_',
} as const;

export type 内置提示词模块ID = (typeof BUILTIN_PROMPT_MODULE_IDS)[number];

export function isBuiltinPromptModule(id: string): id is 内置提示词模块ID {
  return (BUILTIN_PROMPT_MODULE_IDS as readonly string[]).includes(id);
}

export const PROMPT_MODULE_TOP_THRESHOLD = 30;

export const PROMPT_MODULE_CATEGORY_LABELS: Record<提示词模块类目, string> = {
  cot: '思维链',
  format: '输出格式',
  persona: '叙述人格',
  devmode: '开发模式',
  jailbreak: '越狱',
  style: '文风',
  custom: '自定义',
};

export const PROMPT_MODULE_SCOPE_LABELS: Record<提示词模块作用域, string> = {
  main: '主流程',
  opening: '开局',
  battle: '战斗',
  pathAwakening: '命途狭间',
  calibration: '独立模型',
  all: '任意',
};

/** 旧版 builtin_cot id（已拆分为 builtin_opening_cot + builtin_main_plot_cot）。 */
export const LEGACY_BUILTIN_COT_ID = 'builtin_cot';

export function getDefaultModuleFields(): Pick<提示词模块, 'role' | 'injectionPosition' | 'injectionDepth' | 'injectionOrder' | 'injectionTrigger' | 'source' | 'replaceable'> {
  return {
    role: 'system',
    injectionPosition: 0,
    injectionDepth: 4,
    injectionOrder: 100,
    injectionTrigger: [],
    source: 'builtin',
    replaceable: 'builtin',
  };
}
