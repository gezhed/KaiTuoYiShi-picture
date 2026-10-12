/**
 * 正文插图流水线：把一轮正文变成 N 张带锚点的插图。
 *
 * 派生自 st-chatu8（智绘姬）index.js：
 *   `insertImagesIntoElement` L16840-L17185（锚点匹配与逐张插图）、
 *   `getElContext` L18632 与 `chat[id].extra.images[swipe_id]` 存储 L17541-L17555、
 *   `handlePromptRequest` 的重跑入口 L110849、`showEditDialog` L42945 的逐图改写。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：① 来源把锚点解析、DOM 插入、状态写回揉在一个 345 行函数里并依赖
 *   `dataset` 保存偏移量；这里拆成「解析 → LLM 产提示词 → 出图 → 归档」四段纯函数，
 *   锚点只保留行索引，不再依赖 DOM。
 *   ② 新增「只重跑提示词」行为：来源没有整条重生成入口（只有逐图编辑），
 *   这是用户明确要求的补充能力。
 *
 * 一正文多图是**协议层能力**：LLM 输出几个 `<image>` 就有几张图，
 * 每张图各带锚点与可选分辨率，互不覆盖。
 */

import type { 叙事插图 } from '@/models/chat';
import type { 文生图系统设置 } from '@/models/genSystem';
import type { 解析插图 } from './illustrationProtocol';
import { 匹配锚点行, 截断锚点, 取出提示词正文, 包回提示词标记, 剥出尺寸, 提取内联插图, type 内联插图 } from './illustrationProtocol';
import type { 传输诊断 } from './illustrationAgent';
import { 生成插图提示词, 截断插图数量, type 生成插图提示词结果 } from './illustrationAgent';
import {
  生成角色列表文本,
  生成通用角色列表文本,
  生成通用服装列表文本,
} from './characterInjection';

/** 依赖注入：让流水线可以脱离 React 与具体后端单测。 */
export interface 插图流水线依赖 {
  /** 让 LLM 产出一批 `<image>` 记录。 */
  生成提示词: (参数: {
    正文: string;
    设置: 文生图系统设置;
    signal?: AbortSignal;
  }) => Promise<生成插图提示词结果>;
  /** 出一张图，返回可显示的数据地址；失败时抛错。 */
  出图: (参数: {
    提示词标记: string;
    覆盖尺寸?: { 宽度: number; 高度: number } | null;
    标题?: string;
    /** 参考图；由调用方按角色媒体解析好，引擎负责上传并填占位符。 */
    参考图?: { 数据地址: string; 文件名: string } | null;
    signal?: AbortSignal;
  }) => Promise<{ 数据地址: string; 正向提示词: string; 负向提示词: string; 宽度: number; 高度: number }>;
  /** 归档一张成图（例如写进相册与图片缓存）。返回可能被替换后的地址引用。 */
  归档?: (参数: {
    插图: 叙事插图;
    提示词标记: string;
    锚点索引: number;
    宽度: number;
    高度: number;
    signal?: AbortSignal;
  }) => Promise<{ 数据地址?: string } | void>;
  /** 把锚点行文本解析成 `{ 行列表, 全文 }`；默认按换行切分。 */
  切分正文?: (正文: string) => string[];
  /**
   * 进度回调：让界面在「正在写提示词」与「正在逐张出图（i/N）」之间切换文案。
   *
   * 为什么必须由流水线报：出图是**逐张**的，而结果只在全部结束后才写回消息，
   * 所以从点击到写回之间界面拿不到任何进度（用户看到的就是「点了没反应」，
   * 于是反复点）。这里把两个阶段、以及每张完成都报出来。
   */
  on进度?: (事件: 插图进度) => void;
}

/** 生图进度事件。`完成数`/`总数` 只在「出图」阶段有意义。 */
export interface 插图进度 {
  阶段: '提示词' | '出图';
  完成数?: number;
  总数?: number;
}

export interface 插图锚点 {
  锚点: string;
  锚点索引: number;
  提示词标记: string;
  宽度: number | null;
  高度: number | null;
}

/** 把 LLM 产出的记录解析成带锚点行索引的条目。匹配不到的行索引为 -1。 */
export function 解析插图锚点(
  记录列表: 解析插图[],
  正文: string,
  切分正文?: (正文: string) => string[],
  /**
   * 是否启用「AI 自主分辨率」。
   *
   * 这个开关同时决定两件事（`剥出尺寸` 的语义）：尺寸文本一律从提示词里去掉，
   * 但只有开启时才把宽高**取出来**用。关闭时取不到宽高 → 用渠道默认尺寸。
   * 之前这里硬编码 true，等于让开关失效。
   */
  自主分辨率 = true,
): 插图锚点[] {
  const 行列表 = (切分正文 ?? 默认切分)(正文);

  /*
   * 内联优先：智绘姬系预设让正文模型**直接把 `<image>提示词</image>` 写进正文**，
   * 块前面那一行就是挂载点。这种情况下行号由块的位置决定，比拿模型另写的
   * 锚点去逐行比对可靠得多（也避免了「模型写的锚点行并不逐字存在」的问题）。
   */
  const 内联 = 提取内联插图(正文);
  if (内联.length > 0) {
    return 内联.map((块) => {
      const 锚点文本 = 块.显式锚点 || 截断锚点(块.上文行);
      const 提示词标记 = 包回提示词标记(块.提示词);
      const 剥尺寸 = 剥出尺寸(块.提示词, 自主分辨率);
      return {
        锚点: 锚点文本,
        锚点索引: 定位内联块行号(行列表, 块),
        提示词标记: 剥尺寸.提示词 === 块.提示词 ? 提示词标记 : 包回提示词标记(剥尺寸.提示词),
        宽度: 剥尺寸.宽度,
        高度: 剥尺寸.高度,
      };
    });
  }

  return 记录列表.map((记录) => {
    const 命中 = 匹配锚点行(行列表, 记录.regex);
    const 正文提示词 = 取出提示词正文(记录.tag);
    const 剥尺寸 = 剥出尺寸(正文提示词, 自主分辨率);
    return {
      锚点: 截断锚点(记录.regex),
      锚点索引: 命中 ? 命中.行索引 : -1,
      // 尺寸文本一律剥掉——留在提示词里会被后端当作普通词条画进图里。
      // 提示词正文不保留尺寸；`叙事插图` 没有独立宽高字段，但重跑提示词那条路径
      // 会从既有插图重新解析尺寸，所以这里不承担保存责任。
      提示词标记: 剥尺寸.提示词 === 正文提示词 ? 记录.tag : 包回提示词标记(剥尺寸.提示词),
      宽度: 剥尺寸.宽度,
      高度: 剥尺寸.高度,
    };
  });
}

/**
 * 内联块插在「块前最后一行」之后。
 *
 * 用块的上文文本数换行数得到行号；块自身可能横跨多行，所以必须按**块起始位置**
 * 而不是块内容来算，否则多行提示词会把行号推偏。
 */
function 定位内联块行号(行列表: string[], 块: 内联插图): number {
  if (!块.上文行) return -1;
  const 上文 = 行列表.join('\n').slice(0, 块.起始);
  const 行数 = 上文.split('\n').length;
  // 上文以换行结尾时，块刚好落在下一行开头。
  const 行号 = 上文.endsWith('\n') ? 行数 - 1 : 行数 - 1;
  const 目标行 = 行列表[行号]?.trim() ?? '';
  if (目标行 && 目标行.includes(块.上文行.slice(0, 20))) return 行号;
  // 行号算偏时退回按内容查一次，宁可能定位到就不要丢。
  const 找到 = 行列表.findIndex((行) => 行.trim() === 块.上文行.trim());
  return 找到;
}

function 默认切分(正文: string): string[] {
  return (正文 ?? '').split(/\r?\n/);
}

/** LLM 不可用时的兜底提示词：拿锚点行本身当画面描述，至少能出一张不空白的图。 */
export function 锚点兜底提示词(锚点: string): string {
  const 清理 = (锚点 ?? '')
    .replace(/[「」『』【】《》（）()"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return 清理 ? `${清理}, anime style, detailed` : 'anime style illustration, detailed';
}

export interface 生成正文插图参数 {
  消息Id: string;
  正文: string;
  设置: 文生图系统设置;
  /** 已有插图；给出时按其锚点重跑，不重新解析正文。 */
  已有插图?: 叙事插图[];
  /** 只重跑提示词并保留已出好的图（用户要求的能力）。 */
  只重新生成提示词?: boolean;
  /** 每张图都要带的参考图；由调用方按角色媒体解析好。 */
  参考图?: { 数据地址: string; 文件名: string } | null;
  依赖: 插图流水线依赖;
  signal?: AbortSignal;
}

export interface 生成正文插图结果 {
  插图: 叙事插图[];
  提示词诊断?: string;
  /**
   * LLM 的原始回复。
   *
   * 单独带出来是因为「没返回」与「返回了但格式不对」的现象完全一样（都是 0 张图），
   * 而排查方向完全不同。界面上把它显示出来，用户就不必靠猜。
   */
  原始回复?: string;
  /** 本轮实际出了几张图。 */
  成功数: number;
  失败数: number;
}

function 建插图(参数: {
  序号: number;
  消息Id: string;
  锚点: string;
  提示词标记: string;
  宽度: number | null;
  高度: number | null;
}): 叙事插图 {
  return {
    id: `narrative_${参数.消息Id}_${参数.序号}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    dataUrl: '',
    type: 'scene',
    kind: 'snapshot',
    prompt: 参数.提示词标记,
    description: 参数.锚点 || `插图 ${参数.序号 + 1}`,
    status: 'generating',
  };
}

/**
 * 生成一轮正文的插图。
 *
 * 顺序：先拿到全部锚点，再**逐张**出图。逐张而不是并发，是为了：
 * ① 与来源的串行生图间隔语义一致（并发会打爆本地 ComfyUI）；
 * ② 单张失败不影响其它张，失败信息留在各自记录上。
 */
export async function 生成正文插图(参数: 生成正文插图参数): Promise<生成正文插图结果> {
  const { 消息Id, 正文, 设置, 依赖, signal } = 参数;
  const 上限 = 设置.正文配图.每轮上限;

  let 锚点列表: 插图锚点[];
  let 提示词诊断: string | undefined;
  let 原始回复: string | undefined;
  const 只重跑提示词 = 参数.只重新生成提示词 === true;

  if (只重跑提示词) {
    // 用户对现有提示词不满意：重问 LLM，但保留已有图的锚点与次序。
    依赖.on进度?.({ 阶段: '提示词' });
    const 生成结果 = await 依赖.生成提示词({ 正文, 设置, signal });
    提示词诊断 = 生成结果.诊断?.文案;
    原始回复 = 生成结果.原始回复;
    const 新锚点 = 解析插图锚点(截断插图数量(生成结果.插图, 上限), 正文, 依赖.切分正文);
    const 已有 = 参数.已有插图 ?? [];
    // 拿不到新提示词就退回旧提示词，而不是把图清空。
    锚点列表 = 已有.length > 0
      ? 已有.map((插图, 序号) => {
          const 替补 = 新锚点[序号];
          const 已存尺寸 = 剥出尺寸(取出提示词正文(插图.prompt), true);
          return {
            锚点: 截断锚点(插图.description ?? ''),
            锚点索引: 替补?.锚点索引 ?? -1,
            提示词标记: 替补?.提示词标记 || 插图.prompt,
            宽度: 替补?.宽度 ?? 已存尺寸.宽度,
            高度: 替补?.高度 ?? 已存尺寸.高度,
          };
        })
      : 新锚点;
  } else if (参数.已有插图 && 参数.已有插图.length > 0) {
    // 重出图路径：沿用已有锚点与提示词，只重跑后端。
    锚点列表 = 参数.已有插图.map((插图) => {
      const 已存尺寸 = 剥出尺寸(取出提示词正文(插图.prompt), true);
      return {
        锚点: 截断锚点(插图.description ?? ''),
        锚点索引: -1,
        提示词标记: 插图.prompt,
        宽度: 已存尺寸.宽度,
        高度: 已存尺寸.高度,
      };
    });
  } else {
    依赖.on进度?.({ 阶段: '提示词' });
    const 生成结果 = await 依赖.生成提示词({ 正文, 设置, signal });
    提示词诊断 = 生成结果.诊断?.文案;
    原始回复 = 生成结果.原始回复;
    const 截断后 = 截断插图数量(生成结果.插图, 上限);
    锚点列表 = 解析插图锚点(截断后, 正文, 依赖.切分正文, 设置.comfyui.自主分辨率);
  }

  if (只重跑提示词) {
    return {
      插图: 锚点列表.map((锚点, 序号) => ({
        ...建插图({ 序号, 消息Id, 锚点: 锚点.锚点, 提示词标记: 锚点.提示词标记, 宽度: 锚点.宽度, 高度: 锚点.高度 }),
        status: 'done' as const,
        dataUrl: 参数.已有插图?.[序号]?.dataUrl ?? '',
      })),
      提示词诊断,
      原始回复,
      成功数: 0,
      失败数: 0,
    };
  }

  const 产出: 叙事插图[] = [];
  let 成功数 = 0;
  let 失败数 = 0;

  // 提示词阶段结束、开始逐张出图：先报一次「0/N」，让界面从「正在写提示词」切到「正在出图」。
  依赖.on进度?.({ 阶段: '出图', 完成数: 0, 总数: 锚点列表.length });

  for (let 序号 = 0; 序号 < 锚点列表.length; 序号 += 1) {
    const 锚点 = 锚点列表[序号];
    if (signal?.aborted) break;

    const 记录 = 建插图({
      序号,
      消息Id,
      锚点: 锚点.锚点,
      提示词标记: 锚点.提示词标记,
      宽度: 锚点.宽度,
      高度: 锚点.高度,
    });

    const 有效标记 = 锚点.提示词标记?.trim()
      ? 锚点.提示词标记
      : 包回提示词标记(锚点兜底提示词(锚点.锚点));

    try {
      const 出图 = await 依赖.出图({
        提示词标记: 有效标记,
        覆盖尺寸: 锚点.宽度 && 锚点.高度 ? { 宽度: 锚点.宽度, 高度: 锚点.高度 } : null,
        标题: 锚点.锚点,
        参考图: 参数.参考图,
        signal,
      });
      const 完成: 叙事插图 = {
        ...记录,
        dataUrl: 出图.数据地址,
        prompt: 有效标记,
        negativePrompt: 出图.负向提示词,
        status: 'done',
      };
      if (依赖.归档) {
        const 归档结果 = await 依赖.归档({
          插图: 完成,
          提示词标记: 有效标记,
          锚点索引: 锚点.锚点索引,
          宽度: 出图.宽度,
          高度: 出图.高度,
          signal,
        });
        if (归档结果?.数据地址) 完成.dataUrl = 归档结果.数据地址;
      }
      产出.push(完成);
      成功数 += 1;
    } catch (错误) {
      if (signal?.aborted) break;
      产出.push({
        ...记录,
        prompt: 有效标记,
        status: 'failed',
        error: 错误 instanceof Error ? 错误.message : String(错误),
      });
      失败数 += 1;
    }
    依赖.on进度?.({ 阶段: '出图', 完成数: 成功数 + 失败数, 总数: 锚点列表.length });
  }

  return { 插图: 产出, 提示词诊断, 原始回复, 成功数, 失败数 };
}

/** 重生成单张插图：用编辑后的提示词覆盖并重出这一张。 */
export async function 重生成单张插图(参数: {
  插图: 叙事插图;
  /** 用户在编辑框里改过的纯提示词文本；不传则沿用原标记。 */
  新提示词正文?: string;
  /** 用户在尺寸选择器里指定的尺寸，优先于提示词里的 `WxH`。 */
  覆盖尺寸?: { 宽度: number; 高度: number } | null;
  /** 参考图；由调用方按角色媒体解析好。 */
  参考图?: { 数据地址: string; 文件名: string } | null;
  依赖: 插图流水线依赖;
  signal?: AbortSignal;
}): Promise<叙事插图> {
  const { 插图, 依赖, signal } = 参数;

  const 标记 = 参数.新提示词正文 !== undefined
    ? 包回提示词标记(参数.新提示词正文)
    : 插图.prompt;

  const 剥尺寸 = 剥出尺寸(取出提示词正文(标记), true);
  const 尺寸 = 参数.覆盖尺寸
    ?? (剥尺寸.宽度 && 剥尺寸.高度 ? { 宽度: 剥尺寸.宽度, 高度: 剥尺寸.高度 } : null);
  try {
    const 出图 = await 依赖.出图({
      提示词标记: 标记,
      覆盖尺寸: 尺寸,
      标题: 插图.description,
      参考图: 参数.参考图,
      signal,
    });
    const 完成: 叙事插图 = {
      ...插图,
      dataUrl: 出图.数据地址,
      prompt: 标记,
      negativePrompt: 出图.负向提示词,
      status: 'done',
      error: undefined,
    };
    if (依赖.归档) {
      const 归档结果 = await 依赖.归档({
        插图: 完成,
        提示词标记: 标记,
        锚点索引: -1,
        宽度: 出图.宽度,
        高度: 出图.高度,
        signal,
      });
      if (归档结果?.数据地址) 完成.dataUrl = 归档结果.数据地址;
    }
    return 完成;
  } catch (错误) {
    return {
      ...插图,
      prompt: 标记,
      status: 'failed',
      error: 错误 instanceof Error ? 错误.message : String(错误),
    };
  }
}

/**
 * 「换提示词」的合并规则：只替换提示词与描述锚点，**保留原图地址与状态**。
 *
 * 这是有意为之的行为：玩家对提示词不满意时不应该连带丢掉已经出好、已经挂进相册的图。
 * 新结果比旧记录少时，多出来的旧记录原样保留（模型少给了几条不等于要删图）。
 */
export function 合并重跑提示词(旧插图: 叙事插图[], 新插图: 叙事插图[]): 叙事插图[] {
  return 旧插图.map((旧, 序号) => {
    const 新 = 新插图[序号];
    if (!新) return 旧;
    return {
      ...旧,
      prompt: 新.prompt || 旧.prompt,
      description: 新.description || 旧.description,
    };
  });
}

/** 把插图数组按锚点行索引回填成「正文里的插槽」，供渲染层按行插入。 */export interface 正文插槽 {
  行索引: number;
  插图索引: number;
}

export function 派生正文插槽(锚点列表: 插图锚点[]): 正文插槽[] {
  return 锚点列表
    .map((锚点, 插图索引) => ({ 行索引: 锚点.锚点索引, 插图索引 }))
    .filter((项) => 项.行索引 >= 0)
    .sort((甲, 乙) => 甲.行索引 - 乙.行索引);
}

/** 便捷构造：把 `生成插图提示词` 包成流水线需要的形状。 */
export function 建提示词依赖(
  调用: (消息: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, signal?: AbortSignal) => Promise<string>,
  取诊断?: () => 传输诊断 | undefined,
): 插图流水线依赖['生成提示词'] {
  return async ({ 正文, 设置, signal }) => {
    return 生成插图提示词(
      { 请求: 调用, 取诊断 },
      {
        回复: 正文,
        输入: {
          正文,
          上下文: '',
          世界书触发: '',
          用户需求: '',
          /*
           * 三类注入变量在这里落地。
           *
           * 上游是在世界书条目内容上做替换（条目里写 `{{角色启用列表}}`），
           * 本应用没有那一层「世界书 → 提示词」的注入通道，因此改用正文作为触发文本：
           * 语义等价（正文里出现的名字就是本轮出场的角色），且行为可预期。
           */
          角色启用列表: 生成角色列表文本(设置, 正文),
          通用角色启用列表: 生成通用角色列表文本(设置),
          通用服装启用列表: 生成通用服装列表文本(设置),
        },
        设置: 设置.LLM,
        词汇替换映射: 设置.提示词.词汇替换,
        signal,
      },
    );
  };
}
