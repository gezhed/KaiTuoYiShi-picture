/**
 * NovelAI 载荷构造。
 *
 * 派生自 st-chatu8（智绘姬）index.js 的 `novelaigenerate` 载荷段：
 *   L84480-L84518（基础字段）、L84519-L84545（v4 分角色分支）、
 *   L84546-L84551（`skip_cfg_above_sigma` 的模型差异）、
 *   `params_version` L84482、`centersToCoordinates` L9082-L9120。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-15；
 *   修改目的：把上游散落在 1000 行生成函数里的载荷拼装抽成纯函数，
 *   并去掉本应用不使用的云端队列、msgpack 流式与酒馆代理分支
 *   （上游 `stream: "msgpack"` L84507 依赖打包进来的 msgpack 解码器）。
 */

import type { NovelAI设置 } from '@/models/genSystem';
import { NovelAI参数版本, NovelAI支持分角色 } from '@/models/genSystem';

/** 坐标：`{x, y}` 均在 [0,1]；空对象表示「交给模型自己决定」。 */
export interface NovelAI坐标 {
  x?: number;
  y?: number;
}

export interface NovelAI分角色 {
  prompt: string;
  /** 负面提示词（v4 里叫 UC）。 */
  uc?: string;
  /** 已解析的坐标；缺省表示不指定。 */
  coordinates?: NovelAI坐标;
}

export interface NovelAI载荷输入 {
  设置: NovelAI设置;
  正向提示词: string;
  负向提示词: string;
  宽度?: number;
  高度?: number;
  种子?: number;
  分角色?: NovelAI分角色[];
  /**
   * Director Reference 片段，由 `novelaiReference.ts` 的 `构造参考载荷` 产出。
   * 给出时覆盖基础载荷里那六个空字段。
   */
  参考?: Record<string, unknown> | null;
}

/** 上游在非分角色分支里的固定值（L84546-L84551）。 */
export function NovelAI默认SkipCfg(模型: string): number {
  if (模型 === 'nai-diffusion-4-full') return 19;
  if (模型.includes('nai-diffusion-4-5')) return 59.04722600415217;
  return 19.343056794463642;
}

/**
 * 网格坐标 → 数值坐标。
 *
 * 上游两种写法（L9082-L9120）：显式数值对 `0.1,0.9`（或 `{0.1, 0.9}`，全角逗号也认），
 * 以及 5×5 网格 `[a-e][1-5]`（`a`→x=0.1 … `e`→x=0.9，`1`→y=0.1 … `5`→y=0.9）。
 * 认不出来就返回空对象，表示让模型自己排位置。
 */
export function 解析NovelAI坐标(原文: string | undefined | null): NovelAI坐标 {
  const 文本 = (原文 ?? '').trim();
  if (!文本) return {};

  const 网格 = 文本.match(/([a-e])\s*([1-5])/i);
  if (网格) {
    const 列 = 网格[1].toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0);
    const 行 = Number(网格[2]) - 1;
    return {
      x: Number((0.1 + 列 * 0.2).toFixed(3)),
      y: Number((0.1 + 行 * 0.2).toFixed(3)),
    };
  }

  const 数值 = 文本.replace(/[{}]/g, '').replace(/，/g, ',').split(',');
  if (数值.length >= 2) {
    const x = Number(数值[0]);
    const y = Number(数值[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return {
        x: Number(Math.min(1, Math.max(0, x)).toFixed(3)),
        y: Number(Math.min(1, Math.max(0, y)).toFixed(3)),
      };
    }
  }
  return {};
}

/** 上游种子语义：0 / 空 / -1 都表示随机（L84509）。 */
export function 解析NovelAI种子(种子: number | string | undefined, 随机: () => number): number {
  const 值 = typeof 种子 === 'number' ? 种子 : Number(String(种子 ?? '').trim());
  if (!Number.isFinite(值) || 值 === 0 || 值 === -1) return 随机();
  return Math.trunc(值);
}

export interface NovelAIV4载荷 {
  v4_prompt: {
    caption: { base_caption: string; char_captions: Array<{ char_caption: string; centers: NovelAI坐标[] }> };
    use_coords: boolean;
    use_order: boolean;
  };
  v4_negative_prompt: {
    caption: { base_caption: string; char_captions: Array<{ char_caption: string; centers: NovelAI坐标[] }> };
    legacy_uc: boolean;
  };
  characterPrompts: Array<{ enabled: boolean; prompt: string; center: NovelAI坐标; uc: string }>;
}

/**
 * 构造 NovelAI 的 `parameters` 对象。
 *
 * 字段顺序与上游一致（便于与来源逐行比对），但**不包含**上游的
 * `stream: "msgpack"`：本应用用普通 JSON 响应，省掉一个 31 KB 的解码器依赖。
 */
export function 构造NovelAI载荷(输入: NovelAI载荷输入, 随机种子: () => number): Record<string, unknown> {
  const { 设置 } = 输入;
  const 模型 = 设置.模型.trim();
  const 宽度 = Math.max(64, Math.trunc(输入.宽度 ?? 设置.宽度));
  const 高度 = Math.max(64, Math.trunc(输入.高度 ?? 设置.高度));
  const 分角色列表 = NovelAI支持分角色(模型) ? (输入.分角色 ?? []) : [];
  const 使用坐标 = !设置.AI默认位置;
  const 负向 = 输入.负向提示词 ?? '';

  const 载荷: Record<string, unknown> = {
    params_version: NovelAI参数版本(模型),
    width: 宽度,
    height: 高度,
    scale: 设置.关联性,
    sampler: 设置.采样器,
    steps: Math.max(1, Math.trunc(设置.步数)),
    n_samples: 1,
    ucPreset: 3,
    qualityToggle: true,
    sm: 设置.sm,
    // 上游：dyn 单独开着但 sm 关着时强制 false（L84496）。
    sm_dyn: 设置.sm_dyn && 设置.sm,
    dynamic_thresholding: 设置.动态阈值,
    controlnet_strength: 1,
    legacy: false,
    legacy_uc: false,
    add_original_image: true,
    cfg_rescale: 设置.cfgRescale,
    noise_schedule: 设置.噪点表,
    skip_cfg_above_sigma: 设置.多样性增强 ? NovelAI默认SkipCfg(模型) : null,
    legacy_v3_extend: false,
    seed: 解析NovelAI种子(输入.种子 ?? 设置.种子, 随机种子),
    negative_prompt: 负向,
    // 参考图族。第一版不发参考图，但字段必须存在，否则服务端会拒绝。
    reference_image_multiple: [],
    reference_information_extracted_multiple: [],
    reference_strength_multiple: [],
    reference_image_multiple_cached: [],
    normalize_reference_strength_multiple: false,
    use_coords: 使用坐标,
  };

  if (NovelAI支持分角色(模型)) {
    const v4 = 构造V4载荷({
      正向提示词: 输入.正向提示词,
      负向提示词: 负向,
      分角色: 分角色列表,
      使用坐标,
    });
    载荷.characterPrompts = v4.characterPrompts;
    载荷.v4_prompt = v4.v4_prompt;
    载荷.v4_negative_prompt = v4.v4_negative_prompt;
  } else {
    // 旧模型：没有分角色能力，字段存在但为空。
    载荷.characterPrompts = [];
  }

  // Director Reference：覆盖基础载荷里那六个空字段。
  if (输入.参考) Object.assign(载荷, 输入.参考);

  return 载荷;
}

export function 构造V4载荷(输入: {
  正向提示词: string;
  负向提示词: string;
  分角色: NovelAI分角色[];
  使用坐标: boolean;
}): NovelAIV4载荷 {
  const 有效分角色 = 输入.分角色.filter((项) => (项.prompt ?? '').trim());
  const 坐标列表 = 有效分角色.map((项) => (输入.使用坐标 ? (项.coordinates ?? {}) : {}));

  return {
    characterPrompts: 有效分角色.map((项, 索引) => ({
      enabled: true,
      // 上游在分角色分支里把 1girl/1boy 改写成 girl/boy（L84525）。
      prompt: 项.prompt.replace(/1boy/gi, 'boy').replace(/1girl/gi, 'girl'),
      center: 坐标列表[索引],
      uc: 项.uc ?? '',
    })),
    v4_prompt: {
      caption: {
        base_caption: 输入.正向提示词,
        char_captions: 有效分角色.map((项, 索引) => ({
          char_caption: 项.prompt.replace(/1boy/gi, 'boy').replace(/1girl/gi, 'girl'),
          centers: [坐标列表[索引]],
        })),
      },
      use_coords: 输入.使用坐标,
      use_order: true,
    },
    v4_negative_prompt: {
      caption: {
        base_caption: 输入.负向提示词,
        char_captions: 有效分角色.map((项, 索引) => ({
          char_caption: 项.uc ?? '',
          centers: [坐标列表[索引]],
        })),
      },
      legacy_uc: false,
    },
  };
}

/**
 * 把上游的 `Scene Composition:…;Character N Prompt:…|centers:…;` 伪格式解析成分角色数组。
 *
 * 与上游 `parsePromptStringWithCoordinates` L9047-L9081 同源；
 * 这里额外做了「`Character N UC` 归并到同一角色」的收尾，上游是分两步写进同一个 map 的。
 */
export function 解析分角色提示词(提示词: string): NovelAI分角色[] {
  const 文本 = 提示词 ?? '';
  const 结果 = new Map<number, NovelAI分角色>();

  const 提示词正则 = /Character\s+(\d+)\s+Prompt:([\s\S]*?)(?:\s*\|\s*centers:(\{[^}]+\}|[^;\s]+))?\s*;/gi;
  for (const 匹配 of 文本.matchAll(提示词正则)) {
    const 序号 = Number(匹配[1]);
    if (!Number.isFinite(序号)) continue;
    结果.set(序号, {
      prompt: (匹配[2] ?? '').trim(),
      coordinates: 解析NovelAI坐标(匹配[3]),
    });
  }

  const uc正则 = /Character\s+(\d+)\s+UC:([\s\S]*?);/gi;
  for (const 匹配 of 文本.matchAll(uc正则)) {
    const 序号 = Number(匹配[1]);
    const 现有 = 结果.get(序号);
    if (现有) 现有.uc = (匹配[2] ?? '').trim();
  }

  return [...结果.entries()].sort((甲, 乙) => 甲[0] - 乙[0]).map(([, 项]) => 项);
}

/** `Scene Composition:` 段单独取出；上游把它作为 base_caption 的一部分。 */
export function 提取场景构图(提示词: string): string {
  const 匹配 = (提示词 ?? '').match(/Scene Composition:([\s\S]*?);/i);
  return 匹配 ? 匹配[1].trim() : '';
}
