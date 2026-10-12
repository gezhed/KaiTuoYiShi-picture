import type { 提示词模块, 提示词模块类目, 提示词模块作用域 } from '@/models/prompts';
import { CALIBRATION_BUILTIN_PREFIXES, PROMPT_MODULE_CATEGORY_LABELS, getDefaultModuleFields, isBuiltinPromptModule } from '@/models/prompts';
import { createBuiltinPromptModules } from '@/data/builtinPromptModules';

export const isMainPlotModule = (m: 提示词模块) => !m.scope.includes('calibration');
export const isOtherSystemModule = (m: 提示词模块) => m.scope.includes('calibration');

export const CALIBRATION_SYSTEM_GROUPS: Record<string, { label: string; match: (id: string) => boolean }> = {
  news: { label: '新闻系统', match: (id) => id.startsWith(CALIBRATION_BUILTIN_PREFIXES.news) || id.startsWith('custom_news_') },
  phone: { label: '手机系统', match: (id) => id.startsWith(CALIBRATION_BUILTIN_PREFIXES.phone) || id.startsWith('custom_phone_') },
  zhiku: { label: '智库系统', match: (id) => id.startsWith(CALIBRATION_BUILTIN_PREFIXES.zhiku) || id.startsWith('custom_zhiku_') },
  yiting: { label: '忆庭系统', match: (id) => id.startsWith(CALIBRATION_BUILTIN_PREFIXES.yiting) || id.startsWith('custom_yiting_') },
  variable: { label: '变量系统', match: (id) => id.startsWith(CALIBRATION_BUILTIN_PREFIXES.variable) || id.startsWith('custom_variable_') },
  companionArchive: { label: '伙伴档案', match: (id) => id.startsWith(CALIBRATION_BUILTIN_PREFIXES.companionArchive) || id.startsWith('custom_companionArchive_') },
  storyWeaving: { label: '剧情编织系统', match: (id) => id.startsWith(CALIBRATION_BUILTIN_PREFIXES.storyWeaving) || id.startsWith('custom_storyWeaving_') },
};
export const CALIBRATION_GROUP_ORDER = ['news', 'phone', 'zhiku', 'yiting', 'variable', 'companionArchive', 'storyWeaving'] as const;

export function getCalibrationGroupKey(m: 提示词模块): string {
  for (const key of CALIBRATION_GROUP_ORDER) {
    if (CALIBRATION_SYSTEM_GROUPS[key].match(m.id)) return key;
  }
  return 'other';
}

export const WRITING_STYLE_MODULE_IDS = new Set([
  'builtin_writing_style',
  'builtin_writing_style_hsr',
  'builtin_writing_style_baimiao',
  'builtin_writing_style_custom',
]);
export const isWritingStyleModule = (m: 提示词模块) =>
  WRITING_STYLE_MODULE_IDS.has(m.id);

export const isBuiltinPresetModule = (m: 提示词模块) => m.source === 'builtin';

export function patchModule(modules: 提示词模块[], id: string, partial: Partial<提示词模块>, now: number): 提示词模块[] {
  if (partial.enabled === true) {
    const target = modules.find((m) => m.id === id);
    if (target && isWritingStyleModule(target)) {
      return modules.map((m) =>
        m.id === id
          ? { ...m, ...partial, updatedAt: now }
          : isWritingStyleModule(m) && m.enabled
            ? { ...m, enabled: false, updatedAt: now }
            : m,
      );
    }
  }
  return modules.map((m) =>
    m.id === id ? { ...m, ...partial, updatedAt: now } : m,
  );
}

export function reorderPromptModules(modules: 提示词模块[], reordered: 提示词模块[]): 提示词模块[] {
  return modules.map((m) => {
    const updated = reordered.find((r) => r.id === m.id);
    return updated && updated.order !== m.order ? updated : m;
  });
}

export function addPromptModule(
  modules: 提示词模块[],
  params: { systemKey: string; category: 提示词模块类目; replaceMode: 'replace' | 'coexist'; now: number },
): { next: 提示词模块[]; newId: string } {
  const { systemKey, category, replaceMode, now } = params;
  const newId = `custom_${systemKey}_${category}_${now}`;
  const isCal = systemKey !== 'main';
  const scope: 提示词模块作用域[] = isCal ? ['calibration'] : ['all'];
  const systemLabel = systemKey === 'main' ? '主剧情' : CALIBRATION_SYSTEM_GROUPS[systemKey].label;
  const catLabel = PROMPT_MODULE_CATEGORY_LABELS[category];

  const targetModules = isCal
    ? modules.filter((m) => CALIBRATION_SYSTEM_GROUPS[systemKey].match(m.id))
    : modules.filter(isMainPlotModule);
  const nextOrder = (targetModules.length > 0 ? Math.max(...targetModules.map((m) => m.order)) : 0) + 10;

  const created: 提示词模块 = {
    ...getDefaultModuleFields(),
    source: 'user',
    replaceable: 'replaceable',
    replaceMode,
    id: newId,
    title: `${systemLabel} · ${catLabel}`,
    description: `${systemLabel} · ${catLabel}`,
    category,
    content: '',
    enabled: true,
    builtin: false,
    order: nextOrder,
    scope,
    createdAt: now,
    updatedAt: now,
  };

  let next = [...modules, created];
  if (replaceMode === 'replace') {
    next = next.map((m) => {
      if (!isBuiltinPromptModule(m.id)) return m;
      const sameSystem = isCal
        ? CALIBRATION_SYSTEM_GROUPS[systemKey].match(m.id)
        : isMainPlotModule(m);
      const sameCategory = m.category === category;
      if (sameSystem && sameCategory && m.enabled) {
        return { ...m, enabled: false, updatedAt: now };
      }
      return m;
    });
  }

  return { next, newId };
}

export function removePromptModule(modules: 提示词模块[], id: string, now: number): 提示词模块[] {
  if (isBuiltinPromptModule(id)) return modules;
  const target = modules.find((m) => m.id === id);
  let next = modules.filter((m) => m.id !== id);
  if (target && target.replaceMode === 'replace') {
    const isCal = target.scope.includes('calibration');
    next = next.map((m) => {
      if (!isBuiltinPromptModule(m.id) || m.enabled) return m;
      const sameSystem = isCal
        ? getCalibrationGroupKey(m) === getCalibrationGroupKey(target)
        : isMainPlotModule(m) && isMainPlotModule(target);
      const sameCategory = m.category === target.category;
      if (sameSystem && sameCategory) {
        return { ...m, enabled: true, updatedAt: now };
      }
      return m;
    });
  }
  return next;
}

export function resetBuiltinModules(modules: 提示词模块[], now: number): 提示词模块[] {
  const fresh = createBuiltinPromptModules();
  const next = modules.map((m) => {
    if (!isBuiltinPromptModule(m.id)) return m;
    const def = fresh.find((f) => f.id === m.id);
    if (!def) return m;
    const isCalibrationBuiltin = def.scope.includes('calibration');
    return {
      ...def,
      enabled: isCalibrationBuiltin ? true : m.enabled,
      createdAt: m.createdAt,
      updatedAt: now,
    };
  });
  for (const def of fresh) {
    if (!next.find((m) => m.id === def.id)) next.push(def);
  }
  return next;
}
