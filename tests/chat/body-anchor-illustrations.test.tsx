// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BodyBlock } from '@/components/features/Chat/MessageRenderers';

const 正文 = [
  '她抬起头。',
  '窗外的雨还在下。',
  '她转身离开。',
].join('\n');

function 渲染(行间插图: Array<{ id: string; 锚点: string }>) {
  return render(
    <BodyBlock
      content={正文}
      showInnerVoice={false}
      行间插图={行间插图}
      renderIllustration={(id) => <div data-testid={`插图-${id}`}>插图 {id}</div>}
    />,
  );
}

describe('BodyBlock 行间插图', () => {
  it('没有插图时只渲染正文', () => {
    render(<BodyBlock content={正文} showInnerVoice={false} />);
    expect(screen.getByText(/她抬起头/)).toBeInTheDocument();
    expect(screen.queryByTestId(/插图-/)).not.toBeInTheDocument();
  });

  it('锚点命中时插图出现在该行之后、下一行之前', () => {
    const { container } = 渲染([{ id: 'a', 锚点: '窗外的雨还在下' }]);
    const 文本 = container.textContent ?? '';
    expect(文本).toContain('她抬起头');
    expect(文本).toContain('插图 a');
    expect(文本).toContain('她转身离开');
    // 顺序：第二行 → 插图 → 第三行。
    expect(文本.indexOf('窗外的雨还在下')).toBeLessThan(文本.indexOf('插图 a'));
    expect(文本.indexOf('插图 a')).toBeLessThan(文本.indexOf('她转身离开'));
  });

  it('近似锚点靠模糊匹配也能落位', () => {
    const { container } = 渲染([{ id: 'a', 锚点: '窗外雨还在下' }]);
    const 文本 = container.textContent ?? '';
    expect(文本.indexOf('插图 a')).toBeGreaterThan(文本.indexOf('窗外的雨还在下'));
    expect(文本.indexOf('插图 a')).toBeLessThan(文本.indexOf('她转身离开'));
  });

  it('锚点完全匹配不上时兜底铺在正文之后，而不是丢掉', () => {
    const { container } = 渲染([{ id: 'z', 锚点: '完全不相干的另一句话语内容' }]);
    const 文本 = container.textContent ?? '';
    expect(文本).toContain('插图 z');
    expect(文本.indexOf('插图 z')).toBeGreaterThan(文本.indexOf('她转身离开'));
  });

  it('两张图各自落在各自锚点的行后面', () => {
    const { container } = 渲染([
      { id: 'a', 锚点: '她抬起头' },
      { id: 'b', 锚点: '她转身离开' },
    ]);
    const 文本 = container.textContent ?? '';
    expect(文本.indexOf('她抬起头')).toBeLessThan(文本.indexOf('插图 a'));
    expect(文本.indexOf('插图 a')).toBeLessThan(文本.indexOf('窗外的雨还在下'));
    expect(文本.indexOf('窗外的雨还在下')).toBeLessThan(文本.indexOf('插图 b'));
  });

  it('多张图命中同一行时只落一张，其余走兜底（避免堆在同一行）', () => {
    const { container } = 渲染([
      { id: 'a', 锚点: '窗外的雨还在下' },
      { id: 'b', 锚点: '窗外的雨还在下' },
    ]);
    const 文本 = container.textContent ?? '';
    expect(文本).toContain('插图 a');
    expect(文本).toContain('插图 b');
    // a 落在第二行之后，b 被兜底推到正文末尾。
    expect(文本.indexOf('插图 a')).toBeLessThan(文本.indexOf('她转身离开'));
    expect(文本.indexOf('插图 b')).toBeGreaterThan(文本.indexOf('她转身离开'));
  });
});
