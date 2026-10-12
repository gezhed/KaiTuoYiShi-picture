import type { 解析后回复 } from '../models/chat';
import type { 额外功能设置 } from '../models/settings';

export function stripInternalProtocolTags(text: string): string {
  if (!text) return text;
  return text
    .replace(/\s*<\s*天气\s*>[\s\S]*?<\s*\/\s*天气\s*>\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeContaminatedText(text: string, settings?: 额外功能设置): string {
  const cleaned = stripInternalProtocolTags(text);
  const config = settings?.污染词清理;
  if (!config?.enabled) return cleaned;
  const words = Array.isArray(config.words) ? config.words.map((word) => word.trim()).filter(Boolean) : [];
  if (!words.length || !cleaned) return cleaned;
  let next = cleaned;
  for (const word of words) {
    next = next.split(word).join('');
  }
  return next
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const HIDDEN_TAG_BLOCK_RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: '抗空回声明', pattern: /<Q>[\s\S]*?<\/WF>/g },
  { name: '抗截断高数题', pattern: /<math>[\s\S]*?<\/math>/g },
];

export function stripHiddenTagBlocks(text: string, settings?: 额外功能设置): string {
  const config = settings?.标签块隐藏;
  if (!config?.enabled || !text) return text;
  let next = text;
  for (const rule of HIDDEN_TAG_BLOCK_RULES) {
    next = next.replace(rule.pattern, '');
  }
  return next
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeParsedResponse(parsed: 解析后回复, settings?: 额外功能设置): 解析后回复 {
  const stripBlocks = (text: string) => stripHiddenTagBlocks(text, settings);
  const cleanText = (text: string) => sanitizeContaminatedText(stripBlocks(text), settings);
  const cleanArray = (items: string[]) => items.map((item) => cleanText(item)).filter(Boolean);
  return {
    ...parsed,
    thinking: cleanText(parsed.thinking),
    body: cleanText(parsed.body),
    memory: cleanText(parsed.memory),
    variableDraft: cleanText(parsed.variableDraft),
    storyPlan: cleanText(parsed.storyPlan),
    awakenInvite: cleanText(parsed.awakenInvite),
    awakenQuestions: cleanText(parsed.awakenQuestions),
    awakenJudgement: cleanText(parsed.awakenJudgement),
    worldEvents: cleanArray(parsed.worldEvents),
    actionOptions: cleanArray(parsed.actionOptions),
    rawText: cleanText(parsed.rawText),
  };
}
