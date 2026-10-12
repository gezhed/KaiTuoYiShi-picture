import { useMemo, useState } from 'react';
import type { 角色卡, 文生图系统设置 } from '@/models/genSystem';
import type { API配置项 } from '@/models/settings';
import type { ConnectionTestConfig } from '@/hooks/useAiTools';
import { 镜像启用列表 } from '@/models/genSystem';
import {
  面板,
  提示条,
  次级按钮,
  页签条,
  设置字段 as 字段,
} from '@/components/features/Settings/settingsPrimitives';
import {
  CharacterSettingsEditor,
  建角色卡,
  角色摘要,
} from './CharacterSettingsEditor';
import { CharacterEnablePanel } from './CharacterEnablePanel';
import { CharacterCommonListsPanel } from './CharacterCommonListsPanel';
import { CharacterInjectionTemplatePanel } from './CharacterInjectionTemplatePanel';
import { CharacterAIPanel } from './CharacterAIPanel';
import { 归一化名称 } from '@/services/ai/imageGen/characterPrompt';
import { 导出角色包, 导入角色包 } from '@/services/ai/imageGen/characterTransfer';
import type { 生成角色特征结果 } from '@/services/ai/imageGen/characterFeature';
import { 去掉键 } from './settingsShared';

type 角色页签 = 'cards' | 'enable' | 'common' | 'template' | 'ai';

const 页签: Array<{ id: 角色页签; label: string; desc: string }> = [
  { id: 'cards', label: '角色卡', desc: '14 个部位字段与媒体' },
  { id: 'enable', label: '启用列表', desc: '参与注入的角色' },
  { id: 'common', label: '通用列表', desc: '通用角色 / 服装' },
  { id: 'template', label: '注入模板', desc: '{变量} 与格式' },
  { id: 'ai', label: '生成', desc: '一键生成角色特征' },
];

/**
 * 角色管理。
 *
 * 数据形状对齐上游：角色卡放进 `角色卡` 映射（本应用用自身 id 作键），
 * 「启用列表」是它自己的一类预设，`角色启用列表` 是它镜像出来的扁平视图，
 * 决定 `$…$` 匹配的优先层与 `{{角色启用列表}}` 的可见范围。
 *
 * 与上游的差异（移植取舍，见 `services/ai/imageGen/characterTransfer.ts` 的修改声明）：
 * - 上游角色/服装以**名字**为键，本应用以 **id** 为键，所以没有「重命名预设」这一步；
 *   改名字就是改 `nameCN`，引用关系按 id 走，不会断。
 * - 上游每个页签都带一整套预设导入导出；本应用只在角色卡页做**角色包**导入导出
 *   （含图片音频，兼容上游 `.json`），列表/模板类预设随包与设置一起走。
 */
export function CharacterSettingsPanel({
  settings,
  onPatch,
  待追加,
  追加序号,
  on追加目标变更,
  未保存,
  请求生成,
  角色AI候选配置,
  主API模型,
  主API地址,
  onFetchModels,
}: {
  settings: 文生图系统设置;
  onPatch: (部分: Partial<文生图系统设置>) => void;
  /** 由词库面板追加过来的标签串；`追加序号` 每来一次新串就自增一次。 */
  待追加?: string;
  追加序号?: number;
  on追加目标变更?: (字段标签: string) => void;
  /** 有改动还没保存到本机时给个提醒（对齐上游的未保存提示）。 */
  未保存?: boolean;
  /** 一键生成角色特征的模型调用；未接时生成面板会禁用按钮。 */
  请求生成?: (参数: {
    系统: 文生图系统设置;
    要求: string;
    角色?: 角色卡;
    signal?: AbortSignal;
  }) => Promise<生成角色特征结果>;
  /** 角色 AI 覆盖合并主 API 后的实际配置，供「测试连接并读取模型列表」使用。 */
  角色AI候选配置?: API配置项 | null;
  主API模型?: string;
  主API地址?: string;
  onFetchModels?: (config: ConnectionTestConfig) => Promise<string[]>;
}) {
  const [页, set页] = useState<角色页签>('cards');
  const [选中Id, set选中Id] = useState<string>('');
  const [搜索, set搜索] = useState('');
  const [提示, set提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const [批量, set批量] = useState(false);
  const [批量选中, set批量选中] = useState<Set<string>>(new Set());
  const [导出含媒体, set导出含媒体] = useState(true);
  const [导出混淆, set导出混淆] = useState(true);
  const [导入中, set导入中] = useState(false);

  const 角色列表 = useMemo(() => Object.values(settings.角色卡), [settings.角色卡]);
  const 过滤后 = useMemo(() => {
    const 关键词 = 搜索.trim().toLowerCase();
    if (!关键词) return 角色列表;
    return 角色列表.filter((角色) => (
      `${角色.nameCN} ${角色.nameEN} ${角色.characterTraits} ${角色.aliases.join(' ')}`.toLowerCase().includes(关键词)
    ));
  }, [角色列表, 搜索]);

  const 当前 = 选中Id ? settings.角色卡[选中Id] : undefined;

  const 写入角色 = (角色: 角色卡) => {
    onPatch({ 角色卡: { ...settings.角色卡, [角色.id]: 角色 } });
  };

  const 新建 = () => {
    const 角色 = 建角色卡(`新角色 ${角色列表.length + 1}`);
    const 预设 = settings.角色启用预设列表[settings.当前启用预设];
    const 条目 = [...(预设?.条目 ?? []), {
      角色Id: 角色.id, 图片媒体Id: '', 音频媒体Id: '', 图片描述: '', 音频描述: '',
    }];
    onPatch({
      角色卡: { ...settings.角色卡, [角色.id]: 角色 },
      角色启用预设列表: {
        ...settings.角色启用预设列表,
        [settings.当前启用预设]: { ...(预设 ?? { 绑定角色卡: '', 绑定聊天: '' }), 条目 },
      },
      角色启用列表: 镜像启用列表({ 条目, 绑定角色卡: '', 绑定聊天: '' }),
    });
    set选中Id(角色.id);
    set页('cards');
    set提示({ kind: 'ok', text: `已新建「${角色.nameCN}」。填写部位字段后可在提示词里用 $${角色.nameCN}-sfw-upperbody$ 触发。` });
  };

  /**
   * 一键生成页的「新建角色卡」：把生成好的卡入表，**并挂进当前启用列表**。
   *
   * 只入表是不够的：启用列表是提示词里能否看到这张卡的独立闸门，
   * 少这一步用户会得到一张「生成了但正文生图永远用不上」的卡。
   */
  const 新建并启用 = (角色: 角色卡) => {
    const 预设 = settings.角色启用预设列表[settings.当前启用预设];
    const 条目 = [...(预设?.条目 ?? []), {
      角色Id: 角色.id, 图片媒体Id: '', 音频媒体Id: '', 图片描述: '', 音频描述: '',
    }];
    onPatch({
      角色卡: { ...settings.角色卡, [角色.id]: 角色 },
      角色启用预设列表: {
        ...settings.角色启用预设列表,
        [settings.当前启用预设]: { ...(预设 ?? { 绑定角色卡: '', 绑定聊天: '' }), 条目 },
      },
      角色启用列表: 镜像启用列表({ 条目, 绑定角色卡: '', 绑定聊天: '' }),
    });
    set选中Id(角色.id);
    set提示({ kind: 'ok', text: `已新建并启用「${角色.nameCN}」。` });
  };

  const 复制 = (角色: 角色卡) => {
    const 副本: 角色卡 = {
      ...角色,
      id: 建角色卡('').id,
      nameCN: `${角色.nameCN} 副本`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    onPatch({ 角色卡: { ...settings.角色卡, [副本.id]: 副本 } });
    set选中Id(副本.id);
    set提示({ kind: 'ok', text: `已复制为「${副本.nameCN}」。` });
  };

  const 删除 = (角色: 角色卡) => {
    const 剩余 = 去掉键(settings.角色卡, 角色.id);
    // 启用列表里指向它的条目一并摘掉，避免留下空引用。
    const 预设列表: typeof settings.角色启用预设列表 = {};
    for (const [名称, 预设] of Object.entries(settings.角色启用预设列表)) {
      预设列表[名称] = { ...预设, 条目: 预设.条目.filter((项) => 项.角色Id !== 角色.id) };
    }
    onPatch({
      角色卡: 剩余,
      角色启用预设列表: 预设列表,
      角色启用列表: 镜像启用列表(预设列表[settings.当前启用预设]),
      通用角色列表: Object.fromEntries(
        Object.entries(settings.通用角色列表).map(([名, 预设]) => [名, { 角色: 预设.角色.filter((项) => 项 !== 角色.id) }]),
      ),
    });
    if (选中Id === 角色.id) set选中Id('');
    set提示({ kind: 'info', text: `已删除「${角色.nameCN}」。` });
  };

  const 批量删除 = () => {
    if (批量选中.size === 0) return;
    let 剩余 = settings.角色卡;
    for (const id of 批量选中) 剩余 = 去掉键(剩余, id);
    const 预设列表: typeof settings.角色启用预设列表 = {};
    for (const [名称, 预设] of Object.entries(settings.角色启用预设列表)) {
      预设列表[名称] = { ...预设, 条目: 预设.条目.filter((项) => !批量选中.has(项.角色Id)) };
    }
    onPatch({
      角色卡: 剩余,
      角色启用预设列表: 预设列表,
      角色启用列表: 镜像启用列表(预设列表[settings.当前启用预设]),
    });
    set提示({ kind: 'info', text: `已删除 ${批量选中.size} 张角色卡。` });
    set批量选中(new Set());
    if (选中Id && !剩余[选中Id]) set选中Id('');
  };

  const 切换启用 = (角色Id: string) => {
    const 预设 = settings.角色启用预设列表[settings.当前启用预设];
    const 条目 = 预设?.条目 ?? [];
    const 已启用 = 条目.some((项) => 项.角色Id === 角色Id);
    const 下一条目 = 已启用
      ? 条目.filter((项) => 项.角色Id !== 角色Id)
      : [...条目, { 角色Id, 图片媒体Id: '', 音频媒体Id: '', 图片描述: '', 音频描述: '' }];
    onPatch({
      角色启用预设列表: {
        ...settings.角色启用预设列表,
        [settings.当前启用预设]: { ...(预设 ?? { 绑定角色卡: '', 绑定聊天: '' }), 条目: 下一条目 },
      },
      角色启用列表: 镜像启用列表({ 条目: 下一条目, 绑定角色卡: '', 绑定聊天: '' }),
    });
  };

  const 下载 = (文件名: string, 文本: string) => {
    const 地址 = URL.createObjectURL(new Blob([文本], { type: 'application/json' }));
    const 链接 = document.createElement('a');
    链接.href = 地址;
    链接.download = 文件名;
    链接.click();
    URL.revokeObjectURL(地址);
  };

  const 导出 = async (范围: 'all' | 'enabled' | 'current') => {
    const 角色 = 范围 === 'all'
      ? 角色列表
      : 范围 === 'enabled'
        ? settings.角色启用列表.map((id) => settings.角色卡[id]).filter(Boolean)
        : (当前 ? [当前] : []);
    if (角色.length === 0) {
      set提示({ kind: 'error', text: '没有可导出的角色卡。' });
      return;
    }
    try {
      const 结果 = await 导出角色包({
        角色列表: 角色,
        启用角色Id: settings.角色启用列表,
        含媒体: 导出含媒体,
        混淆: 导出混淆,
      });
      下载(`kaituoyishi-characters-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, 结果.文本);
      set提示({
        kind: 结果.警告.length > 0 ? 'info' : 'ok',
        text: [
          `已导出 ${结果.角色数} 张角色卡、${结果.服装数} 件服装、${结果.媒体数} 个媒体文件。`,
          ...结果.警告,
        ].join('\n'),
      });
    } catch (错误) {
      set提示({ kind: 'error', text: `导出失败：${错误 instanceof Error ? 错误.message : String(错误)}` });
    }
  };

  const 导入 = () => {
    const 输入 = document.createElement('input');
    输入.type = 'file';
    输入.accept = 'application/json,.json';
    输入.onchange = async () => {
      const 文件 = 输入.files?.[0];
      if (!文件) return;
      set导入中(true);
      try {
        const 结果 = await 导入角色包(await 文件.text(), { 现有角色: settings.角色卡 });
        // 随包带来的启用名单并进当前启用预设（同名去重）。
        const 预设 = settings.角色启用预设列表[settings.当前启用预设];
        const 条目 = [...(预设?.条目 ?? [])];
        for (const id of 结果.启用角色) {
          if (条目.some((项) => 项.角色Id === id)) continue;
          条目.push({ 角色Id: id, 图片媒体Id: '', 音频媒体Id: '', 图片描述: '', 音频描述: '' });
        }
        onPatch({
          角色卡: 结果.角色卡,
          角色启用预设列表: {
            ...settings.角色启用预设列表,
            [settings.当前启用预设]: { ...(预设 ?? { 绑定角色卡: '', 绑定聊天: '' }), 条目 },
          },
          角色启用列表: 镜像启用列表({ 条目, 绑定角色卡: '', 绑定聊天: '' }),
        });
        set提示({
          kind: 结果.警告.length > 0 ? 'info' : 'ok',
          text: [
            `导入完成（${结果.来源格式} 格式）：新增 ${结果.新增} 张、覆盖 ${结果.覆盖} 张、服装 ${结果.服装数} 件、媒体 ${结果.媒体数} 个。`,
            ...结果.警告,
          ].join('\n'),
        });
      } catch (错误) {
        set提示({ kind: 'error', text: `导入失败：${错误 instanceof Error ? 错误.message : String(错误)}` });
      } finally {
        set导入中(false);
      }
    };
    输入.click();
  };

  return (
    <div className="space-y-4">
      <页签条 页签={页签} 当前={页} onSelect={set页} />

      {未保存 ? (
        <提示条 kind="info" text="角色相关的改动还没保存到本机：记得用页面底部的「保存文生图设置」。" />
      ) : null}

      {页 === 'cards' ? (
        <>
          <面板
            title="角色卡"
            desc="角色卡决定 `$…$` 触发时注入哪些外貌字段。启用列表是匹配的第一优先层；未列出的角色仍能在全部角色里被匹配到。"
          >
            <div className="flex flex-wrap gap-2">
              <次级按钮 onClick={新建}>新建</次级按钮>
              <次级按钮 onClick={() => void 导出('current')} disabled={!当前}>导出当前</次级按钮>
              <次级按钮 onClick={() => void 导出('enabled')} disabled={settings.角色启用列表.length === 0}>导出启用中的</次级按钮>
              <次级按钮 onClick={() => void 导出('all')} disabled={角色列表.length === 0}>导出全部</次级按钮>
              <次级按钮 onClick={导入} disabled={导入中}>{导入中 ? '导入中…' : '导入角色包'}</次级按钮>
              <次级按钮 active={批量} onClick={() => { set批量(!批量); set批量选中(new Set()); }}>批量</次级按钮>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1 text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.8)' }}>
                <input type="checkbox" checked={导出含媒体} onChange={(事件) => set导出含媒体(事件.target.checked)} />
                导出时带上图片与音频（体积会大很多）
              </label>
              <label className="flex items-center gap-1 text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.8)' }}>
                <input type="checkbox" checked={导出混淆} onChange={(事件) => set导出混淆(事件.target.checked)} />
                混淆文本字段（base64 混淆，与上游文件互通；不是加密）
              </label>
            </div>

            {批量 ? (
              <div className="flex flex-wrap items-center gap-2">
                <次级按钮
                  onClick={() => set批量选中(new Set(过滤后.map((角色) => 角色.id)))}
                  disabled={过滤后.length === 0}
                >
                  全选当前列表
                </次级按钮>
                <次级按钮 onClick={() => set批量选中(new Set())} disabled={批量选中.size === 0}>清空选择</次级按钮>
                <次级按钮
                  disabled={批量选中.size === 0}
                  onClick={批量删除}
                >
                  删除选中的 {批量选中.size} 张
                </次级按钮>
              </div>
            ) : null}

            <字段 label="搜索" hint="匹配中英文名、别名与角色特征。别名用 | 分隔写在名字字段里。">
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
                        {批量 ? (
                          <input
                            type="checkbox"
                            checked={批量选中.has(角色.id)}
                            onChange={() => {
                              const 下一 = new Set(批量选中);
                              if (下一.has(角色.id)) 下一.delete(角色.id); else 下一.add(角色.id);
                              set批量选中(下一);
                            }}
                          />
                        ) : null}
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
                  提示词里的写法：<code>$名字-sfw-upperbody$</code>（只注入上半身）、
                  <code className="ml-1">$名字-nsfw-lowerbody$</code>（只注入下半身）、
                  <code className="ml-1">$名字-sfw-upperbody-sfw-lowerbody$</code>（两段都要）。
                  「只要下半身」时不会注入面部——否则模型会顺势给上半身镜头。
                  <br />
                  想限定**取景**（画面里只出现上半身/下半身）还得给构图词，两种写法都行：
                  直接写在提示词里（<code>upper body, $名字-sfw-upperbody$</code>），
                  或在 JSON 形式里用 <code>framing</code>：
                  <code className="ml-1">{'{"name":"名字","angle":"","upperBody":"sfw","framing":"upper body"}'}</code>
                  （<code>angle</code> 键的存在与否区分角色与服装，角色要写它，可以是空串）。
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
        </>
      ) : null}

      {页 === 'enable' ? <CharacterEnablePanel 设置={settings} onPatch={onPatch} /> : null}
      {页 === 'common' ? <CharacterCommonListsPanel 设置={settings} onPatch={onPatch} /> : null}
      {页 === 'template' ? <CharacterInjectionTemplatePanel 设置={settings} onPatch={onPatch} /> : null}
      {页 === 'ai' ? (
        <CharacterAIPanel
          设置={settings}
          onPatch={onPatch}
          当前角色={当前}
          角色列表={角色列表}
          on选择角色={set选中Id}
          写入角色={写入角色}
          新建角色={新建并启用}
          请求生成={请求生成}
          候选配置={角色AI候选配置}
          主API模型={主API模型}
          主API地址={主API地址}
          onFetchModels={onFetchModels}
        />
      ) : null}
    </div>
  );
}
