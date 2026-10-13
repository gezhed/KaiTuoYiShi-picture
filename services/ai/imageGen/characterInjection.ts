/**
 * 角色 / 服装注入变量与三类列表文本。
 *
 * 派生自 st-chatu8（智绘姬）index.js：
 *   `applyInjectionTemplate` L29201-L29230、`getCharacterPromptData` L29155-L29183、
 *   `getOutfitPromptData` L29184-L29197、`renderCharacterOutfitsText` L29277-L29287、
 *   `getActiveInjectionTemplates` L29264-L29276、`isCharacterTriggered` L29826-L29847、
 *   `getTriggeredCharacterName` L29848-L29869、`generateCharacterListText` L29908-L29958、
 *   `generateOutfitEnableListText` L29959-L29980、`generateCommonCharacterListText` L29981-L30003。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-16；
 *   修改目的：① 改写为 TypeScript 纯函数，设置由参数传入而不是读 `extension_settings` 全局；
 *   ② 上游的服装是独立预设表（`outfitPresets` + `character.outfits` 存 id 数组），
 *      本仓库的服装挂在角色卡上是对象数组，因此服装注入数据直接取自卡片；
 *   ③ 上游 `{outfits}` 只支持角色卡内服装，这里保持同样语义（通用服装走
 *      `generateOutfitEnableListText` 那条独立路径）。
 */

import type {
  角色卡,
  角色启用条目,
  服装条目,
  文生图系统设置,
  注入模板集,
} from '@/models/genSystem';
import { 内置注入模板, 默认注入模板名, 渲染LoRA标签 } from '@/models/genSystem';
import { 归一化触发文本 } from './characterPrompt';

/** 占位符语法 `{变量名}`（上游 `PLACEHOLDER_RE` L29756）。 */
export const 注入占位符模式 = /\{([a-zA-Z0-9_]+)\}/g;

/** 取当前生效的四段模板；预设缺失时回退内置「默认方案」。 */
export function 取当前注入模板(设置: 文生图系统设置): 注入模板集 {
  return 设置.注入模板列表?.[设置.当前注入模板]
    ?? 设置.注入模板列表?.[默认注入模板名]
    ?? 内置注入模板[默认注入模板名];
}

/**
 * 渲染一段注入模板。
 *
 * 关键语义（上游 L29206-L29229，界面上以此宣传「空字段自动省略」）：
 * 一行里只要**有一个**占位符取到非空值，整行保留（其余占位符替换成空串）；
 * 该行所有占位符都为空则整行丢掉；若原本有占位符的行**全部**被丢掉，返回空串。
 * 不含占位符的行原样保留。
 */
export function 应用注入模板(模板: string, 数据: Record<string, string> | undefined): string {
  if (!模板 || typeof 模板 !== 'string') return '';
  const 表 = 数据 ?? {};
  const 结果行: string[] = [];
  let 占位行数 = 0;
  let 保留行数 = 0;
  for (const 原行 of 模板.split(/\r?\n/)) {
    const 命中 = [...原行.matchAll(注入占位符模式)];
    if (命中.length === 0) {
      结果行.push(原行);
      continue;
    }
    占位行数 += 1;
    const 有值 = 命中.some((项) => {
      const 值 = 表[项[1]];
      return 值 !== undefined && 值 !== null && String(值).trim() !== '';
    });
    if (!有值) continue;
    结果行.push(原行.replace(注入占位符模式, (_完整, 键: string) => {
      const 值 = 表[键];
      return 值 !== undefined && 值 !== null ? String(值) : '';
    }));
    保留行数 += 1;
  }
  if (占位行数 > 0 && 保留行数 === 0) return '';
  return 结果行.join('\n');
}

export interface 角色媒体信息 {
  图片媒体Id?: string;
  图片描述?: string;
  音频媒体Id?: string;
  音频描述?: string;
}

/** 角色 → 模板变量表（上游同时提供 `full*` 与 `lower*` 两套别名，字段名陷阱照搬）。 */
export function 取角色注入数据(
  角色: 角色卡,
  服装文本 = '',
  媒体: 角色媒体信息 = {},
): Record<string, string> {
  return {
    nameCN: 角色.nameCN || '',
    // 上游只取第一个英文别名；中文别名可按 `|` 全部出现在 nameCN 里。
    nameEN: (角色.nameEN || '').split('|').at(0)?.trim() ?? '',
    traits: 角色.characterTraits || '',
    facial: 角色.facialFeatures || '',
    facialBack: 角色.facialFeaturesBack || '',
    upperSFW: 角色.upperBodySFW || '',
    upperSFWBack: 角色.upperBodySFWBack || '',
    // 字段名是 fullBody*，界面文案是「下半身」；两套名字都提供。
    fullSFW: 角色.fullBodySFW || '',
    fullSFWBack: 角色.fullBodySFWBack || '',
    lowerSFW: 角色.fullBodySFW || '',
    lowerSFWBack: 角色.fullBodySFWBack || '',
    upperNSFW: 角色.upperBodyNSFW || '',
    upperNSFWBack: 角色.upperBodyNSFWBack || '',
    fullNSFW: 角色.fullBodyNSFW || '',
    fullNSFWBack: 角色.fullBodyNSFWBack || '',
    lowerNSFW: 角色.fullBodyNSFW || '',
    lowerNSFWBack: 角色.fullBodyNSFWBack || '',
    negative: 角色.negative || '',
    outfits: 服装文本 || '',
    imageId: 媒体.图片媒体Id || '',
    imageDesc: 媒体.图片描述 || '',
    audioId: 媒体.音频媒体Id || '',
    audioDesc: 媒体.音频描述 || '',
    /*
     * LoRA：ComfyUI 侧不走文本（由工作流的槽位占位符承接），这里给出文本标签
     * 主要是给 SD / A1111 渠道用 —— 写进注入模板后，被触发的角色才会带上它。
     */
    lora: 渲染LoRA标签(角色.LoRA),
  };
}

/**
 * 服装 → 模板变量表。
 *
 * 本仓库的服装只有 `上半身 / 下半身 / 全身` 三段正文（`全身` 兼作背面视角的替身），
 * 另有两个可选的背面字段；模板要的 `upperBodyBack` / `lowerBodyBack` 优先取背面字段，
 * 都没有时回退到 `全身`，与 `拼装服装替换` 的取法保持一致。
 */
export function 取服装注入数据(服装: 服装条目): Record<string, string> {
  const 背面兜底 = 服装.全身 || '';
  return {
    nameCN: 服装.name || '',
    nameEN: (服装.英文名称 || '').split('|').at(0)?.trim() ?? '',
    归属人: 服装.归属人 || '',
    upperBody: 服装.上半身 || '',
    upperBodyBack: 服装.上半身背面 || 背面兜底,
    fullBody: 服装.下半身 || '',
    fullBodyBack: 服装.下半身背面 || 背面兜底,
    lowerBody: 服装.下半身 || '',
    lowerBodyBack: 服装.下半身背面 || 背面兜底,
  };
}

/** 把角色卡内服装渲染成 `{outfits}` 段落；没有可渲染内容时返回空串。 */
export function 渲染卡内服装文本(角色: 角色卡, 模板: string): string {
  const 服装列表 = 角色.outfits ?? [];
  if (服装列表.length === 0) return '';
  const 块: string[] = [];
  for (const 服装 of 服装列表) {
    const 渲染 = 应用注入模板(模板, 取服装注入数据(服装));
    if (渲染.trim()) 块.push(渲染);
  }
  return 块.length > 0 ? `\n\n${块.join('\n\n')}` : '';
}

/** 上一条命中的别名（上游 `getTriggeredCharacterName`）；未命中返回 null。 */
export function 取触发别名(角色: 角色卡, 触发文本: string): string | null {
  if (!触发文本 || !角色) return null;
  const 归一 = 归一化触发文本(触发文本);
  if (!归一) return null;
  for (const 字段 of [角色.nameCN, 角色.nameEN]) {
    const 别名 = (字段 ?? '').split('|').map((项) => 项.trim()).filter(Boolean);
    for (const 名 of 别名) {
      if (归一.includes(归一化触发文本(名))) return 名;
    }
  }
  return null;
}

/** 纯子串触发判定（上游 `isCharacterTriggered`）。 */
export function 角色是否被触发(角色: 角色卡, 触发文本: string): boolean {
  return 取触发别名(角色, 触发文本) !== null;
}

/** 当前启用预设的条目；预设缺失时回退空列表。 */
export function 取启用条目(设置: 文生图系统设置): 角色启用条目[] {
  return 设置.角色启用预设列表?.[设置.当前启用预设]?.条目 ?? [];
}

/**
 * `{{角色启用列表}}`。
 *
 * `触发文本` 为 `null` 时不做触发过滤（列出全部启用角色）；给了文本则只保留
 * 名字出现在文本里的角色——上游用它把「本轮真正出场的角色」注入提示词。
 */
export function 生成角色列表文本(
  设置: 文生图系统设置,
  触发文本: string | null = null,
): string {
  const 条目列表 = 取启用条目(设置);
  if (条目列表.length === 0) return '（暂无启用的角色）';
  const 模板 = 取当前注入模板(设置);
  const 结果: string[] = [];
  for (const 条目 of 条目列表) {
    const 角色 = 设置.角色卡?.[条目.角色Id];
    if (!角色) continue;
    if (触发文本 !== null && !角色是否被触发(角色, 触发文本)) continue;
    const 服装文本 = 渲染卡内服装文本(角色, 模板.卡内服装);
    const 照片 = (角色.photoMedia ?? []).find((项) => 项.id === (条目.图片媒体Id || 角色.selectedPhotoId))
      ?? (角色.photoMedia ?? [])[0];
    const 音频 = (角色.audioMedia ?? []).find((项) => 项.id === (条目.音频媒体Id || 角色.selectedAudioId))
      ?? (角色.audioMedia ?? [])[0];
    const 渲染 = 应用注入模板(模板.角色列表, 取角色注入数据(角色, 服装文本, {
      图片媒体Id: 条目.图片媒体Id || 照片?.id || '',
      图片描述: 条目.图片描述 || 照片?.name || '',
      音频媒体Id: 条目.音频媒体Id || 音频?.id || '',
      音频描述: 条目.音频描述 || 音频?.name || '',
    }));
    if (渲染.trim()) 结果.push(渲染);
  }
  return 结果.length > 0 ? 结果.join('\n\n') : '（暂无被触发的角色）';
}

/** `{{通用服装启用列表}}`。 */
export function 生成通用服装列表文本(设置: 文生图系统设置): string {
  const 预设 = 设置.通用服装列表?.[设置.当前通用服装列表];
  const 服装Id列表 = 预设?.服装 ?? [];
  if (服装Id列表.length === 0) return '暂未配置通用服装';
  const 模板 = 取当前注入模板(设置);
  const 结果: string[] = [];
  for (const 服装Id of 服装Id列表) {
    const 服装 = 全部服装(设置).find((项) => 项.id === 服装Id);
    if (!服装) continue;
    const 渲染 = 应用注入模板(模板.通用服装列表, 取服装注入数据(服装));
    if (渲染.trim()) 结果.push(渲染);
  }
  return 结果.join('\n\n');
}

/** `{{通用角色启用列表}}`。 */
export function 生成通用角色列表文本(设置: 文生图系统设置): string {
  const 预设 = 设置.通用角色列表?.[设置.当前通用角色列表];
  const 角色Id列表 = 预设?.角色 ?? [];
  if (角色Id列表.length === 0) return '暂未配置通用角色';
  const 模板 = 取当前注入模板(设置);
  const 结果: string[] = [];
  for (const 角色Id of 角色Id列表) {
    const 角色 = 设置.角色卡?.[角色Id];
    if (!角色) continue;
    const 渲染 = 应用注入模板(模板.通用角色列表, 取角色注入数据(角色)).trim();
    if (渲染) 结果.push(渲染);
  }
  return 结果.join('\n');
}

/** 全部角色卡上的服装（按角色顺序展开，同 id 只留第一件）。 */
export function 全部服装(设置: 文生图系统设置): 服装条目[] {
  const 结果: 服装条目[] = [];
  const 已见 = new Set<string>();
  for (const 角色 of Object.values(设置.角色卡 ?? {})) {
    for (const 服装 of 角色.outfits ?? []) {
      if (已见.has(服装.id)) continue;
      已见.add(服装.id);
      结果.push(服装);
    }
  }
  return 结果;
}

/** 三类列表 + 触发命中的整体预览，供设置面板核对，不发任何请求。 */
export interface 注入预览 {
  角色列表: string;
  通用角色列表: string;
  通用服装列表: string;
  命中: Array<{ 角色Id: string; 别名: string }>;
}

export function 生成注入预览(
  设置: 文生图系统设置,
  触发文本: string,
): 注入预览 {
  const 命中: Array<{ 角色Id: string; 别名: string }> = [];
  for (const 条目 of 取启用条目(设置)) {
    const 角色 = 设置.角色卡?.[条目.角色Id];
    if (!角色) continue;
    const 别名 = 取触发别名(角色, 触发文本);
    if (别名) 命中.push({ 角色Id: 条目.角色Id, 别名 });
  }
  return {
    角色列表: 生成角色列表文本(设置, 触发文本),
    通用角色列表: 生成通用角色列表文本(设置),
    通用服装列表: 生成通用服装列表文本(设置),
    命中,
  };
}
