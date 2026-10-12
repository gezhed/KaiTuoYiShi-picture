/**
 * 自动生图的准入判断。
 *
 * 用户报的「自动生图模式没有正常的去请求生图」：`runNarrativeImageJob` 开头有一个
 * 三条件门禁，任何一个不满足就 `return`，**既不发请求、也不报任何东西**，
 * 所以界面上完全看不出被谁拦下了。
 *
 * 这里锁死两件事：
 *   ① 判定本身要对（尤其是「总开关开了、正文配图关了」这种半开状态）；
 *   ② 判定要给出**原因**，调用方才能报到队列里，而不是静默。
 */
import { describe, expect, it } from 'vitest';
import { 判定正文配图门禁 } from '@/hooks/useGame/stage11_backgroundJobs';
import { 创建默认文生图系统设置 } from '@/models/genSystem';
import type { 文生图系统设置 } from '@/models/genSystem';

/** 造一份「一切正常、可以自动生图」的设置，再按需打补丁。 */
function 造设置(补丁: Partial<文生图系统设置> = {}, 配图补丁: Partial<文生图系统设置['正文配图']> = {}): 文生图系统设置 {
  const 基础 = 创建默认文生图系统设置();
  return {
    ...基础,
    启用: true,
    ...补丁,
    正文配图: { ...基础.正文配图, 启用: true, 模式: 'auto', ...配图补丁 },
  };
}

describe('判定正文配图门禁', () => {
  it('三项都满足时放行', () => {
    const 结果 = 判定正文配图门禁(造设置());
    expect(结果.放行).toBe(true);
    expect(结果.原因).toBeUndefined();
  });

  it('总开关关掉时拦下，并说明是总开关', () => {
    const 结果 = 判定正文配图门禁(造设置({ 启用: false }));
    expect(结果.放行).toBe(false);
    expect(结果.原因).toContain('总开关');
  });

  it('正文配图开关关掉时拦下（总开关开着也要拦）', () => {
    const 结果 = 判定正文配图门禁(造设置({}, { 启用: false }));
    expect(结果.放行).toBe(false);
    expect(结果.原因).toContain('正文自动配图');
  });

  it('模式是 manual 时拦下，并点明是手动模式', () => {
    const 结果 = 判定正文配图门禁(造设置({}, { 模式: 'manual' }));
    expect(结果.放行).toBe(false);
    expect(结果.原因).toContain('手动模式');
  });

  it('完全没设置时拦下，而不是崩', () => {
    const 结果 = 判定正文配图门禁(undefined);
    expect(结果.放行).toBe(false);
    expect(结果.原因).toBeTruthy();
  });

  it('缺少正文配图字段时拦下，而不是崩', () => {
    const 设置 = 造设置();
    const 残缺 = { ...设置, 正文配图: undefined } as unknown as 文生图系统设置;
    const 结果 = 判定正文配图门禁(残缺);
    expect(结果.放行).toBe(false);
    expect(结果.原因).toBeTruthy();
  });

  it('拦下时**必须**带原因（否则又会变成静默失败）', () => {
    const 各种拦下: Array<文生图系统设置 | undefined> = [
      undefined,
      造设置({ 启用: false }),
      造设置({}, { 启用: false }),
      造设置({}, { 模式: 'manual' }),
    ];
    for (const 设置 of 各种拦下) {
      const 结果 = 判定正文配图门禁(设置);
      expect(结果.放行).toBe(false);
      expect(结果.原因, '拦下却没有原因，用户就只看到「没反应」').toBeTruthy();
    }
  });
});
