import { useSyncExternalStore } from 'react';
import type { PresetLoader } from '@/services/presetLoader';
import { usePresetLoadView } from '@/hooks/usePresetLoadView';
import { cardClip } from '@/components/ui/clipPaths';

interface PresetLoadBarProps {
  loader: PresetLoader;
  onRetry: () => void;
}

export function PresetLoadBar({ loader, onRetry }: PresetLoadBarProps) {
  const load = useSyncExternalStore(loader.subscribe, loader.getSnapshot);
  const view = usePresetLoadView(load);

  if (!view.visible) return null;

  const failed = view.tone === 'failed';

  return (
    <div
      className={`${view.fading ? 'animate-preset-fade-out' : 'animate-slide-up'} fixed bottom-20 left-1/2 z-30 w-[min(92vw,26rem)] -translate-x-1/2 px-1`}
      role={failed ? 'alert' : undefined}
    >
      <div
        className="px-3.5 py-3"
        style={{
          background: 'linear-gradient(180deg, rgba(var(--tj-bg-secondary),0.94), rgba(var(--tj-bg-primary),0.96))',
          // 本元素带 clipPath（切角），外阴影会被整条裁掉；要投影需套一层不裁切的父元素。
          clipPath: cardClip,
        }}
      >
        <div
          className="mb-2 flex items-center justify-between gap-3 text-[12px]"
          style={{ color: 'rgba(var(--tj-text-secondary),0.86)' }}
        >
          <span className="min-w-0 truncate">{view.title}</span>
          <span className="shrink-0 font-mono">{view.counter}</span>
        </div>

        <div
          className="h-1.5 overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={view.total}
          aria-valuenow={view.done}
          aria-label="原著资料载入进度"
          style={{
            background: 'rgba(var(--tj-bg-secondary),0.85)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary),0.22)',
          }}
        >
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${view.percent}%`,
              background: failed
                ? 'linear-gradient(90deg, rgba(var(--tj-danger),0.9), rgba(var(--tj-danger),0.7))'
                : 'linear-gradient(90deg, rgba(var(--tj-tech-cyan),0.9), rgba(var(--tj-accent-primary),0.95))',
            }}
          />
        </div>

        {view.detail && (
          <div className="mt-2 flex items-center justify-between gap-3">
            <span
              className="text-[11px] leading-relaxed"
              style={{ color: failed ? 'rgba(var(--tj-danger),0.92)' : 'rgba(var(--tj-text-secondary),0.72)' }}
            >
              {view.detail}
            </span>
            {view.showRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="shrink-0 px-3 py-1 font-serif text-[12px] tracking-[0.18em] transition-opacity hover:opacity-85"
                style={{
                  color: 'rgb(var(--tj-on-accent))',
                  background: 'linear-gradient(135deg, rgb(var(--tj-accent-primary)) 0%, rgb(var(--tj-tech-cyan)) 100%)',
                }}
              >
                重试
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
