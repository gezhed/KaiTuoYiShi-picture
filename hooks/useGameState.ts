import { useState, useRef, useEffect, useLayoutEffect, useCallback, useSyncExternalStore } from 'react';
import type { 角色数据结构 } from '@/models/character';
import { 创建空角色 } from '@/models/character';
import type { 世界状态 } from '@/models/world';
import { 创建空世界状态, 归一化世界状态 } from '@/models/world';
import type { 聊天消息 } from '@/models/chat';
import type { 记忆系统 } from '@/models/memory';
import { 创建空记忆系统 } from '@/models/memory';
import type { 忆庭系统 } from '@/models/yiting';
import { 创建空忆庭系统 } from '@/models/yiting';
import type { 智库系统 } from '@/models/zhiku';
import { 创建空智库系统 } from '@/models/zhiku';
import type { ZhikuCatalogStatus } from '@/models/zhiku';
import type { 手机系统 } from '@/models/phone';
import { 创建空手机系统 } from '@/models/phone';
import type { NPC记录 } from '@/models/npc';
import type { 相册系统 } from '@/models/imageGeneration';
import { 创建空相册系统 } from '@/models/imageGeneration';
import type { 新闻条目 } from '@/models/news';
import type { 剧情节点 } from '@/models/plot';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import { 创建空剧情编织系统 } from '@/models/storyWeaving';
import type { 变量命令批次 } from '@/models/variableCommand';
import type { 队列任务记录 } from '@/models/queueTask';
import type { API设置, DeviceSettings, 游戏设置, 主题预设 } from '@/models/settings';
import {
  创建空API设置,
  创建默认游戏设置,
  LAST_VIEW_STORAGE_KEY,
} from '@/models/settings';
import {
  ZHIKU_CHARACTER_REBUILD_MIGRATION_KEY,
  bundledZhikuPresets,
  fetchAllBundledZhikuPresetsText,
  mergeBundledZhikuSystem,
  加工内置智库目录,
  投影持久化智库系统,
} from '@/data/zhikuPreset';
import { bundledStoryWeavingPresets, fetchAllBundledStoryWeavingPresetsText, hydratePersistedStoryWeavingSystem, 加工内置原著系列, 投影持久化剧情编织系统 } from '@/data/storyWeavingPreset';
import { createPresetLoader, type PresetLoader, type PresetSnapshot } from '@/services/presetLoader';
import type { ResourceProgress } from '@/data/resourceBundle';
import { bootPerfStage, bootPerfSummary } from '@/utils/bootPerf';
import type { 世界书 } from '@/models/worldbook';
import { applyTheme, normalizeThemeId } from '@/styles/themes';
import { deleteSetting, loadSetting, saveSetting, saveSetting as saveUiSetting } from '@/services/storage/settings';
import { hasAnySave, validateRerollParent } from '@/services/storage/saveCrud';
import { reconcileBuiltinWorldbooks, WORLDBOOK_STORAGE_KEY } from '@/utils/worldbook';
import { createBuiltinWorldbooks } from '@/data/worldbookPresets';
import { loadAllBundledWorldbookPresets } from '@/data/openingWorldbookPreset';
import { devLog, devLogError } from '@/utils/devLog';
import { hydratePersistedGameSettings } from '@/utils/gameSettingsHydration';
import { hydratePersistedApiSettings } from '@/utils/apiSettingsHydration';
import { bootRestoreFromNewest } from '@/hooks/useGame/saveLoadWorkflow';
import { useActiveWorkflow, type ActiveWorkflowStore } from '@/hooks/useGame/activeWorkflow';
import type { TurnPhase } from '@/models/turnRecovery';
import type { 存档树元信息 } from '@/utils/saveTree';

export type ViewState = 'home' | 'new_game' | 'game';

async function bootStage<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    bootPerfStage(name, performance.now() - start);
  }
}

export interface UseGameStateReturn {
  view: ViewState;
  setView: React.Dispatch<React.SetStateAction<ViewState>>;
  旅人: 角色数据结构;
  set旅人: React.Dispatch<React.SetStateAction<角色数据结构>>;
  世界: 世界状态;
  set世界: React.Dispatch<React.SetStateAction<世界状态>>;
  chatHistory: 聊天消息[];
  setChatHistory: React.Dispatch<React.SetStateAction<聊天消息[]>>;
  记忆: 记忆系统;
  set记忆: React.Dispatch<React.SetStateAction<记忆系统>>;
  忆庭: 忆庭系统;
  set忆庭: React.Dispatch<React.SetStateAction<忆庭系统>>;
  智库: 智库系统;
  set智库: React.Dispatch<React.SetStateAction<智库系统>>;
  bootSettled: boolean;
  presetLoader: PresetLoader;
  presetLoad: PresetSnapshot;
  presetDataReady: boolean;
  zhikuCatalogStatus: ZhikuCatalogStatus;
  retryPresetLoad: () => void;
  手机: 手机系统;
  set手机: React.Dispatch<React.SetStateAction<手机系统>>;
  NPC: NPC记录[];
  setNPC: React.Dispatch<React.SetStateAction<NPC记录[]>>;
  相册: 相册系统;
  set相册: React.Dispatch<React.SetStateAction<相册系统>>;
  新闻: 新闻条目[];
  set新闻: React.Dispatch<React.SetStateAction<新闻条目[]>>;
  剧情: 剧情节点[];
  set剧情: React.Dispatch<React.SetStateAction<剧情节点[]>>;
  剧情编织: 剧情编织系统;
  set剧情编织: React.Dispatch<React.SetStateAction<剧情编织系统>>;
  variableBatches: 变量命令批次[];
  setVariableBatches: React.Dispatch<React.SetStateAction<变量命令批次[]>>;
  queueTasks: 队列任务记录[];
  setQueueTasks: React.Dispatch<React.SetStateAction<队列任务记录[]>>;
  deviceSettings: DeviceSettings;
  macroGlobalVars: Record<string, string>;
  setMacroGlobalVars: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  worldbookTriggerStates: Record<string, number>;
  setWorldbookTriggerStates: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setDeviceSettings: React.Dispatch<React.SetStateAction<DeviceSettings>>;
  setDeviceApiSettings: React.Dispatch<React.SetStateAction<API设置>>;
  setDeviceGameSettings: React.Dispatch<React.SetStateAction<游戏设置>>;
  setDeviceTheme: React.Dispatch<React.SetStateAction<主题预设>>;
  setDeviceWorldbooks: React.Dispatch<React.SetStateAction<世界书[]>>;
  hasSave: boolean;
  setHasSave: React.Dispatch<React.SetStateAction<boolean>>;
  turnCount: number;
  setTurnCount: React.Dispatch<React.SetStateAction<number>>;
  turnPhase: TurnPhase | null;
  setTurnPhase: React.Dispatch<React.SetStateAction<TurnPhase | null>>;
  activeWorkflow: ActiveWorkflowStore;
  activeTreeMeta: 存档树元信息 | null;
  setActiveTreeMeta: React.Dispatch<React.SetStateAction<存档树元信息 | null>>;
  rerollParentStatus: 'pending' | 'valid' | 'invalid';
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function useGameState(): UseGameStateReturn {
  const [view, setView] = useState<ViewState>('home');
  const [旅人, set旅人] = useState<角色数据结构>(创建空角色);
  const [世界, set世界] = useState<世界状态>(() => 归一化世界状态(创建空世界状态()));
  const [chatHistory, setChatHistory] = useState<聊天消息[]>([]);
  const [记忆, set记忆] = useState<记忆系统>(创建空记忆系统);
  const [忆庭, set忆庭] = useState<忆庭系统>(创建空忆庭系统);
  const [智库, set智库] = useState<智库系统>(创建空智库系统);
  const [bootSettled, setBootSettled] = useState(false);
  const [手机, set手机] = useState<手机系统>(创建空手机系统);
  const [NPC, setNPC] = useState<NPC记录[]>([]);
  const [相册, set相册] = useState<相册系统>(创建空相册系统);
  const [新闻, set新闻] = useState<新闻条目[]>([]);
  const [剧情, set剧情] = useState<剧情节点[]>([]);
  const [剧情编织, set剧情编织] = useState<剧情编织系统>(创建空剧情编织系统);

  const [presetLoader] = useState(() => createPresetLoader({
    story: {
      total: bundledStoryWeavingPresets.length,
      fetch: (onProgress: ResourceProgress) => bootStage('story:network', () => fetchAllBundledStoryWeavingPresetsText(onProgress)),
      process: (texts) => bootStage('story:process', async () => {
        const bundled = 加工内置原著系列(texts);
        const saved = await bootStage<剧情编织系统 | null>('story:idb-read', () => loadSetting<剧情编织系统>('storyWeavingSystem'));
        const merged = await bootStage<剧情编织系统>('story:merge', () => hydratePersistedStoryWeavingSystem(saved, bundled));
        set剧情编织(merged);
        await bootStage('story:idb-write', () => saveSetting('storyWeavingSystem', 投影持久化剧情编织系统(merged)));
        return merged;
      }),
    },
    zhiku: {
      total: bundledZhikuPresets.length,
      fetch: (onProgress: ResourceProgress) => bootStage('zhiku:network', () => fetchAllBundledZhikuPresetsText({ onProgress })),
      process: (texts) => bootStage('zhiku:process', async () => {
        const bundled = 加工内置智库目录(texts);
        const saved = await bootStage<{ value: 智库系统 | null; migrationAt: number | null }>('zhiku:idb-read', async () => {
          const [value, migrationAt] = await Promise.all([
            loadSetting<智库系统>('zhikuSystem'),
            loadSetting<number>(ZHIKU_CHARACTER_REBUILD_MIGRATION_KEY),
          ]);
          return { value, migrationAt };
        });
        const migrationAt = saved.migrationAt ?? Date.now();
        const merged = await bootStage<智库系统>('zhiku:merge', () => mergeBundledZhikuSystem(bundled, saved.value, migrationAt));
        set智库(merged);
        // 迁移标记在载入成功之后才写：加载失败不留半状态。
        if (!saved.migrationAt) await saveSetting(ZHIKU_CHARACTER_REBUILD_MIGRATION_KEY, migrationAt);
        await bootStage('zhiku:idb-write', () => saveSetting('zhikuSystem', 投影持久化智库系统(merged)));
        devLog('save', 'zhiku-boot-merged', {
          total: merged.条目.length,
          builtin: merged.条目.filter((entry) => entry.builtin).length,
          custom: merged.条目.filter((entry) => !entry.builtin).length,
        });
        return merged;
      }),
    },
  }));
  // 进度不进 React state：50 次进度上报会把整个 App 重渲染 50 次，进度条自行订阅 loader 快照。
  const getPresetPhase = useCallback(() => presetLoader.getSnapshot().phase, [presetLoader]);
  const presetPhase = useSyncExternalStore(presetLoader.subscribe, getPresetPhase);
  const getZhikuCatalogStatus = useCallback((): ZhikuCatalogStatus => {
    const status = presetLoader.getSnapshot().zhiku.status;
    return status === 'loading' ? 'pending' : status;
  }, [presetLoader]);
  const zhikuCatalogStatus = useSyncExternalStore(presetLoader.subscribe, getZhikuCatalogStatus);
  const presetDataReady = presetPhase === 'ready';
  const retryPresetLoad = useCallback((): void => { presetLoader.retry(); }, [presetLoader]);

  const [variableBatches, setVariableBatches] = useState<变量命令批次[]>([]);
  const [queueTasks, setQueueTasks] = useState<队列任务记录[]>([]);
  const [deviceSettings, setDeviceSettings] = useState<DeviceSettings>(() => ({
    apiSettings: 创建空API设置(),
    gameSettings: 创建默认游戏设置(),
    theme: 'deepspace',
    worldbooks: [],
  }));
  const [macroGlobalVars, setMacroGlobalVars] = useState<Record<string, string>>({});
  const [worldbookTriggerStates, setWorldbookTriggerStates] = useState<Record<string, number>>({});
  const setDeviceApiSettings = useCallback<React.Dispatch<React.SetStateAction<API设置>>>((update) => {
    setDeviceSettings((current) => ({
      ...current,
      apiSettings: typeof update === 'function' ? update(current.apiSettings) : update,
    }));
  }, []);
  const setDeviceGameSettings = useCallback<React.Dispatch<React.SetStateAction<游戏设置>>>((update) => {
    setDeviceSettings((current) => ({
      ...current,
      gameSettings: typeof update === 'function' ? update(current.gameSettings) : update,
    }));
  }, []);
  const setDeviceTheme = useCallback<React.Dispatch<React.SetStateAction<主题预设>>>((update) => {
    setDeviceSettings((current) => ({
      ...current,
      theme: typeof update === 'function' ? update(current.theme) : update,
    }));
  }, []);
  const setDeviceWorldbooks = useCallback<React.Dispatch<React.SetStateAction<世界书[]>>>((update) => {
    setDeviceSettings((current) => ({
      ...current,
      worldbooks: typeof update === 'function' ? update(current.worldbooks) : update,
    }));
  }, []);
  const [hasSave, setHasSave] = useState(false);
  const [turnCount, setTurnCount] = useState(1);
  const [turnPhase, setTurnPhase] = useState<TurnPhase | null>(null);
  const [activeTreeMeta, setActiveTreeMeta] = useState<存档树元信息 | null>(null);
  const [rerollParentStatus, setRerollParentStatus] = useState<'pending' | 'valid' | 'invalid'>('pending');

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bootReadyRef = useRef(false);
  const stateRef = useRef<UseGameStateReturn | null>(null);

  const activeWorkflow = useActiveWorkflow();

  const state: UseGameStateReturn = {
    view, setView,
    旅人, set旅人,
    世界, set世界,
    chatHistory, setChatHistory,
    记忆, set记忆,
    忆庭, set忆庭,
    智库, set智库,
    bootSettled,
    presetLoader,
    get presetLoad(): PresetSnapshot { return presetLoader.getSnapshot(); },
    presetDataReady,
    zhikuCatalogStatus,
    retryPresetLoad,
    手机, set手机,
    NPC, setNPC,
    相册, set相册,
    新闻, set新闻,
    剧情, set剧情,
    剧情编织, set剧情编织,
    variableBatches, setVariableBatches,
    queueTasks, setQueueTasks,
    deviceSettings, setDeviceSettings,
    macroGlobalVars, setMacroGlobalVars,
    worldbookTriggerStates, setWorldbookTriggerStates,
    setDeviceApiSettings,
    setDeviceGameSettings,
    setDeviceTheme,
    setDeviceWorldbooks,
    hasSave, setHasSave,
    turnCount, setTurnCount,
    turnPhase, setTurnPhase,
    activeWorkflow,
    activeTreeMeta, setActiveTreeMeta,
    rerollParentStatus,
    scrollRef,
  };

  useLayoutEffect(() => {
    stateRef.current = state;
  });

  useEffect(() => {
    presetLoader.start();
    return () => { presetLoader.dispose(); };
  }, [presetLoader]);

  useEffect(() => presetLoader.subscribe((snapshot) => {
    if (snapshot.story.status === 'loading' || snapshot.zhiku.status === 'loading') return;
    bootPerfSummary({
      story: snapshot.story.status,
      zhiku: snapshot.zhiku.status,
      storyReason: snapshot.story.status === 'failed' ? snapshot.story.reason : undefined,
      zhikuReason: snapshot.zhiku.status === 'failed' ? snapshot.zhiku.reason : undefined,
    });
  }), [presetLoader]);

  useEffect(() => {
    void (async () => {
      try {
        await deleteSetting('activeWorkflowRecoveryV1');
      } catch (error) {
        devLogError('recover', 'legacy-recovery-journal-cleanup-failed', error);
      }
      const lastView = await loadSetting<string>(LAST_VIEW_STORAGE_KEY);

      const savedTheme = await loadSetting<主题预设>('theme');
      if (savedTheme) setDeviceTheme(normalizeThemeId(savedTheme) as 主题预设);

      const savedApi = await loadSetting<API设置>('apiSettings');
      if (savedApi) setDeviceApiSettings(hydratePersistedApiSettings(savedApi));

      const savedGame = await loadSetting<游戏设置>('gameSettings');
      if (savedGame) {
        const hydrated = hydratePersistedGameSettings(savedGame);
        setDeviceGameSettings(hydrated.settings);
        setMacroGlobalVars(hydrated.macroGlobalVars);
        setWorldbookTriggerStates(hydrated.worldbookTriggerStates);
      }

      // 已有存档时内置正文以源码为准，只接存档开关与时间戳；用户额外书原样保留。
      const builtins = createBuiltinWorldbooks();
      const rawSavedWorldbooks = await loadSetting<世界书[]>(WORLDBOOK_STORAGE_KEY);
      if (rawSavedWorldbooks === null) {
        try {
          const presets = await loadAllBundledWorldbookPresets();
          const initial = [...builtins, ...presets];
          setDeviceWorldbooks(initial);
          await saveSetting(WORLDBOOK_STORAGE_KEY, initial);
        } catch (err) {
          console.warn('[opening-worldbook] preset 加载失败,使用内置空集:', err);
          setDeviceWorldbooks(builtins);
        }
      } else {
        const nextWorldbooks = reconcileBuiltinWorldbooks({
          sourceBuiltins: builtins,
          archivedWorldbooks: rawSavedWorldbooks,
        });
        setDeviceWorldbooks(nextWorldbooks);
        await saveSetting(WORLDBOOK_STORAGE_KEY, nextWorldbooks);
      }

      const saveExists = await hasAnySave();
      setHasSave(saveExists);

      let shouldClearLastView = false;
      if (lastView === 'game') {
        let restored = false;
        try {
          const currentState = stateRef.current;
          if (currentState) {
            restored = await bootRestoreFromNewest(currentState);
          }
        } catch (error) {
          devLogError('recover', 'useGameState.boot-restore-import-failed', error);
        }
        if (!restored) {
          shouldClearLastView = true;
        }
      }

      bootReadyRef.current = true;
      setBootSettled(true);
      const currentView = stateRef.current?.view;
      if (shouldClearLastView) {
        try {
          await deleteSetting(LAST_VIEW_STORAGE_KEY);
        } catch (error) {
          devLogError('recover', 'useGameState.last-view-clear-failed', error);
        }
      } else if (currentView === 'game') {
        void saveUiSetting(LAST_VIEW_STORAGE_KEY, 'game').catch((error: unknown) => {
          devLogError('recover', 'useGameState.last-view-save-failed', error);
        });
      }
    })();
  }, [setDeviceApiSettings, setDeviceGameSettings, setDeviceTheme, setDeviceWorldbooks]);

  // 剥离 parentNodeId 前比对四元组：防迟到的旧探测结果误清新叶子。
  // 探测异常（瞬时 IDB 错误）置 invalid 但不剥离 meta，留待下次 meta 变化重新验证。
  useEffect(() => {
    const meta = activeTreeMeta;
    if (!meta?.rootId || !meta.parentNodeId) {
      queueMicrotask(() => setRerollParentStatus('invalid'));
      return;
    }
    let cancelled = false;
    queueMicrotask(() => setRerollParentStatus('pending'));
    void validateRerollParent(meta.rootId, meta.parentNodeId)
      .then((ok) => {
        if (cancelled) return;
        if (ok) {
          setRerollParentStatus('valid');
          return;
        }
        setActiveTreeMeta((prev) => {
          if (!prev || prev.rootId !== meta.rootId || prev.nodeId !== meta.nodeId || prev.parentNodeId !== meta.parentNodeId) return prev;
          const { parentNodeId: _removedParentNodeId, ...rest } = prev;
          void _removedParentNodeId;
          return rest;
        });
        setRerollParentStatus('invalid');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        devLogError('save', 'reroll-parent-validate-failed', err, { rootId: meta.rootId, parentNodeId: meta.parentNodeId });
        setRerollParentStatus('invalid');
      });
    return () => { cancelled = true; };
  }, [activeTreeMeta]);

  useEffect(() => {
    if (!bootReadyRef.current) return;
    const persist = view === 'game'
      ? saveUiSetting(LAST_VIEW_STORAGE_KEY, 'game')
      : deleteSetting(LAST_VIEW_STORAGE_KEY);
    void persist.catch((error: unknown) => {
      devLogError('recover', 'last-view-persist-failed', error, { view });
    });
  }, [view]);

  useEffect(() => {
    applyTheme(deviceSettings.theme);
  }, [deviceSettings.theme]);

  return state;
}
