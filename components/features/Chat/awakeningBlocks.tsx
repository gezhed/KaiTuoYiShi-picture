import type { NPC记录 } from '@/models/npc';
import type { 角色数据结构 } from '@/models/character';
import type { 相册系统 } from '@/models/imageGeneration';
import type { VisualTextSettings } from '@/models/settings';
import { BodyBlock } from './MessageRenderers';
import { 解析狭间问答 } from '@/utils/awakening';
import { badgeClip, cardClip, mediumClip } from './turnStyles';

export function AwakeningQuestionsBlock({ raw }: { raw: string }) {
  const { 命途名: pathName, 问题: items } = 解析狭间问答(raw);
  if (items.length === 0) return null;

  return (
    <div
      className="mt-2 p-3"
      style={{
        background: 'rgba(var(--tj-panel-bg-end),0.55)',
        border: '1px solid rgba(var(--tj-btn-primary-end), var(--tj-edge-tint))',
        clipPath: cardClip,
      }}
    >
      <div
        className="mb-2 text-[11px] tracking-[0.32em]"
        style={{ color: 'rgba(var(--tj-btn-primary-start),0.85)' }}
      >
        ◆ 三 问 · {pathName || '命途意志'}
      </div>
      <div className="space-y-2">
        {items.map((q, i) => (
          <div key={i} className="flex gap-2 text-sm leading-relaxed">
            <span
              className="shrink-0 font-serif tracking-wider"
              style={{ color: 'rgba(var(--tj-btn-primary-start),0.85)' }}
            >
              {q.标签}
            </span>
            <span style={{ color: 'rgba(var(--tj-text-primary),0.95)' }}>{q.内容}</span>
          </div>
        ))}
      </div>
      <div
        className="mt-2 text-[11px] leading-relaxed"
        style={{ color: 'rgba(var(--tj-btn-primary-end),0.7)' }}
      >
        在下方输入框中回答这三问,命途意志将据此评判你是否能跨入下一阶。
      </div>
    </div>
  );
}

export function AwakeningJudgementBadge({ judgement }: { judgement: string }) {
  const j = judgement.trim();
  const isPromote = j.includes('升阶') || /promote/i.test(j);

  let label = j;
  let color = 'rgba(var(--tj-text-primary),0.95)';
  let bg = 'rgba(var(--tj-panel-bg-start),0.55)';
  let stroke = 'rgba(var(--tj-btn-primary-end),0.45)';

  if (isPromote) {
    label = '升 阶';
    color = 'rgba(var(--tj-ui-success),0.95)';
    bg = 'rgba(var(--tj-ui-success),0.15)';
    stroke = 'rgba(var(--tj-ui-success),0.55)';
  }

  return (
    <div className="mt-2 flex items-center justify-center">
      <div
        className="px-6 py-2 font-serif text-base tracking-[0.5em]"
        style={{
          color,
          background: bg,
          border: `1px solid ${stroke}`,
          clipPath: badgeClip,
        }}
      >
        ◇ {label} ◇
      </div>
    </div>
  );
}

export function AwakeningOracleBlock({
  content,
  pathName,
  kind,
  npcRecords,
  traveler,
  album,
  showInnerVoice = true,
  deferOffscreen = false,
  visualTextSettings,
}: {
  content: string;
  pathName: string;
  kind: '出题' | '评判';
  npcRecords?: NPC记录[];
  traveler?: 角色数据结构;
  album?: 相册系统;
  showInnerVoice?: boolean;
  deferOffscreen?: boolean;
  visualTextSettings?: VisualTextSettings;
}) {
  if (!content.trim()) return null;
  const subtitle = kind === '评判' ? '评 语' : '低 语';
  return (
    <div
      className="mx-1 px-4 py-3"
      style={{
        background:
          'linear-gradient(180deg, rgba(var(--tj-panel-bg-end),0.45) 0%, rgba(var(--tj-panel-bg-start),0.45) 100%)',
        border: '1px solid rgba(var(--tj-btn-primary-end), var(--tj-edge-tint))',
        clipPath: mediumClip,
      }}
    >
      <div
        className="mb-2 flex items-center justify-between text-[11px] tracking-[0.32em]"
        style={{ color: 'rgba(var(--tj-btn-primary-start),0.8)' }}
      >
        <span>◆ 命途意志 · {subtitle}</span>
        {pathName && (
          <span style={{ color: 'rgba(var(--tj-btn-primary-end),0.6)' }}>{pathName}</span>
        )}
      </div>
      <BodyBlock content={content} npcRecords={npcRecords} traveler={traveler} album={album} showInnerVoice={showInnerVoice} visualTextSettings={visualTextSettings} deferOffscreen={deferOffscreen} />
    </div>
  );
}

export function AwakeningAftermathLine({
  pathName,
}: {
  pathName: string;
}) {
  const label = pathName || '这条命途';

  return (
    <div className="mt-2 flex items-center justify-center px-3">
      <div
        className="font-serif text-[13px] leading-relaxed tracking-[0.12em] text-center"
        style={{ color: 'rgba(var(--tj-text-primary),0.95)', textShadow: '0 0 18px rgba(var(--tj-btn-primary-start), 0.45)' }}
      >
        你感觉到自己在「{label}」的路上,行进得更远了。
      </div>
    </div>
  );
}
