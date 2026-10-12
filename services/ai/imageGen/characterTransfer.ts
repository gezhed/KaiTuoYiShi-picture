/**
 * 角色包导入导出：与上游 st-chatu8 的 `.json` 角色包互通。
 *
 * 派生自 st-chatu8（智绘姬）index.js：
 *   `encryptBase64` / `decryptBase64` L24705-L24722、`encryptObjectFields` L24724-L24740、
 *   `encryptCharacterPreset` L24763-L24781、`decryptCharacterPreset` L24782-L24803、
 *   `encryptOutfitPreset` / `decryptOutfitPreset` L24804-L24822、
 *   `encryptListPreset` / `decryptListPreset` L24823-L24855、
 *   `encryptExportData` L24856-L24958、`decryptImportData` L24960-L25066、
 *   `exportCharacterPreset` L31665-L31746、`exportAllCharacterPresets` L31747-L31836、
 *   `importCharacterPreset` L31837-L31960。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-16；
 *   修改目的：① 把「读文件 → 解析 → 写设置」拆成纯函数 + 注入式媒体读写，
 *   界面与测试都能用；② 上游的角色/服装表以**名字**为键，本仓库以 **id** 为键，
 *   导出时键用 id（记录内保留中英文名），导入时按「同 id → 同名 → 新增」三级合并；
 *   ③ 上游的服装是独立表 + 角色上存 id 数组，本仓库的服装挂在角色卡上是对象数组，
 *   导出时按上游形状摊平成 `outfits` 表 + `outfits: string[]`，导入时再折回卡片，
 *   这样社区角色包可以直接导入；④ 混淆规则逐字照搬（含 `characterTraits` 与
 *   `negative` **不参与混淆**这一历史陷阱），以保证与上游文件互相解得开。
 */

import type { 角色卡, 角色媒体, 角色部位字段, 服装条目, 文生图系统设置 } from '@/models/genSystem';
import { 创建空角色部位字段 } from '@/models/genSystem';
import { 保存角色媒体, 读取角色媒体数据地址, 生成媒体Id } from '@/services/characterMedia';
import { dataUrlToBlob } from '@/utils/albumObjectUrl';

/* ------------------------------------------------------------------ *
 * 混淆（base64 混淆，不是加密；上游 L24705-L24855）
 * ------------------------------------------------------------------ */

/** `btoa(unescape(encodeURIComponent(x)))`，逐字照搬，保证与上游文件互通。 */
export function 混淆Base64(文本: string): string {
  if (!文本) return '';
  try {
    if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(文本)));
    return Buffer.from(文本, 'utf-8').toString('base64');
  } catch {
    return 文本;
  }
}

export function 解混淆Base64(编码: string): string {
  if (!编码) return '';
  try {
    if (typeof atob === 'function') return decodeURIComponent(escape(atob(编码)));
    return Buffer.from(编码, 'base64').toString('utf-8');
  } catch {
    return 编码;
  }
}

/**
 * 参与混淆的角色字段。
 *
 * 注意 `characterTraits` 与 `negative` **不在**这里——上游的加密字段表就没有它们，
 * 于是这两个字段在导出文件里始终是明文。照搬是为了双向互通；
 * 也正因如此，这个功能只是混淆，不能当作保密手段（上游文档同样这么写）。
 */
export const 混淆角色字段: Array<keyof 角色部位字段> = [
  'nameCN', 'nameEN',
  'facialFeatures', 'facialFeaturesBack',
  'upperBodySFW', 'upperBodySFWBack', 'fullBodySFW', 'fullBodySFWBack',
  'upperBodyNSFW', 'upperBodyNSFWBack', 'fullBodyNSFW', 'fullBodyNSFWBack',
];

const 混淆服装字段 = ['name', '英文名称', '上半身', '上半身背面', '下半身', '下半身背面', '全身', '负面'] as const;

/**
 * 上游服装记录的字段名（`encryptOutfitPreset` L24804-L24812）。
 *
 * 本仓库的服装字段是中文名，上游是 `nameCN/upperBody/fullBody/...`；
 * 解混淆时按记录里出现的是哪一套来选字段表——**不能取并集**：
 * 明文随机串里偶尔会有合法的 base64，误当成密文解会把它解坏。
 */
const 上游服装混淆字段 = ['nameCN', 'nameEN', 'owner', 'upperBody', 'upperBodyBack', 'fullBody', 'fullBodyBack'] as const;

/* ------------------------------------------------------------------ *
 * 信封
 * ------------------------------------------------------------------ */

export interface 角色包信封 {
  _format?: 'kaituoyishi-characters';
  _version?: string;
  /** 键是角色 id（上游是角色名）。 */
  characters: Record<string, unknown>;
  /** 上游形状的服装表：键是服装 id，值是服装记录。 */
  outfits?: Record<string, unknown>;
  images?: Record<string, string>;
  audio?: Record<string, string>;
  /** 本仓库附加：这一包导出时处于启用状态的角色 id。 */
  角色启用列表?: string[];
  _encrypted?: boolean;
  _nameMap?: string;
}

/* ------------------------------------------------------------------ *
 * 导出
 * ------------------------------------------------------------------ */

export interface 导出依赖 {
  /** 读一张媒体的 dataURL；不注入时走角色媒体库。 */
  读取媒体?: (媒体Id: string) => Promise<string>;
}

export interface 导出参数 {
  角色列表: 角色卡[];
  /** 一并带上的启用角色 id（写进信封的 `角色启用列表`）。 */
  启用角色Id?: string[];
  含媒体?: boolean;
  混淆?: boolean;
  依赖?: 导出依赖;
}

export interface 导出结果 {
  文本: string;
  角色数: number;
  服装数: number;
  媒体数: number;
  警告: string[];
}

/** 把一张角色卡摊平成导出记录：服装抽到 `outfits` 表，卡上只留 id 数组。 */
function 摊平角色卡(角色: 角色卡): Record<string, unknown> {
  return {
    ...角色,
    outfits: (角色.outfits ?? []).map((服装) => 服装.id),
  };
}

export async function 导出角色包(参数: 导出参数): Promise<导出结果> {
  const 含媒体 = 参数.含媒体 !== false;
  const 读媒体 = 参数.依赖?.读取媒体 ?? 读取角色媒体数据地址;
  const 警告: string[] = [];

  const characters: Record<string, unknown> = {};
  const outfits: Record<string, 服装条目> = {};
  const images: Record<string, string> = {};
  const audio: Record<string, string> = {};

  for (const 角色 of 参数.角色列表) {
    characters[角色.id] = 摊平角色卡(角色);
    for (const 服装 of 角色.outfits ?? []) outfits[服装.id] = 服装;
  }

  let 媒体数 = 0;
  if (含媒体) {
    const 图片Id = new Set<string>();
    const 音频Id = new Set<string>();
    for (const 角色 of 参数.角色列表) {
      for (const 项 of 角色.photoMedia ?? []) 图片Id.add(项.id);
      for (const 项 of 角色.audioMedia ?? []) 音频Id.add(项.id);
    }
    for (const id of 图片Id) {
      try {
        const 地址 = await 读媒体(id);
        if (地址) {
          images[id] = 地址;
          媒体数 += 1;
        } else 警告.push(`图片 ${id} 取不到字节，未随包导出。`);
      } catch (错误) {
        警告.push(`图片 ${id} 读取失败：${错误 instanceof Error ? 错误.message : String(错误)}`);
      }
    }
    for (const id of 音频Id) {
      try {
        const 地址 = await 读媒体(id);
        if (地址) {
          audio[id] = 地址;
          媒体数 += 1;
        } else 警告.push(`音频 ${id} 取不到字节，未随包导出。`);
      } catch (错误) {
        警告.push(`音频 ${id} 读取失败：${错误 instanceof Error ? 错误.message : String(错误)}`);
      }
    }
  }

  let 信封: 角色包信封 = {
    _format: 'kaituoyishi-characters',
    _version: '1.0',
    characters,
    ...(Object.keys(outfits).length > 0 ? { outfits } : {}),
    ...(Object.keys(images).length > 0 ? { images } : {}),
    ...(Object.keys(audio).length > 0 ? { audio } : {}),
    ...(参数.启用角色Id && 参数.启用角色Id.length > 0 ? { 角色启用列表: [...参数.启用角色Id] } : {}),
  };

  if (参数.混淆) 信封 = 混淆信封(信封);

  return {
    文本: JSON.stringify(信封, null, 2),
    角色数: 参数.角色列表.length,
    服装数: Object.keys(outfits).length,
    媒体数,
    警告,
  };
}

/**
 * 混淆信封：键改成 base64，文本字段改成 base64，另存一张 `_nameMap` 反查表。
 *
 * 反查表只覆盖 characters / outfits（本仓库的通用列表与启用列表不参与导出）。
 */
export function 混淆信封(信封: 角色包信封): 角色包信封 {
  const characters: Record<string, unknown> = {};
  const 角色名映射: Record<string, string> = {};
  for (const [id, 记录] of Object.entries(信封.characters)) {
    const 编码Id = 混淆Base64(id);
    角色名映射[编码Id] = id;
    const 源 = { ...(记录 as Record<string, unknown>) };
    for (const 字段 of 混淆角色字段) {
      const 值 = 源[字段];
      if (typeof 值 === 'string' && 值) 源[字段] = 混淆Base64(值);
    }
    if (Array.isArray(源.outfits)) {
      源.outfits = (源.outfits as unknown[]).map((项) => (typeof 项 === 'string' ? 混淆Base64(项) : 项));
    }
    characters[编码Id] = 源;
  }

  const 服装表: Record<string, unknown> = {};
  const 服装名映射: Record<string, string> = {};
  for (const [id, 记录] of Object.entries(信封.outfits ?? {})) {
    const 编码Id = 混淆Base64(id);
    服装名映射[编码Id] = id;
    const 源 = { ...(记录 as Record<string, unknown>) };
    for (const 字段 of 混淆服装字段) {
      const 值 = 源[字段];
      if (typeof 值 === 'string' && 值) 源[字段] = 混淆Base64(值);
    }
    服装表[编码Id] = 源;
  }

  return {
    ...信封,
    characters,
    ...(Object.keys(服装表).length > 0 ? { outfits: 服装表 } : {}),
    _nameMap: 混淆Base64(JSON.stringify({ characters: 角色名映射, outfits: 服装名映射 })),
    _encrypted: true,
    _version: '1.0',
  };
}

/* ------------------------------------------------------------------ *
 * 导入
 * ------------------------------------------------------------------ */

export interface 导入依赖 {
  /** 保存一张媒体，返回新的媒体 id。 */
  保存媒体?: (参数: { 角色Id: string; blob: Blob; name: string; 用途: 角色媒体['用途'] }) => Promise<string>;
}

export interface 导入选项 {
  现有角色: Record<string, 角色卡>;
  /** 新导入角色的 id 前缀，避免与既有 id 撞车（默认 `char_`）。 */
 依赖?: 导入依赖;
}

export interface 导入结果 {
  /** 合并后的完整角色映射（调用方直接 patch 进设置）。 */
  角色卡: Record<string, 角色卡>;
  新增: number;
  覆盖: number;
  服装数: number;
  媒体数: number;
  /** 信封里标记为启用的角色 id（已按合并结果重映射）。 */
  启用角色: string[];
  来源格式: 'kaituoyishi' | 'chatu8' | 'legacy';
  警告: string[];
}

/** 解开混淆（上游 `decryptImportData` L24960-L25066）；未混淆时原样返回。 */
export function 解混淆信封(输入: Record<string, unknown>): Record<string, unknown> {
  if (输入._encrypted !== true) return 输入;
  let 映射表: {
    characters?: Record<string, string>;
    outfits?: Record<string, string>;
  } = {};
  if (typeof 输入._nameMap === 'string') {
    try {
      映射表 = JSON.parse(解混淆Base64(输入._nameMap)) as typeof 映射表;
    } catch {
      映射表 = {};
    }
  }
  const 角色反查 = 映射表.characters ?? {};
  const 服装反查 = 映射表.outfits ?? {};

  const 结果: Record<string, unknown> = { ...输入 };
  delete 结果._encrypted;
  delete 结果._version;
  delete 结果._nameMap;

  const 原角色 = (输入.characters ?? {}) as Record<string, Record<string, unknown>>;
  const characters: Record<string, unknown> = {};
  for (const [编码Id, 记录] of Object.entries(原角色)) {
    const id = 角色反查[编码Id] ?? 编码Id;
    const 源 = { ...记录 };
    for (const 字段 of 混淆角色字段) {
      const 值 = 源[字段];
      if (typeof 值 === 'string') 源[字段] = 解混淆Base64(值);
    }
    if (Array.isArray(源.outfits)) {
      源.outfits = (源.outfits as unknown[]).map((项) => {
        if (typeof 项 !== 'string') return 项;
        const 解 = 解混淆Base64(项);
        return 服装反查[项] ?? 解;
      });
    }
    characters[id] = 源;
  }
  结果.characters = characters;

  if (输入.outfits) {
    const 原服装 = 输入.outfits as Record<string, Record<string, unknown>>;
    const outfits: Record<string, unknown> = {};
    for (const [编码Id, 记录] of Object.entries(原服装)) {
      const id = 服装反查[编码Id] ?? 编码Id;
      const 源 = { ...记录 };
      const 字段表 = '上半身' in 源 ? 混淆服装字段 : 上游服装混淆字段;
      for (const 字段 of 字段表) {
        const 值 = 源[字段];
        if (typeof 值 === 'string') 源[字段] = 解混淆Base64(值);
      }
      outfits[id] = 源;
    }
    结果.outfits = outfits;
  }

  return 结果;
}

function 取值(记录: Record<string, unknown>, ...键列表: string[]): string {
  for (const 键 of 键列表) {
    const 值 = 记录[键];
    if (typeof 值 === 'string') return 值;
    if (typeof 值 === 'number') return String(值);
  }
  return '';
}

/** 上游/本仓库的角色记录 → 本仓库的角色卡。 */
export function 归一化导入角色卡(
  key: string,
  记录: Record<string, unknown>,
  服装表: Record<string, 服装条目>,
  媒体Id映射: Record<string, string>,
  角色Id: string,
): 角色卡 {
  const 部位: 角色部位字段 = {
    ...创建空角色部位字段(),
    nameCN: 取值(记录, 'nameCN', 'name', '中文名称') || key,
    nameEN: 取值(记录, 'nameEN', '英文名称'),
    characterTraits: 取值(记录, 'characterTraits', 'traits', '角色特征'),
    facialFeatures: 取值(记录, 'facialFeatures', 'facial', '五官外貌'),
    facialFeaturesBack: 取值(记录, 'facialFeaturesBack', 'facialBack', '五官外貌背面'),
    upperBodySFW: 取值(记录, 'upperBodySFW', 'upperSFW'),
    upperBodySFWBack: 取值(记录, 'upperBodySFWBack', 'upperSFWBack'),
    fullBodySFW: 取值(记录, 'fullBodySFW', 'fullSFW', 'lowerSFW'),
    fullBodySFWBack: 取值(记录, 'fullBodySFWBack', 'fullSFWBack', 'lowerSFWBack'),
    upperBodyNSFW: 取值(记录, 'upperBodyNSFW', 'upperNSFW'),
    upperBodyNSFWBack: 取值(记录, 'upperBodyNSFWBack', 'upperNSFWBack'),
    fullBodyNSFW: 取值(记录, 'fullBodyNSFW', 'fullNSFW', 'lowerNSFW'),
    fullBodyNSFWBack: 取值(记录, 'fullBodyNSFWBack', 'fullNSFWBack', 'lowerNSFWBack'),
    negative: 取值(记录, 'negative'),
  };

  const 时间 = Date.now();
  const 原服装 = 记录.outfits;
  const 服装列表: 服装条目[] = [];
  if (Array.isArray(原服装)) {
    for (const 项 of 原服装) {
      if (typeof 项 === 'string') {
        const 命中 = 服装表[项];
        if (命中) 服装列表.push(命中);
        continue;
      }
      if (项 && typeof 项 === 'object') {
        const 源 = 项 as Record<string, unknown>;
        const id = 取值(源, 'id') || `outfit_import_${Math.random().toString(36).slice(2, 8)}`;
        服装列表.push(服装表[id] ?? {
          id,
          name: 取值(源, 'name', 'nameCN') || '未命名服装',
          上半身: 取值(源, '上半身', 'upperBody'),
          下半身: 取值(源, '下半身', 'fullBody', 'lowerBody'),
          全身: 取值(源, '全身', 'fullBodyBack'),
          负面: 取值(源, '负面'),
          英文名称: 取值(源, '英文名称', 'nameEN'),
          归属人: 取值(源, '归属人', 'owner'),
          上半身背面: 取值(源, '上半身背面', 'upperBodyBack'),
          下半身背面: 取值(源, '下半身背面', 'lowerBodyBack'),
        });
      }
    }
  }

  const 归一媒体 = (原始: unknown, 用途: 角色媒体['用途']): 角色媒体[] => {
    if (!Array.isArray(原始)) return [];
    const 结果: 角色媒体[] = [];
    for (const 项 of 原始) {
      if (typeof 项 === 'string') {
        const id = 媒体Id映射[项] ?? 项;
        if (id) 结果.push({ id, name: id, 用途 });
        continue;
      }
      if (!项 || typeof 项 !== 'object') continue;
      const 源 = 项 as Record<string, unknown>;
      const 旧Id = 取值(源, 'id');
      const 新Id = 媒体Id映射[旧Id] ?? 旧Id ?? 生成媒体Id();
      结果.push({
        id: 新Id,
        name: 取值(源, 'name', 'fileName', 'filename') || 新Id,
        mimeType: 取值(源, 'mimeType') || undefined,
        用途: (取值(源, '用途') as 角色媒体['用途']) || 用途,
      });
    }
    return 结果;
  };

  return {
    ...部位,
    id: 角色Id,
    enabled: 记录.enabled !== false,
    aliases: Array.isArray(记录.aliases) ? (记录.aliases as unknown[]).map((项) => String(项)) : [],
    outfits: 服装列表,
    selectedOutfitId: 取值(记录, 'selectedOutfitId') || 服装列表[0]?.id || '',
    photoMedia: 归一媒体(记录.photoMedia, 'photo'),
    audioMedia: 归一媒体(记录.audioMedia, 'audio'),
    selectedPhotoId: 媒体Id映射[取值(记录, 'selectedPhotoId')] ?? 取值(记录, 'selectedPhotoId'),
    selectedAudioId: 媒体Id映射[取值(记录, 'selectedAudioId')] ?? 取值(记录, 'selectedAudioId'),
    photoPrompt: 取值(记录, 'photoPrompt'),
    sendPhoto: 记录.sendPhoto === true,
    位置: (记录.位置 as 角色卡['位置']) ?? null,
    createdAt: typeof 记录.createdAt === 'number' ? 记录.createdAt : 时间,
    updatedAt: 时间,
  };
}

/** 服装记录 → 服装条目（接受上游字段名）。 */
export function 归一化导入服装(id: string, 记录: Record<string, unknown>): 服装条目 {
  return {
    id,
    name: 取值(记录, 'name', 'nameCN', '中文名称') || id,
    上半身: 取值(记录, '上半身', 'upperBody'),
    下半身: 取值(记录, '下半身', 'fullBody', 'lowerBody'),
    全身: 取值(记录, '全身') || [取值(记录, '上半身背面', 'upperBodyBack'), 取值(记录, '下半身背面', 'fullBodyBack')].filter(Boolean).join(', '),
    负面: 取值(记录, '负面'),
    英文名称: 取值(记录, '英文名称', 'nameEN'),
    归属人: 取值(记录, '归属人', 'owner'),
    上半身背面: 取值(记录, '上半身背面', 'upperBodyBack'),
    下半身背面: 取值(记录, '下半身背面', 'fullBodyBack', 'lowerBodyBack'),
  };
}

/** 一张卡的全部名称键（中英文名各自按 `|` 切别名，去掉空白与小写）。 */
function 名称键集合(角色: 角色卡): string[] {
  const 键 = new Set<string>();
  for (const 字段 of [角色.nameCN, 角色.nameEN]) {
    for (const 别名 of (字段 ?? '').split('|')) {
      const 归 = 别名.toLowerCase().replace(/\s+/g, '').trim();
      if (归) 键.add(归);
    }
  }
  return [...键];
}

/**
 * 导入一包角色。
 *
 * 合并规则（三级，先命中先算）：同 id → 覆盖该卡；同名字 → 覆盖那张卡（保留其 id）；
 * 都没有 → 新建。媒体字节重新落库并换新 id，绝不与既有媒体撞车（上游 L31897-L31929）。
 */
export async function 导入角色包(文本: string, 选项: 导入选项): Promise<导入结果> {
  const 警告: string[] = [];
  const 现有 = { ...选项.现有角色 };
  const 保存媒体Impl = 选项.依赖?.保存媒体
    ?? (async (参数: { 角色Id: string; blob: Blob; name: string; 用途: 角色媒体['用途'] }) => {
      const 媒体 = await 保存角色媒体({
        角色Id: 参数.角色Id,
        blob: 参数.blob,
        name: 参数.name,
        用途: 参数.用途,
      });
      return 媒体.id;
    });

  let 原始: unknown;
  try {
    原始 = JSON.parse(文本);
  } catch {
    throw new Error('不是合法的 JSON 文件。');
  }
  if (!原始 || typeof 原始 !== 'object' || Array.isArray(原始)) {
    throw new Error('角色包的结构不对：顶层应该是一个对象。');
  }

  let 来源格式: 导入结果['来源格式'] = 'kaituoyishi';
  let 信封: Record<string, unknown>;
  const 顶层 = 原始 as Record<string, unknown>;

  if (顶层.角色卡 && typeof 顶层.角色卡 === 'object') {
    // 本应用 v1 的导出形态：{ 角色卡: Record<id, 角色卡>, 角色启用列表: string[] }
    来源格式 = 'legacy';
    信封 = {
      characters: 顶层.角色卡,
      ...(Array.isArray(顶层.角色启用列表) ? { 角色启用列表: 顶层.角色启用列表 } : {}),
    };
  } else if (顶层._format === 'kaituoyishi-characters') {
    来源格式 = 'kaituoyishi';
    信封 = 解混淆信封(顶层);
  } else if (顶层.characters && typeof 顶层.characters === 'object') {
    来源格式 = 顶层._encrypted === true ? 'chatu8' : (顶层.outfits ? 'chatu8' : 'kaituoyishi');
    信封 = 解混淆信封(顶层);
  } else {
    throw new Error('文件里没有 characters 表，无法识别为角色包。');
  }

  const 媒体Id映射: Record<string, string> = {};
  let 媒体数 = 0;
  const 处理媒体表 = async (表: unknown, 用途: 角色媒体['用途'], 角色Id: string) => {
    if (!表 || typeof 表 !== 'object') return;
    for (const [旧Id, 地址] of Object.entries(表 as Record<string, unknown>)) {
      if (typeof 地址 !== 'string' || !地址) continue;
      const blob = dataUrlToBlob(地址);
      if (!blob) {
        警告.push(`媒体 ${旧Id} 不是 dataURL，已跳过。`);
        continue;
      }
      try {
        媒体Id映射[旧Id] = await 保存媒体Impl({
          角色Id,
          blob,
          name: 旧Id,
          用途,
        });
        媒体数 += 1;
      } catch (错误) {
        警告.push(`媒体 ${旧Id} 落库失败：${错误 instanceof Error ? 错误.message : String(错误)}`);
      }
    }
  };
  await 处理媒体表(信封.images, 'photo', '__import__');
  await 处理媒体表(信封.audio, 'audio', '__import__');

  const 服装表: Record<string, 服装条目> = {};
  for (const [id, 记录] of Object.entries((信封.outfits ?? {}) as Record<string, unknown>)) {
    if (!记录 || typeof 记录 !== 'object') continue;
    服装表[id] = 归一化导入服装(id, 记录 as Record<string, unknown>);
  }

  const 角色表 = (信封.characters ?? {}) as Record<string, unknown>;
  if (Object.keys(角色表).length === 0) throw new Error('角色包里的 characters 是空的。');

  const 现有按名 = new Map<string, string>();
  for (const 角色 of Object.values(现有)) {
    for (const 键 of 名称键集合(角色)) if (!现有按名.has(键)) 现有按名.set(键, 角色.id);
  }

  let 新增 = 0;
  let 覆盖 = 0;
  let 服装数 = 0;
  const 启用角色: string[] = [];
  const 启用源 = Array.isArray(信封.角色启用列表)
    ? (信封.角色启用列表 as unknown[]).map((项) => String(项))
    : [];

  for (const [key, 值] of Object.entries(角色表)) {
    const 记录 = typeof 值 === 'string'
      ? { nameCN: 值 }
      : (值 as Record<string, unknown>);
    if (!记录) continue;

    const 试探 = 归一化导入角色卡(key, 记录, 服装表, 媒体Id映射, `char_import_${key}`);
    // 三级：同 id（键就是本应用的 id）→ 同名 → 新建。
    // 新建时优先沿用文件里的键，这样同一个角色包导入两次是覆盖而不是堆出一串副本。
    const 同名Id = 名称键集合(试探)
      .map((名称键) => 现有按名.get(名称键))
      .find((候选): 候选 is string => Boolean(候选));
    const 记录内id = 取值(记录, 'id').trim();
    const 候选Id = 同名Id
      ?? (记录内id && !现有[记录内id] ? 记录内id : (key || 试探.id));
    const 目标Id = 现有[候选Id] && !同名Id && 候选Id !== key
      ? `${候选Id}_${Math.random().toString(36).slice(2, 6)}`
      : 候选Id;
    if (现有[目标Id]) 覆盖 += 1; else 新增 += 1;

    const 角色卡 = 归一化导入角色卡(key, 记录, 服装表, 媒体Id映射, 目标Id);
    现有[目标Id] = 角色卡;
    for (const 名称键 of 名称键集合(角色卡)) if (!现有按名.has(名称键)) 现有按名.set(名称键, 目标Id);
    服装数 += 角色卡.outfits.length;
    if (启用源.includes(key) || 启用源.includes(目标Id)) 启用角色.push(目标Id);
  }

  return {
    角色卡: 现有,
    新增,
    覆盖,
    服装数,
    媒体数,
    启用角色,
    来源格式,
    警告,
  };
}

/** 便捷：从当前设置里挑出要导出的角色。 */
export function 取导出角色列表(
  设置: 文生图系统设置,
  范围: 'all' | 'enabled' | { id: string },
): 角色卡[] {
  if (范围 === 'all') return Object.values(设置.角色卡);
  if (范围 === 'enabled') {
    return 设置.角色启用列表.map((id) => 设置.角色卡[id]).filter(Boolean);
  }
  const 角色 = 设置.角色卡[范围.id];
  return 角色 ? [角色] : [];
}
