/**
 * 占位符替换：派生自 st-chatu8（智绘姬）`replacepro` 与 `PLACEHOLDER_MAP`。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   来源文件 st-chatu8/index.js L46968-L46993（PLACEHOLDER_MAP）、L47103-L47147（replacepro）。
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：把 jQuery/ES5 的字符串替换逻辑改写为 TypeScript 纯函数，并把
 *   「搜索串自带双引号」这一行为显式建模，避免后来者误改成按 class_type 定位节点。
 *
 * 原实现的机制是**对工作流 JSON 文本做盲目 replaceAll**，搜索串包含值两侧的双引号：
 * 因此数值型占位符替换后成为裸 JSON 数字，字符串型成为带引号的 JSON 字符串。
 * 节点与参数的绑定由用户在 JSON 里自行书写 token 决定，不依赖 class_type。
 */

import type { 占位符定义, 占位符取值 } from '@/models/genSystem';

/** 数值型：有限数取 String(n)；否则回退。产出裸 JSON 数字。 */
export function stringifyJsonNumber(value: unknown, fallback?: unknown): string {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return String(parsed);
  const fallbackParsed = Number(fallback);
  return String(Number.isFinite(fallbackParsed) ? fallbackParsed : 0);
}

/** 字符串型：产出带引号且已转义的 JSON 字符串。 */
export function stringifyJsonString(value: unknown): string {
  return JSON.stringify(value === null || value === undefined ? '' : String(value));
}

export const 占位符表: 占位符定义[] = [
  { 占位符: '%seed%', 名称: '种子 (seed)', 匹配键: ['seed'], 类型: 'number' },
  { 占位符: '%steps%', 名称: '步数 (steps)', 匹配键: ['steps'], 类型: 'number' },
  { 占位符: '%cfg_scale%', 名称: 'CFG (cfg)', 匹配键: ['cfg', 'cfg_scale'], 类型: 'number' },
  { 占位符: '%sampler_name%', 名称: '采样器 (sampler)', 匹配键: ['sampler_name', 'sampler'], 类型: 'string' },
  { 占位符: '%scheduler%', 名称: '调度器 (scheduler)', 匹配键: ['scheduler'], 类型: 'string' },
  { 占位符: '%width%', 名称: '宽度 (width)', 匹配键: ['width'], 类型: 'number' },
  { 占位符: '%height%', 名称: '高度 (height)', 匹配键: ['height'], 类型: 'number' },
  { 占位符: '%prompt%', 名称: '正面提示词 (prompt)', 匹配键: ['positive', 'text'], 类型: 'string' },
  { 占位符: '%negative_prompt%', 名称: '负面提示词 (negative)', 匹配键: ['negative'], 类型: 'string' },
  { 占位符: '%MODEL_NAME%', 名称: '模型 (ckpt_name)', 匹配键: ['ckpt_name'], 类型: 'string' },
  { 占位符: '%vae%', 名称: 'VAE', 匹配键: ['vae_name', 'vae'], 类型: 'string' },
  { 占位符: '%clip%', 名称: 'CLIP', 匹配键: ['clip_name'], 类型: 'string' },
  { 占位符: '%c_quanzhong%', 名称: 'IPA权重', 匹配键: ['c_quanzhong'], 类型: 'number' },
  { 占位符: '%c_idquanzhong%', 名称: 'FaceID权重', 匹配键: ['c_idquanzhong'], 类型: 'number' },
  { 占位符: '%c_xijie%', 名称: '细节强度', 匹配键: ['c_xijie'], 类型: 'number' },
  { 占位符: '%c_fenwei%', 名称: '氛围强度', 匹配键: ['c_fenwei'], 类型: 'number' },
  { 占位符: '%comfyuicankaotupian%', 名称: '参考图', 匹配键: ['comfyuicankaotupian', 'image'], 类型: 'string' },
  { 占位符: '%ipa%', 名称: 'IPA类型', 匹配键: ['ipa'], 类型: 'string' },
  { 占位符: '%inpaint_image%', 名称: '重绘原图', 匹配键: ['inpaint_image'], 类型: 'string' },
  { 占位符: '%inpaint_mask%', 名称: '重绘遮罩', 匹配键: ['inpaint_mask'], 类型: 'string' },
  { 占位符: '%inpaint_denoise%', 名称: '重绘强度', 匹配键: ['inpaint_denoise', 'denoise'], 类型: 'number' },
  { 占位符: '%inpaint_positive%', 名称: '重绘正面提示词', 匹配键: ['inpaint_positive'], 类型: 'string' },
  { 占位符: '%inpaint_negative%', 名称: '重绘负面提示词', 匹配键: ['inpaint_negative'], 类型: 'string' },
];

const 数值占位符 = new Set(['%seed%', '%steps%', '%cfg_scale%', '%width%', '%height%', '%c_quanzhong%', '%c_idquanzhong%', '%c_xijie%', '%c_fenwei%', '%inpaint_denoise%']);

/** 按输入键名推荐占位符；仅用于编辑期提示，不参与生成期路由。 */
export function 推荐占位符(输入键名: string): string | null {
  const 小写键名 = 输入键名.toLowerCase();
  for (const 定义 of 占位符表) {
    for (const 键 of 定义.匹配键) {
      if (小写键名 === 键.toLowerCase() || 小写键名.includes(键.toLowerCase())) return 定义.占位符;
    }
  }
  return null;
}

/** token 识别是纯词法的：以 % 开头且以 % 结尾。 */
export function 是占位符值(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('%') && value.endsWith('%') && value.length > 2;
}

/**
 * 把 token 写进工作流 JSON 文本。
 *
 * 顺序与来源一致；23 个 token 互不重叠，因此顺序不影响结果，但保留原顺序便于比对。
 * 搜索串必须包含双引号：写成 `"seed": %seed%`（不带引号）永远不会被替换。
 */
export function 替换工作流占位符(工作流Json: string, 取值: 占位符取值): string {
  let 结果 = 工作流Json;
  const 数字 = (token: string, value: unknown, fallback?: unknown) => {
    结果 = 结果.replaceAll(`"${token}"`, stringifyJsonNumber(value, fallback));
  };
  const 文本 = (token: string, value: unknown) => {
    结果 = 结果.replaceAll(`"${token}"`, stringifyJsonString(value));
  };

  数字('%seed%', 取值.seed);
  数字('%steps%', 取值.steps);
  数字('%cfg_scale%', 取值.cfgScale);
  文本('%sampler_name%', 取值.samplerName);
  数字('%width%', 取值.width);
  数字('%height%', 取值.height);
  文本('%negative_prompt%', 取值.negativePrompt);
  文本('%prompt%', 取值.prompt);
  文本('%MODEL_NAME%', 取值.modelName);
  数字('%c_quanzhong%', 取值.ipaWeight);
  数字('%c_idquanzhong%', 取值.ipaFaceWeight);
  数字('%c_xijie%', 取值.ipaDetailStrength);
  数字('%c_fenwei%', 取值.ipaAtmosphereStrength);
  文本('%comfyuicankaotupian%', 取值.referenceImage);
  文本('%ipa%', 取值.ipaPreset);
  文本('%scheduler%', 取值.scheduler);
  文本('%vae%', 取值.vae);
  文本('%clip%', 取值.clip);
  文本('%inpaint_image%', 取值.inpaintImage ?? '');
  文本('%inpaint_mask%', 取值.inpaintMask ?? '');
  数字('%inpaint_denoise%', 取值.inpaintDenoise || 0.75, 0.75);
  文本('%inpaint_positive%', 取值.inpaintPositive ?? '');
  文本('%inpaint_negative%', 取值.inpaintNegative ?? '');

  return 结果;
}

/** 工作流里仍存在的占位符（用于提交前提示用户漏绑）。 */
export function 扫描剩余占位符(工作流Json: string): string[] {
  const 命中 = new Set<string>();
  for (const 定义 of 占位符表) {
    if (工作流Json.includes(`"${定义.占位符}"`)) 命中.add(定义.占位符);
  }
  return [...命中];
}

export function 是数值占位符(占位符: string): boolean {
  return 数值占位符.has(占位符);
}
