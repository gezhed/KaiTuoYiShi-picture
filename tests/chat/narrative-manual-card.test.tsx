// @vitest-environment jsdom
/**
 * 「生成本回合插图」按钮的行为。
 *
 * 沿革：这里原本是个可折叠面板，展开后一屏文字 + 两个听着像但行为不同的按钮，
 * 用户按了其中一个发现没反应。现在收敛成**一个按钮**：
 * 不再有折叠、不再有说明文字，行为直接写在按钮上。
 *
 * 失败原因仍然要显示 —— 否则用户只会看到「点了没反应」。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NarrativeImageManualCard } from '@/components/features/Chat/narrativeImageCards';

describe('按钮基本行为', () => {
  it('默认显示「生成本回合插图」', () => {
    render(<NarrativeImageManualCard onRegenerate={() => {}} />);
    expect(screen.getByRole('button', { name: /生成本回合插图/ })).toBeInTheDocument();
  });

  it('点击触发回调', () => {
    const onRegenerate = vi.fn();
    render(<NarrativeImageManualCard onRegenerate={onRegenerate} />);
    fireEvent.click(screen.getByRole('button', { name: /生成本回合插图/ }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('没有回调时禁用（避免点了没反应却看不出原因）', () => {
    render(<NarrativeImageManualCard />);
    expect(screen.getByRole('button', { name: /生成本回合插图/ })).toBeDisabled();
  });

  it('不再有折叠与展开', () => {
    render(<NarrativeImageManualCard onRegenerate={() => {}} />);
    expect(screen.queryByText(/展开|收起/)).not.toBeInTheDocument();
  });

  it('不再铺说明文字（按钮本身就是说明）', () => {
    render(<NarrativeImageManualCard onRegenerate={() => {}} />);
    expect(screen.queryByText(/当前为手动模式/)).not.toBeInTheDocument();
    expect(screen.queryByText(/条数由模型决定/)).not.toBeInTheDocument();
  });
});

describe('运行中的阶段文案', () => {
  it('等 LLM 写提示词', () => {
    render(<NarrativeImageManualCard regenerating onRegenerate={() => {}} />);
    expect(screen.getByRole('button', { name: /正在等待 LLM 写提示词/ })).toBeInTheDocument();
  });

  it('逐张出图（与等提示词区分开，两者耗时差一个数量级）', () => {
    render(<NarrativeImageManualCard regenerating 阶段="出图中" onRegenerate={() => {}} />);
    expect(screen.getByRole('button', { name: /正在逐张生成图片/ })).toBeInTheDocument();
  });

  it('运行中按钮不可点，避免重复触发', () => {
    const onRegenerate = vi.fn();
    render(<NarrativeImageManualCard regenerating onRegenerate={onRegenerate} />);
    const 按钮 = screen.getByRole('button');
    expect(按钮).toBeDisabled();
    fireEvent.click(按钮);
    expect(onRegenerate).not.toHaveBeenCalled();
  });
});

describe('失败原因', () => {
  it('失败时把原因显示出来', () => {
    render(<NarrativeImageManualCard onRegenerate={() => {}} 失败原因="工作流校验失败：Value not in list" />);
    expect(screen.getByText(/上次生成失败/)).toBeInTheDocument();
    expect(screen.getByText(/Value not in list/)).toBeInTheDocument();
  });

  it('运行中不显示旧的失败原因（避免和进行中的状态混淆）', () => {
    render(<NarrativeImageManualCard regenerating onRegenerate={() => {}} 失败原因="上一次的错误" />);
    expect(screen.queryByText(/上次生成失败/)).not.toBeInTheDocument();
  });

  it('没有失败原因时不渲染失败条', () => {
    render(<NarrativeImageManualCard onRegenerate={() => {}} />);
    expect(screen.queryByText(/上次生成失败/)).not.toBeInTheDocument();
  });
});
