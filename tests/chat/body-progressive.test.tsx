// @vitest-environment jsdom
/**
 * 逐段推进在**真实正文组件**里的行为。
 *
 * 之前只测了 hook 本身，结果接进组件后整体失效 —— 用户看到「全部文本都显示了」。
 * 所以这里直接渲染 BodyBlock，检查真正落到屏幕上的行。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BodyBlock } from '@/components/features/Chat/MessageRenderers';

const 正文 = [
  '第一段旁白内容。',
  '',
  '第二段旁白内容。',
  '「第二段的台词。」',
  '',
  '第三段旁白内容。',
].join('\n');

describe('BodyBlock 的逐段推进', () => {
  it('启用时只显示第一段，后面的段落不在 DOM 里', () => {
    render(<BodyBlock content={正文} 逐句推进={{ 启用: true, 立即全显: false }} />);
    expect(screen.getByText(/第一段旁白内容/)).toBeInTheDocument();
    expect(screen.queryByText(/第二段旁白内容/)).not.toBeInTheDocument();
    expect(screen.queryByText(/第三段旁白内容/)).not.toBeInTheDocument();
  });

  it('前进一段后第二段出现、第一段消失（不是累积）', () => {
    render(<BodyBlock content={正文} 逐句推进={{ 启用: true, 立即全显: false }} />);
    fireEvent.click(screen.getByText(/继续/));
    expect(screen.getByText(/第二段旁白内容/)).toBeInTheDocument();
    expect(screen.queryByText(/第一段旁白内容/)).not.toBeInTheDocument();
  });

  it('一行里的台词与尾巴旁白一起出现（同一行不会被拆开）', () => {
    // 行者：把对白和它后面的旁白放在同一行，这是解析后的一段。
    const 单行 = '「你来了。」她把门推开。\n下一行是另一段。';
    render(<BodyBlock content={单行} 逐句推进={{ 启用: true, 立即全显: false }} />);
    expect(screen.getByText(/你来了/)).toBeInTheDocument();
    // 同行的尾巴旁白必须一起显示，不能被切掉。
    expect(screen.getByText(/她把门推开/)).toBeInTheDocument();
    // 第二行还没轮到。
    expect(screen.queryByText(/下一行是另一段/)).not.toBeInTheDocument();
  });

  it('关闭时整篇都显示（与原来一致）', () => {
    render(<BodyBlock content={正文} 逐句推进={{ 启用: false, 立即全显: false }} />);
    expect(screen.getByText(/第一段旁白内容/)).toBeInTheDocument();
    expect(screen.getByText(/第二段旁白内容/)).toBeInTheDocument();
    expect(screen.getByText(/第三段旁白内容/)).toBeInTheDocument();
  });

  it('不传该 prop 时整篇都显示（老调用点不受影响）', () => {
    render(<BodyBlock content={正文} />);
    expect(screen.getByText(/第三段旁白内容/)).toBeInTheDocument();
  });

  it('生成中整篇都显示（段落还在变）', () => {
    render(<BodyBlock content={正文} 逐句推进={{ 启用: true, 立即全显: false }} 生成中 />);
    expect(screen.getByText(/第三段旁白内容/)).toBeInTheDocument();
  });

  it('「立即全显」开启时整篇都显示', () => {
    render(<BodyBlock content={正文} 逐句推进={{ 启用: true, 立即全显: true }} />);
    expect(screen.getByText(/第三段旁白内容/)).toBeInTheDocument();
  });

  it('底部提示显示当前段号与总段数', () => {
    render(<BodyBlock content={正文} 逐句推进={{ 启用: true, 立即全显: false }} />);
    // 正文里 4 个非空行（空行只是分隔），所以是 1 / 4 段。
    expect(screen.getByText(/1 \/ 4 段/)).toBeInTheDocument();
  });

  it('跳到末段后显示最后一段', () => {
    render(<BodyBlock content={正文} 逐句推进={{ 启用: true, 立即全显: false }} />);
    fireEvent.click(screen.getByText('跳到末段'));
    expect(screen.getByText(/第三段旁白内容/)).toBeInTheDocument();
    expect(screen.queryByText(/第一段旁白内容/)).not.toBeInTheDocument();
  });

  it('滚轮在正文容器上前进一段', () => {
    const { container } = render(
      <BodyBlock content={正文} 逐句推进={{ 启用: true, 立即全显: false }} />,
    );
    const 目标 = container.firstElementChild as HTMLElement;
    fireEvent(目标, new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    expect(screen.getByText(/第二段旁白内容/)).toBeInTheDocument();
  });
});

describe('插图固定在上方', () => {
  /** 四段正文，两张图分别挂在第三、第四句上（模拟模型把 <image> 写在正文行间）。 */
  const 带图正文 = [
    '第一句没有图。',
    '第二句还是没有图。',
    '第三句出现了画面。',
    '第四句换了个画面。',
  ].join('\n');

  const 插图 = [
    { id: '图A', 锚点: '第三句出现了画面。' },
    { id: '图B', 锚点: '第四句换了个画面。' },
  ];

  const 渲染插图 = (id: string) => <span data-testid={`插图-${id}`}>[图 {id}]</span>;

  function 挂载() {
    return render(
      <BodyBlock
        content={带图正文}
        行间插图={插图}
        renderIllustration={渲染插图}
        逐句推进={{ 启用: true, 立即全显: false }}
      />,
    );
  }

  it('第一句就显示第一张图（开头不空）', () => {
    挂载();
    expect(screen.getByText(/第一句没有图/)).toBeInTheDocument();
    // 第一句本身没有图，但画面要先给出来，否则开头很空。
    expect(screen.getByTestId('插图-图A')).toBeInTheDocument();
  });

  it('前进到下一句时图仍然挂着（不随段落卸载）', () => {
    挂载();
    fireEvent.click(screen.getByText(/继续/));
    expect(screen.getByText(/第二句还是没有图/)).toBeInTheDocument();
    // 关键：文字换了，图还在。
    expect(screen.getByTestId('插图-图A')).toBeInTheDocument();
  });

  it('走到下一张图所在段时，画面换成下一张', () => {
    挂载();
    for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByText(/继续/));
    expect(screen.getByText(/第四句换了个画面/)).toBeInTheDocument();
    expect(screen.getByTestId('插图-图B')).toBeInTheDocument();
  });

  it('图不会重复渲染（固定显示与行间锚点只留一处）', () => {
    挂载();
    expect(screen.getAllByTestId('插图-图A')).toHaveLength(1);
  });

  it('关闭逐段推进时不固定图（按原本的锚点位置渲染）', () => {
    render(
      <BodyBlock
        content={带图正文}
        行间插图={插图}
        renderIllustration={渲染插图}
        逐句推进={{ 启用: false, 立即全显: false }}
      />,
    );
    expect(screen.getByText(/第一句没有图/)).toBeInTheDocument();
    expect(screen.getByText(/第四句换了个画面/)).toBeInTheDocument();
  });

  it('回退时画面跟着退回上一张', () => {
    const { container } = 挂载();
    for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByText(/继续/));
    expect(screen.getByTestId('插图-图B')).toBeInTheDocument();
    // 滚轮向上回退：从第四句退到第三句，画面回到图A。
    const 目标 = container.firstElementChild as HTMLElement;
    fireEvent(目标, new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
    expect(screen.getByText(/第三句出现了画面/)).toBeInTheDocument();
    expect(screen.getByTestId('插图-图A')).toBeInTheDocument();
  });
});
