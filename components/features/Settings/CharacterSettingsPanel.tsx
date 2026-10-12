import { useMemo, useState } from 'react';
import type { 文生图系统设置 } from '@/models/genSystem';
import { 面板, 提示条, 次级按钮, 设置字段 as 字段 } from '@/components/features/Settings/settingsPrimitives';
import {
  CharacterSettingsEditor,
  建角色卡,
  角色摘要,
} from './CharacterSettingsEditor';
import { 归一化名称 } from '@/services/ai/imageGen/characterPrompt';

/**
 * 角色管理。
 *
 * 数据形状对齐上游：角色卡放进 `角色卡` 映射（本应用用自身 id 作键），
 * 「启用列表」单独维护——它决定 `$…$` 匹配的优先层与 `{{角色启用列表}}` 的可见范围。
 */
export function CharacterSettingsPanel({
  settings,
  onPatch,
  待追加,
  追加序号,
  on追加目标变更,
}: {
  settings: 文生图系统设置;
  onPatch: (部分: Partial<文生图系统设置>) => void;
  /** 由词库面板追加过来的标签串；`追加序号` 每来一次新串就自增一次。 */
  待追加?: string;
  追加序号?: number;
  on追加目标变更?: (字段标签: string) => void;
}) {
  const [选中Id, set选中Id] = useState<string>('');
  const [搜索, set搜索] = useState('');
  const [提示, set提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);

  const 角色列表 = useMemo(() => Object.values(settings.角色卡), [settings.角色卡]);
  const 过滤后 = useMemo(() => {
    const 关键词 = 搜索.trim().toLowerCase();
    if (!关键词) return 角色列表;
    return 角色列表.filter((角色) => (
      `${角色.nameCN} ${角色.nameEN} ${角色.characterTraits}`.toLowerCase().includes(关键词)
    ));
  }, [角色列表, 搜索]);

  const 当前 = 选中Id ? settings.角色卡[选中Id] : undefined;

  const 写入角色 = (角色: import('@/models/genSystem').角色卡) => {
    onPatch({ 角色卡: { ...settings.角色卡, [角色.id]: 角色 } });
  };

  const 新建 = () => {
    const 角色 = 建角色卡(`新角色 ${角色列表.length + 1}`);
    onPatch({
      角色卡: { ...settings.角色卡, [角色.id]: 角色 },
      角色启用列表: [...settings.角色启用列表, 角色.id],
    });
    set选中Id(角色.id);
    set提示({ kind: 'ok', text: `已新建「${角色.nameCN}」。填写部位字段后可在提示词里用 $${角色.nameCN}-sfw-upperbody$ 触发。` });
  };

  const 复制 = (角色: import('@/models/genSystem').角色卡) => {
    const 副本 = { ...角色, id: 建角色卡('').id, nameCN: `${角色.nameCN} 副本`, createdAt: Date.now(), updatedAt: Date.now() };
    onPatch({ 角色卡: { ...settings.角色卡, [副本.id]: 副本 } });
    set选中Id(副本.id);
    set提示({ kind: 'ok', text: `已复制为「${副本.nameCN}」。` });
  };

  const 删除 = (角色: import('@/models/genSystem').角色卡) => {
    const 剩余 = { ...settings.角色卡 };
    delete 剩余[角色.id];
    onPatch({
      角色卡: 剩余,
      角色启用列表: settings.角色启用列表.filter((项) => 项 !== 角色.id),
    });
    if (选中Id === 角色.id) set选中Id('');
    set提示({ kind: 'info', text: `已删除「${角色.nameCN}」。` });
  };

  const 切换启用 = (角色Id: string) => {
    const 已启用 = settings.角色启用列表.includes(角色Id);
    onPatch({
      角色启用列表: 已启用
        ? settings.角色启用列表.filter((项) => 项 !== 角色Id)
        : [...settings.角色启用列表, 角色Id],
    });
  };

  const 导出全部 = () => {
    const 数据 = JSON.stringify({ 角色卡: settings.角色卡, 角色启用列表: settings.角色启用列表 }, null, 2);
    const 地址 = URL.createObjectURL(new Blob([数据], { type: 'application/json' }));
    const 链接 = document.createElement('a');
    链接.href = 地址;
    链接.download = `kaituoyishi-characters-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    链接.click();
    URL.revokeObjectURL(地址);
    set提示({ kind: 'ok', text: `已导出 ${角色列表.length} 张角色卡。` });
  };

  const 导入 = () => {
    const 输入 = document.createElement('input');
    输入.type = 'file';
    输入.accept = 'application/json,.json';
    输入.onchange = async () => {
      const 文件 = 输入.files?.[0];
      if (!文件) return;
      try {
        const 解析后 = JSON.parse(await 文件.text()) as {
          角色卡?: Record<string, import('@/models/genSystem').角色卡>;
          角色启用列表?: string[];
        };
        const 新卡 = 解析后.角色卡 ?? {};
        if (Object.keys(新卡).length === 0) throw new Error('文件里没有角色卡。');
        // 合并而非覆盖：导入社区角色包不该把已有角色冲掉。
        const 合并后 = { ...settings.角色卡, ...新卡 };
        const 启用 = Array.from(new Set([...settings.角色启用列表, ...(解析后.角色启用列表 ?? [])]));
        onPatch({ 角色卡: 合并后, 角色启用列表: 启用 });
        set提示({ kind: 'ok', text: `已并入 ${Object.keys(新卡).length} 张角色卡（同名 id 会被覆盖）。` });
      } catch (错误) {
        set提示({ kind: 'error', text: `导入失败：${错误 instanceof Error ? 错误.message : String(错误)}` });
      }
    };
    输入.click();
  };

  return (
    <div className="space-y-4">
      <面板
        title="角色管理"
        desc="角色卡决定 `$…$` 触发时注入哪些外貌字段。启用列表是匹配的第一优先层；未列出的角色仍能在全部角色里被匹配到。"
      >
        <div className="flex flex-wrap gap-2">
          <次级按钮 onClick={新建}>新建</次级按钮>
          <次级按钮 onClick={导出全部} disabled={角色列表.length === 0}>导出全部</次级按钮>
          <次级按钮 onClick={导入}>导入</次级按钮>
        </div>
        <字段 label="搜索" hint="匹配中英文名与角色特征。别名用 | 分隔写在名字字段里。">
          <input
            className="kaituo-input w-full px-3 py-2 text-sm"
            value={搜索}
            onChange={(事件) => set搜索(事件.target.value)}
            placeholder="流萤 / Firefly"
          />
        </字段>
        {提示 ? <提示条 kind={提示.kind} text={提示.text} /> : null}
      </面板>

      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <面板 title={`角色列表（${过滤后.length}）`}>
          {过滤后.length === 0 ? (
            <提示条 kind="info" text={角色列表.length === 0 ? '还没有角色卡。点「新建」开始。' : '没有匹配的角色。'} />
          ) : (
            <div className="space-y-1">
              {过滤后.map((角色) => {
                const 已启用 = settings.角色启用列表.includes(角色.id);
                return (
                  <div key={角色.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => set选中Id(角色.id)}
                      className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs transition-all hover:opacity-85"
                      style={{
                        color: 选中Id === 角色.id ? 'rgb(var(--tj-ui-active-text))' : 'rgba(var(--tj-text-primary), 0.86)',
                        background: 选中Id === 角色.id
                          ? 'linear-gradient(135deg, rgba(var(--tj-btn-primary-start),0.95), rgba(var(--tj-btn-primary-end),0.82))'
                          : 'rgba(var(--tj-ui-panel-strong), 0.42)',
                        border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
                      }}
                    >
                      {角色摘要(角色)}
                    </button>
                    <button
                      type="button"
                      title={已启用 ? '从启用列表移除' : '加入启用列表'}
                      onClick={() => 切换启用(角色.id)}
                      className="shrink-0 px-1.5 py-1 text-[11px] transition-all hover:opacity-85"
                      style={{
                        color: 已启用 ? 'rgb(var(--tj-ui-success))' : 'rgba(var(--tj-text-secondary), 0.7)',
                        border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
                      }}
                    >
                      {已启用 ? '启用' : '停用'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </面板>

        {当前 ? (
          <CharacterSettingsEditor
            角色={当前}
            onChange={写入角色}
            onDelete={() => 删除(当前)}
            onDuplicate={() => 复制(当前)}
            待追加={待追加}
            追加序号={追加序号}
            on插入目标变更={on追加目标变更}
            参考模式={settings.novelai.参考模式}
            on参考模式变更={(下一模式) => onPatch({ novelai: { ...settings.novelai, 参考模式: 下一模式 } })}
            NovelAI模型={settings.novelai.模型}
          />
        ) : (
          <面板 title="角色详情">
            <提示条
              kind="info"
              text={
                角色列表.length === 0
                  ? '左侧还没有角色。点「新建」创建第一张角色卡。'
                  : '从左侧选一张角色卡来编辑它的 14 个部位字段、服装与生成设置。'
              }
            />
            <div className="text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.68)' }}>
              提示词里的写法：<code>$名字-sfw-upperbody-sfw-lowerbody$</code>、
              <code className="ml-1">$名字-nsfw-upperbody$</code>、
              <code className="ml-1">$名字-sfw-upperbody$</code>。
              也可以用 JSON 形式 <code>{'{"name":"名字","angle":"from behind","upperBody":"sfw"}'}</code>。
              未识别的名字会原样保留，便于发现写错。
            </div>
            {角色列表.length > 0 ? (
              <div className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.6)' }}>
                举例：当前已有 {角色列表.length} 张卡，
                {角色列表.slice(0, 3).map((角色) => 归一化名称(角色.nameCN)).filter(Boolean).join('、')}
              </div>
            ) : null}
          </面板>
        )}
      </div>

      {角色列表.length > 0 ? (
        <面板 title="快捷验证">
          <div className="text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>
            到「视觉资产 → 手动出图」，提示词填 <code>$名字-sfw-upperbody-sfw-lowerbody$</code>，
            若角色匹配成功，注入的字段会出现在生成参数里的正向提示词中。
          </div>
        </面板>
      ) : null}
    </div>
  );
}
