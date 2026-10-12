// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { InjectionContentFields } from '@/components/features/Zhiku/injectionContent';
import { CustomWorkspace } from '@/components/features/Zhiku/CustomWorkspace';
import type { 智库系统 } from '@/models/zhiku';
import { 创建智库条目, 归一化智库系统 } from '@/models/zhiku';

const LORE_FIELDS = ['核心定义', '关键事实', '叙事用途', '演绎边界'] as const;
const CHARACTER_FIELDS = [
  '核心身份与阵营',
  '独立人格与行为',
  '外貌锚点',
  '说话方式',
  '台词语料',
  '当前形态与能力边界',
  '精简角色故事',
  '演绎红线',
] as const;

describe('InjectionContentFields', () => {
  it('设定分类渲染 4 个注入字段并向外传播更新', () => {
    const onChange = vi.fn();
    const { unmount } = render(
      <InjectionContentFields
        category="term"
        editable
        onChange={onChange}
      />,
    );
    for (const field of LORE_FIELDS) {
      expect(screen.getByLabelText(field)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText('人物结构')).toBeNull();

    fireEvent.change(screen.getByLabelText('核心定义'), { target: { value: '新的核心定义内容' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ 类型: 'lore', 核心定义: '新的核心定义内容' }),
    );
    unmount();
  });

  it('人物分类渲染 8 个注入字段', () => {
    const onChange = vi.fn();
    const { unmount } = render(
      <InjectionContentFields
        category="character"
        editable
        onChange={onChange}
      />,
    );
    for (const field of CHARACTER_FIELDS) {
      expect(screen.getByLabelText(field)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText('核心定义')).toBeNull();
    const firstField = CHARACTER_FIELDS[0];
    fireEvent.change(screen.getByLabelText(firstField), { target: { value: '角色设定草稿' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ [firstField]: '角色设定草稿' }));
    unmount();
  });

  it('剧情分类不渲染注入字段', () => {
    const { unmount } = render(
      <InjectionContentFields
        category="story"
        editable
        onChange={vi.fn()}
      />,
    );
    for (const field of LORE_FIELDS) {
      expect(screen.queryByLabelText(field)).toBeNull();
    }
    unmount();
  });
});

describe('CustomWorkspace 自制条目保存硬门禁', () => {
  const bundledEntry = 创建智库条目({
    标题: '内置术语',
    分类: 'term',
    原文: '内置正文',
    builtin: true,
  });

  /**
   * 右侧编辑器面板和左侧新建面板用的是同一批字段标签（标题/分类/原文/注入字段），
   * 所以新建相关操作一律限定在 `data-side="composer"` 的新建面板里。
   */
  const composerOf = (): HTMLElement => {
    const node = document.querySelector('[data-side="composer"]');
    if (!(node instanceof HTMLElement)) throw new Error('missing composer panel');
    return node;
  };

  const renderWorkspace = () => {
    const onZhikuSystemChange = vi.fn();
    const onSaveZhikuSystem = vi.fn(() => Promise.resolve());
    render(
      <CustomWorkspace
        zhikuSystem={归一化智库系统({ 条目: [bundledEntry] })}
        onZhikuSystemChange={onZhikuSystemChange}
        onSaveZhikuSystem={onSaveZhikuSystem}
      />,
    );
    return { onZhikuSystemChange, onSaveZhikuSystem };
  };

  const openComposer = async () => {
    const write = await screen.findByRole('button', { name: '写入档案' });
    return write as unknown as HTMLButtonElement;
  };

  it('注入内容为空的自制条目必须显示错误并且不进入保存', async () => {
    const { onZhikuSystemChange, onSaveZhikuSystem } = renderWorkspace();
    const write = await openComposer();
    const composer = within(composerOf());

    fireEvent.change(composer.getByLabelText('标题'), { target: { value: '自制术语条目' } });
    fireEvent.change(composer.getByLabelText('原文'), { target: { value: '自制条目的正文内容足够长。' } });
    fireEvent.change(composer.getByLabelText('分类'), { target: { value: 'term' } });
    if (!write.disabled) {
      fireEvent.click(write);
    }
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onSaveZhikuSystem).not.toHaveBeenCalled();
    expect(onZhikuSystemChange).not.toHaveBeenCalled();
    expect(composer.getByLabelText('标题')).toBeInTheDocument();
  });

  it('注入内容齐全的自制条目可以保存并持久化', async () => {
    const { onZhikuSystemChange, onSaveZhikuSystem } = renderWorkspace();
    await openComposer();
    const composer = within(composerOf());

    fireEvent.change(composer.getByLabelText('标题'), { target: { value: '自制术语条目' } });
    fireEvent.change(composer.getByLabelText('分类'), { target: { value: 'term' } });
    for (const [field, value] of [
      ['核心定义', '核心定义内容。'],
      ['关键事实', '关键事实内容。'],
      ['叙事用途', '叙事用途内容。'],
      ['演绎边界', '演绎边界内容。'],
    ] as const) {
      fireEvent.change(composer.getByLabelText(field), { target: { value } });
    }
    fireEvent.change(composer.getByLabelText('原文'), { target: { value: '自制条目的正文内容足够长。' } });
    fireEvent.click(screen.getByRole('button', { name: '写入档案' }));

    await waitFor(() => expect(onSaveZhikuSystem).toHaveBeenCalledTimes(1));
    expect(onZhikuSystemChange).toHaveBeenCalled();
    const saved = (onSaveZhikuSystem.mock as unknown as { calls: Array<[智库系统]> }).calls[0]?.[0];
    const created = saved.条目.find((entry) => entry.标题 === '自制术语条目');
    expect(created).toBeDefined();
    expect(created?.builtin).toBe(false);
    expect(created?.原文).toBe('自制条目的正文内容足够长。');
    expect(created?.注入内容).toEqual({
      类型: 'lore',
      核心定义: '核心定义内容。',
      关键事实: '关键事实内容。',
      叙事用途: '叙事用途内容。',
      演绎边界: '演绎边界内容。',
    });
  });
});
