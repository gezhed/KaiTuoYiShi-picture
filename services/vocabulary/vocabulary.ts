/**
 * 词库归并、检索与标签串组装。
 *
 * 派生自 st-chatu8（智绘姬）index.js：
 *   `installVocabulary` L6338-L6449（分层/扁平两种形态的判定与落库）、
 *   `getTagsTreeData` L6499-L6547、`searchTags` L6548-L6607、
 *   `getBaseTag` L8988-L9001、`hasWeight` L9002-L9004、`deduplicateTags` L9005-L9038。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-15；
 *   修改目的：上游把词条摊进 IndexedDB 后靠 `openCursor` 全表扫做检索，无索引；
 *   这里改为内存数组 + 预建小写检索键，检索是同序的线性扫描但省掉每键一次 IDB 往返。
 *   另外修掉上游安装/卸载不对称的缺陷：上游安装按**内容**判定是否分层
 *   （L6340 看 tag_groups/tag_tags），卸载却按**文件名**判定（L6452 只看
 *   `fileName === "tags.json"`），导致卸载 `tag_NSFW001.json` 会残留它的分组行。
 *   本实现两条路径都按内容判定。
 */

import type { 词库分组, 词库子分组, 词条, 词库树 } from '@/models/genSystem';

export interface 解析后的词库 {
  分层: boolean;
  分组: 词库分组[];
  子分组: 词库子分组[];
  词条: 词条[];
}

function 读数字(值: unknown, 回退 = 0): number {
  const 解析 = Number(值);
  return Number.isFinite(解析) ? Math.trunc(解析) : 回退;
}

function 读字符串(值: unknown): string {
  return typeof 值 === 'string' ? 值 : '';
}

/**
 * 把一份已解密的词库 JSON 归一成扁平结构。
 *
 * 两种上游形态：
 * - 分层（`tags.json` / `tag_NSFW001.json`）：`tag_groups[].subgroups[]` + `tag_tags[]`；
 * - 扁平（`danbooru_NNN.json`）：`danbooru_tag[]`（也接受顶层直接是数组）。
 *
 * 分层文件里 `tag_groups` 只有一组且没有子分组时，上游会造一个**虚拟子分组**
 * 复用该组的 id 与名字（L6376-L6402），这里照做。
 */
export function 解析词库数据(文件名: string, 数据: unknown): 解析后的词库 {
  const 根 = (数据 ?? {}) as Record<string, unknown>;
  const 分组原始 = Array.isArray(根.tag_groups) ? 根.tag_groups : [];
  const 词条原始 = Array.isArray(根.tag_tags) ? 根.tag_tags : [];
  const 是分层 = 分组原始.length > 0 || 词条原始.length > 0;

  if (!是分层) {
    const 扁平原始 = Array.isArray(根.danbooru_tag) ? 根.danbooru_tag : (Array.isArray(数据) ? 数据 : []);
    const 词条列表: 词条[] = [];
    for (const 项 of 扁平原始) {
      if (!项 || typeof 项 !== 'object') continue;
      const 记录 = 项 as Record<string, unknown>;
      const 名称 = 读字符串(记录.tag) || 读字符串(记录.name);
      if (!名称) continue;
      词条列表.push({
        name: 名称,
        translation: 读字符串(记录.translate) || 读字符串(记录.translation),
        hot: 读数字(记录.hot, 0),
        fileName: 文件名,
      });
    }
    return { 分层: false, 分组: [], 子分组: [], 词条: 词条列表 };
  }

  const 分组: 词库分组[] = [];
  const 子分组: 词库子分组[] = [];
  const 词条列表: 词条[] = [];

  for (const 项 of 分组原始) {
    if (!项 || typeof 项 !== 'object') continue;
    const 记录 = 项 as Record<string, unknown>;
    const 组Id = 读数字(记录.id_index);
    分组.push({
      idIndex: 组Id,
      name: 读字符串(记录.name),
      color: 读字符串(记录.color),
      fileName: 文件名,
    });

    const 子原始 = Array.isArray(记录.subgroups) ? 记录.subgroups : [];
    if (子原始.length === 0) {
      // 单组无子分组：造虚拟子分组，复用组自身的 id 与名字。
      子分组.push({
        idIndex: 组Id,
        groupId: 组Id,
        name: 读字符串(记录.name),
        color: 读字符串(记录.color),
        fileName: 文件名,
      });
      continue;
    }
    for (const 子项 of 子原始) {
      if (!子项 || typeof 子项 !== 'object') continue;
      const 子记录 = 子项 as Record<string, unknown>;
      子分组.push({
        idIndex: 读数字(子记录.id_index),
        groupId: 读数字(子记录.group_id, 组Id),
        name: 读字符串(子记录.name),
        color: 读字符串(子记录.color),
        fileName: 文件名,
      });
    }
  }

  for (const 项 of 词条原始) {
    if (!项 || typeof 项 !== 'object') continue;
    const 记录 = 项 as Record<string, unknown>;
    const 名称 = 读字符串(记录.text) || 读字符串(记录.name);
    if (!名称) continue;
    词条列表.push({
      name: 名称,
      translation: 读字符串(记录.desc) || 读字符串(记录.translation),
      // 分层文件没有热度字段，上游统一写 -1（排序时置顶）。
      hot: 记录.hot === undefined ? -1 : 读数字(记录.hot, -1),
      fileName: 文件名,
      subgroupId: 读数字(记录.subgroup_id) || undefined,
    });
  }

  return { 分层: true, 分组, 子分组, 词条: 词条列表 };
}

/* ------------------------------------------------------------------ *
 * 检索
 * ------------------------------------------------------------------ */

export type 词条排序 = 'hot_desc' | 'hot_asc' | 'key_asc';

export interface 检索选项 {
  /** 只匹配开头（否则任意位置包含）。 */
  startsWith?: boolean;
  limit?: number;
  sortBy?: 词条排序;
}

/** 预建小写检索键后的条目；检索入口只接受这一形态。 */
export interface 检索条目 extends 词条 {
  nameLower: string;
  translationLower: string;
}

/** 预建小写检索键，避免每次检索都对全表做 toLowerCase。 */
export function 建检索索引(词条列表: 词条[]): 检索条目[] {
  return 词条列表.map((词条) => ({
    ...词条,
    nameLower: 词条.name.toLowerCase(),
    translationLower: (词条.translation ?? '').toLowerCase(),
  }));
}

function 排序比较(甲: 检索条目, 乙: 检索条目, 排序: 词条排序): number {
  // 热度为 -1 表示未知，上游把这类排在最前并按字典序互比。
  const 甲未知 = 甲.hot === -1;
  const 乙未知 = 乙.hot === -1;
  if (甲未知 !== 乙未知) return 甲未知 ? -1 : 1;
  if (甲未知 && 乙未知) return 甲.nameLower.localeCompare(乙.nameLower);
  if (排序 === 'key_asc') return 甲.nameLower.localeCompare(乙.nameLower);
  if (排序 === 'hot_asc') return 甲.hot - 乙.hot;
  return 乙.hot - 甲.hot;
}

/**
 * 按关键词检索词条。
 *
 * 命中规则与上游一致：名称或译文任一包含（或前缀匹配）即命中；
 * 按名称去重，先到先得；最后按热度/字典序排序并截断。
 */
export function 检索词条(索引: 检索条目[], 关键词: string, 选项: 检索选项 = {}): 词条[] {
  const 关键词小写 = (关键词 ?? '').trim().toLowerCase();
  if (!关键词小写) return [];
  const { startsWith = false, limit = 100, sortBy = 'hot_desc' } = 选项;

  const 命中 = new Map<string, 检索条目>();
  for (const 条目 of 索引) {
    const 名称命中 = startsWith
      ? 条目.nameLower.startsWith(关键词小写)
      : 条目.nameLower.includes(关键词小写);
    const 译文命中 = 条目.translationLower
      ? (startsWith ? 条目.translationLower.startsWith(关键词小写) : 条目.translationLower.includes(关键词小写))
      : false;
    if (!名称命中 && !译文命中) continue;
    if (!命中.has(条目.nameLower)) 命中.set(条目.nameLower, 条目);
  }

  return [...命中.values()]
    .sort((甲, 乙) => 排序比较(甲, 乙, sortBy))
    .slice(0, Math.max(0, Math.trunc(limit)))
    .map(({ nameLower: _甲, translationLower: _乙, ...词条 }) => 词条);
}

/** 取词库树，供分组浏览；结构对齐上游 `getTagsTreeData`。 */
export function 建词库树(分组: 词库分组[], 子分组: 词库子分组[], 词条列表: 词条[]): 词库树 {
  const 子按组 = new Map<number, 词库子分组[]>();
  for (const 子 of 子分组) {
    const 列表 = 子按组.get(子.groupId);
    if (列表) 列表.push(子);
    else 子按组.set(子.groupId, [子]);
  }
  const 词条按子 = new Map<number, Array<{ text: string; desc: string }>>();
  for (const 词条 of 词条列表) {
    if (词条.subgroupId === undefined) continue;
    const 列表 = 词条按子.get(词条.subgroupId);
    if (列表) 列表.push({ text: 词条.name, desc: 词条.translation });
    else 词条按子.set(词条.subgroupId, [{ text: 词条.name, desc: 词条.translation }]);
  }
  return {
    groups: 分组.map((组) => ({
      ...组,
      subgroups: (子按组.get(组.idIndex) ?? []).map((子) => ({
        ...子,
        tags: 词条按子.get(子.idIndex) ?? [],
      })),
    })),
  };
}

/* ------------------------------------------------------------------ *
 * 标签串组装
 * ------------------------------------------------------------------ */

/** 从词条名里剥掉权重/括号语法，得到比较用的基名。 */
export function 取基名(标签: string): string {
  let 基名 = (标签 ?? '').toLowerCase();
  let 上一轮: string;
  do {
    上一轮 = 基名;
    基名 = 基名
      .replace(/^[([{<]+/, '')
      .replace(/[)\]}>]+$/, '')
      .replace(/^[\d.]+::/, '')
      .replace(/::$/, '')
      .replace(/:(?:\d*\.\d+|\d+)$/, '')
      .trim();
  } while (基名 !== 上一轮);
  return 基名;
}

/** 是否带权重或括号语法。 */
export function 带权重(标签: string): boolean {
  return (标签 ?? '').toLowerCase() !== 取基名(标签);
}

/**
 * 去重标签串：同名标签只留一个，且**优先保留带权重的那一份**。
 *
 * `$…$` 角色触发段先被替换成占位符保护起来，避免段内的逗号把一段切成几段
 * ——上游同样这么做（L9005-L9038）。
 */
export function 去重标签串(标签串: string): string {
  if (!标签串) return '';
  const 受保护: string[] = [];
  const 带占位 = 标签串.replace(/\$[^$]*\$/g, (匹配) => {
    受保护.push(匹配);
    return `\u0000ST${受保护.length - 1}\u0000`;
  });

  const 已选 = new Map<string, string>();
  for (const 原始 of 带占位.split(',')) {
    const 标签 = 原始.trim();
    if (!标签) continue;
    const 基名 = 取基名(标签);
    const 现有 = 已选.get(基名);
    // 带权重的变体一律胜出，与出现顺序无关。
    if (现有 === undefined || (!带权重(现有) && 带权重(标签))) 已选.set(基名, 标签);
  }

  return [...已选.values()]
    .map((标签) => 标签.replace(/\u0000ST(\d+)\u0000/g, (_匹配, 序号: string) => 受保护[Number(序号)] ?? ''))
    .join(', ');
}

/**
 * 把选中的词条拼成标签串。
 *
 * 上游的标签编辑器写入形态是 `名称（译文）`（全角括号，L88627），
 * 但最终发给模型前会被 `剥离中文注释` 去掉括号内容，因此这里保持同一形态。
 */
export function 组装标签串(词条列表: Array<{ name: string; translation?: string }>): string {
  return 去重标签串(
    词条列表
      .map((词条) => {
        const 名称 = (词条.name ?? '').trim();
        if (!名称) return '';
        const 译文 = (词条.translation ?? '').trim();
        return 译文 ? `${名称}（${译文}）` : 名称;
      })
      .filter(Boolean)
      .join(', '),
  );
}

/**
 * 把一段新标签串并进已有文本，去重后以逗号连接。
 *
 * 「并进」而不是「替换」：上部已有内容不能因为追加而被清掉。
 */
export function 追加标签串(原文本: string | undefined, 新增: string | undefined): string {
  return 去重标签串(
    [原文本, 新增]
      .map((项) => (项 ?? '').trim())
      .filter(Boolean)
      .join(', '),
  );
}

/** 上游硬编码的 27 个词库文件名（L93772-L93801）。 */
export const 上游词库文件名: string[] = [
  ...Array.from({ length: 25 }, (_项, 索引) => `danbooru_${String(索引 + 1).padStart(3, '0')}.json`),
  'tags.json',
  'tag_NSFW001.json',
];
