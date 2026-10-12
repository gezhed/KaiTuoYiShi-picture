/**
 * NovelAI Vibe transfer（氛围迁移）。
 *
 * 派生自 st-chatu8（智绘姬）index.js：
 *   `getEncodingKeyForModel` L83814-L83822、
 *   `applyVibeGroupTransfer` 的编码读取 L83891-L83944 与载荷写入 L83984-L83992、
 *   强度归一化 L83964-L83983。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-15；
 *   修改目的：上游把 Vibe 当作**独立于角色的全局组**（`settings.vibeGroups`），
 *   每组最多 4 条。本实现改为挂在角色卡的参考组上、与角色参考并列（`模式: 'vibe'`），
 *   理由与 `novelaiReference.ts` 相同：参考素材是角色的属性，独立映射会让
 *   「这个角色用哪些 Vibe」需要跨两处才能看清。
 *
 * 与角色参考的关键差异（别把两者混为一谈）：
 *   - 角色参考发的是**图片数据**，字段是 `director_reference_*`；
 *   - Vibe 发的是**已编码的特征串**，字段是 `reference_image_multiple_cached`，
 *     而且数据来自 `.naiv4vibe` JSON 的 `encodings[模型键][首个键].encoding`，
 *     **不能**直接把图片贴上去——服务端只认编码串。
 */

import type { 角色参考条目, 文生图系统设置 } from '@/models/genSystem';
import { 角色参考上限 } from '@/models/genSystem';

/**
 * 模型 → 编码键。
 *
 * 判定顺序与上游一致（L83814-L83822）：`4-5-curated` 要先于 `4-5-full` 判，
 * 否则 curated 会被误判成 full。未知模型上游退回 `v4-5curated` 并告警。
 */
export function Vibe编码键(模型: string): string {
  const 值 = (模型 ?? '').trim();
  if (值.includes('4-5-curated')) return 'v4-5curated';
  if (值.includes('4-5-full')) return 'v4-5full';
  if (值.includes('4-curated')) return 'v4curated';
  if (值.includes('4-full')) return 'v4full';
  if (值.includes('diffusion-3')) return 'v3';
  return 'v4-5curated';
}

/** 模型是否在已知映射内；未知时上游会告警并使用默认键。 */
export function Vibe模型已知(模型: string): boolean {
  return /4-5-curated|4-5-full|4-curated|4-full|diffusion-3/.test((模型 ?? '').trim());
}

export interface Vibe提取结果 {
  /** 可用于载荷的编码串；提取失败时为 null。 */
  编码: string | null;
  /** 上游的 `params.information_extracted`，缺省 1。 */
  信息提取量: number;
  错误?: string;
}

/**
 * 从 `.naiv4vibe` JSON 里取出当前模型对应的编码串。
 *
 * 上游只取 `modelEncodings` 的**第一个键**（L83922），因为一个 Vibe 文件里
 * 同一模型下可能有多个条目（不同来源），而插件约定第一个是最新的。
 *
 * 结构（L83923-L83932，逐字对齐上游）：
 * ```jsonc
 * { "encodings": { "<模型键>": { "<首个键>": {
 *     "encoding": "<base64>" | { "data": "<base64>" },
 *     "params": { "information_extracted": 1 }   // 与 encoding 平级，不在它里面
 * } } } }
 * ```
 * `params` 是 `encoding` 的**兄弟**节点。规格书里把它描述成 `encoding` 的子节点，
 * 照着写会永远取到默认值 1——本模块的测试抓到了这一点。
 */
export function 提取Vibe编码(数据: unknown, 模型: string): Vibe提取结果 {
  if (!数据 || typeof 数据 !== 'object') {
    return { 编码: null, 信息提取量: 1, 错误: 'Vibe 文件内容不是对象。' };
  }
  const 根 = 数据 as Record<string, unknown>;
  const 编码表 = 根.encodings;
  if (!编码表 || typeof 编码表 !== 'object') {
    return { 编码: null, 信息提取量: 1, 错误: 'Vibe 文件缺少 encodings 字段，确认选的是 .naiv4vibe 文件。' };
  }

  const 键 = Vibe编码键(模型);
  const 模型编码 = (编码表 as Record<string, unknown>)[键];
  if (!模型编码 || typeof 模型编码 !== 'object') {
    const 可选 = Object.keys(编码表 as Record<string, unknown>);
    return {
      编码: null,
      信息提取量: 1,
      错误: `这个 Vibe 里没有「${键}」编码（可用：${可选.join('、') || '无'}）。`
        + `换用匹配的模型，或换一个 Vibe 文件。`,
    };
  }

  const 首个键 = Object.keys(模型编码 as Record<string, unknown>)[0];
  if (!首个键) return { 编码: null, 信息提取量: 1, 错误: `「${键}」下没有任何条目。` };
  const 条目 = (模型编码 as Record<string, unknown>)[首个键];
  if (!条目 || typeof 条目 !== 'object') {
    return { 编码: null, 信息提取量: 1, 错误: `「${键}.${首个键}」不是对象。` };
  }

  const 记录 = 条目 as Record<string, unknown>;
  const 原始 = 记录.encoding;
  // 上游先校验 encoding 存在（L83924），缺失即视为结构无效。
  if (原始 === undefined || 原始 === null) {
    return { 编码: null, 信息提取量: 1, 错误: `「${键}.${首个键}」缺少 encoding 字段。` };
  }
  // 两种形态都认：直接是字符串，或 `{ data: "..." }`（L83930-L83931）。
  const 编码 = typeof 原始 === 'string'
    ? 原始
    : (typeof 原始 === 'object' && typeof (原始 as Record<string, unknown>).data === 'string'
      ? (原始 as Record<string, unknown>).data as string
      : null);
  if (!编码) return { 编码: null, 信息提取量: 1, 错误: '编码字段为空。' };

  const 参数 = 记录.params;
  const 信息提取Raw = 参数 && typeof 参数 === 'object'
    ? (参数 as Record<string, unknown>).information_extracted
    : undefined;
  // 上游用 `|| 1`，所以 0 也会退回 1。
  const 信息提取量 = typeof 信息提取Raw === 'number' && Number.isFinite(信息提取Raw) && 信息提取Raw !== 0
    ? 信息提取Raw
    : 1;

  return { 编码, 信息提取量 };
}

/** Vibe 条目的载荷形状。 */
export interface Vibe载荷片段 {
  reference_image_multiple: never[];
  reference_image_multiple_cached: Array<{ cache_secret_key: string; data: string }>;
  reference_information_extracted_multiple: number[];
  reference_strength_multiple: number[];
}

/**
 * 拼装 Vibe 载荷字段。
 *
 * 三条数组按下标一一对应；`条目列表` 与 `编码列表` 长度不一致时按短的截断——
 * 长度错位会让服务端拒绝或把强度配到错误的图上。
 */
export function 构造Vibe载荷(
  条目列表: Array<{ 强度: number }>,
  编码列表: string[],
  信息提取量列表: number[],
  Uuid: () => string,
): Vibe载荷片段 {
  const 数量 = Math.min(条目列表.length, 编码列表.length, 信息提取量列表.length);
  return {
    reference_image_multiple: [],
    reference_image_multiple_cached: 编码列表.slice(0, 数量).map((数据) => ({
      cache_secret_key: Uuid(),
      data: 数据,
    })),
    reference_information_extracted_multiple: 信息提取量列表.slice(0, 数量),
    reference_strength_multiple: 条目列表.slice(0, 数量).map((项) => 项.强度),
  };
}

/**
 * 归一化 Vibe 强度。
 *
 * 与角色参考**共用同一套规则**（上游 L83964-L83983 对两者都生效）：
 * 开启归一化且模型是 4.5 full/curated 时交给 NAI；否则总和 > 1 就按和分摊。
 * 这里复用 `novelaiReference` 的实现，避免两处规则漂移。
 */
export { 归一化参考强度 as 归一化Vibe强度 } from './novelaiReference';

/** 参考组的模式：角色参考（发图片）或 Vibe（发编码串）。 */
export type 参考模式 = 'character' | 'vibe';

/** 从角色卡参考组里挑出 Vibe 条目；非 Vibe 模式返回空。 */
export function 取Vibe条目(
  设置: 文生图系统设置,
): Array<{ 条目: 角色参考条目; 角色名: string }> {
  if (设置.novelai.参考模式 !== 'vibe') return [];
  const 候选角色 = [
    ...设置.角色启用列表.map((键) => 设置.角色卡[键]).filter(Boolean),
    ...Object.values(设置.角色卡),
  ];
  for (const 角色 of 候选角色) {
    const 条目列表 = (角色.参考组?.references ?? []).filter((项) => (项.媒体Id ?? '').trim());
    if (条目列表.length === 0) continue;
    const { 保留 } = 截断到上限(条目列表);
    return 保留.map((条目) => ({ 条目, 角色名: 角色.nameCN || 角色.nameEN || 角色.id }));
  }
  return [];
}

function 截断到上限(条目列表: 角色参考条目[]): { 保留: 角色参考条目[]; 丢弃数: number } {
  if (条目列表.length <= 角色参考上限) return { 保留: 条目列表, 丢弃数: 0 };
  return { 保留: 条目列表.slice(0, 角色参考上限), 丢弃数: 条目列表.length - 角色参考上限 };
}

/**
 * Vibe 条目存在 `角色参考条目.媒体Id` 里的是 **Vibe 数据本身的 JSON 文本**，
 * 而不是媒体库 id——Vibe 编码串只有几 KB，没必要进媒体库。
 * 这里带模型解析出可用编码。
 */
export function 解析Vibe条目数据(条目: 角色参考条目, 模型: string): Vibe提取结果 {
  const 文本 = (条目.媒体Id ?? '').trim();
  if (!文本) return { 编码: null, 信息提取量: 1, 错误: 'Vibe 条目为空。' };
  try {
    return 提取Vibe编码(JSON.parse(文本) as unknown, 模型);
  } catch (错误) {
    return {
      编码: null,
      信息提取量: 1,
      错误: `Vibe 条目不是合法 JSON：${错误 instanceof Error ? 错误.message : String(错误)}`,
    };
  }
}
