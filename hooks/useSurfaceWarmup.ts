import { useEffect, useRef, useState } from 'react';
import { HOME_SURFACE_COUNT, SURFACE_WARMUP } from '@/components/lazy/surfaces';
import type { ViewState } from '@/hooks/useGameState';

const WARMUP_GAP_MS = 120;

interface UseSurfaceWarmupOptions {
  bootSettled: boolean;
  view: ViewState;
  busy: boolean;
}

export function useSurfaceWarmup({ bootSettled, view, busy }: UseSurfaceWarmupOptions): void {
  const warmedRef = useRef<Set<string>>(new Set());
  const [visible, setVisible] = useState(() => !document.hidden);

  useEffect(() => {
    const handleVisibilityChange = (): void => { setVisible(!document.hidden); };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => { document.removeEventListener('visibilitychange', handleVisibilityChange); };
  }, []);

  const limit = !bootSettled
    ? 0
    : view === 'game' && !busy
      ? SURFACE_WARMUP.length
      : HOME_SURFACE_COUNT;

  useEffect(() => {
    if (limit === 0) return;

    // 用持有对象而不是裸 let：TS 会把闭包里的裸 let 收窄成常假，lint 会判成恒假分支。
    const run = { cancelled: false };

    void (async () => {
      for (const surface of SURFACE_WARMUP.slice(0, limit)) {
        if (run.cancelled || !visible) return;
        if (warmedRef.current.has(surface.id)) continue;
        await surface.load();
        warmedRef.current.add(surface.id);
        await new Promise((resolve) => { window.setTimeout(resolve, WARMUP_GAP_MS); });
      }
    })();

    return () => { run.cancelled = true; };
  }, [limit, visible]);
}
