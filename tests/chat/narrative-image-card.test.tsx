// @vitest-environment jsdom
/**
 * 插图卡片的显示行为测试。
 *
 * 起因：用户要求去掉卡片上的**提示词文本**与**插入位置**显示 ——
 * 后者存在 `image.description` 里（那是锚点，对用户是噪声）。
 * 同时新增「默认显示 / 默认展开」两个开关，这里锁定它们的行为。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NarrativeImageCard } from '@/components/features/Chat/narrativeImageCards';
import type { 叙事插图 } from '@/models/chat';

function 建插图(补丁: Partial<叙事插图> = {}): 叙事插图 {
  return {
    id: 'n1',
    dataUrl: 'data:image/png;base64,AAAA',
    type: 'scene',
    kind: 'snapshot',
    // 这里存的是**锚点**——不应该显示给用户。
    description: '舷窗外，原本静谧的星海被几道暗红色的高能轨迹骤然撕裂。',
    prompt: 'image###sāfe&1girl, masterpiece, space station###',
    status: 'done',
    ...补丁,
  };
}

describe('卡片不再显示提示词与插入位置', () => {
  it('标题区不出现锚点文本', () => {
    render(<NarrativeImageCard image={建插图()} />);
    expect(screen.queryByText(/舷窗外/)).not.toBeInTheDocument();
    expect(screen.getByText(/正文插图/)).toBeInTheDocument();
  });

  it('展开后也不再铺提示词文本', () => {
    render(<NarrativeImageCard image={建插图()} defaultExpanded />);
    expect(screen.queryByText(/masterpiece/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sāfe&/)).not.toBeInTheDocument();
  });

  it('没有提示词记录时也不显示「无提示词记录」占位', () => {
    render(<NarrativeImageCard image={建插图({ prompt: '' })} defaultExpanded />);
    expect(screen.queryByText(/无提示词记录/)).not.toBeInTheDocument();
  });

  it('「改提示词」仍可用，进入编辑后才出现输入框', () => {
    render(
      <NarrativeImageCard
        image={建插图()}
        defaultExpanded
        onRegenerate={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('改提示词并重生'));
    // 编辑态下提示词是输入框内容，这是它该出现的地方。
    // 卡片里有两个输入框（提示词 textarea 与尺寸 input），按值定位。
    const 提示词框 = screen.getAllByRole('textbox')
      .find((节点) => (节点 as HTMLTextAreaElement).value.includes('masterpiece'));
    expect(提示词框).toBeDefined();
    expect((提示词框 as HTMLTextAreaElement).value).toContain('1girl');
  });
});

describe('默认展开', () => {
  it('默认折叠：只显示标题行，不渲染图片', () => {
    render(<NarrativeImageCard image={建插图()} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('默认展开：直接渲染图片', () => {
    render(<NarrativeImageCard image={建插图()} defaultExpanded />);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('点标题可手动展开', () => {
    render(<NarrativeImageCard image={建插图()} />);
    fireEvent.click(screen.getByText(/正文插图/));
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('设置改变时已挂载的卡片跟着变（不必刷新页面）', () => {
    const { rerender } = render(<NarrativeImageCard image={建插图()} defaultExpanded={false} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    rerender(<NarrativeImageCard image={建插图()} defaultExpanded />);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });
});

describe('生成中与失败态不受显示开关影响', () => {
  it('生成中显示进度条', () => {
    render(<NarrativeImageCard image={建插图({ status: 'generating' })} />);
    expect(screen.getByText(/正在生成正文插图/)).toBeInTheDocument();
  });

  it('失败态显示原因与重试按钮', () => {
    render(
      <NarrativeImageCard
        image={建插图({ status: 'failed', error: '工作流校验失败' })}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.getByText(/工作流校验失败/)).toBeInTheDocument();
    expect(screen.getByText('重新生成')).toBeInTheDocument();
  });

  it('失败态点重新生成会回调', () => {
    const onRegenerate = vi.fn();
    render(<NarrativeImageCard image={建插图({ status: 'failed', error: 'x' })} onRegenerate={onRegenerate} />);
    fireEvent.click(screen.getByText('重新生成'));
    expect(onRegenerate).toHaveBeenCalledWith(undefined);
  });
});
