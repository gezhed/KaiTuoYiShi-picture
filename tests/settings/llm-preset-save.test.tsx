// @vitest-environment jsdom
/**
 * 文生图 → LLM 预设：改完要能保存。
 *
 * 用户报的是「LLM 预设部分修改之后保存不生效」，所以这里从组件层把整条路锁住：
 * 面板编辑 → `补丁` → `补丁系统` → `onChange` → 底部「保存文生图设置」→ `onPersistSettings`。
 * 中间任何一环丢了，都会表现为「改完保存没反应」。
 */
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ComfyUISettingsConsole } from '@/components/features/Settings/ComfyUISettingsConsole';
import { SettingsModal } from '@/components/features/Settings/SettingsModal';
import type { SettingsModalProps } from '@/components/features/Settings/settingsSections/types';
import type { DeviceSettings } from '@/models/settings';
import { 创建空API设置, 创建默认游戏设置, type 游戏设置 } from '@/models/settings';
import type { LLM预设 } from '@/models/genSystem';
import { 归一化游戏设置 } from '@/utils/gameSettingsHydration';
import type { Comfy可选资源 } from '@/services/ai/imageGen/comfyClient';

const 空资源: Comfy可选资源 = { 模型: [], 采样器: [], 调度器: [], vae: [], clip: [], lora: [] };

const 带条目的预设: LLM预设 = {
  entries: [
    {
      id: 'sys',
      name: '系统条目',
      role: 'system',
      content: '原始内容',
      enabled: true,
      触发方式: 'always',
      触发词: [],
      与触发: false,
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};

/** 用真实 useState 托住 settings，模拟 App 里的受控更新。 */
function 建宿主(记落盘: (next: 游戏设置) => void, 初始?: 游戏设置) {
  function Host() {
    const [game, setGame] = useState<游戏设置>(() => 初始 ?? 创建默认游戏设置());
    return (
      <ComfyUISettingsConsole
        settings={game}
        onChange={setGame}
        onPersistSettings={(next) => {
          记落盘(next);
          return Promise.resolve();
        }}
        onTestConnection={() => Promise.resolve('ok')}
        onFetchResources={() => Promise.resolve(空资源)}
        onCacheStats={() => Promise.resolve({ 条目数: 0, 图片数: 0, 总字节: 0 })}
        onClearCache={() => Promise.resolve()}
        apiSettings={创建空API设置()}
        onFetchModels={() => Promise.resolve([])}
        主API名="主配置"
        主API模型="main-model"
        主API地址="https://main.example.test/v1"
      />
    );
  }
  return Host;
}

describe('LLM 预设的改动要能保存', () => {
  it('改温度后点「保存文生图设置」，落盘的是新值', async () => {
    const 已落盘: 游戏设置[] = [];
    const Host = 建宿主((next) => 已落盘.push(next));
    render(<Host />);

    fireEvent.click(screen.getByText('LLM 预设'));

    const 温度 = screen.getByRole('spinbutton', { name: /温度/ });
    fireEvent.change(温度, { target: { value: '1.4' } });
    expect((温度 as HTMLInputElement).value).toBe('1.4');

    fireEvent.click(screen.getByText('保存文生图设置'));
    await Promise.resolve();

    expect(已落盘).toHaveLength(1);
    expect(已落盘[0].文生图系统.LLM.温度).toBe(1.4);
  });

  it('改接口地址与模型后也能保存', async () => {
    const 已落盘: 游戏设置[] = [];
    const Host = 建宿主((next) => 已落盘.push(next));
    render(<Host />);

    fireEvent.click(screen.getByText('LLM 预设'));

    fireEvent.change(screen.getByRole('textbox', { name: /^接口地址/ }), {
      target: { value: 'https://relay.example.test/v1' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /^模型/ }), {
      target: { value: 'gemini-2.5-flash' },
    });
    fireEvent.click(screen.getByText('保存文生图设置'));
    await Promise.resolve();

    expect(已落盘).toHaveLength(1);
    expect(已落盘[0].文生图系统.LLM.API.baseUrl).toBe('https://relay.example.test/v1');
    expect(已落盘[0].文生图系统.LLM.API.model).toBe('gemini-2.5-flash');
  });
});

describe('LLM 预设的条目编辑也要能保存', () => {
  it('改条目内容后逐层保存，落盘的是新内容', async () => {
    const 初始 = 创建默认游戏设置();
    初始.文生图系统.LLM.预设列表 = { 默认: 带条目的预设 };
    初始.文生图系统.LLM.当前预设 = '默认';

    const 已落盘: 游戏设置[] = [];
    const Host = 建宿主((next) => 已落盘.push(next), 初始);
    render(<Host />);

    fireEvent.click(screen.getByText('LLM 预设'));
    fireEvent.click(screen.getByText('编辑'));

    const 编辑区 = document.querySelector('textarea');
    expect(编辑区).toBeTruthy();
    fireEvent.change(编辑区 as HTMLTextAreaElement, { target: { value: '改过的内容' } });

    // 条目级按钮叫「写入草稿」——只写内存；页面级的「保存文生图设置」才落盘。
    fireEvent.click(screen.getByText('写入草稿'));
    fireEvent.click(screen.getByText('保存文生图设置'));
    await Promise.resolve();

    expect(已落盘).toHaveLength(1);
    const 落盘预设 = 已落盘[0].文生图系统.LLM.预设列表['默认'];
    expect(落盘预设.entries).toHaveLength(1);
    expect(落盘预设.entries[0].content).toBe('改过的内容');
  });
});

/**
 * 按 App 的实际结构搭一个受控宿主：`deviceSettings` 挂在**宿主**上，
 * 设置弹窗只是条件渲染。这样「关掉设置 → 重新打开」才是真正的复现路径
 * （状态留在宿主里，不随弹窗卸载而丢）。
 */
function 建弹窗宿主(记落盘: (next: 游戏设置) => void, 初始?: 游戏设置) {
  function Host() {
    const [设备, set设备] = useState<DeviceSettings>(() => ({
      apiSettings: 创建空API设置(),
      gameSettings: 初始 ?? 创建默认游戏设置(),
      theme: 'deepspace',
      worldbooks: [],
    }));
    const [开着, set开着] = useState(true);
    // 只有 imageGen 这一页会渲染，其余分组用不到；用断言把无关回调省掉。
    const 只做文生图 = {
      onClose: () => set开着(false),
      deviceSettings: 设备,
      onGameSettingsChange: (next: 游戏设置) => set设备((prev) => ({ ...prev, gameSettings: next })),
      onThemeChange: () => {},
      onPersistGameSettings: (next: 游戏设置) => {
        记落盘(next);
        return Promise.resolve();
      },
      onPersistTheme: () => Promise.resolve(),
      fetchModels: () => Promise.resolve([]),
      initialTab: 'imageGen',
    } as unknown as SettingsModalProps;

    return (
      <>
        <button type="button" onClick={() => set开着(true)}>重新打开设置</button>
        {开着 && <SettingsModal {...只做文生图} />}
      </>
    );
  }
  return Host;
}

describe('关掉设置再打开，预设条目的改动不该丢', () => {
  const 打开条目编辑 = (): HTMLTextAreaElement => {
    fireEvent.click(screen.getByText('LLM 预设'));
    fireEvent.click(screen.getByText('编辑'));
    const 编辑区 = document.querySelector('textarea');
    expect(编辑区).toBeTruthy();
    return 编辑区 as HTMLTextAreaElement;
  };

  it('草稿阶段（还没落盘）关掉再打开仍然保留', async () => {
    const 初始 = 创建默认游戏设置();
    初始.文生图系统.LLM.预设列表 = { 默认: 带条目的预设 };
    初始.文生图系统.LLM.当前预设 = '默认';

    const Host = 建弹窗宿主(() => {}, 初始);
    render(<Host />);

    fireEvent.change(打开条目编辑(), { target: { value: '草稿内容' } });
    fireEvent.click(screen.getByText('写入草稿'));

    fireEvent.click(screen.getAllByLabelText('关闭')[0]);
    fireEvent.click(screen.getByRole('button', { name: '重新打开设置' }));

    fireEvent.click(await screen.findByText('LLM 预设'));
    expect(screen.getByText('草稿内容')).toBeInTheDocument();
  });

  it('点页面底部保存之后，重新打开与落盘都是新内容', async () => {
    const 初始 = 创建默认游戏设置();
    初始.文生图系统.LLM.预设列表 = { 默认: 带条目的预设 };
    初始.文生图系统.LLM.当前预设 = '默认';

    const 已落盘: 游戏设置[] = [];
    const Host = 建弹窗宿主((next) => 已落盘.push(next), 初始);
    render(<Host />);

    fireEvent.change(打开条目编辑(), { target: { value: '落盘内容' } });
    fireEvent.click(screen.getByText('写入草稿'));
    fireEvent.click(screen.getByText('保存文生图设置'));
    await Promise.resolve();

    expect(已落盘).toHaveLength(1);
    const 落盘预设 = 已落盘[0].文生图系统.LLM.预设列表['默认'];
    expect(落盘预设.entries[0].content).toBe('落盘内容');

    fireEvent.click(screen.getAllByLabelText('关闭')[0]);
    fireEvent.click(screen.getByRole('button', { name: '重新打开设置' }));
    fireEvent.click(await screen.findByText('LLM 预设'));
    expect(screen.getByText('落盘内容')).toBeInTheDocument();
  });
});

/**
 * 落盘 / 读回这一层：`persistGameSettings` 会先跑 `归一化游戏设置`，
 * 启动时 `hydratePersistedGameSettings` 又跑一次 `归一化文生图系统设置`。
 * 两处都得原样保留预设条目，否则「保存了、刷新就变回去」。
 */
describe('归一化不会丢掉预设条目', () => {
  it('保存 → 读回之后条目内容不变', () => {
    const 设置 = 创建默认游戏设置();
    设置.文生图系统.LLM.预设列表 = { 默认: 带条目的预设 };
    设置.文生图系统.LLM.当前预设 = '默认';

    const 归一化后 = 归一化游戏设置(设置);

    expect(归一化后.文生图系统.LLM.预设列表['默认'].entries).toHaveLength(1);
    expect(归一化后.文生图系统.LLM.预设列表['默认'].entries[0].content).toBe('原始内容');
    expect(归一化后.文生图系统.LLM.当前预设).toBe('默认');
  });
});
