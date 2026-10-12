import { useEffect } from 'react';

/**
 * 图片查看器（灯箱）。
 *
 * 为什么需要它：图库缩略图用固定高度 + `object-cover` 铺满网格，必然裁掉两侧，
 * 而生成图常见的是竖版（832×1216）。只有缩略图时用户看不到完整构图，
 * 也没法核对细节——这正是「出图质量」的主观判断所依赖的东西。
 *
 * 这里按原始比例完整显示，并给出生成参数，方便判断该不该重出。
 */
export interface 查看图片项 {
  id: string;
  src: string;
  title: string;
  /** 生成用的正向提示词。 */
  prompt?: string;
  negativePrompt?: string;
  /** 形如 `832x1216`。 */
  dimensions?: string;
  model?: string;
  note?: string;
  createdAt?: number;
}

export function ImageLightbox({
  项,
  onClose,
  onPrev,
  onNext,
}: {
  项: 查看图片项 | null;
  onClose: () => void;
  /** 图库有多张时提供；为 null 表示没有上一张。 */
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
}) {
  useEffect(() => {
    if (!项) return undefined;
    const 处理按键 = (事件: KeyboardEvent) => {
      if (事件.key === 'Escape') onClose();
      if (事件.key === 'ArrowLeft' && onPrev) onPrev();
      if (事件.key === 'ArrowRight' && onNext) onNext();
    };
    globalThis.addEventListener('keydown', 处理按键);
    return () => globalThis.removeEventListener('keydown', 处理按键);
  }, [项, onClose, onPrev, onNext]);

  if (!项) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`查看图片：${项.title}`}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-4"
      style={{ background: 'rgba(0,0,0,0.86)' }}
      onClick={onClose}
    >
      {/* 图片本体：按原始比例完整显示，不裁切。 */}
      <img
        src={项.src}
        alt={项.title}
        className="max-h-[74vh] max-w-[92vw] object-contain"
        style={{ border: '1px solid rgba(var(--tj-text-primary), var(--tj-edge-weak))' }}
        onClick={(事件) => 事件.stopPropagation()}
      />

      <div
        className="w-full max-w-3xl px-3 py-2 text-xs leading-relaxed"
        style={{
          background: 'rgba(var(--tj-ui-panel-strong), 0.92)',
          border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
        }}
        onClick={(事件) => 事件.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-serif font-bold" style={{ color: 'rgb(var(--tj-ui-title))' }}>{项.title}</span>
          {项.dimensions ? <span style={{ color: 'rgba(var(--tj-text-secondary), 0.85)' }}>{项.dimensions}</span> : null}
          {项.model ? <span style={{ color: 'rgba(var(--tj-text-secondary), 0.85)' }}>{项.model}</span> : null}
          {项.note ? <span style={{ color: 'rgba(var(--tj-text-secondary), 0.85)' }}>{项.note}</span> : null}
        </div>

        {项.prompt ? (
          <div className="mt-1.5">
            <span style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>正向：</span>
            <span className="font-mono" style={{ color: 'rgba(var(--tj-text-primary), 0.88)' }}>{项.prompt}</span>
          </div>
        ) : null}
        {项.negativePrompt ? (
          <div className="mt-0.5">
            <span style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>负向：</span>
            <span className="font-mono" style={{ color: 'rgba(var(--tj-text-primary), 0.88)' }}>{项.negativePrompt}</span>
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>
            Esc 关闭{onPrev || onNext ? '　← → 切换' : ''}　点击空白处关闭
          </span>
          {onPrev ? (
            <button
              type="button"
              onClick={onPrev}
              className="px-2 py-1 text-[11px] transition-all hover:opacity-85"
              style={{
                color: 'rgba(var(--tj-text-primary), 0.86)',
                background: 'rgba(var(--tj-ui-panel-strong), 0.6)',
                border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
              }}
            >
              上一张
            </button>
          ) : null}
          {onNext ? (
            <button
              type="button"
              onClick={onNext}
              className="px-2 py-1 text-[11px] transition-all hover:opacity-85"
              style={{
                color: 'rgba(var(--tj-text-primary), 0.86)',
                background: 'rgba(var(--tj-ui-panel-strong), 0.6)',
                border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
              }}
            >
              下一张
            </button>
          ) : null}
          <a
            href={项.src}
            download={`${项.title || 'image'}.png`}
            className="px-2 py-1 text-[11px] transition-all hover:opacity-85"
            style={{
              color: 'rgba(var(--tj-text-primary), 0.86)',
              background: 'rgba(var(--tj-ui-panel-strong), 0.6)',
              border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
            }}
            onClick={(事件) => 事件.stopPropagation()}
          >
            下载
          </a>
        </div>
      </div>
    </div>
  );
}
