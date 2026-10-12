// @vitest-environment jsdom
/**
 * AVG 式**逐段**推进。
 *
 * 借鉴用户的 galgame 前端：一次只显示一个单位，前进时**上一个消失**
 *（不是累积铺开——第一版做成了累积，用户指出那不对）。
 * 这里锁定几件容易出错的事：
 *   ① 关闭时行为与原来完全一致；
 *   ② 一次只显示一段，上一段确实消失；
 *   ③ 滚轮必须被拦截，否则「前进一段」和「页面滚动」会同时发生；
 *   ④ 输入框里打字时空格不能被吃掉；
 *   ⑤ 生成中强制全显；内容变长不打断已读进度。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { use逐段推进, 切分段落, 派生段落插图 } from '@/components/features/Chat/use逐段推进';

function 试验台(props: {
  行: Array<{ kind: string }>;
  启用: boolean;
  立即全显?: boolean;
  生成中?: boolean;
}) {
  const 推进 = use逐段推进(props);
  return (
    <div ref={推进.容器引用}>
      <span data-testid="段序号">{推进.段序号}</span>
      <span data-testid="段总数">{推进.段总数}</span>
      <span data-testid="区间">{`${推进.可见区间.起}-${推进.可见区间.止}`}</span>
      <span data-testid="全显">{String(推进.是否全显)}</span>
      <input data-testid="输入框" />
      <button type="button" onClick={推进.前进}>前进</button>
      <button type="button" onClick={推进.后退}>后退</button>
      <button type="button" onClick={推进.全部展开}>跳到末段</button>
    </div>
  );
}

/** 三行正文：每行一段（中文网文的常见写法，行间没有空行）。 */
const 三段行 = [{ kind: 'narration' }, { kind: 'narration' }, { kind: 'narration' }];

/** 带空行的写法：空行只是分隔，不单独成段。 */
const 带空行 = [
  { kind: 'narration' },
  { kind: 'blank' },
  { kind: 'narration' },
  { kind: 'narration' },
  { kind: 'blank' },
  { kind: 'narration' },
];

function 滚动(容器: HTMLElement, deltaY: number) {
  const 事件 = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
  fireEvent(容器, 事件);
  return 事件;
}

describe('切分段落', () => {
  it('每个非空行自成一段（中文网文一行一段）', () => {
    expect(切分段落(三段行)).toEqual([
      { 起: 0, 止: 1 },
      { 起: 1, 止: 2 },
      { 起: 2, 止: 3 },
    ]);
  });

  it('空行只作分隔，不单独成段', () => {
    expect(切分段落(带空行)).toEqual([
      { 起: 0, 止: 1 },
      { 起: 2, 止: 3 },
      { 起: 3, 止: 4 },
      { 起: 5, 止: 6 },
    ]);
  });

  it('开头/结尾的空行被忽略', () => {
    const 行 = [{ kind: 'blank' }, { kind: 'narration' }, { kind: 'blank' }];
    expect(切分段落(行)).toEqual([{ 起: 1, 止: 2 }]);
  });

  it('全空内容没有段落', () => {
    expect(切分段落([{ kind: 'blank' }, { kind: 'blank' }])).toEqual([]);
  });

  it('空行不会把多行并成一段（这是之前「一次显示全部」的原因）', () => {
    const 段 = 切分段落(带空行);
    // 曾经按空行分组，得到 3 段且其中一段含两行；中文网文没有空行时会并成 1 段。
    expect(段).toHaveLength(4);
    expect(段.every((项) => 项.止 - 项.起 === 1)).toBe(true);
  });
});

describe('一次只显示一段', () => {
  it('初始只显示第一段', () => {
    render(<试验台 行={三段行} 启用 />);
    expect(screen.getByTestId('区间').textContent).toBe('0-1');
    expect(screen.getByTestId('段总数').textContent).toBe('3');
  });

  it('前进后显示下一段，且上下段不重叠（上一段消失）', () => {
    render(<试验台 行={三段行} 启用 />);
    fireEvent.click(screen.getByText('前进'));
    expect(screen.getByTestId('区间').textContent).toBe('1-2');
    fireEvent.click(screen.getByText('前进'));
    expect(screen.getByTestId('区间').textContent).toBe('2-3');
  });

  it('到末段后不再前进', () => {
    render(<试验台 行={三段行} 启用 />);
    fireEvent.click(screen.getByText('前进'));
    fireEvent.click(screen.getByText('前进'));
    fireEvent.click(screen.getByText('前进'));
    expect(screen.getByTestId('段序号').textContent).toBe('2');
    expect(screen.getByTestId('区间').textContent).toBe('2-3');
  });

  it('滚轮向下前进、向上回退，且不退到负数', () => {
    const { container } = render(<试验台 行={三段行} 启用 />);
    const 目标 = container.firstElementChild as HTMLElement;
    滚动(目标, 120);
    expect(screen.getByTestId('段序号').textContent).toBe('1');
    滚动(目标, -120);
    expect(screen.getByTestId('段序号').textContent).toBe('0');
    滚动(目标, -120);
    expect(screen.getByTestId('段序号').textContent).toBe('0');
  });

  it('滚轮被拦截（否则会同时滚动页面）', () => {
    const { container } = render(<试验台 行={三段行} 启用 />);
    expect(滚动(container.firstElementChild as HTMLElement, 120).defaultPrevented).toBe(true);
  });

  it('挂载后滚轮立即生效（容器 ref 是挂载后才有的）', () => {
    const { container } = render(<试验台 行={三段行} 启用 />);
    滚动(container.firstElementChild as HTMLElement, 120);
    expect(screen.getByTestId('段序号').textContent).toBe('1');
  });

  it('空格前进并阻止页面滚动', () => {
    render(<试验台 行={三段行} 启用 />);
    const 事件 = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    fireEvent(document, 事件);
    expect(screen.getByTestId('段序号').textContent).toBe('1');
    expect(事件.defaultPrevented).toBe(true);
  });

  it('回车前进', () => {
    render(<试验台 行={三段行} 启用 />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByTestId('段序号').textContent).toBe('1');
  });

  it('在输入框里打字时空格不被吃掉', () => {
    render(<试验台 行={三段行} 启用 />);
    fireEvent.keyDown(screen.getByTestId('输入框'), { key: ' ' });
    expect(screen.getByTestId('段序号').textContent).toBe('0');
  });

  it('「跳到末段」直接到最后', () => {
    render(<试验台 行={三段行} 启用 />);
    fireEvent.click(screen.getByText('跳到末段'));
    expect(screen.getByTestId('段序号').textContent).toBe('2');
  });
});

describe('关闭时行为不变', () => {
  it('未启用时显示全篇', () => {
    render(<试验台 行={三段行} 启用={false} />);
    expect(screen.getByTestId('区间').textContent).toBe('0-3');
    expect(screen.getByTestId('全显').textContent).toBe('true');
  });

  it('未启用时滚轮不改变当前段', () => {
    const { container } = render(<试验台 行={三段行} 启用={false} />);
    滚动(container.firstElementChild as HTMLElement, 120);
    expect(screen.getByTestId('区间').textContent).toBe('0-3');
  });
});

describe('立即全显与生成中', () => {
  it('「立即全显」开启时显示全篇', () => {
    render(<试验台 行={三段行} 启用 立即全显 />);
    expect(screen.getByTestId('区间').textContent).toBe('0-3');
  });

  it('生成中强制全显（段落还在变）', () => {
    render(<试验台 行={三段行} 启用 生成中 />);
    expect(screen.getByTestId('区间').textContent).toBe('0-3');
  });

  it('生成结束后回到第一段', () => {
    const { rerender } = render(<试验台 行={三段行} 启用 生成中 />);
    rerender(<试验台 行={三段行} 启用 />);
    expect(screen.getByTestId('段序号').textContent).toBe('0');
  });
});

describe('段落与插图的归属', () => {
  const 段落 = [{ 起: 0, 止: 1 }, { 起: 1, 止: 2 }, { 起: 2, 止: 3 }, { 起: 3, 止: 4 }];

  it('第一张图之前的段落也先显示第一张图（否则开头画面很空）', () => {
    // 图挂在第 3 段（索引 2）上。
    const 行插图 = new Map([[2, ['图A']]]);
    const 分配 = 派生段落插图(段落, 行插图);
    expect(分配).toEqual(['图A', '图A', '图A', '图A']);
  });

  it('图横跨到下一张图出现为止（不是只显示一段）', () => {
    const 行插图 = new Map([[1, ['图A']], [3, ['图B']]]);
    const 分配 = 派生段落插图(段落, 行插图);
    // 段0/1 用图A，段2 仍是图A，段3 换成图B。
    expect(分配).toEqual(['图A', '图A', '图A', '图B']);
  });

  it('可以关掉「首图占位」，此时第一张图之前的段落没有图', () => {
    const 行插图 = new Map([[2, ['图A']]]);
    expect(派生段落插图(段落, 行插图, { 显示首图: false }))
      .toEqual([null, null, '图A', '图A']);
  });

  it('没有任何插图时全是 null', () => {
    expect(派生段落插图(段落, new Map())).toEqual([null, null, null, null]);
  });

  it('没有段落时返回空数组', () => {
    expect(派生段落插图([], new Map([[0, ['图A']]]))).toEqual([]);
  });

  it('同一行挂了多张图时取第一张作为画面', () => {
    const 行插图 = new Map([[0, ['图A', '图B']]]);
    expect(派生段落插图([{ 起: 0, 止: 1 }], 行插图)).toEqual(['图A']);
  });
});

describe('内容变化的边界', () => {
  it('内容为空时退回显示全篇，不越界', () => {
    render(<试验台 行={[]} 启用 />);
    expect(screen.getByTestId('段总数').textContent).toBe('0');
    expect(screen.getByTestId('区间').textContent).toBe('0-0');
  });

  it('段落变少时序号被夹回合法范围', () => {
    const { rerender } = render(<试验台 行={三段行} 启用 />);
    fireEvent.click(screen.getByText('跳到末段'));
    expect(screen.getByTestId('段序号').textContent).toBe('2');
    rerender(<试验台 行={[{ kind: 'narration' }]} 启用 />);
    expect(screen.getByTestId('段序号').textContent).toBe('0');
  });

  it('段落变多时**保留**当前进度（不能自己跳回第一段）', () => {
    const { rerender } = render(<试验台 行={三段行} 启用 />);
    fireEvent.click(screen.getByText('前进'));
    expect(screen.getByTestId('段序号').textContent).toBe('1');
    rerender(<试验台 行={[...三段行, { kind: 'narration' }]} 启用 />);
    expect(screen.getByTestId('段序号').textContent).toBe('1');
  });
});
