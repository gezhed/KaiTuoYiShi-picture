import { useEffect, useMemo, useState } from 'react';
import type { API设置, API配置项, AI提供商, DeviceSettings, 游戏设置 } from '@/models/settings';
import type { API方案槽位, API配置包, AuxApiProfileState, 已持久化API方案 } from '@/models/apiProfiles';
import { providerOptions } from '@/components/features/Settings/settingsShared';
import {
  MAX_OUTPUT_TIERS,
  inferMaxOutputTier,
  matchModelRecommendation,
  type MaxOutputTier,
} from '@/data/modelRecommendations';
import type { ConnectionTestConfig, ConnectionTestResult } from '@/hooks/useAiTools';
import {
  activateApiConfig,
  addApiConfig,
  findApiConfig,
  listApiConfigs,
  removeApiConfig,
  replaceApiConfigs,
  resolveMainApiConfig,
  updateApiConfig,
} from '@/services/apiConfig';
import {
  buildApiProfile,
  createDefaultAuxApiProfileState,
  downloadApiProfile,
  makeNewConfig,
  normalizeAuxApiProfileState,
  validateApiProfile,
} from '@/utils/apiProfile';

export interface ApiSettingsOverviewProps {
  deviceSettings: DeviceSettings;
  onChange: (s: API设置) => void;
  onGameSettingsChange: (s: 游戏设置) => void;
  onPersistApiSettings: (s: API设置) => Promise<void>;
  onPersistGameSettings: (s: 游戏设置) => Promise<void>;
  onPersistApiProfile: (api: API设置, game: 游戏设置) => Promise<已持久化API方案>;
  onLoadApiProfileSlots: () => Promise<API方案槽位[]>;
  onPersistApiProfileSlots: (slots: API方案槽位[]) => Promise<void>;
  onLoadAuxApiProfiles: () => Promise<Record<string, AuxApiProfileState>>;
  onPersistAuxApiProfiles: (profiles: Record<string, AuxApiProfileState>) => Promise<void>;
  fetchModels: (config: ConnectionTestConfig) => Promise<string[]>;
  testConnection: (config: ConnectionTestConfig) => Promise<ConnectionTestResult>;
}

export function useApiOverviewSettings(props: ApiSettingsOverviewProps) {
  const {
    deviceSettings,
    onChange,
    onGameSettingsChange,
    onPersistApiSettings,
    onPersistGameSettings,
    onPersistApiProfile,
    onLoadApiProfileSlots,
    onPersistApiProfileSlots,
    onLoadAuxApiProfiles,
    onPersistAuxApiProfiles,
    fetchModels,
    testConnection,
  } = props;
  const { apiSettings: settings, gameSettings } = deviceSettings;

  const [selectedId, setSelectedId] = useState<string | null>(
    () => resolveMainApiConfig(settings)?.id ?? null,
  );
  const [newProvider, setNewProvider] = useState<AI提供商>('openai_compatible');
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [profileSlots, setProfileSlots] = useState<API方案槽位[]>([]);
  const [auxProfilesByConfig, setAuxProfilesByConfig] = useState<Record<string, AuxApiProfileState>>({});
  const [auxForm, setAuxForm] = useState<AuxApiProfileState>(() => createDefaultAuxApiProfileState());
  const [auxModelOptions, setAuxModelOptions] = useState<string[]>([]);
  const [loadingAuxModels, setLoadingAuxModels] = useState(false);
  const [auxFetchMessage, setAuxFetchMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  const selectedConfig = useMemo(() => findApiConfig(settings, selectedId), [settings, selectedId]);

  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (prevSelectedId !== selectedId) {
    setPrevSelectedId(selectedId);
    setModelOptions([]);
    setAuxModelOptions([]);
    setTestResult(null);
    setMessage(null);
    setAuxFetchMessage(null);
  }

  useEffect(() => {
    onLoadApiProfileSlots()
      .then((slots) => setProfileSlots(slots))
      .catch(() => setProfileSlots([]));
  }, [onLoadApiProfileSlots]);

  useEffect(() => {
    onLoadAuxApiProfiles()
      .then((saved) => {
        const next: Record<string, AuxApiProfileState> = {};
        for (const [configId, value] of Object.entries(saved)) {
          next[configId] = normalizeAuxApiProfileState(value);
        }
        setAuxProfilesByConfig(next);
      })
      .catch(() => setAuxProfilesByConfig({}));
  }, [onLoadAuxApiProfiles]);

  const [prevAuxSelectedId, setPrevAuxSelectedId] = useState(selectedId);
  const [prevAuxProfiles, setPrevAuxProfiles] = useState(auxProfilesByConfig);
  if (prevAuxSelectedId !== selectedId || prevAuxProfiles !== auxProfilesByConfig) {
    setPrevAuxSelectedId(selectedId);
    setPrevAuxProfiles(auxProfilesByConfig);
    if (selectedId) {
      setAuxForm(auxProfilesByConfig[selectedId] ?? createDefaultAuxApiProfileState());
      setAuxModelOptions([]);
      setAuxFetchMessage(null);
    }
  }

  const configs = listApiConfigs(settings);
  const [prevConfigs, setPrevConfigs] = useState(configs);
  if (prevConfigs !== configs) {
    setPrevConfigs(configs);
    // 选中行被删掉时跟着活动项走；指针由模块维护，这里只同步 UI。
    if (configs.length > 0 && findApiConfig(settings, selectedId) === null) {
      setSelectedId(resolveMainApiConfig(settings)?.id ?? null);
    }
  }

  useEffect(() => {
    if (listApiConfigs(settings).length === 0) {
      onChange(addApiConfig(settings, makeNewConfig('openai_compatible')));
    }
  }, [settings, onChange]);

  const persistAuxForm = async (nextForm: AuxApiProfileState) => {
    setAuxForm(nextForm);
    if (!selectedId) return;
    const nextMap = {
      ...auxProfilesByConfig,
      [selectedId]: nextForm,
    };
    setAuxProfilesByConfig(nextMap);
    await onPersistAuxApiProfiles(nextMap);
  };

  const updateConfig = (patch: Partial<API配置项>) => {
    if (!selectedConfig) return;
    onChange(updateApiConfig(settings, selectedConfig.id, patch));
  };

  const handleCreate = () => {
    const created = makeNewConfig(newProvider);
    onChange(addApiConfig(settings, created));
    setSelectedId(created.id);
    setMessage({ kind: 'info', text: `已新增 ${providerOptions.find((p) => p.value === newProvider)?.label} 配置，请填写后启用。` });
  };

  const handleDelete = () => {
    if (!selectedConfig) return;
    const next = removeApiConfig(settings, selectedConfig.id);
    onChange(next);
    setSelectedId(next.activeConfigId);
  };

  const handleActivate = () => {
    if (!selectedConfig) return;
    onChange(activateApiConfig(settings, selectedConfig.id));
  };

  const handleSave = async () => {
    if (!selectedConfig) return;
    const updated = updateApiConfig(settings, selectedConfig.id, {});
    onChange(updated);
    try {
      await onPersistApiSettings(updated);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      setMessage({ kind: 'error', text: `保存失败：${(e as Error).message}` });
    }
  };

  const applyApiProfile = async (profile: API配置包) => {
    const nextApiSettings: API设置 = replaceApiConfigs(profile.apiSettings);
    const nextGameSettings: 游戏设置 = {
      ...gameSettings,
      enableClaudeMode: profile.enableClaudeMode ?? gameSettings.enableClaudeMode,
      deepSeekMainMode: profile.deepSeekMainMode ?? gameSettings.deepSeekMainMode,
      variableApi: profile.routes.variableApi,
      新闻系统: { ...gameSettings.新闻系统, api: profile.routes.新闻系统 },
      手机系统: { ...gameSettings.手机系统, api: profile.routes.手机系统 },
      智库系统: { ...gameSettings.智库系统, api: profile.routes.智库系统 },
      剧情编织系统: { ...gameSettings.剧情编织系统, api: profile.routes.剧情编织系统 },
      记忆系统: {
        ...gameSettings.记忆系统,
        记忆总结API: profile.routes.记忆总结API,
        忆庭召回API: profile.routes.忆庭召回API,
        忆庭精炼API: profile.routes.忆庭精炼API,
      },
      文生图系统: {
        ...gameSettings.文生图系统,
        LLM: {
          ...gameSettings.文生图系统.LLM,
          API: profile.routes.文生图词组转化器API,
        },
      },
    };
    const persisted = await onPersistApiProfile(nextApiSettings, nextGameSettings);
    onChange(persisted.apiSettings);
    onGameSettingsChange(persisted.gameSettings);
    setSelectedId(resolveMainApiConfig(persisted.apiSettings)?.id ?? null);
  };

  const persistProfileSlots = async (slots: API方案槽位[]) => {
    setProfileSlots(slots);
    await onPersistApiProfileSlots(slots);
  };

  const handleSaveProfileSlot = async () => {
    const defaultName = selectedConfig?.name || `API 方案 ${profileSlots.length + 1}`;
    const name = window.prompt('给当前 API 方案起个名字：', defaultName)?.trim();
    if (!name) return;
    const slot: API方案槽位 = {
      id: `api_profile_${Date.now()}`,
      name,
      savedAt: Date.now(),
      profile: buildApiProfile(settings, gameSettings, true),
    };
    await persistProfileSlots([slot, ...profileSlots].slice(0, 12));
    setMessage({ kind: 'info', text: `已保存 API 方案：${name}` });
  };

  const handleLoadProfileSlot = async (slot: API方案槽位) => {
    await applyApiProfile(slot.profile);
    setMessage({ kind: 'info', text: `已切换到 API 方案：${slot.name}` });
  };

  const handleDeleteProfileSlot = async (slot: API方案槽位) => {
    if (!window.confirm(`删除 API 方案「${slot.name}」？`)) return;
    await persistProfileSlots(profileSlots.filter((item) => item.id !== slot.id));
    setMessage({ kind: 'info', text: `已删除 API 方案：${slot.name}` });
  };

  const handleExportProfile = (includeApiKeys: boolean) => {
    if (
      includeApiKeys &&
      !window.confirm('私人 API 配置包会包含 API Key。只适合自己换设备迁移，不要发给别人。确认导出吗？')
    ) {
      return;
    }
    downloadApiProfile(buildApiProfile(settings, gameSettings, includeApiKeys));
    setMessage({
      kind: 'info',
      text: includeApiKeys ? '已导出私人 API 配置包，请勿分享。' : '已导出安全 API 配置包，API Key 已清空。',
    });
  };

  const handleImportProfile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const profile = validateApiProfile(JSON.parse(await file.text()));
        await applyApiProfile(profile);
        setMessage({
          kind: 'info',
          text: profile.includeApiKeys ? '已导入私人 API 配置包。' : '已导入 API 配置包；如未包含 Key，请补填密钥。',
        });
      } catch (e) {
        setMessage({ kind: 'error', text: `导入失败：${(e as Error).message}` });
      }
    };
    input.click();
  };

  const handleApplyAuxModel = async () => {
    const provider = auxForm.provider;
    const baseUrl = auxForm.baseUrl.trim();
    const apiKey = auxForm.apiKey.trim();
    const model = auxForm.model.trim();
    if (!baseUrl || !apiKey) {
      setMessage({ kind: 'error', text: '请先填写其他 API 的 Base URL 和 API Key。' });
      return;
    }
    if (!model) {
      setMessage({ kind: 'error', text: '请先填写要套用到其他 API 的模型 ID。' });
      return;
    }
    const auxApiPatch = { provider, baseUrl, apiKey, model };
    const nextGameSettings: 游戏设置 = {
      ...gameSettings,
      variableApi: { ...gameSettings.variableApi, ...auxApiPatch },
      新闻系统: { ...gameSettings.新闻系统, api: { ...gameSettings.新闻系统.api, ...auxApiPatch } },
      手机系统: { ...gameSettings.手机系统, api: { ...gameSettings.手机系统.api, ...auxApiPatch } },
      智库系统: { ...gameSettings.智库系统, api: { ...gameSettings.智库系统.api, ...auxApiPatch } },
      剧情编织系统: { ...gameSettings.剧情编织系统, api: { ...gameSettings.剧情编织系统.api, ...auxApiPatch } },
      记忆系统: {
        ...gameSettings.记忆系统,
        记忆总结API: { ...gameSettings.记忆系统.记忆总结API, ...auxApiPatch },
        忆庭召回API: { ...gameSettings.记忆系统.忆庭召回API, ...auxApiPatch },
        忆庭精炼API: { ...gameSettings.记忆系统.忆庭精炼API, ...auxApiPatch },
      },
    };
    onGameSettingsChange(nextGameSettings);
    await onPersistGameSettings(nextGameSettings);
    setMessage({ kind: 'info', text: `已把其他文本 API 统一套用为：${provider} / ${model}` });
  };

  const handleFetchAuxModels = async () => {
    const baseUrl = auxForm.baseUrl.trim();
    const apiKey = auxForm.apiKey.trim();
    if (!baseUrl || !apiKey) {
      setAuxFetchMessage({ kind: 'error', text: '请先填写其他 API 的 Base URL 和 API Key。' });
      return;
    }
    setLoadingAuxModels(true);
    setAuxFetchMessage(null);
    try {
      const list = await fetchModels({
        id: 'aux-api-preview',
        name: '其他 API',
        provider: auxForm.provider,
        baseUrl,
        apiKey,
        model: auxForm.model.trim(),
        enableClaudeMode: gameSettings.enableClaudeMode,
        retryCount: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      setAuxModelOptions(list);
      setAuxFetchMessage({ kind: 'info', text: `获取到 ${list.length} 个模型，请从列表选择。` });
    } catch (e) {
      setAuxFetchMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setLoadingAuxModels(false);
    }
  };

  const handleFetchModels = async () => {
    if (!selectedConfig) return;
    setLoadingModels(true);
    setMessage(null);
    try {
      const list = await fetchModels({
        ...selectedConfig,
        enableClaudeMode: gameSettings.enableClaudeMode,
        retryCount: selectedConfig.retryCount ?? 2,
      });
      setModelOptions(list);
      setMessage({ kind: 'info', text: `获取到 ${list.length} 个模型。` });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setLoadingModels(false);
    }
  };

  const handleTest = async () => {
    if (!selectedConfig) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection({
        ...selectedConfig,
        enableClaudeMode: gameSettings.enableClaudeMode,
        retryCount: selectedConfig.retryCount ?? 2,
      });
      setTestResult(result);
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const recommendation = selectedConfig ? matchModelRecommendation(selectedConfig.model) : null;
  const currentTier = inferMaxOutputTier(selectedConfig?.maxTokens);

  const handleTierChange = (tier: MaxOutputTier) => {
    if (!selectedConfig) return;
    const preset = MAX_OUTPUT_TIERS.find((p) => p.id === tier);
    if (!preset) return;
    if (preset.value !== undefined) {
      updateConfig({ maxTokens: preset.value });
    } else {
      if (!selectedConfig.maxTokens || [8192, 32768, 65536].includes(selectedConfig.maxTokens)) {
        updateConfig({ maxTokens: 4096 });
      }
    }
  };

  return {
    selectedId,
    setSelectedId,
    newProvider,
    setNewProvider,
    modelOptions,
    loadingModels,
    testing,
    testResult,
    message,
    savedFlash,
    profileSlots,
    auxForm,
    auxModelOptions,
    loadingAuxModels,
    auxFetchMessage,
    selectedConfig,
    recommendation,
    currentTier,
    settings,
    updateConfig,
    persistAuxForm,
    handleCreate,
    handleDelete,
    handleActivate,
    handleSave,
    handleSaveProfileSlot,
    handleLoadProfileSlot,
    handleDeleteProfileSlot,
    handleExportProfile,
    handleImportProfile,
    handleApplyAuxModel,
    handleFetchAuxModels,
    handleFetchModels,
    handleTest,
    handleTierChange,
  };
}
