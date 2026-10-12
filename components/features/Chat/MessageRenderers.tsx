import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { NPC记录 } from '@/models/npc';
import { 读取NPC头像 } from '@/models/npc';
import type { 角色数据结构 } from '@/models/character';
import type { 相册系统 } from '@/models/imageGeneration';
import type { VisualTextSettings } from '@/models/settings';
import { normalizeInlineSpeakerTags, shouldRenderAsNarrationForPlayerLine } from '@/utils/playerSpeechGuard';
import { getBuiltinAvatarSetForNames } from '@/data/builtinAvatars';
import { 解析相册资源引用 } from '@/utils/albumActions';
import { AvatarImage } from '@/components/ui/ResilientImage';
import { cardClip } from '@/components/ui/clipPaths';
import { 匹配锚点行 } from '@/services/ai/imageGen/illustrationProtocol';
import { use逐段推进, 派生段落插图 } from './use逐段推进';

interface BodyBlockProps {
  content: string;
  npcRecords?: NPC记录[];
  traveler?: 角色数据结构;
  album?: 相册系统;
  showInnerVoice?: boolean;
  userInput?: string;
  visualTextSettings?: VisualTextSettings;
  deferOffscreen?: boolean;
  /** 待插入正文行间的插图；锚点文本与渲染行做模糊匹配，命中后插在该行之后。 */
  行间插图?: Array<{ id: string; 锚点: string }>;
  /** 渲染一张插图卡片；返回 null 表示这张不渲染。 */
  renderIllustration?: (插图Id: string) => ReactNode;
  /** AVG 式逐句推进设置；不传即关闭，行为与原来一致。 */
  逐句推进?: { 启用: boolean; 立即全显: boolean };
  /** 流式生成中：句子还在变，逐句推进没有意义，强制全显。 */
  生成中?: boolean;
}

const DEFERRED_NARRATION_STYLE = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 96px',
} as const;

const DEFERRED_DIALOGUE_STYLE = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 128px',
} as const;

const DEFERRED_INNER_VOICE_STYLE = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 144px',
} as const;

const DEFAULT_VISUAL_TEXT_SETTINGS: VisualTextSettings = {
  narrationFontSize: 15,
  dialogueFontSize: 15,
  playerFontSize: 14,
};

function clampFontSize(value: unknown, fallback: number): number {
  return Math.max(13, Math.min(30, Math.trunc(Number(value) || fallback)));
}

function normalizeVisualTextSettings(input?: Partial<VisualTextSettings>): VisualTextSettings {
  return {
    narrationFontSize: clampFontSize(input?.narrationFontSize, DEFAULT_VISUAL_TEXT_SETTINGS.narrationFontSize),
    dialogueFontSize: clampFontSize(input?.dialogueFontSize, DEFAULT_VISUAL_TEXT_SETTINGS.dialogueFontSize),
    playerFontSize: clampFontSize(input?.playerFontSize, DEFAULT_VISUAL_TEXT_SETTINGS.playerFontSize),
  };
}

type ParsedBodyLine =
  | { kind: 'narration'; text: string }
  | { kind: 'dialogue'; name: string; text: string }
  | { kind: 'inner'; text: string }
  | { kind: 'unparsed'; text: string }
  | { kind: 'blank' };

const NARR_RE = /^【\s*旁白\s*】\s*(.*)$/;
const DIAG_RE = /^【\s*角色\s*】\s*([^：:]+)[：:]\s*(.*)$/;
const NAMED_DIAG_RE = /^【\s*([^】]+?)\s*】\s*(.*)$/;
const INNER_RE = /^【\s*心声\s*】\s*(.*)$/;

const SOUND_EFFECT_TAGS = new Set([
  '汪',
  '汪汪',
  '喵',
  '喵喵',
  '呜',
  '呜呜',
  '嗷',
  '嗷呜',
  '吼',
  '吼吼',
  '咆',
  '咆哮',
  '嘶吼',
  '吱',
  '吱呀',
  '嘶',
  '嘶嘶',
  '轰',
  '轰隆',
  '轰隆隆',
  '砰',
  '砰砰',
  '咚',
  '咚咚',
  '咔',
  '咔哒',
  '滴',
  '滴滴',
  '滴答',
  '叮',
  '叮咚',
  '啪',
  '啪啪',
  '哗',
  '哗啦',
  '沙',
  '沙沙',
  '呼',
  '呼噜',
  '唰',
  '嗡',
  '嗡嗡',
  '滋',
  '滋滋',
  '咻',
  '咻咻',
  '哐',
  '哐当',
  '扑通',
  '隆',
  '隆隆',
]);

function parseBodyLines(body: string, traveler?: 角色数据结构, userInput?: string): ParsedBodyLine[] {
  return normalizeInlineSpeakerTags(body).split(/\r?\n/).flatMap<ParsedBodyLine>((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return { kind: 'blank' };
    let m = trimmed.match(NARR_RE);
    if (m) {
      const text = m[1].trim();
      if (isSoundEffectText(text)) {
        return { kind: 'narration', text };
      }
      const quoted = extractFullQuotedSpeech(text);
      if (quoted && traveler && !shouldRenderAsNarrationForPlayerLine(quoted, userInput)) {
        return { kind: 'dialogue', name: getTravelerDisplayName(traveler), text: quoted };
      }
      return { kind: 'narration', text };
    }
    m = trimmed.match(DIAG_RE);
    if (m) return splitDialogueAndTrailingNarration(m[1].trim(), m[2].trim(), traveler);
    m = trimmed.match(INNER_RE);
    if (m) return { kind: 'inner', text: m[1].trim() };
    m = trimmed.match(NAMED_DIAG_RE);
    if (m && !['旁白', '心声', '角色'].includes(m[1].trim())) {
      const name = m[1].trim();
      const text = m[2].trim();
      if (isSoundEffectSpeakerName(name)) {
        return { kind: 'narration', text: combineSoundEffectNarration(name, text) };
      }
      return splitDialogueAndTrailingNarration(name, text, traveler, userInput);
    }
    if (isSoundEffectText(trimmed)) {
      return { kind: 'narration', text: trimmed };
    }
    const quoted = extractFullQuotedSpeech(trimmed);
    if (quoted && traveler) {
      return { kind: 'dialogue', name: getTravelerDisplayName(traveler), text: quoted };
    }
    return { kind: 'unparsed', text: trimmed };
  });
}

function normalizeSoundEffectTag(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, '')
    .replace(/[~～…。！？!?、，,：:；;“”"‘’'（）()【】[\]《》<>·\-—]/g, '');
}

function isSoundEffectSpeakerName(name: string): boolean {
  const clean = normalizeSoundEffectTag(name);
  return isNormalizedSoundEffect(clean);
}

function isSoundEffectText(text: string): boolean {
  const clean = normalizeSoundEffectTag(text);
  return isNormalizedSoundEffect(clean);
}

function isNormalizedSoundEffect(clean: string): boolean {
  if (!clean || clean.length > 18) return false;
  if (SOUND_EFFECT_TAGS.has(clean)) return true;
  if (clean.length <= 8 && Array.from(clean).every((char) => char === clean[0]) && SOUND_EFFECT_TAGS.has(clean[0])) return true;
  return /^(轰隆隆|轰隆|隆隆|轰|隆|砰|咚|咔哒|咔|吼|嗷|嘶|呜|滴滴|滴|嗡|滋|哐当|哐|啪|唰|咻){1,5}$/.test(clean);
}

function combineSoundEffectNarration(name: string, text: string): string {
  const sound = name.trim();
  const rest = text.trim();
  if (!rest) return sound;
  if (/[。！？!?…]$/.test(sound) || /^[。！？!?…、，,：:；;]/.test(rest)) {
    return `${sound}${rest}`;
  }
  return `${sound}，${rest}`;
}

function getTravelerDisplayName(traveler: 角色数据结构): string {
  return traveler.姓名.trim() || traveler.别名.trim() || '你';
}

function extractFullQuotedSpeech(text: string): string | null {
  const match = text.match(/^[“"「](.+?)[”"」]([。！？!?])?$/);
  if (!match) return null;
  const inner = match[1].trim();
  if (inner.length < 4) return null;
  if (!/[我你您吗呢吧呀啊？！!?。]/.test(inner)) return null;
  return inner;
}

function splitDialogueAndTrailingNarration(
  name: string,
  text: string,
  traveler?: 角色数据结构,
  userInput?: string,
): ParsedBodyLine[] {
  if (!traveler || !isProtagonist(name, traveler)) {
    return [{ kind: 'dialogue', name, text }];
  }
  if (shouldRenderAsNarrationForPlayerLine(text, userInput)) {
    return [{ kind: 'narration', text }];
  }

  const quoteMatch = text.match(/^([“"「].+?[”"」][。！？!?]?)(\s+.+)$/);
  if (!quoteMatch) {
    return [{ kind: 'dialogue', name, text }];
  }

  const quoted = extractFullQuotedSpeech(quoteMatch[1].trim());
  if (!quoted) {
    return [{ kind: 'dialogue', name, text }];
  }

  return [
    { kind: 'dialogue', name, text: quoted },
    { kind: 'narration', text: quoteMatch[2].trim() },
  ];
}

const CHAR_COLORS = [
  'rgb(140, 195, 230)',
  'rgb(195, 175, 235)',
  'rgb(155, 215, 175)',
  'rgb(230, 165, 195)',
  'rgb(235, 180, 145)',
  'rgb(180, 215, 220)',
  'rgb(220, 200, 155)',
  'rgb(200, 180, 240)',
];

function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CHAR_COLORS[hash % CHAR_COLORS.length];
}

function withAlpha(rgb: string, alpha: number): string {
  if (rgb.includes('var(')) {
    return rgb.replace('rgb(', 'rgba(').replace(/\)$/, `, ${alpha})`);
  }
  return rgb.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
}

function buildNpcLookupMap(records?: NPC记录[]): Map<string, NPC记录> {
  const map = new Map<string, NPC记录>();
  if (!records) return map;
  for (const n of records) {
    if (n.姓名 && !map.has(n.姓名)) map.set(n.姓名, n);
    if (n.别名 && !map.has(n.别名)) map.set(n.别名, n);
    const builtinSet = getBuiltinAvatarSetForNames(n.姓名, n.别名);
    if (builtinSet && !map.has(builtinSet.canonicalName)) map.set(builtinSet.canonicalName, n);
  }
  return map;
}

function lookupNpc(name: string, map: Map<string, NPC记录>): NPC记录 | undefined {
  if (!name) return undefined;
  const direct = map.get(name);
  if (direct) return direct;
  const builtinSet = getBuiltinAvatarSetForNames(name);
  return builtinSet ? map.get(builtinSet.canonicalName) : undefined;
}

function isProtagonist(name: string, traveler?: 角色数据结构): boolean {
  if (!traveler) return false;
  const n = name.trim();
  if (!n) return false;
  if (n === '你' || n === '我') return true;
  if (traveler.姓名 && n === traveler.姓名.trim()) return true;
  if (traveler.别名 && n === traveler.别名.trim()) return true;
  return false;
}

interface AvatarTileProps {
  name: string;
  url?: string;
  color: string;
  size?: 'sm' | 'md';
}

export const AvatarTile = memo(function AvatarTile({ name, url, color, size = 'sm' }: AvatarTileProps) {
  const dim = size === 'md' ? 'w-12 h-12 sm:w-14 sm:h-14' : 'w-11 h-11 sm:w-12 sm:h-12';
  const labelColor = withAlpha(color, 0.98);
  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0">
      <div
        className={`${dim} rounded-full flex items-center justify-center overflow-hidden relative`}
        style={{
          background: url ? 'rgba(var(--tj-surface-strong), 0.72)' : `linear-gradient(135deg, ${withAlpha(color, 0.22)}, rgba(var(--tj-chat-bubble), 0.92))`,
          boxShadow: `0 0 0 1px ${withAlpha(color, 0.58)}`,
        }}
      >
        {url ? (
          <AvatarImage src={url} alt={`${name} 头像`} className="w-full h-full object-cover" />
        ) : (
          <span
            className="font-serif font-bold text-lg"
            style={{ color: withAlpha(color, 0.95) }}
          >
            {name.charAt(0) || '?'}
          </span>
        )}
      </div>
      <div
        className="px-2 py-0.5 max-w-[78px] text-center rounded-sm"
        style={{
          background: 'rgba(var(--tj-chat-bubble), 0.88)',
          boxShadow: `inset 0 0 0 1px ${withAlpha(color, 0.52)}`,
        }}
      >
        <span
          className="block truncate font-serif text-[11px] font-semibold tracking-[0.1em]"
          style={{ color: labelColor }}
        >
          {name}
        </span>
      </div>
    </div>
  );
});

interface DialogueBubbleProps {
  name: string;
  text: string;
  color: string;
  avatarUrl?: string;
  deferOffscreen?: boolean;
}

export const DialogueBubble = memo(function DialogueBubble({ name, text, color, avatarUrl, fontSize = 15, isProtagonist = false, deferOffscreen = false }: DialogueBubbleProps & { fontSize?: number; isProtagonist?: boolean }) {
  const bubbleBg = isProtagonist
    ? 'rgba(var(--tj-accent-primary), 0.08)'
    : 'rgba(var(--tj-chat-bubble), var(--tj-chat-bubble-alpha, 0.78))';
  const bubbleStroke = isProtagonist
    ? 'rgba(var(--tj-accent-primary), 0.55)'
    : withAlpha(color, 0.4);
  const textColor = isProtagonist
    ? 'rgba(var(--tj-text-primary), 0.96)'
    : 'rgba(var(--tj-chat-text), 0.96)';
  return (
    <div className="group my-3 flex items-start justify-start gap-3" style={deferOffscreen ? DEFERRED_DIALOGUE_STYLE : undefined}>
      <AvatarTile name={name} url={avatarUrl} color={color} size="sm" />
      <div className="relative flex-1 min-w-0 mt-1">
        <div
          className="relative rounded px-4 py-3"
          style={{
            background: bubbleBg,
            color: textColor,
            boxShadow: `inset 0 0 0 1px ${bubbleStroke}`,
          }}
        >
          <p className="whitespace-pre-wrap break-words" style={{ fontSize: `${fontSize}px`, lineHeight: 1.8 }}>
            {text}
          </p>
        </div>
      </div>
    </div>
  );
});

interface InnerVoiceBubbleProps {
  text: string;
  traveler?: 角色数据结构;
  album?: 相册系统;
  deferOffscreen?: boolean;
}

function InnerVoiceBubble({ text, traveler, album, fontSize = 15, deferOffscreen = false }: InnerVoiceBubbleProps & { fontSize?: number }) {
  const PEACH = 'rgb(var(--tj-accent-secondary))';
  const name = traveler?.姓名.trim() || '我';
  const avatarUrl = 解析相册资源引用(album, traveler?.图像档案?.正文头像?.trim() || traveler?.头像.trim()) || undefined;
  return (
    <div className="group my-3 flex items-start gap-3" style={deferOffscreen ? DEFERRED_INNER_VOICE_STYLE : undefined}>
      <AvatarTile name={name} url={avatarUrl} color={PEACH} size="md" />
      <div className="relative flex-1 min-w-0 mt-1">
        <div className="mb-1 flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-serif tracking-[0.28em] italic"
            style={{
              color: PEACH,
              background: withAlpha(PEACH, 0.08),
              border: `1px dashed ${withAlpha(PEACH, 0.45)}`,
              borderRadius: '999px',
            }}
          >
            <span aria-hidden style={{ color: withAlpha(PEACH, 0.6) }}>○</span>
            <span>· 心绪 ·</span>
            <span aria-hidden style={{ color: withAlpha(PEACH, 0.6) }}>○</span>
          </span>
        </div>
        <div
          className="px-4 py-3 italic"
          style={{
            background: withAlpha(PEACH, 0.04),
            border: `1px dashed ${withAlpha(PEACH, 0.5)}`,
            color: withAlpha(PEACH, 0.92),
            borderRadius: '14px',
            textShadow: `0 0 12px ${withAlpha(PEACH, 0.18)}`,
          }}
        >
          <p className="whitespace-pre-wrap break-words tracking-wide" style={{ fontSize: `${fontSize}px`, lineHeight: 1.75 }}>
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}

export const NarrationLine = memo(function NarrationLine({ text, fontSize = 15, deferOffscreen = false }: { text: string; fontSize?: number; deferOffscreen?: boolean }) {
  return (
    <div
      className="my-2.5 px-5 py-2.5 relative"
      style={{
        ...(deferOffscreen ? DEFERRED_NARRATION_STYLE : {}),
        background: 'rgba(var(--tj-accent-primary), 0.018)',
        borderLeft: '2px solid rgba(var(--tj-accent-primary), 0.34)',
        borderRight: '1px solid rgba(var(--tj-border), 0.24)',
      }}
    >
      <p
        className="whitespace-pre-wrap break-words"
        style={{ color: 'rgba(var(--tj-chat-text), 0.94)', fontSize: `${fontSize}px`, lineHeight: 1.8 }}
      >
        {text}
      </p>
    </div>
  );
});

export function BodyBlock({ content, npcRecords, traveler, album, showInnerVoice = true, userInput, visualTextSettings, deferOffscreen = false, 行间插图, renderIllustration, 逐句推进, 生成中 = false }: BodyBlockProps) {
  const lines = useMemo(() => (content ? parseBodyLines(content, traveler, userInput) : []), [content, traveler, userInput]);
  const fontSettings = useMemo(() => normalizeVisualTextSettings(visualTextSettings), [visualTextSettings]);
  const npcMap = useMemo(() => buildNpcLookupMap(npcRecords), [npcRecords]);

  /**
   * AVG 式逐段推进：一次只渲染**一段**，前进时上一段消失。
   *
   * 单位是段落（按正文空行切）而不是单个渲染行：正文里对白常一行一句，
   * 按行推进会变成一堆几个字的停顿，读起来很碎。
   *
   * 注意不能先 slice 再渲染：`行插图` 的行号是按**完整 lines** 算的，
   * 切片会让索引整体错位、插图插到别的行上。所以只按区间限制渲染。
   */
  const 推进 = use逐段推进({
    行: lines,
    启用: 逐句推进?.启用 === true,
    立即全显: 逐句推进?.立即全显 === true,
    生成中,
  });

  /**
   * 把插图锚点匹配到**渲染行**上。
   *
   * 不用流水线算出的行索引：那个索引基于 `content.split('\n')` 的原始行，
   * 而这里的分组把对白的多行合并成一段，两套编号并不等价。
   * 直接对渲染后的行文本做模糊匹配，既不依赖编号稳定性，也能容忍正文被编辑过。
   */
  const 行插图 = useMemo(() => {
    const 映射 = new Map<number, string[]>();
    if (!行间插图 || 行间插图.length === 0) return 映射;
    const 行文本 = lines.map((行) => ('text' in 行 ? 行.text : '') || '');
    const 已用 = new Set<number>();
    for (const 项 of 行间插图) {
      const 命中 = 匹配锚点行(行文本, 项.锚点);
      if (!命中 || 已用.has(命中.行索引)) continue;
      已用.add(命中.行索引);
      映射.set(命中.行索引, [...(映射.get(命中.行索引) ?? []), 项.id]);
    }
    return 映射;
  }, [行间插图, lines]);

  /** 兜底：所有没匹配上的插图按原顺序铺在正文之后，而不是整张丢掉。 */
  const 未匹配插图 = useMemo(() => {
    const 已放 = new Set<string>();
    行插图.forEach((列表) => 列表.forEach((id) => 已放.add(id)));
    return (行间插图 ?? []).filter((项) => !已放.has(项.id));
  }, [行插图, 行间插图]);

  /**
   * 逐段推进时**固定在上方**的那张图。
   *
   * 图的归属规则来自用户的 galgame 前端（`galgame前端.html` L563-L588）：
   * 每个文本块沿用最近一个 `<image>` 的图，所以同一张图会横跨多段文字，
   * 直到下一张图出现才切换。
   *
   * 为什么不按段落渲染图卡片：那样图会随段落卸载，前进到没有图归属的段落时
   * 画面会突然空掉。这里把它提出来固定挂着，文字在下面滚动。
   */
  const 固定插图Id = useMemo(() => {
    if (推进.是否全显 || !renderIllustration) return null;
    const 分配 = 派生段落插图(推进.段落列表, 行插图);
    if (分配.length === 0) return null;
    return 分配[Math.min(Math.max(推进.段序号, 0), 分配.length - 1)] ?? null;
  }, [推进.是否全显, 推进.段落列表, 推进.段序号, 行插图, renderIllustration]);

  if (!content) return null;

  const 画插图 = (i: number) => {
    if (!renderIllustration) return null;
    const 列表 = 行插图.get(i);
    if (!列表 || 列表.length === 0) return null;
    return (
      <>
        {列表.map((id) => {
          // 「当前图」已经固定在上方了，不要在正文里再画一遍。
          if (id === 固定插图Id) return null;
          const 节点 = renderIllustration(id);
          return 节点 ? <div key={`anchor-${id}`} className="my-2">{节点}</div> : null;
        })}
      </>
    );
  };

  return (
    <div ref={推进.容器引用}>
      {/* 固定在上方的当前插图：文字往下滚，它一直挂着，直到下一张图接管。 */}
      {固定插图Id ? (
        <div className="mb-2 flex justify-center">{renderIllustration?.(固定插图Id)}</div>
      ) : null}
      {lines.map((line, i) => {
        // 逐段推进：只渲染当前段的区间，其余整段不渲染（上一段自然消失）。
        if (i < 推进.可见区间.起 || i >= 推进.可见区间.止) return null;
        const 尾部 = 画插图(i);        if (line.kind === 'blank') {
          return <div key={i}>{尾部}<div className="h-1.5" /></div>;
        }
        if (line.kind === 'dialogue') {
          const npc = lookupNpc(line.name, npcMap);
          const protagonist = isProtagonist(line.name, traveler);
          const color = protagonist ? 'rgb(var(--tj-accent-primary))' : nameToColor(line.name);
          const avatarUrl = protagonist
            ? 解析相册资源引用(album, traveler?.图像档案?.正文头像?.trim() || traveler?.头像.trim()) || undefined
            : 解析相册资源引用(album, 读取NPC头像(npc, '正文')) || undefined;
          return (
            <div key={i}>
              <DialogueBubble
                name={line.name}
                text={line.text}
                color={color}
                avatarUrl={avatarUrl}
                isProtagonist={protagonist}
                fontSize={protagonist ? fontSettings.playerFontSize : fontSettings.dialogueFontSize}
                deferOffscreen={deferOffscreen}
              />
              {尾部}
            </div>
          );
        }
        if (line.kind === 'inner') {
          if (!showInnerVoice) return 尾部 ? <div key={i}>{尾部}</div> : null;
          return (
            <div key={i}>
              <InnerVoiceBubble text={line.text} traveler={traveler} album={album} fontSize={fontSettings.dialogueFontSize} deferOffscreen={deferOffscreen} />
              {尾部}
            </div>
          );
        }
        return (
          <div key={i}>
            <NarrationLine text={line.text} fontSize={fontSettings.narrationFontSize} deferOffscreen={deferOffscreen} />
            {尾部}
          </div>
        );
      })}
      {renderIllustration && 未匹配插图.length > 0 ? (
        <div className="space-y-2">
          {未匹配插图.map((项) => {
            const 节点 = renderIllustration(项.id);
            return 节点 ? <div key={`fallback-${项.id}`} className="my-2">{节点}</div> : null;
          })}
        </div>
      ) : null}
      {/*
        逐段推进时给一个可点的「继续」：滚轮/空格/回车是熟悉 galgame 的人的习惯，
        但第一次遇到的人需要看到「还能往下走」，否则会以为正文就这么多。
      */}
      {!推进.是否全显 ? (
        <button
          type="button"
          onClick={推进.前进}
          className="mt-2 w-full px-2 py-1.5 text-[11px] transition-all hover:opacity-80"
          style={{
            color: 'rgba(var(--tj-text-secondary), 0.66)',
            background: 'rgba(var(--tj-accent-primary), 0.04)',
            border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
          }}
        >
          {推进.段序号 >= 推进.段总数 - 1
            ? '已是最后一段（滚轮向上可回退）'
            : `▼ 继续（滚轮 / 空格 / 回车）　·　${推进.段序号 + 1} / ${推进.段总数} 段`}
          <span
            className="ml-2 underline"
            onClick={(事件) => { 事件.stopPropagation(); 推进.全部展开(); }}
          >
            跳到末段
          </span>
        </button>
      ) : null}
    </div>
  );
}

const STREAM_BODY_START_RE = /<\s*(?:正文|body|content|text|内容)\s*>/i;
const STREAM_AFTER_BODY_RE =
  /<\s*(?:\/\s*(?:正文|body|content|text|内容)|短期记忆|memory|summary|recap|记忆|回忆|动态世界|world|worldevent|世界|事件|行动选项|actions|options|choice|choices|选项|变量草稿|variableDraft|变量候选|变量线索|变量摘要|剧情规划|storyPlan|storyPlanning|剧情计划|剧情安排|后续规划|命令|command|commands|cmd)\s*>/i;

function extractStreamingBody(raw: string): { bodyStarted: boolean; bodyText: string } {
  const start = raw.match(STREAM_BODY_START_RE);
  if (!start || start.index === undefined) {
    return { bodyStarted: false, bodyText: '' };
  }
  const after = raw.slice(start.index + start[0].length);
  const close = after.match(STREAM_AFTER_BODY_RE);
  const body =
    close && close.index !== undefined ? after.slice(0, close.index) : after;
  return { bodyStarted: true, bodyText: body.replace(/^\s+|\s+$/g, '') };
}

function PathfindingIndicator() {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 animate-fade-in"
      style={{
        background:
          'linear-gradient(135deg, rgba(var(--tj-accent-primary), 0.08), rgba(var(--tj-accent-primary), 0.02))',
        border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-strong))',
        clipPath:
          cardClip,
      }}
    >
      <span
        className="text-base animate-pulse-soft"
        style={{ color: 'rgba(var(--tj-accent-primary), 0.85)' }}
      >
        ◇
      </span>
      <span
        className="font-serif text-sm tracking-[0.28em]"
        style={{ color: 'rgba(var(--tj-accent-primary), 0.92)' }}
      >
        开拓进行中
      </span>
      <span className="inline-flex items-end gap-[3px]">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="inline-block animate-pulse-soft font-mono leading-none"
            style={{
              color: 'rgba(var(--tj-accent-primary), 0.85)',
              fontSize: '14px',
              animationDelay: `${i * 0.15}s`,
            }}
          >
            ·
          </span>
        ))}
      </span>
    </div>
  );
}

interface StreamingPreviewProps {
  content: string;
  npcRecords?: NPC记录[];
  traveler?: 角色数据结构;
  album?: 相册系统;
  showInnerVoice?: boolean;
  userInput?: string;
}

export function StreamingPreview({ content, npcRecords, traveler, album, showInnerVoice = true, userInput, visualTextSettings }: StreamingPreviewProps & { visualTextSettings?: VisualTextSettings }) {
  const { bodyStarted, bodyText } = useMemo(() => extractStreamingBody(content), [content]);
  const fontSettings = useMemo(() => normalizeVisualTextSettings(visualTextSettings), [visualTextSettings]);

  return (
    <div className="space-y-2">
      <PathfindingIndicator />
      {bodyStarted && bodyText && (
        <div className="px-1 py-1">
          <BodyBlock content={bodyText} npcRecords={npcRecords} traveler={traveler} album={album} showInnerVoice={showInnerVoice} userInput={userInput} visualTextSettings={fontSettings} />
        </div>
      )}
    </div>
  );
}
