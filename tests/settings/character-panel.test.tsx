// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CharacterSettingsPanel } from '@/components/features/Settings/CharacterSettingsPanel';
import { 创建默认文生图系统设置 } from '@/models/genSystem';
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
}: {
  初始: 文生图系统设置;
  请求生成?: (参数: { 系统: 文生图系统设置; 要求: string; 角色?: 角色卡 }) => Promise<生成角色特征结果>;
  on系统?: (系统: 文生图系统设置) => void;
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
    }));
    render(<TestShell 初始={建系统()} 请求生成={请求生成} />);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    const 要求框 = await screen.findByPlaceholderText(/流萤，星核猎手少女/);
    fireEvent.change(要求框, { target: { value: '流萤' } });
    fireEvent.click(screen.getByText('一键生成'));
    await waitFor(() => {
      expect(screen.getByText(/没有给出可解析的 <人物> 区块/)).toBeTruthy();
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
