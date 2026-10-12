import { describe, expect, it } from 'vitest';
import { ComfyConcurrencyGate, ComfyQueueAbort } from '@/services/ai/imageGen/comfyGate';

function 延迟(毫秒: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 毫秒));
}

describe('ComfyConcurrencyGate', () => {
  it('上限被夹在 1..10', () => {
    expect(new ComfyConcurrencyGate(0).当前上限).toBe(1);
    expect(new ComfyConcurrencyGate(99).当前上限).toBe(10);
    expect(new ComfyConcurrencyGate(3.7).当前上限).toBe(3);
    expect(new ComfyConcurrencyGate(Number.NaN).当前上限).toBe(1);
  });

  it('未达上限时立即放行，不排队', async () => {
    const 闸门 = new ComfyConcurrencyGate(2);
    await 闸门.获取();
    await 闸门.获取();
    expect(闸门.活动数).toBe(2);
  });

  it('达到上限后按 FIFO 顺序放行', async () => {
    const 闸门 = new ComfyConcurrencyGate(1);
    await 闸门.获取();
    const 顺序: number[] = [];
    const 甲 = 闸门.获取().then(() => { 顺序.push(1); });
    const 乙 = 闸门.获取().then(() => { 顺序.push(2); });
    const 丙 = 闸门.获取().then(() => { 顺序.push(3); });
    await 延迟(0);
    expect(顺序).toEqual([]);
    闸门.释放(true);
    await 甲;
    闸门.释放(true);
    await 乙;
    闸门.释放(true);
    await 丙;
    expect(顺序).toEqual([1, 2, 3]);
  });

  it('重复释放不会把额度放大', async () => {
    const 闸门 = new ComfyConcurrencyGate(1);
    await 闸门.获取();
    闸门.释放(true);
    闸门.释放(true);
    闸门.释放(true);
    expect(闸门.活动数).toBe(0);
    await 闸门.获取();
    expect(闸门.活动数).toBe(1);
  });

  it('未获取就释放是空操作', () => {
    const 闸门 = new ComfyConcurrencyGate(2);
    闸门.释放(false);
    expect(闸门.活动数).toBe(0);
  });

  it('已中止的信号在获取时立即拒绝，不占额度', async () => {
    const 闸门 = new ComfyConcurrencyGate(1);
    const controller = new AbortController();
    controller.abort();
    await expect(闸门.获取(controller.signal)).rejects.toBeInstanceOf(ComfyQueueAbort);
    expect(闸门.活动数).toBe(0);
  });

  it('排队期间被取消时不消费额度，下一位仍能拿到', async () => {
    const 闸门 = new ComfyConcurrencyGate(1);
    await 闸门.获取();

    const 甲控制器 = new AbortController();
    const 甲 = 闸门.获取(甲控制器.signal);
    const 顺序: string[] = [];
    const 乙 = 闸门.获取().then(() => { 顺序.push('乙'); });

    甲控制器.abort();
    await expect(甲).rejects.toBeInstanceOf(ComfyQueueAbort);
    expect(顺序).toEqual([]);

    闸门.释放(true);
    await 乙;
    expect(顺序).toEqual(['乙']);
  });

  it('多个等待者中只有被取消的那个出队，其余顺序不变', async () => {
    const 闸门 = new ComfyConcurrencyGate(1);
    await 闸门.获取();

    const 甲控制器 = new AbortController();
    const 甲 = 闸门.获取(甲控制器.signal);
    const 顺序: string[] = [];
    const 乙 = 闸门.获取().then(() => { 顺序.push('乙'); });
    const 丙 = 闸门.获取().then(() => { 顺序.push('丙'); });

    甲控制器.abort();
    await expect(甲).rejects.toBeInstanceOf(ComfyQueueAbort);

    闸门.释放(true);
    await 乙;
    闸门.释放(true);
    await 丙;
    expect(顺序).toEqual(['乙', '丙']);
  });
});
