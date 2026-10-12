import { createBuiltinPromptModules } from '@/data/builtinPromptModules';
import type { 提示词模块 } from '@/models/prompts';
import { BUILTIN_PROMPT_MODULE_IDS, LEGACY_BUILTIN_COT_ID, getDefaultModuleFields } from '@/models/prompts';
import type { 游戏设置 } from '@/models/settings';
import {
  创建默认游戏设置,
  归一化额外功能设置,
  归一化剧情编织系统设置,
  归一化手机系统设置,
  归一化文生图系统设置,
  归一化星际和平周报设置,
  归一化智库系统设置,
  归一化视觉文本设置,
  归一化记忆系统设置,
} from '@/models/settings';
import { isPlainRecord } from '@/utils/storageUtils';


function 取提示词模块列表(value: unknown): 提示词模块[] {
  if (!Array.isArray(value)) return [];
  const list = value as unknown[];
  return list.filter(
    (item): item is 提示词模块 => isPlainRecord(item) && typeof item.id === 'string',
  );
}

export function migratePromptModules(savedGame: {
  promptModules?: unknown;
  customPrompt?: unknown;
}): 提示词模块[] {
  const builtins = createBuiltinPromptModules();
  const saved = 取提示词模块列表(savedGame.promptModules);

  const legacyCot = saved.find((m) => m.id === LEGACY_BUILTIN_COT_ID);

  const mergedBuiltins = builtins.map((b) => {
    const hit = saved.find((m) => m.id === b.id);
    if (hit) {
      // 旧 content / 旧 order 若取自存档会反向覆盖源码更新（只保留 enabled 与时间戳）。
      const isCalibrationBuiltin = b.scope.includes('calibration');
      return {
        ...b,
        enabled: isCalibrationBuiltin ? true : hit.enabled,
        createdAt: hit.createdAt,
        updatedAt: hit.updatedAt,
      };
    }
    if (legacyCot && (b.id === 'builtin_opening_cot' || b.id === 'builtin_main_plot_cot')) {
      return { ...b, enabled: legacyCot.enabled };
    }
    return b;
  });

  const builtinIdSet = new Set<string>(BUILTIN_PROMPT_MODULE_IDS);
  const seenIds = new Set<string>();
  const customs = saved.filter((m) => {
    if (builtinIdSet.has(m.id)) return false;
    if (m.id === LEGACY_BUILTIN_COT_ID) return false;
    if (m.id.startsWith('st_import_') || m.id.startsWith('adapted_')) return false;
    if (seenIds.has(m.id)) return false;
    seenIds.add(m.id);
    return true;
  });

  const customsWithDefaults = customs.map((m) => {
    // 旧存档可能缺 description 或非 string：下游推断 replaceMode 时裸调 .startsWith 会启动崩溃。
    const rawDescription = typeof m.description === 'string' ? m.description : '';
    const replaceMode = m.replaceMode ?? (rawDescription.startsWith('替换') ? 'replace' : 'coexist');
    const description = rawDescription.replace(/^(替换|叠加)\s*·\s*/, '');
    return {
      ...getDefaultModuleFields(),
      source: 'user' as const,
      replaceable: 'replaceable' as const,
      ...m,
      description,
      replaceMode,
    };
  });

  const hasLegacy = customsWithDefaults.some((m) => m.id === 'legacy_custom');
  const legacyCustomPrompt = typeof savedGame.customPrompt === 'string' ? savedGame.customPrompt : '';
  if (!hasLegacy && legacyCustomPrompt.trim()) {
    const now = Date.now();
    customsWithDefaults.push({
      ...getDefaultModuleFields(),
      source: 'user',
      replaceable: 'replaceable',
      replaceMode: 'coexist',
      id: 'legacy_custom',
      title: '旧版自定义提示词',
      description: '自旧版「额外指示」迁移而来。可自由编辑或删除。',
      category: 'custom',
      content: legacyCustomPrompt,
      enabled: true,
      builtin: false,
      order: 900,
      scope: ['all'],
      createdAt: now,
      updatedAt: now,
    });
  }

  return [...mergedBuiltins, ...customsWithDefaults];
}

export function 归一化游戏设置(settings: 游戏设置): 游戏设置 {
  return {
    ...settings,
    新闻系统: 归一化星际和平周报设置(settings.新闻系统),
    手机系统: 归一化手机系统设置(settings.手机系统),
    智库系统: 归一化智库系统设置(settings.智库系统),
    剧情编织系统: 归一化剧情编织系统设置(settings.剧情编织系统),
    记忆系统: 归一化记忆系统设置(settings.记忆系统),
    文生图系统: 归一化文生图系统设置(settings.文生图系统),
    // 后加的开关，旧存档没有这一块；缺省时回退默认（关闭），不能留 undefined。
    逐句推进: { ...创建默认游戏设置().逐句推进, ...(settings.逐句推进 ?? {}) },
    visualTextSettings: 归一化视觉文本设置(settings.visualTextSettings),
    额外功能: 归一化额外功能设置(settings.额外功能),
  };
}

export interface HydratedGameSettings {
  settings: 游戏设置;
  macroGlobalVars: Record<string, string>;
  worldbookTriggerStates: Record<string, number>;
}

function 取运行态表<T>(value: unknown): Record<string, T> {
  return value !== null && typeof value === 'object' ? (value as Record<string, T>) : {};
}

export function hydratePersistedGameSettings(input: unknown): HydratedGameSettings {
  const defaults = 创建默认游戏设置();
  const source = isPlainRecord(input) ? input : {};
  // V1 预设字段只在旧存档中存在，必须剥离，否则会被对象展开重新持久化。
  const {
    stPresets: _stPresets,
    currentStPresetId: _currentStPresetId,
    stWorldInfos: _stWorldInfos,
    macroGlobalVars: _residualMacroGlobalVars,
    worldbookTriggerStates: _residualWorldbookTriggerStates,
    ...savedGameWithoutV1Preset
  } = source;
  void _stPresets;
  void _currentStPresetId;
  void _stWorldInfos;

  const partialSavedGame = savedGameWithoutV1Preset as Partial<游戏设置>;
  const merged: 游戏设置 = {
    ...defaults,
    ...savedGameWithoutV1Preset,
    新闻系统: 归一化星际和平周报设置(partialSavedGame.新闻系统),
    手机系统: 归一化手机系统设置(partialSavedGame.手机系统),
    智库系统: 归一化智库系统设置(partialSavedGame.智库系统),
    剧情编织系统: 归一化剧情编织系统设置(partialSavedGame.剧情编织系统),
    文生图系统: 归一化文生图系统设置(partialSavedGame.文生图系统),
    记忆系统: 归一化记忆系统设置(partialSavedGame.记忆系统),
    额外功能: 归一化额外功能设置(partialSavedGame.额外功能),
    variableApi: partialSavedGame.variableApi ?? defaults.variableApi,
    enableClaudeMode: partialSavedGame.enableClaudeMode ?? defaults.enableClaudeMode,
    deepSeekMainMode: partialSavedGame.deepSeekMainMode ?? defaults.deepSeekMainMode,
    backgroundTaskMode: partialSavedGame.backgroundTaskMode ?? defaults.backgroundTaskMode,
    enableCacheDiagnostics: partialSavedGame.enableCacheDiagnostics ?? defaults.enableCacheDiagnostics,
    enableMaleNsfwArchive: partialSavedGame.enableMaleNsfwArchive ?? defaults.enableMaleNsfwArchive,
    enablePlayerSpeechExpansion: partialSavedGame.enableNoControl
      ? false
      : partialSavedGame.enablePlayerSpeechExpansion ?? false,
    visualTextSettings: 归一化视觉文本设置(partialSavedGame.visualTextSettings),
    promptModules: migratePromptModules(savedGameWithoutV1Preset),
  };
  if (merged.promptModules.some((m) => m.id === 'legacy_custom')) {
    (merged as { customPrompt?: string }).customPrompt = '';
  }

  return {
    settings: merged,
    macroGlobalVars: 取运行态表<string>(_residualMacroGlobalVars),
    worldbookTriggerStates: 取运行态表<number>(_residualWorldbookTriggerStates),
  };
}
