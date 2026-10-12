/**
 * 图库数据投影：把「相册条目」变成按角色/场景组织起来的可浏览列表。
 *
 * 移植自旧分支的 `components/features/GameSystems/album/albumWorkspaceLogic.ts`。
 * 新版把相册面板重写成「视觉资产」工作台时，这份投影逻辑连同 `libWorkspace` 一起
 * 被删掉了，于是图库从「能按角色看、能筛、能设到槽位」退化成了「一屏缩略图」。
 *
 * 只保留图库需要的那部分：角色库记录、条目索引、场景分类、内置头像。
 * 生成相关的辅助函数（锚点状态、场景源文本、快照摘取、任务构造）留在旧分支，
 * 新系统出图走 `services/ai/imageGen/*`，不需要它们。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoyiShi 移植作者；修改日期：2026-10-13；
 *   修改目的：恢复图库投影；去掉与旧生成管线耦合的部分。
 */

import type { 角色数据结构 } from '@/models/character';
import { 读取NPC头像 } from '@/models/npc';
import type { NPC记录 } from '@/models/npc';
import { isCharacterLibrarySlot, 读取图片参考目标 } from '@/models/imageGeneration';
import type { 相册条目, 相册系统 } from '@/models/imageGeneration';
import { 解析相册资源地址, 解析相册资源引用 } from '@/utils/albumActions';
import { revokeAlbumAssets } from '@/utils/albumObjectUrl';
import { getBuiltinAvatarSet, getBuiltinAvatarSetForNames } from '@/data/builtinAvatars';
import { matchCanonical } from '@/data/canonicalCharacters';

export type 场景库分类 = 'scene' | 'snapshot' | 'phone';

export interface CharacterLibraryEntry {
  entry: 相册条目;
  src: string;
  /** 挂载时用的引用（内置头像没有相册资源，用它的 data 地址直接挂）。 */
  mountSrc?: string;
  sourceLabel?: string;
}

export interface SceneLibraryEntry {
  entry: 相册条目;
  src: string;
  kind: 场景库分类;
  label: string;
}

export interface MountedImageSlot {
  key: string;
  label: string;
  src?: string;
  nsfw?: boolean;
}

export type CharacterLibraryRecord = TravelerLibraryRecord | NpcLibraryRecord;

export interface BaseCharacterLibraryRecord {
  id: string;
  kind: 'traveler' | 'npc';
  name: string;
  alias?: string;
  avatar?: string;
  entries: CharacterLibraryEntry[];
  slots: MountedImageSlot[];
  imageCount: number;
  resourceCount: number;
  mountedCount: number;
}

export interface TravelerLibraryRecord extends BaseCharacterLibraryRecord {
  kind: 'traveler';
  traveler: 角色数据结构;
}

export interface NpcLibraryRecord extends BaseCharacterLibraryRecord {
  kind: 'npc';
  npc: NPC记录;
}

type 资源查找表 = Map<string, { id?: string; dataUrl?: string; url?: string; localRef?: string; originalUrl?: string }>;

/** 由相册资源表构造 id → 资源的查找表。 */
export function buildAssetMap(album: 相册系统): 资源查找表 {
  return new Map(album.assets.map((asset) => [asset.id, asset]));
}

function 取条目地址(assetMap: 资源查找表, assetId: string): string {
  return 解析相册资源地址(assetMap.get(assetId)) || '';
}

export function buildCharacterLibraryRecords(
  traveler: 角色数据结构,
  npcs: NPC记录[],
  album: 相册系统,
  assetMap: 资源查找表,
  includeNsfw: boolean,
): CharacterLibraryRecord[] {
  const entryIndex = buildCharacterAlbumEntryIndex(traveler, npcs, album, includeNsfw);
  const travelerRecord = buildTravelerLibraryRecord(traveler, album, assetMap, entryIndex.get('traveler') ?? []);
  const npcRecords = npcs
    .filter((npc) => npc.阶位 === 'companion' || npc.原著角色)
    .map((npc): NpcLibraryRecord => {
      /*
       * 三个头像槽位统一走 `读取NPC头像`，与界面渲染同一口径。
       *
       * 该函数在槽位没设时会回落到档案头像 / 内置头像 —— 正文与手机头像
       * 实际就是显示那一张。这里若直接读 `头像槽位[slot]`，图库会把
       * 「正在显示」的两个槽位报成「未设定」，与用户看到的画面不一致。
       */
      const slots: MountedImageSlot[] = [
        { key: 'avatar-profile', label: '档案头像', src: 解析相册资源引用(album, 读取NPC头像(npc, '档案')) },
        { key: 'avatar-story', label: '正文头像', src: 解析相册资源引用(album, 读取NPC头像(npc, '正文')) },
        { key: 'avatar-phone', label: '手机头像', src: 解析相册资源引用(album, 读取NPC头像(npc, '手机')) },
        { key: 'portrait', label: '角色立绘', src: 解析相册资源引用(album, npc.图像档案?.立绘) },
      ];
      const albumEntries = (entryIndex.get(npc.id) ?? []).map((entry) => ({
        entry,
        src: 取条目地址(assetMap, entry.assetId),
      }));
      const entries = [...buildBuiltinAvatarEntries(npc), ...albumEntries];
      const mountedCount = slots.filter((slot) => Boolean(slot.src)).length;
      return {
        id: npc.id,
        kind: 'npc',
        name: npc.姓名,
        alias: npc.别名,
        avatar: 解析相册资源引用(album, 读取NPC头像(npc, '档案')),
        npc,
        entries,
        slots,
        imageCount: entries.length + mountedCount,
        resourceCount: entries.length,
        mountedCount,
      };
    })
    .sort((a, b) => b.imageCount - a.imageCount || a.npc.姓名.localeCompare(b.npc.姓名, 'zh-Hans-CN'));
  return [travelerRecord, ...npcRecords];
}

export function buildTravelerLibraryRecord(
  traveler: 角色数据结构,
  album: 相册系统,
  assetMap: 资源查找表,
  indexedEntries?: 相册条目[],
): TravelerLibraryRecord {
  const slots: MountedImageSlot[] = [
    { key: 'traveler-avatar-profile', label: '档案头像', src: 解析相册资源引用(album, traveler.图像档案?.头像 || traveler.头像 || undefined) },
    { key: 'traveler-avatar-story', label: '正文头像', src: 解析相册资源引用(album, traveler.图像档案?.正文头像) },
    { key: 'traveler-avatar-phone', label: '手机头像', src: 解析相册资源引用(album, traveler.图像档案?.手机头像) },
    { key: 'traveler-portrait', label: '角色立绘', src: 解析相册资源引用(album, traveler.图像档案?.立绘) },
  ];
  const albumEntries = indexedEntries ?? buildCharacterAlbumEntryIndex(traveler, [], album, false).get('traveler') ?? [];
  const entries = albumEntries.map((entry) => ({ entry, src: 取条目地址(assetMap, entry.assetId) }));
  const mountedCount = slots.filter((slot) => Boolean(slot.src)).length;
  return {
    id: 'traveler',
    kind: 'traveler',
    name: traveler.姓名 || '旅人',
    alias: traveler.别名,
    avatar: 解析相册资源引用(album, traveler.图像档案?.头像 || traveler.头像 || undefined),
    traveler,
    entries,
    slots,
    imageCount: entries.length + mountedCount,
    resourceCount: entries.length,
    mountedCount,
  };
}

/**
 * 把相册条目按「属于谁」建索引。
 *
 * 三种归属方式：条目自带的 targetId、参考图目标、以及标题里出现角色名
 * （老存档的条目没有 targetId，只能靠标题兜底）。
 */
export function buildCharacterAlbumEntryIndex(
  traveler: 角色数据结构,
  npcs: NPC记录[],
  album: 相册系统,
  includeNsfw: boolean,
): Map<string, 相册条目[]> {
  const index = new Map<string, 相册条目[]>();
  const indexedEntryIds = new Map<string, Set<string>>();
  const knownIds = new Set(['traveler', ...npcs.map((npc) => npc.id)]);
  const npcNames = npcs.map((npc) => ({
    id: npc.id,
    names: [npc.姓名, npc.别名].map((name) => name?.trim()).filter((name): name is string => Boolean(name)),
  }));

  const add = (targetId: string, entry: 相册条目) => {
    if (!knownIds.has(targetId)) return;
    const entryIds = indexedEntryIds.get(targetId) ?? new Set<string>();
    if (entryIds.has(entry.id)) return;
    entryIds.add(entry.id);
    indexedEntryIds.set(targetId, entryIds);
    const entries = index.get(targetId) ?? [];
    entries.push(entry);
    index.set(targetId, entries);
  };

  for (const entry of album.entries) {
    if (entry.nsfw && !includeNsfw) continue;
    const referenceTargets = 读取图片参考目标(entry);
    const hasCharacterOwner = entry.targetType === 'traveler'
      || (entry.targetType === 'npc' && Boolean(entry.targetId));
    if (!isCharacterLibrarySlot(entry.slot) && referenceTargets.length === 0 && !hasCharacterOwner) continue;

    const targetIds = new Set(referenceTargets);
    if (entry.targetType === 'traveler') targetIds.add('traveler');
    if (entry.targetType === 'npc' && entry.targetId) targetIds.add(entry.targetId);

    if (targetIds.size === 0 && isCharacterLibrarySlot(entry.slot)) {
      const title = entry.title || '';
      if (title.includes(traveler.姓名 || '旅人') || title.includes('旅人')) targetIds.add('traveler');
      const matchedNpc = npcNames.find((npc) => npc.names.some((name) => title.includes(name)));
      if (matchedNpc) targetIds.add(matchedNpc.id);
    }
    for (const targetId of targetIds) add(targetId, entry);
  }
  return index;
}

/** 某个角色名下「与头像/立绘有关」的条目，按时间倒序。 */
export function buildScopedCharacterGalleryEntries(
  record: CharacterLibraryRecord | null,
  resourceEntries: CharacterLibraryEntry[],
): CharacterLibraryEntry[] {
  if (!record) return [];
  const scoped = resourceEntries.filter((item) => {
    if (item.entry.targetId === record.id) return true;
    if (record.kind === 'traveler') return item.entry.targetType === 'traveler';
    return item.entry.targetType === 'npc' && item.entry.targetId === record.id;
  });
  return dedupeEntries([...record.entries, ...scoped]);
}

/** 角色图库里实际要显示的条目：内置头像 + 名下条目 + 作用域内条目。 */
export function buildVisibleCharacterEntries(
  record: CharacterLibraryRecord | null,
  resourceEntries: CharacterLibraryEntry[],
  album: 相册系统,
): CharacterLibraryEntry[] {
  if (!record) return [];
  const scoped = buildScopedCharacterGalleryEntries(record, resourceEntries);
  const recordEntries = record.entries.filter((item) => isCharacterLibrarySlot(item.entry.slot) || item.entry.targetId === record.id);
  const builtin = record.kind === 'npc' ? buildBuiltinAvatarEntries(record.npc) : buildTravelerBuiltinAvatarEntries(record.traveler, album);
  return dedupeEntries([...builtin, ...recordEntries, ...scoped]);
}

function dedupeEntries(列表: CharacterLibraryEntry[]): CharacterLibraryEntry[] {
  const seen = new Set<string>();
  return 列表.filter((item) => {
    if (seen.has(item.entry.id)) return false;
    seen.add(item.entry.id);
    return true;
  });
}

/** 原著角色随包内置的头像候选。 */
export function buildBuiltinAvatarEntries(npc: NPC记录): CharacterLibraryEntry[] {
  const canonical = findNpcCanonicalName(npc);
  const set = getBuiltinAvatarSet(canonical);
  if (!set) return [];
  return set.candidates.map((candidate): CharacterLibraryEntry => ({
    entry: {
      id: `builtin-avatar:${npc.id}:${candidate.id}`,
      assetId: candidate.id,
      title: candidate.title,
      targetType: 'npc',
      targetId: npc.id,
      slot: 'avatar_profile',
      tags: ['内置头像', set.canonicalName],
      nsfw: false,
      createdAt: 0,
      note: '随包内置头像',
      referenceTargets: [],
    },
    src: candidate.src,
    mountSrc: candidate.reference,
    sourceLabel: '内置',
  }));
}

/** 旅人自带头像（尚未被相册资源接管时）也要能在图库里看到。 */
export function buildTravelerBuiltinAvatarEntries(traveler: 角色数据结构, album: 相册系统): CharacterLibraryEntry[] {
  const rawAvatar = traveler.图像档案?.头像 || traveler.头像 || '';
  if (rawAvatar.trim().startsWith('asset:')) return [];
  const avatar = 解析相册资源引用(album, rawAvatar) || '';
  if (!avatar) return [];
  const id = `builtin-avatar:traveler:${traveler.姓名 || 'traveler'}:profile`;
  return [{
    entry: {
      id,
      assetId: id,
      title: `${traveler.姓名 || '旅人'}·档案头像`,
      targetType: 'traveler',
      targetId: 'traveler',
      slot: 'avatar_profile',
      tags: ['内置头像', traveler.姓名 || '旅人'],
      nsfw: false,
      createdAt: 0,
      note: '随包内置头像',
      referenceTargets: [],
    },
    src: avatar,
    mountSrc: avatar,
    sourceLabel: '内置',
  }];
}

/** 场景 / 故事快照 / 手机背景的分类，靠标签、备注与目标类型一起判断。 */
export function classifySceneLibraryEntry(entry: 相册条目): 场景库分类 | null {
  const tags = new Set(entry.tags.map((tag) => tag.trim()).filter(Boolean));
  const note = (entry.note ?? '').trim();
  const text = `${entry.title} ${note} ${Array.from(tags).join(' ')}`;
  if (/故事快照|快照|正文插图/.test(text)) return 'snapshot';
  if (entry.targetType === 'phone' || entry.slot === 'phone_wallpaper' || entry.slot === 'phone_chat_background' || tags.has('手机背景') || /手机背景|壁纸/.test(text)) return 'phone';
  if (entry.targetType === 'scene' || entry.slot === 'scene' || tags.has('场景图') || /场景图/.test(text)) return 'scene';
  return null;
}

export function sceneLibraryKindLabel(kind: 场景库分类): string {
  return { scene: '场景图', snapshot: '故事快照', phone: '手机背景' }[kind];
}

export function buildSceneLibraryEntries(album: 相册系统, assetMap: 资源查找表): SceneLibraryEntry[] {
  return album.entries
    .map((entry) => {
      const kind = classifySceneLibraryEntry(entry);
      if (!kind) return null;
      return { entry, src: 取条目地址(assetMap, entry.assetId), kind, label: sceneLibraryKindLabel(kind) };
    })
    .filter((item): item is SceneLibraryEntry => Boolean(item))
    .sort((a, b) => b.entry.createdAt - a.entry.createdAt);
}

export function isNpcLibraryRecord(record: CharacterLibraryRecord | null | undefined): record is NpcLibraryRecord {
  return record?.kind === 'npc';
}

export function findNpcCanonicalName(npc: NPC记录): string | undefined {
  const avatarSet = getBuiltinAvatarSetForNames(npc.姓名, npc.别名);
  if (avatarSet) return avatarSet.canonicalName;

  const names = [npc.姓名, npc.别名]
    .flatMap((item) => (item ?? '').split(/[/／|、,，]/))
    .map((item) => item.trim())
    .filter(Boolean);
  for (const name of names) {
    const canonical = matchCanonical(name);
    if (canonical) return canonical.name;
  }
  return undefined;
}

/** 图库条目的排序键：内置头像排前面（它们最像「原始头像」），其余按时间倒序。 */
export function sortGalleryEntries(entries: CharacterLibraryEntry[]): CharacterLibraryEntry[] {
  return [...entries].sort((a, b) => {
    const aBuiltin = a.entry.id.startsWith('builtin-avatar:') ? 0 : 1;
    const bBuiltin = b.entry.id.startsWith('builtin-avatar:') ? 0 : 1;
    if (aBuiltin !== bBuiltin) return aBuiltin - bBuiltin;
    return b.entry.createdAt - a.entry.createdAt;
  });
}

/**
 * 删条目之后回收没有条目引用的资源。
 *
 * 必须一并 `revokeAlbumAssets`：展示缓存的 objectURL 不回收就会一直占着内存，
 * 而图库里删图是常见操作。
 */
export function cleanupAlbumAssets(album: 相册系统): 相册系统 {
  const used = new Set(album.entries.map((entry) => entry.assetId));
  const removed = album.assets.filter((asset) => !used.has(asset.id)).map((asset) => asset.id);
  if (removed.length) revokeAlbumAssets(removed);
  return { ...album, assets: album.assets.filter((asset) => used.has(asset.id)) };
}
