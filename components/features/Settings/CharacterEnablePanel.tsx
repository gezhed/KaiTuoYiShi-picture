import { useMemo, useState } from 'react';
import type { 角色启用条目, 角色启用预设, 文生图系统设置 } from '@/models/genSystem';
import { 镜像启用列表 } from '@/models/genSystem';
import {
  面板,
  提示条,
  次级按钮,
  设置字段 as 字段,
} from '@/components/features/Settings/settingsPrimitives';
import { 角色预设条 } from './characterPresetBar';
import { 生成注入预览 } from '@/services/ai/imageGen/characterInjection';
import { 去掉键 } from './settingsShared';

/**
 * 角色启用管理。
 *
 * 上游把「哪几个角色参与本轮出图」做成了一份带绑定的清单
 * （`characterEnablePresets`，`character.html` L407-L542）：
 * 每个条目除了角色本身，还能各自覆盖一张角色图片与一段音频（注入 `{{角色启用列表}}` 时用），
 * 并记录「绑定角色卡 / 绑定聊天记录」两项标记。
 *
 * 本面板只做管理，真正被引擎读取的是镜像出来的 `角色启用列表`（见 `镜像启用列表`）。
 */
export function CharacterEnablePanel({
  设置,
  onPatch,
}: {
  设置: 文生图系统设置;
  onPatch: (部分: Partial<文生图系统设置>) => void;
}) {
  const [提示, set提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const [测试文本, set测试文本] = useState('');
  const [待添加, set待添加] = useState('');

  const 预设名列表 = Object.keys(设置.角色启用预设列表);
  const 预设: 角色启用预设 = 设置.角色启用预设列表[设置.当前启用预设]
    ?? { 条目: [], 绑定角色卡: '', 绑定聊天: '' };
  const 条目 = 预设.条目;

  const 写入 = (下一: 角色启用预设) => {
    onPatch({
      角色启用预设列表: { ...设置.角色启用预设列表, [设置.当前启用预设]: 下一 },
      // 扁平视图是引擎真正读的那一份，任何编辑都要同步。
      角色启用列表: 镜像启用列表(下一),
    });
  };

  const 切换预设 = (名称: string) => {
    onPatch({
      当前启用预设: 名称,
      角色启用列表: 镜像启用列表(设置.角色启用预设列表[名称]),
    });
  };

  const 写入条目 = (下一: 角色启用条目[]) => 写入({ ...预设, 条目: 下一 });

  const 未启用角色 = useMemo(
    () => Object.values(设置.角色卡).filter((角色) => !条目.some((项) => 项.角色Id === 角色.id)),
    [设置.角色卡, 条目],
  );

  const 预览 = useMemo(
    () => (测试文本.trim() ? 生成注入预览(设置, 测试文本) : null),
    [设置, 测试文本],
  );

  const 角色显示名 = (角色Id: string) => {
    const 角色 = 设置.角色卡[角色Id];
    if (!角色) return `${角色Id}（角色卡已不存在）`;
    return [角色.nameCN, 角色.nameEN].filter(Boolean).join(' / ') || 角色.id;
  };

  const 补丁条目 = (角色Id: string, 部分: Partial<角色启用条目>) => {
    写入条目(条目.map((项) => (项.角色Id === 角色Id ? { ...项, ...部分 } : 项)));
  };

  const 移动条目 = (序号: number, 方向: -1 | 1) => {
    const 目标 = 序号 + 方向;
    if (目标 < 0 || 目标 >= 条目.length) return;
    const 下一 = [...条目];
    [下一[序号], 下一[目标]] = [下一[目标], 下一[序号]];
    写入条目(下一);
  };

  return (
    <div className="space-y-4">
      <面板
        title="启用列表"
        desc="只有在启用列表里的角色才会被 {{角色启用列表}} 注入；$…$ 触发器不受它限制（会回退到全部角色）。每个条目可以单独绑定图片与音频，留空则用角色卡上选中的那一张。"
      >
        <角色预设条
          名称列表={预设名列表}
          当前={设置.当前启用预设}
          新建默认名="启用列表"
          on切换={切换预设}
          on新建={(名称) => {
            onPatch({
              角色启用预设列表: { ...设置.角色启用预设列表, [名称]: { 条目: [], 绑定角色卡: '', 绑定聊天: '' } },
              当前启用预设: 名称,
              角色启用列表: [],
            });
            set提示({ kind: 'ok', text: `已新建启用列表「${名称}」。` });
          }}
          on另存为={(名称) => {
            onPatch({
              角色启用预设列表: { ...设置.角色启用预设列表, [名称]: { ...预设, 条目: 条目.map((项) => ({ ...项 })) } },
              当前启用预设: 名称,
            });
            set提示({ kind: 'ok', text: `已另存为「${名称}」。` });
          }}
          on重命名={(旧名, 新名) => {
            const 下一 = { ...去掉键(设置.角色启用预设列表, 旧名), [新名]: 设置.角色启用预设列表[旧名] };
            onPatch({ 角色启用预设列表: 下一, 当前启用预设: 新名 });
            set提示({ kind: 'ok', text: `已重命名为「${新名}」。` });
          }}
          on删除={(名称) => {
            const 下一 = 去掉键(设置.角色启用预设列表, 名称);
            const 新当前 = Object.keys(下一)[0];
            onPatch({
              角色启用预设列表: 下一,
              当前启用预设: 新当前,
              角色启用列表: 镜像启用列表(下一[新当前]),
            });
            set提示({ kind: 'info', text: `已删除「${名称}」。` });
          }}
        />

        <div className="grid gap-2 md:grid-cols-2">
          <字段 label="绑定角色卡" hint="仅作标记：切换聊天时用它提示「这份清单是为哪张卡准备的」。">
            <input
              className="kaituo-input w-full px-2 py-1.5 text-xs"
              value={预设.绑定角色卡}
              onChange={(事件) => 写入({ ...预设, 绑定角色卡: 事件.target.value })}
              placeholder="例如 流萤"
            />
          </字段>
          <字段 label="绑定聊天记录" hint="上游用聊天 id 做自动套用；本应用暂无自动套用，仅记录。">
            <input
              className="kaituo-input w-full px-2 py-1.5 text-xs"
              value={预设.绑定聊天}
              onChange={(事件) => 写入({ ...预设, 绑定聊天: 事件.target.value })}
              placeholder="聊天记录 ID"
            />
          </字段>
        </div>

        {提示 ? <提示条 kind={提示.kind} text={提示.text} /> : null}
      </面板>

      <面板 title={`启用中的角色（${条目.length}）`} desc="顺序即注入顺序，可以上下调整。">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="kaituo-input min-w-[200px] flex-1 px-2 py-1.5 text-xs"
            value={待添加}
            onChange={(事件) => set待添加(事件.target.value)}
          >
            <option value="">（选择要加入的角色）</option>
            {未启用角色.map((角色) => (
              <option key={角色.id} value={角色.id}>{角色显示名(角色.id)}</option>
            ))}
          </select>
          <次级按钮
            disabled={!待添加}
            onClick={() => {
              写入条目([...条目, { 角色Id: 待添加, 图片媒体Id: '', 音频媒体Id: '', 图片描述: '', 音频描述: '' }]);
              set待添加('');
            }}
          >
            加入
          </次级按钮>
          <次级按钮
            disabled={Object.keys(设置.角色卡).length === 0}
            onClick={() => {
              const 已有 = new Set(条目.map((项) => 项.角色Id));
              const 新增 = Object.keys(设置.角色卡)
                .filter((id) => !已有.has(id))
                .map((id) => ({ 角色Id: id, 图片媒体Id: '', 音频媒体Id: '', 图片描述: '', 音频描述: '' }));
              if (新增.length === 0) {
                set提示({ kind: 'info', text: '全部角色都已经在启用列表里了。' });
                return;
              }
              写入条目([...条目, ...新增]);
              set提示({ kind: 'ok', text: `已加入 ${新增.length} 个角色。` });
            }}
          >
            全部加入
          </次级按钮>
        </div>

        {条目.length === 0 ? (
          <提示条
            kind="info"
            text="启用列表是空的。{{角色启用列表}} 会渲染成「（暂无启用的角色）」，$…$ 触发仍可用。"
          />
        ) : (
          <div className="space-y-2">
            {条目.map((项, 序号) => {
              const 角色 = 设置.角色卡[项.角色Id];
              const 图片 = 角色?.photoMedia ?? [];
              const 音频 = 角色?.audioMedia ?? [];
              return (
                <div
                  key={项.角色Id}
                  className="space-y-2 px-2 py-2"
                  style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-serif" style={{ color: 'rgba(var(--tj-text-primary), 0.9)' }}>
                      {序号 + 1}. {角色显示名(项.角色Id)}
                    </span>
                    <次级按钮 disabled={序号 === 0} onClick={() => 移动条目(序号, -1)}>↑</次级按钮>
                    <次级按钮 disabled={序号 === 条目.length - 1} onClick={() => 移动条目(序号, 1)}>↓</次级按钮>
                    <次级按钮 onClick={() => 写入条目(条目.filter((其他) => 其他.角色Id !== 项.角色Id))}>移除</次级按钮>
                  </div>
                  {!角色 ? (
                    <提示条 kind="error" text="这张角色卡已经被删除，条目不会参与注入。移除它即可清理。" />
                  ) : (
                    <div className="grid gap-2 md:grid-cols-2">
                      <字段 label="绑定图片" hint="留空＝用角色卡上选中的照片。">
                        <select
                          className="kaituo-input w-full px-2 py-1.5 text-xs"
                          value={项.图片媒体Id}
                          onChange={(事件) => 补丁条目(项.角色Id, { 图片媒体Id: 事件.target.value })}
                        >
                          <option value="">（用角色卡的选择）</option>
                          {图片.map((媒体) => (
                            <option key={媒体.id} value={媒体.id}>{媒体.name}</option>
                          ))}
                        </select>
                      </字段>
                      <字段 label="图片描述">
                        <input
                          className="kaituo-input w-full px-2 py-1.5 text-xs"
                          value={项.图片描述}
                          onChange={(事件) => 补丁条目(项.角色Id, { 图片描述: 事件.target.value })}
                          placeholder={图片.find((媒体) => 媒体.id === (项.图片媒体Id || 角色.selectedPhotoId))?.name ?? ''}
                        />
                      </字段>
                      <字段 label="绑定音频">
                        <select
                          className="kaituo-input w-full px-2 py-1.5 text-xs"
                          value={项.音频媒体Id}
                          onChange={(事件) => 补丁条目(项.角色Id, { 音频媒体Id: 事件.target.value })}
                        >
                          <option value="">（用角色卡的选择）</option>
                          {音频.map((媒体) => (
                            <option key={媒体.id} value={媒体.id}>{媒体.name}</option>
                          ))}
                        </select>
                      </字段>
                      <字段 label="音频描述">
                        <input
                          className="kaituo-input w-full px-2 py-1.5 text-xs"
                          value={项.音频描述}
                          onChange={(事件) => 补丁条目(项.角色Id, { 音频描述: 事件.target.value })}
                        />
                      </字段>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </面板>

      <面板
        title="触发测试"
        desc="纯子串判定，不发请求：把一段文本贴进来，看哪些启用角色会被 {{角色启用列表}} 命中。"
      >
        <字段 label="测试文本" hint="例如正文里出现「流萤抬起头」这一段，就写「流萤抬起头」。">
          <textarea
            className="kaituo-input h-20 w-full px-2 py-1.5 text-xs leading-relaxed"
            value={测试文本}
            spellCheck={false}
            placeholder="贴一段正文，例如：流萤抬起头，银发在舷窗的冷光里一晃。"
            onChange={(事件) => set测试文本(事件.target.value)}
          />
        </字段>
        {预览 ? (
          <>
            <提示条
              kind={预览.命中.length > 0 ? 'ok' : 'info'}
              text={预览.命中.length > 0
                ? `命中 ${预览.命中.length} 个角色：${预览.命中.map((项) => `${角色显示名(项.角色Id)}（${项.别名}）`).join('、')}`
                : '没有命中任何启用角色。'}
            />
            <字段 label="渲染结果：{{角色启用列表}}">
              <div className="kaituo-input max-h-48 overflow-auto px-2 py-1.5 text-[11px] font-mono leading-relaxed">
                {预览.角色列表 || '（空）'}
              </div>
            </字段>
          </>
        ) : null}
      </面板>
    </div>
  );
}
