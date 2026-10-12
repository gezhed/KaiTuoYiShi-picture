import * as z from 'zod';
import type { AI提供商, API设置, API配置项, 游戏设置 } from '@/models/settings';
import { API配置包信封Schema } from '@/models/apiProfiles';
import type { API配置包, AuxApiProfileState } from '@/models/apiProfiles';
import { providerOptions } from '@/data/apiProviders';
import { listApiConfigs } from '@/services/apiConfig';

export function createDefaultAuxApiProfileState(provider: AI提供商 = 'gemini'): AuxApiProfileState {
  const meta = providerOptions.find((p) => p.value === provider) ?? providerOptions[0];
  return {
    provider: meta.value,
    baseUrl: meta.defaultBaseUrl,
    apiKey: '',
    model: meta.defaultModel,
  };
}

export function normalizeAuxApiProfileState(input?: Partial<AuxApiProfileState>): AuxApiProfileState {
  const provider = providerOptions.find((p) => p.value === input?.provider) ?? providerOptions[0];
  return {
    provider: provider.value,
    baseUrl: input?.baseUrl ?? provider.defaultBaseUrl,
    apiKey: input?.apiKey ?? '',
    model: input?.model ?? provider.defaultModel,
  };
}

export function makeNewConfig(provider: AI提供商): API配置项 {
  const meta = providerOptions.find((p) => p.value === provider) ?? providerOptions[0];
  return {
    id: `config_${Date.now()}`,
    name: `${meta.label} 配置`,
    provider,
    baseUrl: meta.defaultBaseUrl,
    apiKey: '',
    model: meta.defaultModel,
    maxTokens: 8192,
    temperature: 0.8,
    retryCount: 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function cloneWithoutKeys<T>(value: T, includeApiKeys: boolean): T {
  const cloned = JSON.parse(JSON.stringify(value)) as T;
  if (includeApiKeys) return cloned;
  const clear = (target: unknown) => {
    if (target && typeof target === 'object' && 'apiKey' in target) {
      const holder = target as { apiKey?: string };
      holder.apiKey = '';
    }
  };
  const root = cloned as unknown as API配置包;
  for (const config of listApiConfigs(root.apiSettings)) clear(config);
  for (const item of Object.values(root.routes)) clear(item);
  return cloned;
}

export function buildApiProfile(settings: API设置, gameSettings: 游戏设置, includeApiKeys: boolean): API配置包 {
  return cloneWithoutKeys({
    app: 'KaiTuoYiShi',
    kind: 'api-profile',
    version: 1,
    exportedAt: new Date().toISOString(),
    includeApiKeys,
    enableClaudeMode: gameSettings.enableClaudeMode,
    deepSeekMainMode: gameSettings.deepSeekMainMode,
    apiSettings: settings,
    routes: {
      variableApi: gameSettings.variableApi,
      新闻系统: gameSettings.新闻系统.api,
      手机系统: gameSettings.手机系统.api,
      智库系统: gameSettings.智库系统.api,
      剧情编织系统: gameSettings.剧情编织系统.api,
      记忆总结API: gameSettings.记忆系统.记忆总结API,
      忆庭召回API: gameSettings.记忆系统.忆庭召回API,
      忆庭精炼API: gameSettings.记忆系统.忆庭精炼API,
      文生图词组转化器API: gameSettings.文生图系统.LLM.API,
    },
  }, includeApiKeys);
}

function 配置包错误文案(error: z.ZodError): string {
  const paths = new Set(error.issues.map((issue) => issue.path[0]));
  if (paths.has('version')) return 'API 配置包版本不兼容，请更新客户端后再导入。';
  if (paths.has('apiSettings') || paths.has('routes')) return 'API 配置包缺少必要配置。';
  return '不是有效的开拓轶事 API 配置包。';
}

export function validateApiProfile(input: unknown): API配置包 {
  const result = API配置包信封Schema.safeParse(input);
  if (!result.success) {
    throw new Error(配置包错误文案(result.error));
  }
  return result.data;
}

export function downloadApiProfile(profile: API配置包): void {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.download = `KaiTuoYiShi-api-profile-${profile.includeApiKeys ? 'private' : 'safe'}-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
