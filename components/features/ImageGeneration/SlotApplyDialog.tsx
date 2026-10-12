import { useMemo, useState } from 'react';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import { 归一化NPC记录列表 } from '@/models/npc';
import { cardClip, smallClip } from '@/components/ui/clipPaths';
import { 次级按钮, 设置字段 as 字段, 提示条 } from '@/components/features/Settings/settingsPrimitives';
import { 应用图片到槽位, 旅人槽位选项, 绑定NPC槽位选项 } from '@/utils/avatarActions';

interface Props {
  state: UseGameStateReturn;
  /** 待挂载的引用：相册条目用 `asset:<id>`，内置头像直接用它的 data 地址。 */
  引用: string;
  预览地址?: string;
  title?: string;
  onClose: () => void;
  /** 挂载成功后通知调用方（例如刷新选中状态）。 */
  onApplied?: () => void;
}

/**
 * 「设置到槽位」对话框。
 *
 * 旧分支这一步在相册面板里：选中图 → 设置到槽位 → 挑槽位。新版工作台只剩看图，
 * 这里把它补回来，并复用 `utils/avatarActions` 的挂载与落盘逻辑，
 * 因此旅人与伙伴共用同一套槽位语义。
 */
export function SlotApplyDialog({ state, 引用, 预览地址, title, onClose, onApplied }: Props) {
  const [选中NPC, set选中NPC] = useState('');
  const [提示, set提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const [忙碌, set忙碌] = useState(false);

  const npcs = useMemo(
    () => 归一化NPC记录列表(state.NPC).filter((项) => 项.关系 !== 'enemy'),
    [state.NPC],
  );

  const 处理应用 = async (目标: import('@/utils/avatarActions').头像目标) => {
    if (目标.kind === 'npc' && !目标.npcId) {
      set提示({ kind: 'error', text: '请先选择一个伙伴。' });
      return;
    }
    set忙碌(true);
    set提示({ kind: 'info', text: '正在设置…' });
    const 结果 = await 应用图片到槽位(state, 目标, 引用, { 来源: '手动', 相册: state.相册 });
    set忙碌(false);
    set提示({ kind: 结果.成功 ? 'ok' : 'error', text: 结果.消息 });
    onApplied?.();
  };

  const 有效NPC = 选中NPC || npcs[0]?.id || '';

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      onMouseDown={onClose}
    >
      <div
        className="max-h-[86vh] w-full max-w-2xl overflow-y-auto px-4 py-4"
        style={{
          background: 'linear-gradient(160deg, rgba(var(--tj-surface),0.98), rgba(var(--tj-bg-primary),0.98))',
          border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
          clipPath: cardClip,
        }}
        onMouseDown={(事件) => 事件.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {预览地址 ? (
            <img
              src={预览地址}
              alt={title || '待设置图片'}
              className="h-20 w-20 shrink-0 object-cover"
              style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-strong))', clipPath: smallClip }}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="font-serif text-sm font-bold tracking-[0.18em]" style={{ color: 'rgb(var(--tj-ui-title))' }}>
              设置到槽位
            </div>
            <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-ui-body),0.78)' }}>
              {title ? `「${title}」` : '这张图'}会挂到所选槽位并立刻保存。档案头像同时作为该角色的默认头像。
            </div>
          </div>
          <次级按钮 onClick={onClose}>关闭</次级按钮>
        </div>

        <div className="mt-3">
          <字段 label="旅人槽位">
            <div className="grid gap-2 sm:grid-cols-2">
              {旅人槽位选项.map((选项) => (
                <button
                  key={选项.id}
                  type="button"
                  disabled={忙碌}
                  onClick={() => void 处理应用(选项.目标)}
                  className="px-3 py-2 text-left transition-all hover:opacity-90 disabled:opacity-45"
                  style={{
                    background: 'rgba(var(--tj-ui-panel-strong),0.42)',
                    border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
                    clipPath: smallClip,
                  }}
                >
                  <span className="block font-serif text-[12px] font-semibold tracking-[0.12em]" style={{ color: 'rgb(var(--tj-ui-title))' }}>{选项.label}</span>
                  <span className="mt-0.5 block text-[10.5px]" style={{ color: 'rgba(var(--tj-text-secondary),0.75)' }}>{选项.desc}</span>
                </button>
              ))}
            </div>
          </字段>
        </div>

        <div className="mt-3">
          <字段 label="伙伴角色">
            {npcs.length === 0 ? (
              <提示条 kind="info" text="当前存档里还没有伙伴角色。" />
            ) : (
              <>
                <select
                  className="kaituo-input mb-2 w-full px-3 py-2 text-sm"
                  value={有效NPC}
                  onChange={(事件) => set选中NPC(事件.target.value)}
                >
                  {npcs.map((项) => (
                    <option key={项.id} value={项.id}>
                      {项.姓名}{项.别名 ? `（${项.别名}）` : ''}
                    </option>
                  ))}
                </select>
                <div className="grid gap-2 sm:grid-cols-2">
                  {绑定NPC槽位选项(有效NPC).map((选项) => (
                    <button
                      key={选项.id}
                      type="button"
                      disabled={忙碌}
                      onClick={() => void 处理应用(选项.目标)}
                      className="px-3 py-2 text-left transition-all hover:opacity-90 disabled:opacity-45"
                      style={{
                        background: 'rgba(var(--tj-ui-panel-strong),0.42)',
                        border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
                        clipPath: smallClip,
                      }}
                    >
                      <span className="block font-serif text-[12px] font-semibold tracking-[0.12em]" style={{ color: 'rgb(var(--tj-ui-title))' }}>{选项.label}</span>
                      <span className="mt-0.5 block text-[10.5px]" style={{ color: 'rgba(var(--tj-text-secondary),0.75)' }}>{选项.desc}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </字段>
        </div>

        {提示 ? <div className="mt-3"><提示条 kind={提示.kind} text={提示.text} /></div> : null}
      </div>
    </div>
  );
}
