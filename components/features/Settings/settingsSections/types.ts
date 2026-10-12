import type { ComponentType, Dispatch, SetStateAction } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { API设置, DeviceSettings, 游戏设置, 主题预设 } from '@/models/settings';
import type { API方案槽位, AuxApiProfileState, 已持久化API方案 } from '@/models/apiProfiles';
import type { ContextSnapshot, ContextSnapshotKind } from '@/hooks/useGame/contextSnapshot';
import type { 角色数据结构 } from '@/models/character';
import type { 世界状态 } from '@/models/world';
import type { 记忆系统 } from '@/models/memory';
import type { 忆庭系统 } from '@/models/yiting';
import type { 智库系统 } from '@/models/zhiku';
import type { 手机系统 } from '@/models/phone';
import type { NPC记录 } from '@/models/npc';
import type { 新闻条目 } from '@/models/news';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import type { SaveCatalogRepairResult, SaveCatalogRepairScope, SaveCatalogRepairState, SaveCatalogSnapshot, SaveListItemSummary } from '@/contracts/storage';
import type { 世界书 } from '@/models/worldbook';
import type { 剧情节点 } from '@/models/plot';
import type { STRegexScript } from '@/models/stTypes';
import type { TavernRegexDryRunResult, TavernRegexScriptSafety } from '@/contracts/ai';
import type { ApiErrorReport, ConnectionTestConfig, ConnectionTestResult } from '@/hooks/useAiTools';
import type { 变量修复中心动作 } from '@/hooks/useGame/variableRepairCenter';

export type SettingsTab =
  | 'api' | 'apiErrors' | 'game' | 'visual' | 'context' | 'nsfw' | 'variables'
  | 'prompts' | 'tavernPresets' | 'extra' | 'theme' | 'storage'
  | 'variableUpdate' | 'memory' | 'yiting' | 'news' | 'zhiku' | 'storyWeaving' | 'phone'
  | 'variableRepair' | 'imageGen';

export interface SettingsModalProps {
  onClose: () => void;
  deviceSettings: DeviceSettings;
  onApiSettingsChange: (s: API设置) => void;
  onGameSettingsChange: (s: 游戏设置) => void;
  onThemeChange: (t: 主题预设) => void;
  onContinue: () => Promise<boolean>;
  onLoadSave: (id: number) => Promise<boolean>;
  onBranchSave?: (id: number) => Promise<boolean>;
  旅人: 角色数据结构;
  世界: 世界状态;
  on世界Change: (s: 世界状态) => void;
  记忆: 记忆系统;
  忆庭: 忆庭系统;
  智库: 智库系统;
  手机: 手机系统;
  NPC: NPC记录[];
  新闻: 新闻条目[];
  剧情编织: 剧情编织系统;
  on剧情编织Change: Dispatch<SetStateAction<剧情编织系统>>;
  variableSetters: {
    set旅人: Dispatch<SetStateAction<角色数据结构>>;
    set世界: Dispatch<SetStateAction<世界状态>>;
    set记忆: Dispatch<SetStateAction<记忆系统>>;
    set忆庭: Dispatch<SetStateAction<忆庭系统>>;
    set智库: Dispatch<SetStateAction<智库系统>>;
    set手机: Dispatch<SetStateAction<手机系统>>;
    setNPC: Dispatch<SetStateAction<NPC记录[]>>;
    set新闻: Dispatch<SetStateAction<新闻条目[]>>;
    set剧情: Dispatch<SetStateAction<剧情节点[]>>;
  };
  variableEditingLocked?: boolean;
  getContextSnapshot: (kind?: ContextSnapshotKind) => ContextSnapshot;
  initialTab?: SettingsTab;
  /** 同时负责持久化到 IndexedDB。 */
  onWorldbooksChange: (books: 世界书[]) => void;
  onDeleteSave: (save: SaveListItemSummary) => Promise<boolean>;
  onDeleteSaveTree: (rootId: string) => Promise<void>;
  onClearActiveSaveTreeMeta: (target?: { rootId?: string; nodeId?: string } | null) => void;
  onGetSaveCatalogSnapshot: () => Promise<SaveCatalogSnapshot>;
  onStartSaveCatalogRepair: (scope?: SaveCatalogRepairScope) => Promise<SaveCatalogRepairResult>;
  onSubscribeSaveCatalogRepair: (listener: (state: SaveCatalogRepairState) => void) => () => void;
  onRepairSaveDatabase: () => Promise<void>;
  onDeleteLegacyBackupSaves: () => Promise<number>;
  onExportSavePackage: (id: number) => Promise<void>;
  onExportSaveTreePackage: (rootId: string) => Promise<void>;
  onImportSaveFileAsMany: (file: File) => Promise<number>;
  onExtractTavernRegexScripts: (rawPreset: unknown) => STRegexScript[];
  onAnalyzeTavernRegexScript: (script: STRegexScript) => TavernRegexScriptSafety;
  onDryRunTavernRegexScript: (script: STRegexScript, sampleText: string) => TavernRegexDryRunResult;
  onPersistGameSettings: (s: 游戏设置) => Promise<void>;
  onPersistApiSettings: (s: API设置) => Promise<void>;
  onPersistTheme: (t: 主题预设) => Promise<void>;
  onPersistApiProfile: (api: API设置, game: 游戏设置) => Promise<已持久化API方案>;
  onLoadApiProfileSlots: () => Promise<API方案槽位[]>;
  onPersistApiProfileSlots: (slots: API方案槽位[]) => Promise<void>;
  onLoadAuxApiProfiles: () => Promise<Record<string, AuxApiProfileState>>;
  onPersistAuxApiProfiles: (profiles: Record<string, AuxApiProfileState>) => Promise<void>;
  fetchModels: (config: ConnectionTestConfig) => Promise<string[]>;
  testConnection: (config: ConnectionTestConfig) => Promise<ConnectionTestResult>;
  loadApiErrorReports: () => Promise<ApiErrorReport[]>;
  clearApiErrorReports: () => Promise<void>;
  变量修复中心?: 变量修复中心动作;
}

/**
 * 草稿语义：子系统设置（变量更新/记忆/忆庭/新闻/智库/剧情/手机）使用 onGameSettingsChange，
 * 仅更新内存，关闭/重开设置保留草稿，只有各页「保存」才落盘；浏览器刷新会丢弃未保存草稿。
 * 其余设置页走 persistGameSettingsChange 即时落盘。
 */
export interface SettingsSectionContext extends SettingsModalProps {
  gameSettings: 游戏设置;
  persistGameSettingsChange: (next: 游戏设置) => void;
  persistThemeChange: (next: 主题预设) => void;
}

export type SettingsSectionGroupId =
  | 'appearance' | 'narrative' | 'connection' | 'subsystems' | 'data' | 'private';

export interface SettingsSectionGroup {
  id: SettingsSectionGroupId;
  label: string;
}

export interface SettingsSectionDefinition {
  key: SettingsTab;
  label: string;
  icon: string;
  navIcon: LucideIcon;
  group: SettingsSectionGroupId;
  subtitle: string;
  fullHeight?: boolean;
  Component: ComponentType<SettingsSectionContext>;
}
