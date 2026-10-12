// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CustomWorkspace } from '@/components/features/Zhiku/CustomWorkspace';
import { ZhikuExperience } from '@/components/features/Zhiku/ZhikuExperience';
import { 创建智库条目, 归一化智库系统 } from '@/models/zhiku';
import type { 智库系统 } from '@/models/zhiku';
import { 归一化剧情编织系统 } from '@/models/storyWeaving';

const builtinEntry = 创建智库条目({
  标题: '内置角色',
  分类: 'character',
  关联角色ID: '内置角色',
  关联形态ID: '常态',
  原文: '内置正文',
  builtin: true,
});

const customEntry = 创建智库条目({
  标题: '自制术语',
  分类: 'term',
  来源: '自整理',
  原文: '自制条目的正文内容。',
  关键词: ['自制'],
  注入内容: {
    类型: 'lore',
    核心定义: '定义。',
    关键事实: '事实。',
    叙事用途: '用途。',
    演绎边界: '边界。',
  },
});

const buildSystem = (): 智库系统 => 归一化智库系统({ 条目: [builtinEntry, customEntry] });

/**
 * 工作台条目行是 `<button class="zk-entry" role="listitem">`：
 * 显式 role 覆盖了 button，行上也没有 aria-label，所以只能按行内标题定位。
 */
const getWorkspaceRow = (title: string): HTMLElement => {
  const row = Array.from(document.querySelectorAll<HTMLElement>('button.zk-entry'))
    .find((candidate) => candidate.textContent?.includes(title));
  if (!row) throw new Error(`未找到工作台条目行：${title}`);
  return row;
};

type WorkspaceProps = Parameters<typeof CustomWorkspace>[0];

function renderWorkspace(overrides?: Partial<WorkspaceProps>) {
  const props: WorkspaceProps = {
    zhikuSystem: buildSystem(),
    onZhikuSystemChange: vi.fn(),
    onSaveZhikuSystem: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  render(<CustomWorkspace {...props} />);
  return props;
}

const savedSystemOf = (onSaveZhikuSystem: unknown): 智库系统 => {
  const calls = ((onSaveZhikuSystem as { mock: { calls: Array<[智库系统]> } }).mock).calls;
  return calls[calls.length - 1][0];
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CustomWorkspace 条目管理', () => {
  it('默认展示自制条目列表，选择后进入编辑器', () => {
    renderWorkspace();
    expect(getWorkspaceRow('自制术语')).toBeInTheDocument();
    fireEvent.click(getWorkspaceRow('自制术语'));
    expect(screen.getByLabelText('条目标题')).toHaveValue('自制术语');
  });

  it('编辑标题会持久化修改', async () => {
    const props = renderWorkspace();
    fireEvent.click(getWorkspaceRow('自制术语'));
    fireEvent.change(screen.getByLabelText('条目标题'), { target: { value: '改名后的自制条目' } });

    await waitFor(() => expect(props.onSaveZhikuSystem).toHaveBeenCalled());
    const saved = savedSystemOf(props.onSaveZhikuSystem);
    expect(saved.条目.find((entry) => entry.标题 === '改名后的自制条目')).toBeDefined();
    expect(saved.条目.some((entry) => entry.builtin)).toBe(true);
  });

  it('删除自制条目会持久化移除', async () => {
    const props = renderWorkspace();
    fireEvent.click(getWorkspaceRow('自制术语'));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(props.onSaveZhikuSystem).toHaveBeenCalled());
    const saved = savedSystemOf(props.onSaveZhikuSystem);
    expect(saved.条目.some((entry) => entry.标题 === '自制术语')).toBe(false);
    expect(saved.条目.some((entry) => entry.标题 === '内置角色')).toBe(true);
  });

  it('内置条目只写运行时解锁覆盖，不改资料字段', async () => {
    const props = renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: /^内置 1/ }));
    fireEvent.click(getWorkspaceRow('内置角色'));

    fireEvent.click(screen.getByRole('button', { name: '已解锁' }));
    await waitFor(() => expect(props.onSaveZhikuSystem).toHaveBeenCalled());

    const saved = savedSystemOf(props.onSaveZhikuSystem);
    const target = saved.条目.find((entry) => entry.标题 === '内置角色');
    if (!target) throw new Error('missing builtin entry');
    expect(target.运行时解锁状态).toBe('已解锁');
    expect(target.原文).toBe('内置正文');
  });

  it('删除与编辑入口不会出现在内置条目上', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: /^内置 1/ }));
    fireEvent.click(getWorkspaceRow('内置角色'));
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
    expect(screen.getByLabelText('条目标题')).toHaveAttribute('readonly');
  });
});

describe('home 与 ingame 入口行为一致', () => {
  const renderSurface = (surface: 'home' | 'ingame', onClose?: () => void) => render(
    <ZhikuExperience
      zhikuSystem={buildSystem()}
      storyWeavingSystem={归一化剧情编织系统(null)}
      onZhikuSystemChange={vi.fn()}
      onSaveZhikuSystem={vi.fn(() => Promise.resolve())}
      onClose={onClose}
      surface={surface}
    />,
  );

  it('两个 surface 都默认档案总览且不含自制节点，工作台 chip 可开关自制', async () => {
    for (const surface of ['home', 'ingame'] as const) {
      const { unmount } = renderSurface(surface);
      expect(screen.getByRole('heading', { name: '智库' })).toBeInTheDocument();
      expect(screen.queryByLabelText('条目编辑器')).toBeNull();
      expect(screen.queryByRole('button', { name: /^展开自制/ })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: '切换自制工作台' }));
      expect(screen.getByLabelText('条目编辑器')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: '切换自制工作台' }));
      // 工作台是滑走的，等它退场完再断言总览。
      await waitFor(() => expect(screen.queryByLabelText('条目编辑器')).toBeNull(), { timeout: 3000 });
      expect(screen.getByRole('heading', { name: '智库' })).toBeInTheDocument();
      unmount();
    }
  });

  it('Escape 链统一：自制先回档案总览，再按才关闭', async () => {
    const onClose = vi.fn();
    renderSurface('home', onClose);

    fireEvent.click(screen.getByRole('button', { name: '切换自制工作台' }));
    expect(screen.getByLabelText('条目编辑器')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText('条目编辑器')).toBeNull(), { timeout: 3000 });
    expect(screen.getByRole('heading', { name: '智库' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('CustomWorkspace 移动端单屏栈', () => {
  it('紧凑屏幕下：在列表与详情间单屏切换，顶部提供返回按钮', async () => {
    renderWorkspace({ compact: true });

    // 默认展示列表
    expect(getWorkspaceRow('自制术语')).toBeInTheDocument();
    expect(screen.queryByLabelText('条目标题')).toBeNull();

    // 点击自制条目 -> 进入详情
    fireEvent.click(getWorkspaceRow('自制术语'));
    expect(screen.getByLabelText('条目标题')).toHaveValue('自制术语');
    expect(screen.getByRole('button', { name: '返回条目列表' })).toBeInTheDocument();

    // 点击返回条目列表 -> 回到列表
    fireEvent.click(screen.getByRole('button', { name: '返回条目列表' }));
    expect(getWorkspaceRow('自制术语')).toBeInTheDocument();
    expect(screen.queryByLabelText('条目标题')).toBeNull();

    // 点击新建 -> 进入草稿编辑
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    expect(screen.getByRole('button', { name: '写入档案' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回条目列表' })).toBeInTheDocument();

    // 点击返回条目列表 -> 回到列表
    fireEvent.click(screen.getByRole('button', { name: '返回条目列表' }));
    expect(getWorkspaceRow('自制术语')).toBeInTheDocument();
  });
});
