// @vitest-environment jsdom
/**
 * 共用开关（开关行）的显示契约。
 *
 * 起因（用户 bug 1）：文生图与视觉设置的 galgame 段里，开关长得和别处不一样——
 * 轨道是直角、没有斜边描边，旋钮是一块米色实心方块并且跑出轨道右侧。
 * 根因是共用件与其余设置页里手写的 11 份开关实现各写各的。
 *
 * 这里把「必须和那 11 处一致」的几条硬性特征钉住：
 *   · 轨道有切角（clip-path）
 *   · 旋钮用 left 定位（不是 transform：按钮默认 text-align:center 会让静态位置居中）
 *   · 旋钮是深色（bg-primary），不是 text-primary 的米色块
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { 开关行 } from '@/components/features/Settings/settingsPrimitives';

function 取开关按钮() {
  const 按钮 = screen.getByRole('button');
  const 旋钮 = 按钮.firstElementChild as HTMLElement;
  return { 按钮, 旋钮, 按钮样式: 按钮.getAttribute('style') ?? '', 旋钮样式: 旋钮?.getAttribute('style') ?? '' };
}

describe('开关行：显示样式与其余设置页一致', () => {
  it('轨道带切角', () => {
    render(<开关行 label="启用" checked onChange={() => {}} />);
    const { 按钮样式 } = 取开关按钮();
    expect(按钮样式).toContain('clip-path');
    expect(按钮样式).not.toContain('clip-path: none');
  });

  it('打开时旋钮用 left 定位到右端，不是 translateX', () => {
    render(<开关行 label="启用" checked onChange={() => {}} />);
    const { 旋钮样式 } = 取开关按钮();
    expect(旋钮样式).toContain('left: calc(100% - 1.375rem)');
    // 曾经的写法：transform + 居中静态位置 → 旋钮被推到轨道外面。
    expect(旋钮样式).not.toContain('translateX');
    expect(旋钮样式).toContain('clip-path');
  });

  it('关闭时旋钮回到左端，且换成灰色（不是米色实心块）', () => {
    render(<开关行 label="启用" checked={false} onChange={() => {}} />);
    const { 旋钮样式 } = 取开关按钮();
    expect(旋钮样式).toContain('left: 0.125rem');
    expect(旋钮样式).toContain('var(--tj-text-secondary)');
    expect(旋钮样式).not.toContain('var(--tj-text-primary)');
  });

  it('打开时旋钮是深色底（与轨道渐变形成对比）', () => {
    render(<开关行 label="启用" checked onChange={() => {}} />);
    const { 旋钮样式 } = 取开关按钮();
    expect(旋钮样式).toContain('var(--tj-bg-primary)');
  });

  it('点击回调收到取反后的值；禁用时不回调', () => {
    const onChange = vi.fn();
    const { rerender } = render(<开关行 label="启用" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenCalledWith(true);

    onChange.mockClear();
    rerender(<开关行 label="启用" checked={false} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('aria-pressed 反映当前状态（无障碍与自动化都依赖它）', () => {
    const { rerender } = render(<开关行 label="启用" checked onChange={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
    rerender(<开关行 label="启用" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');
  });
});
