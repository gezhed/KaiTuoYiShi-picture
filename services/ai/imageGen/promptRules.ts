/**
 * 提示词替换规则引擎。
 *
 * 派生自 st-chatu8（智绘姬）index.js：
 *   `splitRuleLine` L9414-L9458、`parseReWrapper` L9407-L9413、
 *   `extractIfCondition` L9297-L9322、`evaluateCondition` L9323-L9397、
 *   `safeEvaluateIf` L9399-L9405、`applyPromptReplaceRules` L9459-L9607、
 *   `zhengmian` L9242-L9271、`fumian` L9272-L9296、`stripChineseAnnotations` L9916-L9925。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：改写为 TypeScript 纯函数；把来源那个「按 mode 返回对象或字符串」的
 *   二态返回值拆成两个函数（`应用替换规则` / `应用分角色替换规则`），消除调用点判型；
 *   六个中文插入键保留原名作为持久化键，绝不重命名（老规则导入后会静默失效）。
 *
 * 规则语法：每行 `触发词=动作|插入词 [@if(条件)]`。
 * 动作有且只有六种：`前置前` `前置后` `后置前` `后置后` `最后置` `替换` `替换分角色`。
 */

export const 插入键列表 = ['前置前', '前置后', '后置前', '后置后', '最后置'] as const;
export type 插入键 = (typeof 插入键列表)[number];

export type 插入桶 = Record<插入键, string>;

export interface 替换规则结果 {
  modifiedPrompt: string;
  insertions: 插入桶;
}

function 建空桶(): Record<插入键, string[]> {
  return { 前置前: [], 前置后: [], 后置前: [], 后置后: [], 最后置: [] };
}

/** `re(…)` 包装识别；内容原样返回，不在此处编译。 */
export function 解析正则包装(值: string): { isRe: boolean; content: string } {
  if (typeof 值 !== 'string') return { isRe: false, content: String(值 ?? '') };
  const 裁剪 = 值.trim();
  const 匹配 = 裁剪.match(/^re\s*\(([\s\S]*)\)$/i);
  if (!匹配) return { isRe: false, content: 值 };
  return { isRe: true, content: 匹配[1] };
}

/**
 * 在**第一个** `=` 处切分。
 *
 * `re(...)` 前缀时先扫到配对的右括号再找 `=`，否则正则里的 `=` 会把规则切断。
 * 扫描同时跟踪 `[...]` 字符组，组内的 `)` 不计深度。
 */
export function 切分规则行(行: string): [string, string] | null {
  if (!行 || typeof 行 !== 'string') return null;
  const 裁剪 = 行.trim();
  if (!裁剪) return null;

  if (/^re\s*\(/i.test(裁剪)) {
    let 深度 = 0;
    let 在字符组 = false;
    let 正则结束 = -1;
    for (let i = 0; i < 裁剪.length; i += 1) {
      const 字符 = 裁剪[i];
      if (字符 === '\\') {
        i += 1;
        continue;
      }
      if (在字符组) {
        if (字符 === ']') 在字符组 = false;
        continue;
      }
      if (字符 === '[') 在字符组 = true;
      else if (字符 === '(') 深度 += 1;
      else if (字符 === ')') {
        深度 -= 1;
        if (深度 === 0) {
          正则结束 = i;
          break;
        }
      }
    }
    if (正则结束 !== -1) {
      const 等号位置 = 裁剪.indexOf('=', 正则结束 + 1);
      if (等号位置 !== -1) {
        return [裁剪.substring(0, 等号位置).trim(), 裁剪.substring(等号位置 + 1).trim()];
      }
    }
  }

  const 首个等号 = 裁剪.indexOf('=');
  if (首个等号 === -1) return null;
  return [裁剪.substring(0, 首个等号).trim(), 裁剪.substring(首个等号 + 1).trim()];
}

/** `值@if(条件)` 拆解：`@if` 必须紧贴在配对的尾部括号之前。 */
export function 提取条件(原始值: string): { value: string; condition: string | null } {
  if (typeof 原始值 !== 'string') return { value: String(原始值 ?? ''), condition: null };
  const 右侧裁剪 = 原始值.replace(/\s+$/, '');
  if (!右侧裁剪.endsWith(')')) return { value: 原始值, condition: null };

  let 深度 = 0;
  let 左括号位置 = -1;
  for (let i = 右侧裁剪.length - 1; i >= 0; i -= 1) {
    const 字符 = 右侧裁剪[i];
    if (字符 === ')') 深度 += 1;
    else if (字符 === '(') {
      深度 -= 1;
      if (深度 === 0) {
        左括号位置 = i;
        break;
      }
    }
  }
  if (左括号位置 <= 0) return { value: 原始值, condition: null };

  const 头部 = 右侧裁剪.substring(0, 左括号位置);
  const 匹配 = 头部.match(/@if\s*$/i);
  if (!匹配) return { value: 原始值, condition: null };

  const 条件 = 右侧裁剪.substring(左括号位置 + 1, 右侧裁剪.length - 1).trim();
  if (!条件) return { value: 原始值, condition: null };

  const 值部分 = 头部.substring(0, 头部.length - 匹配[0].length).replace(/\s+$/, '');
  return { value: 值部分, condition: 条件 };
}

/**
 * 条件求值：手写递归下降解析器，**不使用 eval**。
 *
 * 每个原子都是「干草堆小写化后的子串包含测试」；支持 `||`、`&&`、一元 `!`、
 * 括号与带 `\` 转义的引号原子。解析失败由调用方吞掉并跳过该规则。
 */
export function 求值条件(表达式: string, 干草堆: string): boolean {
  const 源 = String(表达式);
  const 干草 = String(干草堆).toLowerCase();
  let 位置 = 0;

  const 跳空白 = () => {
    while (位置 < 源.length && /\s/.test(源[位置])) 位置 += 1;
  };

  const 解析或 = (): boolean => {
    let 左 = 解析与();
    跳空白();
    while (源.startsWith('||', 位置)) {
      位置 += 2;
      const 右 = 解析与();
      左 = 左 || 右;
      跳空白();
    }
    return 左;
  };

  const 解析与 = (): boolean => {
    let 左 = 解析一元();
    跳空白();
    while (源.startsWith('&&', 位置)) {
      位置 += 2;
      const 右 = 解析一元();
      左 = 左 && 右;
      跳空白();
    }
    return 左;
  };

  const 解析一元 = (): boolean => {
    跳空白();
    if (源[位置] === '!') {
      位置 += 1;
      return !解析一元();
    }
    return 解析原子();
  };

  const 解析原子 = (): boolean => {
    跳空白();
    if (源[位置] === '(') {
      位置 += 1;
      const 值 = 解析或();
      跳空白();
      if (源[位置] === ')') 位置 += 1;
      else throw new Error('@if 表达式缺少右括号');
      return 值;
    }
    if (源[位置] === '"') {
      位置 += 1;
      let 缓冲 = '';
      while (位置 < 源.length && 源[位置] !== '"') {
        if (源[位置] === '\\' && 位置 + 1 < 源.length) {
          缓冲 += 源[位置 + 1];
          位置 += 2;
        } else {
          缓冲 += 源[位置];
          位置 += 1;
        }
      }
      if (源[位置] !== '"') throw new Error('@if 表达式缺少右引号');
      位置 += 1;
      return 干草.includes(缓冲.toLowerCase());
    }

    const 起点 = 位置;
    while (位置 < 源.length) {
      const 字符 = 源[位置];
      if (字符 === '(' || 字符 === ')' || 字符 === '!' || /\s/.test(字符)) break;
      if ((字符 === '&' && 源[位置 + 1] === '&') || (字符 === '|' && 源[位置 + 1] === '|')) break;
      位置 += 1;
    }
    const 单词 = 源.substring(起点, 位置).trim();
    if (!单词) throw new Error('@if 表达式存在空的触发词');
    return 干草.includes(单词.toLowerCase());
  };

  const 结果 = 解析或();
  跳空白();
  if (位置 < 源.length) throw new Error(`@if 表达式存在未解析片段: "${源.substring(位置)}"`);
  return 结果;
}

/** 条件解析失败时跳过该规则而不是让整批规则失效。 */
export function 安全求值条件(条件: string, 干草堆: string): boolean {
  try {
    return 求值条件(条件, 干草堆);
  } catch {
    return false;
  }
}

function 转义正则(文本: string): string {
  return 文本.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function 编译正则(内容: string): RegExp {
  try {
    return new RegExp(内容, 'gi');
  } catch {
    return new RegExp(转义正则(内容), 'gi');
  }
}

/** `$0`/`$&` 为整体匹配，`$N` 为捕获组；未命中的引用原样保留。 */
function 展开反向引用(替换模板: string, 匹配: RegExpMatchArray): string {
  return 替换模板.replace(/\$([0-9]+|&)/g, (完整, 组号: string) => {
    if (组号 === '&' || 组号 === '0') return 匹配[0] ?? '';
    const 索引 = Number.parseInt(组号, 10);
    return 匹配[索引] !== undefined ? 匹配[索引] : 完整;
  });
}

/**
 * 对某个正则的每处匹配做替换。
 *
 * 必须单独重新执行一次带 `g` 的正则，而不是拿 `matchAll` 的迭代结果当
 * `RegExpMatchArray` 用——迭代结果没有 `index`，展开 `$1` 会拿到 undefined。
 * `replace` 的改函数参数天然是完整的匹配数组（含捕获组与 `index`）。
 */
function 正则全局替换(文本: string, 正则: RegExp, 替换工厂: (匹配: RegExpMatchArray) => string): string {
  正则.lastIndex = 0;
  return 文本.replace(正则, (...参数) => 替换工厂(参数 as unknown as RegExpMatchArray));
}

/**
 * 应用替换规则（普通模式）。
 *
 * `第二个参数` 是参与触发与 `@if` 判定的追加上下文（来源里叫 `other_prompt`）。
 * 触发的匹配范围是 `原始提示词 + 第二个参数`，但 `替换` 动作只改写提示词本体。
 */
export function 应用替换规则(
  原始提示词: string,
  规则文本: string,
  第二个参数: string | undefined = '',
): 替换规则结果 {
  const 插入 = 建空桶();
  const 追加上下文 = typeof 第二个参数 === 'string' ? 第二个参数 : '';
  if (!规则文本 || !规则文本.trim()) {
    return { modifiedPrompt: 原始提示词, insertions: 合并插入桶(插入) };
  }

  let 结果 = 原始提示词;
  const 全部文本 = 原始提示词 + 追加上下文;

  for (const 行 of 规则文本.split('\n')) {
    const 切分 = 切分规则行(行);
    if (!切分) continue;
    const [触发部分, 规则内容] = 切分;
    if (!触发部分 || !规则内容 || !规则内容.includes('|')) continue;

    const 竖线位置 = 规则内容.indexOf('|');
    const 动作 = 规则内容.substring(0, 竖线位置).trim();
    const { value: 实际值, condition: 条件 } = 提取条件(规则内容.substring(竖线位置 + 1));

    if (条件 !== null && !安全求值条件(条件, 全部文本)) continue;

    const 触发正则 = 解析正则包装(触发部分);
    const 值正则 = 解析正则包装(实际值);
    const 是插入动作 = (插入键列表 as readonly string[]).includes(动作);

    if (触发正则.isRe) {
      const 正则 = 编译正则(触发正则.content);
      const 全集命中 = [...全部文本.matchAll(正则)].length > 0;
      正则.lastIndex = 0;
      if (!全集命中) continue;

      const 产出 = (匹配: RegExpMatchArray) => (值正则.isRe ? 展开反向引用(值正则.content, 匹配) : 值正则.content);

      if (动作 === '替换') {
        结果 = 正则全局替换(结果, 正则, 产出);
      } else if (是插入动作) {
        for (const 匹配 of 全部文本.matchAll(正则)) {
          const 内容 = 值正则.isRe ? 展开反向引用(值正则.content, 匹配 as unknown as RegExpMatchArray) : 值正则.content;
          if (内容) 插入[动作 as 插入键].push(内容);
        }
      }
      continue;
    }

    const 触发列表 = 触发部分.split('|').map((项) => 项.trim()).filter(Boolean);
    const 小写全集 = 全部文本.toLowerCase();
    for (const 触发词 of 触发列表) {
      if (!小写全集.includes(触发词.toLowerCase())) continue;
      const 触发正则2 = new RegExp(转义正则(触发词), 'gi');
      if (动作 === '替换') {
        结果 = 结果.replace(触发正则2, () => 值正则.content);
      } else if (是插入动作 && 值正则.content) {
        插入[动作 as 插入键].push(值正则.content);
      }
    }
  }

  return { modifiedPrompt: 结果, insertions: 合并插入桶(插入) };
}

/**
 * 应用分角色替换规则。
 *
 * 分角色模式只认 `替换` / `替换分角色`，且匹配范围是**提示词自身**而不是
 * 「提示词 + 上下文」；返回值是裸字符串而不是插入桶。
 */
export function 应用分角色替换规则(原始提示词: string, 规则文本: string): string {
  if (!原始提示词) return 原始提示词;
  if (!规则文本 || !规则文本.trim()) return 原始提示词;

  let 结果 = 原始提示词;
  for (const 行 of 规则文本.split('\n')) {
    const 切分 = 切分规则行(行);
    if (!切分) continue;
    const [触发部分, 规则内容] = 切分;
    if (!触发部分 || !规则内容 || !规则内容.includes('|')) continue;

    const 竖线位置 = 规则内容.indexOf('|');
    const 动作 = 规则内容.substring(0, 竖线位置).trim();
    if (动作 !== '替换' && 动作 !== '替换分角色') continue;
    const { value: 实际值, condition: 条件 } = 提取条件(规则内容.substring(竖线位置 + 1));
    if (条件 !== null && !安全求值条件(条件, 原始提示词)) continue;

    const 触发正则 = 解析正则包装(触发部分);
    const 值正则 = 解析正则包装(实际值);

    if (触发正则.isRe) {
      const 正则 = 编译正则(触发正则.content);
      正则.lastIndex = 0;
      if (!正则.test(结果)) continue;
      正则.lastIndex = 0;
      结果 = 正则全局替换(结果, 正则, (匹配) => (值正则.isRe ? 展开反向引用(值正则.content, 匹配) : 值正则.content));
      continue;
    }

    for (const 触发词 of 触发部分.split('|').map((项) => 项.trim()).filter(Boolean)) {
      if (!结果.toLowerCase().includes(触发词.toLowerCase())) continue;
      结果 = 结果.replace(new RegExp(转义正则(触发词), 'gi'), () => 值正则.content);
    }
  }
  return 结果;
}

function 合并插入桶(桶: Record<插入键, string[]>): 插入桶 {
  return {
    前置前: 桶.前置前.join(', '),
    前置后: 桶.前置后.join(', '),
    后置前: 桶.后置前.join(', '),
    后置后: 桶.后置后.join(', '),
    最后置: 桶.最后置.join(', '),
  };
}

/** 递归剥掉中文圆括号注释；来源用于清理预设里给模型看的说明文字。 */
export function 剥离中文注释(文本: string): string {
  if (!文本) return '';
  let 结果 = 文本;
  let 上一轮: string;
  do {
    上一轮 = 结果;
    结果 = 结果.replace(/（[^（）]*）/g, '');
  } while (结果 !== 上一轮);
  return 结果;
}

/**
 * 正面提示词组装。
 *
 * 九段顺序固定：插入桶与固定片段交错，`aqt` 落在第八位（`最后置` 之前）。
 */
export function 组装正面提示词(
  固定正面: string,
  主体提示词: string,
  结尾片段: string,
  质量词: string,
  插入: 插入桶,
  /**
   * 固定画风（跨预设生效）。
   *
   * 前置放最前、后置放质量词之前：画风锚点在最外侧最稳，
   * 而质量词本身就是收尾性质，画风不该排到它后面。
   * 不传即为空，行为与加这一层之前完全一致。
   */
  固定画风?: { 前置: string; 后置: string },
): string {
  const 片段 = [
    剥离中文注释(固定画风?.前置 ?? ''),
    插入.前置前,
    剥离中文注释(固定正面),
    插入.前置后,
    剥离中文注释(主体提示词),
    插入.后置前,
    剥离中文注释(结尾片段),
    插入.后置后,
    剥离中文注释(固定画风?.后置 ?? ''),
    剥离中文注释(质量词),
    插入.最后置,
  ];
  return 片段.filter((项) => 项 && 项.trim()).join(', ');
}

/** 负面提示词组装：UCP 在前、用户负面在后，并把 `nsfw` 提到最前。 */
export function 组装负面提示词(文本: string, 负面质量词: string, 固定画风负面 = ''): string {
  const 清理后 = 剥离中文注释(文本);
  // 来源只清理用户负面文本、不清理 UCP；但 UCP 预设里带（中文说明）时
  // 原样发送会把说明词变成画面内容，因此两边都清理。
  const 质量清理后 = 剥离中文注释(负面质量词);
  const 画风清理后 = 剥离中文注释(固定画风负面);
  let 结果: string;
  if (清理后 === '') 结果 = 质量清理后;
  else if (质量清理后 === '') 结果 = 清理后;
  else 结果 = `${质量清理后}, ${清理后}`;
  // 固定画风负面并入末尾：它是用户自己加的补充，不该抢在预设负面之前。
  if (画风清理后) 结果 = 结果 ? `${结果}, ${画风清理后}` : 画风清理后;

  if (结果) {
    let 标签 = 结果.split(',').map((项) => 项.trim()).filter(Boolean);
    const 位置 = 标签.findIndex((项) => 项.toLowerCase() === 'nsfw');
    if (位置 !== -1) {
      标签 = 标签.filter((项) => 项.toLowerCase() !== 'nsfw');
      标签.unshift('nsfw');
      结果 = 标签.join(', ');
    }
  }
  return 结果;
}
