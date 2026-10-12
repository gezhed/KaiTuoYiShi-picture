// @vitest-environment jsdom
/**
 * 队列把手的「正在生成」提示。
 *
 * 用户反馈：正文生成图片时没有提示，可能会多次点击。
 * 聊天区里手动生图有卡片按钮可看，但**自动配图**没有入口可选、也不写卡片，
 * 整段跑完才写回消息——期间唯一的常驻线索就是这个侧边把手。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VariableDrawer } from '@/components/features/Variable/VariableDrawer';
import type { 队列任务记录 } from '@/models/queueTask';

function 造任务(覆盖: Partial<队列任务记录> & { id: 队列任务记录['id'] }): 队列任务记录 {
  return {
    title: '任务',
    turn: 1,
    timestamp: Date.now(),
    status: 'pending',
    ...覆盖,
  };
}

function 渲染(tasks: 队列任务记录[], pending = false) {
  return render(<VariableDrawer batches={[]} tasks={tasks} pending={pending} />);
}

describe('队列把手的状态文案', () => {
  it('空闲时显示「处理队列」', () => {
    渲染([]);
    expect(screen.getByTitle('展开队列').textContent).toContain('处理队列');
  });

  it('生图任务 pending 时显示「正在生成插图」（自动配图也能看见）', () => {
    渲染([造任务({ id: 'narrative_image_generate', status: 'pending', 阶段: '出图中' })]);
    const 把手 = screen.getByTitle('展开队列');
    expect(把手.textContent).toContain('正在生成插图');
    // 有脉冲点：不打开队列也知道在跑。
    expect(把手.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('解析提示词阶段同样算进行中', () => {
    渲染([造任务({ id: 'narrative_image_parse', status: 'pending', 阶段: '等提示词' })]);
    expect(screen.getByTitle('展开队列').textContent).toContain('正在生成插图');
  });

  it('生图结束后回到「处理队列」', () => {
    渲染([造任务({ id: 'narrative_image_generate', status: 'success' })]);
    expect(screen.getByTitle('展开队列').textContent).toContain('处理队列');
  });

  it('变量与生图同时进行时，变量优先（这是变量抽屉）', () => {
    渲染([造任务({ id: 'narrative_image_generate' })], true);
    expect(screen.getByTitle('展开队列').textContent).toContain('变量正在处理');
  });
});
