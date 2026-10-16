// @vitest-environment jsdom
/**
 * 「一键套用到其他 API」必须覆盖文生图里同样走文本 LLM 的两处覆盖：
 * LLM 预设（`文生图系统.LLM.API`）与角色管理「生成」（`文生图系统.角色AI.API`）。
 *
 * 这两处字段形状与变量 / 新闻 / 记忆等完全一致（provider + baseUrl + apiKey + model），
 * 之前漏在补丁外面：用户填好「其他 API」点一键套用，进文生图面板还是空的，
 * 只能一条条手填。这里锁住行为，避免以后再漏。
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { 创建默认游戏设置, type API设置, type DeviceSettings, type 游戏设置 } from '@/models/settings';
import type { API方案槽位, API配置包 } from '@/models/apiProfiles';
import { useApiOverviewSettings, type ApiSettingsOverviewProps } from '@/hooks/useApiOverviewSettings';
import { buildApiProfile } from '@/utils/apiProfile';

const 主配置: API设置 = {
  activeConfigId: 'main',
  configs: [
    {
      id: 'main',
      name: '主配置',
      provider: 'openai_compatible',
      baseUrl: 'https://main.example.test/v1',
      apiKey: 'sk-main',
      model: 'main-model',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
};

const 套用值 = {
  provider: 'deepseek' as const,
  baseUrl: 'https://aux.example.test/v1',
  apiKey: 'sk-aux',
  model: 'aux-model',
};

/** 建一个只关心「落盘时收到了什么」的装置，返回全部回调供断言。 */
function 建装置(初始游戏设置: 游戏设置 = 创建默认游戏设置()) {
  const deviceSettings: DeviceSettings = {
    apiSettings: 主配置,
    gameSettings: 初始游戏设置,
    theme: 'deepspace',
    worldbooks: [],
  };
  const onPersistGameSettings = vi.fn<(game: 游戏设置) => Promise<void>>(() => Promise.resolve());
  const onPersistApiProfile = vi.fn<
    (api: API设置, game: 游戏设置) => Promise<{ apiSettings: API设置; gameSettings: 游戏设置 }>
  >((api, game) => Promise.resolve({ apiSettings: api, gameSettings: game }));
  const props: ApiSettingsOverviewProps = {
    deviceSettings,
    onChange: vi.fn(),
    onGameSettingsChange: vi.fn(),
    onPersistApiSettings: vi.fn(() => Promise.resolve()),
    onPersistGameSettings,
    onPersistApiProfile,
    onLoadApiProfileSlots: vi.fn(() => Promise.resolve([] as API方案槽位[])),
    onPersistApiProfileSlots: vi.fn(() => Promise.resolve()),
    onLoadAuxApiProfiles: vi.fn(() => Promise.resolve({})),
    onPersistAuxApiProfiles: vi.fn(() => Promise.resolve()),
    fetchModels: vi.fn(() => Promise.resolve([] as string[])),
    testConnection: vi.fn(() => Promise.resolve({ ok: true, detail: '' })),
  };
  return { props, onPersistGameSettings, onPersistApiProfile };
}

/** 取最近一次落盘的游戏设置。 */
function 取落盘游戏设置(mock: { mock: { calls: unknown[][] } }): 游戏设置 {
  expect(mock.mock.calls.length).toBeGreaterThan(0);
  return mock.mock.calls[mock.mock.calls.length - 1][0] as 游戏设置;
}

/**
 * 挂载并等两个加载 effect 落定。
 *
 * `onLoadAuxApiProfiles` 回来时会写一份新的映射对象，从而在渲染期把 auxForm
 * 重置成「该主配置存过的其他 API」；不等它落定就直接 persistAuxForm，
 * 会被这次重置顶掉，表现为一键套用「没填 Base URL」。
 */
async function 挂载(props: ApiSettingsOverviewProps) {
  const rendered = renderHook(() => useApiOverviewSettings(props));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return rendered;
}

/** 填好「其他 API」并点一键套用。 */
async function 套用一次(result: { current: ReturnType<typeof useApiOverviewSettings> }, 覆盖: Partial<typeof 套用值> = {}) {
  await act(async () => {
    await result.current.persistAuxForm({ ...套用值, ...覆盖 });
  });
  await act(async () => {
    await result.current.handleApplyAuxModel();
  });
}

describe('一键套用到其他 API：文生图的两处文本接口', () => {
  it('LLM 预设与角色管理「生成」都被套用', async () => {
    const { props, onPersistGameSettings } = 建装置();
    const { result } = await 挂载(props);

    await 套用一次(result);

    const 落盘 = 取落盘游戏设置(onPersistGameSettings);
    expect(落盘.文生图系统.LLM.API).toEqual({ ...套用值 });
    expect(落盘.文生图系统.角色AI.API).toEqual({ ...套用值 });
    // 两处自己的采样参数（温度 / 最大输出 / 重试）不能被顺手改掉。
    expect(落盘.文生图系统.LLM.温度).toBe(0.7);
    expect(落盘.文生图系统.LLM.最大输出).toBe(32768);
    expect(落盘.文生图系统.LLM.重试次数).toBe(2);
    expect(落盘.文生图系统.角色AI.温度).toBe(创建默认游戏设置().文生图系统.角色AI.温度);
    expect(落盘.文生图系统.角色AI.最大输出).toBe(创建默认游戏设置().文生图系统.角色AI.最大输出);
  });

  it('原有路由不受影响：变量 / 新闻 / 记忆照旧一起套用', async () => {
    const { props, onPersistGameSettings } = 建装置();
    const { result } = await 挂载(props);

    await 套用一次(result);

    const 落盘 = 取落盘游戏设置(onPersistGameSettings);
    expect(落盘.variableApi).toMatchObject(套用值);
    expect(落盘.新闻系统.api).toMatchObject(套用值);
    expect(落盘.手机系统.api).toMatchObject(套用值);
    expect(落盘.智库系统.api).toMatchObject(套用值);
    expect(落盘.剧情编织系统.api).toMatchObject(套用值);
    expect(落盘.记忆系统.记忆总结API).toMatchObject(套用值);
    expect(落盘.记忆系统.忆庭召回API).toMatchObject(套用值);
    expect(落盘.记忆系统.忆庭精炼API).toMatchObject(套用值);
  });

  it('出图渠道不动：ComfyUI / SD / NovelAI / Banana 保持原样', async () => {
    const 初始 = 创建默认游戏设置();
    初始.文生图系统.comfyui.档案列表[初始.文生图系统.comfyui.当前档案].连接.地址 = 'http://127.0.0.1:8188';
    初始.文生图系统.sd.地址 = 'http://127.0.0.1:7860';
    初始.文生图系统.novelai.Token = 'nai-token';
    初始.文生图系统.banana.APIKey = 'banana-key';

    const { props, onPersistGameSettings } = 建装置(初始);
    const { result } = await 挂载(props);

    await 套用一次(result);

    const 落盘 = 取落盘游戏设置(onPersistGameSettings);
    const 当前档案 = 落盘.文生图系统.comfyui.当前档案;
    expect(落盘.文生图系统.comfyui.档案列表[当前档案].连接.地址).toBe('http://127.0.0.1:8188');
    expect(落盘.文生图系统.sd.地址).toBe('http://127.0.0.1:7860');
    expect(落盘.文生图系统.novelai.Token).toBe('nai-token');
    expect(落盘.文生图系统.banana.APIKey).toBe('banana-key');
  });

  it('必填项缺失时不落盘', async () => {
    const { props, onPersistGameSettings } = 建装置();
    const { result } = await 挂载(props);

    await 套用一次(result, { apiKey: '   ' });

    expect(onPersistGameSettings).not.toHaveBeenCalled();
  });
});

describe('API 方案槽位：角色生成的 API / Key 也要跟着走', () => {
  const 建槽位 = (游戏设置: 游戏设置, 去掉角色生成项 = false): API方案槽位 => {
    const profile: API配置包 = buildApiProfile(主配置, 游戏设置, true);
    if (去掉角色生成项) delete profile.routes.文生图角色生成API;
    return { id: 'slot-1', name: '方案一', savedAt: 1, profile };
  };

  it('载入方案时写回 LLM 预设与角色生成', async () => {
    const 存档里 = 创建默认游戏设置();
    存档里.文生图系统.LLM.API = { ...套用值, model: 'preset-model' };
    存档里.文生图系统.角色AI.API = { ...套用值, model: 'character-model' };

    const { props, onPersistApiProfile } = 建装置();
    const { result } = await 挂载(props);

    await act(async () => {
      await result.current.handleLoadProfileSlot(建槽位(存档里));
    });

    const [, 落盘] = onPersistApiProfile.mock.calls[0];
    expect(落盘.文生图系统.LLM.API.model).toBe('preset-model');
    expect(落盘.文生图系统.角色AI.API).toEqual({ ...套用值, model: 'character-model' });
  });

  it('旧配置包没有这一项时保留本机现值，不被清空', async () => {
    const 本机 = 创建默认游戏设置();
    本机.文生图系统.角色AI.API = {
      provider: 'gemini',
      baseUrl: 'https://local.test/v1',
      apiKey: 'sk-local',
      model: 'local-model',
    };

    const { props, onPersistApiProfile } = 建装置(本机);
    const { result } = await 挂载(props);

    await act(async () => {
      await result.current.handleLoadProfileSlot(建槽位(创建默认游戏设置(), true));
    });

    const [, 落盘] = onPersistApiProfile.mock.calls[0];
    expect(落盘.文生图系统.角色AI.API).toEqual(本机.文生图系统.角色AI.API);
  });
});
