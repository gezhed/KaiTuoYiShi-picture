export interface RafCoalescedSetter {
  set: (value: string) => void;
  flush: (value: string) => void;
  cancel: () => void;
}

export function createRafCoalescedSetter(
  commit: (value: string) => void,
): RafCoalescedSetter {
  let pending: string | null = null;
  let rafId: number | null = null;

  const cancel = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    pending = null;
  };

  const flush = (value: string) => {
    cancel();
    commit(value);
  };

  const set = (value: string) => {
    pending = value;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const next = pending;
      pending = null;
      if (next !== null) commit(next);
    });
  };

  return { set, flush, cancel };
}
