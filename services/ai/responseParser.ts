import { 创建空解析回复, type 解析后回复 } from '@/models/chat';

interface TagRule {
  tag: string;
  key: keyof 解析后回复;
  aliases: string[];
  isArray?: boolean;
}

const TAG_RULES: TagRule[] = [
  { tag: 'thinking', key: 'thinking', aliases: ['think', '思考', '推理'] },
  { tag: '正文', key: 'body', aliases: ['body', 'content', 'text', '内容'] },
  { tag: '短期记忆', key: 'memory', aliases: ['memory', 'summary', 'recap', '记忆', '回忆'] },
  { tag: '命令', key: 'commands', aliases: ['command', 'commands', 'cmd'] },
  { tag: '动态世界', key: 'worldEvents', aliases: ['world', 'worldevent', '世界', '事件'], isArray: true },
  { tag: '行动选项', key: 'actionOptions', aliases: ['actions', 'options', 'choice', 'choices', '选项'], isArray: true },
  { tag: '变量草稿', key: 'variableDraft', aliases: ['variableDraft', '变量候选', '变量线索', '变量摘要'] },
  { tag: '剧情规划', key: 'storyPlan', aliases: ['storyPlan', 'storyPlanning', '剧情计划', '剧情安排', '后续规划'] },
  { tag: '触发狭间', key: 'awakenInvite', aliases: ['awakeninvite', '狭间邀请', '命途狭间触发'] },
  { tag: '狭间问答', key: 'awakenQuestions', aliases: ['awakenquestions', '命途狭间问答'] },
  { tag: '狭间评判', key: 'awakenJudgement', aliases: ['awakenjudgement', '命途狭间评判'] },
];

const LEGACY_STRIP_ONLY_TAGS = ['战斗', 'battle', 'combat', '战斗记录'];

function normalizeTag(tag: string): string {
  return tag.replace(/[/\s]/g, '').toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function stripProtocolBlocksFromBody(body: string): string {
  if (!body) return body;
  const nonBodyTags = TAG_RULES
    .filter((rule) => rule.key !== 'body')
    .flatMap((rule) => [rule.tag, ...rule.aliases])
    .concat(LEGACY_STRIP_ONLY_TAGS)
    .map(escapeRegExp);
  const bodyTags = TAG_RULES
    .filter((rule) => rule.key === 'body')
    .flatMap((rule) => [rule.tag, ...rule.aliases])
    .map(escapeRegExp);
  const protocolGroup = [...new Set(nonBodyTags)].join('|');
  const bodyGroup = [...new Set(bodyTags)].join('|');
  if (!protocolGroup) return body.trim();

  let cleaned = body;
  cleaned = cleaned.replace(
    new RegExp(`\\s*<\\s*(?:${protocolGroup})\\s*>[\\s\\S]*?<\\s*\\/\\s*(?:${protocolGroup})\\s*>`, 'gi'),
    '',
  );
  cleaned = cleaned.replace(
    new RegExp(`\\s*<\\s*(?:${protocolGroup})\\s*>[\\s\\S]*$`, 'gi'),
    '',
  );
  cleaned = cleaned
    .replace(new RegExp(`<\\s*\\/\\s*(?:${bodyGroup || protocolGroup})\\s*>`, 'gi'), '')
    .replace(new RegExp(`<\\s*\\/?\\s*(?:${protocolGroup})\\s*>`, 'gi'), '');
  return cleaned.trim();
}

function stripStSurfaceNoiseFromBody(body: string): string {
  if (!body) return body;
  let cleaned = body
    .replace(/^\s*#{1,6}\s*(?:正文|故事正文|main\s*text|response)\s*$/gim, '')
    .replace(/^\s*(?:正文|故事正文)\s*[:：]\s*$/gim, '')
    .replace(/^\s*```(?:markdown|md|html|json|text)?\s*$/gim, '')
    .replace(/^\s*```\s*$/gim, '');

  const stHelperTags = [
    'math',
    'Q',
    'WF',
    'Prism',
    'Prism_Deep',
    'VariableCheck',
    'current_event',
    'progress',
    'options',
    'branches',
    'snow',
    'Shiosai',
    'quote',
    'meow_FM',
    'konatan_planning~',
    'konatan_chat',
    'tucao',
    'danmu',
    'htmlcontent',
    'guifan',
    'disclaimer',
    'details',
  ].map(escapeRegExp).join('|');
  cleaned = cleaned.replace(
    new RegExp(`\\s*<\\s*(?:${stHelperTags})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*(?:${stHelperTags})\\s*>`, 'gi'),
    '',
  );
  cleaned = cleaned.replace(/\s*<!--\s*[\s\S]*?\s*-->/g, '');

  return cleaned
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function repairTags(raw: string): string {
  if (!raw) return raw;
  let text = raw;

  text = text.replace(/[〈＜]/g, '<').replace(/[〉＞]/g, '>');

  text = text.replace(/<\s*\\\s*/g, '</');

  text = text.replace(/<\s*\/\s*([一-龥A-Za-z_][一-龥A-Za-z0-9_]*)\s*>/g, '</$1>');

  text = text.replace(/<([一-龥A-Za-z_][一-龥A-Za-z0-9_]*)>\s*<\1>/g, '<$1>');

  return text;
}

function buildTagPattern(): RegExp {
  const allTags = TAG_RULES.flatMap((r) => [r.tag, ...r.aliases]);
  const escaped = allTags.map((t) => t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
  const unique = [...new Set(escaped)];
  return new RegExp(`<(${unique.join('|')})>([\\s\\S]*?)(?=<(?:${unique.join('|')})>|$)`, 'gi');
}

export function cleanActionOptionText(text: string): string {
  let cleaned = text.trim();
  for (let i = 0; i < 3; i++) {
    const next = cleaned
      .replace(/^(?:行动选项|后续选项|可选行动|actions?|options?|choices?)\s*[:：]\s*/i, '')
      .replace(/^[-*•·]\s*/, '')
      .replace(/^[（(]?\d+[）)]\s*/, '')
      .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '')
      .replace(/^\d+[.)、:：]\s*/, '')
      .replace(/^[A-Za-z][.)、:：]\s*/, '')
      .replace(/^(?:选项|选择|行动|方案)\s*[一二三四五六七八九十\dA-Da-d]+\s*[:：.)、-]\s*/, '')
      .replace(/^(?:选项|选择|行动|方案)\s*[:：]\s*/, '')
      .trim();
    if (next === cleaned) break;
    cleaned = next;
  }
  return cleaned;
}

function isInvalidActionOption(option: string): boolean {
  const normalized = option.trim();
  if (!normalized) return true;
  if (/^<\/?[A-Za-z0-9_\-\u3400-\u9fff]+\s*>$/i.test(normalized)) return true;
  if (/<\/?\s*(?:disclaimer|免责声明|正文|短期记忆|剧情规划|变量草稿|变量候选|变量线索|变量摘要|命令|行动选项|动态世界|thinking|think|狭间问答|狭间评判)\s*>/i.test(normalized)) return true;
  if (/^(?:行动选项|后续选项|可选行动|选项|actions?|options?|choices?)\s*[:：]?$/i.test(normalized)) return true;
  if (/本(?:段|故事|内容|作品).*虚构|纯属虚构|免责声明|disclaimer/i.test(normalized)) return true;
  return normalized.length > 120;
}

export function parseActionOptionsBlock(optionsBlock: string): string[] {
  const text = (optionsBlock || '').trim();
  if (!text) return [];

  const splitCandidateLine = (line: string): string[] => {
    const normalizedLine = line.trim();
    if (!normalizedLine) return [];

    const inlineEnumeratedMatches = Array.from(
      normalizedLine.matchAll(/(?:^|\s)((?:\d+[.)、:：]|[A-Za-z][.)、:：]|[(（]\d+[)）]|[①②③④⑤⑥⑦⑧⑨⑩])\s*[\s\S]*?)(?=\s+(?:\d+[.)、:：]|[A-Za-z][.)、:：]|[(（]\d+[)）]|[①②③④⑤⑥⑦⑧⑨⑩])\s*|$)/g),
    ).map((match) => (match[1] || '').trim()).filter(Boolean);
    if (inlineEnumeratedMatches.length >= 2) {
      return inlineEnumeratedMatches.map(cleanActionOptionText);
    }

    const quotedSegments = Array.from(
      normalizedLine.matchAll(/[“"]([^“”"]{1,120})[”"]/g),
    ).map((match) => (match[1] || '').trim()).filter(Boolean);
    if (quotedSegments.length >= 2) return quotedSegments;

    if (/[；;]/.test(normalizedLine)) {
      const parts = normalizedLine.split(/[；;]/).map(cleanActionOptionText).filter(Boolean);
      if (parts.length >= 2) return parts;
    }

    return [cleanActionOptionText(normalizedLine)].filter(Boolean);
  };

  const parsed = text
    .replace(/<\s*disclaimer\s*>[\s\S]*?(?:<\s*\/\s*disclaimer\s*>|$)/gi, '\n')
    .replace(/<\s*免责声明\s*>[\s\S]*?(?:<\s*\/\s*免责声明\s*>|$)/gi, '\n')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap(splitCandidateLine)
    .filter((option) => !isInvalidActionOption(option));

  return Array.from(new Set(parsed)).slice(0, 6);
}

export function parseResponse(rawText: string, options?: { repair?: boolean }): 解析后回复 {
  const text = options?.repair ? repairTags(rawText) : rawText;
  const result = 创建空解析回复();
  result.rawText = rawText;

  const allTagNames = TAG_RULES.flatMap((r) => [r.tag, ...r.aliases]);
  const escapedTags = allTagNames.map((t) => t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
  const uniqueEscaped = [...new Set(escapedTags)];
  const trailingCloseTagRe = new RegExp(`\\s*<\\s*/\\s*(?:${uniqueEscaped.join('|')})\\s*>\\s*$`, 'i');

  const applyMatch = (rawTagName: string, content: string) => {
    const normalized = normalizeTag(rawTagName);
    const cleaned = content.replace(trailingCloseTagRe, '').trim();
    for (const rule of TAG_RULES) {
      const ruleTag = normalizeTag(rule.tag);
      const aliases = rule.aliases.map(normalizeTag);
      if (normalized === ruleTag || aliases.includes(normalized)) {
        if (rule.isArray) {
          const arr = result[rule.key];
          if (Array.isArray(arr) && cleaned) {
            arr.push(cleaned);
          }
        } else {
          (result as unknown as Record<string, unknown>)[rule.key] = cleaned;
        }
        return true;
      }
    }
    return false;
  };

  // 必须先跑显式闭合标签：thinking 正文里出现的字面 <短期记忆> / <动态世界> 会被 lookahead 误判为下一段开始。
  const consumedRanges: Array<[number, number]> = [];
  const closedPattern = new RegExp(
    `<(${uniqueEscaped.join('|')})>([\\s\\S]*?)<\\s*/\\s*\\1\\s*>`,
    'gi',
  );
  let closedMatch: RegExpExecArray | null;
  while ((closedMatch = closedPattern.exec(text)) !== null) {
    applyMatch(closedMatch[1], closedMatch[2]);
    consumedRanges.push([closedMatch.index, closedMatch.index + closedMatch[0].length]);
  }

  const isInsideConsumed = (idx: number) =>
    consumedRanges.some(([start, end]) => idx >= start && idx < end);

  const pattern = buildTagPattern();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (isInsideConsumed(match.index)) continue;
    applyMatch(match[1], match[2]);
    consumedRanges.push([match.index, match.index + match[0].length]);
  }

  // AI 漏写 <正文> 但仍输出 <行动选项> 等标签时，用已消费块之外的剩余文本兜底，避免叙事段被吞。
  if (!result.body) {
    const sorted = [...consumedRanges].sort((a, b) => a[0] - b[0]);
    const pieces: string[] = [];
    let cursor = 0;
    for (const [start, end] of sorted) {
      if (start > cursor) pieces.push(text.slice(cursor, start));
      cursor = Math.max(cursor, end);
    }
    if (cursor < text.length) pieces.push(text.slice(cursor));
    const leftover = pieces
      .join('\n')
      .replace(/<\s*\/?\s*[一-龥A-Za-z_][一-龥A-Za-z0-9_]*\s*>/g, '')
      .trim();
    if (leftover) result.body = leftover;
  }

  if (result.actionOptions.length) {
    result.actionOptions = parseActionOptionsBlock(result.actionOptions.join('\n'));
  }

  const advance = parseStoryAdvanceBlock(result.storyPlan);
  if (advance) result.storyAdvance = advance;

  result.body = stripStSurfaceNoiseFromBody(stripProtocolBlocksFromBody(result.body));

  return result;
}

export function parseStoryAdvanceBlock(storyPlan: string): 解析后回复['storyAdvance'] {
  const block = /<\s*剧情推进\s*>([\s\S]*?)<\s*\/\s*剧情推进\s*>/i.exec(storyPlan);
  if (!block) return undefined;
  const text = block[1].trim();
  if (!text) return undefined;
  const completed = /完成\s*[:：]\s*(是|true|yes|1)/i.test(text);
  const targetRaw = /进入分段\s*[:：]\s*([^\n；;]+)/.exec(text)?.[1]?.trim().replace(/[。．.]+$/, '');
  const basis = /依据\s*[:：]\s*([^\n]+)/.exec(text)?.[1]?.trim();
  const targetSegment = targetRaw && targetRaw !== '无' && targetRaw !== '没有' ? targetRaw : undefined;
  return { completed, ...(targetSegment ? { targetSegment } : {}), ...(basis ? { basis } : {}) };
}

export function isEmptyResponse(parsed: 解析后回复): boolean {
  const hasBody = Boolean(parsed.body.trim());
  const hasThinking = Boolean(parsed.thinking.trim());
  const hasMemory = Boolean(parsed.memory.trim());
  const hasWorldEvents = Array.isArray(parsed.worldEvents) && parsed.worldEvents.some((e) => e.trim());
  const hasActionOptions = Array.isArray(parsed.actionOptions) && parsed.actionOptions.some((o) => o.trim());
  const hasVariableDraft = Boolean(parsed.variableDraft.trim());
  const hasStoryPlan = Boolean(parsed.storyPlan.trim());
  const hasAwakenContent = Boolean(
    parsed.awakenInvite.trim() || parsed.awakenQuestions.trim() || parsed.awakenJudgement.trim(),
  );
  return !hasBody && !hasThinking && !hasMemory && !hasWorldEvents && !hasActionOptions
    && !hasVariableDraft && !hasStoryPlan && !hasAwakenContent;
}
