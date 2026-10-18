/**
 * 流式预览驱动器。
 *
 * 背景（为什么需要它）：
 * 旧实现是「每收到一个 delta，就往一条 Promise 链里塞一段逐字补间」——
 * 把 delta 再切成若干小块，每块 `await 14ms`。模型吐字速度快于这个节奏时，
 * 队列会无限积压：预览越落越后，模型早就写完了界面还在"打字"；
 * 而重试/清理又会在中途把预览清空重来 —— 视觉上就是**抽搐、跳回、重打一遍**。
 *
 * 这里换成单一 rAF 循环：
 *   - 目标文本由 push() 更新（真实流），显示位置只向前推进，**永不回退**；
 *   - 每帧最多显示"积压量的 1/4"，积压越多追得越快，因此永远不会掉队；
 *   - 没有队列、没有 setTimeout 链，也就没有"结束后还在补间"的尾巴。
 */
export interface StreamingPreviewDriver {
  /** 更新目标文本（传入已累计的全文）。 */
  push: (fullText: string) => void;
  /** 立即对齐到目标文本并停止推进（回合落地时调用，不做重放）。 */
  finish: () => void;
  /** 清空并重置（重试 / 新一轮开始时调用）。 */
  reset: () => void;
  /** 当前已显示到哪儿（调试用）。 */
  current: () => string;
  dispose: () => void;
}

/** 每帧至少推进的字符数：让慢速流（每秒几个字）也能顺滑出现，而不是一卡一卡。 */
const MIN_STEP = 2;

export function createStreamingPreviewDriver(
  commit: (text: string) => void,
): StreamingPreviewDriver {
  let target = '';
  let shown = 0;
  let frame: number | null = null;
  let disposed = false;

  const hasRaf = typeof requestAnimationFrame === 'function';

  const cancel = () => {
    if (frame === null) return;
    if (hasRaf) cancelAnimationFrame(frame);
    else clearTimeout(frame as unknown as ReturnType<typeof setTimeout>);
    frame = null;
  };

  const schedule = () => {
    if (disposed || frame !== null) return;
    frame = hasRaf
      ? requestAnimationFrame(tick)
      : (setTimeout(tick, 16) as unknown as number);
  };

  function tick(): void {
    frame = null;
    if (disposed) return;
    const remaining = target.length - shown;
    if (remaining <= 0) return;
    // 积压越多步子越大：4 帧内必然追平，因此不会出现"越落越远"。
    const step = Math.max(MIN_STEP, Math.ceil(remaining / 4));
    shown = Math.min(target.length, shown + step);
    commit(target.slice(0, shown));
    if (shown < target.length) schedule();
  }

  return {
    push(fullText) {
      if (disposed || fullText === target) return;
      target = fullText;
      // 内容变短时只夹住显示位置，不让它越界；不主动回退。
      if (shown > target.length) shown = target.length;
      schedule();
    },
    finish() {
      if (disposed) return;
      cancel();
      shown = target.length;
      commit(target);
    },
    reset() {
      if (disposed) return;
      cancel();
      target = '';
      shown = 0;
      commit('');
    },
    current() {
      return target.slice(0, shown);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
    },
  };
}
