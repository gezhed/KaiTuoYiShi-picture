import type { 主动来信种子 } from '@/models/phone';
import { canonicalContactId } from '@/utils/phone';

/** 私聊 id 有 npc-123 与 npc_npc-123 两种形态；群聊 id 不透明，不得按 npc_ 归一化。 */
export type PhoneSeedTargetRef = Pick<主动来信种子, 'targetType' | 'targetId' | 'relatedNpcIds'>;

export function isSamePhoneSeedTarget(a: PhoneSeedTargetRef, b: PhoneSeedTargetRef): boolean {
  if (a.targetType !== b.targetType) return false;
  if (a.targetType === 'group') return a.targetId === b.targetId;
  const aIds = new Set([a.targetId, ...a.relatedNpcIds].filter(Boolean).map(canonicalContactId));
  return [b.targetId, ...b.relatedNpcIds]
    .filter(Boolean)
    .map(canonicalContactId)
    .some((id) => aIds.has(id));
}

function normalizePhoneSeedComparableText(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[，。！？!?；;、,.…~～“”"'[\]（）()《》<>]/g, '')
    .trim();
}

export function isPhoneSeedTextSimilar(a: string, b: string): boolean {
  const left = normalizePhoneSeedComparableText(a);
  const right = normalizePhoneSeedComparableText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 12 && right.includes(left)) return true;
  if (right.length >= 12 && left.includes(right)) return true;
  const shared = [...new Set(left)].filter((char) => right.includes(char)).length;
  return shared / Math.max(1, Math.min(left.length, right.length)) >= 0.82;
}
