import { useEffect, useMemo, useState } from 'react';
import type { 相册系统 } from '@/models/imageGeneration';
import type { 游戏设置 } from '@/models/settings';
import { 创建相册图片条目, 添加图片到相册, 解析相册资源引用, 创建相册资源引用 } from '@/utils/albumActions';
import { 统计图片缓存, 清空图片缓存, 清理过期缓存 } from '@/services/imageCache';
import { 生成单张插图, 重写提示词标记 } from '@/services/ai/imageGen/generateIllustration';
import type { 角色匹配上下文 } from '@/services/ai/imageGen/characterPrompt';
import { 主按钮, 面板, 提示条, 次级按钮, 页签条, 设置字段 as 字段 } from '@/components/features/Settings/settingsPrimitives';
import { ImageLightbox, type 查看图片项 } from './ImageLightbox';
import { cardClip } from '@/components/ui/clipPaths';

export type 工作台页签 = 'gallery' | 'manual' | 'cache';

interface Props {
  album: 相册系统;
  onAlbumChange: (next: 相册系统) => void;
  gameSettings: 游戏设置;
  /** 打开「设置 → 文生图」。文生图设置在子系统分组里，需要直达入口。 */
  onOpenImageGenSettings: () => void;
}

const 页签: Array<{ id: 工作台页签; label: string; desc: string }> = [
  { id: 'gallery', label: '成品图库', desc: '已归档的图片' },
  { id: 'manual', label: '手动出图', desc: '写提示词直接生成' },
  { id: 'cache', label: '图片缓存', desc: '按提示词归档的图廊' },
];

export function ImageWorkbenchPanel({ album, onAlbumChange, gameSettings, onOpenImageGenSettings }: Props) {
  const [当前页, set当前页] = useState<工作台页签>('gallery');
  const [提示, set提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const [提示词, set提示词] = useState('');
  const [尺寸, set尺寸] = useState('1024x1024');
  const [生成中, set生成中] = useState(false);
  /** 正在查看的图库下标；null 表示查看器关闭。 */
  const [查看下标, set查看下标] = useState<number | null>(null);
  const [缓存统计, set缓存统计] = useState<{ 条目数: number; 图片数: number; 总字节: number } | null>(null);
  const [缓存预览, set缓存预览] = useState<Array<{ id: string; url: string; prompt: string }>>([]);

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

  useEffect(() => {
    void (async () => {
      try {
        set缓存统计(await 统计图片缓存());
      } catch {
        set缓存统计(null);
      }
    })();
  }, []);

  // 过期清理只在面板打开时做一次，避免每回合都扫全库。
  useEffect(() => {
    if (系统.图片缓存.保留天数 > 0) void 清理过期缓存(系统.图片缓存.保留天数);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const 角色上下文: 角色匹配上下文 = useMemo(() => ({
    启用列表: 系统.角色启用列表,
    全部角色: 系统.角色卡,
  }), [系统.角色启用列表, 系统.角色卡]);

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
      set缓存统计(await 统计图片缓存().catch(() => null));
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
    set缓存预览([]);
    set缓存统计(await 统计图片缓存().catch(() => null));
    set提示({ kind: 'ok', text: '图片缓存已清空。' });
  };

  return (
    <div className="space-y-4">
      <div className="px-4 py-3" style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))', clipPath: cardClip }}>
        <div className="font-serif text-base font-bold tracking-[0.24em]" style={{ color: 'rgb(var(--tj-ui-title))' }}>
          视觉资产
        </div>
        <div className="mt-1 text-xs leading-relaxed" style={{ color: 'rgba(var(--tj-ui-body), 0.78)' }}>
          生图设置已移到「设置 → 文生图」。这里看图、手动出图与管理缓存。
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
        <面板 title="成品图库" desc={`共 ${归档图.length} 张。点任意一张看完整大图与生成参数。`}>
          {归档图.length === 0 ? (
            <提示条 kind="info" text="还没有图片。去「手动出图」生成第一张。" />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {归档图.map((项, 下标) => (
                <figure
                  key={项.条目.id}
                  style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
                >
                  <button
                    type="button"
                    className="block w-full transition-all hover:opacity-90"
                    onClick={() => set查看下标(下标)}
                    title="点击查看完整大图"
                  >
                    {/* 缩略图可以裁切；完整图在查看器里按原始比例显示。 */}
                    <img src={项.地址} alt={项.条目.title} className="h-32 w-full object-cover" loading="lazy" />
                  </button>
                  <figcaption className="px-2 py-1 text-[11px] leading-tight" style={{ color: 'rgba(var(--tj-text-secondary), 0.8)' }}>
                    {项.条目.title}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </面板>
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

      {当前页 === 'cache' && (
        <面板 title="图片缓存" desc="条目以提示词为键，同一提示词的多次生成累积成一条有序图廊。">
          <div className="flex flex-wrap gap-2">
            <次级按钮 onClick={() => void (async () => {
              set缓存统计(await 统计图片缓存().catch(() => null));
            })()}>统计容量</次级按钮>
            <次级按钮 onClick={() => void 处理清空缓存()}>清空缓存</次级按钮>
          </div>
          {缓存统计 ? (
            <提示条
              kind="info"
              text={`条目 ${缓存统计.条目数} 条 · 图片 ${缓存统计.图片数} 张 · 占用 ${格式化字节(缓存统计.总字节)}`}
            />
          ) : null}
          {缓存预览.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {缓存预览.map((项) => (
                <figure key={项.id} style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}>
                  <img src={项.url} alt={项.prompt} className="h-28 w-full object-cover" loading="lazy" />
                  <figcaption className="px-2 py-1 text-[11px] leading-tight" style={{ color: 'rgba(var(--tj-text-secondary), 0.8)' }}>
                    {项.prompt}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </面板>
      )}

      {提示 ? <提示条 kind={提示.kind} text={提示.text} /> : null}

      <ImageLightbox
        项={查看下标 === null ? null : (归档图[查看下标] ? 转查看项(归档图[查看下标]) : null)}
        onClose={() => set查看下标(null)}
        onPrev={查看下标 !== null && 查看下标 > 0 ? () => set查看下标(查看下标 - 1) : null}
        onNext={查看下标 !== null && 查看下标 < 归档图.length - 1 ? () => set查看下标(查看下标 + 1) : null}
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
      ?? (项.资源?.width && 项.资源?.height ? `${项.资源.width}x${项.资源.height}` : undefined),
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
