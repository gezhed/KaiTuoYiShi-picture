import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { 相册条目, 相册系统 } from '@/models/imageGeneration';
import { slotLabel } from '@/models/imageGeneration';
import type { 角色数据结构 } from '@/models/character';
import type { NPC记录 } from '@/models/npc';
import { 读取NPC头像 } from '@/models/npc';
import {
  buildAssetMap,
  buildCharacterLibraryRecords,
  buildImportedImageItem,
  buildSceneLibraryEntries,
  buildVisibleCharacterEntries,
  cleanupAlbumAssets,
  isNpcLibraryRecord,
  sceneLibraryKindLabel,
  sortGalleryEntries,
  type CharacterLibraryEntry,
  type CharacterLibraryRecord,
  type SceneLibraryEntry,
  type 场景库分类,
} from './galleryWorkspaceLogic';
import { EmptyLibraryBox, ImagePreviewModal, Panel, SafeAlbumImage } from './workspaceComponents';
import { cardClip, smallClip } from '@/components/ui/clipPaths';
import { 提示条 } from '@/components/features/Settings/settingsPrimitives';
import { 添加图片到相册, 解析相册资源引用, fileToDataUrl } from '@/utils/albumActions';
import type { AlbumImportMode } from './albumArchive';

/** 图库左侧筛选项：角色库 + 三类场景库。 */
type 图库筛选 = 'character' | 场景库分类;

const 筛选项: Array<{ id: 图库筛选; label: string }> = [
  { id: 'character', label: '角色' },
  { id: 'scene', label: '场景图' },
  { id: 'snapshot', label: '故事快照' },
  { id: 'phone', label: '手机背景' },
];

export interface 图库条目选中 {
  entry: 相册条目;
  src: string;
}

interface Props {
  album: 相册系统;
  traveler: 角色数据结构;
  npcs: NPC记录[];
  /** 从图库里点「设置到槽位」时通知上层弹槽位选择。 */
  onRequestApply: (选中: 图库条目选中) => void;
  /** 清空某个已挂载的槽位。 */
  onClearSlot: (参数: { record: CharacterLibraryRecord; slotKey: string }) => void;
  onAlbumChange: (next: 相册系统) => void;
  onExport: () => void;
  onImport: (file: File | null, mode: AlbumImportMode) => void;
  /** 导出/导入进行中的提示文案；为空表示空闲。 */
  operationLabel?: string;
  operationBusy?: boolean;
  /** 打开「视觉资产 → 文生图生成头像」的入口。 */
  onOpenAvatarEditor?: (record: CharacterLibraryRecord) => void;
}

/**
 * 图库工作区。
 *
 * 这是旧分支相册面板里那个「图库」页的原样回归：左边按角色/场景筛，
 * 中间看图，选中一张可以设置到槽位、批量删除、导入导出。
 *
 * 与旧实现的差别只有两点：
 *   1. 不再承担出图职责——出图走新的 `services/ai/imageGen`，
 *      需要重新出图时点右上角「生成头像」进 `AvatarWorkbench`；
 *   2. 场景库只读（旧版的场景生成工作区依赖已删除的旧管线）。
 */
export function GalleryWorkspace({
  album,
  traveler,
  npcs,
  onRequestApply,
  onClearSlot,
  onAlbumChange,
  onExport,
  onImport,
  operationLabel = '',
  operationBusy = false,
  onOpenAvatarEditor,
}: Props) {
  const [筛选, set筛选] = useState<图库筛选>('character');
  const [选中角色, set选中角色] = useState<string>('traveler');
  const [选中条目, set选中条目] = useState<string>('');
  const [批量模式, set批量模式] = useState(false);
  const [多选, set多选] = useState<string[]>([]);
  const [预览打开, set预览打开] = useState(false);
  const [导入提示, set导入提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const 图片文件 = useRef<HTMLInputElement | null>(null);
  const 导入文件 = useRef<HTMLInputElement | null>(null);
  const 导入模式 = useRef<AlbumImportMode>('merge');

  const assetMap = useMemo(() => buildAssetMap(album), [album]);
  const records = useMemo(
    () => buildCharacterLibraryRecords(traveler, npcs, album, assetMap, true),
    [traveler, npcs, album, assetMap],
  );
  const sceneEntries = useMemo(() => buildSceneLibraryEntries(album, assetMap), [album, assetMap]);
  const 活跃记录 = records.find((record) => record.id === 选中角色) ?? records[0];
  /** 本地导入的图片归到当前选中的角色名下。 */
  const 导入归属 = 活跃记录;
  const 角色条目 = useMemo(
    () => sortGalleryEntries(buildVisibleCharacterEntries(活跃记录, 角色资源条目(album), album)),
    [活跃记录, album],
  );
  const 场景条目 = useMemo(
    () => (筛选 === 'character' ? [] : sceneEntries.filter((item) => item.kind === 筛选)),
    [sceneEntries, 筛选],
  );

  const 可见条目: CharacterLibraryEntry[] = 筛选 === 'character'
    ? 角色条目
    : 场景条目.map((item: SceneLibraryEntry) => ({ entry: item.entry, src: item.src }));

  const 选中项 = 可见条目.find((item) => item.entry.id === 选中条目);
  const 当前选中 = 批量模式
    ? 可见条目.filter((item) => 多选.includes(item.entry.id))
    : 选中项 ? [选中项] : [];

  const 切换筛选 = (下一个: 图库筛选) => {
    set筛选(下一个);
    set批量模式(false);
    set多选([]);
    set选中条目('');
  };

  const 切换多选 = (entryId: string) => {
    set多选((当前) => (当前.includes(entryId) ? 当前.filter((id) => id !== entryId) : [...当前, entryId]));
  };

  const 点击条目 = (entryId: string) => {
    set选中条目(entryId);
    if (批量模式) 切换多选(entryId);
  };

  const 删除选中 = () => {
    const ids = new Set(当前选中.map((item) => item.entry.id));
    if (ids.size === 0) return;
    const 确认 = window.confirm(`确认删除选中的 ${ids.size} 张图片？引用它们的槽位会重新回落到内置或占位头像。`);
    if (!确认) return;
    const 下一个 = cleanupAlbumAssets({
      ...album,
      entries: album.entries.filter((entry) => !ids.has(entry.id)),
    });
    onAlbumChange(下一个);
    set多选([]);
    set选中条目('');
  };

  const 触发导入 = (mode: AlbumImportMode) => {
    if (mode === 'replace' && !window.confirm('覆盖恢复会替换当前相册中的全部资源与任务。确认继续吗？')) return;
    导入模式.current = mode;
    导入文件.current?.click();
  };

  /**
   * 导入本地图片。
   *
   * 旧版有「导入参考图」，但它只做导入参考图这一件事；图库这边既没有单图导入，
   * 也没有普通图片的入口——导入按钮只认 ZIP 备份，想放一张存稿进图库是做不到的。
   *
   * 归属按当前选中的角色给：在角色筛选下导入的图直接落到该角色名下，
   * 否则会变成一张没有归属的条目，在每个角色的图库列表里都出现（旧版的坑）。
   */
  const 处理导入图片 = async (选择结果: FileList | null) => {
    // 必须先拷成数组：调用方紧接着会清空 input，而清空会把 FileList 一起清掉
    // （`input.value = ''` 之后 `files` 就空了），异步循环里再读就一张都拿不到。
    const 列表 = Array.from(选择结果 ?? []);
    if (列表.length === 0) return;
    set导入提示({ kind: 'info', text: `正在导入 ${列表.length} 张图片…` });
    let 下一个 = album;
    let 成功 = 0;
    const 失败原因: string[] = [];
    for (const 文件 of 列表) {
      try {
        const 数据地址 = await 文件转数据地址(文件);
        const 条目 = buildImportedImageItem({
          数据地址,
          文件名: 文件.name,
          mimeType: 文件.type || undefined,
          归属: 导入归属,
        });
        下一个 = 添加图片到相册(下一个, 条目);
        成功 += 1;
      } catch (错误) {
        失败原因.push(`${文件.name}：${错误 instanceof Error ? 错误.message : String(错误)}`);
      }
    }
    if (成功 > 0) onAlbumChange(下一个);
    const 归属文本 = 导入归属.kind === 'traveler' ? '旅人' : `${导入归属.name}（伙伴）`;
    set导入提示({
      kind: 失败原因.length > 0 ? 'error' : 'ok',
      text: 失败原因.length > 0
        ? `导入 ${成功} 张成功，${失败原因.length} 张失败：${失败原因.join('；')}`
        : `已导入 ${成功} 张到「${归属文本}」名下。选中一张再点「设置到槽位」即可挂到其他槽位。`,
    });
  };

  const 显示预览 = () => {
    if (!选中项?.src) return;
    set预览打开(true);
  };

  return (
    <div className="grid min-h-0 gap-4 xl:grid-cols-[190px_minmax(0,1fr)_240px]">
      <Panel title="图库筛选" contentClassName="space-y-3">
        <div className="space-y-1.5">
          {筛选项.map((选项) => {
            const 当前数 = 选项.id === 'character'
              ? records.reduce((合计, record) => 合计 + record.resourceCount, 0)
              : sceneEntries.filter((item) => item.kind === 选项.id).length;
            const 活跃 = 筛选 === 选项.id;
            return (
              <button
                key={选项.id}
                type="button"
                onClick={() => 切换筛选(选项.id)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                style={{
                  color: 活跃 ? 'rgb(var(--tj-ui-title))' : 'rgba(var(--tj-ui-muted),0.82)',
                  background: 活跃
                    ? 'linear-gradient(90deg, rgba(var(--tj-accent-primary),0.16), rgba(var(--tj-accent-primary),0.04))'
                    : 'rgba(var(--tj-ui-panel-strong),0.36)',
                  border: 活跃
                    ? '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-strong))'
                    : '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
                  clipPath: smallClip,
                }}
              >
                <span className="font-serif text-sm font-bold tracking-[0.14em]">{选项.label}</span>
                <span className="text-[11px]" style={{ color: 'rgba(var(--tj-ui-muted),0.62)' }}>{当前数}</span>
              </button>
            );
          })}
        </div>

        {筛选 === 'character' && (
          <div className="max-h-[52vh] space-y-1.5 overflow-y-auto border-t pt-3" style={{ borderColor: 'rgba(var(--tj-accent-primary),0.1)' }}>
            {records.length === 0 ? (
              <EmptyLibraryBox title="未找到角色" desc="让剧情写入伙伴档案后，角色会出现在这里。" />
            ) : records.map((record) => (
              <button
                key={record.id}
                type="button"
                onClick={() => { set选中角色(record.id); set选中条目(''); set多选([]); }}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
                style={{
                  background: 活跃记录.id === record.id
                    ? 'linear-gradient(90deg, rgba(var(--tj-accent-primary),0.16), rgba(var(--tj-accent-primary),0.04))'
                    : 'rgba(var(--tj-ui-panel-strong),0.36)',
                  border: 活跃记录.id === record.id
                    ? '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))'
                    : '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
                  clipPath: smallClip,
                }}
              >
                <span className="h-8 w-8 shrink-0 overflow-hidden" style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))', clipPath: smallClip }}>
                  <SafeAlbumImage src={record.avatar} alt={record.name} className="h-full w-full object-cover" emptyLabel="—" failedLabel="!" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-serif text-[12.5px] font-bold tracking-[0.1em]" style={{ color: 'rgb(var(--tj-ui-title))' }}>{record.name}</span>
                  <span className="mt-0.5 flex justify-between gap-2 text-[10.5px]" style={{ color: 'rgba(var(--tj-ui-muted),0.66)' }}>
                    <span>已装 {record.mountedCount}</span>
                    <span>资源 {record.resourceCount}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <div className="flex min-h-0 flex-col gap-4">
        <Panel title="图片工具" contentClassName="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs leading-relaxed" style={{ color: operationBusy ? 'rgba(var(--tj-accent-primary),0.94)' : 'rgba(var(--tj-ui-muted),0.72)' }}>
              {operationBusy
                ? operationLabel
                : 筛选 === 'character'
                  ? `${活跃记录.name || '未选择角色'} · 头像、立绘与参考图统一管理`
                  : `${筛选项.find((项) => 项.id === 筛选)?.label} · 统一归档与浏览`}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={图片文件}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(事件) => {
                  const input = 事件.currentTarget;
                  void 处理导入图片(input.files);
                  input.value = '';
                }}
              />
              <input
                ref={导入文件}
                type="file"
                accept="application/zip,.zip,application/json,.json"
                className="hidden"
                onChange={(事件) => {
                  const input = 事件.currentTarget;
                  onImport(input.files?.[0] ?? null, 导入模式.current);
                  input.value = '';
                }}
              />
              <图库按钮
                disabled={operationBusy}
                primary
                onClick={() => 图片文件.current?.click()}
              >
                导入本地图片
              </图库按钮>
              <图库按钮 disabled={operationBusy} onClick={() => 触发导入('merge')}>导入备份</图库按钮>
              <图库按钮 disabled={operationBusy} onClick={() => 触发导入('replace')}>覆盖恢复</图库按钮>
              <图库按钮 disabled={operationBusy} onClick={onExport}>导出</图库按钮>
              {onOpenAvatarEditor && (
                <图库按钮 onClick={() => onOpenAvatarEditor(活跃记录)}>生成/更换头像</图库按钮>
              )}
            </div>
          </div>
          <div className="text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-ui-muted),0.7)' }}>
            「导入本地图片」把本地文件归档到 {筛选 === 'character' ? `「${活跃记录.name}」名下` : `「${筛选项.find((项) => 项.id === 筛选)?.label}」名下`}；
            「导入备份 / 覆盖恢复」用于本项目导出的 ZIP 相册备份。
          </div>
          {导入提示 ? <提示条 kind={导入提示.kind} text={导入提示.text} /> : null}
          <div className="grid gap-2 sm:grid-cols-4">
            <图库按钮 disabled={!选中项?.src} onClick={显示预览}>图片预览</图库按钮>
            <图库按钮
              disabled={operationBusy}
              active={批量模式}
              onClick={() => { set批量模式((当前) => !当前); set多选([]); }}
            >
              {批量模式 ? `批量选择中 · ${多选.length}` : '批量选择'}
            </图库按钮>
            <图库按钮 disabled={operationBusy || !批量模式 || 多选.length === 0} danger onClick={删除选中}>批量删除</图库按钮>
            <图库按钮
              disabled={筛选 !== 'character' || !选中项 || !活跃记录}
              primary
              onClick={() => 选中项 && onRequestApply({ entry: 选中项.entry, src: 选中项.src })}
            >
              设置到槽位
            </图库按钮>
          </div>
        </Panel>

        <Panel title="图库" contentClassName="space-y-2">
          <div className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'rgba(var(--tj-accent-primary),0.1)' }}>
            <span className="font-serif text-xs tracking-[0.14em]" style={{ color: 'rgba(var(--tj-accent-primary),0.86)' }}>
              {筛选 === 'character' ? `${活跃记录.name || '角色'} · 当前图库` : `${筛选项.find((项) => 项.id === 筛选)?.label} · 当前图库`}
            </span>
            <span className="text-[11px]" style={{ color: 'rgba(var(--tj-ui-faint),0.72)' }}>当前显示 {可见条目.length} 项</span>
          </div>
          {可见条目.length === 0 ? (
            <EmptyLibraryBox
              title="暂无可显示资源"
              desc={筛选 === 'character'
                ? '生成、导入的角色图片与内置头像都会显示在这里。'
                : '生成或导入对应类型图片后会出现在这里。'}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
              {可见条目.map((item) => (
                <图库卡片
                  key={item.entry.id}
                  item={item}
                  active={选中条目 === item.entry.id}
                  batchMode={批量模式}
                  selected={多选.includes(item.entry.id)}
                  onClick={() => 点击条目(item.entry.id)}
                  onDoubleClick={() => { if (item.src) { set选中条目(item.entry.id); set预览打开(true); } }}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={`${活跃记录.name} · 已装槽位`} contentClassName="space-y-2">
        {活跃记录.slots.map((slot) => (
          <div
            key={slot.key}
            className="flex items-center gap-2 px-2.5 py-2"
            style={{
              background: slot.src ? 'rgba(var(--tj-accent-primary),0.075)' : 'rgba(var(--tj-ui-panel-strong),0.36)',
              border: slot.src
                ? '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-strong))'
                : '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
              clipPath: smallClip,
            }}
          >
            <span className="h-10 w-10 shrink-0 overflow-hidden" style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))', clipPath: smallClip }}>
              <SafeAlbumImage src={slot.src} alt={slot.label} className="h-full w-full object-cover" emptyLabel="—" failedLabel="!" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-serif text-[12px] font-semibold tracking-[0.12em]" style={{ color: 'rgb(var(--tj-ui-title))' }}>{slot.label}</span>
              <span className="mt-0.5 block truncate text-[10.5px]" style={{ color: 'rgba(var(--tj-ui-muted),0.7)' }}>{slot.src ? '已设定' : '未设定'}</span>
            </span>
            {slot.src && (
              <button
                type="button"
                onClick={() => onClearSlot({ record: 活跃记录, slotKey: slot.key })}
                className="shrink-0 px-2 py-1 text-[10.5px]"
                style={{ color: 'rgba(var(--tj-danger),0.92)', background: 'rgba(var(--tj-danger),0.09)', border: '1px solid rgba(var(--tj-danger), var(--tj-edge-tint))', clipPath: smallClip }}
              >
                清空
              </button>
            )}
          </div>
        ))}
        {筛选 !== 'character' && 场景条目.length > 0 && (
          <div className="text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-ui-muted),0.7)' }}>
            {sceneLibraryKindLabel(筛选)}共 {场景条目.length} 张，点任意一张可看大图。
          </div>
        )}
        {isNpcLibraryRecord(活跃记录) && (
          <div className="text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-ui-muted),0.66)' }}>
            当前档案头像：{读取NPC头像(活跃记录.npc, '档案') ? '已设定' : '未设定'}
          </div>
        )}
      </Panel>

      <ImagePreviewModal
        open={预览打开 && Boolean(选中项?.src)}
        src={选中项?.src || ''}
        title={`图片预览 · ${选中项?.entry.title || ''}`}
        onClose={() => set预览打开(false)}
      />
    </div>
  );
}

/** 相册里「属于某个角色」的条目（图库按角色筛时用）。 */
function 角色资源条目(album: 相册系统) {
  return album.entries
    .filter((entry) => entry.targetType === 'traveler' || entry.targetType === 'npc')
    .map((entry) => ({ entry, src: 解析相册资源引用(album, `asset:${entry.assetId}`) || '' }));
}

/** 读本地图片为 data URL；大小上限与相册导入一致（12MB）。 */
async function 文件转数据地址(文件: File): Promise<string> {
  const 数据地址 = await fileToDataUrl(文件);
  if (!数据地址) throw new Error('读取到的内容为空');
  return 数据地址;
}

function 图库按钮({
  children,
  onClick,
  disabled = false,
  active = false,
  danger = false,
  primary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  primary?: boolean;
}) {
  const 颜色 = danger ? 'rgba(var(--tj-danger),0.92)' : primary || active ? 'rgb(var(--tj-on-accent))' : 'rgba(var(--tj-accent-primary),0.92)';
  const 背景 = danger
    ? 'rgba(var(--tj-danger),0.13)'
    : primary || active
      ? 'linear-gradient(135deg, rgb(var(--tj-accent-primary)) 0%, rgb(var(--tj-tech-cyan)) 100%)'
      : 'rgba(var(--tj-ui-panel-strong),0.42)';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-[42px] px-3 py-2 font-serif text-xs tracking-[0.14em] disabled:opacity-45"
      style={{
        color: 颜色,
        background: 背景,
        border: danger
          ? '1px solid rgba(var(--tj-danger), var(--tj-edge-tint))'
          : '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
        clipPath: smallClip,
      }}
    >
      {children}
    </button>
  );
}

function 图库卡片({
  item,
  active,
  batchMode,
  selected,
  onClick,
  onDoubleClick,
}: {
  item: CharacterLibraryEntry;
  active: boolean;
  batchMode: boolean;
  selected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const 内置 = item.entry.id.startsWith('builtin-avatar:');
  return (
    <div
      className="relative overflow-hidden"
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: '240px',
        background: selected ? 'rgba(var(--tj-tech-cyan),0.12)' : 'rgba(var(--tj-ui-panel),0.52)',
        border: active || selected
          ? '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-strong))'
          : item.entry.nsfw
            ? '1px solid rgba(var(--tj-ui-nsfw), var(--tj-edge-tint-strong))'
            : '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
        clipPath: cardClip,
      }}
    >
      <button type="button" onClick={onClick} onDoubleClick={onDoubleClick} className="group block w-full text-left">
        <div className="relative aspect-[4/3]">
          <SafeAlbumImage
            src={item.src}
            alt={item.entry.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
            emptyLabel="无图片"
            failedLabel="图片失效"
          />
          {内置 && (
            <span className="absolute left-2 top-2 px-2 py-1 font-serif text-[10px] tracking-[0.12em]" style={{ color: 'rgba(var(--tj-accent-primary),0.96)', background: 'rgba(0,0,0,0.62)', border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-strong))', clipPath: smallClip }}>
              内置
            </span>
          )}
        </div>
        <div className="space-y-1 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-serif text-sm" style={{ color: 'rgb(var(--tj-ui-title))' }}>{item.entry.title}</span>
            {batchMode && (
              <span className="shrink-0 text-[10px]" style={{ color: selected ? 'rgba(var(--tj-tech-cyan),0.96)' : 'rgba(var(--tj-ui-muted),0.6)' }}>
                {selected ? '已选择' : '点选'}
              </span>
            )}
          </div>
          <div className="flex justify-between gap-2 text-[11px]" style={{ color: 'rgba(var(--tj-ui-muted),0.66)' }}>
            <span>{slotLabel(item.entry.slot)}</span>
            {item.entry.nsfw && <span style={{ color: 'rgb(var(--tj-ui-nsfw))' }}>NSFW</span>}
          </div>
        </div>
      </button>
    </div>
  );
}
