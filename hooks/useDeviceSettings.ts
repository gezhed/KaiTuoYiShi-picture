import { useCallback } from 'react';
import { loadSetting, saveSetting, saveSettings } from '@/services/storage/settings';
import { devLog, devLogError } from '@/utils/devLog';
import type { API设置, 游戏设置, 主题预设 } from '@/models/settings';
import { 归一化游戏设置 } from '@/utils/gameSettingsHydration';
import { hydratePersistedApiSettings } from '@/utils/apiSettingsHydration';
import { listApiConfigs } from '@/services/apiConfig';
import type { API方案槽位, AuxApiProfileState, 已持久化API方案 } from '@/models/apiProfiles';
import type { GitHubCloudSaveConfig } from '@/services/githubCloudSave';
import type { 世界书 } from '@/models/worldbook';

function 归一化世界书列表(books: 世界书[]): 世界书[] {
  return Array.isArray(books) ? books : [];
}

const MAX_API_PROFILE_SLOTS = 12;

function 归一化API方案槽位列表(value: unknown): API方案槽位[] {
  return Array.isArray(value) ? (value as API方案槽位[]) : [];
}

function 归一化辅助API配置表(value: unknown): Record<string, AuxApiProfileState> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, AuxApiProfileState>)
    : {};
}

export interface DeviceSettingsActions {
  persistGameSettings: (next: 游戏设置) => Promise<void>;
  persistApiSettings: (next: API设置) => Promise<void>;
  persistTheme: (next: 主题预设) => Promise<void>;
  persistWorldbooks: (next: 世界书[]) => Promise<void>;
  persistApiProfile: (api: API设置, game: 游戏设置) => Promise<已持久化API方案>;
  loadApiProfileSlots: () => Promise<API方案槽位[]>;
  persistApiProfileSlots: (next: API方案槽位[]) => Promise<void>;
  loadAuxApiProfiles: () => Promise<Record<string, AuxApiProfileState>>;
  persistAuxApiProfiles: (next: Record<string, AuxApiProfileState>) => Promise<void>;
  loadGitHubCloudSaveConfig: () => Promise<GitHubCloudSaveConfig | null>;
  persistGitHubCloudSaveConfig: (next: GitHubCloudSaveConfig) => Promise<void>;
}

export function useDeviceSettings(): DeviceSettingsActions {
  const persistGameSettings = useCallback(async (next: 游戏设置) => {
    const normalized = 归一化游戏设置(next);
    try {
      await saveSetting('gameSettings', normalized);
      devLog('ui', 'persist-game-settings', {
      });
    } catch (err) {
      devLogError('ui', 'persist-game-settings-failed', err);
      throw err;
    }
  }, []);

  const persistApiSettings = useCallback(async (next: API设置) => {
    const normalized = hydratePersistedApiSettings(next);
    try {
      await saveSetting('apiSettings', normalized);
      devLog('ui', 'persist-api-settings', { configs: listApiConfigs(normalized).length });
    } catch (err) {
      devLogError('ui', 'persist-api-settings-failed', err);
      throw err;
    }
  }, []);

  const persistTheme = useCallback(async (next: 主题预设) => {
    try {
      await saveSetting('theme', next);
      devLog('ui', 'persist-theme', { theme: next });
    } catch (err) {
      devLogError('ui', 'persist-theme-failed', err);
      throw err;
    }
  }, []);

  const persistWorldbooks = useCallback(async (next: 世界书[]) => {
    const normalized = 归一化世界书列表(next);
    try {
      await saveSetting('worldbooks', normalized);
      devLog('ui', 'persist-worldbooks', { count: normalized.length });
    } catch (err) {
      devLogError('ui', 'persist-worldbooks-failed', err);
      throw err;
    }
  }, []);

  const persistApiProfile = useCallback(async (api: API设置, game: 游戏设置) => {
    const normalizedApi = hydratePersistedApiSettings(api);
    const normalizedGame = 归一化游戏设置(game);
    try {
      await saveSettings([
        ['apiSettings', normalizedApi],
        ['gameSettings', normalizedGame],
      ]);
      devLog('ui', 'persist-api-profile', { configs: listApiConfigs(normalizedApi).length });
      return { apiSettings: normalizedApi, gameSettings: normalizedGame };
    } catch (err) {
      devLogError('ui', 'persist-api-profile-failed', err);
      throw err;
    }
  }, []);

  const loadApiProfileSlots = useCallback(async () => {
    try {
      const saved = await loadSetting<unknown>('apiProfileSlots');
      const slots = 归一化API方案槽位列表(saved);
      devLog('ui', 'load-api-profile-slots', { count: slots.length });
      return slots;
    } catch (err) {
      devLogError('ui', 'load-api-profile-slots-failed', err);
      throw err;
    }
  }, []);

  const persistApiProfileSlots = useCallback(async (next: API方案槽位[]) => {
    const capped = next.slice(0, MAX_API_PROFILE_SLOTS);
    try {
      await saveSetting('apiProfileSlots', capped);
      devLog('ui', 'persist-api-profile-slots', { count: capped.length });
    } catch (err) {
      devLogError('ui', 'persist-api-profile-slots-failed', err);
      throw err;
    }
  }, []);

  const loadAuxApiProfiles = useCallback(async () => {
    try {
      const saved = await loadSetting<unknown>('apiAuxProfileStates');
      const profiles = 归一化辅助API配置表(saved);
      devLog('ui', 'load-aux-api-profiles', { count: Object.keys(profiles).length });
      return profiles;
    } catch (err) {
      devLogError('ui', 'load-aux-api-profiles-failed', err);
      throw err;
    }
  }, []);

  const persistAuxApiProfiles = useCallback(async (next: Record<string, AuxApiProfileState>) => {
    try {
      await saveSetting('apiAuxProfileStates', next);
      devLog('ui', 'persist-aux-api-profiles', { count: Object.keys(next).length });
    } catch (err) {
      devLogError('ui', 'persist-aux-api-profiles-failed', err);
      throw err;
    }
  }, []);

  const loadGitHubCloudSaveConfig = useCallback(async () => {
    try {
      const saved = await loadSetting<GitHubCloudSaveConfig>('githubCloudSaveConfig');
      devLog('ui', 'load-github-cloud-save-config', { hasConfig: saved !== null });
      return saved;
    } catch (err) {
      devLogError('ui', 'load-github-cloud-save-config-failed', err);
      throw err;
    }
  }, []);

  const persistGitHubCloudSaveConfig = useCallback(async (next: GitHubCloudSaveConfig) => {
    try {
      await saveSetting('githubCloudSaveConfig', next);
      devLog('ui', 'persist-github-cloud-save-config', { owner: next.owner, repo: next.repo });
    } catch (err) {
      devLogError('ui', 'persist-github-cloud-save-config-failed', err);
      throw err;
    }
  }, []);

  return {
    persistGameSettings,
    persistApiSettings,
    persistTheme,
    persistWorldbooks,
    persistApiProfile,
    loadApiProfileSlots,
    persistApiProfileSlots,
    loadAuxApiProfiles,
    persistAuxApiProfiles,
    loadGitHubCloudSaveConfig,
    persistGitHubCloudSaveConfig,
  };
}
