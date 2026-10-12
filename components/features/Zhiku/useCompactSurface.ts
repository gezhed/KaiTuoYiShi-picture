import { useEffect, useState } from 'react';

export const COMPACT_SURFACE_QUERY = '(max-width: 768px), (max-width: 940px) and (max-height: 500px)';

function matchesNow(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

export function useCompactSurface(): boolean {
  const [compact, setCompact] = useState(() => matchesNow(COMPACT_SURFACE_QUERY));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(COMPACT_SURFACE_QUERY);
    const sync = () => setCompact(list.matches);
    /* 挂载后再对一次：首帧与 effect 之间窗口可能已经被拉窄。 */
    sync();
    list.addEventListener('change', sync);
    return () => list.removeEventListener('change', sync);
  }, []);

  return compact;
}
