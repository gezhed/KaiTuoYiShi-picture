// @vitest-environment jsdom
/**
 * LLM面板测试。
 *
 * 起因：用户点「生成本回合插图」报「LLM未配置：请启用LLM并填写可用的模型接口」，
 * 但**界面里根本没有LLM** —— 数据模型与读写路径都在，只缺界面。
 * 这里锁定修复后的关键行为：能配置、能导入、导入后结构完整。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LlmSettingsPanel, 归一化导入 } from '@/components/features/Settings/LlmSettingsPanel';
import { 创建默认LLM设置 } from '@/models/genSystem';
import type { LLM设置 } from '@/models/genSystem';

function 建设置(补丁: Partial<LLM设置> = {}): LLM设置 {
  return { ...创建默认LLM设置(), ...补丁 };
}

describe('归一化导入', () => {
  it('认单个预设对象（含 entries）', () => {
    const 结果 = 归一化导入({ entries: [{ role: 'system', content: '把正文转成提示词' }] }, '我的预设.json');
    expect(Object.keys(结果)).toEqual(['我的预设']);
    expect(结果.我的预设.entries).toHaveLength(1);
    expect(结果.我的预设.entries[0].content).toBe('把正文转成提示词');
  });

  it('认裸条目数组', () => {
    const 结果 = 归一化导入([{ role: 'system', content: 'A' }, { role: 'user', content: 'B' }], '预设.json');
    expect(Object.values(结果)[0].entries).toHaveLength(2);
  });

  it('认整份预设表（值是 { entries }）', () => {
    const 结果 = 归一化导入({
      预设甲: { entries: [{ role: 'system', content: 'A' }] },
      预设乙: { entries: [{ role: 'user', content: 'B' }] },
    });
    expect(Object.keys(结果).sort()).toEqual(['预设乙', '预设甲']);
  });

  it('认整份预设表（值是裸数组）', () => {
    const 结果 = 归一化导入({ 只有数组: [{ role: 'system', content: 'A' }] });
    expect(Object.keys(结果)).toEqual(['只有数组']);
  });

  it('补齐缺省字段：id / name / 触发方式 / 触发词 / 与触发', () => {
    const 结果 = 归一化导入({ entries: [{ content: '内容' }] }, 'f.json');
    const 条目 = Object.values(结果)[0].entries[0];
    expect(条目.id).toBeTruthy();
    expect(条目.name).toBe('条目 1');
    expect(条目.role).toBe('system');
    expect(条目.enabled).toBe(true);
    expect(条目.触发方式).toBe('always');
    expect(条目.触发词).toEqual([]);
    expect(条目.与触发).toBe(false);
  });

  it('丢弃没有内容的条目（避免导进一堆空条目）', () => {
    const 结果 = 归一化导入({ entries: [{ role: 'system', content: '   ' }, { role: 'system', content: '有内容' }] });
    expect(Object.values(结果)[0].entries).toHaveLength(1);
  });

  it('非法 role 退回 system', () => {
    const 结果 = 归一化导入({ entries: [{ role: '乱写', content: 'X' }] });
    expect(Object.values(结果)[0].entries[0].role).toBe('system');
  });

  it('enabled:false 被保留（停用的条目不该被悄悄启用）', () => {
    const 结果 = 归一化导入({ entries: [{ content: 'X', enabled: false }] });
    expect(Object.values(结果)[0].entries[0].enabled).toBe(false);
  });

  it('认不出结构时返回空对象，不抛错', () => {
    expect(归一化导入(null)).toEqual({});
    expect(归一化导入('字符串')).toEqual({});
    expect(归一化导入({ 无关字段: 1 })).toEqual({});
    expect(归一化导入({ entries: 'not-an-array' })).toEqual({});
  });
});

describe('LlmSettingsPanel', () => {
  it('默认（未启用 + 空预设）时把两个阻塞点都指出来', () => {
    render(<LlmSettingsPanel LLM={建设置()} onChange={() => {}} />);
    // 空预设 → 明确说会报什么错。
    expect(screen.getByText(/没有任何启用的条目/)).toBeInTheDocument();
  });

  it('启用开关会往上冒泡', () => {
    const onChange = vi.fn();
    const { container } = render(<LlmSettingsPanel LLM={建设置()} onChange={onChange} />);
    // 开关行只在按钮上挂 onClick，点标签文字没用——必须点按钮本身。
    const 开关 = container.querySelector('button[aria-pressed]');
    expect(开关).not.toBeNull();
    fireEvent.click(开关 as HTMLButtonElement);
    expect(onChange).toHaveBeenCalled();
    expect((onChange.mock.calls[0][0] as LLM设置).启用).toBe(true);
  });

  it('启用但没有模型且主 API 也没模型时报出「未配置」的真正原因', () => {
    render(<LlmSettingsPanel LLM={建设置({ 启用: true })} onChange={() => {}} />);
    expect(screen.getByText(/没有可用的模型/)).toBeInTheDocument();
  });

  it('填了模型后不再报缺模型', () => {
    render(
      <LlmSettingsPanel
        LLM={建设置({ 启用: true, API: { provider: '', baseUrl: '', apiKey: '', model: 'gpt-4o-mini' } })}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText(/没有可用的模型/)).not.toBeInTheDocument();
  });

  it('主 API 有模型时，留空即回退，不报缺模型', () => {
    render(
      <LlmSettingsPanel
        LLM={建设置({ 启用: true })}
        onChange={() => {}}
        主配置模型="主模型"
        主配置名="默认配置"
      />,
    );
    expect(screen.queryByText(/没有可用的模型/)).not.toBeInTheDocument();
    expect(screen.getByText(/主 API 配置：默认配置/)).toBeInTheDocument();
  });

  it('预设里有启用条目时给出可用提示', () => {
    const LLM = 建设置({
      API: { provider: '', baseUrl: '', apiKey: '', model: 'm' },
      预设列表: {
        默认: {
          entries: [{
            id: 'e1', name: '格式说明', role: 'system', content: '把正文转成插图提示词',
            enabled: true, 触发方式: 'always', 触发词: [], 与触发: false,
          }],
          createdAt: 0,
          updatedAt: 0,
        },
      },
    });
    render(<LlmSettingsPanel LLM={LLM} onChange={() => {}} />);
    expect(screen.getByText(/当前预设启用 1 条/)).toBeInTheDocument();
    expect(screen.getByText('格式说明')).toBeInTheDocument();
  });

  it('可以新建空预设并切换过去', () => {
    const onChange = vi.fn();
    render(<LlmSettingsPanel LLM={建设置()} onChange={onChange} />);
    fireEvent.click(screen.getByText('新建空预设'));
    const 新设置 = onChange.mock.calls[0][0] as LLM设置;
    expect(Object.keys(新设置.预设列表).length).toBe(2);
    expect(新设置.当前预设).toBe('预设2');
  });

  it('点条目可停用', () => {
    const onChange = vi.fn();
    const LLM = 建设置({
      预设列表: {
        默认: {
          entries: [{
            id: 'e1', name: '格式说明', role: 'system', content: 'x',
            enabled: true, 触发方式: 'always', 触发词: [], 与触发: false,
          }],
          createdAt: 0, updatedAt: 0,
        },
      },
    });
    render(<LlmSettingsPanel LLM={LLM} onChange={onChange} />);
    fireEvent.click(screen.getByText('格式说明'));
    const 新设置 = onChange.mock.calls[0][0] as LLM设置;
    expect(新设置.预设列表.默认.entries[0].enabled).toBe(false);
  });
});

describe('条目编辑', () => {
  function 建可编辑设置() {
    return 建设置({
      预设列表: {
        默认: {
          entries: [{
            id: 'e1', name: '格式说明', role: 'system', content: '原始内容',
            enabled: true, 触发方式: 'always', 触发词: [], 与触发: false,
          }],
          createdAt: 0, updatedAt: 0,
        },
      },
    });
  }

  it('点「编辑」出现可改的输入框，且带出原内容', () => {
    render(<LlmSettingsPanel LLM={建可编辑设置()} onChange={() => {}} />);
    expect(screen.queryByDisplayValue('原始内容')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('编辑'));
    expect(screen.getByDisplayValue('原始内容')).toBeInTheDocument();
  });

  it('保存后把新内容写回设置，且不动其它字段', () => {
    const onChange = vi.fn();
    render(<LlmSettingsPanel LLM={建可编辑设置()} onChange={onChange} />);
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.change(screen.getByDisplayValue('原始内容'), { target: { value: '改过的内容' } });
    fireEvent.click(screen.getByText('保存'));

    const 新设置 = onChange.mock.calls[0][0] as LLM设置;
    expect(新设置.预设列表.默认.entries[0].content).toBe('改过的内容');
    expect(新设置.预设列表.默认.entries[0].name).toBe('格式说明');
    expect(新设置.预设列表.默认.entries[0].role).toBe('system');
  });

  it('放弃修改不写回设置', () => {
    const onChange = vi.fn();
    render(<LlmSettingsPanel LLM={建可编辑设置()} onChange={onChange} />);
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.change(screen.getByDisplayValue('原始内容'), { target: { value: '改了但不要' } });
    fireEvent.click(screen.getByText('放弃修改'));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('改了但不要')).not.toBeInTheDocument();
  });

  it('「取消」回到只读展示', () => {
    render(<LlmSettingsPanel LLM={建可编辑设置()} onChange={() => {}} />);
    fireEvent.click(screen.getByText('编辑'));
    expect(screen.getByDisplayValue('原始内容')).toBeInTheDocument();
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByDisplayValue('原始内容')).not.toBeInTheDocument();
  });

  it('编辑态下仍可启停，且不顺手改掉内容', () => {
    const onChange = vi.fn();
    render(<LlmSettingsPanel LLM={建可编辑设置()} onChange={onChange} />);
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByText('格式说明'));
    const 新设置 = onChange.mock.calls[0][0] as LLM设置;
    expect(新设置.预设列表.默认.entries[0].enabled).toBe(false);
    expect(新设置.预设列表.默认.entries[0].content).toBe('原始内容');
  });

  it('编辑态下提示可用的占位符', () => {
    render(<LlmSettingsPanel LLM={建可编辑设置()} onChange={() => {}} />);
    fireEvent.click(screen.getByText('编辑'));
    expect(screen.getByText(/可用占位符/)).toBeInTheDocument();
    expect(screen.getByText(/\{\{正文\}\}/)).toBeInTheDocument();
  });
});

describe('条目列表高度受限', () => {
  function 建大量条目设置(条数: number) {
    return 建设置({
      预设列表: {
        默认: {
          entries: Array.from({ length: 条数 }, (_, i) => ({
            id: `e${i}`,
            name: `条目 ${i + 1}`,
            role: 'user' as const,
            content: `内容 ${i + 1}`,
            enabled: true,
            触发方式: 'always' as const,
            触发词: [],
            与触发: false,
          })),
          createdAt: 0,
          updatedAt: 0,
        },
      },
    });
  }

  it('条目多时列表被限高并可内部滚动（社区预设有上百条）', () => {
    const { container } = render(<LlmSettingsPanel LLM={建大量条目设置(184)} onChange={() => {}} />);
    const 滚动区 = container.querySelector('.overflow-y-auto');
    expect(滚动区, '条目列表需要一个可滚动容器').not.toBeNull();
    // 限高是关键：不限制会把设置页撑到几万像素，翻页找不到按钮。
    expect(滚动区?.className).toContain('max-h-96');
    expect(滚动区?.className).toContain('overflow-y-auto');
  });

  it('条目全部渲染在滚动区内，不被截断成只看前几条', () => {
    render(<LlmSettingsPanel LLM={建大量条目设置(184)} onChange={() => {}} />);
    // 抽样确认首尾条目都在 DOM 里（用滚动而不是丢弃）。
    expect(screen.getByText('条目 1')).toBeInTheDocument();
    expect(screen.getByText('条目 184')).toBeInTheDocument();
  });

  it('条目少时同样用这个容器，行为一致', () => {
    const { container } = render(<LlmSettingsPanel LLM={建大量条目设置(2)} onChange={() => {}} />);
    expect(container.querySelector('.overflow-y-auto')?.className).toContain('max-h-96');
  });
});
