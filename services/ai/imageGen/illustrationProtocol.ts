/**
 * 插图提示词协议解析与锚点匹配。
 *
 * 派生自 st-chatu8（智绘姬）index.js：
 *   `parseImagesFromPrompt` L16700-L16838、`convertNewXmlFormatToOld` L16610-L16699、
 *   `insertImagesIntoElement` 的锚点匹配段 L16840-L17100、`normalizeImagesReply` L16435/L16726。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：改写为 TypeScript 纯函数并剥掉 DOM 操作（原实现在 DOM 元素上边插边改，
 *   偏移量靠 `dataset` 维护）；把「锚点截断到末 40 字符」这条存储规则显式化。
 *
 * 协议**不是 JSON**，是两层文本：
 *
 *   <images>
 *   <image>
 *   regex:<正文里逐字出现的一行，用来决定插在哪一行之后>
 *   image### <提示词> ###
 *   </image>
 *   …
 *   </images>
 *
 * 每张图记录为 `{ regex, tag }`；`regex` 是锚点，`tag` 是带标记的提示词。
 */

/** 流水线原子：一张插图的锚点与提示词标记。 */
export interface 解析插图 {
  regex: string;
  tag: string;
}

export interface 解析插图选项 {
  开始标记: string;
  结束标记: string;
  /** 是否把 `<imgthink>` 内容原样回显进 tag。 */
  回显思考: boolean;
}

export const 默认插图标记: 解析插图选项 = {
  开始标记: 'image###',
  结束标记: '###',
  回显思考: false,
};

function 转义正则(文本: string): string {
  return 文本.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 全角标点归一为半角，并把 `,` 后的空白统一成一个空格。 */
export function 归一化提示词标记(标记: string): string {
  return 标记
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/：/g, ':')
    .replace(/,\s*/g, ', ');
}

function 提取锚点(内容: string): string {
  const 思考匹配 = 内容.match(/<imgthink>([\s\S]*?)<\/imgthink>/);
  if (思考匹配) {
    const 行匹配 = 思考匹配[1].match(/regex:(.*?)(?:\n|$)/);
    if (行匹配) return 行匹配[1].trim();
  }
  const 直接匹配 = 内容.match(/regex:(.*?)(?:\n|$)/);
  return 直接匹配 ? 直接匹配[1].trim() : '';
}

function 提取标记(内容: string, 选项: 解析插图选项): string {
  const 开始 = 转义正则(选项.开始标记);
  const 结束 = 转义正则(选项.结束标记);
  if (!选项.回显思考) {
    const 匹配 = 内容.match(new RegExp(`${开始}([\\s\\S]*?)${结束}`));
    const 纯净 = 匹配 ? 匹配[1].trim() : '';
    return 纯净 ? `${选项.开始标记}${纯净}${选项.结束标记}` : '';
  }
  return 内容.replace(/regex:.*?(?:\n|$)/g, '').trim();
}

/**
 * 新 XML 方言转换为旧 heredoc 方言。
 *
 * 识别 `<size>` `<prompts>` `<scene_composition>` `<character_N>`；`<size>` 只取
 * 逗号分隔的最后一段，并把它**拼进提示词文本**——后端随后用尺寸正则把它剥出来。
 * 多个 `<images>` 块只转换最后一个。
 */
export function 转换新XML方言(文本: string, 选项: 解析插图选项): string {
  const 容器匹配 = [...文本.matchAll(/<images>([\s\S]*?)<\/images>/gi)];
  if (容器匹配.length === 0) return 文本;
  const 内容 = 容器匹配[容器匹配.length - 1][1];

  const 图片块列表 = [...内容.matchAll(/<image>([\s\S]*?)<\/image>/gi)];
  if (图片块列表.length === 0) return 文本;

  const 输出: string[] = ['<images>'];
  for (const 图片块 of 图片块列表) {
    const 内部 = 图片块[1];
    const 锚点匹配 = 内部.match(/<regex>([\s\S]*?)<\/regex>/i);
    const 锚点 = 锚点匹配 ? 锚点匹配[1].trim() : '';

    const 尺寸匹配 = 内部.match(/<size>([\s\S]*?)<\/size>/i);
    let 尺寸 = '';
    if (尺寸匹配) {
      const 分段 = 尺寸匹配[1].trim().replace(/，/g, ',').split(',');
      if (分段.length > 0) 尺寸 = 分段[分段.length - 1].trim();
    }

    const 提示词容器 = 内部.match(/<prompts>([\s\S]*?)<\/prompts>/i);
    const 提示词内部 = 提示词容器 ? 提示词容器[1].trim() : '';

    const 场景匹配 = 内部.match(/<scene_composition>([\s\S]*?)<\/scene_composition>/i);
    let 提示词 = '';
    if (场景匹配) {
      let 场景 = 场景匹配[1].trim();
      if (尺寸) {
        if (场景 && !场景.endsWith(',')) 场景 += ',';
        场景 += 尺寸;
      }
      提示词 = 场景 ? `Scene Composition:${场景};` : '';
      const 角色块列表 = [...内部.matchAll(/<character_(\d+)>([\s\S]*?)<\/character_\1>/gi)];
      for (const 角色块 of 角色块列表) {
        const 序号 = 角色块[1];
        const 块内 = 角色块[2];
        const 角色提示 = 块内.match(/<prompt>([\s\S]*?)<\/prompt>/i);
        const 中心 = 块内.match(/<centers>([\s\S]*?)<\/centers>/i);
        const 负面 = 块内.match(/<uc>([\s\S]*?)<\/uc>/i);
        let 段 = `Character ${序号} Prompt:${角色提示 ? 角色提示[1].trim() : ''}`;
        if (中心) 段 += `|centers:${中心[1].trim()}`;
        if (负面) 段 += `|Character ${序号} UC:${负面[1].trim()}`;
        提示词 += 段;
      }
    } else {
      let 原始 = 提示词内部;
      if (尺寸) {
        if (原始 && !原始.endsWith(',')) 原始 += ',';
        原始 += 尺寸;
      }
      提示词 = 原始;
    }

    输出.push('<image>');
    if (锚点) 输出.push(`regex:${锚点}`);
    if (提示词) {
      const 开始 = 选项.开始标记;
      const 结束 = 选项.结束标记;
      // 已是 heredoc 形状时不要重复加标记。
      const 已带标记 = new RegExp(`^${转义正则(开始)}[\\s\\S]*${转义正则(结束)}$`).test(提示词.trim());
      输出.push(已带标记 ? 提示词 : `${开始}${提示词}${结束}`);
    }
    输出.push('</image>');
  }
  输出.push('</images>');
  return 输出.join('\n');
}

/**
 * 从模型回复里解析出所有插图记录。
 *
 * `入站文本` 应已经过 `"ai"` 词汇替换——这是来源在 `parseImagesFromPrompt` 第一行
 * 就做的事，用来避免生成出的提示词里带违禁词。
 */
export function 解析插图提示词(回复文本: string, 选项: 解析插图选项 = 默认插图标记): 解析插图[] {
  let 文本 = 回复文本 ?? '';
  const 开始 = 转义正则(选项.开始标记);
  const 结束 = 转义正则(选项.结束标记);

  // 没有 heredoc 标记时才尝试新方言，避免把正常输出误转。
  if (/<images>[\s\S]*?<prompts>/i.test(文本) && !new RegExp(`${开始}[\\s\\S]*?${结束}`).test(文本)) {
    文本 = 转换新XML方言(文本, 选项);
  }

  const 容器列表 = [...文本.matchAll(/<images>([\s\S]*?)<\/images>/g)];
  const 搜索文本 = 容器列表.length > 0 ? 容器列表.map((项) => 项[1]).join('\n') : 文本;

  const 记录列表: 解析插图[] = [];
  const 已见 = new Set<string>();
  for (const 图片块 of 搜索文本.matchAll(/<image>([\s\S]*?)<\/image>/g)) {
    const 内部 = 图片块[1];
    const 锚点 = 提取锚点(内部);
    let 标记 = 提取标记(内部, 选项);
    if (!标记) continue;
    标记 = 归一化提示词标记(标记);
    const 去重键 = `${锚点.toLowerCase()}\u0000${标记.toLowerCase()}`;
    if (已见.has(去重键)) continue;
    已见.add(去重键);
    记录列表.push({ regex: 锚点, tag: 标记 });
  }
  return 记录列表;
}

/** 去掉标记外壳，取出纯提示词文本。 */
export function 取出提示词正文(标记: string, 选项: 解析插图选项 = 默认插图标记): string {
  const 匹配 = 标记.match(new RegExp(`${转义正则(选项.开始标记)}([\\s\\S]*?)${转义正则(选项.结束标记)}`));
  return 匹配 ? 匹配[1].trim() : 标记.trim();
}

/** 反向：把纯提示词文本包回标记。 */
export function 包回提示词标记(提示词: string, 选项: 解析插图选项 = 默认插图标记): string {
  return `${选项.开始标记}${归一化提示词标记(提示词)}${选项.结束标记}`;
}

/**
 * 尺寸提取：提示词里形如 `960x1280` 的片段会被剥出来作为本张图的尺寸。
 *
 * 正则与来源一致（L47194 起六处同族）；`自主分辨率` 关闭时只剥不采纳。
 */
export const 尺寸正则 = /,?\s*(\d{2,4})x(\d{2,4})(?=[;\s]|$)/i;
/** Banana 与 NovelAI 重绘用的收紧变体：必须落在末尾。 */
export const 末尾尺寸正则 = /,?\s*(\d{2,4})x(\d{2,4})(?=[;\s]*$)/i;

export interface 尺寸提取结果 {
  提示词: string;
  宽度: number | null;
  高度: number | null;
}

export function 剥出尺寸(文本: string, 自主分辨率 = true, 末位限定 = false): 尺寸提取结果 {
  if (typeof 文本 !== 'string' || !文本) return { 提示词: 文本 ?? '', 宽度: null, 高度: null };
  const 正则 = 末位限定 ? 末尾尺寸正则 : 尺寸正则;
  const 匹配 = 文本.match(正则);
  const 剩余 = 文本.replace(正则, '');
  if (!匹配) return { 提示词: 剩余, 宽度: null, 高度: null };
  if (!自主分辨率) return { 提示词: 剩余, 宽度: null, 高度: null };
  return {
    提示词: 剩余,
    宽度: Number.parseInt(匹配[1], 10),
    高度: Number.parseInt(匹配[2], 10),
  };
}

/* ------------------------------------------------------------------ *
 * 锚点模糊匹配（来源 fuzzyMatchLine + 三个相似度函数，阈值 0.5）
 * ------------------------------------------------------------------ */

function 二元组集合(文本: string): Set<string> {
  const 集合 = new Set<string>();
  for (let i = 0; i < 文本.length - 1; i += 1) 集合.add(文本.substring(i, i + 2));
  return 集合;
}

/** Dice 系数：2|A∩B| / (|A|+|B|)。 */
export function 二元组相似度(甲: string, 乙: string): number {
  if (甲 === 乙) return 1;
  if (!甲 || !乙) return 0;
  const 甲组 = 二元组集合(甲);
  const 乙组 = 二元组集合(乙);
  if (甲组.size === 0 || 乙组.size === 0) return 0;
  let 交集 = 0;
  for (const 项 of 甲组) if (乙组.has(项)) 交集 += 1;
  return (2 * 交集) / (甲组.size + 乙组.size);
}

/** 最长公共子串占较短串的比例。 */
export function 最长公共子串相似度(甲: string, 乙: string): number {
  if (!甲 || !乙) return 0;
  const 短 = 甲.length <= 乙.length ? 甲 : 乙;
  const 长 = 甲.length <= 乙.length ? 乙 : 甲;
  let 最长 = 0;
  const 上一行 = new Array<number>(短.length + 1).fill(0);
  for (let i = 1; i <= 长.length; i += 1) {
    let 左上 = 0;
    for (let j = 1; j <= 短.length; j += 1) {
      const 暂存 = 上一行[j];
      if (长[i - 1] === 短[j - 1]) {
        上一行[j] = 左上 + 1;
        最长 = Math.max(最长, 上一行[j]);
      } else {
        上一行[j] = 0;
      }
      左上 = 暂存;
    }
  }
  return 最长 / 短.length;
}

/** 词级 Jaccard：以空白切词后比较集合。 */
export function 词集合相似度(甲: string, 乙: string): number {
  const 甲集 = new Set(甲.split(/\s+/).filter(Boolean));
  const 乙集 = new Set(乙.split(/\s+/).filter(Boolean));
  if (甲集.size === 0 || 乙集.size === 0) return 0;
  let 交集 = 0;
  for (const 项 of 甲集) if (乙集.has(项)) 交集 += 1;
  const 并集 = 甲集.size + 乙集.size - 交集;
  return 并集 === 0 ? 0 : 交集 / 并集;
}

export function 行相似度(甲: string, 乙: string): number {
  return Math.max(二元组相似度(甲, 乙), 最长公共子串相似度(甲, 乙), 词集合相似度(甲, 乙));
}

export const 锚点匹配阈值 = 0.5;

/**
 * 内联插图文法的识别与剥离放在 `utils/illustrationMarkup`，因为消息层也要用它
 * （发给模型前必须剥掉），若留在本模块会让消息层反向依赖文生图插件。
 * 这里 re-export，使既有调用点不必改导入路径。
 */
export {
  内联插图模式,
  提取内联插图,
  剥掉内联插图,
  取上文最后非空行,
  type 内联插图,
} from '@/utils/illustrationMarkup';

export interface 锚点命中 {
  行索引: number;
  行文本: string;
  相似度: number;
}

/**
 * 在回复正文里找锚点行。
 *
 * 先试逐字包含（多数情况命中），再退到模糊匹配：阈值 0.5，取相似度最高的一行。
 * 只返回行索引，调用方自行换算偏移量。
 */
export function 匹配锚点行(正文行列表: string[], 锚点: string): 锚点命中 | null {
  const 锚点裁剪 = 锚点.trim();
  if (!锚点裁剪) return null;

  for (let i = 0; i < 正文行列表.length; i += 1) {
    if (正文行列表[i].includes(锚点裁剪)) return { 行索引: i, 行文本: 正文行列表[i], 相似度: 1 };
  }

  let 最佳: 锚点命中 | null = null;
  for (let i = 0; i < 正文行列表.length; i += 1) {
    const 得分 = 行相似度(正文行列表[i], 锚点裁剪);
    if (得分 >= 锚点匹配阈值 && (!最佳 || 得分 > 最佳.相似度)) {
      最佳 = { 行索引: i, 行文本: 正文行列表[i], 相似度: 得分 };
    }
  }
  return 最佳;
}

/** 存进记录的锚点只保留末 40 字符。 */
export const 锚点存储长度 = 40;

export function 截断锚点(锚点: string): string {
  const 裁剪 = 锚点.trim();
  return 裁剪.length > 锚点存储长度 ? 裁剪.slice(-锚点存储长度) : 裁剪;
}

/** 需要重新解析时按 (messageId, swipeId) 分组存放；锁定项优先合入。 */
export interface 已存插图 extends 解析插图 {
  locked?: boolean;
}

export function 合并锁定插图(新解析: 已存插图[], 已有: 已存插图[]): 已存插图[] {
  const 锁定项 = 已有.filter((项) => 项.locked);
  if (锁定项.length === 0) return 新解析;
  const 已见 = new Set(新解析.map((项) => `${项.regex.toLowerCase()}\u0000${项.tag.toLowerCase()}`));
  const 补入 = 锁定项.filter((项) => !已见.has(`${项.regex.toLowerCase()}\u0000${项.tag.toLowerCase()}`));
  return [...补入, ...新解析];
}
