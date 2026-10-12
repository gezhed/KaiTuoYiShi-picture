/**
 * 并发闸门。
 *
 * 派生自 st-chatu8（智绘姬）`ComfyUIConcurrencyManager`（index.js L10342-L10442）
 * 与调用点 L47175-L47178。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：改写成 Promise 化的异步信号量。原实现把 `await acquire()` 放在
 *   try/finally **之外**（L47178 对 L47404/L47699），排队期间被取消的任务会永久
 *   泄漏在 activeComfyuiTasks 里且任务队列项永不结算；这里把获取与释放在同一个
 *   受控区间内，取消时同步让出额度。
 */

/**
 * 固定上限的 FIFO 信号量。
 *
 * 取消语义：等待中的申请在 abort 时立即以 `ComfyQueueAbort` 拒绝，且不占用额度；
 * 已获得额度的申请在 release 时归还。
 */
export class ComfyQueueAbort extends Error {
  constructor() {
    super('任务已取消');
    this.name = 'ComfyQueueAbort';
  }
}

export class ComfyConcurrencyGate {
  private readonly 上限: number;
  private 使用中 = 0;
  private readonly 等待队列: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }> = [];

  constructor(上限: number) {
    this.上限 = Math.max(1, Math.min(10, Math.trunc(上限) || 1));
  }

  get 当前上限(): number {
    return this.上限;
  }

  get 活动数(): number {
    return this.使用中;
  }

  async 获取(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new ComfyQueueAbort();
    if (this.使用中 < this.上限) {
      this.使用中 += 1;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const 条目 = {
        resolve: () => {
          this.使用中 += 1;
          resolve();
        },
        reject,
        signal,
        onAbort: undefined as (() => void) | undefined,
      };
      if (signal) {
        const onAbort = () => {
          const 位置 = this.等待队列.indexOf(条目);
          if (位置 >= 0) this.等待队列.splice(位置, 1);
          reject(new ComfyQueueAbort());
        };
        条目.onAbort = onAbort;
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.等待队列.push(条目);
    });
  }

  /** 幂等释放：重复调用不会把额度放大。 */
  释放(已获取: boolean): void {
    if (!已获取) return;
    const 下一个 = this.等待队列.shift();
    if (下一个) {
      if (下一个.signal && 下一个.onAbort) {
        下一个.signal.removeEventListener('abort', 下一个.onAbort);
      }
      if (下一个.signal?.aborted) {
        下一个.reject(new ComfyQueueAbort());
        // 被取消的等待者不消费额度，继续交给下一位。
        this.释放(true);
        return;
      }
      下一个.resolve();
      return;
    }
    this.使用中 = Math.max(0, this.使用中 - 1);
  }
}
