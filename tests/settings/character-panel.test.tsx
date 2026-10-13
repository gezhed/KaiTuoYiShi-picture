// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CharacterSettingsPanel } from '@/components/features/Settings/CharacterSettingsPanel';
import { 处理角色提示词 } from '@/services/ai/imageGen/characterPrompt';
import { 创建默认文生图系统设置, 人物生成预设消息 } from '@/models/genSystem';
import { 导出角色AI预设文本 } from '@/services/ai/imageGen/characterAIPreset';
import type { 角色卡, 文生图系统设置 } from '@/models/genSystem';
import type { 生成角色特征结果 } from '@/services/ai/imageGen/characterFeature';

function 建角色(覆盖: Partial<角色卡> = {}): 角色卡 {
  return {
    id: 'char_1',
    enabled: true,
    aliases: [],
    outfits: [],
    selectedOutfitId: '',
    photoMedia: [],
    audioMedia: [],
    selectedPhotoId: '',
    selectedAudioId: '',
    photoPrompt: '',
    sendPhoto: false,
    位置: null,
    createdAt: 0,
    updatedAt: 0,
    nameCN: '流萤',
    nameEN: 'Firefly',
    characterTraits: '',
    facialFeatures: '',
    facialFeaturesBack: '',
    upperBodySFW: '',
    upperBodySFWBack: '',
    fullBodySFW: '',
    fullBodySFWBack: '',
    upperBodyNSFW: '',
    upperBodyNSFWBack: '',
    fullBodyNSFW: '',
    fullBodyNSFWBack: '',
    negative: '',
    ...覆盖,
  };
}

function 建系统(): 文生图系统设置 {
  const 系统 = 创建默认文生图系统设置();
  系统.角色卡.char_1 = 建角色();
  系统.角色启用预设列表[系统.当前启用预设] = {
    条目: [{ 角色Id: 'char_1', 图片媒体Id: '', 音频媒体Id: '', 图片描述: '', 音频描述: '' }],
    绑定角色卡: '',
    绑定聊天: '',
  };
  系统.角色启用列表 = ['char_1'];
  return 系统;
}

/** 受控壳：把 onPatch 落到 state，测试里就能断言「写回角色卡」真的发生了。 */
function TestShell({
  初始,
  请求生成,
  on系统,
  LoRA列表,
  on拉取LoRA,
  生成预览图,
}: {
  初始: 文生图系统设置;
  请求生成?: (参数: { 系统: 文生图系统设置; 要求: string; 角色?: 角色卡 }) => Promise<生成角色特征结果>;
  on系统?: (系统: 文生图系统设置) => void;
  LoRA列表?: string[];
  on拉取LoRA?: () => Promise<string[]>;
  生成预览图?: (提示词: string) => Promise<{ 数据地址: string; 宽度: number; 高度: number }>;
}) {
  const [系统, set系统] = useState(初始);
  return (
    <CharacterSettingsPanel
      settings={系统}
      onPatch={(部分) => set系统((旧) => {
        const 下一 = { ...旧, ...部分 };
        on系统?.(下一);
        return 下一;
      })}
      请求生成={请求生成}
      LoRA列表={LoRA列表}
      on拉取LoRA={on拉取LoRA}
      生成预览图={生成预览图}
    />
  );
}

describe('角色管理面板', () => {
  it('五个子页签都在，默认落在角色卡', () => {
    render(<TestShell 初始={建系统()} />);
    for (const 名称 of ['角色卡', '启用列表', '通用列表', '注入模板', '生成']) {
      expect(screen.getByRole('button', { name: new RegExp(名称) })).toBeTruthy();
    }
    expect(screen.getByText('导出全部')).toBeTruthy();
    expect(screen.getByText('导入角色包')).toBeTruthy();
  });

  it('启用列表页签能渲染出 {{角色启用列表}} 的触发测试结果', async () => {
    render(<TestShell 初始={建系统()} />);
    fireEvent.click(screen.getByRole('button', { name: /启用列表/ }));
    const 输入 = await screen.findByPlaceholderText(/贴一段正文/);
    fireEvent.change(输入, { target: { value: '流萤抬起头看了你一眼' } });
    await waitFor(() => {
      expect(screen.getByText(/命中 1 个角色/)).toBeTruthy();
    });
    expect(screen.getByText(/中文名称：流萤/)).toBeTruthy();
  });

  it('一键生成：生成 → 预览 → 写入角色卡', async () => {
    // 用对象持有捕获值：直接 `let 最终系统 = null` 会被 TS 的窄化判定成永远是 null。
    const 捕获: { 系统?: 文生图系统设置 } = {};
    const 请求生成 = vi.fn(async (): Promise<生成角色特征结果> => ({
      字段: { characterTraits: 'silver hair（银色长发）', facialFeatures: 'green eyes（绿色眼睛）' },
      服装: [],
      未识别: [],
      原始回复: '<人物>\n中文名称:流萤\n</人物>',
      重试次数: 0,
    }));

    render(<TestShell 初始={建系统()} 请求生成={请求生成} on系统={(系统) => { 捕获.系统 = 系统; }} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));

    const 要求框 = await screen.findByPlaceholderText(/流萤，星核猎手少女/);
    fireEvent.change(要求框, { target: { value: '流萤，星核猎手少女' } });
    fireEvent.click(screen.getByText('一键生成'));

    await waitFor(() => expect(请求生成).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/silver hair（银色长发）/)).toBeTruthy());
    // 角色卡上原本没有这两个字段，预览里旧值一栏应该是空的（不渲染删除线内容）。
    expect(screen.getByText('写入角色卡')).toBeTruthy();

    fireEvent.click(screen.getByText('写入角色卡'));
    await waitFor(() => {
      expect(捕获.系统?.角色卡.char_1.characterTraits).toBe('silver hair（银色长发）');
    });
    expect(捕获.系统?.角色卡.char_1.facialFeatures).toBe('green eyes（绿色眼睛）');
  });

  it('模型没给出可解析区块时提示并把原始回复摆出来', async () => {
    const 请求生成 = vi.fn(async (): Promise<生成角色特征结果> => ({
      字段: {},
      服装: [],
      未识别: [],
      原始回复: '我不太明白你的意思。',
      重试次数: 0,
      诊断: '模型返回为空或没有 <人物> 块。',
    }));
    render(<TestShell 初始={建系统()} 请求生成={请求生成} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    const 要求框 = await screen.findByPlaceholderText(/流萤，星核猎手少女/);
    fireEvent.change(要求框, { target: { value: '流萤' } });
    fireEvent.click(screen.getByText('一键生成'));
    // 有诊断就照诊断说（这里 stub 了一条），没有才用通用文案。
    await waitFor(() => {
      expect(screen.getByText(/模型返回为空或没有 <人物> 块/)).toBeTruthy();
    });
    expect(screen.getByText('我不太明白你的意思。')).toBeTruthy();
  });

  it('没接模型调用时生成按钮禁用', async () => {
    render(<TestShell 初始={建系统()} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    const 要求框 = await screen.findByPlaceholderText(/流萤，星核猎手少女/);
    fireEvent.change(要求框, { target: { value: '流萤' } });
    const 按钮 = screen.getByText('一键生成') as HTMLButtonElement;
    expect(按钮.disabled).toBe(true);
  });

  it('生成结果与提示词消息列表都限高并可内部滚动', async () => {
    const 请求生成 = vi.fn(async (): Promise<生成角色特征结果> => ({
      字段: Object.fromEntries(['characterTraits', 'facialFeatures', 'upperBodySFW', 'upperBodyNSFW']
        .map((键) => [键, 'long tag string, another tag, third tag（中文翻译）'])),
      服装: [],
      未识别: [],
      原始回复: '<人物>…</人物>',
      重试次数: 0,
    }));
    const { container } = render(<TestShell 初始={建系统()} 请求生成={请求生成} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));

    // 预设（提示词消息）列表：8 条各带一个多行文本框，不限高会把下面的设置顶到很远。
    const 滚动区 = Array.from(container.querySelectorAll<HTMLElement>('.overflow-y-auto'));
    expect(滚动区.length, '生成结果与消息列表都需要可滚动容器').toBeGreaterThanOrEqual(1);
    expect(滚动区.some((节点) => 节点.className.includes('max-h-96'))).toBe(true);

    const 要求框 = await screen.findByPlaceholderText(/流萤，星核猎手少女/);
    fireEvent.change(要求框, { target: { value: '流萤' } });
    fireEvent.click(screen.getByText('一键生成'));
    await waitFor(() => {
      expect(screen.getByText(/生成结果（4 个字段/)).toBeInTheDocument();
    });
    // 生成结果同样限高，且「写入角色卡」仍在同一屏内可点。
    const 结果滚动区 = Array.from(container.querySelectorAll<HTMLElement>('.overflow-y-auto'))
      .filter((节点) => 节点.className.includes('max-h-80'));
    expect(结果滚动区).toHaveLength(1);
    expect(screen.getByText('写入角色卡')).toBeInTheDocument();
  });

  it('角色卡可以绑定 LoRA：新增、改权重、删除都会落盘', async () => {
    const 捕获: { 系统?: 文生图系统设置 } = {};
    const 壳 = render(<TestShell 初始={建系统()} on系统={(系统) => { 捕获.系统 = 系统; }} />);
    fireEvent.click(await screen.findByRole('button', { name: /流萤/ }));

    // 初始没有绑定。
    expect(screen.getByText(/还没有绑定 LoRA/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    const 名称框 = await screen.findByLabelText('LoRA 1 名称');
    fireEvent.change(名称框, { target: { value: 'krea.safetensors' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0.75' } });

    await waitFor(() => {
      expect(捕获.系统?.角色卡.char_1.LoRA?.[0]).toMatchObject({ 名称: 'krea.safetensors', 权重: 0.75 });
    });

    fireEvent.click(screen.getByRole('button', { name: '删除 LoRA 1' }));
    await waitFor(() => {
      expect(捕获.系统?.角色卡.char_1.LoRA ?? []).toHaveLength(0);
    });
    壳.unmount();
  });

  it('拉到 LoRA 列表后，名称变成和底模一样的选择框（也能切回手填）', async () => {
    const 拉取 = vi.fn(async () => ['krea.safetensors', 'detail.safetensors']);
    render(
      <TestShell
        初始={建系统()}
        LoRA列表={['krea.safetensors', 'detail.safetensors']}
        on拉取LoRA={拉取}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /流萤/ }));
    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    // 列表已在手上 → 下拉（combobox），选项就是服务器上的 LoRA。
    const 下拉 = await screen.findByRole('combobox', { name: 'LoRA 1 名称' });
    expect(Array.from((下拉 as HTMLSelectElement).options).map((项) => 项.value))
      .toEqual(['', 'krea.safetensors', 'detail.safetensors']);

    // 「拉取 LoRA 列表」按钮会调回调（等价于连接页的「读取模型列表」）。
    fireEvent.click(screen.getByRole('button', { name: '拉取 LoRA 列表' }));
    await waitFor(() => {
      expect(拉取).toHaveBeenCalled();
    });
    expect(await screen.findByText(/已读取 2 个 LoRA/)).toBeInTheDocument();

    // 切「手填」→ 变成文本框，列表里没有的名字也能写。
    fireEvent.click(screen.getByRole('button', { name: '手填' }));
    const 输入 = screen.getByLabelText('LoRA 1 名称');
    expect(输入.tagName).toBe('INPUT');
    expect((输入 as HTMLInputElement).type).toBe('text');
  });

  it('存着的名字不在列表里时，选项里仍然显示它（不会看起来被清空）', async () => {
    const 系统 = 建系统();
    系统.角色卡.char_1 = 建角色({ LoRA: [{ id: 'l1', 名称: '旧的.safetensors', 权重: 0.5 }] });
    render(<TestShell 初始={系统} LoRA列表={['krea.safetensors']} />);
    fireEvent.click(await screen.findByRole('button', { name: /流萤/ }));

    const 下拉 = await screen.findByRole('combobox', { name: 'LoRA 1 名称' }) as HTMLSelectElement;
    expect(下拉.value).toBe('旧的.safetensors');
    expect(Array.from(下拉.options).map((项) => 项.value)).toContain('旧的.safetensors');
    expect(Array.from(下拉.options).some((项) => 项.textContent?.includes('不在当前列表里'))).toBe(true);
  });

  it('角色卡页给出可复制的标签（含服装与只出镜写法）', async () => {
    const 写文本 = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText: 写文本 } });
    const 系统 = 建系统();
    系统.角色卡.char_1 = 建角色({
      outfits: [{ id: 'o1', name: '战斗服', 上半身: 'battle top', 下半身: 'battle skirt', 全身: '', 负面: '' }],
    });

    render(<TestShell 初始={系统} />);
    // 编辑器只在选中某张卡后出现：先在左栏点它。
    fireEvent.click(await screen.findByRole('button', { name: /流萤/ }));

    // 角色的部位档位
    expect(await screen.findByText('$流萤-sfw-upperbody$')).toBeInTheDocument();
    expect(screen.getByText('$流萤-nsfw-lowerbody$')).toBeInTheDocument();
    // 只出镜：构图词走 JSON 形式，且用 AI 常写的 `${…}` 包法（两种都认）
    expect(screen.getByText(/^\$\{\"name\":\"流萤\",\"angle\":\"\",\"upperBody\":\"sfw\",\"framing\":\"upper body\"\}$/)).toBeInTheDocument();
    // 服装的三档
    expect(screen.getByText('$战斗服-upperbody$')).toBeInTheDocument();
    expect(screen.getByText('$战斗服-lowerbody$')).toBeInTheDocument();
    expect(screen.getByText('$战斗服-upperbody-lowerbody$')).toBeInTheDocument();

    const 服装行 = screen.getByText('$战斗服-lowerbody$').closest('div');
    fireEvent.click(服装行!.querySelector('button')!);
    await waitFor(() => {
      expect(写文本).toHaveBeenCalledWith('$战斗服-lowerbody$');
    });
  });

  it('生成结果里的服装：可逐项改、可取消勾选，写入后有回执', async () => {
    const 捕获: { 系统?: 文生图系统设置 } = {};
    const 请求生成 = vi.fn(async (): Promise<生成角色特征结果> => ({
      字段: { characterTraits: 'pink hair（粉色头发）', facialFeatures: 'purple eyes（紫色眼睛）' },
      服装: [
        { name: '皇家礼服', 英文名称: 'regal gown', 归属人: '', 上半身: 'regal gown（华丽长裙）', 上半身背面: '', 下半身: '', 下半身背面: '', 全身: '', 负面: '' },
        { name: '休闲装', 英文名称: 'casual', 归属人: '', 上半身: 'casual top（休闲上衣）', 上半身背面: '', 下半身: '', 下半身背面: '', 全身: '', 负面: '' },
      ],
      未识别: [],
      原始回复: '<人物>…</人物>',
      重试次数: 0,
    }));
    render(<TestShell 初始={建系统()} 请求生成={请求生成} on系统={(系统) => { 捕获.系统 = 系统; }} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    fireEvent.change(await screen.findByPlaceholderText(/流萤，星核猎手少女/), { target: { value: '流萤' } });
    fireEvent.click(screen.getByText('一键生成'));
    await screen.findByDisplayValue('pink hair（粉色头发）');

    // 两件都在，且默认全勾（汇总写在开关说明里）。
    expect(screen.getByText(/当前会写入 2 \/ 2 件/)).toBeInTheDocument();

    // 改第一件的名字与上半身内容。
    fireEvent.change(screen.getByDisplayValue('皇家礼服'), { target: { value: '深蓝礼服' } });
    fireEvent.change(screen.getByDisplayValue('regal gown（华丽长裙）'), { target: { value: 'deep blue gown（深蓝礼服）' } });

    // 取消第二件：点它旁边的输入框**不会**连带取消勾选（以前用 <label> 包住输入框会）。
    fireEvent.click(screen.getByDisplayValue('casual top（休闲上衣）'));
    expect(screen.getByRole('checkbox', { name: '写入第 2 件服装' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '写入第 2 件服装' }));
    expect(screen.getByText(/当前会写入 1 \/ 2 件/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('写入角色卡'));
    await waitFor(() => {
      expect(捕获.系统?.角色卡.char_1.outfits).toHaveLength(1);
    });
    const 新衣 = 捕获.系统?.角色卡.char_1.outfits[0];
    expect(新衣?.name).toBe('深蓝礼服');
    expect(新衣?.上半身).toBe('deep blue gown（深蓝礼服）');
    // 回执写清写了几个字段、几件服装。
    expect(await screen.findByText(/已写入 2 个部位字段、1 件服装/)).toBeInTheDocument();
    expect(screen.getByText(/另有 1 件没有勾选，未写入/)).toBeInTheDocument();
  });

  it('开关关着时回执必须明说「服装没有写入」（以前只字不提）', async () => {
    const 捕获: { 系统?: 文生图系统设置 } = {};
    const 请求生成 = vi.fn(async (): Promise<生成角色特征结果> => ({
      字段: { characterTraits: 'pink hair（粉色头发）' },
      服装: [{ name: '皇家礼服', 英文名称: '', 归属人: '', 上半身: 'regal gown', 上半身背面: '', 下半身: '', 下半身背面: '', 全身: '', 负面: '' }],
      未识别: [],
      原始回复: '<人物>…</人物>',
      重试次数: 0,
    }));
    render(<TestShell 初始={建系统()} 请求生成={请求生成} on系统={(系统) => { 捕获.系统 = 系统; }} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    fireEvent.change(await screen.findByPlaceholderText(/流萤，星核猎手少女/), { target: { value: '流萤' } });
    fireEvent.click(screen.getByText('一键生成'));
    await screen.findByDisplayValue('pink hair（粉色头发）');

    // 关掉「同时写入生成的服装」（开关的无障碍名称就是它的标题）。
    fireEvent.click(screen.getByRole('button', { name: '同时写入生成的服装' }));
    fireEvent.click(screen.getByText('写入角色卡'));
    await waitFor(() => {
      expect(screen.getByText(/服装没有写入/)).toBeInTheDocument();
    });
    expect(捕获.系统?.角色卡.char_1.outfits).toHaveLength(0);
  });

  it('模型只给了 <服装> 没给部位字段时，生成结果面板也出现并能写入服装', async () => {
    const 捕获: { 系统?: 文生图系统设置 } = {};
    const 请求生成 = vi.fn(async (): Promise<生成角色特征结果> => ({
      字段: {},
      服装: [{ name: '皇家礼服', 英文名称: '', 归属人: '', 上半身: 'regal gown', 上半身背面: '', 下半身: '', 下半身背面: '', 全身: '', 负面: '' }],
      未识别: [],
      原始回复: '<服装>…</服装>',
      重试次数: 0,
    }));
    render(<TestShell 初始={建系统()} 请求生成={请求生成} on系统={(系统) => { 捕获.系统 = 系统; }} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    fireEvent.change(await screen.findByPlaceholderText(/流萤，星核猎手少女/), { target: { value: '流萤' } });
    fireEvent.click(screen.getByText('一键生成'));

    // 没有部位字段时以前整块面板都不渲染 → 服装根本没机会写。
    await waitFor(() => {
      expect(screen.getByText('写入角色卡')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('写入角色卡'));
    await waitFor(() => {
      expect(捕获.系统?.角色卡.char_1.outfits).toHaveLength(1);
    });
    expect(捕获.系统?.角色卡.char_1.outfits[0].name).toBe('皇家礼服');
  });

  it('预览出图：按预设拼出与正文一致的 $…$ 提示词，图片留在本页可放大', async () => {
    const 调用: string[] = [];
    const 生成预览图 = vi.fn(async (提示词: string) => {
      调用.push(提示词);
      return { 数据地址: 'data:image/png;base64,AAAA', 宽度: 832, 高度: 1216 };
    });
    // 预览读的是角色卡上的字段：给这张卡填上 sfw 上半身，才能验证「段确实被替换成字段」。
    const 系统 = 建系统();
    系统.角色卡.char_1 = { ...系统.角色卡.char_1, characterTraits: '银发', upperBodySFW: '白色上衣' };
    render(<TestShell 初始={系统} 生成预览图={生成预览图} />);
    fireEvent.click(await screen.findByRole('button', { name: /流萤/ }));
    fireEvent.click(screen.getByRole('button', { name: /^生成/ }));

    const sfw正面 = await screen.findByRole('button', { name: 'sfw · 正面 · 上半身' });
    fireEvent.click(sfw正面);
    await waitFor(() => { expect(生成预览图).toHaveBeenCalledTimes(1); });

    // 提示词形态：外壳 + sfw 前缀 + 带 angle 的 JSON 段（angle 才让它被当成角色段）。
    expect(调用[0]).toContain('sfw, 1girl, solo');
    // 语法是 `${键值对}$`（不是 `${json对象}$`）——写错不会报错，只会整段不替换。
    expect(调用[0]).toContain('${"name":"流萤","angle":"from front","upperBody":"sfw","lowerBody":"hidden"}$');
    // 再用真实解析器验证这段确实被当成角色段（而不是原样留在提示词里）。
    const 解析 = 处理角色提示词(调用[0], { 启用列表: ['char_1'], 全部角色: 系统.角色卡 });
    expect(解析.未识别段).toEqual([]);
    expect(解析.提示词).toContain('白色上衣');
    expect(解析.提示词).not.toContain('${');

    // 出图后出现缩略图（alt 是预设标签）与尺寸说明。
    const 图 = await screen.findByAltText('sfw · 正面 · 上半身');
    expect(图).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(screen.getByText('sfw · 正面 · 上半身（832×1216）')).toBeInTheDocument();

    // 点图放大，出现铺满窗口的那张。
    fireEvent.click(图);
    expect(await screen.findByAltText('预览放大')).toBeInTheDocument();

    // nsfw 预设不带 sfw 前缀，且档位走 nsfw 字段。
    fireEvent.click(screen.getByRole('button', { name: 'nsfw · 正面 · 下半身' }));
    await waitFor(() => { expect(生成预览图).toHaveBeenCalledTimes(2); });
    expect(调用[1]).toContain('1girl, solo');
    expect(调用[1]).not.toContain('sfw, 1girl');
    expect(调用[1]).toContain('"upperBody":"hidden","lowerBody":"nsfw"');
  });

  it('预览出图：全部生成是串行的，且失败会报出是哪一张', async () => {
    const 次数: string[] = [];
    let 第几次 = 0;
    const 生成预览图 = vi.fn(async (提示词: string) => {
      次数.push(提示词);
      第几次 += 1;
      if (第几次 === 2) throw new Error('ComfyUI 校验失败');
      return { 数据地址: 'data:image/png;base64,BBBB', 宽度: 512, 高度: 512 };
    });
    render(<TestShell 初始={建系统()} 生成预览图={生成预览图} />);
    fireEvent.click(await screen.findByRole('button', { name: /流萤/ }));
    fireEvent.click(screen.getByRole('button', { name: /^生成/ }));
    fireEvent.click(await screen.findByRole('button', { name: /全部生成/ }));
    await waitFor(() => { expect(生成预览图).toHaveBeenCalledTimes(6); });
    const 报错 = await screen.findByText(/出图失败/);
    expect(报错.textContent).toContain('sfw · 背后 · 上半身');
    expect(报错.textContent).toContain('ComfyUI 校验失败');
    // 一张失败不影响其余五张。
    expect(await screen.findAllByRole('img')).toHaveLength(5);
  });

  it('预览出图：新建模式的卡片还没写入也能预览（用刚生成的内容当角色上下文）', async () => {
    const 收到: Array<{ 提示词: string; 临时角色?: 角色卡 }> = [];
    const 生成预览图 = vi.fn(async (提示词: string, 临时角色?: 角色卡) => {
      收到.push({ 提示词, 临时角色 });
      return { 数据地址: 'data:image/png;base64,CCCC', 宽度: 512, 高度: 768 };
    });
    const 请求生成 = vi.fn(async (): Promise<生成角色特征结果> => ({
      字段: { nameCN: '可可利亚', characterTraits: 'mature（成熟）', upperBodySFW: 'regal gown（华丽长裙）' },
      服装: [],
      未识别: [],
      原始回复: '<人物>…</人物>',
      重试次数: 0,
    }));
    render(<TestShell 初始={建系统()} 请求生成={请求生成} 生成预览图={生成预览图} />);
    fireEvent.click(await screen.findByRole('button', { name: /流萤/ }));
    fireEvent.click(screen.getByRole('button', { name: /^生成/ }));

    // 切到「新建」目标，先生成一次。
    fireEvent.change(await screen.findByLabelText('目标角色卡'), { target: { value: '__新建__' } });
    fireEvent.change(screen.getByPlaceholderText(/流萤，星核猎手少女/), { target: { value: '可可利亚' } });
    fireEvent.click(screen.getByText('一键生成'));
    await screen.findByDisplayValue('mature（成熟）');

    // 关键：还没点「写入角色卡」也能预览，而且用的是「待写入」的内容。
    expect(screen.getByText(/用刚生成、还没写入的内容/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'sfw · 正面 · 上半身' }));
    await waitFor(() => { expect(生成预览图).toHaveBeenCalledTimes(1); });

    // 提示词用的是新名字；临时角色带着刚生成的字段（含角色特征）一起交给上层。
    expect(收到[0].提示词).toContain('"name":"可可利亚"');
    expect(收到[0].临时角色?.nameCN).toBe('可可利亚');
    expect(收到[0].临时角色?.characterTraits).toBe('mature（成熟）');
    expect(收到[0].临时角色?.upperBodySFW).toBe('regal gown（华丽长裙）');

    // 这里不点「写入角色卡」：角色卡表里不该多出这张卡。
    expect(screen.getByAltText('sfw · 正面 · 上半身')).toBeInTheDocument();
  });

  it('生成页签的预设默认空白，并提示去导入', async () => {
    render(<TestShell 初始={建系统()} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    expect(await screen.findByText(/预设是空白的/)).toBeInTheDocument();
    // 提示条与面板说明里都写了教程里的文件名，这里只要求至少出现一次。
    expect(screen.getAllByText(/角色AI预设-人物生成\.json/).length).toBeGreaterThan(0);
    expect(screen.getByText(/提示词消息（0 条/)).toBeInTheDocument();
  });

  it('导入预设 JSON 后消息出现（破甲在、讨论模式停用）', async () => {
    render(<TestShell 初始={建系统()} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    await screen.findByText(/预设是空白的/);

    const 预设文本 = 导出角色AI预设文本({
      名称: '人物生成',
      消息: 人物生成预设消息(),
      参数: { 温度: 0.9, 最大输出: 12288, 重试次数: 1 },
    });
    const 输入 = screen.getByLabelText('选择预设 JSON 文件') as HTMLInputElement;
    fireEvent.change(输入, { target: { files: [new File([预设文本], '预设.json', { type: 'application/json' })] } });

    // 破甲块（初始化）必须在——它就是「经常空回」的修法。
    expect(await screen.findByDisplayValue(/小克:头好疼，我是谁？/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/<人物>/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/小克:我们还需要讨论一下角色的服装设计/)).toBeInTheDocument();
    // 讨论模式收录了但预设里是停用的（它会让模型先写一大段 <talk>）。
    expect(screen.getByDisplayValue(/讨论完毕，开始设计/)).toBeInTheDocument();
    expect(screen.getByText('已停用')).toBeInTheDocument();
    expect(screen.getByText(/已导入「人物生成」：8 条消息/)).toBeInTheDocument();
  });

  it('空回时把服务侧的诊断摆出来，并自动展开原始回复', async () => {
    const 请求生成 = vi.fn(async (): Promise<生成角色特征结果> => ({
      字段: {},
      服装: [],
      未识别: [],
      原始回复: '（空回复）',
      重试次数: 1,
      诊断: '模型把输出额度用完了却没产出 <人物> 块（finishReason=MAX_TOKENS）。',
    }));
    render(<TestShell 初始={建系统()} 请求生成={请求生成} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    const 要求框 = await screen.findByPlaceholderText(/流萤，星核猎手少女/);
    fireEvent.change(要求框, { target: { value: '流萤' } });
    fireEvent.click(screen.getByText('一键生成'));
    await waitFor(() => {
      expect(screen.getByText(/MAX_TOKENS/)).toBeInTheDocument();
    });
    expect(screen.getByText('（空回复）')).toBeInTheDocument();
  });

  it('生成的值可以在写回前改：改过的内容才是落盘的内容', async () => {
    const 捕获: { 系统?: 文生图系统设置 } = {};
    const 请求生成 = vi.fn(async (): Promise<生成角色特征结果> => ({
      字段: { characterTraits: 'silver hair（银色长发）', facialFeatures: 'green eyes（绿色眼睛）' },
      服装: [],
      未识别: [],
      原始回复: '<人物>…</人物>',
      重试次数: 0,
    }));
    render(<TestShell 初始={建系统()} 请求生成={请求生成} on系统={(系统) => { 捕获.系统 = 系统; }} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    const 要求框 = await screen.findByPlaceholderText(/流萤，星核猎手少女/);
    fireEvent.change(要求框, { target: { value: '流萤' } });
    fireEvent.click(screen.getByText('一键生成'));

    // 「角色特征」的生成值放在可编辑的 textarea 里，直接改。
    const 特征框 = await screen.findByDisplayValue('silver hair（银色长发）');
    fireEvent.change(特征框, { target: { value: 'short silver hair（银色短发）' } });
    expect(await screen.findByText('已手工修改')).toBeInTheDocument();

    fireEvent.click(screen.getByText('写入角色卡'));
    await waitFor(() => {
      expect(捕获.系统?.角色卡.char_1.characterTraits).toBe('short silver hair（银色短发）');
    });
    // 没改过的字段照旧写生成值。
    expect(捕获.系统?.角色卡.char_1.facialFeatures).toBe('green eyes（绿色眼睛）');
  });

  it('可以直接新建角色卡：生成后写入会建一张新卡并挂进启用列表', async () => {
    const 捕获: { 系统?: 文生图系统设置 } = {};
    const 请求生成 = vi.fn(async (): Promise<生成角色特征结果> => ({
      字段: { nameCN: '花火', characterTraits: 'pink hair（粉色头发）' },
      服装: [],
      未识别: [],
      原始回复: '<人物>…</人物>',
      重试次数: 0,
    }));
    render(<TestShell 初始={建系统()} 请求生成={请求生成} on系统={(系统) => { 捕获.系统 = 系统; }} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));

    // 目标下拉里选「＋ 新建角色卡」→ 出现卡名输入框。
    const 下拉 = await screen.findByRole('combobox', { name: '目标角色卡' });
    fireEvent.change(下拉, { target: { value: '__新建__' } });
    const 名称框 = await screen.findByPlaceholderText('例：流萤');
    fireEvent.change(名称框, { target: { value: '花火' } });

    const 要求框 = screen.getByPlaceholderText(/流萤，星核猎手少女/);
    fireEvent.change(要求框, { target: { value: '花火，假面愚人' } });
    fireEvent.click(screen.getByText('一键生成'));
    await screen.findByDisplayValue('pink hair（粉色头发）');
    fireEvent.click(screen.getByText(/新建角色卡.*并写入/));

    await waitFor(() => {
      expect(Object.keys(捕获.系统?.角色卡 ?? {})).toHaveLength(2);
    });
    const 新卡 = Object.values(捕获.系统?.角色卡 ?? {}).find((卡) => 卡.nameCN === '花火');
    expect(新卡).toBeDefined();
    expect(新卡?.characterTraits).toBe('pink hair（粉色头发）');
    // 必须同时进当前启用列表，否则正文生图永远看不到这张卡。
    expect(捕获.系统?.角色启用列表).toContain(新卡?.id);
  });

  it('注入模板页签列出四套内置方案与模板正文', async () => {
    render(<TestShell 初始={建系统()} />);
    fireEvent.click(screen.getByRole('button', { name: /注入模板/ }));
    expect(await screen.findByText('角色列表模板')).toBeTruthy();
    // 角色列表模板有独有的 imageId 行；通用角色模板是简写。
    // 注意 testing-library 默认会归一化空白，所以缩进不能用来区分模板。
    expect(screen.getByDisplayValue(/角色图片：\[\{imageId\}\] \{imageDesc\}/)).toBeTruthy();
    expect(screen.getByDisplayValue(/上半身SFW（正面）：\{upperSFW\}/)).toBeTruthy();
    expect(screen.getByDisplayValue('{nameCN} {nameEN}')).toBeTruthy();
    // 卡内服装与通用服装两段模板内容一致（只有缩进差别），归一化后应当命中两个。
    expect(screen.getAllByDisplayValue(/上半身（正面）：\{upperBody\}/)).toHaveLength(2);
  });
});
