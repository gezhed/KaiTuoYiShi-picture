/**
 * 生图编排：把「一张插图的提示词标记」变成一次后端出图 + 一条缓存条目。
 *
 * 派生自 st-chatu8（智绘姬）`generateComfyUIImage` 的提示词段（index.js L47215-L47348）
 * 与 `comfyuigenerate` 的落库段（L47706-L47760）。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：把提示词组装、角色替换、后端调用、缓存落库串成一条显式管线；
 *   来源把这些步骤和内联在 558 行的单函数里，并依赖 `window.*` 传值；
 *   这里全部改成显式参数与返回值，使单张图可独立重试、可并发。
 *
 * 单张图的完整顺序（与来源一致）：
 *   1. 从标记里取出提示词正文
 *   2. 剥出 `WxH` 尺寸（仅当自主分辨率开启）
 *   3. 角色 `$…$` 替换
 *   4. 提示词替换规则（含插入桶）
 *   5. 正面组装（固定词 + 主体 + 结尾 + 质量词 + 插入）
 *   6. 负面组装（UCP + 用户负面 + 角色负面），nsfw 提到最前
 *   7. 提交 ComfyUI
 *   8. 落图片缓存（键为提示词原文 MD5）
 */

import type { 生成参数快照, 文生图系统设置 } from '@/models/genSystem';
import type { Comfy生成上下文 } from './comfyEngine';
import { 生成ComfyUI图片 } from './comfyEngine';
import { 处理角色提示词, 提取出场角色, type 角色匹配上下文 } from './characterPrompt';
import {
  应用替换规则,
  应用分角色替换规则,
  组装正面提示词,
  组装负面提示词,
} from './promptRules';
import { 剥出尺寸, 包回提示词标记, 取出提示词正文, 默认插图标记 } from './illustrationProtocol';
import { 剥安全前缀 } from './wordReplacement';
import { 追加缓存图片 } from '@/services/imageCache';
import { 生成随机种子 } from './comfyEngine';
import { 构造NovelAI载荷, 解析分角色提示词, type NovelAI分角色 } from './novelaiPayload';
import { 请求NovelAI图片 } from './novelaiClient';
import {
  参考组可用,
  归一化参考强度,
  构造参考载荷,
  截断参考,
  缩放参考图,
} from './novelaiReference';
import { 取Vibe条目, 解析Vibe条目数据, 构造Vibe载荷 } from './novelaiVibe';
import { 读取角色媒体数据地址 } from '@/services/characterMedia';
import { devLog, devLogError } from '@/utils/devLog';
import { 构造SD载荷, 请求SD图片 } from './sdClient';
import { 构造Banana载荷, 请求Banana图片 } from './bananaClient';
import type { 生成结果 } from './types';
import { blob转数据地址 } from '@/utils/blobEncoding';
import { dataUrlToBlob } from '@/utils/albumObjectUrl';

export interface 出图请求 {
  /** 插图记录里的提示词标记（含标记外壳）。 */
  提示词标记: string;
  /** 已经由外部指定的尺寸；给出时不再从提示词里剥。 */
  覆盖尺寸?: { 宽度: number; 高度: number } | null;
  /** 是否写入图片缓存。 */
  写缓存?: boolean;
  /** 关卡显示用的标题。 */
  标题?: string;
  /**
   * 参考图。数据地址会被 ComfyUI 引擎上传一次并缓存文件名，
   * 再由 `%comfyuicankaotupian%` 占位符写进工作流。
   */
  参考图?: { 数据地址: string; 文件名: string } | null;
  signal?: AbortSignal;
}

export interface 出图结果 {
  结果: 生成结果;
  /** 写给界面与缓存的最终提示词。 */
  正向提示词: string;
  负向提示词: string;
  生成参数: 生成参数快照;
}

/**
 * 取「剥掉标记外壳、剥掉尺寸」之后、角色替换**之前**的主体文本。
 *
 * 单独提出来是因为 NovelAI 的分角色与位置都要在这一步的文本上工作：
 * 一旦 `$…$` 被替换成部位字段，就再也认不出出场的是哪个角色了。
 * 这里与 `组装单图提示词` 内部的顺序保持一致（先剥外壳、再剥尺寸）。
 */
function 取原始主体(
  设置: 文生图系统设置,
  提示词标记: string,
  覆盖尺寸?: { 宽度: number; 高度: number } | null,
): string {
  const 正文 = 取出提示词正文(提示词标记, 默认插图标记);
  return 覆盖尺寸
    ? 正文
    : 剥出尺寸(正文, 设置.comfyui.自主分辨率).提示词;
}

/** 取出本次要用的固定提示词预设；随机预设开启时按 key 均匀抽一个。 */
export function 取提示词预设(设置: 文生图系统设置): { 名称: string; 预设: 文生图系统设置['提示词']['预设列表'][string] } {
  const 列表 = 设置.提示词.预设列表;
  const 键列表 = Object.keys(列表);
  if (键列表.length === 0) throw new Error('固定提示词预设未配置。');
  const 名称 = 设置.提示词.随机预设
    ? 键列表[Math.floor(Math.random() * 键列表.length)]
    : 设置.提示词.当前预设;
  const 预设 = 列表[名称];
  if (!预设) throw new Error(`未能找到所选的固定提示词预设：${名称}。`);
  return { 名称, 预设 };
}

/**
 * 组装一张图的最终正负提示词。
 *
 * 拆出来是为了让「重新生成本次正文的插图提示词」能在不调后端的前提下
 * 只重跑组装，也让 UI 能预览最终会发出去什么。
 */
export function 组装单图提示词(
  设置: 文生图系统设置,
  提示词标记: string,
  角色上下文: 角色匹配上下文,
  覆盖尺寸?: { 宽度: number; 高度: number } | null,
): {
  正向提示词: string;
  负向提示词: string;
  主体提示词: string;
  宽度: number | null;
  高度: number | null;
  预设名称: string;
} {
  const 档案 = 设置.comfyui.档案列表[设置.comfyui.当前档案];
  if (!档案) throw new Error(`ComfyUI 配置档案不存在：${设置.comfyui.当前档案}`);
  const { 名称: 预设名称, 预设 } = 取提示词预设(设置);

  const 正文 = 剥安全前缀(取出提示词正文(提示词标记, 默认插图标记));
  const 剥尺寸 = 覆盖尺寸
    ? { 提示词: 正文, 宽度: 覆盖尺寸.宽度, 高度: 覆盖尺寸.高度 }
    : 剥出尺寸(正文, 设置.comfyui.自主分辨率);
  const 角色替换 = 处理角色提示词(剥尺寸.提示词, 角色上下文);

  const 规则集 = 设置.提示词.替换规则列表[设置.提示词.当前替换规则];
  const 替换 = 应用替换规则(角色替换.提示词, 规则集?.规则文本 ?? '');

  // 固定画风只在启用时参与组装；关闭时传空字符串，行为与没有这一层一致。
  const 画风 = 设置.提示词.固定画风?.启用
    ? 设置.提示词.固定画风
    : { 前置: '', 后置: '', 负面: '' };

  const 正向提示词 = 组装正面提示词(
    预设.正面固定,
    替换.modifiedPrompt,
    预设.fixedPromptEnd,
    预设.正面质量 || 设置.提示词.正面质量,
    替换.insertions,
    { 前置: 画风.前置, 后置: 画风.后置 },
  );
  const 负面基础 = 组装负面提示词(预设.负面固定, 预设.负面质量 || 设置.提示词.负面质量, 画风.负面);
  const 负向提示词 = [负面基础, 角色替换.角色负面].filter((项) => 项 && 项.trim()).join(', ');

  return {
    正向提示词,
    负向提示词,
    主体提示词: 替换.modifiedPrompt,
    宽度: 剥尺寸.宽度,
    高度: 剥尺寸.高度,
    预设名称,
  };
}

/** 分角色模式的单角色提示词替换（用于 `Scene Composition` 多角色写法）。 */
export function 组装分角色提示词(设置: 文生图系统设置, 文本: string): string {
  const 规则集 = 设置.提示词.替换规则列表[设置.提示词.当前替换规则];
  return 应用分角色替换规则(文本, 规则集?.规则文本 ?? '');
}

export async function 生成单张插图(
  设置: 文生图系统设置,
  请求: 出图请求,
  角色上下文: 角色匹配上下文,
  上下文?: Comfy生成上下文,
): Promise<出图结果> {
  if (!设置.启用) throw new Error('文生图未启用。');
  if (设置.渠道 !== 'comfyui' && 设置.渠道 !== 'novelai' && 设置.渠道 !== 'sd' && 设置.渠道 !== 'banana') {
    throw new Error(`当前生图渠道尚未接入：${设置.渠道}`);
  }

  const 组装 = 组装单图提示词(设置, 请求.提示词标记, 角色上下文, 请求.覆盖尺寸);
  const 档案 = 设置.comfyui.档案列表[设置.comfyui.当前档案];

  const 结果 = 设置.渠道 === 'novelai'
    ? await 生成NovelAI插图(设置, 组装, 请求, 角色上下文)
    : 设置.渠道 === 'sd'
      ? await 生成SD插图(设置, 组装, 请求)
      : 设置.渠道 === 'banana'
        ? await 生成Banana插图(设置, 组装, 请求.参考图)
        : await 生成ComfyUI插图(设置, 组装, 请求, 上下文);

  const 生成参数: 生成参数快照 = {
    渠道: 设置.渠道,
    模型: 结果.模型,
    预设: 组装.预设名称,
    正向提示词: 组装.正向提示词,
    负向提示词: 组装.负向提示词,
    宽度: 结果.宽度,
    高度: 结果.高度,
    种子: 结果.种子,
    步数: 设置.渠道 === 'novelai' ? 设置.novelai.步数
      : 设置.渠道 === 'sd' ? 设置.sd.步数
        : 设置.渠道 === 'banana' ? undefined
          : 档案?.参数.步数,
    采样器: 设置.渠道 === 'novelai' ? 设置.novelai.采样器
      : 设置.渠道 === 'sd' ? 设置.sd.采样器
        : 设置.渠道 === 'banana' ? undefined
          : 档案?.参数.采样器,
    调度器: 设置.渠道 === 'novelai' ? 设置.novelai.噪点表
      : 设置.渠道 === 'sd' ? 设置.sd.调度器
        : 设置.渠道 === 'banana' ? undefined
          : 档案?.参数.调度器,
    cfg: 设置.渠道 === 'novelai' ? 设置.novelai.关联性
      : 设置.渠道 === 'sd' ? 设置.sd.cfg
        : 设置.渠道 === 'banana' ? undefined
          : 档案?.参数.cfg,
  };

  if (请求.写缓存 !== false && 设置.图片缓存.启用) {
    try {
      const blob = await 取图片字节(结果.数据地址);
      await 追加缓存图片(请求.提示词标记, blob, {
        mimeType: 结果.mimeType,
        width: 结果.宽度,
        height: 结果.高度,
        genParams: 生成参数,
      });
    } catch (错误) {
      // 缓存写入失败不该让已经出好的图丢失；但**必须留下日志** ——
      // 这里原来是空 catch，于是「图片缓存里一张图都没有」完全查不出原因。
      devLogError('net', 'image-cache-write-failed', 错误, { 提示词: 请求.提示词标记.slice(0, 32) });
    }
  }

  return { 结果, 正向提示词: 组装.正向提示词, 负向提示词: 组装.负向提示词, 生成参数 };
}

/**
 * 取图片字节。
 *
 * 原来直接 `fetch(数据地址)`：出图结果基本都是 `data:` 地址，而 data URL 也归
 * `connect-src` 管——宿主一旦下发 CSP，这次 fetch 会被直接拒绝，异常又被上层空
 * catch 吞掉，现象就是「图片缓存永远没有图」。改成 data URL 直接解码（不经过网络
 * 层），只有 `blob:` / `http(s):` 这类地址才退回 fetch。
 */
async function 取图片字节(数据地址: string): Promise<Blob> {
  const 地址 = (数据地址 ?? '').trim();
  if (地址.startsWith('data:')) {
    const blob = dataUrlToBlob(地址);
    if (blob) return blob;
  }
  const 响应 = await fetch(地址);
  if (!响应.ok) throw new Error(`读取出图结果失败：HTTP ${响应.status}`);
  const blob = await 响应.blob();
  if (!blob.size) throw new Error('读取出图结果失败：内容为空。');
  return blob;
}

/** 把编辑过的提示词写回标记外壳，供「修改后重新生成」使用。 */
export function 重写提示词标记(新提示词正文: string): string {
  return 包回提示词标记(新提示词正文, 默认插图标记);
}

interface 组装结果 {
  正向提示词: string;
  负向提示词: string;
  宽度: number | null;
  高度: number | null;
  预设名称: string;
}

async function 生成ComfyUI插图(
  设置: 文生图系统设置,
  组装: 组装结果,
  请求: 出图请求,
  上下文?: Comfy生成上下文,
): Promise<生成结果> {
  return 生成ComfyUI图片(
    {
      正向提示词: 组装.正向提示词,
      负向提示词: 组装.负向提示词,
      宽度: 组装.宽度 ?? undefined,
      高度: 组装.高度 ?? undefined,
      参考图: 请求.参考图 ?? undefined,
      标题: 请求.标题,
      signal: 请求.signal,
    },
    { comfyui: 设置.comfyui, 对象信息: 上下文?.对象信息, 任务Id: 上下文?.任务Id },
  );
}

/**
 * NovelAI 渠道。
 *
 * 分角色段从提示词里解析：`组装` 阶段已把正负词拼好，但 NovelAI 的
 * `Character N Prompt` 伪格式是**提示词文本的一部分**，必须单独解出来放进 v4 载荷，
 * 否则多角色会被当成普通词条揉进 base_caption。
 *
 * Director Reference 走 `解析NovelAI参考`：读角色参考组里的图片、缩放、
 * 归一化强度。读图失败的单条会被剔除，宁可少一张也不发错位的载荷。
 */
async function 生成NovelAI插图(
  设置: 文生图系统设置,
  组装: 组装结果,
  请求: 出图请求,
  角色上下文: 角色匹配上下文,
): Promise<生成结果> {
  const 分角色 = 解析分角色提示词(组装.正向提示词);
  const 参考 = await 解析NovelAI参考(设置);
  // 角色卡上存的位置优先：提示词里的 `centers:` 是模型写的，可能写错或没写。
  // 关键是要在**角色替换之前**的文本上取出场角色，否则 $…$ 已经没了。
  const 补好位置 = 补角色位置(
    分角色,
    取原始主体(设置, 请求.提示词标记, 请求.覆盖尺寸),
    角色上下文,
  );
  const 载荷 = 构造NovelAI载荷({
    设置: 设置.novelai,
    正向提示词: 组装.正向提示词,
    负向提示词: 组装.负向提示词,
    宽度: 组装.宽度 ?? undefined,
    高度: 组装.高度 ?? undefined,
    分角色: 补好位置,
    参考,
  }, 生成随机种子);

  const 响应 = await 请求NovelAI图片(设置.novelai, 载荷, 请求.signal);
  const 数据地址 = await 字节转数据地址(响应.字节, 响应.mimeType);
  const 档案宽度 = Number(载荷.width);
  const 档案高度 = Number(载荷.height);
  const 档案种子 = Number(载荷.seed);
  return {
    数据地址,
    mimeType: 响应.mimeType,
    模型: 设置.novelai.模型,
    渠道: 'novelai',
    宽度: Number.isFinite(档案宽度) ? 档案宽度 : 设置.novelai.宽度,
    高度: Number.isFinite(档案高度) ? 档案高度 : 设置.novelai.高度,
    种子: Number.isFinite(档案种子) ? 档案种子 : 0,
  };
}

/**
 * Banana / Grok 渠道。
 *
 * 尺寸与种子都来自载荷里的文本：这一渠道没有独立的种子参数，
 * 因此 `种子` 记为 -1（不适用），而不是伪造一个数字。
 */
async function 生成Banana插图(
  设置: 文生图系统设置,
  组装: 组装结果,
  参考图?: { 数据地址: string; 文件名: string } | null,
): Promise<生成结果> {
  const 尺寸 = 组装.宽度 && 组装.高度 ? `${组装.宽度}x${组装.高度}` : undefined;
  const 载荷 = 构造Banana载荷({
    设置: 设置.banana,
    正向提示词: 组装.正向提示词,
    尺寸,
  });
  const 响应 = await 请求Banana图片({
    设置: 设置.banana,
    载荷,
    // edits 的 image 字段只接受单张，传多张没有意义；这里就取第一张。
    // 开关关闭时**必须**清掉参考图：否则客户端会照样改走 edits，
    // 让界面上的开关形同虚设（ComfyUI 侧一直有这个判断）。
    参考图: 设置.banana.参考图上传 ? (参考图?.数据地址 ?? null) : null,
    编辑格式: 设置.banana.编辑格式,
  });
  const 解析尺寸 = /^(\d+)x(\d+)$/.exec(String(载荷.size ?? 设置.banana.尺寸));
  return {
    数据地址: 响应.数据地址,
    mimeType: 响应.mimeType,
    模型: 设置.banana.模型,
    渠道: 'banana',
    宽度: 解析尺寸 ? Number(解析尺寸[1]) : 0,
    高度: 解析尺寸 ? Number(解析尺寸[2]) : 0,
    种子: -1,
  };
}

/**
 * 用角色卡上存的位置补齐分角色坐标。
 *
 * 两条来源的优先级：角色卡的位置（玩家显式设定的）> 提示词里 `centers:` 解析出的坐标。
 * 按出场顺序与解析出的分角色数组对齐——两者都来自同一段 `$…$` 文本，顺序一致。
 *
 * **必须传剥壳与剥尺寸之后、角色替换之前的文本**。传组装好的正向提示词是错的：
 * 那时 `$…$` 段已经被换成了角色的部位字段，`提取出场角色` 再也找不到它，
 * 于是位置永远补不上（这个缺陷正是集成测试抓到的）。
 */
function 补角色位置(
  分角色: NovelAI分角色[],
  原始主体: string,
  角色上下文: 角色匹配上下文,
): NovelAI分角色[] {
  if (分角色.length === 0) return 分角色;
  const 出场 = 提取出场角色(原始主体, 角色上下文);
  return 分角色.map((项, 下标) => {
    const 位置 = 出场[下标]?.位置;
    if (!位置) return 项;
    return { ...项, coordinates: { x: 位置.x, y: 位置.y } };
  });
}

/**
 * 读出本次要用的参考载荷。
 *
 * 两种模式互斥：
 * - `character` → Director Reference（发图片）；
 * - `vibe` → Vibe transfer（发编码串）。
 *
 * 取用顺序与 `referenceImage.ts` 的通用选图一致：启用列表里的角色优先。
 * 但参考组是**按角色整组取**——只有第一个有可用参考组的角色生效，
 * 因为一张图里塞多个角色的参考组会让 NAI 把它们当成同一组风格。
 */
async function 解析NovelAI参考(设置: 文生图系统设置): Promise<Record<string, unknown> | null> {
  if (设置.novelai.参考模式 === 'vibe') return 解析NovelAIVibe(设置);
  return 解析NovelAI角色参考(设置);
}

/** Vibe 模式：从参考组里取 Vibe JSON 文本，解出当前模型的编码串。 */
function 解析NovelAIVibe(设置: 文生图系统设置): Record<string, unknown> | null {
  const 候选 = 取Vibe条目(设置);
  if (候选.length === 0) return null;

  const 有效条目: Array<{ 强度: number }> = [];
  const 编码列表: string[] = [];
  const 信息提取列表: number[] = [];
  for (const { 条目, 角色名 } of 候选) {
    const 结果 = 解析Vibe条目数据(条目, 设置.novelai.模型);
    if (!结果.编码) {
      devLog('save', 'novelai-vibe-skipped', { 角色: 角色名, 原因: 结果.错误 ?? '未知' });
      continue;
    }
    有效条目.push({ 强度: 条目.强度 });
    编码列表.push(结果.编码);
    信息提取列表.push(结果.信息提取量);
  }
  if (有效条目.length === 0) return null;

  const 强度 = 归一化参考强度(
    有效条目.map((项) => 项.强度),
    设置.novelai.模型,
    设置.novelai.参考强度归一化,
  );
  return 构造Vibe载荷(
    有效条目.map((项, 下标) => ({ 强度: 强度[下标] })),
    编码列表,
    信息提取列表,
    () => `vibe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
  ) as unknown as Record<string, unknown>;
}

async function 解析NovelAI角色参考(设置: 文生图系统设置): Promise<Record<string, unknown> | null> {
  const 候选角色 = [
    ...设置.角色启用列表.map((键) => 设置.角色卡[键]).filter(Boolean),
    ...Object.values(设置.角色卡),
  ];
  for (const 角色 of 候选角色) {
    const 条目列表 = 角色.参考组?.references ?? [];
    if (!参考组可用(条目列表)) continue;

    const { 保留, 丢弃数 } = 截断参考(条目列表);
    if (丢弃数 > 0) devLog('save', 'novelai-reference-truncated', { 丢弃数 });

    const 有效条目: typeof 保留 = [];
    const 有效图片: string[] = [];
    for (const 条目 of 保留) {
      try {
        const 数据地址 = await 读取角色媒体数据地址(条目.媒体Id);
        if (!数据地址) continue;
        有效条目.push(条目);
        有效图片.push(await 缩放参考图(数据地址));
      } catch {
        // 单张读不出来就跳过这条，而不是让整次出图失败。
      }
    }
    if (有效条目.length === 0) continue;

    const 强度 = 归一化参考强度(
      有效条目.map((项) => 项.强度),
      设置.novelai.模型,
      设置.novelai.参考强度归一化,
    );
    return 构造参考载荷(
      有效条目.map((项, 下标) => ({ ...项, 强度: 强度[下标] })),
      有效图片,
      设置.novelai.信息提取,
      () => `ref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    ) as unknown as Record<string, unknown>;
  }
  return null;
}

function 字节转数据地址(字节: Uint8Array, mimeType: string): Promise<string> {
  // 复制成独立 buffer，避免把整个 zip 字节一并带进 Blob。
  // 走 blobEncoding 而不是 FileReader：后者在 jsdom 下会因 Blob 跨 realm 拒收。
  return blob转数据地址(new Blob([字节.slice().buffer], { type: mimeType }));
}

/**
 * SD WebUI 渠道。
 *
 * 种子优先取服务端回传的 `info.seed`：开了高清修复或 ADetailer 时，
 * A1111 可能改写实际种子，用请求里的值会让「查看生成参数」对不上。
 */
async function 生成SD插图(
  设置: 文生图系统设置,
  组装: 组装结果,
  请求: 出图请求,
): Promise<生成结果> {
  const 载荷 = 构造SD载荷({
    设置: 设置.sd,
    正向提示词: 组装.正向提示词,
    负向提示词: 组装.负向提示词,
    宽度: 组装.宽度 ?? undefined,
    高度: 组装.高度 ?? undefined,
  });

  const 响应 = await 请求SD图片(设置.sd, 载荷, 请求.signal);
  const 数据地址 = await 字节转数据地址(响应.字节, 响应.mimeType);
  const 服务端种子 = Number(响应.信息?.seed);
  const 请求种子 = Number(载荷.seed);
  return {
    数据地址,
    mimeType: 响应.mimeType,
    模型: 设置.sd.模型,
    渠道: 'sd',
    宽度: Number(载荷.width),
    高度: Number(载荷.height),
    种子: Number.isFinite(服务端种子) ? 服务端种子 : (Number.isFinite(请求种子) ? 请求种子 : -1),
  };
}
