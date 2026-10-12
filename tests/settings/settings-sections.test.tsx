// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '@/components/features/Settings/SettingsModal';
import { settingsSections } from '@/components/features/Settings/settingsSections/registry';
import type { SettingsModalProps, SettingsTab } from '@/components/features/Settings/settingsSections/types';
import type { DeviceSettings, 游戏设置 } from '@/models/settings';
import { 创建空API设置, 创建默认游戏设置 } from '@/models/settings';
import { 创建空角色 } from '@/models/character';
import { 创建空世界状态 } from '@/models/world';
import { 创建空记忆系统 } from '@/models/memory';
import { 创建空忆庭系统 } from '@/models/yiting';
import { 创建空智库系统 } from '@/models/zhiku';
import { 创建空手机系统 } from '@/models/phone';
import { 创建空剧情编织系统 } from '@/models/storyWeaving';
import type { ContextSnapshot } from '@/hooks/useGame/contextSnapshot';
import type { SaveCatalogSnapshot } from '@/contracts/storage';
import type { TavernRegexDryRunResult, TavernRegexScriptSafety } from '@/contracts/ai';
import { baseSnapshot as baseSnapshotFixture } from '../helpers/saveManagerFixture';

const 全部页签: SettingsTab[] = [
  'visual', 'theme', 'game', 'prompts', 'tavernPresets', 'extra',
  'api', 'apiErrors',
  'variableUpdate', 'variableRepair', 'memory', 'yiting', 'news', 'zhiku', 'storyWeaving', 'phone', 'imageGen',
  'variables', 'context', 'storage',
  'nsfw',
];

const 空快照: SaveCatalogSnapshot = baseSnapshotFixture();

function 初始设备设置(): DeviceSettings {
  return {
    apiSettings: 创建空API设置(),
    gameSettings: 创建默认游戏设置(),
    theme: 'deepspace',
    worldbooks: [],
  };
}

function buildProps(overrides: Partial<SettingsModalProps> = {}): SettingsModalProps {
  const noop = () => {};
  return {
    onClose: noop,
    deviceSettings: 初始设备设置(),
    onApiSettingsChange: noop,
    onGameSettingsChange: noop,
    onThemeChange: noop,
    onContinue: () => Promise.resolve(true),
    onLoadSave: () => Promise.resolve(true),
    onBranchSave: () => Promise.resolve(true),
    旅人: 创建空角色(),
    世界: 创建空世界状态(),
    on世界Change: noop,
    记忆: 创建空记忆系统(),
    忆庭: 创建空忆庭系统(),
    智库: 创建空智库系统(),
    手机: 创建空手机系统(),
    NPC: [],
    新闻: [],
    剧情编织: 创建空剧情编织系统(),
    on剧情编织Change: noop,
    variableSetters: {
      set旅人: noop,
      set世界: noop,
      set记忆: noop,
      set忆庭: noop,
      set智库: noop,
      set手机: noop,
      setNPC: noop,
      set新闻: noop,
      set剧情: noop,
    },
    variableEditingLocked: false,
    getContextSnapshot: () => ({ kind: 'main' } as ContextSnapshot),
    initialTab: 'api',
    onWorldbooksChange: noop,
    onDeleteSave: () => Promise.resolve(true),
    onDeleteSaveTree: () => Promise.resolve(),
    onClearActiveSaveTreeMeta: noop,
    onGetSaveCatalogSnapshot: () => Promise.resolve(空快照),
    onStartSaveCatalogRepair: () => Promise.resolve({ total: 0, processed: 0, failed: 0, skippedForLease: false }),
    onSubscribeSaveCatalogRepair: () => () => {},
    onRepairSaveDatabase: () => Promise.resolve(),
    onDeleteLegacyBackupSaves: () => Promise.resolve(0),
    onExportSavePackage: () => Promise.resolve(),
    onExportSaveTreePackage: () => Promise.resolve(),
    onImportSaveFileAsMany: () => Promise.resolve(0),
    onExtractTavernRegexScripts: () => [],
    onAnalyzeTavernRegexScript: () => ({} as TavernRegexScriptSafety),
    onDryRunTavernRegexScript: () => ({} as TavernRegexDryRunResult),
    onPersistGameSettings: () => Promise.resolve(),
    onPersistApiSettings: () => Promise.resolve(),
    onPersistTheme: () => Promise.resolve(),
    onPersistApiProfile: (apiSettings, gameSettings) => Promise.resolve({ apiSettings, gameSettings }),
    onLoadApiProfileSlots: () => Promise.resolve([]),
    onPersistApiProfileSlots: () => Promise.resolve(),
    onLoadAuxApiProfiles: () => Promise.resolve({}),
    onPersistAuxApiProfiles: () => Promise.resolve(),
    fetchModels: () => Promise.resolve([]),
    testConnection: () => Promise.resolve({ ok: true, detail: '' }),
    loadApiErrorReports: () => Promise.resolve([]),
    clearApiErrorReports: () => Promise.resolve(),
    ...overrides,
  };
}

describe('设置分区注册表', () => {
  it('全部预期页签在注册表中各出现一次（增减页签需同步更新 roster）', () => {
    const keys = settingsSections.map((section) => section.key);
    expect([...keys].sort()).toEqual([...全部页签].sort());
  });

  it('子系统页签已迁到顶层分类', () => {
    const subsystemKeys = settingsSections
      .filter((section) => section.group === 'subsystems')
      .map((section) => section.key);
    expect(subsystemKeys).toEqual([
      'variableUpdate', 'variableRepair', 'memory', 'yiting', 'news', 'zhiku', 'storyWeaving', 'phone', 'imageGen',
    ]);
  });

  it('API 接口只保留连接相关，不再挂子系统子页', async () => {
    render(<SettingsModal {...buildProps()} />);

    expect(await screen.findByText(/API 配置包/)).toBeInTheDocument();
    expect(screen.queryByText('API 子页')).not.toBeInTheDocument();
    expect(screen.queryByText('总接口设置')).not.toBeInTheDocument();
    expect(screen.queryByText('记忆系统管理')).not.toBeInTheDocument();
  });

  it('子系统可以从侧栏直接进入', async () => {
    render(<SettingsModal {...buildProps()} />);

    fireEvent.click(screen.getByRole('button', { name: /记忆系统/ }));

    expect(await screen.findByText('记忆系统管理')).toBeInTheDocument();
    expect(screen.queryByText(/API 配置包/)).not.toBeInTheDocument();
  });

  it('文生图主机能在设置里打开（这是用户找不到的那个入口）', async () => {
    render(<SettingsModal {...buildProps({ initialTab: 'imageGen' })} />);

    // 总览页的基础开关与渠道选择。
    expect(await screen.findByText('基础开关')).toBeInTheDocument();
    expect(screen.getByText('生图渠道')).toBeInTheDocument();
    expect(screen.getByText('启用文生图')).toBeInTheDocument();
  });

  it('文生图设置内部各页签都能打开，且 ComfyUI 地址字段在', async () => {
    render(<SettingsModal {...buildProps({ initialTab: 'imageGen' })} />);
    await screen.findByText('基础开关');

    // 用完整可访问名（label + desc）精确定位：只写 /ComfyUI/ 会同时命中侧栏的
    // 「文生图 ComfyUI 工作流与提示词」。
    const 页签名 = [
      'ComfyUI 地址与并发',
      'NovelAI 模型与坐标',
      'SD WebUI A1111 / Forge',
      'Banana / Grok OpenAI 兼容图像接口',
      '提示词 预设与替换规则',
      '角色管理 角色卡与部位字段',
      '词库与标签 导入 tagData 与选词',
      '图片缓存 容量与清理',
    ];
    for (const 名称 of 页签名) {
      fireEvent.click(screen.getByRole('button', { name: 名称 }));
      expect(document.body.textContent, `页签「${名称}」没有渲染内容`).not.toBe('');
    }

    // 回到 ComfyUI 页确认地址字段确实在——用户点名的就是这个。
    fireEvent.click(screen.getByRole('button', { name: 'ComfyUI 地址与并发' }));
    expect(await screen.findByText('ComfyUI 地址')).toBeInTheDocument();
  });

  it('提示词页里有自检，且默认未启用时列出阻塞项', async () => {
    render(<SettingsModal {...buildProps({ initialTab: 'imageGen' })} />);
    await screen.findByText('基础开关');
    fireEvent.click(screen.getByRole('button', { name: '提示词 预设与替换规则' }));

    expect(await screen.findByText('自检')).toBeInTheDocument();
    expect(screen.getByText(/文生图未启用/)).toBeInTheDocument();
  });

  it('视觉设置里那段叫 galgame 模式，不再出现 AVG 字样', async () => {
    render(<SettingsModal {...buildProps({ initialTab: 'visual' })} />);
    expect(await screen.findByText('galgame 模式')).toBeInTheDocument();
    expect(screen.getByText('启用 galgame 模式')).toBeInTheDocument();
    // 机制名（逐段推进）继续出现在说明里，但「AVG」这个旧名字不该再冒出来。
    expect(screen.getByText(/逐段推进/)).toBeInTheDocument();
    expect(screen.queryByText(/AVG/)).toBeNull();
  });
});

describe('子系统草稿语义', () => {
  function ControlledSettings({
    persistSpy,
    stateSpy,
  }: {
    persistSpy: (settings: 游戏设置) => Promise<void>;
    stateSpy: (settings: 游戏设置) => void;
  }) {
    const [deviceSettings, setDeviceSettings] = useState<DeviceSettings>(初始设备设置);
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>重新打开设置</button>
        {open && (
          <SettingsModal
            {...buildProps({ initialTab: 'memory' })}
            deviceSettings={deviceSettings}
            onGameSettingsChange={(next) => {
              stateSpy(next);
              setDeviceSettings((prev) => ({ ...prev, gameSettings: next }));
            }}
            onPersistGameSettings={persistSpy}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  }

  it('编辑只改内存不落盘；关闭重开保留草稿；保存才落盘', async () => {
    const persistSpy = vi.fn<(settings: 游戏设置) => Promise<void>>(() => Promise.resolve());
    const stateSpy = vi.fn<(settings: 游戏设置) => void>();
    render(<ControlledSettings persistSpy={persistSpy} stateSpy={stateSpy} />);

    const input = screen.getByDisplayValue('10');
    fireEvent.change(input, { target: { value: '15' } });

    expect(stateSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('15')).toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText('关闭')[0]);
    fireEvent.click(screen.getByRole('button', { name: '重新打开设置' }));

    expect(await screen.findByDisplayValue('15')).toBeInTheDocument();
    expect(persistSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /保 存 配 置/ }));
    await waitFor(() => expect(persistSpy).toHaveBeenCalledTimes(1));
    expect(persistSpy.mock.calls[0][0].记忆系统.即时转短期阈值).toBe(15);
  });
});
