/**
 * 角色提示词替换与名称匹配。
 *
 * 派生自 st-chatu8（智绘姬）index.js：
 *   `processCharacterPrompt` L33416-L33658、`normalizeName` L33134、
 *   `calculateMatchScore` L33137-L33151、`collectCharacterCandidates` L33152-L33191、
 *   `findBestCharacterMatch` L33232-L33280、`findBestOutfitMatch` L33384-L33414、
 *   `isCharacterTriggered` L29826-L29847。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：改写为 TypeScript 纯函数；去掉 `window.collectedCharacterNegatives`
 *   这类进程级全局（并发生图时会互相串味），改为显式返回值；
 *   保留 14 个部位字段的原始命名（`fullBody*` 实际承载下半身），不做事后纠偏。
 */

import type { 角色卡, 角色位置, 角色部位字段, 服装条目 } from '@/models/genSystem';

export type 上下身档位 = 'sfw' | 'nsfw' | 'hidden' | 'visible';

export interface 角色替换格式 {
  upper: 上下身档位;
  lower: 上下身档位;
  fromBehind: boolean;
}

export interface 角色替换结果 {
  /** 替换后的提示词。 */
  提示词: string;
  /** 本次替入的角色负面词，由调用方追加到负面提示词末尾。 */
  角色负面: string;
}

export function 归一化名称(名称: string): string {
  return (名称 ?? '')
    .toLowerCase()
    // 弯引号与重音符号统一成直引号，`O’Brien` 与 `O'Brien` 才能互相匹配。
    .replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 三档打分：完全相等 1000、输入包含预设名 100、预设名包含输入 50。 */
export function 计算匹配分(输入名: string, 预设名: string): number {
  if (!输入名 || !预设名) return 0;
  if (输入名 === 预设名) return 1000 + 预设名.length;
  if (输入名.includes(预设名)) return 100 + 预设名.length;
  if (预设名.includes(输入名)) return 50 + 输入名.length;
  return 0;
}

/** `nameEN` 与 `nameCN` 都按 `|` 切别名。 */
export function 取别名列表(角色: 角色卡): string[] {
  return [角色.nameCN, 角色.nameEN]
    .flatMap((字段) => (字段 ?? '').split('|'))
    .map((别名) => 别名.trim())
    .filter(Boolean);
}

export interface 角色匹配上下文 {
  启用列表: string[];
  全部角色: Record<string, 角色卡>;
}

/**
 * 三段搜索，第一段有结果就返回：启用列表 → （本应用无「常用列表」，跳过）→ 全部角色。
 *
 * 每段内取最高分；完全相等 > 输入包含预设名 > 预设名包含输入。
 */
export function 查找最佳角色(输入名: string, 上下文: 角色匹配上下文): 角色卡 | null {
  const 归一输入 = 归一化名称(输入名);
  if (!归一输入) return null;

  const 打分 = (键列表: string[]) => {
    let 最佳: { 角色: 角色卡; 分数: number } | null = null;
    for (const 键 of 键列表) {
      const 角色 = 上下文.全部角色[键];
      if (!角色) continue;
      for (const 别名 of 取别名列表(角色)) {
        const 分数 = 计算匹配分(归一输入, 归一化名称(别名));
        if (分数 > 0 && (!最佳 || 分数 > 最佳.分数)) 最佳 = { 角色, 分数 };
      }
    }
    return 最佳?.角色 ?? null;
  };

  const 启用命中 = 打分(上下文.启用列表.filter((键) => 上下文.全部角色[键]));
  if (启用命中) return 启用命中;

  return 打分(Object.keys(上下文.全部角色));
}

/** 服装同理，两段搜索：角色的服装列表 → 全部角色里的全部服装。 */
export function 查找最佳服装(输入名: string, 上下文: 角色匹配上下文): 服装条目 | null {
  const 归一输入 = 归一化名称(输入名);
  if (!归一输入) return null;

  const 全部服装: 服装条目[] = [];
  for (const 键 of 上下文.启用列表) {
    const 角色 = 上下文.全部角色[键];
    if (角色) 全部服装.push(...角色.outfits);
  }
  if (全部服装.length === 0) {
    for (const 角色 of Object.values(上下文.全部角色)) 全部服装.push(...角色.outfits);
  }

  let 最佳: { 服装: 服装条目; 分数: number } | null = null;
  for (const 服装 of 全部服装) {
    const 分数 = 计算匹配分(归一输入, 归一化名称(服装.name));
    if (分数 > 0 && (!最佳 || 分数 > 最佳.分数)) 最佳 = { 服装, 分数 };
  }
  return 最佳?.服装 ?? null;
}

const 旧版角色后缀 = [
  '-sfw-upperbody-sfw-lowerbody',
  '-sfw-upperbody-nsfw-lowerbody',
  '-nsfw-upperbody-sfw-lowerbody',
  '-nsfw-upperbody-nsfw-lowerbody',
  '-sfw-upperbody-sfw-fullbody',
  '-sfw-upperbody-nsfw-fullbody',
  '-nsfw-upperbody-sfw-fullbody',
  '-nsfw-upperbody-nsfw-fullbody',
  '-sfw-upperbody',
  '-nsfw-upperbody',
  '-sfw-lowerbody',
  '-nsfw-lowerbody',
];

const 旧版服装后缀 = ['-upperbody-lowerbody', '-upperbody', '-lowerbody'];

interface 解析段 {
  名称: string;
  upper?: 上下身档位;
  lower?: 上下身档位;
  angle?: string;
}

/** 解析 `$…$` 段：先 JSON，再旧版后缀。返回 null 表示无法识别。 */
function 解析角色段(段: string): { 解析: 解析段; 是服装: boolean } | null {
  const 裁剪 = 段.trim();
  if (!裁剪) return null;

  if (裁剪.startsWith('{')) {
    try {
      const 对象 = JSON.parse(裁剪) as Record<string, unknown>;
      const 名称 = typeof 对象.name === 'string' ? 对象.name : '';
      if (!名称) return null;
      const upper = typeof 对象.upperBody === 'string' ? (对象.upperBody as 上下身档位) : undefined;
      const lower = typeof 对象.lowerBody === 'string' ? (对象.lowerBody as 上下身档位) : undefined;
      const angle = typeof 对象.angle === 'string' ? 对象.angle : undefined;
      // `angle` 键的存在与否区分角色与服装。
      return { 解析: { 名称, upper, lower, angle }, 是服装: angle === undefined };
    } catch {
      return null;
    }
  }

  for (const 后缀 of 旧版角色后缀) {
    if (裁剪.toLowerCase().endsWith(后缀)) {
      const 名称 = 裁剪.slice(0, 裁剪.length - 后缀.length);
      if (!名称) continue;
      const 取档 = (标志: string): 上下身档位 | undefined => {
        if (后缀.includes(`-nsfw-${标志}`)) return 'nsfw';
        if (后缀.includes(`-sfw-${标志}`)) return 'sfw';
        return undefined;
      };
      return {
        解析: { 名称, upper: 取档('upperbody'), lower: 取档('lowerbody') ?? 取档('fullbody') },
        是服装: false,
      };
    }
  }

  for (const 后缀 of 旧版服装后缀) {
    if (裁剪.toLowerCase().endsWith(后缀)) {
      const 名称 = 裁剪.slice(0, 裁剪.length - 后缀.length);
      if (!名称) continue;
      return {
        解析: {
          名称,
          upper: 后缀.includes('upperbody') ? 'visible' : undefined,
          lower: 后缀.includes('lowerbody') ? 'visible' : undefined,
        },
        是服装: true,
      };
    }
  }

  return null;
}

function 取字段(角色: 角色卡, 键: keyof 角色部位字段): string {
  return (角色[键] ?? '').trim();
}

/** 角色主体替换：部位按档位与镜头方向拼接，负面词单独返回。 */
export function 拼装角色替换(角色: 角色卡, 格式: 角色替换格式): 角色替换结果 {
  const 片段: string[] = [];
  const 追加 = (值: string) => {
    if (值) 片段.push(值);
  };
  const 背后 = 格式.fromBehind;

  追加(取字段(角色, 'characterTraits'));
  追加(背后 ? 取字段(角色, 'facialFeaturesBack') : 取字段(角色, 'facialFeatures'));

  if (格式.upper === 'sfw') 追加(背后 ? 取字段(角色, 'upperBodySFWBack') : 取字段(角色, 'upperBodySFW'));
  else if (格式.upper === 'nsfw') 追加(背后 ? 取字段(角色, 'upperBodyNSFWBack') : 取字段(角色, 'upperBodyNSFW'));

  // 注意：fullBody* 承载的是下半身（界面文案「下半身」），不是全身。
  if (格式.lower === 'sfw') 追加(背后 ? 取字段(角色, 'fullBodySFWBack') : 取字段(角色, 'fullBodySFW'));
  else if (格式.lower === 'nsfw') 追加(背后 ? 取字段(角色, 'fullBodyNSFWBack') : 取字段(角色, 'fullBodyNSFW'));

  return { 提示词: 片段.join(', '), 角色负面: 取字段(角色, 'negative') };
}

function 拼装服装替换(服装: 服装条目, 格式: 角色替换格式): string {
  const 片段: string[] = [];
  // 背后视角取全身描述，否则上下身分别取；来源的服装表同样只有这三段。
  if (格式.fromBehind) {
    片段.push(服装.全身);
  } else {
    if (格式.upper === 'visible') 片段.push(服装.上半身);
    if (格式.lower === 'visible') 片段.push(服装.下半身);
  }
  return 片段.filter(Boolean).join(', ');
}

/** 尾部清理：换行转换行符、压掉重复逗号、去掉首尾逗号。 */
export function 清理提示词(文本: string): string {
  return 文本
    .replace(/\r?\n/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/,+/g, ',')
    .replace(/^,\s*/, '')
    .replace(/\s*,\s*$/, '')
    .trim();
}

/**
 * 处理 `$…$` 角色触发。
 *
 * 未识别的段原样保留（`$裸名字$` 不会被吞掉），这样作者能看出自己写错了。
 */
export function 处理角色提示词(提示词: string, 上下文: 角色匹配上下文): 角色替换结果 {
  const 归一 = (提示词 ?? '').replace(/\r?\n/g, ', ');
  const 负面集合: string[] = [];

  const 结果 = 归一.replace(/\$([^$]+)\$/g, (完整, 段: string) => {
    const 解析结果 = 解析角色段(段);
    if (!解析结果) return 完整;
    const { 解析, 是服装 } = 解析结果;
    const fromBehind = (解析.angle ?? '').toLowerCase().includes('from behind');

    if (是服装) {
      const 服装 = 查找最佳服装(解析.名称, 上下文);
      if (!服装) return 完整;
      const 拼装 = 拼装服装替换(服装, {
        upper: 解析.upper ?? 'visible',
        lower: 解析.lower ?? 'visible',
        fromBehind,
      });
      return 拼装 || 完整;
    }

    const 角色 = 查找最佳角色(解析.名称, 上下文);
    if (!角色) return 完整;
    const 替换 = 拼装角色替换(角色, {
      upper: 解析.upper ?? 'hidden',
      lower: 解析.lower ?? 'hidden',
      fromBehind,
    });
    if (替换.角色负面) 负面集合.push(替换.角色负面);
    return 替换.提示词 || 完整;
  });

  return { 提示词: 清理提示词(结果), 角色负面: 负面集合.join(', ') };
}

/** 普通化触发文本：去掉所有空白并小写。 */
export function 归一化触发文本(文本: string): string {
  return (文本 ?? '').replace(/[\s\u3000]+/g, '').toLowerCase();
}

/** `$…$` 角色段里解析出的角色，附上它在本段里的替换结果。 */
export interface 出场角色 {
  角色: 角色卡;
  /** 该段替换出的正向提示词。 */
  提示词: string;
  角色负面: string;
  位置: 角色位置 | null;
}

/**
 * 从已组装的提示词里找出所有 `$…$` 角色段并解出角色本体。
 *
 * 用途是 NovelAI 的分角色载荷：`处理角色提示词` 只返回替换后的**文本**，
 * 而 v4 载荷需要「每段提示词 + 该角色的坐标」成对出现，因此必须把角色找回来。
 * 同一角色在一段里出现多次只记一次——NAI 的 char_captions 是按角色排的。
 */
export function 提取出场角色(提示词: string, 上下文: 角色匹配上下文): 出场角色[] {
  const 归一 = (提示词 ?? '').replace(/\r?\n/g, ', ');
  const 结果: 出场角色[] = [];
  const 已见 = new Set<string>();

  归一.replace(/\$([^$]+)\$/g, (完整, 段: string) => {
    const 解析结果 = 解析角色段(段);
    if (!解析结果 || 解析结果.是服装) return 完整;
    const 角色 = 查找最佳角色(解析结果.解析.名称, 上下文);
    if (!角色 || 已见.has(角色.id)) return 完整;
    已见.add(角色.id);
    const fromBehind = (解析结果.解析.angle ?? '').toLowerCase().includes('from behind');
    const 替换 = 拼装角色替换(角色, {
      upper: 解析结果.解析.upper ?? 'hidden',
      lower: 解析结果.解析.lower ?? 'hidden',
      fromBehind,
    });
    结果.push({
      角色,
      提示词: 替换.提示词,
      角色负面: 替换.角色负面,
      位置: 角色.位置 ?? null,
    });
    return 完整;
  });

  return 结果;
}

/**
 * `{{角色启用列表}}` 式触发：纯子串包含，命中可能有很多个。
 *
 * 与 `$…$` 的区别：本方式**要求**角色在启用列表里，而 `$…$` 会回退到全部角色。
 */
export function 命中启用角色(触发文本: string, 上下文: 角色匹配上下文): 角色卡[] {
  const 归一 = 归一化触发文本(触发文本);
  if (!归一) return [];
  const 命中: 角色卡[] = [];
  for (const 键 of 上下文.启用列表) {
    const 角色 = 上下文.全部角色[键];
    if (!角色) continue;
    if (取别名列表(角色).some((别名) => 别名 && 归一.includes(归一化触发文本(别名)))) 命中.push(角色);
  }
  return 命中;
}
