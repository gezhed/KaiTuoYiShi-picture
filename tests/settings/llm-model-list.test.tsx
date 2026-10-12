// @vitest-environment jsdom
/**
 * 「测试连接并读取模型列表」。
 *
 * 起因（用户 bug 3）：文生图里的两条模型链路——LLM 预设与角色 AI——
 * 只有四个手填输入框，没有其他面板都有的「先连上、再从列表里选模型」这一步。
 * 这里锁定修复后的行为，并顺带锁住合并语义：覆盖字段留空时用主 API。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LlmSettingsPanel } from '@/components/features/Settings/LlmSettingsPanel';
import { CharacterAIPanel } from '@/components/features/Settings/CharacterAIPanel';
import { 建候选配置 } from '@/services/ai/imageGen/llmConfig';
import { 创建默认LLM设置, 创建默认文生图系统设置 } from '@/models/genSystem';
import type { 文生图系统设置 } from '@/models/genSystem';
import { 创建默认游戏设置, 创建空API设置 } from '@/models/settings';
import type { ConnectionTestConfig } from '@/hooks/useAiTools';

const 主API = {
  id: 'main',
  name: '主接口',
  provider: 'openai_compatible' as const,
  baseUrl: 'https://main.example/v1',
  apiKey: 'sk-main',
  model: 'main-model',
  createdAt: 0,
  updatedAt: 0,
};

function 建游戏设置(文生图: 文生图系统设置) {
  const 设置 = 创建默认游戏设置();
  设置.文生图系统 = 文生图;
  return 设置;
}

describe('建候选配置（合并语义）', () => {
  const apiSettings = { ...创建空API设置(), configs: [主API], activeConfigId: 'main' };

  it('覆盖字段留空时回退主 API，地址与密钥都取得到', () => {
    const 配置 = 建候选配置(建游戏设置(创建默认文生图系统设置()), apiSettings, {
      provider: '', baseUrl: '', apiKey: '', model: '',
    }, '__test__', '测试');
    expect(配置?.baseUrl).toBe('https://main.example/v1');
    expect(配置?.apiKey).toBe('sk-main');
    expect(配置?.model).toBe('main-model');
  });

  it('覆盖字段优先于主 API', () => {
    const 配置 = 建候选配置(建游戏设置(创建默认文生图系统设置()), apiSettings, {
      provider: '', baseUrl: 'https://local.example/v1', apiKey: 'local-key', model: '',
    }, '__test__', '测试');
    expect(配置?.baseUrl).toBe('https://local.example/v1');
    expect(配置?.apiKey).toBe('local-key');
  });

  it('地址两处都取不到时返回 null（界面据此提示先配主 API）', () => {
    const 配置 = 建候选配置(建游戏设置(创建默认文生图系统设置()), 创建空API设置(), {
      provider: '', baseUrl: '', apiKey: '', model: '',
    }, '__test__', '测试');
    expect(配置).toBeNull();
  });
});

describe('LLM 预设面板：读取模型列表', () => {
  it('点按钮把合并后的配置交给 fetchModels，并把列表渲染成下拉', async () => {
    const apiSettings = { ...创建空API设置(), configs: [主API], activeConfigId: 'main' };
    const fetchModels = vi.fn(async (_配置: ConnectionTestConfig) => ['gpt-4o-mini', 'gpt-4o', 'local-7b']);
    const 候选配置 = 建候选配置(
      建游戏设置(创建默认文生图系统设置()),
      apiSettings,
      { provider: '', baseUrl: '', apiKey: '', model: '' },
      '__image_illustration_converter__',
      '文生图LLM',
    );
    const onChange = vi.fn();

    render(
      <LlmSettingsPanel
        LLM={创建默认LLM设置()}
        onChange={onChange}
        主配置模型={主API.model}
        主配置地址={主API.baseUrl}
        候选配置={候选配置}
        onFetchModels={fetchModels}
      />,
    );

    fireEvent.click(screen.getByText('测试连接并读取模型'));
    await waitFor(() => expect(fetchModels).toHaveBeenCalledTimes(1));
    expect(fetchModels.mock.calls[0][0]).toMatchObject({ baseUrl: 'https://main.example/v1', apiKey: 'sk-main' });

    await waitFor(() => expect(screen.getByText(/读到 3 个模型/)).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue(/从列表选择/), { target: { value: 'gpt-4o' } });
    expect((onChange.mock.calls.at(-1)?.[0] as ReturnType<typeof 创建默认LLM设置>).API.model).toBe('gpt-4o');
  });

  it('接口读不通时把错误显示出来，而不是静默', async () => {
    const apiSettings = { ...创建空API设置(), configs: [主API], activeConfigId: 'main' };
    const fetchModels = vi.fn(async (_配置: ConnectionTestConfig): Promise<string[]> => {
      throw new Error('缺少 API Key');
    });
    const 候选配置 = 建候选配置(
      建游戏设置(创建默认文生图系统设置()),
      apiSettings,
      { provider: '', baseUrl: '', apiKey: '', model: '' },
      '__image_illustration_converter__',
      '文生图LLM',
    );
    render(<LlmSettingsPanel LLM={创建默认LLM设置()} onChange={() => {}} 候选配置={候选配置} onFetchModels={fetchModels} />);
    fireEvent.click(screen.getByText('测试连接并读取模型'));
    await waitFor(() => expect(screen.getByText(/读取模型失败：缺少 API Key/)).toBeTruthy());
  });

  it('没接模型列表能力时不显示该按钮（只读预览仍可用）', () => {
    render(<LlmSettingsPanel LLM={创建默认LLM设置()} onChange={() => {}} />);
    expect(screen.queryByText('测试连接并读取模型')).toBeNull();
  });
});

describe('角色 AI 面板：读取模型列表', () => {
  function 建系统(): 文生图系统设置 {
    const 系统 = 创建默认文生图系统设置();
    系统.角色卡.char_1 = {
      id: 'char_1', enabled: true, aliases: [], outfits: [], selectedOutfitId: '',
      photoMedia: [], audioMedia: [], selectedPhotoId: '', selectedAudioId: '',
      photoPrompt: '', sendPhoto: false, 位置: null, createdAt: 0, updatedAt: 0,
      nameCN: '流萤', nameEN: 'Firefly', characterTraits: '', facialFeatures: '',
      facialFeaturesBack: '', upperBodySFW: '', upperBodySFWBack: '', fullBodySFW: '',
      fullBodySFWBack: '', upperBodyNSFW: '', upperBodyNSFWBack: '', fullBodyNSFW: '',
      fullBodyNSFWBack: '', negative: '',
    };
    return 系统;
  }

  it('角色 AI 的覆盖字段也能连接并选模型', async () => {
    const apiSettings = { ...创建空API设置(), configs: [主API], activeConfigId: 'main' };
    const 系统 = 建系统();
    const fetchModels = vi.fn(async (_配置: ConnectionTestConfig) => ['deepseek-chat', 'deepseek-reasoner']);
    const onPatch = vi.fn();
    const 候选配置 = 建候选配置(
      建游戏设置(系统),
      apiSettings,
      { provider: '', baseUrl: '', apiKey: '', model: '' },
      '__character_ai__',
      '角色AI',
    );

    render(
      <CharacterAIPanel
        设置={系统}
        onPatch={onPatch}
        角色列表={Object.values(系统.角色卡)}
        on选择角色={() => {}}
        写入角色={() => {}}
        候选配置={候选配置}
        主API模型={主API.model}
        主API地址={主API.baseUrl}
        onFetchModels={fetchModels}
      />,
    );

    fireEvent.click(screen.getByText('测试连接并读取模型'));
    await waitFor(() => expect(fetchModels).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/读到 2 个模型/)).toBeTruthy());

    fireEvent.change(screen.getByDisplayValue(/从列表选择/), { target: { value: 'deepseek-chat' } });
    const 最后一次 = onPatch.mock.calls.at(-1)?.[0] as Partial<文生图系统设置>;
    expect(最后一次.角色AI?.API.model).toBe('deepseek-chat');
  });
});
