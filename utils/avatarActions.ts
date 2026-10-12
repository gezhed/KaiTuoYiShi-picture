/**
 * 头像 / 立绘槽位挂载。
 *
 * 旧分支的「图库 → 设置到槽位」是相册面板的一部分：先把图片挂到角色的
 * `图像档案.头像槽位` 上，再由各处的 `读取NPC头像` / `解析相册资源引用` 读回来。
 * 新版把相册面板重写成了「视觉资产」工作台，挂载动作整条链路没有被接上
 * （`utils/albumActions.ts` 里的 `挂载NPC头像图片` 等函数还在，但只有测试在调用），
 * 于是头像就只能看、不能改。
 *
 * 本文件负责把那条链路接回来，并适配新的文生图系统：
 *   - `应用图片到槽位`：把相册里任意一张图挂到旅人或 NPC 的头像/立绘槽位；
 *   - `生成并应用头像`：直接走新的 `生成单张插图` 出图，再把结果挂上去；
 *   - `写入活跃叶子`：挂载结果与图片字节立刻落盘。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoyiShi 移植作者；修改日期：2026-10-13；
 *   修改目的：恢复被重写掉的「设置到槽位」链路，并把它接到新的文生图编排上。
 */

import type { 相册系统, 图片槽位 } from '@/models/imageGeneration';
import type { NPC记录, NPC头像槽位 } from '@/models/npc';
import type { 角色数据结构 } from '@/models/character';
import type { 游戏设置 } from '@/models/settings';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { Comfy生成上下文 } from '@/services/ai/imageGen/comfyEngine';
import {
  挂载NPC头像图片,
  挂载NPC立绘图片,
  挂载旅人图片,
  卸载NPC头像图片,
  卸载NPC立绘图片,
  卸载旅人图片,
  创建相册图片条目,
  添加图片到相册,
  创建相册资源引用,
  解析相册资源引用,
} from './albumActions';

/** 挂载来源，与 `albumActions` 里各挂载函数的 `source` 参数同义。 */
export type 挂载来源 = '手动' | '原著' | '文生图' | '占位';
import { 生成单张插图, 重写提示词标记 } from '@/services/ai/imageGen/generateIllustration';
import type { 角色匹配上下文 } from '@/services/ai/imageGen/characterPrompt';
import { getAlbumAssetBlob, dataUrlToBlob, rememberAlbumAssetBlob } from './albumObjectUrl';
import { 暂存待落盘字节 } from './pendingAssetBytes';
import { 写入已落盘资产记录 } from '@/services/storage/saveCrud';
import { writeLeafNode, loadActiveLeaf } from '@/services/storage/saveTree';
import { ensureHeadLeafWritable } from '@/hooks/useGame/saveLoadWorkflow';
import { 读取NPC头像 } from '@/models/npc';
import { devLog, devLogError } from './devLog';

/** 旅人的槽位在模型里叫「头像 / 正文头像 / 手机头像 / 立绘」。 */
export type 旅人槽位 = '头像' | '正文头像' | '手机头像' | '立绘';

export interface 旅人头像目标 {
  kind: 'traveler';
  slot: 旅人槽位;
}

export interface NPC头像目标 {
  kind: 'npc';
  npcId: string;
  slot: NPC头像槽位 | '立绘';
}

export type 头像目标 = 旅人头像目标 | NPC头像目标;

/** 界面上给用户选的槽位项。旅人与 NPC 的身份由 `目标` 决定，`id` 仅用于选择状态。 */
export interface 头像槽位选项 {
  id: string;
  label: string;
  desc: string;
  目标: 头像目标;
  /** 建议出图尺寸；头像方形、立绘竖构图。 */
  尺寸: string;
}

export const 旅人槽位选项: 头像槽位选项[] = [
  { id: 'traveler_profile', label: '档案头像', desc: '旅人档案与左侧边栏', 目标: { kind: 'traveler', slot: '头像' }, 尺寸: '1024x1024' },
  { id: 'traveler_story', label: '正文头像', desc: '剧情气泡', 目标: { kind: 'traveler', slot: '正文头像' }, 尺寸: '1024x1024' },
  { id: 'traveler_phone', label: '手机头像', desc: '小手机短讯名片', 目标: { kind: 'traveler', slot: '手机头像' }, 尺寸: '1024x1024' },
  { id: 'traveler_portrait', label: '角色立绘', desc: '档案大图与角色预览', 目标: { kind: 'traveler', slot: '立绘' }, 尺寸: '1024x1365' },
];

export const NPC槽位选项: 头像槽位选项[] = [
  { id: 'npc_profile', label: '档案头像', desc: '伙伴面板', 目标: { kind: 'npc', npcId: '', slot: '档案' }, 尺寸: '1024x1024' },
  { id: 'npc_story', label: '正文头像', desc: '剧情气泡', 目标: { kind: 'npc', npcId: '', slot: '正文' }, 尺寸: '1024x1024' },
  { id: 'npc_phone', label: '手机头像', desc: '小手机短讯名片', 目标: { kind: 'npc', npcId: '', slot: '手机' }, 尺寸: '1024x1024' },
  { id: 'npc_portrait', label: '角色立绘', desc: '档案大图与角色预览', 目标: { kind: 'npc', npcId: '', slot: '立绘' }, 尺寸: '1024x1365' },
];

/** 把槽位选项绑定到具体 NPC。 */
export function 绑定NPC槽位选项(npcId: string): 头像槽位选项[] {
  return NPC槽位选项.map((选项) => ({
    ...选项,
    目标: { ...(选项.目标 as NPC头像目标), npcId },
  }));
}

export function 目标键(目标: 头像目标): string {
  return 目标.kind === 'traveler' ? `traveler:${目标.slot}` : `npc:${目标.npcId}:${目标.slot}`;
}

/** 读取某个槽位当前挂着的资源引用（`asset:<id>` 或旧式 dataURL / 远程地址）。 */
export function 读取槽位引用(
  目标: 头像目标,
  参数: { traveler?: 角色数据结构; npcs: NPC记录[] },
): string | undefined {
  if (目标.kind === 'traveler') {
    const 档案 = 参数.traveler?.图像档案;
    if (目标.slot === '头像') return 参数.traveler?.头像.trim() || undefined;
    if (目标.slot === '正文头像') return 档案?.正文头像?.trim() || undefined;
    if (目标.slot === '手机头像') return 档案?.手机头像?.trim() || undefined;
    return 档案?.立绘?.trim() || undefined;
  }
  const npc = 参数.npcs.find((项) => 项.id === 目标.npcId);
  if (!npc) return undefined;
  if (目标.slot === '立绘') return npc.图像档案?.立绘?.trim() || undefined;
  return 读取NPC头像(npc, 目标.slot)?.trim() || undefined;
}

export interface 挂载上下文 {
  traveler: 角色数据结构;
  npcs: NPC记录[];
}

/**
 * 纯函数：把一张已归档的图片挂到目标槽位，返回新的旅人与 NPC 列表。
 *
 * 与界面分开是为了能直接测：旧分支的槽位语义（档案头像同时写 `头像`、
 * 正文/手机只写 `头像槽位`）都在 `albumActions` 里，这里只负责选对人。
 */
export function 计算挂载结果(
  上下文: 挂载上下文,
  目标: 头像目标,
  引用: string,
  来源: 挂载来源 = '文生图',
): 挂载上下文 {
  if (目标.kind === 'traveler') {
    return {
      traveler: 挂载旅人图片(上下文.traveler, { slot: 目标.slot, src: 引用 }),
      npcs: 上下文.npcs,
    };
  }
  if (目标.slot === '立绘') {
    return {
      traveler: 上下文.traveler,
      npcs: 挂载NPC立绘图片(上下文.npcs, { npcId: 目标.npcId, src: 引用, source: 来源 }),
    };
  }
  return {
    traveler: 上下文.traveler,
    npcs: 挂载NPC头像图片(上下文.npcs, {
      npcId: 目标.npcId,
      slot: 目标.slot,
      src: 引用,
      source: 来源,
    }),
  };
}

/** 纯函数：卸下目标槽位（回落到内置/占位头像）。 */
export function 计算卸载结果(上下文: 挂载上下文, 目标: 头像目标): 挂载上下文 {
  if (目标.kind === 'traveler') {
    return { traveler: 卸载旅人图片(上下文.traveler, { slot: 目标.slot }), npcs: 上下文.npcs };
  }
  if (目标.slot === '立绘') {
    return { traveler: 上下文.traveler, npcs: 卸载NPC立绘图片(上下文.npcs, { npcId: 目标.npcId }) };
  }
  return {
    traveler: 上下文.traveler,
    npcs: 卸载NPC头像图片(上下文.npcs, { npcId: 目标.npcId, slot: 目标.slot }),
  };
}

export interface 待落盘条目 {
  asset: { id: string; mimeType?: string; width?: number; height?: number; size?: number };
}

/** 把归档条目里的图片字节直接写进资产库（与 `illustrationWorkflow.落盘归档资产` 同口径）。 */
export async function 落盘条目字节(条目列表: 待落盘条目[]): Promise<number> {
  const 记录列表: import('@/utils/saveAssetStorage').SaveAssetRecord[] = [];
  for (const 条目 of 条目列表) {
    const blob = getAlbumAssetBlob(条目.asset.id);
    if (!blob) continue;
    记录列表.push({
      id: 条目.asset.id,
      blob,
      mimeType: 条目.asset.mimeType || blob.type || 'image/png',
      width: 条目.asset.width,
      height: 条目.asset.height,
      size: 条目.asset.size || blob.size,
      updatedAt: Date.now(),
    });
  }
  if (记录列表.length === 0) return 0;
  try {
    await 写入已落盘资产记录(记录列表);
  } catch (错误) {
    devLogError('save', 'avatar-asset-write-failed', 错误);
    return 0;
  }
  return 记录列表.length;
}

/**
 * 写入活跃叶子。
 *
 * **必须先回读当前叶子再合并**：挂载头像发生在回合之外，而回合内的并发写入
 * （变量结算、记忆压缩）可能已经改过同一片叶子。只写自己改的字段，
 * 就不会像当初的插图落盘那样把别人的改动顶掉。
 */
async function 写入活跃叶子(
  state: UseGameStateReturn,
  改动: { traveler?: 角色数据结构; npcs?: NPC记录[]; 相册?: 相册系统 },
): Promise<{ 成功: boolean; 原因?: string }> {
  try {
    const newest = await ensureHeadLeafWritable(state);
    if (!newest.headNodeId) return { 成功: false, 原因: '活跃叶子指针为空，本次没有落盘。' };
    const 当前 = await loadActiveLeaf();
    const 叶子 = 当前.status === 'ok' ? 当前.leaf : undefined;
    const patch: Partial<import('@/models/newestStory').工作区字段集> = {};
    if (改动.traveler) patch.旅人 = 改动.traveler;
    if (改动.npcs) patch.NPC = 改动.npcs;
    if (改动.相册 || 叶子?.相册) patch.相册 = 改动.相册 ?? 叶子?.相册;
    if (Object.keys(patch).length === 0) return { 成功: true };
    await writeLeafNode(newest.headNodeId, patch);
    devLog('save', 'avatar-leaf-write', { nodeId: newest.headNodeId, fields: Object.keys(patch) });
    return { 成功: true };
  } catch (错误) {
    devLogError('save', 'avatar-leaf-write-failed', 错误);
    return { 成功: false, 原因: 错误 instanceof Error ? 错误.message : String(错误) };
  }
}

export interface 应用图片结果 {
  成功: boolean;
  消息: string;
  traveler?: 角色数据结构;
  npcs?: NPC记录[];
}

/**
 * 把相册里的一张图挂到目标槽位，并立刻落盘。
 *
 * `新增条目` 是本次为挂载新建的相册条目（已有图片挂到第二个槽位时是空的，
 * 因为字节早在相册里）。传进来是为了把字节写进资产库。
 */
export async function 应用图片到槽位(
  state: UseGameStateReturn,
  目标: 头像目标,
  引用: string,
  参数?: { 来源?: 挂载来源; 新增条目?: 待落盘条目[]; 相册?: 相册系统 },
): Promise<应用图片结果> {
  const 上下文: 挂载上下文 = { traveler: state.旅人, npcs: state.NPC };
  const 下一个 = 计算挂载结果(上下文, 目标, 引用, 参数?.来源 ?? '文生图');
  state.set旅人(下一个.traveler);
  state.setNPC(下一个.npcs);

  if (参数?.新增条目?.length) await 落盘条目字节(参数.新增条目);
  const 落盘 = await 写入活跃叶子(state, {
    traveler: 下一个.traveler,
    npcs: 下一个.npcs,
    相册: 参数?.相册,
  });

  return {
    成功: true,
    消息: 落盘.成功 ? '已设置并保存。' : `已设置，但保存失败：${落盘.原因 ?? '未知原因'}`,
    traveler: 下一个.traveler,
    npcs: 下一个.npcs,
  };
}

export interface 卸载图片结果 {
  成功: boolean;
  消息: string;
}

/**
 * 把相册本身（不涉及槽位）写进活跃叶子。
 *
 * 图库的导入、批量删除都发生在回合之外，没有提交点；不写这一下，
 * 界面当场能看到结果，重进存档就全没了。
 */
export async function 写入相册设定(
  state: UseGameStateReturn,
  相册: 相册系统,
): Promise<{ 成功: boolean; 原因?: string }> {
  state.set相册(相册);
  return 写入活跃叶子(state, { 相册 });
}

export async function 卸载槽位图片(state: UseGameStateReturn, 目标: 头像目标): Promise<卸载图片结果> {
  const 上下文: 挂载上下文 = { traveler: state.旅人, npcs: state.NPC };
  const 下一个 = 计算卸载结果(上下文, 目标);
  state.set旅人(下一个.traveler);
  state.setNPC(下一个.npcs);
  const 落盘 = await 写入活跃叶子(state, { traveler: 下一个.traveler, npcs: 下一个.npcs });
  return { 成功: true, 消息: 落盘.成功 ? '已清空该槽位并保存。' : `已清空，但保存失败：${落盘.原因 ?? '未知原因'}` };
}

/** 把一段文本提示词包成插图标记；新系统统一用 `image###…###`。 */
export function 组装头像提示词(提示词: string): string {
  const 正文 = 提示词.trim();
  return 重写提示词标记(正文);
}

/**
 * 摘要文案：把角色已知的外貌/穿着/提示词拼成一段默认提示词。
 *
 * 与旧分支的 `buildNpcSourceText` 等效但更短：这里只给一个能直接出图的起点，
 * 用户仍可在编辑器里改。
 */
export function 建议头像提示词(参数: {
  目标: 头像目标;
  traveler?: 角色数据结构;
  npcs: NPC记录[];
}): string {
  const { 目标 } = 参数;
  if (目标.kind === 'traveler') {
    const 旅人 = 参数.traveler;
    return [旅人?.姓名, 旅人?.外貌, 旅人?.性格].filter(Boolean).join('，');
  }
  const npc = 参数.npcs.find((项) => 项.id === 目标.npcId);
  if (!npc) return '';
  return [
    npc.姓名,
    npc.外貌,
    npc.穿着,
    npc.装备摘要,
    npc.图像档案?.头像提示词,
    npc.图像档案?.立绘提示词,
  ].filter(Boolean).join('，');
}

export interface 生成并应用参数 {
  提示词: string;
  目标: 头像目标;
  尺寸: { 宽度: number; 高度: number };
  signal?: AbortSignal;
}

export interface 生成并应用结果 {
  成功: boolean;
  消息: string;
  相册?: 相册系统;
  条目?: { asset: import('@/models/imageGeneration').图片资源; entry: import('@/models/imageGeneration').相册条目 };
}

function 组装角色上下文(设置: 游戏设置): 角色匹配上下文 {
  const 系统 = 设置.文生图系统;
  return { 启用列表: 系统.角色启用列表, 全部角色: 系统.角色卡 };
}

/**
 * 直接出图并挂到槽位：一次调用同时完成「生成 → 归档 → 挂载 → 落盘」。
 *
 * `上下文` 是 ComfyUI 的进度回调入口，界面用它显示队列位置。
 */
export async function 生成并应用头像(
  state: UseGameStateReturn,
  参数: 生成并应用参数,
  上下文?: Comfy生成上下文,
): Promise<生成并应用结果> {
  const 设置 = state.deviceSettings.gameSettings;
  const 系统 = 设置.文生图系统;
  if (!参数.提示词.trim()) return { 成功: false, 消息: '提示词为空。' };

  const 结果 = await 生成单张插图(
    系统,
    {
      提示词标记: 组装头像提示词(参数.提示词),
      覆盖尺寸: 参数.尺寸,
      标题: `${参数.目标.kind === 'traveler' ? '旅人' : '伙伴'}头像`,
      signal: 参数.signal,
    },
    组装角色上下文(设置),
    上下文,
  );

  const 槽位: 图片槽位 = 参数.目标.kind === 'traveler'
    ? (参数.目标.slot === '立绘' ? 'portrait'
      : 参数.目标.slot === '正文头像' ? 'avatar_story'
        : 参数.目标.slot === '手机头像' ? 'avatar_phone' : 'avatar_profile')
    : (参数.目标.slot === '立绘' ? 'portrait'
      : 参数.目标.slot === '正文' ? 'avatar_story'
        : 参数.目标.slot === '手机' ? 'avatar_phone' : 'avatar_profile');

  const 条目 = 创建相册图片条目({
    title: `${参数.目标.kind === 'traveler' ? '旅人' : '伙伴'} · ${参数.目标.slot}`,
    src: 结果.结果.数据地址,
    source: 'generated',
    targetType: 参数.目标.kind === 'traveler' ? 'traveler' : 'npc',
    targetId: 参数.目标.kind === 'traveler' ? 'traveler' : 参数.目标.npcId,
    slot: 槽位,
    prompt: 结果.正向提示词,
    negativePrompt: 结果.负向提示词,
    finalPrompt: 结果.正向提示词,
    finalNegativePrompt: 结果.负向提示词,
    dimensions: `${结果.结果.宽度}x${结果.结果.高度}`,
    model: 结果.结果.模型,
    backend: 系统.渠道,
    tags: ['头像'],
  });

  // 立刻把字节抓在手里：展示缓存随时可能被回收，而落盘要走异步写入。
  const 字节 = getAlbumAssetBlob(条目.asset.id) ?? dataUrlToBlob(结果.结果.数据地址) ?? undefined;
  if (字节) {
    rememberAlbumAssetBlob(条目.asset.id, 字节, 条目.asset.mimeType || 字节.type);
    暂存待落盘字节(条目.asset.id, 字节);
  }

  const 相册 = 添加图片到相册(state.相册, 条目);
  state.set相册(相册);

  const 结果应用 = await 应用图片到槽位(state, 参数.目标, 创建相册资源引用(条目.asset.id), {
    来源: '文生图',
    新增条目: [条目],
    相册,
  });

  return {
    成功: true,
    消息: `生成完成（${结果.结果.宽度}x${结果.结果.高度}）· ${结果应用.消息}`,
    相册,
    条目,
  };
}

/** 未挂载时给界面一个稳定的空值，避免 `undefined` 到处传。 */
export const 空槽位引用 = '';

/** 把槽位引用解析成可渲染地址。 */
export function 解析槽位地址(相册: 相册系统 | undefined, 引用: string | undefined): string | undefined {
  return 解析相册资源引用(相册, 引用);
}

/**
 * 图库里的槽位 key → 挂载目标。
 *
 * 图库按「角色记录 + 槽位 key」组织，挂载函数按「旅人/NPC + 槽位名」组织，
 * 这里做一次显式映射，免得同一串 key 在两边各自解释。
 */
export function 槽位键转目标(角色Id: string, 槽位键: string): 头像目标 {
  if (角色Id === 'traveler') {
    const 旅人映射: Record<string, 旅人槽位> = {
      'avatar-profile': '头像',
      'traveler-avatar-profile': '头像',
      'avatar-story': '正文头像',
      'traveler-avatar-story': '正文头像',
      'avatar-phone': '手机头像',
      'traveler-avatar-phone': '手机头像',
      portrait: '立绘',
      'traveler-portrait': '立绘',
    };
    return { kind: 'traveler', slot: 旅人映射[槽位键] ?? '头像' };
  }
  const npc映射: Record<string, NPC头像目标['slot']> = {
    'avatar-profile': '档案',
    'avatar-story': '正文',
    'avatar-phone': '手机',
    portrait: '立绘',
  };
  return { kind: 'npc', npcId: 角色Id, slot: npc映射[槽位键] ?? '档案' };
}
