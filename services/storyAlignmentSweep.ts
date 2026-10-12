/**
 * 剧情对齐巡检：每隔若干回合，把近几回合正文压成一段「阶段摘要」，
 * 交给 AI 与整个剧情库比对，判断故事当前最接近哪一段，供对齐逻辑「向前纠正」当前段。
 *
 * 它只产出一个后续分段信号（复用 StoryAdvanceJudgement），不直接改状态；
 * 是否真的推进、以及中间段如何归档，仍由 autoAlignCanonStoryProgress 裁决（只向前）。
 */
import type { API配置项 } from '@/models/settings';
import type { 剧情编织分段, 剧情编织系列 } from '@/models/storyWeaving';
import type { 聊天消息 } from '@/models/chat';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import { parseJsonWithRepair } from '@/services/ai/structuredOutputRepair';
import { devLogError } from '@/utils/devLog';
import type { StoryAdvanceJudgement } from '@/services/storyAdvanceJudge';

const SUMMARY_PER_TURN_LIMIT = 480;
const FIELD_LIMIT = 60;

const SWEEP_SYSTEM_PROMPT = `
你是剧情对齐巡检器。你会读到一个「近期剧情阶段摘要」和一份「剧情分段库」。
任务：判断故事当前最接近剧情库里的哪一段。
- 只依据摘要里已经实际发生的内容，不要依据预告、意图或玩家计划推测。
- 玩家可能没有按原著顺序、也可能用不同措辞或路径抵达相同剧情；按「内容最接近」判断，不要卡字面用词。
- 若摘要明显还在当前段或更早，或证据不足以判断，就返回 null，不要硬塞一个后续段。
- 只输出 JSON，不要输出任何其他文本：
{"segmentNumber": 数字或null, "reason": "一句话依据"}
`.trim();

export interface StoryAlignmentSweepInput {
  series: 剧情编织系列;
  currentSegment: 剧情编织分段;
  summary: string;
}

function truncate(text: string, limit: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned;
}

/** 取最近若干回合的 assistant 正文，压成阶段摘要；不新增任何摘要调用。 */
export function buildRecentStorySweepSummary(history: readonly 聊天消息[], turns: number): string {
  const bodies = history
    .filter((message) => message.role === 'assistant')
    .slice(-Math.max(1, Math.trunc(turns) || 1))
    .map((message) => truncate(message.parsedResponse?.body || message.content || '', SUMMARY_PER_TURN_LIMIT))
    .filter(Boolean);
  return bodies.join('\n---\n');
}

export function buildStoryAlignmentSweepUserPrompt(input: StoryAlignmentSweepInput): string {
  const segments = [...input.series.分段列表]
    .filter((segment) => segment.启用注入 && segment.处理状态 === '已完成')
    .sort((a, b) => a.组号 - b.组号);
  const segmentLines = segments.map((segment) => {
    const parts = [
      `[${segment.组号}] ${segment.标题}`,
      segment.本段概括 ? `概括：${truncate(segment.本段概括, FIELD_LIMIT)}` : '',
      segment.关键事件.length ? `关键事件：${segment.关键事件.slice(0, 4).map((event) => truncate(event.事件名 || event.事件说明, FIELD_LIMIT)).filter(Boolean).join('、')}` : '',
      segment.本段结束状态.length ? `结束状态：${segment.本段结束状态.slice(0, 3).map((item) => truncate(item, FIELD_LIMIT)).join('；')}` : '',
      segment.涉及地点.length ? `地点：${segment.涉及地点.slice(0, 4).join('、')}` : '',
    ];
    return parts.filter(Boolean).join(' ｜ ');
  });
  return [
    `当前记录的所在分段：[${input.currentSegment.组号}] ${input.currentSegment.标题}`,
    '',
    '【剧情分段库】',
    segmentLines.join('\n') || '（空）',
    '',
    '【近期剧情阶段摘要】',
    input.summary || '（空）',
    '',
    '请判断故事当前最接近哪一段，给出它的组号；判断不了就返回 null。',
  ].join('\n');
}

export async function runStoryAlignmentSweep(
  config: API配置项,
  input: StoryAlignmentSweepInput,
  signal?: AbortSignal,
): Promise<StoryAdvanceJudgement | null> {
  if (!input.summary.trim()) return null;
  try {
    const rawText = await chatCompletionNonStream(config, {
      systemPrompt: SWEEP_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildStoryAlignmentSweepUserPrompt(input) }],
      signal,
      maxTokens: 320,
      temperature: 0.1,
    });
    const parsed = parseJsonWithRepair<Partial<{ segmentNumber: number | null; reason: string }>>(rawText, 'object');
    const number = typeof parsed.segmentNumber === 'number' && Number.isFinite(parsed.segmentNumber)
      ? Math.trunc(parsed.segmentNumber)
      : null;
    const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 160) : '';
    if (number === null) return { completed: false, reason: reason || '巡检未判断出更靠后的分段' };
    const target = input.series.分段列表.find((segment) => segment.组号 === number && segment.启用注入 && segment.处理状态 === '已完成');
    if (!target) return { completed: false, reason: reason || `巡检给出的组号 ${number} 不对应可用分段` };
    return { completed: false, actualSegmentId: target.id, reason: reason || `巡检判定故事最接近「${target.标题}」` };
  } catch (error) {
    devLogError('stage', 'story_alignment_sweep.failed', error);
    return null;
  }
}
