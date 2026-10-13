import { useMemo, useRef, useState } from 'react';
import type { 注入模板集, 文生图系统设置 } from '@/models/genSystem';
import {
  内置注入模板,
  内置注入模板名列表,
  归一化注入模板集,
} from '@/models/genSystem';
import {
  面板,
  提示条,
  次级按钮,
  设置字段 as 字段,
} from '@/components/features/Settings/settingsPrimitives';
import { 角色预设条 } from './characterPresetBar';
import { 去掉键 } from './settingsShared';
import {
  生成角色列表文本,
  生成通用角色列表文本,
  生成通用服装列表文本,
} from '@/services/ai/imageGen/characterInjection';

/** 角色列表模板可用的变量（来源 `getCharacterPromptData` L29155-L29183）。 */
const 角色变量 = [
  'nameCN', 'nameEN', 'traits', 'facial', 'facialBack',
  'upperSFW', 'upperSFWBack', 'lowerSFW', 'lowerSFWBack',
  'upperNSFW', 'upperNSFWBack', 'lowerNSFW', 'lowerNSFWBack',
  'negative', 'outfits', 'imageId', 'imageDesc', 'audioId', 'audioDesc',
  // 本应用新增：渲染成 `<lora:名称:权重>`，给 SD / A1111 渠道用
  //（ComfyUI 走工作流的 %lora_name_N% 槽位，不经过文本）。
  'lora',
];

/** 服装模板可用的变量（来源 `getOutfitPromptData` L29184-L29197）。 */
const 服装变量 = [
  'nameCN', 'nameEN', 'owner',
  'upperBody', 'upperBodyBack', 'lowerBody', 'lowerBodyBack',
  'fullBody', 'fullBodyBack',
];

const 模板字段: Array<{ 键: keyof 注入模板集; 标签: string; 变量: string[]; 说明: string }> = [
  { 键: '角色列表', 标签: '角色列表模板', 变量: 角色变量, 说明: '每个启用角色渲染一次，结果拼进 {{角色启用列表}}。' },
  { 键: '卡内服装', 标签: '角色内服装模板', 变量: 服装变量, 说明: '角色卡上的每件服装渲染一次，填进角色列表模板的 {outfits}。' },
  { 键: '通用角色列表', 标签: '通用角色模板', 变量: 角色变量, 说明: '每个通用角色渲染一次，结果拼进 {{通用角色启用列表}}。' },
  { 键: '通用服装列表', 标签: '通用服装模板', 变量: 服装变量, 说明: '每件通用服装渲染一次，结果拼进 {{通用服装启用列表}}。' },
];

/**
 * 提示词注入模板。
 *
 * 上游的 `injectionTemplates`（`character.html` L739-L860）：四段模板 + `{变量}` 占位符，
 * 决定「启用角色/服装以什么形式写进提示词」。默认方案用中文键值对，
 * 另有三套（Tavern XML / Markdown / 视频注入）供不同模型口味选择。
 */
export function CharacterInjectionTemplatePanel({
  设置,
  onPatch,
}: {
  设置: 文生图系统设置;
  onPatch: (部分: Partial<文生图系统设置>) => void;
}) {
  const [提示, set提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const [触发文本, set触发文本] = useState('');
  const 文本域 = useRef<Partial<Record<keyof 注入模板集, HTMLTextAreaElement | null>>>({});

  const 预设列表 = 设置.注入模板列表;
  const 当前模板: 注入模板集 = 归一化注入模板集(预设列表[设置.当前注入模板]);

  const 写入 = (部分: Partial<注入模板集>) => {
    onPatch({
      注入模板列表: { ...预设列表, [设置.当前注入模板]: { ...当前模板, ...部分 } },
    });
  };

  const 插入变量 = (键: keyof 注入模板集, 变量: string) => {
    const 元素 = 文本域.current[键];
    const 原文 = 当前模板[键];
    const 位置 = 元素?.selectionStart ?? 原文.length;
    const 下一 = `${原文.slice(0, 位置)}{${变量}}${原文.slice(位置)}`;
    写入({ [键]: 下一 } as Partial<注入模板集>);
    // 光标落到插入内容之后，方便连续插几个变量。
    requestAnimationFrame(() => {
      元素?.focus();
      元素?.setSelectionRange(位置 + 变量.length + 2, 位置 + 变量.length + 2);
    });
  };

  const 预览 = useMemo(() => ({
    角色列表: 生成角色列表文本(设置, 触发文本.trim() ? 触发文本 : null),
    通用角色列表: 生成通用角色列表文本(设置),
    通用服装列表: 生成通用服装列表文本(设置),
  }), [设置, 触发文本]);

  return (
    <div className="space-y-4">
      <面板
        title="注入模板"
        desc="决定启用角色与服装以什么形式写进提示词。占位符写作 {变量名}；某一行里的占位符**全部为空**时整行会被丢掉，所以模板不会留下空键值对。"
      >
        <角色预设条
          名称列表={Object.keys(预设列表)}
          当前={设置.当前注入模板}
          只读名单={内置注入模板名列表}
          新建默认名="自定义模板"
          on切换={(名称) => onPatch({ 当前注入模板: 名称 })}
          on新建={(名称) => {
            onPatch({
              注入模板列表: { ...预设列表, [名称]: { ...内置注入模板['默认方案'] } },
              当前注入模板: 名称,
            });
          }}
          on另存为={(名称) => {
            onPatch({ 注入模板列表: { ...预设列表, [名称]: { ...当前模板 } }, 当前注入模板: 名称 });
          }}
          on重命名={(旧名, 新名) => {
            const 下一 = { ...去掉键(预设列表, 旧名), [新名]: 预设列表[旧名] };
            onPatch({ 注入模板列表: 下一, 当前注入模板: 新名 });
          }}
          on删除={(名称) => {
            const 下一 = 去掉键(预设列表, 名称);
            onPatch({ 注入模板列表: 下一, 当前注入模板: Object.keys(下一)[0] });
          }}
        />
        <div className="flex flex-wrap gap-2">
          <次级按钮
            onClick={() => {
              const 内置 = 内置注入模板[设置.当前注入模板];
              if (!内置) {
                set提示({ kind: 'error', text: '这个预设不是内置方案，没有可恢复的默认内容。' });
                return;
              }
              写入({ ...内置 });
              set提示({ kind: 'ok', text: `已把「${设置.当前注入模板}」恢复成内置内容。` });
            }}
          >
            恢复内置内容
          </次级按钮>
        </div>
        {提示 ? <提示条 kind={提示.kind} text={提示.text} /> : null}
      </面板>

      {模板字段.map(({ 键, 标签, 变量, 说明 }) => (
        <面板 key={键} title={标签} desc={说明}>
          <div className="flex flex-wrap gap-1">
            {变量.map((名) => (
              <button
                key={名}
                type="button"
                onClick={() => 插入变量(键, 名)}
                className="px-1.5 py-0.5 text-[11px] font-mono transition-all hover:opacity-80"
                style={{
                  color: 'rgba(var(--tj-text-secondary), 0.9)',
                  border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
                }}
                title={`插入 {${名}}`}
              >
                {`{${名}}`}
              </button>
            ))}
          </div>
          <textarea
            ref={(元素) => { 文本域.current[键] = 元素; }}
            className="kaituo-input h-40 w-full px-2 py-1.5 text-xs font-mono leading-relaxed"
            value={当前模板[键]}
            spellCheck={false}
            onChange={(事件) => 写入({ [键]: 事件.target.value } as Partial<注入模板集>)}
          />
        </面板>
      ))}

      <面板 title="渲染预览" desc="不发任何请求。留空触发文本时列出全部启用角色；填了就只保留被命中的角色。">
        <字段 label="触发文本（可留空）" hint="与出图链路一致：正文里出现的名字片段。">
          <textarea
            className="kaituo-input h-16 w-full px-2 py-1.5 text-xs leading-relaxed"
            value={触发文本}
            spellCheck={false}
            onChange={(事件) => set触发文本(事件.target.value)}
          />
        </字段>
        {(['角色列表', '通用角色列表', '通用服装列表'] as const).map((键) => (
          <字段 key={键} label={键 === '角色列表' ? '{{角色启用列表}}' : 键 === '通用角色列表' ? '{{通用角色启用列表}}' : '{{通用服装启用列表}}'}>
            <div className="kaituo-input max-h-40 overflow-auto px-2 py-1.5 text-[11px] font-mono leading-relaxed">
              {预览[键] || '（空）'}
            </div>
          </字段>
        ))}
      </面板>
    </div>
  );
}
