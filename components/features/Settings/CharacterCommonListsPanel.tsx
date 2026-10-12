import { useMemo, useState } from 'react';
import type { 通用角色列表预设, 通用服装列表预设, 文生图系统设置 } from '@/models/genSystem';
import {
  默认通用角色列表名,
  默认通用服装列表名,
} from '@/models/genSystem';
import {
  面板,
  提示条,
  次级按钮,
  设置字段 as 字段,
} from '@/components/features/Settings/settingsPrimitives';
import { 角色预设条 } from './characterPresetBar';
import { 全部服装, 生成通用角色列表文本, 生成通用服装列表文本 } from '@/services/ai/imageGen/characterInjection';
import { 去掉键 } from './settingsShared';

/**
 * 通用角色列表 / 通用服装启用列表。
 *
 * 上游把这两份清单做成独立页签（`character.html` L555-L680）：
 * 它们不属于任何角色，是「全场通用」的备选池，分别注入
 * `{{通用角色启用列表}}` 与 `{{通用服装启用列表}}`。
 */
export function CharacterCommonListsPanel({
  设置,
  onPatch,
}: {
  设置: 文生图系统设置;
  onPatch: (部分: Partial<文生图系统设置>) => void;
}) {
  const [提示, set提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const 角色预设列表 = 设置.通用角色列表;
  const 当前角色列表: 通用角色列表预设 = 角色预设列表[设置.当前通用角色列表] ?? { 角色: [] };
  const 服装预设列表 = 设置.通用服装列表;
  const 当前服装列表: 通用服装列表预设 = 服装预设列表[设置.当前通用服装列表] ?? { 服装: [] };

  const 全部角色 = useMemo(() => Object.values(设置.角色卡), [设置.角色卡]);
  const 全部可用服装 = useMemo(() => 全部服装(设置), [设置]);
  const [待添加角色, set待添加角色] = useState('');
  const [待添加服装, set待添加服装] = useState('');

  const 角色渲染预览 = useMemo(() => 生成通用角色列表文本(设置), [设置]);
  const 服装渲染预览 = useMemo(() => 生成通用服装列表文本(设置), [设置]);

  const 角色名 = (id: string) => {
    const 角色 = 设置.角色卡[id];
    return 角色 ? ([角色.nameCN, 角色.nameEN].filter(Boolean).join(' / ') || id) : `${id}（不存在）`;
  };

  return (
    <div className="space-y-4">
      <面板
        title="通用角色列表"
        desc="与启用列表的区别：这里不参与触发判定，只是「候选池」，整份渲染进 {{通用角色启用列表}}。"
      >
        <角色预设条
          名称列表={Object.keys(角色预设列表)}
          当前={设置.当前通用角色列表}
          新建默认名="通用角色列表"
          on切换={(名称) => onPatch({ 当前通用角色列表: 名称 })}
          on新建={(名称) => {
            onPatch({ 通用角色列表: { ...角色预设列表, [名称]: { 角色: [] } }, 当前通用角色列表: 名称 });
          }}
          on另存为={(名称) => {
            onPatch({
              通用角色列表: { ...角色预设列表, [名称]: { 角色: [...当前角色列表.角色] } },
              当前通用角色列表: 名称,
            });
          }}
          on重命名={(旧名, 新名) => {
            const 下一 = { ...去掉键(角色预设列表, 旧名), [新名]: 角色预设列表[旧名] };
            onPatch({ 通用角色列表: 下一, 当前通用角色列表: 新名 });
          }}
          on删除={(名称) => {
            const 下一 = 去掉键(角色预设列表, 名称);
            const 剩 = Object.keys(下一);
            onPatch({
              通用角色列表: 剩.length > 0 ? 下一 : { [默认通用角色列表名]: { 角色: [] } },
              当前通用角色列表: 剩[0] ?? 默认通用角色列表名,
            });
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="kaituo-input min-w-[200px] flex-1 px-2 py-1.5 text-xs"
            value={待添加角色}
            onChange={(事件) => set待添加角色(事件.target.value)}
          >
            <option value="">（选择要加入的角色）</option>
            {全部角色
              .filter((角色) => !当前角色列表.角色.includes(角色.id))
              .map((角色) => (
                <option key={角色.id} value={角色.id}>{角色名(角色.id)}</option>
              ))}
          </select>
          <次级按钮
            disabled={!待添加角色}
            onClick={() => {
              onPatch({
                通用角色列表: {
                  ...角色预设列表,
                  [设置.当前通用角色列表]: { 角色: [...当前角色列表.角色, 待添加角色] },
                },
              });
              set待添加角色('');
              set提示({ kind: 'ok', text: '已加入通用角色列表。' });
            }}
          >
            加入
          </次级按钮>
        </div>
        {当前角色列表.角色.length === 0 ? (
          <提示条 kind="info" text="还没有通用角色。{{通用角色启用列表}} 会渲染成「暂未配置通用角色」。" />
        ) : (
          <div className="space-y-1">
            {当前角色列表.角色.map((id) => (
              <div key={id} className="flex items-center gap-2 px-2 py-1"
                style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}>
                <span className="min-w-0 flex-1 truncate text-xs">{角色名(id)}</span>
                <次级按钮
                  onClick={() => onPatch({
                    通用角色列表: {
                      ...角色预设列表,
                      [设置.当前通用角色列表]: { 角色: 当前角色列表.角色.filter((项) => 项 !== id) },
                    },
                  })}
                >
                  移除
                </次级按钮>
              </div>
            ))}
          </div>
        )}
        <字段 label="渲染结果：{{通用角色启用列表}}">
          <div className="kaituo-input max-h-32 overflow-auto px-2 py-1.5 text-[11px] font-mono leading-relaxed">
            {角色渲染预览 || '（空）'}
          </div>
        </字段>
      </面板>

      <面板
        title="通用服装启用列表"
        desc="跨角色的服装池，渲染进 {{通用服装启用列表}}。$…$ 的服装触发仍然按角色卡内的服装匹配，两者互不影响。"
      >
        <角色预设条
          名称列表={Object.keys(服装预设列表)}
          当前={设置.当前通用服装列表}
          新建默认名="通用服装列表"
          on切换={(名称) => onPatch({ 当前通用服装列表: 名称 })}
          on新建={(名称) => {
            onPatch({ 通用服装列表: { ...服装预设列表, [名称]: { 服装: [] } }, 当前通用服装列表: 名称 });
          }}
          on另存为={(名称) => {
            onPatch({
              通用服装列表: { ...服装预设列表, [名称]: { 服装: [...当前服装列表.服装] } },
              当前通用服装列表: 名称,
            });
          }}
          on重命名={(旧名, 新名) => {
            const 下一 = { ...去掉键(服装预设列表, 旧名), [新名]: 服装预设列表[旧名] };
            onPatch({ 通用服装列表: 下一, 当前通用服装列表: 新名 });
          }}
          on删除={(名称) => {
            const 下一 = 去掉键(服装预设列表, 名称);
            const 剩 = Object.keys(下一);
            onPatch({
              通用服装列表: 剩.length > 0 ? 下一 : { [默认通用服装列表名]: { 服装: [] } },
              当前通用服装列表: 剩[0] ?? 默认通用服装列表名,
            });
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="kaituo-input min-w-[200px] flex-1 px-2 py-1.5 text-xs"
            value={待添加服装}
            onChange={(事件) => set待添加服装(事件.target.value)}
          >
            <option value="">（选择要加入的服装）</option>
            {全部可用服装
              .filter((服装) => !当前服装列表.服装.includes(服装.id))
              .map((服装) => (
                <option key={服装.id} value={服装.id}>{服装.name}</option>
              ))}
          </select>
          <次级按钮
            disabled={!待添加服装}
            onClick={() => {
              onPatch({
                通用服装列表: {
                  ...服装预设列表,
                  [设置.当前通用服装列表]: { 服装: [...当前服装列表.服装, 待添加服装] },
                },
              });
              set待添加服装('');
              set提示({ kind: 'ok', text: '已加入通用服装列表。' });
            }}
          >
            加入
          </次级按钮>
        </div>
        {当前服装列表.服装.length === 0 ? (
          <提示条 kind="info" text="还没有通用服装。服装来自各角色卡内的「服装」段。" />
        ) : (
          <div className="space-y-1">
            {当前服装列表.服装.map((id) => {
              const 服装 = 全部可用服装.find((项) => 项.id === id);
              return (
                <div key={id} className="flex items-center gap-2 px-2 py-1"
                  style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}>
                  <span className="min-w-0 flex-1 truncate text-xs">{服装?.name ?? `${id}（不存在）`}</span>
                  <次级按钮
                    onClick={() => onPatch({
                      通用服装列表: {
                        ...服装预设列表,
                        [设置.当前通用服装列表]: { 服装: 当前服装列表.服装.filter((项) => 项 !== id) },
                      },
                    })}
                  >
                    移除
                  </次级按钮>
                </div>
              );
            })}
          </div>
        )}
        <字段 label="渲染结果：{{通用服装启用列表}}">
          <div className="kaituo-input max-h-40 overflow-auto px-2 py-1.5 text-[11px] font-mono leading-relaxed">
            {服装渲染预览 || '（空）'}
          </div>
        </字段>
      </面板>

      {提示 ? <提示条 kind={提示.kind} text={提示.text} /> : null}
    </div>
  );
}
