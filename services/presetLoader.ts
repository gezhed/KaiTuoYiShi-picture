import type { 剧情编织系统 } from '@/models/storyWeaving';
import type { 智库系统 } from '@/models/zhiku';
import type { ResourceProgress } from '@/data/resourceBundle';
import { devLogError } from '@/utils/devLog';

/** 挂死兜底：载入完全无响应时降级为 failed，否则门禁永远关着。 */
const BOOT_LOAD_TIMEOUT_MS = 120000;

export type Resource<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'failed'; reason: string };

/** 进度条只投影 network：解析/归一化/合并/落盘属 processing，否则「已载入 N/M」会把加工算成网络进度。 */
export type LoadPhase = 'network' | 'processing' | 'ready' | 'failed';

export interface PresetSnapshot {
  phase: LoadPhase;
  story: Resource<剧情编织系统>;
  zhiku: Resource<智库系统>;
  network: { done: number; total: number };
  startedAt: number;
}

export interface PresetTrack<T, R = unknown> {
  total: number;
  fetch: (onProgress: ResourceProgress) => Promise<R[]>;
  process: (raw: R[]) => Promise<T>;
}

export interface PresetLoaderDeps {
  story: PresetTrack<剧情编织系统, string>;
  zhiku: PresetTrack<智库系统, string>;
  timeoutMs?: number;
}

export interface PresetLoader {
  getSnapshot: () => PresetSnapshot;
  subscribe: (listener: (snapshot: PresetSnapshot) => void) => () => void;
  start: () => void;
  retry: () => void;
  dispose: () => void;
}

type TrackKey = 'story' | 'zhiku';

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  // 超时后原 promise 可能仍以拒绝收尾，无人认领会被 Node 误报为未处理拒绝；这里只挂标记不吞错。
  promise.then(undefined, () => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}载入超时（${ms}ms）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export function createPresetLoader(deps: PresetLoaderDeps): PresetLoader {
  const timeoutMs = deps.timeoutMs ?? BOOT_LOAD_TIMEOUT_MS;
  const totals: Record<TrackKey, number> = { story: deps.story.total, zhiku: deps.zhiku.total };
  const fetchDone: Record<TrackKey, number> = { story: 0, zhiku: 0 };
  const fetched: Record<TrackKey, boolean> = { story: false, zhiku: false };
  const listeners = new Set<(snapshot: PresetSnapshot) => void>();

  let resources: Pick<PresetSnapshot, 'story' | 'zhiku'> = {
    story: { status: 'loading' },
    zhiku: { status: 'loading' },
  };
  let startedAt = Date.now();
  let snapshot: PresetSnapshot = assemble();
  let runId = 0;
  let started = false;

  function derivePhase(): LoadPhase {
    if (resources.story.status === 'failed' || resources.zhiku.status === 'failed') return 'failed';
    if (resources.story.status === 'ready' && resources.zhiku.status === 'ready') return 'ready';
    if (fetched.story && fetched.zhiku) return 'processing';
    return 'network';
  }

  function assemble(): PresetSnapshot {
    return {
      phase: derivePhase(),
      story: resources.story,
      zhiku: resources.zhiku,
      network: { done: fetchDone.story + fetchDone.zhiku, total: totals.story + totals.zhiku },
      startedAt,
    };
  }

  function publish(next: Pick<PresetSnapshot, 'story' | 'zhiku'>): void {
    resources = next;
    snapshot = assemble();
    for (const listener of listeners) listener(snapshot);
  }

  const runTrack = async <T>(
    id: number,
    key: TrackKey,
    track: PresetTrack<T, string>,
    setResource: (resource: Resource<T>) => void,
    label: string,
  ): Promise<void> => {
    try {
      const value = await withTimeout(
        (async (): Promise<T | null> => {
          const raw = await track.fetch((nextDone) => {
            if (id !== runId) return;
            fetchDone[key] = nextDone;
            publish({ ...resources });
          });
          if (id !== runId) return null;
          fetched[key] = true;
          publish({ ...resources });
          return await track.process(raw);
        })(),
        timeoutMs,
        label,
      );
      if (id !== runId || value === null) return;
      fetchDone[key] = totals[key];
      setResource({ status: 'ready', value });
    } catch (error) {
      if (id !== runId) return;
      devLogError('save', 'preset-load-failed', error, { track: key });
      setResource({ status: 'failed', reason: describeError(error) });
    }
  };

  const begin = (): void => {
    const id = ++runId;
    fetchDone.story = 0;
    fetchDone.zhiku = 0;
    fetched.story = false;
    fetched.zhiku = false;
    startedAt = Date.now();
    publish({
      story: { status: 'loading' },
      zhiku: { status: 'loading' },
    });
    void Promise.all([
      runTrack(id, 'story', deps.story, (resource) => publish({ ...resources, story: resource }), '原著正文'),
      runTrack(id, 'zhiku', deps.zhiku, (resource) => publish({ ...resources, zhiku: resource }), '智库目录'),
    ]);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start: () => {
      if (started) return;
      started = true;
      begin();
    },
    retry: () => {
      started = true;
      begin();
    },
    dispose: () => {
      listeners.clear();
    },
  };
}
