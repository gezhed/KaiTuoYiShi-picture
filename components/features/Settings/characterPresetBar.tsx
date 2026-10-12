import { useState } from 'react';
import { 次级按钮 } from '@/components/features/Settings/settingsPrimitives';

/**
 * 预设选择条：选择 / 新建 / 另存为 / 重命名 / 删除。
 *
 * 上游每个角色相关页签都有同一套「预设操作收纳盒」（`character.html` L22-L56），
 * 这里抽成一个小部件，四类预设（启用列表 / 通用角色 / 通用服装 / 注入模板）共用。
 * 与上游的差异：上游用 `stylishConfirm` 弹窗做重命名，这里改成行内输入，
 * 少一层弹窗，也便于自动化测试。
 */
export function 角色预设条({
  名称列表,
  当前,
  只读名单,
  新建默认名,
  on切换,
  on新建,
  on另存为,
  on重命名,
  on删除,
}: {
  名称列表: string[];
  当前: string;
  只读名单?: string[];
  /** 新建时的默认名（重名时自动加序号）。 */
  新建默认名: string;
  on切换: (名称: string) => void;
  on新建?: (名称: string) => void;
  on另存为?: (新名称: string) => void;
  on重命名?: (旧名: string, 新名: string) => void;
  on删除?: (名称: string) => void;
}) {
  const [编辑中, set编辑中] = useState(false);
  const [草稿, set草稿] = useState('');
  const 只读 = 只读名单 ?? [];
  const 当前只读 = 只读.includes(当前);

  const 唯名 = (基础: string): string => {
    let 名称 = 基础;
    let 序号 = 2;
    while (名称列表.includes(名称)) {
      名称 = `${基础} ${序号}`;
      序号 += 1;
    }
    return 名称;
  };

  const 开始重命名 = () => {
    set草稿(当前);
    set编辑中(true);
  };

  const 确认重命名 = () => {
    const 新名 = 草稿.trim();
    set编辑中(false);
    if (!新名 || 新名 === 当前) return;
    on重命名?.(当前, 名称列表.includes(新名) ? 唯名(新名) : 新名);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-serif text-[11px] tracking-[0.2em]" style={{ color: 'rgba(var(--tj-text-secondary), 0.8)' }}>
          预设
        </span>
        {编辑中 ? (
          <>
            <input
              className="kaituo-input min-w-[160px] flex-1 px-2 py-1.5 text-xs"
              value={草稿}
              autoFocus
              onChange={(事件) => set草稿(事件.target.value)}
              onKeyDown={(事件) => {
                if (事件.key === 'Enter') 确认重命名();
                if (事件.key === 'Escape') set编辑中(false);
              }}
            />
            <次级按钮 onClick={确认重命名}>确认</次级按钮>
            <次级按钮 onClick={() => set编辑中(false)}>取消</次级按钮>
          </>
        ) : (
          <select
            className="kaituo-input min-w-[160px] flex-1 px-2 py-1.5 text-xs"
            value={当前}
            onChange={(事件) => on切换(事件.target.value)}
          >
            {名称列表.map((名称) => (
              <option key={名称} value={名称}>{名称}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {on新建 ? (
          <次级按钮 onClick={() => {
            const 名称 = 唯名(新建默认名);
            on新建(名称);
          }}>新建</次级按钮>
        ) : null}
        {on另存为 ? (
          <次级按钮 onClick={() => {
            const 名称 = 唯名(`${当前} 副本`);
            on另存为(名称);
          }}>另存为</次级按钮>
        ) : null}
        {on重命名 ? (
          <次级按钮 disabled={编辑中 || 当前只读} onClick={开始重命名}>重命名</次级按钮>
        ) : null}
        {on删除 ? (
          <次级按钮
            disabled={名称列表.length <= 1 || 当前只读}
            onClick={() => on删除(当前)}
          >
            删除
          </次级按钮>
        ) : null}
        {当前只读 ? (
          <span className="self-center text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.62)' }}>
            内置预设不可改名或删除；要改就先「另存为」。
          </span>
        ) : null}
      </div>
    </div>
  );
}
