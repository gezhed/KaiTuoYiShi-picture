import { useEffect, useState } from 'react';
import type { PresetSnapshot } from '@/services/presetLoader';

const TICK_MS = 1000;
const NETWORK_APPEAR_MS = 300;
const FINISH_MS = 100;
const HOLD_MS = 300;
const FADE_MS = 300;

type DisplayState = 'idle' | 'showing' | 'finishing' | 'holding' | 'fading' | 'gone';

const EXIT_STEP: Partial<Record<DisplayState, { to: DisplayState; ms: number }>> = {
  showing: { to: 'finishing', ms: 0 },
  finishing: { to: 'holding', ms: FINISH_MS },
  holding: { to: 'fading', ms: HOLD_MS },
  fading: { to: 'gone', ms: FADE_MS },
};

export interface PresetLoadView {
  visible: boolean;
  fading: boolean;
  tone: 'pending' | 'finishing' | 'failed';
  title: string;
  counter: string;
  done: number;
  total: number;
  percent: number;
  showRetry: boolean;
  detail: string | null;
}

function describeFailure(load: PresetSnapshot): string {
  const problems: string[] = [];
  if (load.story.status === 'failed') problems.push(`原著正文：${load.story.reason}`);
  if (load.zhiku.status === 'failed') problems.push(`智库目录：${load.zhiku.reason}`);
  return problems.join('；');
}

export function usePresetLoadView(load: PresetSnapshot): PresetLoadView {
  const [now, setNow] = useState(() => Date.now());
  // 显示状态与运行号绑定：retry 换了 startedAt 时自动回到 idle，无需在 effect 里重置。
  // 初值用哨兵 -1：首次渲染发生在 start() 之前，绑定当时的 startedAt 会与 start() 后的值错配。
  const [progress, setProgress] = useState<{ run: number; state: DisplayState }>(
    () => ({ run: -1, state: 'idle' }),
  );
  const displayState: DisplayState = progress.run === load.startedAt ? progress.state : 'idle';

  const failed = load.story.status === 'failed' || load.zhiku.status === 'failed';
  const networkActive = load.phase === 'network';

  useEffect(() => {
    if (!networkActive || displayState !== 'idle') return;
    const run = load.startedAt;
    const timer = window.setTimeout(() => {
      setProgress((current) => (current.state === 'idle' ? { run, state: 'showing' } : current));
    }, NETWORK_APPEAR_MS);
    return () => { window.clearTimeout(timer); };
  }, [networkActive, displayState, load.startedAt]);

  useEffect(() => {
    if (networkActive) return;
    const run = load.startedAt;
    const step = EXIT_STEP[displayState];
    if (!step) return;
    const { to, ms } = step;
    const timer = window.setTimeout(() => {
      setProgress((current) => (current.run === run && current.state === displayState ? { run, state: to } : current));
    }, ms);
    return () => { window.clearTimeout(timer); };
  }, [networkActive, displayState, load.startedAt]);

  useEffect(() => {
    if (!networkActive || displayState !== 'showing') return;
    const timer = window.setInterval(() => { setNow(Date.now()); }, TICK_MS);
    return () => { window.clearInterval(timer); };
  }, [networkActive, displayState]);

  const { done, total } = load.network;
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const elapsedSeconds = Math.max(0, Math.round((now - load.startedAt) / 1000));

  const tone: PresetLoadView['tone'] = failed
    ? 'failed'
    : displayState === 'finishing' || displayState === 'holding'
      ? 'finishing'
      : 'pending';
  const visible = failed || (displayState !== 'idle' && displayState !== 'gone');
  const title = failed
    ? '原著资料未能载入'
    : tone === 'finishing'
      ? '原著资料已接收'
      : '正在接收原著资料';

  return {
    visible,
    fading: !failed && displayState === 'fading',
    tone,
    title,
    counter: `${done} / ${total} · ${tone === 'finishing' ? '总用时' : '已用'} ${elapsedSeconds}s`,
    done,
    total,
    percent,
    showRetry: failed,
    detail: failed ? describeFailure(load) : null,
  };
}
