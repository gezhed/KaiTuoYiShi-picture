
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useGameState } from '@/hooks/useGameState';
import { bundledStoryWeavingPresets } from '@/data/storyWeavingPreset';
import { bundledZhikuPresets } from '@/data/zhikuPreset';

// 刻意不 mock 任何 loader：mock 掉它们会让真实两路不被调用，进度也就无从上报，测试会假过。

describe('预置载入 fail-fail：失败保持失败，门禁不放行', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('网络全断时两路都落到 failed，进度仍走到总数，且不进入 ready', async () => {
    const { result, unmount } = renderHook(() => useGameState());

    await waitFor(
      () => { expect(result.current.presetLoad.story.status).toBe('failed'); },
      { timeout: 20000 },
    );
    await waitFor(
      () => { expect(result.current.presetLoad.zhiku.status).toBe('failed'); },
      { timeout: 20000 },
    );

    const expectedTotal = bundledStoryWeavingPresets.length + bundledZhikuPresets.length;
    expect(result.current.presetLoad.network.total).toBe(expectedTotal);
    expect(result.current.presetLoad.network.done).toBe(expectedTotal);
    expect(result.current.presetLoad.phase).toBe('failed');

    expect(result.current.presetLoad.story.status).not.toBe('ready');
    expect(result.current.presetLoad.zhiku.status).not.toBe('ready');

    unmount();
  });
});
