import type { 世界书, 世界书条目, 世界书导出数据, 世界书作用域 } from '@/models/worldbook';
import { 创建空世界书, ENTRY_TYPE_LABELS, SCOPE_LABELS } from '@/models/worldbook';
import { BUILTIN_BOOK_IDS } from '@/data/builtinWorldbookConfig';
import type { 剧情模式, 开局来源 } from '@/models/journey';
import { devLogError } from '@/utils/devLog';

const CURRENT_BUILTIN_ID_SET = new Set<string>(BUILTIN_BOOK_IDS);

export const PROMPT_LIKE_WORLDBOOK_ENTRY_IDS = new Set([
  'builtin_compass_overview',
  'builtin_worldview_spine',
]);

function isPromptLikeWorldbookEntry(entry: 世界书条目): boolean {
  return entry.type === 'system_rule' || PROMPT_LIKE_WORLDBOOK_ENTRY_IDS.has(entry.id);
}

export const WORLDBOOK_STORAGE_KEY = 'worldbooks';


export function normalizeWorldbooks(books: 世界书[]): 世界书[] {
  return books.map((rawBook) => {
    const book = rawBook as Partial<世界书>;
    const id = book.id ?? '';
    return {
      id,
      title: book.title ?? '',
      description: book.description ?? '',
      enabled: book.enabled ?? true,
      builtin: typeof book.builtin === 'boolean' ? book.builtin : CURRENT_BUILTIN_ID_SET.has(id),
      storyModeGate: book.storyModeGate,
      createdAt: book.createdAt ?? 0,
      updatedAt: book.updatedAt ?? 0,
      entries: Array.isArray(book.entries)
        ? book.entries.map((rawEntry) => {
// 旧存档遗留字段 turnGuard：映射为 scope 后删除。
            const entry = rawEntry as Partial<世界书条目>;
            let scope: 世界书作用域[] = Array.isArray(entry.scope) && entry.scope.length
              ? entry.scope
              : (entry as { turnGuard?: 'first_only' }).turnGuard === 'first_only'
                ? ['opening']
                : ['all'];
            const validScopes: 世界书作用域[] = ['main', 'opening', 'battle', 'pathAwakening', 'calibration', 'all'];
            scope = Array.from(new Set(scope.filter((s) => validScopes.includes(s))));
            if (!scope.length) scope = ['all'];

            const rest = { ...entry };
            Reflect.deleteProperty(rest, 'turnGuard');
            return {
              ...rest,
              id: entry.id ?? '',
              title: entry.title ?? '',
              content: entry.content ?? '',
              type: entry.type ?? 'world_lore',
              injectMode: entry.injectMode ?? 'always',
              keywords: entry.keywords ?? [],
              priority: entry.priority ?? 100,
              enabled: entry.enabled ?? true,
              scope,
              createdAt: entry.createdAt ?? 0,
              updatedAt: entry.updatedAt ?? 0,
              keySecondary: entry.keySecondary ?? [],
              caseSensitive: entry.caseSensitive ?? false,
              matchWholeWords: entry.matchWholeWords ?? false,
              useRegex: entry.useRegex ?? false,
              probability: entry.probability ?? 100,
              delay: entry.delay ?? 0,
              cooldown: entry.cooldown ?? 0,
              scanDepth: entry.scanDepth ?? 50,
              injectAtDepth: entry.injectAtDepth ?? false,
              depth: entry.depth ?? 0,
              group: entry.group ?? '',
              groupOverride: entry.groupOverride ?? false,
              groupWeight: entry.groupWeight ?? 0,
              disablesEntries: entry.disablesEntries ?? [],
              logic: entry.logic ?? 'AND_ALL',
              recurse: entry.recurse ?? false,
              recurseDepth: Math.min(Math.max(entry.recurseDepth ?? 1, 0), 5),
            };
          })
        : [],
    };
  });
}

export function reconcileBuiltinWorldbooks({
  sourceBuiltins,
  archivedWorldbooks,
}: {
  sourceBuiltins: 世界书[];
  archivedWorldbooks: 世界书[];
}): 世界书[] {
  const archived = normalizeWorldbooks(archivedWorldbooks);
  if (!archived.length) return sourceBuiltins;

  const archivedById = new Map(archived.map((book) => [book.id, book]));
  const userBooks = archived.filter((book) => !book.builtin);
  const mergedBuiltins = sourceBuiltins.map((builtin) => {
    const saved = archivedById.get(builtin.id);
    if (!saved || builtin.entries.some((entry) => entry.scope.includes('calibration'))) return builtin;

    const entries = builtin.entries.map((entry) => {
      const savedEntry = saved.entries.find((item) => item.id === entry.id);
      if (!savedEntry) return entry;
      return {
        ...entry,
        enabled: savedEntry.enabled,
        createdAt: savedEntry.createdAt,
        updatedAt: savedEntry.updatedAt,
      };
    });
    return { ...builtin, enabled: saved.enabled, entries, updatedAt: saved.updatedAt };
  });

  return [...mergedBuiltins, ...userBooks];
}


export function updateBook(book: 世界书, partial: Partial<世界书>): 世界书 {
  const rest = { ...partial };
  delete rest.builtin;
  return { ...book, ...rest, updatedAt: Date.now() };
}


export function exportWorldbooks(books: 世界书[]): 世界书导出数据 {
  return { version: 1, exportedAt: Date.now(), books: normalizeWorldbooks(books) };
}

export function importWorldbooks(data: unknown, existing: 世界书[]): 世界书[] {
  const parsed = data as 世界书导出数据;
  if (!parsed.version || !Array.isArray(parsed.books)) {
    throw new Error('无效的世界书文件');
  }
  const builtinIds = new Set<string>([
    ...CURRENT_BUILTIN_ID_SET,
    ...existing.filter((book) => book.builtin).map((book) => book.id),
  ]);
  const imported = normalizeWorldbooks(parsed.books).map((book) => {
    const asUser: 世界书 = { ...book, builtin: false };
    if (builtinIds.has(asUser.id)) {
      return { ...asUser, id: 创建空世界书().id };
    }
    return asUser;
  });
  const merged = [...existing];
  for (const book of imported) {
    const idx = merged.findIndex((b) => b.id === book.id);
    if (idx >= 0) {
      merged[idx] = book;
    } else {
      merged.push(book);
    }
  }
  return merged;
}


export interface FilterContext {
  recentUserInput: string;
  recentAIResponse: string;
  worldName: string;
  travelerName: string;
  turnCount: number;
  startScenarioId?: string;
  startSceneName?: string;
  currentLocation?: string;
  currentRegionId?: string;
  openingRegionName?: string;
  openingChapterName?: string;
  openingEntryText?: string;
  openingSource?: 开局来源;
  openingArchiveText?: string;
  /** 本回合明确在场、刚说话或被点名的角色名；不得用地点名自动推导。 */
  npcNames?: string[];
  originalProtagonist?: '星' | '穹' | '星穹双主角';
  currentScope: 'main' | 'opening' | 'battle' | 'pathAwakening' | 'calibration';
  storyMode?: 剧情模式;
  recentMessages?: string[];
  messageCount?: number;
  worldbookTriggerStates?: Record<string, number>;
}


function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildKeywordHaystack(entry: 世界书条目, ctx: FilterContext): string {
  const scanDepth = entry.scanDepth ?? 50;
  const messages = (ctx.recentMessages ?? []).slice(-scanDepth);
  return [
    ...messages,
    ctx.recentUserInput,
    ctx.recentAIResponse,
    ctx.worldName,
    ctx.travelerName,
    ctx.currentLocation,
    ctx.openingRegionName,
    ctx.openingChapterName,
    ctx.openingEntryText,
    ctx.openingSource,
    ctx.openingArchiveText,
  ].join(' ');
}

function matchSingleKeyword(
  kw: string,
  haystack: string,
  opts: { useRegex?: boolean; caseSensitive?: boolean; matchWholeWords?: boolean },
): boolean {
  const { useRegex, caseSensitive, matchWholeWords } = opts;
  const flags = caseSensitive ? 'g' : 'gi';

  if (useRegex) {
    try {
      return new RegExp(kw, flags).test(haystack);
    } catch {
      return false;
    }
  }

  const k = caseSensitive ? kw : kw.toLowerCase();
  const target = caseSensitive ? haystack : haystack.toLowerCase();

  if (matchWholeWords) {
    return new RegExp(`\\b${escapeRegExp(k)}\\b`, flags).test(haystack);
  }
  return target.includes(k);
}

function entryMatchesKeywords(entry: 世界书条目, ctx: FilterContext, extraHaystack = ''): boolean {
  if (!entry.keywords.length) return true;

  const haystack = buildKeywordHaystack(entry, ctx) + (extraHaystack ? '\n' + extraHaystack : '');
  const opts = {
    useRegex: entry.useRegex,
    caseSensitive: entry.caseSensitive,
    matchWholeWords: entry.matchWholeWords,
  };

  const mainHit = entry.keywords.some((kw) => matchSingleKeyword(kw, haystack, opts));
  if (!mainHit) return false;

  const secondary = entry.keySecondary ?? [];
  if (secondary.length === 0) return true;

  const logic = entry.logic ?? 'AND_ALL';
  switch (logic) {
    case 'AND_ANY':
      return secondary.some((kw) => matchSingleKeyword(kw, haystack, opts));
    case 'AND_ALL':
      return secondary.every((kw) => matchSingleKeyword(kw, haystack, opts));
    case 'NOT_ANY':
      return !secondary.every((kw) => matchSingleKeyword(kw, haystack, opts));
    case 'NOT_ALL':
      return !secondary.some((kw) => matchSingleKeyword(kw, haystack, opts));
    default:
      return secondary.every((kw) => matchSingleKeyword(kw, haystack, opts));
  }
}

function checkProbability(entry: 世界书条目, random: () => number = Math.random): boolean {
  const prob = entry.probability ?? 100;
  if (prob >= 100) return true;
  if (prob <= 0) return false;
  return random() * 100 < prob;
}

function checkDelayAndCooldown(
  entry: 世界书条目,
  triggerStates: Record<string, number> | undefined,
  currentMessageCount: number,
): boolean {
  const delay = entry.delay ?? 0;
  if (delay > 0 && currentMessageCount < delay) return false;

  const cooldown = entry.cooldown ?? 0;
  if (cooldown > 0 && triggerStates) {
    const lastTriggered = triggerStates[entry.id] as number | undefined;
    if (lastTriggered !== undefined) {
      const messagesSinceLastTrigger = currentMessageCount - lastTriggered;
      if (messagesSinceLastTrigger < cooldown) return false;
    }
  }

  return true;
}


function entryMatchesScope(entry: 世界书条目, ctx: FilterContext): boolean {
  const scope = entry.scope.length ? entry.scope : (['all'] as 世界书作用域[]);
  return scope.includes('all') || scope.includes(ctx.currentScope);
}

function bookMatchesStoryMode(book: 世界书, ctx: FilterContext): boolean {
  if (!book.storyModeGate || book.storyModeGate.length === 0) return true;
  if (!ctx.storyMode) return false;
  return book.storyModeGate.includes(ctx.storyMode);
}

const reportedFallbackEntryIds = new Set<string>();

/** keyword_match 但无 keywords 的残缺/旧条目会退化为恒触发并静默注入正文，命中即记 devLogError。 */
function reportFallbackDegradedEntry(book: 世界书, entry: 世界书条目): void {
  if (entry.injectMode !== 'keyword_match' || entry.keywords.length > 0) return;
  if (reportedFallbackEntryIds.has(entry.id)) return;
  reportedFallbackEntryIds.add(entry.id);
  devLogError(
    'stage',
    `世界书条目「${entry.title}」为兜底退化条目：keyword_match 模式但无 keywords，缺失字段经 normalize 兜底后按始终注入触发`,
    new Error(`fallback-degraded worldbook entry triggered: ${entry.id}`),
    { bookId: book.id, bookTitle: book.title, entryId: entry.id },
  );
}

export interface WorldbookPlanOptions {
  random?: () => number;
  enabled?: boolean;
}

export interface ResolvedWorldbookEntry {
  entry: 世界书条目;
  bookTitle: string;
}

export interface WorldbookInjectionPlan {
  systemRuleEntries: ResolvedWorldbookEntry[];
  alwaysEntries: ResolvedWorldbookEntry[];
  keywordEntries: ResolvedWorldbookEntry[];
  depthMessages: WorldbookChatModuleMessage[];
  triggeredEntryIds: string[];
}

function gatherTriggeredEntries(
  books: 世界书[],
  ctx: FilterContext,
  options: WorldbookPlanOptions = {},
): Array<{ entry: 世界书条目; bookTitle: string }> {
  const msgCount = ctx.messageCount ?? 0;
  const triggerStates = ctx.worldbookTriggerStates;
  const RECURSION_HARD_LIMIT = 5;
  const random = options.random ?? Math.random;

  const triggered: Array<{ entry: 世界书条目; bookTitle: string }> = [];
  const triggeredIds = new Set<string>();

  for (const book of books) {
    if (!book.enabled) continue;
    if (!bookMatchesStoryMode(book, ctx)) continue;
    for (const entry of book.entries) {
      if (!entry.enabled) continue;
      if (!entryMatchesScope(entry, ctx)) continue;
      if (entry.injectMode === 'keyword_match') {
        if (!entryMatchesKeywords(entry, ctx)) continue;
        if (!checkProbability(entry, random)) continue;
        if (!checkDelayAndCooldown(entry, triggerStates, msgCount)) continue;
      }
      reportFallbackDegradedEntry(book, entry);
      triggered.push({ entry, bookTitle: book.title });
      triggeredIds.add(entry.id);
    }
  }

  let depth = 0;
  while (depth < RECURSION_HARD_LIMIT) {
    const recursingContents = triggered
      .filter((it) => it.entry.recurse && (it.entry.recurseDepth ?? 1) > depth)
      .map((it) => it.entry.content)
      .join('\n');
    if (!recursingContents) break;

    const newHits: Array<{ entry: 世界书条目; bookTitle: string }> = [];
    for (const book of books) {
      if (!book.enabled) continue;
      if (!bookMatchesStoryMode(book, ctx)) continue;
      for (const entry of book.entries) {
        if (!entry.enabled) continue;
        if (triggeredIds.has(entry.id)) continue;
        if (!entryMatchesScope(entry, ctx)) continue;
        if (entry.injectMode !== 'keyword_match') continue;
        const entryMaxDepth = entry.recurseDepth ?? 1;
        if (depth >= entryMaxDepth) continue;
        if (!entryMatchesKeywords(entry, ctx, recursingContents)) continue;
        if (!checkProbability(entry, random)) continue;
        if (!checkDelayAndCooldown(entry, triggerStates, msgCount)) continue;
        reportFallbackDegradedEntry(book, entry);
        newHits.push({ entry, bookTitle: book.title });
        triggeredIds.add(entry.id);
      }
    }
    if (newHits.length === 0) break;
    triggered.push(...newHits);
    depth++;
  }

  return triggered;
}

function collectTriggeredEntryIds(books: 世界书[], ctx: FilterContext): Set<string> {
  return new Set(gatherTriggeredEntries(books, ctx).map((it) => it.entry.id));
}


/** 入参需已按 priority 降序排好；并列时取先出现者。 */
function applyGroupOverride<T extends { entry: 世界书条目 }>(items: T[]): T[] {
  const groupMap = new Map<string, T[]>();
  const noGroup: T[] = [];

  for (const item of items) {
    const g = item.entry.group ?? '';
    if (!g) {
      noGroup.push(item);
    } else {
      const arr = groupMap.get(g) ?? [];
      arr.push(item);
      groupMap.set(g, arr);
    }
  }

  const result: T[] = [...noGroup];
  for (const [, groupItems] of groupMap) {
    const hasOverride = groupItems.some((it) => it.entry.groupOverride);
    if (hasOverride && groupItems.length > 1) {
      const sorted = [...groupItems].sort(
        (a, b) => (b.entry.groupWeight ?? 0) - (a.entry.groupWeight ?? 0),
      );
      result.push(sorted[0]);
    } else {
      result.push(...groupItems);
    }
  }
  return result;
}

function applyDisablesEntries<T extends { entry: 世界书条目 }>(items: T[]): T[] {
  const disabledIds = new Set<string>();
  for (const item of items) {
    const list = item.entry.disablesEntries;
    if (list && list.length > 0) {
      for (const id of list) disabledIds.add(id);
    }
  }
  if (disabledIds.size === 0) return items;
  return items.filter((item) => !disabledIds.has(item.entry.id));
}

export interface WorldbookInjectionSplit {
  systemPromptEntries: Array<{ entry: 世界书条目; bookTitle: string }>;
  messageEntries: Array<{ entry: 世界书条目; bookTitle: string }>;
}

function buildWorldbookDepthMessage(
  entry: 世界书条目,
  bookTitle: string,
  ctx: FilterContext,
): WorldbookChatModuleMessage {
  const typeLabel = ENTRY_TYPE_LABELS[entry.type];
  const content = [
    `# 世界书｜${entry.title}`,
    `来源：${bookTitle} / ${typeLabel} / 优先级 ${entry.priority}`,
    '',
    replaceWorldbookPlaceholders(entry.content, ctx),
  ].join('\n');
  return {
    role: 'system',
    content,
    _injectionPosition: 1,
    _injectionDepth: entry.depth ?? 0,
    _injectionOrder: entry.priority,
  };
}

export function renderWorldbookSystemEntry(
  item: ResolvedWorldbookEntry,
  ctx: FilterContext,
  category: '世界书' | '提示词',
): string {
  const typeLabel = ENTRY_TYPE_LABELS[item.entry.type];
  return [
    `# ${category}｜${item.entry.title}`,
    `来源：${item.bookTitle} / ${typeLabel} / 优先级 ${item.entry.priority}`,
    '',
    replaceWorldbookPlaceholders(item.entry.content, ctx),
  ].join('\n');
}

export function resolvePromptWorldbookPlan(
  books: 世界书[] | undefined,
  context: FilterContext | undefined,
  enabled: boolean,
): WorldbookInjectionPlan | null {
  if (!enabled || !books || !context) return null;
  return resolveWorldbookInjectionPlan(books, context, {
    random: createSeededRandom(buildWorldbookSeed(context)),
  });
}

function buildWorldbookSeed(context: FilterContext): string {
  const triggerState = Object.entries(context.worldbookTriggerStates ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, turn]) => `${id}:${turn}`)
    .join('|');
  return [
    context.currentScope,
    context.turnCount,
    context.messageCount ?? 0,
    context.recentUserInput,
    ...(context.recentMessages ?? []),
    triggerState,
  ].join('\u241f');
}

function createSeededRandom(seedText: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    state ^= seedText.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  state >>>= 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function resolveWorldbookInjectionPlan(
  books: 世界书[],
  ctx: FilterContext,
  options: WorldbookPlanOptions = {},
): WorldbookInjectionPlan {
  const empty: WorldbookInjectionPlan = {
    systemRuleEntries: [],
    alwaysEntries: [],
    keywordEntries: [],
    depthMessages: [],
    triggeredEntryIds: [],
  };
  if (options.enabled === false) return empty;

  const all = gatherTriggeredEntries(books, ctx, options);
  all.sort((a, b) => b.entry.priority - a.entry.priority);
  const afterDisables = applyDisablesEntries(applyGroupOverride(all));

  const plan: WorldbookInjectionPlan = {
    systemRuleEntries: [],
    alwaysEntries: [],
    keywordEntries: [],
    depthMessages: [],
    triggeredEntryIds: [],
  };
  for (const item of afterDisables) {
    const { entry, bookTitle } = item;
    if (entry.injectMode === 'keyword_match') plan.triggeredEntryIds.push(entry.id);
    if (entry.type === 'system_rule') {
      plan.systemRuleEntries.push(item);
    } else if (entry.injectAtDepth) {
      plan.depthMessages.push(buildWorldbookDepthMessage(entry, bookTitle, ctx));
    } else if (entry.injectMode === 'always') {
      plan.alwaysEntries.push(item);
    } else {
      plan.keywordEntries.push(item);
    }
  }
  return plan;
}

export function buildWorldbookInjection(
  books: 世界书[],
  ctx: FilterContext,
): string {
  const plan = resolveWorldbookInjectionPlan(books, ctx);
  const items = [
    ...plan.alwaysEntries.filter(({ entry }) => !isPromptLikeWorldbookEntry(entry)),
    ...plan.keywordEntries,
  ];
  if (!items.length) return '';
  return items
    .map((item) => renderWorldbookSystemEntry(item, ctx, item.entry.type === 'system_rule' ? '提示词' : '世界书'))
    .join('\n\n---\n\n');
}

export function buildPromptLikeWorldbookInjection(
  books: 世界书[],
  ctx: FilterContext,
): string {
  const plan = resolveWorldbookInjectionPlan(books, ctx);
  const items = [
    ...plan.systemRuleEntries,
    ...plan.alwaysEntries.filter(({ entry }) => isPromptLikeWorldbookEntry(entry)),
  ];
  if (!items.length) return '';
  return items.map((item) => renderWorldbookSystemEntry(item, ctx, '世界书')).join('\n\n---\n\n');
}

export interface WorldbookChatModuleMessage {
  role: string;
  content: string;
  _injectionPosition: number;
  _injectionDepth: number;
  _injectionOrder: number;
}

export function buildWorldbookChatModuleMessages(
  books: 世界书[],
  ctx: FilterContext,
): WorldbookChatModuleMessage[] {
  return resolveWorldbookInjectionPlan(books, ctx).depthMessages;
}

export function replaceWorldbookPlaceholders(content: string, ctx: FilterContext): string {
  const playerName = ctx.travelerName.trim() || '无名开拓者';
  const originalProtagonistName = formatOriginalProtagonistName(ctx.originalProtagonist);
  const originalProtagonistSubject = formatOriginalProtagonistSubject(ctx.originalProtagonist);
  return content
    .replace(/\{playerName\}/g, playerName)
    .replace(/\{originalProtagonistName\}/g, originalProtagonistName)
    .replace(/\{originalProtagonistSubject\}/g, originalProtagonistSubject)
    .replace(/\{openingRegionName\}/g, ctx.openingRegionName?.trim() || '当前开局地区')
    .replace(/\{openingChapterName\}/g, ctx.openingChapterName?.trim() || '当前章节锚点')
    .replace(/\{openingEntryText\}/g, ctx.openingEntryText?.trim() || '无额外开局介入文本')
    .replace(/\{openingArchiveText\}/g, ctx.openingArchiveText?.trim() || '无结构化开局档案');
}

function formatOriginalProtagonistName(originalProtagonist: FilterContext['originalProtagonist']): string {
  if (originalProtagonist === '星') return '星';
  if (originalProtagonist === '穹') return '穹';
  if (originalProtagonist === '星穹双主角') return '星与穹';
  return '所选原著主角';
}

function formatOriginalProtagonistSubject(originalProtagonist: FilterContext['originalProtagonist']): string {
  if (originalProtagonist === '星') return '原作主角星';
  if (originalProtagonist === '穹') return '原作主角穹';
  if (originalProtagonist === '星穹双主角') return '原作主角星与穹';
  return '所选原著主角';
}


export function explainEntry(entry: 世界书条目): string {
  const parts: string[] = [];
  parts.push(`类型：${ENTRY_TYPE_LABELS[entry.type]}`);
  const kwInfo = entry.keywords.length ? `匹配关键词[${entry.keywords.join(', ')}]` : '关键词匹配（无关键词）';
  parts.push(`注入：${entry.injectMode === 'always' ? '始终注入' : kwInfo}`);
  parts.push(`优先级：${entry.priority}`);
  const scope = entry.scope.length ? entry.scope : (['all'] as 世界书作用域[]);
  parts.push(`场景：${scope.map((s) => SCOPE_LABELS[s]).join(' / ')}`);

  const advanced: string[] = [];
  if (entry.keySecondary && entry.keySecondary.length > 0) {
    advanced.push(`次要关键词[${entry.keySecondary.join(', ')}]`);
  }
  if (entry.caseSensitive) advanced.push('大小写敏感');
  if (entry.matchWholeWords) advanced.push('全词匹配');
  if (entry.useRegex) advanced.push('正则匹配');
  if ((entry.probability ?? 100) < 100) advanced.push(`概率${entry.probability}%`);
  if ((entry.delay ?? 0) > 0) advanced.push(`延迟${entry.delay}条`);
  if ((entry.cooldown ?? 0) > 0) advanced.push(`冷却${entry.cooldown}条`);
  if ((entry.scanDepth ?? 50) !== 50) advanced.push(`扫描${entry.scanDepth}条`);

  if (entry.injectAtDepth) advanced.push(`深度${entry.depth ?? 0}`);
  if (entry.group) advanced.push(`分组[${entry.group}]${entry.groupOverride ? '·覆盖' : ''}`);
  if (entry.groupOverride && (entry.groupWeight ?? 0) !== 0) advanced.push(`组权重${entry.groupWeight}`);
  if (entry.disablesEntries && entry.disablesEntries.length > 0) {
    advanced.push(`互斥[${entry.disablesEntries.length}条]`);
  }

  if (entry.logic && entry.logic !== 'AND_ALL') advanced.push(`逻辑${entry.logic}`);
  if (entry.recurse) advanced.push(`递归${entry.recurseDepth ?? 1}层`);

  if (advanced.length) parts.push(`高级：${advanced.join(' / ')}`);

  return parts.join(' | ');
}

export { collectTriggeredEntryIds };

/** 必须在 buildSystemPrompt 之后调用，否则本回合刚触发的条目会被自己的 cooldown 屏蔽；无触发时返回原表引用，调用方据此判断是否 setState。 */
export function updateTriggerStatesAfterTurn(
  books: 世界书[],
  ctx: FilterContext,
  plan?: WorldbookInjectionPlan,
): Record<string, number> {
  const hitIds = plan
    ? new Set(plan.triggeredEntryIds)
    : collectTriggeredEntryIds(books, ctx);
  if (hitIds.size === 0) return ctx.worldbookTriggerStates ?? {};
  const msgCount = ctx.messageCount ?? 0;
  const prev = ctx.worldbookTriggerStates ?? {};
  const next: Record<string, number> = { ...prev };
  for (const id of hitIds) {
    next[id] = msgCount;
  }
  return next;
}
