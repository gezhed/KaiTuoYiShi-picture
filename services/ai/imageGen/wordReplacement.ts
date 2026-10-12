/**
 * 词汇替换（NSFW 违禁词用 🥒 等符号替换）。
 *
 * 派生自 st-chatu8（智绘姬）index.js：
 *   `parseWordReplacementRules` L15958-L15988、`applyWordReplacementRules` L15989-L16025、
 *   `getCurrentReplacementRules` L16033-L16054、默认映射表 L2470-L2471 与 L16068-L16073。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：改写为 TypeScript 纯函数；去掉 `word_replacement_profiles` 多预设间接层
 *   （本应用只保留一套映射，直接放在设置里）；保留 `"ai"` 与 `"text"` 两条独立映射。
 *
 * 两个必须保真的行为：
 *   1. 查找串**永远按字面量**处理（先正则转义再全局替换），大小写敏感。
 *   2. 规则按书写顺序依次套用，因此存在子串遮蔽——`小学` 在 `小学生` 之前，
 *      `小学生` 就会变成 `🏬生`。这是来源的既有行为，调换顺序会改变输出。
 */

export interface 词汇替换规则 {
  find: string;
  replace: string;
}

/** 解转义：只有 `\s` `\t` `\n` `\\` 四种。 */
export function 解转义序列(文本: string): string {
  return 文本.replace(/\\([stn\\])/g, (_完整, 字符: string) => {
    if (字符 === 's') return ' ';
    if (字符 === 't') return '\t';
    if (字符 === 'n') return '\n';
    return '\\';
  });
}

function 转义正则字符(文本: string): string {
  return 文本.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 每行 `查找=替换`，在**第一个** `=` 处切分。 */
export function 解析词汇替换规则(规则文本: string): 词汇替换规则[] {
  if (!规则文本 || typeof 规则文本 !== 'string') return [];
  const 规则列表: 词汇替换规则[] = [];
  for (const 行 of 规则文本.split('\n')) {
    const 去回车 = 行.replace(/\r$/, '');
    if (!去回车.trim()) continue;
    const 等号位置 = 去回车.indexOf('=');
    if (等号位置 === -1) continue;
    const find = 解转义序列(去回车.substring(0, 等号位置).trim());
    const replace = 解转义序列(去回车.substring(等号位置 + 1));
    if (!find) continue;
    规则列表.push({ find, replace });
  }
  return 规则列表;
}

export function 应用词汇替换规则(文本: string, 规则列表: 词汇替换规则[]): string {
  if (!文本 || typeof 文本 !== 'string' || 规则列表.length === 0) return 文本;
  let 结果 = 文本;
  for (const 规则 of 规则列表) {
    try {
      结果 = 结果.replace(new RegExp(转义正则字符(规则.find), 'g'), () => 规则.replace);
    } catch {
      // 转义后的字面量不可能让 RegExp 抛错；真抛了也不该让整条链路失败。
    }
  }
  return 结果;
}

/**
 * 去掉 `sāfe&` / `safe&` 安全前缀。
 *
 * 智绘姬系预设在两处要求加这个前缀：出站请模型遵守的「认证」写法，
 * 以及它自己示例里的 `sāfe&masterpiece, sāfe&1girl, …`。前缀本身**不是绘图标签**，
 * 直接送去后端会变成一堆无效 token（还可能被 NovelAI 当成未知权重）。
 *
 * 只删前缀、保留标签本体；`sāfe&(crimson light:1.3)` 这种带权重的写法也按前缀处理。
 * 注意必须与词汇替换规则**互不干扰**：本函数在前缀层面工作，
 * 不参与「小学生 → 🏬生」那类子串遮蔽行为。
 */
export function 剥安全前缀(文本: string): string {
  if (!文本 || typeof 文本 !== 'string') return 文本;
  return 文本
    .replace(/sāfe&/g, '')
    .replace(/safe&/g, '');
}

/**
 * 出站映射：把 `sf_` 之类前缀改写掉，用于绕开上游服务商的过滤器。
 * 默认值逐字来自来源 L2471。
 */
export const 默认出站词汇替换 = 'sf_=\nsafe_=';

export function 应用出站词汇替换(文本: string, 映射文本 = 默认出站词汇替换): string {
  return 应用词汇替换规则(文本, 解析词汇替换规则(映射文本));
}

/**
 * 入站反向还原。
 *
 * 注意必须接收**映射文本**而不是已解析的规则数组：`sf_=` 这种规则的替换值为空串，
 * `解析词汇替换规则` 会把空 find 丢掉，从规则数组反推会得到空 find 的坏规则。
 * 值为空的条目在反向时不还原——原样保留即可，实际语义正是「去掉前缀」。
 */
export function 应用入站反向替换(文本: string, 映射文本 = 默认出站词汇替换): string {
  if (!文本 || typeof 文本 !== 'string') return 文本;
  const 反向 = 解析词汇替换规则(映射文本)
    .filter((规则) => 规则.replace.length > 0)
    .map((规则) => ({ find: 规则.replace, replace: 规则.find }));
  return 应用词汇替换规则(文本, 反向);
}
