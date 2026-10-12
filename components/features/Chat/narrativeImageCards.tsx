import { useEffect, useState } from 'react';
import type { 叙事插图 } from '@/models/chat';
import type { 相册系统 } from '@/models/imageGeneration';
import { 解析相册资源引用 } from '@/utils/albumActions';
import { 取出提示词正文 } from '@/services/ai/imageGen/illustrationProtocol';
import { smallClip, tinyClip } from './turnStyles';
import type { 插图重生选项 } from './illustrationActions';

const 常用尺寸 = ['960x1280', '1024x1024', '1280x720', '1216x832', '832x1216'];

function 解析尺寸文本(文本: string): { 宽度: number; 高度: number } | null {
  const 匹配 = 文本.trim().match(/^(\d{2,4})\s*[xX*]\s*(\d{2,4})$/);
  if (!匹配) return null;
  return { 宽度: Number(匹配[1]), 高度: Number(匹配[2]) };
}

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

  const 小按钮 = (label: string, onClick: () => void, 禁用 = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={禁用}
      className="px-2 py-1 font-serif text-[11px] tracking-[0.12em] transition-all hover:opacity-85 disabled:opacity-45"
      style={{
        color: 'rgba(var(--tj-btn-primary-start),0.95)',
        background: 'rgba(var(--tj-btn-primary-start),0.06)',
        border: '1px solid rgba(var(--tj-btn-primary-start), var(--tj-edge-tint))',
        clipPath: tinyClip,
      }}
    >
      {label}
    </button>
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
        {canRegenerate && 小按钮('重新生成', () => onRegenerate?.(undefined))}
        {canRegenerate && 小按钮('改提示词', 打开编辑)}
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
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((值) => !值)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs transition-all hover:opacity-80"
          style={{ color: 'rgba(var(--tj-text-primary), 0.85)' }}
        >
          <span>{icon}</span>
          {/* 不再显示 `description`：那里存的是**正文锚点**（插入位置），
              对用户是噪声 —— 他只想看图和操作按钮。 */}
          <span className="truncate font-medium">{typeLabel}</span>
          <span style={{ color: 'rgba(var(--tj-text-secondary), 0.5)' }}>{expanded ? '▲' : '▼'}</span>
        </button>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {canRegenerate && 小按钮('重新生成', () => onRegenerate?.(undefined))}
          {canRegenerate && 小按钮('改提示词', 打开编辑)}
          {onRerollPrompts && !regenerating && 小按钮('换提示词', onRerollPrompts)}
        </div>
      </div>

      {expanded && (
        <div className="space-y-2 px-3 pb-3">
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={image.description || typeLabel}
              className="max-w-full rounded"
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
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.72)' }}>尺寸</span>
                <input
                  className="kaituo-input w-28 px-2 py-1 text-xs font-mono"
                  value={sizeText}
                  placeholder="1024x1024"
                  onChange={(事件) => setSizeText(事件.target.value)}
                />
                {常用尺寸.map((尺寸) => (
                  <button
                    key={尺寸}
                    type="button"
                    onClick={() => setSizeText(尺寸)}
                    className="px-2 py-0.5 text-[11px] font-mono transition-all hover:opacity-80"
                    style={{
                      color: sizeText === 尺寸 ? 'rgb(var(--tj-on-accent))' : 'rgba(var(--tj-text-primary), 0.8)',
                      background: sizeText === 尺寸 ? 'rgb(var(--tj-accent-primary))' : 'rgba(var(--tj-ui-panel-strong), 0.5)',
                      border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
                    }}
                  >
                    {尺寸}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {小按钮('重新生成本张', 提交编辑, regenerating)}
                {小按钮('取消', () => setEditing(false))}
                {sizeText ? 小按钮('清除尺寸', () => setSizeText('')) : null}
              </div>
              {sizeText && !解析尺寸文本(sizeText) ? (
                <div className="text-[11px]" style={{ color: 'rgb(var(--tj-danger))' }}>
                  尺寸格式应为 宽x高（如 1024x1024），否则会被忽略。
                </div>
              ) : null}
            </div>
          ) : (
            /* 提示词文本只在「改提示词」时出现（那时它是输入框内容）。
               平时不铺在卡片上，避免正文被大段 tag 占满。 */
            <div className="flex flex-wrap gap-2">
              {canRegenerate && 小按钮('改提示词并重生', 打开编辑)}
              {canRegenerate && 小按钮('原样重生', () => onRegenerate?.(undefined))}
            </div>
          )}
        </div>
      )}
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

