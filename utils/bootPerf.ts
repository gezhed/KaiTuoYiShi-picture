import { devLog } from '@/utils/devLog';

interface StageRecord { name: string; ms: number }
interface LongTaskRecord { name: string; ms: number; at: number }
interface CommitRecord { phase: string; ms: number }

const stages: StageRecord[] = [];
const longTasks: LongTaskRecord[] = [];
const commits: CommitRecord[] = [];
const accumulated = new Map<string, number>();
let startedAt = 0;
let summarized = false;

export function bootPerfStart(): void {
  startedAt = performance.now();
  performance.mark('bootPerf:start');
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({
          name: entry.name || 'longtask',
          ms: Math.round(entry.duration),
          at: Math.round(entry.startTime),
        });
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
  }
}

export function bootPerfStage(name: string, ms: number): void {
  const rounded = Math.round(ms);
  stages.push({ name, ms: rounded });
  performance.mark(`bootPerf:${name}`);
  devLog('ui', 'boot-perf-stage', { name, ms: rounded });
}

export function bootPerfCommit(phase: string, ms: number): void {
  commits.push({ phase, ms });
}

export function bootPerfAccumulate(name: string, ms: number): void {
  accumulated.set(name, (accumulated.get(name) ?? 0) + ms);
}

export function bootPerfSummary(extra: Record<string, unknown>): void {
  if (summarized) return;
  summarized = true;

  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const presetResources = resources.filter((r) => /story-weaving-canon|zhiku-presets/u.test(r.name));
  const net = {
    allResources: resources.length,
    jsonFiles: resources.filter((r) => r.name.includes('.json')).length,
    files: presetResources.length,
    totalDurationMs: Math.round(presetResources.reduce((sum, r) => sum + r.duration, 0)),
    transferBytes: presetResources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
    encodedBytes: presetResources.reduce((sum, r) => sum + (r.encodedBodySize || 0), 0),
    decodedBytes: presetResources.reduce((sum, r) => sum + (r.decodedBodySize || 0), 0),
    ...(presetResources.length === 0 ? { sample: resources.slice(0, 8).map((r) => r.name) } : {}),
  };

  const summary = {
    ...extra,
    wallToReadyMs: Math.round(performance.now() - startedAt),
    stages,
    accumulated: Object.fromEntries([...accumulated].map(([key, ms]) => [key, Math.round(ms)])),
    net,
    longTasks,
    commits: {
      count: commits.length,
      totalMs: Math.round(commits.reduce((sum, c) => sum + c.ms, 0)),
      maxMs: Math.round(commits.reduce((max, c) => Math.max(max, c.ms), 0)),
    },
  };

  performance.mark('bootPerf:ready');
  devLog('ui', 'boot-perf-summary', summary);
  try {
    console.info(`[boot-perf] SUMMARY ${JSON.stringify(summary)}`);
  } catch {
  }
}
