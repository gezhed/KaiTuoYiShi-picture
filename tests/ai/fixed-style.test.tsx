// @vitest-environment jsdom
/**
 * 固定画风（跨预设的固定提示词）测试。
 *
 * 与「固定提示词预设」的区别：预设按作品切换，画风是**一直要**的，
 * 所以单独一层永远叠在预设外侧。这里锁定三件事：
 *   ① 启用时三段各拼在正确位置；
 *   ② 关闭时行为与「没有这一层」完全一致（不改变老用户出图结果）；
 *   ③ 导入能认下社区各种键名。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { 组装正面提示词, 组装负面提示词, type 插入桶 } from '@/services/ai/imageGen/promptRules';
import { FixedStylePanel, 归一化画风 } from '@/components/features/Settings/FixedStylePanel';
import { 创建默认固定画风设置 } from '@/models/genSystem';

const 空插入: 插入桶 = {
  前置前: '', 前置后: '', 后置前: '', 后置后: '', 最后置: '',
};

describe('固定画风的拼接位置', () => {
  it('前置在最前、后置在质量词之前', () => {
    const 结果 = 组装正面提示词('预设固定', '主体', '结尾', '质量', 空插入, {
      前置: '画风锚点',
      后置: '画风收尾',
    });
    expect(结果).toBe('画风锚点, 预设固定, 主体, 结尾, 画风收尾, 质量');
  });

  it('插入桶仍插在预设前后的正确位置，不被画风挤走', () => {
    const 结果 = 组装正面提示词('预设固定', '主体', '结尾', '质量', {
      ...空插入,
      前置前: 'AA',
      前置后: 'BB',
      后置后: 'CC',
      最后置: 'DD',
    }, { 前置: '画风前', 后置: '画风后' });
    expect(结果).toBe('画风前, AA, 预设固定, BB, 主体, 结尾, CC, 画风后, 质量, DD');
  });

  it('不传固定画风时结果与加这一层之前完全一致', () => {
    const 无画风 = 组装正面提示词('预设固定', '主体', '结尾', '质量', 空插入);
    expect(无画风).toBe('预设固定, 主体, 结尾, 质量');
  });

  it('画风前后为空串时不产生多余逗号', () => {
    const 结果 = 组装正面提示词('预设固定', '主体', '', '', 空插入, { 前置: '', 后置: '' });
    expect(结果).toBe('预设固定, 主体');
  });

  it('画风里带中文注释会被剥离（与其它片段一致）', () => {
    const 结果 = 组装正面提示词('', '主体', '', '', 空插入, { 前置: 'style（这是说明）', 后置: 'end（注释）' });
    expect(结果).not.toContain('说明');
    expect(结果).not.toContain('注释');
    expect(结果).toContain('style');
    expect(结果).toContain('end');
  });

  it('负面画风并入预设负面之后', () => {
    expect(组装负面提示词('预设负面', 'UCP', '画风负面')).toBe('UCP, 预设负面, 画风负面');
  });

  it('负面画风单独存在时也能用', () => {
    expect(组装负面提示词('', '', '画风负面')).toBe('画风负面');
  });

  it('nsfw 仍被提到最前（并入画风负面后不失效）', () => {
    expect(组装负面提示词('a, nsfw', 'c', 'lowres')).toBe('nsfw, c, a, lowres');
  });

  it('不传负面画风时行为不变', () => {
    expect(组装负面提示词('用户负面', 'UCP')).toBe('UCP, 用户负面');
  });
});

describe('归一化画风导入', () => {
  it('认中文三段键名', () => {
    expect(归一化画风({ 前置: 'A', 后置: 'B', 负面: 'C' })).toEqual({ 前置: 'A', 后置: 'B', 负面: 'C' });
  });

  it('认「固定前置提示词」这类全名', () => {
    expect(归一化画风({ 固定前置提示词: 'A', 固定后置提示词: 'B', 固定负面提示词: 'C' }))
      .toEqual({ 前置: 'A', 后置: 'B', 负面: 'C' });
  });

  it('认英文键名', () => {
    expect(归一化画风({ prefix: 'A', suffix: 'B', negative: 'C' }))
      .toEqual({ 前置: 'A', 后置: 'B', 负面: 'C' });
  });

  it('认导出信封（data 包裹）', () => {
    expect(归一化画风({ type: 'style', data: { 前置: 'A', 负面: 'C' } }))
      .toEqual({ 前置: 'A', 后置: '', 负面: 'C' });
  });

  it('只给一段也能用，其余补空串', () => {
    expect(归一化画风({ 前置: 'A' })).toEqual({ 前置: 'A', 后置: '', 负面: '' });
  });

  it('键名不同源时各取各的（不要求成套）', () => {
    expect(归一化画风({ prefix: 'A', 固定后置: 'B', uc: 'C' }))
      .toEqual({ 前置: 'A', 后置: 'B', 负面: 'C' });
  });

  it('空白串不算命中', () => {
    expect(归一化画风({ 前置: '   ', 后置: '\n' })).toBeNull();
  });

  it('认不出结构时返回 null，交给调用方报错', () => {
    expect(归一化画风({ 无关: 1 })).toBeNull();
    expect(归一化画风(null)).toBeNull();
    expect(归一化画风('字符串')).toBeNull();
    expect(归一化画风([1, 2])).toBeNull();
  });

  it('无限套信封会停下，不挂死', () => {
    let 深: unknown = { 前置: 'A' };
    for (let i = 0; i < 8; i += 1) 深 = { data: 深 };
    expect(() => 归一化画风(深)).not.toThrow();
  });
});

describe('FixedStylePanel', () => {
  const 建 = (补丁 = {}) => ({ ...创建默认固定画风设置(), ...补丁 });

  it('默认关闭，且给全三个输入框', () => {
    render(<FixedStylePanel 画风={建()} onChange={() => {}} />);
    expect(screen.getByText('启用固定画风')).toBeInTheDocument();
    expect(screen.getByText('固定前置提示词')).toBeInTheDocument();
    expect(screen.getByText('固定后置提示词')).toBeInTheDocument();
    expect(screen.getByText('固定负面提示词')).toBeInTheDocument();
  });

  it('编辑前置换行冒泡', () => {
    const onChange = vi.fn();
    render(<FixedStylePanel 画风={建()} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/masterpiece/), { target: { value: 'my style' } });
    expect((onChange.mock.calls[0][0] as { 前置: string }).前置).toBe('my style');
    // 其它段不受影响。
    expect((onChange.mock.calls[0][0] as { 后置: string }).后置).toBe('');
  });

  it('启用但三段都空时给出提示', () => {
    render(<FixedStylePanel 画风={建({ 启用: true })} onChange={() => {}} />);
    expect(screen.getByText(/三段都是空的/)).toBeInTheDocument();
  });

  it('填了内容后不再提示为空', () => {
    render(<FixedStylePanel 画风={建({ 启用: true, 前置: 'x' })} onChange={() => {}} />);
    expect(screen.queryByText(/三段都是空的/)).not.toBeInTheDocument();
  });

  it('清空三段会把内容清掉但不改启用状态', () => {
    const onChange = vi.fn();
    render(<FixedStylePanel 画风={建({ 启用: true, 前置: 'a', 后置: 'b', 负面: 'c' })} onChange={onChange} />);
    fireEvent.click(screen.getByText('清空三段'));
    const 下一项 = onChange.mock.calls[0][0] as { 前置: string; 后置: string; 负面: string; 启用: boolean };
    expect(下一项.前置).toBe('');
    expect(下一项.后置).toBe('');
    expect(下一项.负面).toBe('');
    expect(下一项.启用).toBe(true);
  });

  it('说明里标出已填段数', () => {
    render(<FixedStylePanel 画风={建({ 前置: 'a', 负面: 'c' })} onChange={() => {}} />);
    expect(screen.getByText(/当前已填 2 段/)).toBeInTheDocument();
  });
});
