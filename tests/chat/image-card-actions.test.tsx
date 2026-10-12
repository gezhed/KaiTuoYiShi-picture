// @vitest-environment jsdom
/**
 * 正文插图卡片的操作区（用户反馈：文字按钮过于冗余）。
 *
 * 现在同一件事只有一处图标入口，说明文字走悬停提示：
 *   查看大图 / 重新生成 / 修改提示词 / 换提示词。
 * 之前「重新生成」与「原样重生」、「改提示词」与「改提示词并重生」各写两遍。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NarrativeImageCard } from '@/components/features/Chat/narrativeImageCards';
import type { 叙事插图 } from '@/models/chat';

function 建插图(覆盖: Partial<叙事插图> = {}): 叙事插图 {
  return {
    id: 'img_1',
    dataUrl: 'data:image/png;base64,AAAA',
    type: 'scene',
    kind: 'scene',
    prompt: 'image###1girl, white coat, 960x1280###',
    negativePrompt: 'bad hands',
    description: '她抬头看雨',
    status: 'done',
    ...覆盖,
  };
}

describe('插图卡片：图标操作 + 悬停说明', () => {
  it('四个动作都在图标按钮上，且带无障碍名称', () => {
    render(
      <NarrativeImageCard
        image={建插图()}
        onRegenerate={() => {}}
        onRerollPrompts={() => {}}
      />,
    );
    for (const 名称 of ['查看大图', '重新生成', '修改提示词', '换提示词']) {
      expect(screen.getByRole('button', { name: 名称 }), `缺按钮：${名称}`).toBeInTheDocument();
    }
  });

  it('悬停时给出说明文字（不是只靠猜图标）', async () => {
    render(<NarrativeImageCard image={建插图()} onRegenerate={() => {}} />);
    const 按钮 = screen.getByRole('button', { name: '修改提示词' });
    // Tooltip 用 pointerenter 打开，并且是 portal 到 body 的。
    fireEvent.pointerEnter(按钮.parentElement as HTMLElement);
    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });
    expect(screen.getByRole('tooltip').textContent).toContain('修改提示词');
    expect(screen.getByRole('tooltip').textContent).toContain('改完只重出这一张');
  });

  it('不再重复渲染同一件事的文字按钮', () => {
    render(
      <NarrativeImageCard
        image={建插图()}
        defaultExpanded
        onRegenerate={() => {}}
        onRerollPrompts={() => {}}
      />,
    );
    expect(screen.queryByText('原样重生')).toBeNull();
    expect(screen.queryByText('改提示词并重生')).toBeNull();
    expect(screen.queryByText('改提示词')).toBeNull();
  });

  it('「重新生成」按当前提示词重出；「换提示词」只重写提示词', () => {
    const onRegenerate = vi.fn();
    const onRerollPrompts = vi.fn();
    render(
      <NarrativeImageCard
        image={建插图()}
        onRegenerate={onRegenerate}
        onRerollPrompts={onRerollPrompts}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    expect(onRegenerate).toHaveBeenCalledWith(undefined);

    fireEvent.click(screen.getByRole('button', { name: '换提示词' }));
    expect(onRerollPrompts).toHaveBeenCalledTimes(1);
  });

  it('「修改提示词」展开编辑器，确认后只带编辑过的内容与尺寸重生', () => {
    const onRegenerate = vi.fn();
    render(<NarrativeImageCard image={建插图()} onRegenerate={onRegenerate} />);

    fireEvent.click(screen.getByRole('button', { name: '修改提示词' }));
    const 输入框 = screen.getByDisplayValue('1girl, white coat, 960x1280');
    fireEvent.change(输入框, { target: { value: '1girl, rain' } });
    // 尺寸从原提示词带出来，改掉后随重生一起提交。
    const 尺寸框 = screen.getByDisplayValue('960x1280');
    fireEvent.change(尺寸框, { target: { value: '1024x1024' } });

    fireEvent.click(screen.getByRole('button', { name: '重新生成本张' }));
    expect(onRegenerate).toHaveBeenCalledWith({
      新提示词正文: '1girl, rain',
      覆盖尺寸: { 宽度: 1024, 高度: 1024 },
    });
  });

  it('尺寸写错时给出提示，并在输入为空时提供「清除尺寸」', () => {
    render(<NarrativeImageCard image={建插图()} onRegenerate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '修改提示词' }));
    fireEvent.change(screen.getByDisplayValue('960x1280'), { target: { value: '宽1024' } });
    expect(screen.getByText(/尺寸格式应为/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除尺寸' }));
    expect(screen.queryByText(/尺寸格式应为/)).toBeNull();
  });

  it('点「查看大图」打开灯箱（Esc 可关）', () => {
    render(<NarrativeImageCard image={建插图()} onRegenerate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '查看大图' }));
    const 灯箱 = screen.getByRole('dialog', { name: /查看图片/ });
    expect(灯箱).toBeInTheDocument();
    expect(screen.getByText('960x1280')).toBeInTheDocument();
    fireEvent.keyDown(globalThis.document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('没有可显示地址时不显示「查看大图」，但仍能重生', () => {
    render(
      <NarrativeImageCard
        image={建插图({ dataUrl: '', description: '' })}
        defaultExpanded
        onRegenerate={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: '查看大图' })).toBeNull();
    expect(screen.getByText(/没有可显示的地址/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument();
  });

  it('失败态也只在图标里给动作', () => {
    render(
      <NarrativeImageCard
        image={建插图({ status: 'failed', error: '工作流里没有 %prompt%' })}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.getByText(/生成失败/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument();
    expect(screen.queryByText('重新生成')).toBeNull();
  });

  it('正在生成时不出现任何操作按钮', () => {
    render(<NarrativeImageCard image={建插图({ status: 'generating' })} onRegenerate={() => {}} />);
    expect(screen.getByText(/正在生成/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
