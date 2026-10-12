import type { 命途ID, 剧情模式, 阵营ID, 开局来源, 自由开局地点来源, 官方开局预设, 起始场景 } from '@/models/journey';
import type { TurnPhase } from '@/models/turnRecovery';
import { PATH_STAGE_DEFS, type 命途阶段 } from '@/models/path';
import type { 开局整理档案, 世界状态 } from '@/models/world';
import type { 战技记录 } from '@/models/skill';
import { 归一化战技记录 } from '@/models/skill';
import {
  abilityPresets,
  factions,
  getDefaultOpeningScenarioId,
  getFaction,
  getOfficialOpeningPreset,
  getOpeningScenarioBundle,
  getPath,
  getStartingScenario,
  getStoryMode,
  isKnownOpeningScenarioId,
  paths,
  storyModes,
  workshopOpeningTemplates,
} from '@/data/journeyPresets';

export type CanonicalTrailblazer = 'stelle' | 'caelus' | 'both';

export type OpeningSource = 开局来源;

export type FreeOpeningPlanetSource = 自由开局地点来源;

export interface FreeOpeningWorkshopDraft {
  planet: string;
  location: string;
  planetIntro: string;
  npcDetails: string;
  customNpcName: string;
  customNpcBackground: string;
  customNpcPathstrider: string;
  customNpcAbility: string;
  customNpcs: FreeOpeningCustomNpc[];
  currentGoal: string;
  localConflict: string;
  factions: string;
  worldRules: string;
  tone: string;
}

export interface FreeOpeningCustomNpc {
  id: string;
  name: string;
  background: string;
  pathstrider: string;
  ability: string;
}

export interface OpeningPresetDraft {
  openingSource: OpeningSource;
  freeOpeningMainlineEnabled: boolean;
  freeOpeningPlanetSource: FreeOpeningPlanetSource;
  freeOpeningWorkshop: FreeOpeningWorkshopDraft;
  storyMode: 剧情模式;
  name: string;
  alias: string;
  gender: string;
  age: number;
  birthday: string;
  appearance: string;
  personality: string;
  background: string;
  pathId: 命途ID;
  pathStage: 命途阶段;
  factionId: 阵营ID;
  customIdentity: string;
  selectedAbilityIds: string[];
  customAbilities: string[];
  openingSkills: 战技记录[];
  startingScenarioId: string;
  selectedWorkshopTemplateId: string;
  canonicalTrailblazer: CanonicalTrailblazer;
  customStartPrompt: string;
  /** null 表示跳过/失败，走本地整理兜底。 */
  parsedArchive: 开局整理档案 | null;
}

export interface OpeningPlayerPreset {
  id: string;
  title: string;
  updatedAt: number;
  draft: OpeningPresetDraft;
}

export const CANONICAL_TRAILBLAZERS: {
  id: CanonicalTrailblazer;
  title: string;
  subtitle: string;
  worldValue: 世界状态['原著主角'];
}[] = [
  { id: 'stelle', title: '星', subtitle: '女主角', worldValue: '星' },
  { id: 'caelus', title: '穹', subtitle: '男主角', worldValue: '穹' },
  { id: 'both', title: '小孩子才做选择', subtitle: '星与穹都存在', worldValue: '星穹双主角' },
];

export function formatFreeOpeningWorkshopDraft(draft: FreeOpeningWorkshopDraft, source: FreeOpeningPlanetSource): string {
  const npcRows = draft.customNpcs
    .map((npc, index) => {
      const lines = [
        npc.name.trim() ? `名字：${npc.name.trim()}` : `未命名 NPC ${index + 1}`,
        npc.background.trim() ? `背景：${npc.background.trim()}` : '',
        npc.pathstrider.trim() ? `是否为命途行者：${npc.pathstrider.trim()}` : '',
        npc.ability.trim() ? `能力：${npc.ability.trim()}` : '',
      ].filter(Boolean);
      return lines.length ? `${index + 1}. ${lines.join('；')}` : '';
    })
    .filter(Boolean);
  const rows: Array<[string, string]> = source === 'custom' ? [
    ['自创地点/星球', draft.planet],
    ['起始地点', draft.location],
    ['地点简介', draft.planetIntro],
    ['补充自制NPC', npcRows.join('；')],
    ['当前目标', draft.currentGoal],
    ['局部冲突', draft.localConflict],
    ['组织势力', draft.factions],
    ['世界规则', draft.worldRules],
    ['氛围语气', draft.tone],
  ] : [
    ['起始地点', draft.location],
    ['补充自制NPC', npcRows.join('；')],
  ];
  const content = rows
    .map(([label, value]) => {
      const text = value.trim();
      return text ? `${label}：${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
  return content ? `【开局工作台】\n${content}` : '';
}

export function mergeFreeOpeningPrompt(baseText: string, workshopText: string): string {
  const parts = [baseText.trim(), workshopText.trim()].filter(Boolean);
  return parts.join('\n\n');
}

export function getCanonicalTrailblazer(id: CanonicalTrailblazer) {
  return CANONICAL_TRAILBLAZERS.find((item) => item.id === id) ?? CANONICAL_TRAILBLAZERS[0];
}

export function buildOpeningSummary({
  scenario,
  location,
  currentDate,
  currentTime,
  storyMode,
  path,
  pathStage,
  faction,
  customIdentity,
  canonicalTrailblazer,
  customStartPrompt,
  abilities,
  skills,
}: {
  scenario?: 起始场景;
  location?: string;
  currentDate: string;
  currentTime: string;
  storyMode: string;
  path?: ReturnType<typeof getPath>;
  pathStage?: (typeof PATH_STAGE_DEFS)[number];
  faction?: ReturnType<typeof getFaction>;
  customIdentity?: string;
  canonicalTrailblazer?: 世界状态['原著主角'];
  customStartPrompt?: string;
  abilities: string[];
  skills?: 战技记录[];
}): string[] {
  const lines: string[] = [];
  lines.push(`起点：${scenario?.name ?? '未选择'}`);
  if (scenario?.description) lines.push(`场景：${scenario.description}`);
  lines.push(`底色：${storyMode}`);
  lines.push(`日期：${currentDate}`);
  lines.push(`时间：${currentTime}`);
  lines.push(`地点：${location ?? scenario?.name ?? '未选择'}`);
  lines.push(`原著主角：${canonicalTrailblazer ?? '未指定'}`);
  if (path) {
    lines.push(`命途：${path.name} · ${path.aeon}`);
    if (pathStage) lines.push(`命途阶段：${pathStage.name} · ${pathStage.title}`);
  } else {
    lines.push('命途：无命途');
  }
  if (faction) {
    lines.push(`组织背景：${faction.name}`);
    if (faction.openingHint) lines.push(`组织提示：${faction.openingHint}`);
  }
  if (customIdentity?.trim()) lines.push(`身份：${customIdentity.trim()}`);
  if (customStartPrompt?.trim()) lines.push(`切入说明：${customStartPrompt.trim()}`);
  lines.push(`能力：${abilities.length ? abilities.join('、') : '暂未选择'}`);
  lines.push(`开局战技：${skills?.length ? skills.map((skill) => skill.名称).join('、') : '暂未登记'}`);
  if (scenario?.openingHighlights?.length) {
    for (const item of scenario.openingHighlights) {
      lines.push(`场景要点：${item}`);
    }
  }
  return lines;
}

export function resolveSelectedScenarioPreset(startingScenarioId: string, selectedScenario?: 起始场景): 官方开局预设 | undefined {
  const bundlePreset = getOpeningScenarioBundle(startingScenarioId).preset;
  if (bundlePreset) return bundlePreset;
  if (selectedScenario?.officialPresetId) {
    const preset = getOfficialOpeningPreset(selectedScenario.officialPresetId);
    if (preset) return preset;
  }
  return selectedScenario ? getOpeningScenarioBundle(selectedScenario.id).preset : undefined;
}

export function deriveOpeningDraftContext(draft: OpeningPresetDraft) {
  const storyModeDef = getStoryMode(draft.storyMode) ?? storyModes[0];
  const selectedPath = getPath(draft.pathId);
  const selectedPathStage = PATH_STAGE_DEFS.find((item) => item.stage === draft.pathStage) ?? PATH_STAGE_DEFS[0];
  const selectedFaction = getFaction(draft.factionId) ?? factions[0];
  const selectedScenario = getStartingScenario(draft.startingScenarioId);
  const selectedScenarioPreset = resolveSelectedScenarioPreset(draft.startingScenarioId, selectedScenario);
  const scenarioBundle = getOpeningScenarioBundle(draft.startingScenarioId);
  const scenarioPreset = selectedScenarioPreset ?? scenarioBundle.preset;
  const selectedOpeningDate = scenarioPreset?.referenceDate ?? '琥珀纪 2157.03.07';
  const selectedOpeningTime = scenarioPreset?.referenceTime ?? '06:40';
  const selectedOpeningLocation =
    scenarioPreset?.defaultLocationHint
    ?? scenarioBundle.chapter?.defaultLocationHint
    ?? selectedScenario?.name
    ?? '黑塔空间站';
  const selectedOpeningTitle =
    scenarioPreset?.title
    ?? (scenarioBundle.region && scenarioBundle.chapter
      ? `${scenarioBundle.region.name} · ${scenarioBundle.chapter.name}`
      : selectedScenario?.name)
    ?? '未选择';
  const selectedAbilityNames = [
    ...draft.selectedAbilityIds
      .map((id) => abilityPresets.find((ability) => ability.id === id)?.name)
      .filter((text): text is string => Boolean(text)),
    ...draft.customAbilities,
  ];
  const freeOpeningWorkshopText = formatFreeOpeningWorkshopDraft(draft.freeOpeningWorkshop, draft.freeOpeningPlanetSource);
  const effectiveCustomStartPrompt = mergeFreeOpeningPrompt(draft.customStartPrompt, draft.openingSource !== 'official_preset' ? freeOpeningWorkshopText : '');
  const effectiveFreeMainlineEnabled = draft.openingSource === 'official_preset' || draft.freeOpeningMainlineEnabled;
  const canonicalName = getCanonicalTrailblazer(draft.canonicalTrailblazer).worldValue;
  const openingSummaryLines = buildOpeningSummary({
    scenario: selectedScenarioPreset
      ? {
          id: selectedScenarioPreset.chapterId,
          name: selectedScenarioPreset.title,
          description: selectedScenarioPreset.summary,
          openingHighlights: selectedScenarioPreset.openingPressure,
        }
      : scenarioBundle.chapter
        ? {
            id: scenarioBundle.chapter.id,
            name: scenarioBundle.chapter.name,
            description: scenarioBundle.chapter.summary,
            openingHighlights: scenarioBundle.chapter.openingPressure,
          }
        : selectedScenario ?? {
            id: draft.startingScenarioId,
            name: selectedOpeningTitle,
            description: '',
            openingHighlights: [],
          },
    location: selectedOpeningLocation,
    currentDate: selectedOpeningDate,
    currentTime: selectedOpeningTime,
    storyMode: storyModeDef.name,
    path: selectedPath,
    pathStage: draft.pathId !== 'none' ? selectedPathStage : undefined,
    faction: selectedFaction,
    customIdentity: draft.customIdentity,
    customStartPrompt: effectiveCustomStartPrompt,
    canonicalTrailblazer: canonicalName,
    abilities: selectedAbilityNames,
    skills: draft.openingSkills,
  });
  const freeOpeningInput = {
    regionId: scenarioPreset?.regionId ?? scenarioBundle.region?.id ?? 'herta_space_station',
    regionName: scenarioPreset?.regionName ?? scenarioBundle.region?.name ?? '黑塔空间站',
    chapterId: scenarioPreset?.chapterId ?? scenarioBundle.chapter?.id ?? (draft.startingScenarioId || 'herta_station_incident'),
    chapterName: scenarioPreset?.chapterName ?? scenarioBundle.chapter?.name ?? selectedScenario?.name ?? '黑塔空间站 · 主线苏醒前夕',
    chapterSummary: scenarioPreset?.summary ?? scenarioBundle.chapter?.summary ?? selectedScenario?.description ?? '',
    playerText: effectiveCustomStartPrompt,
    defaultLocationHint: selectedOpeningLocation,
    defaultDateHint: selectedOpeningDate,
    defaultTimeHint: selectedOpeningTime,
    officialPresetId: scenarioPreset?.id,
    workshopTemplateId: draft.openingSource === 'workshop' ? draft.selectedWorkshopTemplateId : undefined,
    priorStoryState: scenarioBundle.chapter?.priorStoryState,
    planetSource: draft.freeOpeningPlanetSource,
    mainlineEnabled: effectiveFreeMainlineEnabled,
    keyNpcs: scenarioPreset?.keyNpcs ?? scenarioBundle.preset?.keyNpcs ?? selectedScenario?.openingHighlights ?? [],
  };
  return {
    storyModeDef,
    selectedPath,
    selectedPathStage,
    selectedFaction,
    selectedScenario,
    selectedScenarioPreset,
    scenarioPreset,
    scenarioBundle,
    selectedOpeningDate,
    selectedOpeningTime,
    selectedOpeningLocation,
    selectedOpeningTitle,
    selectedAbilityNames,
    effectiveCustomStartPrompt,
    effectiveFreeMainlineEnabled,
    canonicalName,
    openingSummaryLines,
    freeOpeningInput,
  };
}

export const OPENING_INPUT = '[系统] 开启第 0 回合';

export function isOpeningLanded(
  turnCount: number,
  chatHistory: readonly { role: string }[],
): boolean {
  return turnCount > 1 || chatHistory.some((message) => message.role === 'assistant');
}

export interface OpeningStartFacts {
  turnPhase: TurnPhase | null;
  hasRecovery: boolean;
  openingLanded: boolean;
}

/** 调用方只据此派发常量输入，不从 React 状态回读文本。 */
export function shouldStartOpening(facts: OpeningStartFacts): boolean {
  if (facts.turnPhase !== 'awaitingLanding') return false;
  if (facts.hasRecovery) return false;
  return !facts.openingLanded;
}

export const OPENING_PLAYER_PRESETS_KEY = 'openingPlayerPresets';

export const MAX_OPENING_PLAYER_PRESETS = 20;

export function createOpeningPresetId(): string {
  return `opening-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 身份是预设 ID 而非标题——否则同名预设会互相覆盖。 */
export function upsertOpeningPlayerPreset(presets: OpeningPlayerPreset[], preset: OpeningPlayerPreset): OpeningPlayerPreset[] {
  return [preset, ...presets.filter((item) => item.id !== preset.id)].slice(0, MAX_OPENING_PLAYER_PRESETS);
}

export function normalizeOpeningPresets(value: unknown): OpeningPlayerPreset[] {
  if (!Array.isArray(value)) return [];
  const sorted = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Partial<OpeningPlayerPreset>;
      const draft = sanitizeOpeningPresetDraft(raw.draft);
      const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 32) : draft.name || '未命名开局预设';
      return {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : createOpeningPresetId(),
        title,
        updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
        draft,
      };
    })
    .filter((item): item is OpeningPlayerPreset => Boolean(item))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const seen = new Set<string>();
  return sorted
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, MAX_OPENING_PLAYER_PRESETS);
}

export function sanitizeOpeningPresetDraft(value: unknown): OpeningPresetDraft {
  const raw = value && typeof value === 'object' ? (value as Partial<OpeningPresetDraft>) : {};
  const legacyFreedom = value && typeof value === 'object'
    ? (value as { freeOpeningFreedom?: unknown }).freeOpeningFreedom
    : undefined;
  const migratedPlanetSource =
    isFreeOpeningPlanetSource(raw.freeOpeningPlanetSource)
      ? raw.freeOpeningPlanetSource
      : legacyFreedom === 'high_freedom' || legacyFreedom === 'if_rewrite'
        ? 'custom'
        : 'existing';
  const selectedWorkshopTemplateId =
    typeof raw.selectedWorkshopTemplateId === 'string' &&
    workshopOpeningTemplates.some((template) => template.id === raw.selectedWorkshopTemplateId)
      ? raw.selectedWorkshopTemplateId
      : workshopOpeningTemplates[0]?.id ?? '';
  return {
    openingSource: isOpeningSource(raw.openingSource) ? raw.openingSource : 'official_preset',
    freeOpeningMainlineEnabled: typeof raw.freeOpeningMainlineEnabled === 'boolean' ? raw.freeOpeningMainlineEnabled : true,
    freeOpeningPlanetSource: migratedPlanetSource,
    freeOpeningWorkshop: sanitizeFreeOpeningWorkshop(raw.freeOpeningWorkshop),
    storyMode: isStoryMode(raw.storyMode) ? raw.storyMode : 'normal',
    name: sanitizeText(raw.name),
    alias: sanitizeText(raw.alias),
    gender: sanitizeText(raw.gender),
    age: normalizeAge(raw.age),
    birthday: sanitizeText(raw.birthday),
    appearance: sanitizeText(raw.appearance),
    personality: sanitizeText(raw.personality),
    background: sanitizeText(raw.background),
    pathId: isPathId(raw.pathId) ? raw.pathId : 'none',
    pathStage: isPathStage(raw.pathStage) ? raw.pathStage : 0,
    factionId: isFactionId(raw.factionId) ? raw.factionId : 'none',
    customIdentity: sanitizeText(raw.customIdentity),
    selectedAbilityIds: sanitizeStringArray(raw.selectedAbilityIds)
      .filter((id) => abilityPresets.some((ability) => ability.id === id))
      .slice(0, 2),
    customAbilities: sanitizeStringArray(raw.customAbilities).slice(0, 8),
    openingSkills: sanitizeOpeningSkills(raw.openingSkills),
    startingScenarioId: isKnownOpeningScenarioId(raw.startingScenarioId)
      ? raw.startingScenarioId.trim()
      : getDefaultOpeningScenarioId(),
    selectedWorkshopTemplateId,
    canonicalTrailblazer: isCanonicalTrailblazer(raw.canonicalTrailblazer) ? raw.canonicalTrailblazer : 'stelle',
    customStartPrompt: sanitizeText(raw.customStartPrompt),
    parsedArchive: null,
  };
}

function isOpeningSource(value: unknown): value is OpeningSource {
  return value === 'official_preset' || value === 'free' || value === 'workshop';
}

function isFreeOpeningPlanetSource(value: unknown): value is FreeOpeningPlanetSource {
  return value === 'existing' || value === 'custom';
}

function sanitizeFreeOpeningWorkshop(value: unknown): FreeOpeningWorkshopDraft {
  const raw = value && typeof value === 'object' ? (value as Partial<FreeOpeningWorkshopDraft>) : {};
  const legacyNpcDetails = sanitizeText(raw.npcDetails);
  const rawCustomNpcList = (raw as { customNpcs?: unknown }).customNpcs;
  const hasNewNpcList = Array.isArray(rawCustomNpcList);
  const customNpcs = sanitizeFreeOpeningCustomNpcs(rawCustomNpcList);
  const migratedNpcName = sanitizeText(raw.customNpcName);
  const migratedNpcBackground = sanitizeText(raw.customNpcBackground) || legacyNpcDetails;
  const migratedNpcPathstrider = sanitizeText(raw.customNpcPathstrider);
  const migratedNpcAbility = sanitizeText(raw.customNpcAbility);
  const migratedNpcs = hasNewNpcList || customNpcs.length || (!migratedNpcName && !migratedNpcBackground)
    ? customNpcs
    : [{
        id: `opening_npc_migrated_${Date.now()}`,
        name: migratedNpcName || '未命名 NPC',
        background: migratedNpcBackground,
        pathstrider: migratedNpcPathstrider,
        ability: migratedNpcAbility,
      }];
  return {
    planet: sanitizeText(raw.planet),
    location: sanitizeText(raw.location),
    planetIntro: sanitizeText(raw.planetIntro),
    npcDetails: legacyNpcDetails,
    customNpcName: hasNewNpcList ? migratedNpcName : '',
    customNpcBackground: hasNewNpcList ? sanitizeText(raw.customNpcBackground) : '',
    customNpcPathstrider: hasNewNpcList ? migratedNpcPathstrider : '',
    customNpcAbility: hasNewNpcList ? migratedNpcAbility : '',
    customNpcs: migratedNpcs,
    currentGoal: sanitizeText(raw.currentGoal),
    localConflict: sanitizeText(raw.localConflict),
    factions: sanitizeText(raw.factions),
    worldRules: sanitizeText(raw.worldRules),
    tone: sanitizeText(raw.tone),
  };
}

function sanitizeFreeOpeningCustomNpcs(value: unknown): FreeOpeningCustomNpc[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Partial<FreeOpeningCustomNpc>;
      const name = sanitizeText(raw.name).trim();
      const background = sanitizeText(raw.background).trim();
      if (!name && !background) return null;
      return {
        id: sanitizeText(raw.id) || `opening_npc_${index}_${Date.now()}`,
        name: name || '未命名 NPC',
        background,
        pathstrider: sanitizeText(raw.pathstrider),
        ability: sanitizeText(raw.ability),
      };
    })
    .filter((item): item is FreeOpeningCustomNpc => Boolean(item))
    .slice(0, 12);
}

function sanitizeText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function sanitizeOpeningSkills(value: unknown): 战技记录[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Partial<战技记录>;
      const name = sanitizeText(raw.名称).trim();
      const description = sanitizeText(raw.描述).trim();
      if (!name || !description) return null;
      const slotIndex = Number(raw.槽位序号);
      const now = Date.now();
      return 归一化战技记录({
        id: typeof raw.id === 'string' && raw.id ? raw.id : `skill_${now}_${Math.random().toString(36).slice(2, 8)}`,
        名称: name,
        类别: raw.类别 === '命途' ? '命途' : '普通',
        槽位类型: raw.槽位类型 === 'path' ? 'path' : 'normal',
        槽位序号: Number.isFinite(slotIndex) && slotIndex > 0 ? Math.floor(slotIndex) : 1,
        描述: description,
        来源: sanitizeText(raw.来源) || '开局预设',
        关联命途: raw.关联命途,
        关联阶段: raw.关联阶段,
        关键词: sanitizeStringArray(raw.关键词),
        消耗: sanitizeText(raw.消耗),
        冷却: sanitizeText(raw.冷却),
        备注: sanitizeText(raw.备注),
        已启用: raw.已启用 !== false,
        创建于: typeof raw.创建于 === 'number' && Number.isFinite(raw.创建于) ? raw.创建于 : now,
        更新时间: typeof raw.更新时间 === 'number' && Number.isFinite(raw.更新时间) ? raw.更新时间 : now,
      });
    })
    .filter((item): item is 战技记录 => Boolean(item))
    .slice(0, 8);
}

function normalizeAge(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 20;
  return Math.max(0, Math.min(999, Math.round(num)));
}

function isStoryMode(value: unknown): value is 剧情模式 {
  return storyModes.some((item) => item.id === value);
}

function isPathId(value: unknown): value is 命途ID {
  return paths.some((item) => item.id === value);
}

function isPathStage(value: unknown): value is 命途阶段 {
  return PATH_STAGE_DEFS.some((item) => item.stage === value);
}

function isFactionId(value: unknown): value is 阵营ID {
  return factions.some((item) => item.id === value);
}

function isCanonicalTrailblazer(value: unknown): value is CanonicalTrailblazer {
  return CANONICAL_TRAILBLAZERS.some((item) => item.id === value);
}
