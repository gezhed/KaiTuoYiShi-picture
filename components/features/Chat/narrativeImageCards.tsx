import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Eraser, Eye, PenLine, RefreshCw, Wand2, X } from 'lucide-react';
import type { 叙事插图 } from '@/models/chat';
import type { 相册系统 } from '@/models/imageGeneration';
import { 解析相册资源引用 } from '@/utils/albumActions';
import { 取出提示词正文 } from '@/services/ai/imageGen/illustrationProtocol';
import { IconButton } from '@/components/ui/IconButton';
import { ImageLightbox } from '@/components/features/ImageGeneration/ImageLightbox';
import { smallClip } from './turnStyles';
import type { 插图重生选项 } from './illustrationActions';

const 常用尺寸 = ['960x1280', '1024x1024', '1280x720', '1216x832', '832x1216'];

function 解析尺寸文本(文本: string): { 宽度: number; 高度: number } | null {
  const 匹配 = 文本.trim().match(/^(\d{2,4})\s*[xX*]\s*(\d{2,4})$/);
  if (!匹配) return null;
  return { 宽度: Number(匹配[1]), 高度: Number(匹配[2]) };
}

/** 从提示词标记里取 `WxH`，给灯箱显示尺寸用。 */
function 取尺寸文本(提示词: string): string {
  const 匹配 = 提示词.match(/(\d{2,4})x(\d{2,4})/);
  return 匹配 ? `${匹配[1]}x${匹配[2]}` : '';
}

/**
 * 正文里的插图卡片。
 *
 * 操作全部收成图标 + 悬停说明：
 *   查看大图 / 重新生成 / 修改提示词 / 换提示词。
 * 之前同一件事在标题行和展开区各写了一遍文字按钮（「重新生成」与「原样重生」、
 * 「改提示词」与「改提示词并重生」），既占正文空间又要读两遍才知道是同一个动作。
 */
export function NarrativeImageCard({
  image,
  album,
  regenerating = false,
  onRegenerate,
  onRerollPrompts,
  defaultExpanded = false,
}: {
  image: 叙事插图;
  album?: 相册系统;
  regenerating?: boolean;
  onRegenerate?: (选项?: 插图重生选项) => void;
  /** 只重跑本回合的提示词，保留已出好的图。 */
  onRerollPrompts?: () => void;
  /** 默认是否直接展开显示图片（设置项，默认折叠）。 */
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sizeText, setSizeText] = useState('');
  const [查看大图, set查看大图] = useState(false);

  // 用户在设置里改了「默认展开」时，已挂载的卡片也要跟着变，
  // 否则要刷新页面才生效（设置面板是覆盖层，卡片通常不会重新挂载）。
  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const imageSrc = 解析相册资源引用(album, image.dataUrl);
  const typeLabel = image.kind === 'snapshot' || image.type === 'scene' ? '正文插图' : '角色插图';
  const icon = image.kind === 'snapshot' || image.type === 'scene' ? '▧' : '👤';
  const canRegenerate = !!onRegenerate && !regenerating;

  const 打开编辑 = () => {
    setDraft(取出提示词正文(image.prompt));
    const 匹配 = image.prompt.match(/(\d{2,4})x(\d{2,4})/);
    setSizeText(匹配 ? `${匹配[1]}x${匹配[2]}` : '');
    setEditing(true);
    setExpanded(true);
  };

  const 提交编辑 = () => {
    const 覆盖尺寸 = 解析尺寸文本(sizeText);
    onRegenerate?.({ 新提示词正文: draft, 覆盖尺寸 });
    setEditing(false);
  };

  /** 标题行右侧那一排图标：能做的动作都在这里，展开与否都能用。 */
  const 操作图标 = () => (
    <div className="flex shrink-0 items-center gap-1">
      {imageSrc ? (
        <IconButton
          size="sm"
          icon={Eye}
          label="查看大图"
          description="按原始比例完整查看，可下载"
          onClick={() => set查看大图(true)}
        />
      ) : null}
      {canRegenerate ? (
        <IconButton
          size="sm"
          icon={RefreshCw}
          label="重新生成"
          description="按当前提示词再出一张"
          onClick={() => onRegenerate?.(undefined)}
        />
      ) : null}
      {canRegenerate ? (
        <IconButton
          size="sm"
          icon={PenLine}
          label="修改提示词"
          description="改完只重出这一张"
          active={editing}
          pressed={editing}
          onClick={打开编辑}
        />
      ) : null}
      {onRerollPrompts && !regenerating ? (
        <IconButton
          size="sm"
          icon={Wand2}
          label="换提示词"
          description="只让 LLM 重写提示词，保留已出的图"
          onClick={onRerollPrompts}
        />
      ) : null}
    </div>
  );

  if (image.status === 'generating') {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 text-xs"
        style={{
          background: 'rgba(var(--tj-btn-primary-start), 0.06)',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.2)',
          color: 'rgba(var(--tj-text-secondary), 0.8)',
        }}
      >
        <span className="animate-pulse-soft">⏳</span>
        <span className="flex-1">正在生成{typeLabel}...</span>
      </div>
    );
  }

  if (image.status === 'failed') {
    return (
      <div
        className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
        style={{
          background: 'rgba(var(--tj-danger),0.06)',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-danger),0.2)',
          color: 'rgba(var(--tj-text-secondary), 0.8)',
        }}
      >
        <span>❌</span>
        <span className="min-w-0 flex-1 break-words">{typeLabel}生成失败{image.error ? `：${image.error}` : ''}</span>
        {操作图标()}
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'rgba(var(--tj-btn-primary-start), 0.04)',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.2)',
      }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((值) => !值)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs transition-all hover:opacity-80"
          style={{ color: 'rgba(var(--tj-text-primary), 0.85)' }}
        >
          <span>{icon}</span>
          {/* 不显示 `description`：那里存的是**正文锚点**（插入位置），对用户是噪声。 */}
          <span className="truncate font-medium">{typeLabel}</span>
          {expanded
            ? <ChevronUp size={14} strokeWidth={2} aria-hidden="true" style={{ color: 'rgba(var(--tj-text-secondary), 0.6)' }} />
            : <ChevronDown size={14} strokeWidth={2} aria-hidden="true" style={{ color: 'rgba(var(--tj-text-secondary), 0.6)' }} />}
        </button>
        {操作图标()}
      </div>

      {expanded && (
        <div className="space-y-2 px-2 pb-2">
          {imageSrc ? (
            /* 居中：卡片本身铺满正文宽度，而图片是 `max-w-full` 的定宽元素，
               不加 `mx-auto` 就一律贴左（galgame 模式尤其明显）。点开看大图。 */
            <img
              src={imageSrc}
              alt={image.description || typeLabel}
              onClick={() => set查看大图(true)}
              className="mx-auto block max-w-full cursor-zoom-in rounded"
              style={{ maxHeight: '512px', objectFit: 'contain' }}
            />
          ) : (
            <div className="text-xs" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>
              这张图没有可显示的地址，可能缓存已被清空。
            </div>
          )}

          {editing ? (
            <div className="space-y-2">
              <div className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.72)' }}>
                编辑提示词后重新生成本张。提示词会再走一遍替换规则、角色替换与正负词组装。
              </div>
              <textarea
                className="kaituo-input h-24 w-full px-2 py-1.5 text-xs leading-relaxed"
                value={draft}
                spellCheck={false}
                onChange={(事件) => setDraft(事件.target.value)}
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.72)' }}>尺寸</span>
                <input
                  className="kaituo-input w-24 px-2 py-0.5 text-[11px] font-mono"
                  value={sizeText}
                  placeholder="1024x1024"
                  onChange={(事件) => setSizeText(事件.target.value)}
                />
                {常用尺寸.map((尺寸) => (
                  <button
                    key={尺寸}
                    type="button"
                    onClick={() => setSizeText(尺寸)}
                    className="px-1.5 py-0.5 text-[11px] font-mono transition-all hover:opacity-80"
                    style={{
                      color: sizeText === 尺寸 ? 'rgb(var(--tj-on-accent))' : 'rgba(var(--tj-text-primary), 0.8)',
                      background: sizeText === 尺寸 ? 'rgb(var(--tj-accent-primary))' : 'rgba(var(--tj-ui-panel-strong), 0.5)',
                      border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
                      clipPath: smallClip,
                    }}
                  >
                    {尺寸}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <IconButton
                  size="sm"
                  icon={Check}
                  label="重新生成本张"
                  description="用编辑后的提示词重出这一张"
                  disabled={regenerating}
                  disabledReason="正在生成中"
                  onClick={提交编辑}
                />
                <IconButton size="sm" icon={X} label="取消修改" description="不改了" onClick={() => setEditing(false)} />
                {sizeText ? (
                  <IconButton
                    size="sm"
                    icon={Eraser}
                    label="清除尺寸"
                    description="回到跟随渠道的默认尺寸"
                    onClick={() => setSizeText('')}
                  />
                ) : null}
              </div>
              {sizeText && !解析尺寸文本(sizeText) ? (
                <div className="text-[11px]" style={{ color: 'rgb(var(--tj-danger))' }}>
                  尺寸格式应为 宽x高（如 1024x1024），否则会被忽略。
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <ImageLightbox
        项={查看大图 && imageSrc
          ? {
            id: image.id,
            src: imageSrc,
            title: image.description || typeLabel,
            prompt: 取出提示词正文(image.prompt),
            negativePrompt: image.negativePrompt,
            dimensions: 取尺寸文本(image.prompt),
            note: '正文插图',
          }
          : null}
        onClose={() => set查看大图(false)}
      />
    </div>
  );
}

/**
 * 手动出图入口：**就是一个按钮**，没有折叠、没有说明文字。
 *
 * 之前是个可折叠面板，展开后一屏文字加两个听着像但行为不同的按钮，
 * 用户按了「重新生成本回合提示词」发现没反应（那一版确实走错了分支）。
 * 现在只保留一个动作按钮，行为直接写在按钮上，不再需要解释。
 */
export function NarrativeImageManualCard({
  regenerating = false,
  onRegenerate,
  失败原因,
  阶段,
}: {
  regenerating?: boolean;
  onRegenerate?: () => void;
  /** 上一次尝试的失败原因；失败时必须说出来，否则用户只会看到「点了没反应」。 */
  失败原因?: string;
  /** 当前阶段：等 LLM 写提示词，还是正在逐张出图。 */
  阶段?: '等提示词' | '出图中';
}) {
  const canGenerate = !!onRegenerate && !regenerating;
  const 文案 = regenerating
    ? (阶段 === '出图中' ? '正在逐张生成图片…' : '正在等待 LLM 写提示词…')
    : '生成本回合插图';

  return (
    <div>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={!canGenerate}
        className="w-full px-3 py-2 text-center transition-all hover:opacity-90 disabled:opacity-45"
        style={{
          color: 'rgb(var(--tj-on-accent))',
          background: 'linear-gradient(135deg, rgb(var(--tj-accent-primary)) 0%, rgba(var(--tj-accent-mid),0.96) 48%, rgb(var(--tj-accent-secondary)) 100%)',
          border: '1px solid rgba(var(--tj-text-primary), var(--tj-edge-weak))',
          clipPath: smallClip,
        }}
      >
        <span className="font-serif text-xs tracking-[0.18em]">{文案}</span>
      </button>
      {失败原因 && !regenerating ? (
        <div
          className="mt-1 px-2 py-1.5 text-[11px] leading-relaxed"
          style={{
            color: 'rgb(var(--tj-danger))',
            background: 'rgba(var(--tj-danger), 0.08)',
            border: '1px solid rgba(var(--tj-danger), 0.35)',
          }}
        >
          上次生成失败：{失败原因}
        </div>
      ) : null}
    </div>
  );
}
