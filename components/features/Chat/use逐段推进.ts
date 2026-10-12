import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * AVG（galgame）式**逐段**推进。
 *
 * 借鉴用户的 galgame 前端 `galgame前端.html`：一次只显示一个单位，
 * 前进时上一个消失（不是累积铺开）。这里沿用它的交互：
 *   - 滚轮向下 / 空格 / 回车 → 前进一段（滚轮向上 → 回退一段）
 *   - 点「继续」也能前进
 *
 * 单位是**段落**（按正文空行切），不是单个渲染行。原因是正文里对白与旁白
 * 经常一行一句，按行推进会出现一堆只有几个字的停顿，读起来很碎；
 * 按空行切出来的才是模型本来组织的「一段」。
 *
 * 没有打字机效果：本应用正文是流式产出的，再加逐字动画既重复又拖慢阅读。
 */
export interface 逐段推进参数 {
  /** 已解析的正文行；空行（kind === 'blank'）不单独成段。 */
  行: Array<{ kind: string }>;
  /** 是否启用；关闭时全显。 */
  启用: boolean;
  /** 开启后一次性全显（跳过逐段）。 */
  立即全显?: boolean;
  /** 流式生成中不启用：段落还在变，逐段推进没有意义。 */
  生成中?: boolean;
}

export interface 逐段推进状态 {
  /** 当前显示第几段（0 基）。 */
  段序号: number;
  段总数: number;
  /** 段落区间列表；调用方用它派生「当前该显示哪张图」。 */
  段落列表: Array<{ 起: number; 止: number }>;
  /** 当前段在行数组里的区间 `[起, 止)`；未启用时为整篇。 */
  可见区间: { 起: number; 止: number };
  是否全显: boolean;
  /** 挂到正文容器上：滚轮只在该区域内被拦截。 */
  容器引用: (节点: HTMLDivElement | null) => void;
  前进: () => void;
  后退: () => void;
  全部展开: () => void;
}

/**
 * 给每一段分配「该显示哪张插图」。
 *
 * 规则来自用户的 galgame 前端（`galgame前端.html` L563-L588）：
 * 正文按 `<image>` 块切分，**每个文本块沿用最近一个 `<image>` 的状态**；
 * 第一张图之前的文本拿到的是空（那时还没有图）。
 *
 * 用户明确要求「让第一张图开始就显示」，所以这里改成：**第一张图之前的段落
 * 也先显示第一张图**（`显示首图` 为真时）。否则开头几句没有图，画面很空。
 */
export function 派生段落插图(
  段落列表: Array<{ 起: number; 止: number }>,
  行插图: Map<number, string[]>,
  选项?: { 显示首图?: boolean },
): Array<string | null> {
  const 首图 = 段落列表.length > 0
    ? [...行插图.keys()].sort((甲, 乙) => 甲 - 乙).flatMap((键) => 行插图.get(键) ?? [])[0] ?? null
    : null;

  const 结果: Array<string | null> = [];
  let 当前: string | null = 选项?.显示首图 === false ? null : 首图;
  for (const 段 of 段落列表) {
    // 这一段范围内出现的插图（通常就是段首那一张）接管后面的画面。
    for (let i = 段.起; i < 段.止; i += 1) {
      const 命中 = 行插图.get(i);
      if (命中 && 命中.length > 0) 当前 = 命中[0];
    }
    结果.push(当前);
  }
  return 结果;
}

/**
 * 把行切成段落。
 *
 * **每个非空行就是一段**，空行只作为分隔被跳过、不单独成段。
 *
 * 为什么不是「按空行分组」：中文网文的段落之间通常只有一个换行，
 * 一整篇正文里可能一个空行都没有。那样分组会把全文并成一段，
 * 逐段推进就退化成「一次显示全部」——正是实际反馈的现象。
 *
 * 返回每段的 `[起, 止)` 行区间（单行段即 `止 = 起 + 1`）。
 */
export function 切分段落(行: Array<{ kind: string }>): Array<{ 起: number; 止: number }> {
  const 段落: Array<{ 起: number; 止: number }> = [];
  for (let i = 0; i < 行.length; i += 1) {
    if (行[i].kind === 'blank') continue;
    段落.push({ 起: i, 止: i + 1 });
  }
  return 段落;
}

export function use逐段推进({
  行,
  启用,
  立即全显 = false,
  生成中 = false,
}: 逐段推进参数): 逐段推进状态 {
  const 生效 = 启用 && !生成中 && !立即全显;
  const 段落 = useMemo(() => 切分段落(行), [行]);
  const 段总数 = 段落.length;
  const [段序号, set段序号] = useState(0);
  const [容器, set容器] = useState<HTMLDivElement | null>(null);
  const 容器引用 = useCallback((节点: HTMLDivElement | null) => set容器(节点), []);

  // 内容变化时把序号夹到合法范围（新段变多不该越界，变少要往回退）。
  useEffect(() => {
    set段序号((当前) => Math.min(Math.max(当前, 0), Math.max(0, 段总数 - 1)));
  }, [段总数]);

  /*
   * 只在**开关切换**时回到第一段，不在段落数变化时重置。
   * 后者会造成「读到一半自己跳回开头」——正文边读边增长时尤其明显。
   */
  const 上次生效 = useRef(生效);
  useEffect(() => {
    if (上次生效.current === 生效) return;
    上次生效.current = 生效;
    set段序号(0);
  }, [生效]);

  const 前进 = useCallback(() => {
    set段序号((当前) => Math.min(当前 + 1, Math.max(0, 段总数 - 1)));
  }, [段总数]);

  const 后退 = useCallback(() => {
    set段序号((当前) => Math.max(当前 - 1, 0));
  }, []);

  const 全部展开 = useCallback(() => set段序号(Math.max(0, 段总数 - 1)), [段总数]);

  /*
   * 滚轮：向下前进、向上后退。
   * 依赖里带上 `容器`：容器挂载后才拿到，只依赖 `启用` 的话第一次渲染时它是 null，
   * 监听永远绑不上（「滚轮没反应」最容易踩的坑）。
   */
  useEffect(() => {
    if (!容器 || !生效) return undefined;
    const 处理滚轮 = (事件: WheelEvent) => {
      if (事件.deltaY === 0) return;
      // 不拦截的话「前进一段」和「页面滚动」会同时发生，读起来很乱。
      事件.preventDefault();
      if (事件.deltaY > 0) 前进();
      else 后退();
    };
    容器.addEventListener('wheel', 处理滚轮, { passive: false });
    return () => 容器.removeEventListener('wheel', 处理滚轮);
  }, [容器, 生效, 前进, 后退]);

  // 空格 / 回车前进；输入框里打字时让位，否则打不出空格。
  useEffect(() => {
    if (!生效) return undefined;
    const 处理按键 = (事件: KeyboardEvent) => {
      const 目标 = 事件.target as HTMLElement | null;
      const 标签 = 目标?.tagName;
      if (标签 === 'INPUT' || 标签 === 'TEXTAREA' || 目标?.isContentEditable) return;
      if (事件.key === ' ' || 事件.key === 'Enter') {
        事件.preventDefault();
        前进();
      }
    };
    globalThis.addEventListener('keydown', 处理按键);
    return () => globalThis.removeEventListener('keydown', 处理按键);
  }, [生效, 前进]);

  const 当前段 = 段落[Math.min(段序号, Math.max(0, 段总数 - 1))];
  const 可见区间 = !生效
    ? { 起: 0, 止: 行.length }
    // 未启用或段落切不出来时退回全篇，避免整块空白。
    : (当前段 ?? { 起: 0, 止: 行.length });

  return {
    段序号,
    段总数,
    /** 段落区间列表；调用方用它派生「当前该显示哪张图」。 */
    段落列表: 段落,
    可见区间,
    是否全显: !生效,
    容器引用,
    前进,
    后退,
    全部展开,
  };
}
