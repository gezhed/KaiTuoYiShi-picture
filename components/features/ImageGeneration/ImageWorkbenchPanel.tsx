import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { 相册系统 } from '@/models/imageGeneration';
import type { 角色数据结构 } from '@/models/character';
import type { NPC记录 } from '@/models/npc';
import type { 游戏设置 } from '@/models/settings';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import { 创建相册图片条目, 添加图片到相册, 解析相册资源引用, 创建相册资源引用 } from '@/utils/albumActions';
import { 卸载槽位图片, 槽位键转目标, 旅人槽位选项, 绑定NPC槽位选项, type 头像槽位选项 } from '@/utils/avatarActions';
import { 统计图片缓存, 清空图片缓存, 清理过期缓存, 列出缓存图片, 删除缓存图片 } from '@/services/imageCache';
import { 生成单张插图, 重写提示词标记 } from '@/services/ai/imageGen/generateIllustration';
import type { 角色匹配上下文 } from '@/services/ai/imageGen/characterPrompt';
import { 主按钮, 面板, 提示条, 次级按钮, 开关行, 页签条, 设置字段 as 字段 } from '@/components/features/Settings/settingsPrimitives';
import { ImageLightbox, type 查看图片项 } from './ImageLightbox';
import { AvatarEditorDialog } from './AvatarWorkbench';
import { SlotApplyDialog } from './SlotApplyDialog';
import { GalleryWorkspace, type 图库条目选中 } from '@/components/features/GameSystems/album/GalleryWorkspace';
import { buildAssetMap, buildCharacterLibraryRecords } from '@/components/features/GameSystems/album/galleryWorkspaceLogic';
import { cardClip } from '@/components/ui/clipPaths';
import { IconButton } from '@/components/ui/IconButton';
import { RefreshCw, Trash2 } from 'lucide-react';

export type 工作台页签 = 'gallery' | 'manual' | 'avatars' | 'cache';

interface Props {
  album: 相册系统;
  onAlbumChange: (next: 相册系统) => void;
  traveler: 角色数据结构;
  npcs: NPC记录[];
  /** 图库/头像编辑器需要直接改旅人与 NPC，并用活跃叶子落盘。 */
  state: UseGameStateReturn;
  gameSettings: 游戏设置;
  /** 打开「设置 → 文生图」。文生图设置在子系统分组里，需要直达入口。 */
  onOpenImageGenSettings: () => void;
  onExportAlbum: () => void;
  onImportAlbum: (file: File | null, mode: 'merge' | 'replace') => void;
  albumOperationLabel?: string;
  albumOperationBusy?: boolean;
}

const 页签: Array<{ id: 工作台页签; label: string; desc: string }> = [
  { id: 'gallery', label: '图库', desc: '按角色浏览、预览与设到槽位' },
  { id: 'manual', label: '手动出图', desc: '写提示词直接生成' },
  { id: 'avatars', label: '头像与立绘', desc: '出图并挂到角色槽位' },
  { id: 'cache', label: '图片缓存', desc: '按提示词归档的图廊' },
];

export function ImageWorkbenchPanel({
  album,
  onAlbumChange,
  traveler,
  npcs,
  state,
  gameSettings,
  onOpenImageGenSettings,
  onExportAlbum,
  onImportAlbum,
  albumOperationLabel = '',
  albumOperationBusy = false,
}: Props) {
  const [当前页, set当前页] = useState<工作台页签>('gallery');
  const [提示, set提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const [提示词, set提示词] = useState('');
  const [尺寸, set尺寸] = useState('1024x1024');
  const [生成中, set生成中] = useState(false);
  /** 正在查看的图库下标；null 表示查看器关闭。 */
  const [查看下标, set查看下标] = useState<number | null>(null);
  const [缓存统计, set缓存统计] = useState<{ 条目数: number; 图片数: number; 总字节: number } | null>(null);
  const [缓存预览, set缓存预览] = useState<Array<{
    id: string;
    url: string;
    prompt: string;
    createdAt: number;
    size: number;
    dimensions?: string;
  }>>([]);
  /** 加载中／失败要让用户看得见，否则「缓存里没有图」和「还没加载」长得一样。 */
  const [缓存加载中, set缓存加载中] = useState(true);
  const [缓存出错, set缓存出错] = useState('');
  /** 缓存图的查看器下标；与图库那个分开，避免两处互相顶掉。 */
  const [查看缓存下标, set查看缓存下标] = useState<number | null>(null);
  /** 默认只给图：提示词往往是几百字的 tag 串，铺在网格里既占地方也难扫。 */
  const [显示缓存提示词, set显示缓存提示词] = useState(false);
  /** 当前这批缩略图的 objectURL，刷新与卸载时统一回收。 */
  const 缓存地址表 = useRef<string[]>([]);
  /** 图库里点「设置到槽位」时选中的那张图。 */
  const [待应用, set待应用] = useState<图库条目选中 | null>(null);
  /** 头像编辑器打开时对应的角色槽位选项。 */
  const [编辑器, set编辑器] = useState<{ 标题: string; 槽位: 头像槽位选项[] } | null>(null);

  const 系统 = gameSettings.文生图系统;

  const 归档图 = useMemo(
    () => album.entries
      .map((条目) => ({
        条目,
        // 生成参数存在资源上，不在条目上——查看器要显示提示词与尺寸，得把它一并带出来。
        资源: album.assets.find((甲) => 甲.id === 条目.assetId),
        地址: 解析相册资源引用(album, 创建相册资源引用(条目.assetId)),
      }))
      .filter((项): 项 is { 条目: typeof 项.条目; 资源: typeof 项.资源; 地址: string } => Boolean(项.地址)),
    [album],
  );

  /*
   * 图片缓存必须**真的把图列出来**。
   *
   * 之前这里只取了一个计数，图廊那格的 state（缓存预览）从头到尾没人写过，
   * 于是无论缓存里有多少张，页面永远是空的 —— 用户看到的就是
   * 「我的图片缓存没有图片了，新生成的也不显示」。
   */
  const 刷新缓存 = useCallback(async () => {
    set缓存加载中(true);
    // 关闭缓存图的查看器：它用的就是下面这批 objectURL，回收后图会裂。
    set查看缓存下标(null);
    try {
      const [统计, 列表] = await Promise.all([统计图片缓存(), 列出缓存图片()]);
      set缓存统计(统计);
      // 先回收上一批，避免反复刷新把 objectURL 攒在内存里。
      for (const 地址 of 缓存地址表.current) URL.revokeObjectURL(地址);
      缓存地址表.current = [];
      set缓存预览(列表.map(({ 条目, 图片, blob }) => {
        const url = URL.createObjectURL(blob);
        缓存地址表.current.push(url);
        return {
          id: 图片.id,
          url,
          prompt: 条目.prompt || '（无提示词记录）',
          createdAt: 图片.createdAt,
          size: 图片.size ?? blob.size,
          dimensions: 图片.width && 图片.height ? `${图片.width}x${图片.height}` : undefined,
        };
      }));
      set缓存出错('');
    } catch (错误) {
      set缓存统计(null);
      set缓存预览([]);
      set缓存出错(错误 instanceof Error ? 错误.message : String(错误));
    } finally {
      set缓存加载中(false);
    }
  }, []);

  useEffect(() => {
    void 刷新缓存();
    return () => {
      for (const 地址 of 缓存地址表.current) URL.revokeObjectURL(地址);
      缓存地址表.current = [];
    };
  }, [刷新缓存]);

  // 过期清理只在面板打开时做一次，避免每回合都扫全库。
  useEffect(() => {
    if (系统.图片缓存.保留天数 > 0) void 清理过期缓存(系统.图片缓存.保留天数);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const 角色上下文: 角色匹配上下文 = useMemo(() => ({
    启用列表: 系统.角色启用列表,
    全部角色: 系统.角色卡,
  }), [系统.角色启用列表, 系统.角色卡]);

  /** 「头像与立绘」页的角色清单：旅人 + 全部 NPC。 */
  const 角色清单 = useMemo(() => {
    const 全部 = buildCharacterLibraryRecords(traveler, npcs, album, buildAssetMap(album), true);
    return 全部.map((记录) => ({
      记录,
      头像: 记录.avatar,
    }));
  }, [traveler, npcs, album]);

  const 处理出图 = async () => {
    if (!提示词.trim()) {
      set提示({ kind: 'error', text: '请先写提示词。' });
      return;
    }
    set生成中(true);
    set提示({ kind: 'info', text: '正在生成…' });
    try {
      const 结果 = await 生成单张插图(
        系统,
        { 提示词标记: 重写提示词标记(提示词), 覆盖尺寸: 解析尺寸(尺寸), 标题: '手动生图' },
        角色上下文,
      );
      const 条目 = 创建相册图片条目({
        title: 提示词.slice(0, 24) || '手动生图',
        src: 结果.结果.数据地址,
        source: 'generated',
        targetType: 'misc',
        slot: 'misc',
        prompt: 结果.正向提示词,
        negativePrompt: 结果.负向提示词,
        finalPrompt: 结果.正向提示词,
        finalNegativePrompt: 结果.负向提示词,
        dimensions: `${结果.结果.宽度}x${结果.结果.高度}`,
        model: 结果.结果.模型,
        backend: 'comfyui',
        tags: ['手动生图'],
        note: `种子 ${结果.结果.种子}`,
      });
      onAlbumChange(添加图片到相册(album, 条目));
      set提示({ kind: 'ok', text: `生成完成：${结果.结果.宽度}x${结果.结果.高度}，种子 ${结果.结果.种子}。` });
      // 新图已写入缓存：立刻重列，用户能当场看到它出现在「图片缓存」里。
      await 刷新缓存();
    } catch (错误) {
      const 原文 = 错误 instanceof Error ? 错误.message : String(错误);
      // 未启用是最常见的失败原因，但它不该是一句死路——直接给出该去哪一步。
      const 是未启用 = /未启用/.test(原文);
      set提示({
        kind: 'error',
        text: 是未启用
          ? `${原文} 请点上方「打开文生图设置」，在「总览」页打开开关，再到「ComfyUI」页填写地址。`
          : `生成失败：${原文}`,
      });
      if (是未启用) set当前页('manual');
    } finally {
      set生成中(false);
    }
  };

  const 处理清空缓存 = async () => {
    await 清空图片缓存();
    await 刷新缓存();
    set查看缓存下标(null);
    set提示({ kind: 'ok', text: '图片缓存已清空。' });
  };

  /** 删掉缓存里的单张图（同一条目下其余张保留）。 */
  const 处理删除缓存图片 = async (图片Id: string) => {
    await 删除缓存图片(图片Id);
    await 刷新缓存();
    set查看缓存下标(null);
    set提示({ kind: 'ok', text: '已从图片缓存里删除这一张。' });
  };

  /** 打开某个角色的头像编辑器：旅人与伙伴各一套槽位。 */
  const 打开编辑器 = (record: import('@/components/features/GameSystems/album/galleryWorkspaceLogic').CharacterLibraryRecord) => {
    set编辑器({
      标题: record.kind === 'traveler' ? `${record.name} · 生成 / 更换头像` : `${record.name} · 生成 / 更换头像`,
      槽位: record.kind === 'traveler' ? 旅人槽位选项 : 绑定NPC槽位选项(record.id),
    });
  };

  const 清空槽位 = async (参数: {
    record: import('@/components/features/GameSystems/album/galleryWorkspaceLogic').CharacterLibraryRecord;
    slotKey: string;
  }) => {
    const 结果 = await 卸载槽位图片(state, 槽位键转目标(参数.record.id, 参数.slotKey));
    set提示({ kind: 结果.成功 ? 'ok' : 'error', text: 结果.消息 });
  };

  return (
    <div className="space-y-4">
      <div className="px-4 py-3" style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))', clipPath: cardClip }}>
        <div className="font-serif text-base font-bold tracking-[0.24em]" style={{ color: 'rgb(var(--tj-ui-title))' }}>
          视觉资产
        </div>
        <div className="mt-1 text-xs leading-relaxed" style={{ color: 'rgba(var(--tj-ui-body), 0.78)' }}>
          生图设置已移到「设置 → 文生图」。这里浏览图库、按角色更换头像、手动出图与管理缓存。
        </div>
        {/* 文生图设置在「子系统」分组里，只写一句「去设置里开」用户找不到，所以给直达按钮。 */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <主按钮 onClick={onOpenImageGenSettings}>打开文生图设置</主按钮>
          {!系统.启用 && (
            <span className="text-[11px]" style={{ color: 'rgb(var(--tj-warning))' }}>
              当前未启用：总览页打开「启用文生图」，再到 ComfyUI 页填地址。
            </span>
          )}
        </div>
      </div>

      <页签条 页签={页签} 当前={当前页} onSelect={set当前页} />

      {当前页 === 'gallery' && (
        // min-w-0：图库是三列网格，缺了它父级 flex/grid 会按内容撑宽而顶出容器。
        <div className="min-w-0">
          <GalleryWorkspace
            album={album}
            traveler={traveler}
            npcs={npcs}
            onRequestApply={set待应用}
            onClearSlot={(参数) => void 清空槽位(参数)}
            onAlbumChange={onAlbumChange}
            onExport={onExportAlbum}
            onImport={onImportAlbum}
            operationLabel={albumOperationLabel}
            operationBusy={albumOperationBusy}
            onOpenAvatarEditor={打开编辑器}
          />
        </div>
      )}

      {当前页 === 'manual' && (
        <面板 title="手动出图" desc="提示词会先过替换规则、角色替换与正负词组装，再按占位符写入工作流。">
          <字段 label="提示词" hint="可以写 image###提示词### 形式；裸文本也接受。末尾写 960x1280 可覆盖分辨率。">
            <textarea
              className="kaituo-input h-32 w-full px-3 py-2 text-sm leading-relaxed"
              value={提示词}
              onChange={(事件) => set提示词(事件.target.value)}
              placeholder="1girl, solo, silver hair, night city"
            />
          </字段>
          <字段 label="尺寸">
            <input
              className="kaituo-input w-full px-3 py-2 text-sm font-mono"
              value={尺寸}
              onChange={(事件) => set尺寸(事件.target.value)}
              placeholder="1024x1024"
            />
          </字段>
          <主按钮 onClick={() => void 处理出图()} disabled={生成中}>
            {生成中 ? '生成中…' : '生成图片'}
          </主按钮>
        </面板>
      )}

      {当前页 === 'avatars' && (
        <面板 title="头像与立绘" desc="选一个角色，出图或复用它已有的图片，直接挂到档案/正文/手机头像或立绘槽位。">
          {角色清单.length === 0 ? (
            <提示条 kind="info" text="还没有可编辑的角色。先开局或让剧情写入伙伴档案。" />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {角色清单.map(({ 记录, 头像 }) => (
                <button
                  key={记录.id}
                  type="button"
                  onClick={() => 打开编辑器(记录)}
                  className="flex items-center gap-3 px-3 py-2.5 text-left transition-all hover:opacity-90"
                  style={{
                    background: 'rgba(var(--tj-ui-panel-strong),0.42)',
                    border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
                    clipPath: cardClip,
                  }}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden" style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))', clipPath: cardClip }}>
                    {头像
                      ? <img src={头像} alt={记录.name} className="h-full w-full object-cover" />
                      : <span className="text-[10px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>空</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-sm font-bold tracking-[0.12em]" style={{ color: 'rgb(var(--tj-ui-title))' }}>{记录.name}</span>
                    <span className="mt-0.5 block text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.78)' }}>
                      {记录.kind === 'traveler' ? '旅人' : '伙伴'} · 档案/正文/手机头像与立绘 · 已设 {记录.mountedCount}/4
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </面板>
      )}

      {当前页 === 'cache' && (
        <面板 title="图片缓存" desc="条目以提示词为键，同一提示词的多次生成累积成一条有序图廊。点图可放大、下载或删掉这一张。">
          <开关行
            label="显示提示词"
            desc="关掉只留图（默认）；打开后每张图下面显示它的提示词。"
            checked={显示缓存提示词}
            onChange={set显示缓存提示词}
          />
          <div className="flex flex-wrap items-center gap-2">
            <IconButton icon={RefreshCw} label="刷新缓存" description="重新读取缓存里的图片与容量" onClick={() => void 刷新缓存()} />
            <次级按钮 onClick={() => void 处理清空缓存()}>清空缓存</次级按钮>
            {缓存统计 ? (
              <提示条
                kind="info"
                text={`条目 ${缓存统计.条目数} 条 · 图片 ${缓存统计.图片数} 张 · 占用 ${格式化字节(缓存统计.总字节)}`}
              />
            ) : null}
          </div>
          {缓存出错 ? <提示条 kind="error" text={`读取图片缓存失败：${缓存出错}`} /> : null}
          {缓存加载中 ? (
            <div className="text-xs" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>正在读取图片缓存…</div>
          ) : null}
          {!缓存加载中 && !缓存出错 && 缓存预览.length === 0 ? (
            <提示条
              kind="info"
              text={缓存统计?.图片数
                ? `缓存里有 ${缓存统计.图片数} 张图，但都读不出字节（可能已损坏）。可以清空后重新生成。`
                : '缓存里还没有图片。开启「总览 → 图片缓存」后，每次出图都会按提示词归档到这里；也可以在「手动出图」页生成一张。'}
            />
          ) : null}
          {缓存预览.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {缓存预览.map((项, 序号) => (
                <figure
                  key={项.id}
                  className="group relative"
                  style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
                >
                  <img
                    src={项.url}
                    alt={项.prompt}
                    loading="lazy"
                    onClick={() => set查看缓存下标(序号)}
                    className="h-28 w-full cursor-zoom-in object-cover"
                  />
                  <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <IconButton
                      size="sm"
                      icon={Trash2}
                      label="删除这一张"
                      description="只删缓存里的这张，不影响图库与正文插图"
                      onClick={() => void 处理删除缓存图片(项.id)}
                    />
                  </div>
                  <figcaption className="px-2 py-1 text-[11px] leading-tight" style={{ color: 'rgba(var(--tj-text-secondary), 0.8)' }}>
                    {显示缓存提示词 ? (
                      <span className="line-clamp-2 block break-words">{项.prompt}</span>
                    ) : null}
                    <span className={`${显示缓存提示词 ? 'mt-0.5 ' : ''}block font-mono opacity-70`}>
                      {项.dimensions ? `${项.dimensions} · ` : ''}{格式化字节(项.size)} · {new Date(项.createdAt).toLocaleString()}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </面板>
      )}

      {提示 ? <提示条 kind={提示.kind} text={提示.text} /> : null}

      {待应用 ? (
        <SlotApplyDialog
          state={state}
          引用={创建相册资源引用(待应用.entry.assetId)}
          预览地址={待应用.src}
          title={待应用.entry.title}
          onClose={() => set待应用(null)}
        />
      ) : null}

      {编辑器 ? (
        <AvatarEditorDialog
          state={state}
          标题={编辑器.标题}
          槽位选项={编辑器.槽位}
          编辑器键={`${编辑器.标题}:${编辑器.槽位[0]?.id ?? ''}`}
          onClose={() => set编辑器(null)}
          onOpenImageGenSettings={onOpenImageGenSettings}
        />
      ) : null}

      <ImageLightbox
        项={查看下标 === null ? null : (归档图[查看下标] ? 转查看项(归档图[查看下标]) : null)}
        onClose={() => set查看下标(null)}
        onPrev={查看下标 !== null && 查看下标 > 0 ? () => set查看下标(查看下标 - 1) : null}
        onNext={查看下标 !== null && 查看下标 < 归档图.length - 1 ? () => set查看下标(查看下标 + 1) : null}
      />

      <ImageLightbox
        项={查看缓存下标 === null ? null : (缓存预览[查看缓存下标]
          ? {
            id: 缓存预览[查看缓存下标].id,
            src: 缓存预览[查看缓存下标].url,
            title: '图片缓存',
            prompt: 缓存预览[查看缓存下标].prompt,
            dimensions: 缓存预览[查看缓存下标].dimensions,
            note: `${格式化字节(缓存预览[查看缓存下标].size)} · ${new Date(缓存预览[查看缓存下标].createdAt).toLocaleString()}`,
            createdAt: 缓存预览[查看缓存下标].createdAt,
          }
          : null)}
        onClose={() => set查看缓存下标(null)}
        onPrev={查看缓存下标 !== null && 查看缓存下标 > 0 ? () => set查看缓存下标(查看缓存下标 - 1) : null}
        onNext={查看缓存下标 !== null && 查看缓存下标 < 缓存预览.length - 1 ? () => set查看缓存下标(查看缓存下标 + 1) : null}
      />
    </div>
  );
}

/** 相册条目 + 资源 → 查看器入参。生成参数在资源上。 */
function 转查看项(项: {
  条目: import('@/models/imageGeneration').相册条目;
  资源: import('@/models/imageGeneration').图片资源 | undefined;
  地址: string;
}): 查看图片项 {
  return {
    id: 项.条目.id,
    src: 项.地址,
    title: 项.条目.title || '未命名',
    prompt: 项.资源?.finalPrompt || 项.资源?.prompt,
    negativePrompt: 项.资源?.finalNegativePrompt || 项.资源?.negativePrompt,
    dimensions: 项.资源?.dimensions
      ?? (项.资源?.width && 项.资源.height ? `${项.资源.width}x${项.资源.height}` : undefined),
    model: 项.资源?.model,
    note: 项.条目.note,
    createdAt: 项.条目.createdAt,
  };
}

function 解析尺寸(文本: string): { 宽度: number; 高度: number } | null {
  const 匹配 = 文本.match(/(\d{2,4})\s*[xX*]\s*(\d{2,4})/);
  if (!匹配) return null;
  return { 宽度: Number(匹配[1]), 高度: Number(匹配[2]) };
}

function 格式化字节(字节: number): string {
  if (字节 < 1024) return `${字节} B`;
  if (字节 < 1024 * 1024) return `${(字节 / 1024).toFixed(1)} KB`;
  return `${(字节 / 1024 / 1024).toFixed(1)} MB`;
}
