/**
 * NovelAI 参考图（角色参考 / Director Reference）处理。
 *
 * 派生自 st-chatu8（智绘姬）index.js 的 `applyCharacterReferenceGroup` L84002-L84100
 * 与强度归一化 L83964-L83983。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-15；
 *   修改目的：① 上游把「取图 → 处理 → 填载荷」写在同一个 100 行函数里；
 *   这里把**纯计算部分**（强度归一化、载荷字段拼装）与**需要 IO 的部分**
 *   （读图、缩放）分开，前者可直接测试。
 *   ② 上游的 `processReferenceImage` 依赖酒馆的图片处理工具；这里用 Canvas 自己做
 *   等比缩放，不引入额外依赖。
 *
 * 三个字段族容易记混，逐条记下（都来自上游）：
 *   - 图片本体放 **`_cached` 后缀**的数组里，非 `_cached` 的 `director_reference_images`
 *     保持为空（L84033 vs L84049）；
 *   - `保真度` 只存不发，发送的是 `1 - 强度`（L84068）；
 *   - 只有 4.5 全量/精选模型在总强度 > 1 时**不**归一化，其余都按和分摊（L83964-L83983）。
 */

import type { 角色参考条目 } from '@/models/genSystem';
import { 角色参考上限 } from '@/models/genSystem';

/** 上游 `type` → 载荷里的 `base_caption`（L84053-L84058）。 */
export function 参考类型标题(类型: 角色参考条目['类型']): string {
  if (类型 === 'character_style') return 'character&style';
  if (类型 === 'style') return 'style';
  return 'character';
}

/**
 * 强度归一化。
 *
 * 上游规则（L83964-L83983）：
 * 1. `normalizeRefStrength === "true"` 且模型是 `nai-diffusion-4-5-full` 或
 *    `nai-diffusion-4-5-curated` → 原样返回（NAI 自己归一化）；
 * 2. 否则总和 > 1 → 每条除以总和；
 * 3. 否则原样返回。
 *
 * 注意「开启归一化」反而可能不归一化——这是上游的语义，照搬以免行为漂移。
 */
export function 归一化参考强度(
  强度列表: number[],
  模型: string,
  开启归一化: boolean,
): number[] {
  const 原样 = 强度列表.map((值) => (Number.isFinite(值) ? 值 : 0));
  if (开启归一化 && /^nai-diffusion-4-5-(full|curated)$/.test(模型.trim())) return 原样;
  const 总和 = 原样.reduce((累计, 值) => 累计 + Math.max(0, 值), 0);
  if (总和 > 1) return 原样.map((值) => Math.max(0, 值) / 总和);
  return 原样;
}

export interface 参考载荷片段 {
  director_reference_images: never[];
  director_reference_images_cached: Array<{ cache_secret_key: string; data: string }>;
  director_reference_descriptions: Array<{
    caption: { base_caption: string; char_captions: never[] };
    legacy_uc: boolean;
  }>;
  director_reference_information_extracted: number[];
  director_reference_strength_values: number[];
  director_reference_secondary_strength_values: number[];
}

/**
 * 拼装 Director Reference 载荷片段。
 *
 * `图片列表` 与 `条目列表` 按下标一一对应；调用方负责先剔除读图失败的项，
 * 否则会出现「描述比图片多一条」这种服务端直接拒绝的载荷。
 */
export function 构造参考载荷(
  条目列表: 角色参考条目[],
  图片列表: string[],
  信息提取: number,
  Uuid: () => string,
): 参考载荷片段 {
  const 数量 = Math.min(条目列表.length, 图片列表.length);
  const 有效条目 = 条目列表.slice(0, 数量);
  const 有效图片 = 图片列表.slice(0, 数量);

  return {
    director_reference_images: [],
    director_reference_images_cached: 有效图片.map((数据) => ({
      cache_secret_key: Uuid(),
      data: 数据,
    })),
    director_reference_descriptions: 有效条目.map((条目) => ({
      caption: { base_caption: 参考类型标题(条目.类型), char_captions: [] },
      legacy_uc: false,
    })),
    director_reference_information_extracted: 有效条目.map(() => 信息提取),
    director_reference_strength_values: 有效条目.map((条目) => 条目.强度),
    // 上游把「保真度」实现为 1 - 强度，存储里的 保真度 字段并不上行。
    director_reference_secondary_strength_values: 有效条目.map((条目) => 1 - 条目.强度),
  };
}

/** 参考组是否可用于出图：至少一条有效条目。 */
export function 参考组可用(条目列表: 角色参考条目[] | undefined): boolean {
  return (条目列表 ?? []).some((项) => (项.媒体Id ?? '').trim().length > 0);
}

/** 截到上游上限，并在超限时说明被丢掉了多少条。 */
export function 截断参考(条目列表: 角色参考条目[]): { 保留: 角色参考条目[]; 丢弃数: number } {
  if (条目列表.length <= 角色参考上限) return { 保留: 条目列表, 丢弃数: 0 };
  return { 保留: 条目列表.slice(0, 角色参考上限), 丢弃数: 条目列表.length - 角色参考上限 };
}

/**
 * 参考图解码的超时预算（毫秒）。
 *
 * 真机解码一张 4K 图通常几十毫秒，3000 已经非常宽松。但**不能没有上限**：
 * 部分环境里图片既不触发 onload 也不触发 onerror，没有超时就会永远挂住整次出图。
 * 导出成变量是为了让测试把它压到最小值，不必为每次解码等满 3 秒。
 */
export let 参考图解码超时毫秒 = 3000;

export function 设置参考图解码超时(毫秒: number): void {
  参考图解码超时毫秒 = Math.max(1, Math.trunc(毫秒));
}

/**
 * 等比缩放到 NovelAI 参考图建议上限内，返回 JPEG/PNG 数据地址。
 *
 * 参考图不参与出图分辨率，缩到 1024 长边足够；不缩的话一张 4K 图会让
 * 参考图体积吃掉几十 MB 配额。解码失败或超时都退回原图，让服务端自己判断。
 */
export async function 缩放参考图(数据地址: string, 长边上限 = 1024): Promise<string> {
  try {
    const 位图 = await 加载位图(数据地址, 参考图解码超时毫秒);
    const 最长边 = Math.max(位图.width, 位图.height);
    if (最长边 <= 长边上限) return 数据地址;
    const 比例 = 长边上限 / 最长边;
    const 宽 = Math.max(1, Math.round(位图.width * 比例));
    const 高 = Math.max(1, Math.round(位图.height * 比例));
    const 画布 = document.createElement('canvas');
    画布.width = 宽;
    画布.height = 高;
    const 上下文 = 画布.getContext('2d');
    if (!上下文) return 数据地址;
    上下文.drawImage(位图, 0, 0, 宽, 高);
    // 保留 PNG：NovelAI 的参考图编码对无损格式更稳。
    return 画布.toDataURL('image/png');
  } catch {
    return 数据地址;
  }
}

async function 加载位图(数据地址: string, 超时毫秒: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const 图片 = new Image();
    let 已结算 = false;
    const 结算 = (动作: () => void) => {
      if (已结算) return;
      已结算 = true;
      globalThis.clearTimeout(定时器);
      动作();
    };
    const 定时器 = globalThis.setTimeout(
      () => 结算(() => reject(new Error('参考图解码超时。'))),
      超时毫秒,
    );
    图片.onload = () => 结算(() => resolve(图片));
    图片.onerror = () => 结算(() => reject(new Error('参考图解码失败。')));
    图片.src = 数据地址;
  });
}
