import type { API配置项, API设置, API覆盖字段, 游戏设置 } from '@/models/settings';
import { resolveApiOverrideFields } from '@/models/settings';

export type ApiSlotId =
  | 'main'
  | 'variable'
  | 'news'
  | 'phone'
  | 'zhiku'
  | 'storyWeaving'
  | 'storyAdvanceJudge'
  | 'imagePromptTokenizer'
  | 'memoryCompression'
  | 'yitingRecall'
  | 'yitingArchive'
  | 'characterAnchorExtract';

interface ApiSlotSpec {
  /** null 表示该槽位无覆盖，直接取主配置。 */
  override: (settings: 游戏设置) => API覆盖字段 | null;
  /** 合成配置的身份与数值默认值；省略则沿用主配置。 */
  stamp?: (fields: API覆盖字段, override: API覆盖字段 | null, main: API配置项 | null) => Partial<API配置项>;
}

const 三项全空 = (override: API覆盖字段): boolean =>
  !override.baseUrl.trim() && !override.apiKey.trim() && !override.model.trim();

/** 覆盖是否自填了地址/密钥/模型中的任意一项。 */
export function hasApiOverride(override: API覆盖字段): boolean {
  return !三项全空(override);
}

const 剧情编织采样参数 = (f: API覆盖字段): Partial<API配置项> => ({
  maxTokens: f.maxTokens ?? 4096,
  temperature: f.temperature ?? 0.25,
});

/** LLM只存了 provider/baseUrl/apiKey/model，其余字段回退主 API。 */
const LLM覆盖 = (s: 游戏设置): API覆盖字段 => {
  const api = s.文生图系统.LLM.API;
  return {
    provider: api.provider as API覆盖字段['provider'],
    baseUrl: api.baseUrl,
    apiKey: api.apiKey,
    model: api.model,
    retryCount: s.文生图系统.LLM.重试次数,
  };
};

const API_SLOTS: Record<ApiSlotId, ApiSlotSpec> = {
  main: { override: () => null },
  variable: { override: (s) => s.variableApi },
  news: {
    override: (s) => s.新闻系统.api,
    stamp: () => ({ id: '__news_system__', name: '星际和平周报' }),
  },
  phone: {
    override: (s) => s.手机系统.api,
    stamp: (f) => ({
      id: '__phone_runtime__',
      name: '手机系统',
      maxTokens: f.maxTokens ?? 900,
      temperature: f.temperature ?? 0.75,
    }),
  },
  zhiku: { override: (s) => s.智库系统.api },
  storyWeaving: {
    override: (s) => s.剧情编织系统.api,
    stamp: 剧情编织采样参数,
  },
  storyAdvanceJudge: {
    // 独立覆盖整体留空时退回剧情编织 api；填写后只按字段回退主配置。
    override: (s) => (hasApiOverride(s.剧情编织系统.推进判定API) ? s.剧情编织系统.推进判定API : s.剧情编织系统.api),
    stamp: 剧情编织采样参数,
  },
  imagePromptTokenizer: {
    override: LLM覆盖,
    stamp: (f) => ({
      id: '__image_prompt_tokenizer__',
      name: '文生图LLM',
      maxTokens: Math.min(f.maxTokens ?? 1600, 2400),
      temperature: f.temperature ?? 0.45,
    }),
  },
  characterAnchorExtract: {
    override: LLM覆盖,
    stamp: (f, override, main) => ({
      id: '__character_anchor_extract__',
      name: '角色视觉锚点提取',
      maxTokens: f.maxTokens ?? 1600,
      temperature: f.temperature ?? 0.35,
      retryCount: override?.retryCount ?? main?.retryCount ?? 1,
    }),
  },
  memoryCompression: { override: (s) => s.记忆系统.记忆总结API },
  yitingRecall: { override: (s) => s.记忆系统.忆庭召回API },
  yitingArchive: { override: (s) => s.记忆系统.忆庭精炼API },
};

const 空身份: API配置项 = {
  id: '',
  name: '',
  provider: 'openai_compatible',
  baseUrl: '',
  apiKey: '',
  model: '',
  createdAt: 0,
  updatedAt: 0,
};

/** 无覆盖时的占位：provider 必须留空，否则会挡住 resolveApiOverrideFields 回退主配置。 */
const 空覆盖: API覆盖字段 = {
  provider: '',
  baseUrl: '',
  apiKey: '',
  model: '',
};

// ——————————————————————————————————————————————————————————
// 查询：全仓读 apiSettings.configs 的唯一出口。
// 组件、hooks、服务一律经这三个函数取配置，不得自行访问 .configs。
// ——————————————————————————————————————————————————————————

/** 主 API 配置的唯一读取口：activeConfigId 命中即用，缺失/悬空回落首项。不回写 activeConfigId。 */
export function resolveMainApiConfig(apiSettings: API设置 | null | undefined): API配置项 | null {
  if (!apiSettings) return null;
  const { activeConfigId, configs } = apiSettings;
  return configs.find((item) => item.id === activeConfigId) ?? configs.at(0) ?? null;
}

/** 配置列表的只读视图；新增/修改/删除一律走下面的编辑函数。 */
export function listApiConfigs(apiSettings: API设置): readonly API配置项[] {
  return apiSettings.configs;
}

/** 按 id 取单条（编辑器选中行用，与 activeConfigId 无关）。 */
export function findApiConfig(apiSettings: API设置, id: string | null): API配置项 | null {
  if (id === null) return null;
  return apiSettings.configs.find((item) => item.id === id) ?? null;
}

/** 解析槽位的可用配置；三项不齐、或覆盖与主配置都补不齐时返回 null。功能开关由调用方判断。 */
export function resolveApiConfig(
  apiSettings: API设置,
  settings: 游戏设置,
  slot: ApiSlotId,
): API配置项 | null {
  const spec = API_SLOTS[slot];
  const main = resolveMainApiConfig(apiSettings);
  const picked = spec.override(settings);
  // 覆盖三项全空时整块继承主配置，避免 provider 与端点/模型不同源。
  const override = picked && 三项全空(picked) ? null : picked;

  const fields = resolveApiOverrideFields(override ?? 空覆盖, main);
  const { provider, baseUrl, apiKey, model } = fields;
  if (!provider || !baseUrl || !apiKey || !model) return null;

  return {
    ...(main ?? 空身份),
    ...fields,
    provider,
    enableClaudeMode: settings.enableClaudeMode,
    updatedAt: Date.now(),
    ...spec.stamp?.(fields, override, main),
  };
}

// ——————————————————————————————————————————————————————————
// 编辑规则：全部返回新的 API设置，不原地修改入参。
// 调用方（编辑器 hook）只负责 UI 状态，选中谁、谁来当活动项由这里决定。
// ——————————————————————————————————————————————————————————

/** 追加一条配置；仅当原本没有活动项时才把活动指针指向新项。 */
export function addApiConfig(apiSettings: API设置, config: API配置项): API设置 {
  return {
    activeConfigId: apiSettings.activeConfigId ?? config.id,
    configs: [...apiSettings.configs, config],
  };
}

/** 按 id 合并字段并 bump updatedAt；patch 为空即编辑器「保存」按钮的 touch。 */
export function updateApiConfig(apiSettings: API设置, id: string, patch: Partial<API配置项>): API设置 {
  return {
    ...apiSettings,
    configs: apiSettings.configs.map((item) =>
      item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item,
    ),
  };
}

/** 删除一条；若删的正是活动项，活动指针改为剩余首项，否则指针不动。 */
export function removeApiConfig(apiSettings: API设置, id: string): API设置 {
  const remaining = apiSettings.configs.filter((item) => item.id !== id);
  return {
    activeConfigId: apiSettings.activeConfigId === id ? (remaining.at(0)?.id ?? null) : apiSettings.activeConfigId,
    configs: remaining,
  };
}

/** 切换活动项；只动指针，不碰配置内容。 */
export function activateApiConfig(apiSettings: API设置, id: string): API设置 {
  return { ...apiSettings, activeConfigId: id };
}

/** 整包替换（导入配置包 / 切换 API 方案）：修正来源指针，全部 bump updatedAt。 */
export function replaceApiConfigs(next: API设置): API设置 {
  const configs = next.configs.map((item) => ({ ...item, updatedAt: Date.now() }));
  return {
    activeConfigId: configs.some((item) => item.id === next.activeConfigId)
      ? next.activeConfigId
      : configs.at(0)?.id ?? null,
    configs,
  };
}
