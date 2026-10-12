import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardClip, smallClip } from '@/components/ui/clipPaths';
import { ResilientImage } from '@/components/ui/ResilientImage';

/**
 * 图库用到的基础展示件。
 *
 * 移植自旧分支 `components/features/GameSystems/album/workspaceComponents.tsx`，
 * 只保留图库实际用到的三个：安全图片、空态框、大图预览。
 * 出图面板那一批（参数摘要、锚点徽标、任务卡片）依赖旧生成管线，不在这里重建。
 */

const 图片位面 = 'linear-gradient(135deg, rgba(var(--tj-surface-strong),0.8), rgba(var(--tj-bg-primary),0.88))';

/** 加载失败时回落到文字占位，而不是留一个破图标。 */
export function SafeAlbumImage({
  src,
  alt,
  className,
  emptyLabel = '待写入',
  failedLabel = '图片失效',
}: {
  src?: string;
  alt: string;
  className: string;
  emptyLabel?: string;
  failedLabel?: string;
}) {
  const [失败来源, set失败来源] = useState<string | null>(null);
  const 失败 = 失败来源 === src;
  if (!src || 失败) {
    return (
      <div
        className={`${className} flex items-center justify-center px-2 text-center font-serif text-xs tracking-[0.12em]`}
        style={{ background: 图片位面, color: 失败 ? 'rgba(var(--tj-danger),0.88)' : 'rgba(var(--tj-ui-faint),0.58)' }}
      >
        {失败 ? failedLabel : emptyLabel}
      </div>
    );
  }
  return <ResilientImage src={src} alt={alt} loading="lazy" onError={() => set失败来源(src)} className={className} />;
}

export function EmptyLibraryBox({ title, desc }: { title: string; desc: string }) {
  return (
    <div
      className="flex min-h-[220px] items-center justify-center border border-dashed px-6 text-center"
      style={{ borderColor: 'rgba(var(--tj-border),0.34)', color: 'rgba(var(--tj-ui-faint),0.72)' }}
    >
      <div>
        <div className="font-serif text-base tracking-[0.18em]" style={{ color: 'rgb(var(--tj-ui-title))' }}>{title}</div>
        <div className="mt-3 text-sm leading-relaxed" style={{ color: 'rgba(var(--tj-ui-muted),0.72)' }}>{desc}</div>
      </div>
    </div>
  );
}

export function Panel({
  title,
  children,
  className = '',
  contentClassName = 'space-y-3',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-3 px-3 py-3 ${className}`}
      style={{
        background: 'radial-gradient(circle at 14% 0%, rgba(var(--tj-tech-cyan), 0.08), transparent 28%), linear-gradient(180deg, rgba(var(--tj-surface),0.74), rgba(var(--tj-bg-primary),0.94))',
        border: '1px solid rgba(var(--tj-border), var(--tj-edge-strong))',
        clipPath: cardClip,
      }}
    >
      <div className="shrink-0 font-serif text-xs tracking-[0.2em]" style={{ color: 'rgba(var(--tj-accent-primary),0.82)' }}>{title}</div>
      <div className={contentClassName}>{children}</div>
    </div>
  );
}

/** 大图预览：按原始比例完整显示，不做网格那样的裁切。 */
export function ImagePreviewModal({
  open,
  src,
  title,
  onClose,
}: {
  open: boolean;
  src: string;
  title: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const 原溢出 = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const 处理按键 = (事件: KeyboardEvent) => {
      if (事件.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', 处理按键);
    return () => {
      document.body.style.overflow = 原溢出;
      window.removeEventListener('keydown', 处理按键);
    };
  }, [open, onClose]);

  if (!open || !src) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center px-4 py-5"
      style={{ background: 'rgba(0,0,0,0.86)' }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="fixed right-5 top-5 z-[10001] min-h-11 px-4 py-2 font-serif text-xs tracking-[0.16em]"
        style={{
          color: 'rgb(var(--tj-on-accent))',
          background: 'linear-gradient(135deg, rgb(var(--tj-accent-primary)), rgb(var(--tj-tech-cyan)))',
          border: '1px solid rgba(var(--tj-text-primary), var(--tj-edge-weak))',
          clipPath: smallClip,
        }}
      >
        关闭
      </button>
      <div
        className="relative flex h-[92vh] w-full max-w-6xl items-center justify-center overflow-hidden px-4 py-12"
        style={{
          background: 'linear-gradient(180deg, rgb(var(--tj-bg-primary)), rgb(var(--tj-bg-secondary)))',
          border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-strong))',
          clipPath: cardClip,
        }}
        onClick={(事件) => 事件.stopPropagation()}
      >
        <div className="absolute left-5 top-4 max-w-[70%] truncate font-serif text-xs tracking-[0.14em]" style={{ color: 'rgba(var(--tj-accent-primary),0.82)' }}>
          {title}
        </div>
        <div className="flex h-full w-full items-center justify-center overflow-auto px-2 py-2">
          <SafeAlbumImage src={src} alt={title} className="max-h-full max-w-full object-contain" failedLabel="图片加载失败" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
