import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { lazyWithRetry } from '@/utils/lazyWithRetry';

export const NewGameWizard = lazyWithRetry(() => import('@/components/features/NewGame/NewGameWizard').then((module) => ({ default: module.NewGameWizard })), '开局档案');
export const SettingsModal = lazyWithRetry(() => import('@/components/features/Settings/SettingsModal').then((module) => ({ default: module.SettingsModal })), '设置');
export const SaveManager = lazyWithRetry(() => import('@/components/features/SaveLoad/SaveManager').then((module) => ({ default: module.SaveManager })), '存档系统');
export const WorldbookManagerModal = lazyWithRetry(() => import('@/components/features/Worldbook/WorldbookManagerModal').then((module) => ({ default: module.WorldbookManagerModal })), '如我所书');
export const ZhikuManagerModal = lazyWithRetry(() => import('@/components/features/Zhiku/ZhikuManagerModal').then((module) => ({ default: module.ZhikuManagerModal })), '智库');
export const GitHubCloudSaveModal = lazyWithRetry(() => import('@/components/features/CloudSave/GitHubCloudSaveModal').then((module) => ({ default: module.GitHubCloudSaveModal })), '云存档');
export const ReleaseAnnouncementsModal = lazyWithRetry(() => import('@/components/features/Release/ReleaseAnnouncementsModal').then((module) => ({ default: module.ReleaseAnnouncementsModal })), '更新公告');

export const PhoneModal = lazyWithRetry(() => import('@/components/features/Phone/PhoneModal').then((module) => ({ default: module.PhoneModal })), '手机');
export const PlotPanel = lazyWithRetry(() => import('@/components/features/GameSystems/PlotPanel').then((module) => ({ default: module.PlotPanel })), '剧情');
export const YitingPanel = lazyWithRetry(() => import('@/components/features/GameSystems/YitingPanel').then((module) => ({ default: module.YitingPanel })), '忆庭');
export const ZhikuSystemPanel = lazyWithRetry(() => import('@/components/features/Zhiku/ZhikuSystemPanel').then((module) => ({ default: module.ZhikuSystemPanel })), '智库');
export const MemoryPanel = lazyWithRetry(() => import('@/components/features/GameSystems/MemoryPanel').then((module) => ({ default: module.MemoryPanel })), '记忆');
export const ImageWorkbenchPanel = lazyWithRetry(() => import('@/components/features/ImageGeneration/ImageWorkbenchPanel').then((module) => ({ default: module.ImageWorkbenchPanel })), '视觉资产');
export const SkillPanel = lazyWithRetry(() => import('@/components/features/GameSystems/SkillPanel').then((module) => ({ default: module.SkillPanel })), '战技');
export const InventoryPanel = lazyWithRetry(() => import('@/components/features/GameSystems/InventoryPanel').then((module) => ({ default: module.InventoryPanel })), '物品');
export const NewsPanel = lazyWithRetry(() => import('@/components/features/GameSystems/NewsPanel').then((module) => ({ default: module.NewsPanel })), '新闻');
export const CompanionPanel = lazyWithRetry(() => import('@/components/features/GameSystems/CompanionPanel').then((module) => ({ default: module.CompanionPanel })), '同行');
export const PathPanel = lazyWithRetry(() => import('@/components/features/GameSystems/PathPanel').then((module) => ({ default: module.PathPanel })), '命途');

function LazySurfaceFallback({ label }: { label: string }) {
  return (
    <div className="flex min-h-[180px] items-center justify-center p-6 text-sm" style={{ color: 'rgba(var(--tj-text-secondary),0.82)' }}>
      {label}
    </div>
  );
}

/**
 * 已知缺陷：等待态是文档流里的一段文字，在首页（LandingPage 高 100dvh、body overflow:hidden）
 * 会被排到视口之外——冷 chunk 点击时玩家看不到反馈，直到 lazyWithRetry 的 12s 超时换上失败卡片。
 */
export function LazySurface({ label, children }: { label: string; children: ReactNode }) {
  return <Suspense fallback={<LazySurfaceFallback label={label} />}>{children}</Suspense>;
}

export interface SurfaceWarmup {
  readonly id: string;
  readonly load: () => Promise<void>;
}

const HOME_SURFACES: readonly SurfaceWarmup[] = [
  { id: 'settings', load: SettingsModal.preload },
  { id: 'cloudSave', load: GitHubCloudSaveModal.preload },
  { id: 'announcements', load: ReleaseAnnouncementsModal.preload },
  { id: 'newGameWizard', load: NewGameWizard.preload },
  { id: 'saveManager', load: SaveManager.preload },
  { id: 'worldbook', load: WorldbookManagerModal.preload },
  { id: 'zhiku', load: ZhikuManagerModal.preload },
];

const GAME_SURFACES: readonly SurfaceWarmup[] = [
  { id: 'phone', load: PhoneModal.preload },
  { id: 'plot', load: PlotPanel.preload },
  { id: 'yiting', load: YitingPanel.preload },
  { id: 'zhikuPanel', load: ZhikuSystemPanel.preload },
  { id: 'memory', load: MemoryPanel.preload },
  { id: 'album', load: ImageWorkbenchPanel.preload },
  { id: 'skill', load: SkillPanel.preload },
  { id: 'inventory', load: InventoryPanel.preload },
  { id: 'news', load: NewsPanel.preload },
  { id: 'companion', load: CompanionPanel.preload },
  { id: 'path', load: PathPanel.preload },
];

/** 前 HOME_SURFACE_COUNT 项必须是首页可达界面（顺序即优先级）。 */
export const SURFACE_WARMUP: readonly SurfaceWarmup[] = [...HOME_SURFACES, ...GAME_SURFACES];

export const HOME_SURFACE_COUNT = HOME_SURFACES.length;
