import type { 命途ID, 官方开局预设, 创意工坊开局模板, 开局章节锚点 } from '@/models/journey';
import type { FreeOpeningPlanetSource, FreeOpeningWorkshopDraft, OpeningSource } from '@/models/opening';
import { getOfficialOpeningPresetsByRegion, getOpeningChapterAnchor, getWorkshopOpeningTemplatesByRegion, getPath, openingChapterAnchors, startingScenarios } from '@/data/journeyPresets';
import type { 战技记录, 战技槽位摘要 } from '@/models/skill';

export type Step = 'character' | 'path' | 'skill' | 'world' | 'historian' | 'overview';

export type OpeningScenario = (typeof startingScenarios)[number];

export type OpeningSkillSlotKey = `normal:${number}` | `path:${命途ID}:${number}`;

export const STEPS: Step[] = ['character', 'path', 'skill', 'historian', 'world', 'overview'];

export const STEP_META: Record<Step, { title: string; subtitle: string }> = {
  character: { title: '玩家档案', subtitle: '写下主角的身份底稿' },
  path: { title: '命途能力', subtitle: '命途阶段、能力与战技' },
  skill: { title: '战技创作', subtitle: '写下开局战技与其限制' },
  historian: { title: '其他选项', subtitle: '原著主角、组织背景与模式预留' },
  world: { title: '开局锚点', subtitle: '开局来源、地区章节与玩家切入点' },
  overview: { title: '整理确认', subtitle: '确认后写入长期开局档案' },
};

export const STEP_RAIL_ITEMS: { key: Step; title: string; subtitle: string }[] = [
  { key: 'character', title: '玩家档案', subtitle: '身份、外貌、性格、背景' },
  { key: 'path', title: '命途能力', subtitle: '命途阶段、能力与战技' },
  { key: 'skill', title: '战技创作', subtitle: '开局战技与限制描写' },
  { key: 'historian', title: '其他选项', subtitle: '原著主角、组织背景、模式预留' },
  { key: 'world', title: '开局锚点', subtitle: '来源、地区、章节与切入' },
  { key: 'overview', title: '整理确认', subtitle: 'AI/本地结构化开局档案' },
];

export const FREE_OPENING_PLANET_SOURCE_OPTIONS: Array<{
  id: FreeOpeningPlanetSource;
  title: string;
  text: string;
}> = [
  { id: 'existing', title: '已有地点', text: '从黑塔空间站、雅利洛-VI、仙舟罗浮、匹诺康尼、翁法罗斯、二相乐园等已有关联地点切入。' },
  { id: 'custom', title: '自创地点', text: '开启原创舞台工作台，由玩家自建地点、NPC、势力与规则。' },
];

export const DEFAULT_FREE_OPENING_WORKSHOP: FreeOpeningWorkshopDraft = {
  planet: '',
  location: '',
  planetIntro: '',
  npcDetails: '',
  customNpcName: '',
  customNpcBackground: '',
  customNpcPathstrider: '',
  customNpcAbility: '',
  customNpcs: [],
  currentGoal: '',
  localConflict: '',
  factions: '',
  worldRules: '',
  tone: '',
};

export { panelClip as cardClip, mediumClip as smallClip, cardClip as tightClip } from '@/components/ui/clipPaths';

export const openingPageBackground =
  'radial-gradient(circle at 16% 4%, rgba(var(--tj-btn-primary-start), 0.16), transparent 28%), radial-gradient(circle at 84% 12%, rgba(var(--tj-tech-blue), 0.16), transparent 34%), radial-gradient(circle at 54% 110%, rgba(var(--tj-btn-primary-end), 0.11), transparent 38%), linear-gradient(180deg, rgb(var(--tj-bg-secondary)), rgb(var(--tj-bg-primary)))';

export const openingPageOverlay =
  'linear-gradient(rgba(var(--tj-btn-primary-start), 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(var(--tj-btn-primary-start), 0.07) 1px, transparent 1px)';

export const openingPanelBackground =
  'linear-gradient(180deg, rgba(var(--tj-ui-panel), 0.80), rgba(var(--tj-panel-bg-end), 0.92)), radial-gradient(circle at top left, rgba(var(--tj-btn-primary-start), 0.10), transparent 36%)';

export const openingSoftPanelBackground = 'rgba(var(--tj-surface), 0.58)';

export const openingGlowLine =
  'linear-gradient(90deg, rgba(var(--tj-btn-primary-start), 0.25), transparent 18% 82%, rgba(var(--tj-btn-primary-end), 0.18))';

/* 内阴影会被 corner-shape 垫片丢弃，这几条只能是真 border。 */
export const openingPanelShadow = '1px solid rgba(var(--tj-btn-primary-end), var(--tj-edge-tint))';

export const openingPanelShadowStrong = '1px solid rgba(var(--tj-btn-primary-end), var(--tj-edge-tint))';

export const openingCardBackground =
  'linear-gradient(180deg, rgba(var(--tj-ui-panel), 0.76), rgba(var(--tj-surface-bg-end), 0.88))';

export const openingActiveCardBackground =
  'linear-gradient(135deg, rgba(var(--tj-btn-primary-start), 0.18), rgba(var(--tj-btn-primary-end), 0.10)), rgba(var(--tj-surface-bg-end), 0.9)';

/* 垫片会丢弃内阴影，强调条只能画成背景条纹，且必须排在第一层。 */
export const openingPanelRail =
  'linear-gradient(90deg, rgba(var(--tj-btn-primary-start), var(--tj-edge-tint-strong)) 0 3px, transparent 3px)';

export const openingCardBorder = '1px solid rgba(var(--tj-btn-primary-end), var(--tj-edge-tint-weak))';

export const openingCyanBorder = '1px solid rgba(var(--tj-btn-primary-start), var(--tj-edge))';

export function getFreeOpeningPlanetSourceOption(id: FreeOpeningPlanetSource) {
  return FREE_OPENING_PLANET_SOURCE_OPTIONS.find((item) => item.id === id) ?? FREE_OPENING_PLANET_SOURCE_OPTIONS[0];
}

export function getOpeningRegionDisplayName(regionName?: string): string {
  if (regionName === '贝洛伯格') return '雅利洛-VI';
  if (regionName === '罗浮仙舟') return '仙舟罗浮';
  return regionName || '未指定地点';
}

export type OpeningCardKind = 'official_preset' | 'workshop_template' | 'chapter';

/** 身份必须来自领域实体 ID，不用标题或数组下标——否则同章节多预设时卡片会塌缩或选错。 */
export interface OpeningScenarioCard {
  id: string;
  kind: OpeningCardKind;
  regionId: string;
  title: string;
  summary: string;
  chapterId: string;
  chapterName?: string;
  chapterPhase?: string;
  priorStoryState?: string;
  referenceDate?: string;
  referenceTime?: string;
  locationHint?: string;
  highlights: string[];
}

export function buildOfficialPresetCards(presets: 官方开局预设[]): OpeningScenarioCard[] {
  return presets.map((preset) => {
    const chapter = getOpeningChapterAnchor(preset.chapterId);
    return {
      id: preset.id,
      kind: 'official_preset',
      regionId: preset.regionId,
      title: preset.title,
      summary: preset.summary,
      chapterId: preset.chapterId,
      chapterName: chapter?.officialChapterName,
      chapterPhase: chapter?.officialChapterPhase,
      priorStoryState: chapter?.priorStoryState,
      referenceDate: preset.referenceDate,
      referenceTime: preset.referenceTime,
      locationHint: preset.defaultLocationHint,
      highlights: preset.openingPressure,
    };
  });
}

export function buildWorkshopTemplateCards(templates: 创意工坊开局模板[]): OpeningScenarioCard[] {
  return templates.map((template) => {
    const chapter = getOpeningChapterAnchor(template.chapterId);
    return {
      id: template.id,
      kind: 'workshop_template',
      regionId: template.regionId,
      title: template.title,
      summary: template.summary,
      chapterId: template.chapterId,
      chapterName: chapter?.officialChapterName,
      chapterPhase: chapter?.officialChapterPhase,
      priorStoryState: chapter?.priorStoryState,
      locationHint: template.defaultLocationHint,
      highlights: template.openingPressure,
    };
  });
}

export function buildChapterCards(chapters: 开局章节锚点[]): OpeningScenarioCard[] {
  return chapters.map((chapter) => ({
    id: chapter.id,
    kind: 'chapter',
    regionId: chapter.regionId,
    title: chapter.name,
    summary: chapter.summary,
    chapterId: chapter.id,
    chapterName: chapter.officialChapterName,
    chapterPhase: chapter.officialChapterPhase,
    priorStoryState: chapter.priorStoryState,
    referenceDate: chapter.referenceDate,
    referenceTime: chapter.referenceTime,
    locationHint: chapter.defaultLocationHint,
    highlights: chapter.openingPressure,
  }));
}

export function buildOpeningScenarioCards(openingSource: OpeningSource, regionId: string): OpeningScenarioCard[] {
  if (openingSource === 'official_preset') {
    return buildOfficialPresetCards(getOfficialOpeningPresetsByRegion(regionId));
  }
  if (openingSource === 'workshop') {
    return buildWorkshopTemplateCards(getWorkshopOpeningTemplatesByRegion(regionId));
  }
  return buildChapterCards(openingChapterAnchors.filter((chapter) => chapter.regionId === regionId));
}

export function getActiveOpeningCardId(
  openingSource: OpeningSource,
  startingScenarioId: string,
  selectedWorkshopTemplateId: string,
): string {
  return openingSource === 'workshop' ? selectedWorkshopTemplateId : startingScenarioId;
}

export function getOpeningCardChapterName(card: OpeningScenarioCard): string {
  return card.chapterName || '原作主线锚点';
}

export function getOpeningCardChapterPhase(card: OpeningScenarioCard): string {
  return card.chapterPhase || '';
}

export function getOpeningCardBadge(card: OpeningScenarioCard): string {
  const chapterName = getOpeningCardChapterName(card);
  return card.chapterPhase ? `${chapterName} · ${card.chapterPhase}` : chapterName;
}

export function getOpeningCardPriorStoryState(card: OpeningScenarioCard): string {
  return card.priorStoryState || '该锚点之前的原作章节仅作既成背景，不进入正文转跳推进。';
}

export function selectOpeningScenario(
  card: OpeningScenarioCard,
  openingSource: OpeningSource,
  onStartingScenarioId: (id: string) => void,
  onSelectedWorkshopTemplateId: (id: string) => void,
) {
  if (openingSource === 'workshop' && card.kind === 'workshop_template') {
    onSelectedWorkshopTemplateId(card.id);
    onStartingScenarioId(card.chapterId);
    return;
  }
  onStartingScenarioId(card.id);
}

export function toOpeningSkillSlotKey(slot: 战技槽位摘要): OpeningSkillSlotKey {
  return slot.kind === 'normal'
    ? `normal:${slot.slotIndex}`
    : `path:${slot.pathId ?? 'none'}:${slot.slotIndex}`;
}

export function resolveOpeningSkillSlot(slots: 战技槽位摘要[], key: OpeningSkillSlotKey): 战技槽位摘要 | undefined {
  const [kind, pathOrIndex, maybeIndex] = key.split(':');
  if (kind === 'normal') {
    return slots.find((slot) => slot.kind === 'normal' && slot.slotIndex === Number(pathOrIndex));
  }
  return slots.find((slot) => slot.kind === 'path' && slot.pathId === pathOrIndex && slot.slotIndex === Number(maybeIndex));
}

export function openingSkillSlotTitle(slot: 战技槽位摘要): string {
  if (slot.kind === 'normal') return `普通战技槽 ${slot.slotIndex}`;
  const pathDef = slot.pathId ? getPath(slot.pathId) : undefined;
  return `${pathDef?.name ?? '命途'}战技槽 ${slot.slotIndex}`;
}

export function openingSkillRecordSlotLabel(skill: 战技记录): string {
  if (skill.槽位类型 === 'normal') return `普通战技槽 ${skill.槽位序号}`;
  const pathDef = skill.关联命途 ? getPath(skill.关联命途) : undefined;
  return `${pathDef?.name ?? '命途'}战技槽 ${skill.槽位序号}`;
}

export function sameOpeningSkillSlot(a: 战技记录, b: 战技记录): boolean {
  if (a.id === b.id) return false;
  if (a.槽位类型 !== b.槽位类型) return false;
  if (a.槽位序号 !== b.槽位序号) return false;
  if (a.槽位类型 === 'normal') return true;
  return a.关联命途 === b.关联命途;
}

export function formatCustomAbilityEntry(name: string, effect: string): string {
  return `${name.trim()}：${effect.trim()}`;
}

export function splitCustomAbilityEntry(text: string): { name: string; effect: string } {
  const normalized = text.trim();
  const separatorIndex = normalized.search(/[：:]/);
  if (separatorIndex < 0) return { name: normalized, effect: '' };
  return {
    name: normalized.slice(0, separatorIndex).trim() || normalized,
    effect: normalized.slice(separatorIndex + 1).trim(),
  };
}

export function splitOpeningSkillKeywords(value: string): string[] {
  return value
    .split(/[,，、/|\n]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function splitBirthday(value: string): { month: string; day: string } {
  const trimmed = value.trim();
  if (!trimmed) return { month: '', day: '' };
  const match = trimmed.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (match) return { month: match[1], day: match[2] };
  const monthOnly = trimmed.match(/(\d{1,2})\s*月/);
  if (monthOnly) return { month: monthOnly[1], day: '' };
  const dayOnly = trimmed.match(/(\d{1,2})\s*日/);
  if (dayOnly) return { month: '', day: dayOnly[1] };
  const dotted = trimmed.match(/(?:\d{2,4}[./-])?(\d{1,2})[./-](\d{1,2})/);
  if (dotted) return { month: dotted[1], day: dotted[2] };
  return { month: '', day: '' };
}

export function mergeBirthday(month: string, day: string): string {
  const m = month.replace(/[^\d]/g, '').slice(0, 2);
  const d = day.replace(/[^\d]/g, '').slice(0, 2);
  if (!m && !d) return '';
  if (m && d) return `${m}月${d}日`;
  if (m) return `${m}月`;
  return `${d}日`;
}
