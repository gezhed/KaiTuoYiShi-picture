
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bundledStoryWeavingPresets, loadAllBundledStoryWeavingPresets } from '@/data/storyWeavingPreset';
import { bundledZhikuPresets, loadAllBundledZhikuPresets } from '@/data/zhikuPreset';

type ProgressCall = [number, number];

const increasingByOneTo = (calls: ProgressCall[], total: number): void => {
  expect(calls.map(([done]) => done)).toEqual(
    Array.from({ length: total }, (_, index) => index + 1),
  );
  expect(calls.every(([, reported]) => reported === total)).toBe(true);
};

describe('预置载入进度：失败也必须走到总数', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('原著正文：27 个文件全部计入进度，然后才抛完整性错误', async () => {
    const calls: ProgressCall[] = [];
    await expect(
      loadAllBundledStoryWeavingPresets((done, total) => { calls.push([done, total]); }),
    ).rejects.toThrow();

    expect(calls).toHaveLength(bundledStoryWeavingPresets.length);
    increasingByOneTo(calls, bundledStoryWeavingPresets.length);
  });

  it('智库目录：23 个文件全部计入进度，失败也计数', async () => {
    const calls: ProgressCall[] = [];
    await expect(
      loadAllBundledZhikuPresets({ onProgress: (done, total) => { calls.push([done, total]); } }),
    ).rejects.toThrow();

    expect(calls).toHaveLength(bundledZhikuPresets.length);
    increasingByOneTo(calls, bundledZhikuPresets.length);
  });
});
