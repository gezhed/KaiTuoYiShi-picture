import { useMemo, useState } from 'react';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { 相册条目 } from '@/models/imageGeneration';
import { cardClip, smallClip } from '@/components/ui/clipPaths';
import { 主按钮, 次级按钮, 设置字段 as 字段, 提示条, 页签条 } from '@/components/features/Settings/settingsPrimitives';
import { 创建相册资源引用, 解析相册资源引用 } from '@/utils/albumActions';
import {
  应用图片到槽位,
  卸载槽位图片,
  生成并应用头像,
  建议头像提示词,
  读取槽位引用,
  目标键,
  type 头像目标,
  type 头像槽位选项,
} from '@/utils/avatarActions';
export type 头像编辑页签 = 'generate' | 'library';

interface Props {
  state: UseGameStateReturn;
  /** 可挂载的槽位；旅人与 NPC 各自一套。 */
  槽位选项: 头像槽位选项[];
  /** 打开时默认选中的槽位 id。 */
  默认槽位?: string;
  onClose?: () => void;
  /** 直达「设置 → 文生图」。 */
  onOpenImageGenSettings?: () => void;
}

const 页签: Array<{ id: 头像编辑页签; label: string; desc: string }> = [
  { id: 'generate', label: '文生图生成', desc: '写提示词直接出图并挂上' },
  { id: 'library', label: '从图库选', desc: '复用已归档的图片' },
];

/**
 * 头像 / 立绘编辑器。
 *
 * 这是旧分支「设置到槽位」的等价入口：那套相册面板在新版被重写成
 * 「视觉资产」工作台，槽位挂载的整条链路没有接上工具栏，头像就只剩只读展示。
 * 这里把「选槽位 → 出图 / 复用 → 挂载 → 落盘」收在一个面板里，旅人与 NPC 共用。
 *
 * 大图浏览与批量管理在「视觉资产 → 图库」，这里只管单个角色的槽位。
 */
export function AvatarWorkbench({ state, 槽位选项, 默认槽位, onClose, onOpenImageGenSettings }: Props) {
  const [当前页, set当前页] = useState<头像编辑页签>('generate');
  const [选中槽位键, set选中槽位键] = useState<string>(() => 初始槽位键(默认槽位, 槽位选项));
  const [提示, set提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const [生成中, set生成中] = useState(false);
  const [进度, set进度] = useState('');

  const 选中槽位 = 槽位选项.find((选项) => 选项.id === 选中槽位键) ?? 槽位选项[0];
  /*
   * 提示词按槽位初始化，不做「换槽位就 setState」的副作用。
   *
   * 那种写法会触发级联渲染（`react-hooks/set-state-in-effect`），而且打字时
   * 一旦本组件因别的原因重渲染就有被覆盖的风险。改用调用方给的 `key`：
   * 换角色/槽位时整个表单重挂载，初始值天然就是新槽位的建议提示词。
   */
  const [提示词, set提示词] = useState(() => 建议头像提示词({
    目标: 选中槽位.目标,
    traveler: state.旅人,
    npcs: state.NPC,
  }));

  const 系统 = state.deviceSettings.gameSettings.文生图系统;

  const 图库项 = useMemo(() => state.相册.entries
    .map((条目) => ({
      条目,
      地址: 解析相册资源引用(state.相册, 创建相册资源引用(条目.assetId)),
    }))
    .filter((项): 项 is { 条目: 相册条目; 地址: string } => Boolean(项.地址))
    .reverse(), [state.相册]);

  const 当前引用 = 读取槽位引用(选中槽位.目标, { traveler: state.旅人, npcs: state.NPC });
  const 当前地址 = 解析相册资源引用(state.相册, 当前引用);

  const 处理生成 = async () => {
    if (!提示词.trim()) {
      set提示({ kind: 'error', text: '请先写提示词。' });
      return;
    }
    set生成中(true);
    set进度('');
    set提示({ kind: 'info', text: '正在生成…' });
    try {
      const 尺寸 = 解析尺寸(选中槽位.尺寸);
      // 不传 ComfyUI 生成上下文：它只承载工作流节点映射与任务号，
      // 单张手动画图没有这两样东西需要覆盖，默认值已经够用。
      const 结果 = await 生成并应用头像(state, { 提示词, 目标: 选中槽位.目标, 尺寸 });
      set提示({ kind: 结果.成功 ? 'ok' : 'error', text: 结果.消息 });
    } catch (错误) {
      const 原文 = 错误 instanceof Error ? 错误.message : String(错误);
      const 是未启用 = /未启用/.test(原文);
      set提示({
        kind: 'error',
        text: 是未启用
          ? `${原文} 请到「设置 → 文生图」打开开关并填好渠道地址。`
          : `生成失败：${原文}`,
      });
    } finally {
      set生成中(false);
      set进度('');
    }
  };

  const 处理选用 = async (条目: 相册条目) => {
    set提示({ kind: 'info', text: '正在设置…' });
    const 结果 = await 应用图片到槽位(state, 选中槽位.目标, 创建相册资源引用(条目.assetId), {
      来源: '手动',
      相册: state.相册,
    });
    set提示({ kind: 结果.成功 ? 'ok' : 'error', text: 结果.消息 });
  };

  const 处理清空 = async () => {
    const 结果 = await 卸载槽位图片(state, 选中槽位.目标);
    set提示({ kind: 结果.成功 ? 'ok' : 'error', text: 结果.消息 });
  };

  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap items-start gap-3 px-4 py-3"
        style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))', clipPath: cardClip }}
      >
        <div className="h-16 w-16 shrink-0 overflow-hidden" style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-strong))', clipPath: smallClip }}>
          {当前地址
            ? <img src={当前地址} alt={槽位标签(选中槽位.目标)} className="h-full w-full object-cover" />
            : <div className="flex h-full w-full items-center justify-center text-[10px]" style={{ color: 'rgba(var(--tj-text-secondary),0.7)' }}>空</div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-serif text-sm font-bold tracking-[0.18em]" style={{ color: 'rgb(var(--tj-ui-title))' }}>
            {槽位标签(选中槽位.目标)}
          </div>
          <div className="mt-0.5 text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-ui-body), 0.78)' }}>
            {选中槽位.desc} · 建议尺寸 {选中槽位.尺寸}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: 当前引用 ? 'rgb(var(--tj-success, 80 180 120))' : 'rgba(var(--tj-text-secondary),0.7)' }}>
            {当前引用 ? '已设定' : '未设定'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <次级按钮 onClick={() => void 处理清空()} disabled={!当前引用}>清空槽位</次级按钮>
          {onClose && <次级按钮 onClick={onClose}>关闭</次级按钮>}
        </div>
      </div>

      <字段 label="目标槽位">
        <div className="grid gap-2 sm:grid-cols-2">
          {槽位选项.map((选项) => {
            const 选中 = 目标键(选项.目标) === 目标键(选中槽位.目标);
            const 引用 = 读取槽位引用(选项.目标, { traveler: state.旅人, npcs: state.NPC });
            return (
              <button
                key={选项.id}
                type="button"
                onClick={() => set选中槽位键(选项.id)}
                className="flex items-center gap-2 px-3 py-2 text-left transition-all"
                style={{
                  color: 选中 ? 'rgb(var(--tj-ui-title))' : 'rgba(var(--tj-ui-body),0.86)',
                  background: 选中
                    ? 'linear-gradient(90deg, rgba(var(--tj-accent-primary),0.16), rgba(var(--tj-accent-primary),0.04))'
                    : 'rgba(var(--tj-ui-panel-strong),0.42)',
                  border: 选中
                    ? '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-strong))'
                    : '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
                  clipPath: smallClip,
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-serif text-[12px] font-semibold tracking-[0.12em]">{选项.label}</span>
                  <span className="mt-0.5 block truncate text-[10.5px]" style={{ color: 'rgba(var(--tj-text-secondary),0.75)' }}>{选项.desc}</span>
                </span>
                <span className="shrink-0 text-[10px]" style={{ color: 引用 ? 'rgba(var(--tj-accent-primary),0.95)' : 'rgba(var(--tj-text-secondary),0.6)' }}>
                  {引用 ? '已设定' : '待生成'}
                </span>
              </button>
            );
          })}
        </div>
      </字段>

      <页签条 页签={页签} 当前={当前页} onSelect={set当前页} />

      {当前页 === 'generate' && (
        <div className="space-y-3">
          {!系统.启用 && (
            <提示条 kind="info" text="文生图当前未启用：请到「设置 → 文生图」打开开关，再到对应渠道页填写地址与工作流。" />
          )}
          <字段 label="提示词" hint="会先过替换规则、角色替换与正负词组装，再按占位符写入工作流。">
            <textarea
              className="kaituo-input h-28 w-full px-3 py-2 text-sm leading-relaxed"
              value={提示词}
              onChange={(事件) => set提示词(事件.target.value)}
              placeholder="1girl, solo, silver hair, portrait, upper body"
            />
          </字段>
          <div className="flex flex-wrap items-center gap-2">
            <主按钮 onClick={() => void 处理生成()} disabled={生成中}>
              {生成中 ? (进度 || '生成中…') : '生成并设置到该槽位'}
            </主按钮>
            {onOpenImageGenSettings && <次级按钮 onClick={onOpenImageGenSettings}>打开文生图设置</次级按钮>}
            <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary),0.72)' }}>
              出图后会自动归档进「视觉资产 → 成品图库」。
            </span>
          </div>
        </div>
      )}

      {当前页 === 'library' && (
        <div className="space-y-2">
          {图库项.length === 0 ? (
            <提示条 kind="info" text="图库里还没有图片。先到「视觉资产 → 手动出图」生成，或直接在本面板生成。" />
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {图库项.map((项) => {
                const 已选中 = 当前引用 === 创建相册资源引用(项.条目.assetId);
                return (
                  <button
                    key={项.条目.id}
                    type="button"
                    onClick={() => void 处理选用(项.条目)}
                    className="group overflow-hidden text-left transition-all hover:opacity-90"
                    style={{
                      border: 已选中
                        ? '2px solid rgba(var(--tj-accent-primary),0.9)'
                        : '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
                      clipPath: smallClip,
                    }}
                    title={项.条目.title}
                  >
                    <img src={项.地址} alt={项.条目.title} className="h-24 w-full object-cover" loading="lazy" />
                    <span className="block truncate px-1.5 py-1 text-[10px]" style={{ color: 'rgba(var(--tj-text-secondary),0.8)' }}>
                      {项.条目.title}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {提示 ? <提示条 kind={提示.kind} text={提示.text} /> : null}
    </div>
  );
}

/**
 * 弹窗形态的头像编辑器：伙伴面板与图库都用它，
 * 免得把「设置槽位」这件事在两个地方各写一遍。
 */
export function AvatarEditorDialog({
  state,
  标题,
  槽位选项,
  默认槽位,
  编辑器键,
  onClose,
  onOpenImageGenSettings,
}: Props & { 标题?: string; 编辑器键?: string }) {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      onMouseDown={onClose}
    >
      <div
        className="my-6 w-full max-w-3xl px-4 py-4"
        style={{
          background: 'linear-gradient(160deg, rgba(var(--tj-surface),0.98), rgba(var(--tj-bg-primary),0.98))',
          border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
          clipPath: cardClip,
        }}
        onMouseDown={(事件) => 事件.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-serif text-sm font-bold tracking-[0.18em]" style={{ color: 'rgb(var(--tj-ui-title))' }}>
              {标题 ?? '生成 / 更换头像'}
            </div>
            <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-ui-body),0.78)' }}>
              选一个槽位，写出图提示词或直接从图库里挑一张。设置后会立刻保存。
            </div>
          </div>
          <次级按钮 onClick={onClose}>关闭</次级按钮>
        </div>
        <AvatarWorkbench
          key={编辑器键 ?? 默认槽位 ?? 'default'}
          state={state}
          槽位选项={槽位选项}
          默认槽位={默认槽位}
          onClose={onClose}
          onOpenImageGenSettings={onOpenImageGenSettings}
        />
      </div>
    </div>
  );
}

function 槽位标签(目标: 头像目标): string {
  if (目标.kind === 'traveler') return `旅人 · ${目标.slot}`;
  return `伙伴 · ${目标.slot}`;
}

/**
 * 编辑器打开时默认选中的槽位。
 *
 * 调用方传进来的 `默认槽位` 在类型上是必填的（`Props` 里是可选的，
 * 但 `AvatarEditorDialog` 总会给），所以这里显式接成可能为空的入参再兜底，
 * 不依赖 `??` 的可达性推断。
 */
function 初始槽位键(默认槽位: string | undefined, 槽位选项: 头像槽位选项[]): string {
  if (默认槽位 !== undefined && 默认槽位 !== '') return 默认槽位;
  return 槽位选项.length > 0 ? 槽位选项[0].id : '';
}

function 解析尺寸(文本: string): { 宽度: number; 高度: number } {
  const 匹配 = 文本.match(/(\d{2,4})\s*[xX*]\s*(\d{2,4})/);
  if (!匹配) return { 宽度: 1024, 高度: 1024 };
  return { 宽度: Number(匹配[1]), 高度: Number(匹配[2]) };
}
