import { useRef, useState } from 'react';
import type { 固定画风设置 } from '@/models/genSystem';
import { 面板, 提示条, 次级按钮, 开关行, 设置字段 as 字段 } from './settingsPrimitives';

/**
 * 固定画风面板（固定前置 / 固定后置 / 负面 + 导入）。
 *
 * 与「固定提示词预设」的区别：预设按作品切换，画风是**一直要**的。
 * 所以单独一层，永远叠在预设外侧；换预设时画风不受影响。
 * 关闭时三者都不参与组装，行为与没有这一层完全一致。
 */
export function FixedStylePanel({
  画风,
  onChange,
}: {
  画风: 固定画风设置;
  onChange: (下一项: 固定画风设置) => void;
}) {
  const [提示, set提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const 文件输入 = useRef<HTMLInputElement | null>(null);

  const 补丁 = (部分: Partial<固定画风设置>) => onChange({ ...画风, ...部分 });

  const 处理导入 = async (文件列表: FileList | null) => {
    if (!文件列表 || 文件列表.length === 0) return;
    const 文件 = 文件列表[0];
    let 解析: unknown;
    try {
      解析 = JSON.parse(await 文件.text());
    } catch {
      // 也接受纯文本：整体当作前置，避免用户为了导入还得手工包一层 JSON。
      const 纯文本 = (await 文件.text()).trim();
      if (!纯文本) {
        set提示({ kind: 'error', text: '文件是空的。' });
        return;
      }
      补丁({ 前置: 纯文本, 启用: true });
      set提示({ kind: 'ok', text: '文件不是 JSON，已整体当作「固定前置」导入并启用。' });
      return;
    }

    const 结果 = 归一化画风(解析);
    if (!结果) {
      set提示({
        kind: 'error',
        text: '认不出这份文件的结构。支持三种写法：'
          + '{"前置":"…","后置":"…","负面":"…"}、'
          + '{"固定前置":"…"} 这类键名，或 {"data":{…}} 的导出信封。',
      });
      return;
    }
    补丁({ ...结果, 启用: true });
    set提示({ kind: 'ok', text: '导入成功，已启用固定画风。' });
  };

  const 已填 = [画风.前置, 画风.后置, 画风.负面].filter((项) => 项.trim()).length;

  return (
    <面板
      title="固定画风"
      desc="跨预设一直生效的固定提示词。换预设时画风不受影响；关闭时这三段都不参与组装。"
    >
      <开关行
        label="启用固定画风"
        desc={`当前已填 ${已填} 段；关闭时它们会被忽略但内容保留。`}
        checked={画风.启用}
        onChange={(值) => 补丁({ 启用: 值 })}
      />

      <字段 label="固定前置提示词" hint="拼在整条正面提示词最前面；画风锚点（如画师串、LoRA）一般放这里。">
        <textarea
          className="kaituo-input h-28 w-full px-3 py-2 text-xs font-mono leading-relaxed"
          value={画风.前置}
          spellCheck={false}
          placeholder="masterpiece, anime style, <lora:xxx:0.8>"
          onChange={(事件) => 补丁({ 前置: 事件.target.value })}
        />
      </字段>

      <字段 label="固定后置提示词" hint="拼在正面提示词末尾、质量词之前。">
        <textarea
          className="kaituo-input h-28 w-full px-3 py-2 text-xs font-mono leading-relaxed"
          value={画风.后置}
          spellCheck={false}
          placeholder="detailed background, cinematic lighting"
          onChange={(事件) => 补丁({ 后置: 事件.target.value })}
        />
      </字段>

      <字段 label="固定负面提示词" hint="并入负面提示词，排在预设负面之后。">
        <textarea
          className="kaituo-input h-28 w-full px-3 py-2 text-xs font-mono leading-relaxed"
          value={画风.负面}
          spellCheck={false}
          placeholder="lowres, bad anatomy, worst quality"
          onChange={(事件) => 补丁({ 负面: 事件.target.value })}
        />
      </字段>

      <div className="flex flex-wrap items-center gap-2">
        <次级按钮 onClick={() => 文件输入.current?.click()}>导入画风文件</次级按钮>
        <次级按钮
          onClick={() => {
            补丁({ 前置: '', 后置: '', 负面: '' });
            set提示({ kind: 'info', text: '已清空三段内容（启用状态未改）。' });
          }}
        >
          清空三段
        </次级按钮>
      </div>
      <input
        ref={文件输入}
        type="file"
        accept="application/json,.json,.txt"
        className="hidden"
        onChange={(事件) => {
          void 处理导入(事件.target.files);
          事件.target.value = '';
        }}
      />

      {提示 ? <提示条 kind={提示.kind} text={提示.text} /> : null}

      {画风.启用 && 已填 === 0 ? (
        <提示条 kind="info" text="已启用但三段都是空的，实际不会改变出图结果。" />
      ) : null}
      <提示条
        kind="info"
        text="导入支持 JSON（前置/后置/负面 或 固定前置/固定后置/固定负面，也认 data 信封）与纯文本（整体作为前置）。"
      />
    </面板>
  );
}

/**
 * 归一化导入的画风数据。
 *
 * 社区流传的键名不统一（中英文混用），这里把常见写法都认下来；
 * 认不出任何一段时返回 null，让调用方给出可操作的报错，而不是静默导入空内容。
 */
export function 归一化画风(解析: unknown, 深度 = 0): Omit<固定画风设置, '启用'> | null {
  if (深度 > 3 || !解析 || typeof 解析 !== 'object' || Array.isArray(解析)) return null;
  const 根 = 解析 as Record<string, unknown>;

  // 导出信封：真正的数据在 data 里。
  if (根.data && typeof 根.data === 'object' && !Array.isArray(根.data)) {
    const 内层 = 归一化画风(根.data, 深度 + 1);
    if (内层) return 内层;
  }

  const 取值 = (键名列表: string[]): string => {
    for (const 键 of 键名列表) {
      const 值 = 根[键];
      if (typeof 值 === 'string' && 值.trim()) return 值.trim();
    }
    return '';
  };

  const 前置 = 取值(['前置', '固定前置', '固定前置提示词', 'prefix', 'pre', 'positivePrefix', 'before']);
  const 后置 = 取值(['后置', '固定后置', '固定后置提示词', 'suffix', 'post', 'positiveSuffix', 'after', 'end']);
  const 负面 = 取值(['负面', '固定负面', '固定负面提示词', 'negative', 'negativePrompt', 'uc']);

  if (!前置 && !后置 && !负面) return null;
  return { 前置, 后置, 负面 };
}
