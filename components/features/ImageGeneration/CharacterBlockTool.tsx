/**
 * 角色提示词小工具（手动出图用）。
 *
 * 手动出图里让人肉写 `$…$` 角色段很容易写错 —— 而**写错不会报错**：
 * 名字对不上、键名写错（`upperbody` vs `upperBody`）、少了 `}$`，
 * 结果都是「整段原样留在提示词里」，既不生效又占词元，出图看不出原因。
 *
 * 所以这里把常用的几档做成选项，拼成一段现成的变量块插进提示词：
 *
 * ```
 * ${"name":"march 7th", "angle":"front view", "upperBody":"sfw", "lowerBody":"hidden"}$
 * ```
 *
 * 语法要点（与 `characterPrompt` 的 `遍历角色段` 对齐）：
 * - 外层是 `${` + 键值对 + `}$`，**不是** `${ json 对象 }$`（多一层花括号就不认）；
 * - 带 `angle` 键 → 当成**角色段**；不带 → 当成**服装段**（服装段用 `visible`/`hidden`）；
 * - 上半身/下半身写 `hidden` 就是「不画这一段」。
 */
import { useMemo, useState } from 'react';
import type { 角色卡 } from '@/models/genSystem';
import { 面板, 提示条, 次级按钮, 设置字段 as 字段 } from '@/components/features/Settings/settingsPrimitives';

/** 角度候选：前两个是应用**明确识别**的写法（`from behind` 才会切到背面字段）。 */
const 角度选项 = [
  { 值: 'front view', 标签: '正面' },
  { 值: 'from behind', 标签: '背面（用背面字段）' },
  { 值: 'from side', 标签: '侧面' },
  { 值: 'from above', 标签: '俯视' },
  { 值: 'from below', 标签: '仰视' },
] as const;

/** 穿衣档：sfw 字段放「穿衣」，nsfw 字段放「不穿衣」。 */
const 穿衣选项 = [
  { 值: 'sfw', 标签: '穿衣（sfw）' },
  { 值: 'nsfw', 标签: '不穿衣（nsfw）' },
] as const;

/** 取哪几段身体。 */
const 部位选项 = [
  { 值: 'upper', 标签: '上半身' },
  { 值: 'lower', 标签: '下半身' },
  { 值: 'both', 标签: '全身（上下都写）' },
] as const;

type 角度 = typeof 角度选项[number]['值'];
type 穿衣 = typeof 穿衣选项[number]['值'];
type 部位 = typeof 部位选项[number]['值'];

/** 拼出那段变量块（导出以便单测：语法错了不会报错，只能靠断言兜住）。 */
export function 拼角色块(
  角色名: string,
  选项: { 角度: 角度; 穿衣: 穿衣; 部位: 部位 },
): string {
  const 名 = 角色名.trim();
  const 上 = 选项.部位 === 'lower' ? 'hidden' : 选项.穿衣;
  const 下 = 选项.部位 === 'upper' ? 'hidden' : 选项.穿衣;
  // 顺序固定，方便肉眼比对；值里不出现引号以外的东西，所以直接拼即可。
  return '${' + `"name":"${名}", "angle":"${选项.角度}", "upperBody":"${上}", "lowerBody":"${下}"` + '}$';
}

/**
 * 把块插进已有提示词，返回新文本与插入后该放光标的位置。
 *
 * `选区` 给 `null` 表示「输入框没聚焦」→ **追加到末尾**。
 * 这点必须显式区分：textarea 未聚焦时 `selectionStart` 是 0，
 * 照它插会把块塞到最前面，手写好的提示词看起来就被改乱了。
 * 前后各补一个 `, `：块黏在别的 tag 上会被当成同一个词。
 */
export function 插入提示词块(
  原文: string,
  块: string,
  选区: { 起: number; 止: number } | null,
): { 文本: string; 光标: number } {
  if (!选区) {
    const 尾 = 原文.replace(/[,\s]+$/, '');
    const 文本 = 尾 ? `${尾}, ${块}` : 块;
    return { 文本, 光标: 文本.length };
  }
  const 起 = Math.max(0, Math.min(选区.起, 原文.length));
  const 止 = Math.max(起, Math.min(选区.止, 原文.length));
  const 前 = 原文.slice(0, 起);
  const 后 = 原文.slice(止);
  const 左 = 前.trim().length > 0 && !/[,\s(]$/.test(前) ? `${前}, ` : 前;
  const 右 = 后.trim().length > 0 && !/^[,\s)]/.test(后) ? `, ${后}` : 后;
  const 文本 = `${左}${块}${右}`;
  return { 文本, 光标: 左.length + 块.length };
}

export function CharacterBlockTool({
  角色列表,
  on插入,
}: {
  角色列表: 角色卡[];
  /** 把拼好的块插进提示词（在光标处）。 */
  on插入: (块: string) => void;
}) {
  const [角色名, set角色名] = useState('');
  const [角度, set角度] = useState<角度>('front view');
  const [穿衣, set穿衣] = useState<穿衣>('sfw');
  const [部位, set部位] = useState<部位>('upper');
  const [提示, set提示] = useState('');

  /** 角色卡的候选名：中文名的每个 `|` 别名都列出来（`$…$` 按别名匹配）。 */
  const 候选名 = useMemo(() => {
    const 集合 = new Set<string>();
    for (const 角色 of 角色列表) {
      for (const 名 of (角色.nameCN || '').split('|')) {
        const 裁剪 = 名.trim();
        if (裁剪) 集合.add(裁剪);
      }
    }
    return [...集合];
  }, [角色列表]);

  const 块 = useMemo(() => 拼角色块(角色名, { 角度, 穿衣, 部位 }), [角色名, 角度, 穿衣, 部位]);
  const 名字可用 = 角色名.trim().length > 0;
  /** 填的名字是否真的能匹配到一张卡 —— 对不上就会「整段原样留下」，先说清楚。 */
  const 名字命中 = 候选名.some((名) => 名.toLowerCase() === 角色名.trim().toLowerCase());

  return (
    <面板
      title="角色提示词小工具"
      desc="选几下就拼出一段角色变量块，插进上面的提示词里。写错名字或键名不会报错，只会整段不生效 —— 所以这里把语法固定下来。"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <字段 label="角色名" hint={候选名.length > 0 ? '可下拉选已有角色，也可手填英文名。' : '还没有角色卡；手填名字即可。'}>
          <input
            className="kaituo-input w-full px-2 py-1 text-xs"
            aria-label="角色名"
            list="手动出图-角色名候选"
            value={角色名}
            placeholder="march 7th"
            onChange={(事件) => set角色名(事件.target.value)}
          />
          <datalist id="手动出图-角色名候选">
            {候选名.map((名) => <option key={名} value={名} />)}
          </datalist>
        </字段>
        <字段 label="角度">
          <select
            className="kaituo-input w-full px-2 py-1 text-xs"
            aria-label="角度"
            value={角度}
            onChange={(事件) => set角度(事件.target.value as 角度)}
          >
            {角度选项.map((项) => <option key={项.值} value={项.值}>{项.标签}</option>)}
          </select>
        </字段>
        <字段 label="穿衣">
          <select
            className="kaituo-input w-full px-2 py-1 text-xs"
            aria-label="穿衣"
            value={穿衣}
            onChange={(事件) => set穿衣(事件.target.value as 穿衣)}
          >
            {穿衣选项.map((项) => <option key={项.值} value={项.值}>{项.标签}</option>)}
          </select>
        </字段>
      </div>

      {/*
        按钮组不能用 `字段`（它渲染成 `<label>`）：标签文字会被算进按钮的
        无障碍名称里（读屏念成「画哪一段 下半身」），点标签空白还会误触发按钮。
        这里用普通容器 + 标题文字。
      */}
      <div className="space-y-1">
        <div className="font-serif text-xs tracking-[0.22em]" style={{ color: 'rgb(var(--tj-text-primary))' }}>画哪一段</div>
        <div className="flex flex-wrap gap-2">
          {部位选项.map((项) => (
            <次级按钮 key={项.值} active={部位 === 项.值} onClick={() => set部位(项.值)}>
              {项.标签}
            </次级按钮>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <div className="font-serif text-xs tracking-[0.22em]" style={{ color: 'rgb(var(--tj-text-primary))' }}>拼出来的块</div>
        <code
          className="block px-2 py-1.5 font-mono text-[11px] leading-relaxed break-all"
          style={{ background: 'rgba(var(--tj-ui-panel-strong), 0.42)', border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
        >
          {块}
        </code>
        <div className="flex flex-wrap items-center gap-2">
          <次级按钮
            disabled={!名字可用}
            onClick={() => {
              on插入(块);
              set提示(`已插入：${块}`);
            }}
          >
            插入到提示词
          </次级按钮>
          <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.68)' }}>
            插进提示词后，`upperBody` / `lowerBody` 会替换成角色卡上对应档位的字段。
          </span>
        </div>
      </div>

      {名字可用 && !名字命中 ? (
        <提示条
          kind="info"
          text={`「${角色名.trim()}」不在角色卡的名称/别名里：这张图不会替换成她的字段（那段会原样留在提示词里）。要么改成角色卡上的名字，要么就到「角色管理 → 角色卡」把英文名（可用 | 分隔别名）补上。`}
        />
      ) : null}
      {提示 ? <提示条 kind="ok" text={提示} /> : null}
    </面板>
  );
}
