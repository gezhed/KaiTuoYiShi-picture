// @vitest-environment jsdom
/**
 * 图片查看器（灯箱）测试。
 *
 * 起因是用户反馈「成品图库没法放大，只能看到不完整的部分内容」——
 * 缩略图用固定高度 + object-cover，竖版图必然被裁。
 * 这里锁定查看器的关键行为：完整显示、键盘关闭、左右切换、显示生成参数。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageLightbox, type 查看图片项 } from '@/components/features/ImageGeneration/ImageLightbox';

const 项: 查看图片项 = {
  id: 'a1',
  src: 'data:image/png;base64,AAAA',
  title: '她站在窗前',
  prompt: '1girl, window, rain',
  negativePrompt: 'lowres',
  dimensions: '832x1216',
  model: 'v1-5-pruned',
  note: '种子 42',
};

describe('ImageLightbox', () => {
  it('没有选中项时不渲染任何东西', () => {
    const { container } = render(<ImageLightbox 项={null} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('按原始比例完整显示，不用 object-cover 裁切', () => {
    render(<ImageLightbox 项={项} onClose={() => {}} />);
    const 图 = screen.getByRole('img', { name: 项.title });
    // 关键：contain 而不是 cover，否则竖版图会被裁掉两侧。
    expect(图.className).toContain('object-contain');
    expect(图.className).not.toContain('object-cover');
  });

  it('显示生成参数，便于判断要不要重出', () => {
    render(<ImageLightbox 项={项} onClose={() => {}} />);
    expect(screen.getByText(项.title)).toBeInTheDocument();
    expect(screen.getByText('832x1216')).toBeInTheDocument();
    expect(screen.getByText('v1-5-pruned')).toBeInTheDocument();
    expect(screen.getByText('1girl, window, rain')).toBeInTheDocument();
    expect(screen.getByText('lowres')).toBeInTheDocument();
  });

  it('Esc 关闭', () => {
    const onClose = vi.fn();
    render(<ImageLightbox 项={项} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击空白处关闭，但点图片本身不关', () => {
    const onClose = vi.fn();
    render(<ImageLightbox 项={项} onClose={onClose} />);
    fireEvent.click(screen.getByRole('img', { name: 项.title }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('给上下张回调时才显示切换按钮并响应方向键', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<ImageLightbox 项={项} onClose={() => {}} onPrev={onPrev} onNext={onNext} />);

    fireEvent.click(screen.getByRole('button', { name: '上一张' }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '下一张' }));
    expect(onNext).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(onPrev).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onNext).toHaveBeenCalledTimes(2);
  });

  it('没有上下张时不显示切换按钮，也不响应方向键', () => {
    const onClose = vi.fn();
    render(<ImageLightbox 项={项} onClose={onClose} onPrev={null} onNext={null} />);
    expect(screen.queryByRole('button', { name: '上一张' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下一张' })).not.toBeInTheDocument();
    // 方向键在没有切换目标时不该误触发关闭。
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('提供下载入口', () => {
    render(<ImageLightbox 项={项} onClose={() => {}} />);
    const 链接 = screen.getByRole('link', { name: '下载' });
    expect(链接).toHaveAttribute('download');
    expect(链接).toHaveAttribute('href', 项.src);
  });

  it('缺少可选参数时不渲染对应行，也不崩', () => {
    render(<ImageLightbox 项={{ id: 'x', src: 'data:image/png;base64,AA', title: '光秃秃' }} onClose={() => {}} />);
    expect(screen.getByText('光秃秃')).toBeInTheDocument();
    expect(screen.queryByText('正向：')).not.toBeInTheDocument();
  });
});
