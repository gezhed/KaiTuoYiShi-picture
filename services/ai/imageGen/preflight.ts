/**
 * 自检（preflight）。
 *
 * 不派生自上游任何函数——上游没有对应能力。它解决的是移植过程中最贵的失败模式：
 * **配置错误与运行时错误长得一样**。「图出不来」可能是没填地址、可能是工作流存成了
 * UI 格式、可能是占位符写错、也可能是占位符被替换成了超范围的值；
 * 这四者的排查路径完全不同，但现象都是「不出图」。
 *
 * 本模块把它们在发请求**之前**分辨出来，且不联网、不消耗额度。
 */

import { LoRA槽位数 } from '@/models/genSystem';
import type { 文生图系统设置, 生图渠道 } from '@/models/genSystem';
import { 未选择模型 } from './comfyEngine';
import type { Comfy可选资源 } from './comfyClient';
import { 是ComfyUI界面格式, 是ComfyUI接口格式 } from './types';
import { 扫描剩余占位符, 占位符表 } from './workflowTokens';
import { Vibe编码键, Vibe模型已知, 提取Vibe编码 } from './novelaiVibe';
import { Banana生成端点, Banana编辑端点 } from './bananaClient';
import { NovelAI候选地址 } from './novelaiClient';
import { 拼接SDPath } from './sdClient';

export type 检查级别 = 'error' | 'warning' | 'info';

export interface 检查项 {
  级别: 检查级别;
  /** 简短标题。 */
  标题: string;
  /** 说明与修复建议。 */
  说明: string;
}

export interface 自检结果 {
  渠道: 生图渠道;
  /** 是否具备发请求的最低条件。 */
  可出图: boolean;
  检查项: 检查项[];
}

function 汇总(渠道: 生图渠道, 检查项: 检查项[]): 自检结果 {
  return {
    渠道,
    可出图: !检查项.some((项) => 项.级别 === 'error'),
    检查项,
  };
}

/** 模型对应的尺寸上限判断：不是硬限制，只提示可能被服务端拒绝。 */
const 常见尺寸上限 = 4096;

/**
 * 可枚举的节点输入：这些字段的值必须是**服务端确实拥有的资源**之一，
 * 写死一个不存在的名字会被 ComfyUI 以 `prompt_outputs_failed_validation`
 * 拒绝，而报错只说「Value not in list」，不看服务端列表根本猜不到少了什么。
 */
const 可枚举输入: Array<{ 键: string; 资源: keyof Comfy可选资源; 说明: string }> = [
  { 键: 'ckpt_name', 资源: '模型', 说明: 'checkpoint 模型' },
  { 键: 'lora_name', 资源: 'lora', 说明: 'LoRA' },
  { 键: 'vae_name', 资源: 'vae', 说明: 'VAE' },
  { 键: 'clip_name', 资源: 'clip', 说明: 'CLIP' },
];

/** 递归找出工作流里所有可枚举输入的写死值。 */
function 收集可枚举值(
  工作流对象: unknown,
): Array<{ 节点: string; 键: string; 值: string; 资源: keyof Comfy可选资源; 说明: string }> {
  const 命中: Array<{ 节点: string; 键: string; 值: string; 资源: keyof Comfy可选资源; 说明: string }> = [];
  if (!工作流对象 || typeof 工作流对象 !== 'object') return 命中;
  for (const [节点Id, 节点] of Object.entries(工作流对象 as Record<string, unknown>)) {
    if (!节点 || typeof 节点 !== 'object') continue;
    const 输入 = (节点 as { inputs?: unknown }).inputs;
    if (!输入 || typeof 输入 !== 'object') continue;
    for (const [键, 值] of Object.entries(输入 as Record<string, unknown>)) {
      const 定义 = 可枚举输入.find((项) => 项.键 === 键);
      if (!定义) continue;
      // 占位符说明这个值会被设置覆盖，不用校验。
      if (typeof 值 !== 'string' || !值.trim() || /^%.*%$/.test(值.trim())) continue;
      命中.push({ 节点: 节点Id, 键, 值: 值.trim(), 资源: 定义.资源, 说明: 定义.说明 });
    }
  }
  return 命中;
}

/**
 * 拿服务端实际资源列表校验工作流里写死的资源名。
 *
 * 这是唯一能在**提交前**发现「模型不存在」的办法：客户端无法凭自身判断
 * `v1-5-pruned-emaonly.safetensors` 在不在服务端。资源列表由调用方传入
 * （设置页在「测试连接」时已经拉过一次），拿不到就跳过校验。
 */
export function 校验工作流资源(
  工作流Json: string,
  资源: Comfy可选资源 | null | undefined,
): 检查项[] {
  if (!资源) return [];
  let 解析结果: unknown;
  try {
    解析结果 = JSON.parse(工作流Json) as unknown;
  } catch {
    return [];
  }

  const 项: 检查项[] = [];
  for (const 命中 of 收集可枚举值(解析结果)) {
    const 可用 = 资源[命中.资源] ?? [];
    if (可用.length === 0) continue; // 该资源种类服务端没报，无法判断
    if (可用.includes(命中.值)) continue;
    项.push({
      级别: 'error',
      标题: `工作流里的${命中.说明}不存在：${命中.值}`,
      说明: `节点 #${命中.节点} 的 ${命中.键} 写死为「${命中.值}」，但 ComfyUI 没有这个${命中.说明}。`
        + `ComfyUI 会以「Value not in list」拒绝提交。`
        + `可用的${命中.说明}：${可用.slice(0, 5).join('、')}${可用.length > 5 ? ` 等 ${可用.length} 个` : ''}。`
        + `建议把该字段改成占位符（如 "ckpt_name": "%MODEL_NAME%"），再到「ComfyUI」页选择模型。`,
    });
  }
  return 项;
}

export function 运行自检(
  设置: 文生图系统设置,
  /** 已连接 ComfyUI 时拿到的资源列表；没有则跳过资源校验。 */
  可选资源?: Comfy可选资源 | null,
): 自检结果 {
  const 检查项: 检查项[] = [];

  if (!设置.启用) {
    检查项.push({
      级别: 'error',
      标题: '文生图未启用',
      说明: '到「总览」打开「启用文生图」。关闭时不会产生任何请求。',
    });
  }

  if (!设置.正文配图.启用) {
    检查项.push({
      级别: 'info',
      标题: '正文自动配图未启用',
      说明: '「手动出图」不受影响；开启正文配图后，每轮回复会自动生成插图。',
    });
  }

  if (!设置.LLM.启用) {
    检查项.push({
      级别: 'info',
      标题: 'LLM未启用',
      说明: 'LLM负责把正文变成出图提示词。未启用时正文配图会失败，但手动出图仍可用。',
    });
  } else if (!设置.LLM.API.model?.trim()) {
    检查项.push({
      级别: 'error',
      标题: 'LLM没有填模型',
      说明: '正文配图的提示词由这个模型生成。到「提示词」页填写LLM的模型。',
    });
  }

  // 尺寸范围对所有渠道都适用。ComfyUI 的尺寸在档案里，故先取当前档案。
  const comfy档案 = 设置.comfyui.档案列表[设置.comfyui.当前档案];
  const 宽度 = 设置.渠道 === 'novelai' ? 设置.novelai.宽度
    : 设置.渠道 === 'sd' ? 设置.sd.宽度
      : 设置.渠道 === 'banana' ? 0
        : (comfy档案?.参数.宽度 ?? 0);
  const 高度 = 设置.渠道 === 'novelai' ? 设置.novelai.高度
    : 设置.渠道 === 'sd' ? 设置.sd.高度
      : 设置.渠道 === 'banana' ? 0
        : (comfy档案?.参数.高度 ?? 0);
  for (const [名称, 值] of [['宽度', 宽度], ['高度', 高度]] as const) {
    if (值 && 值 > 常见尺寸上限) {
      检查项.push({
        级别: 'warning',
        标题: `${名称}偏大（${值}）`,
        说明: `超过 ${常见尺寸上限} 的尺寸多数服务端会拒绝或显存不足。`,
      });
    }
  }

  if (设置.渠道 === 'comfyui') {
    检查项.push(...检查ComfyUI(设置, 可选资源));
    // 有服务端资源列表时，顺手把工作流里写死的模型/LoRA/VAE 名核对一遍。
    const 档案 = 设置.comfyui.档案列表[设置.comfyui.当前档案];
    if (档案?.工作流Json) 检查项.push(...校验工作流资源(档案.工作流Json, 可选资源));
  } else if (设置.渠道 === 'novelai') 检查项.push(...检查NovelAI(设置));
  else if (设置.渠道 === 'sd') 检查项.push(...检查SD(设置));
  else if (设置.渠道 === 'banana') 检查项.push(...检查Banana(设置));

  return 汇总(设置.渠道, 检查项);
}

/** 无参考图时给一条提示，避免「参考图没生效」被当成 bug。 */
function 检查参考图缺失(设置: 文生图系统设置, 渠道名: string): 检查项[] {
  const 有图 = Object.values(设置.角色卡).some((角色) => [
    ...角色.photoMedia,
    ...角色.audioMedia,
  ].some((项) => 项.用途 !== 'audio'));
  if (有图) return [];
  return [{
    级别: 'info',
    标题: '没有可用的参考图',
    说明: `${渠道名}的参考图来自「角色管理 → 媒体」。上传图片并标为「参考」用途后才会生效。`,
  }];
}

/** 采样器节点的 class_type（不同安装/版本会不一样，按前缀放宽匹配）。 */
const 采样器类型 = /^(KSampler|KSamplerAdvanced|SamplerCustom)/;

/**
 * 顺着采样器的 positive / negative 输入，找出实际提供条件的节点 id。
 *
 * 用途：缺提示词占位符时直接点名「改 #6 的 text」，而不是让用户自己在几十个节点里翻。
 * 只做一跳（采样器 → 条件节点），这是绝大多数工作流的形状；跳不到就返回空数组。
 */
export function 找提示词节点(工作流对象: unknown): { 正向: string[]; 负向: string[] } {
  const 正向 = new Set<string>();
  const 负向 = new Set<string>();
  if (!工作流对象 || typeof 工作流对象 !== 'object' || Array.isArray(工作流对象)) {
    return { 正向: [], 负向: [] };
  }
  const 全部 = 工作流对象 as Record<string, { class_type?: unknown; inputs?: Record<string, unknown> }>;
  const 取引用 = (值: unknown): string | null => {
    if (typeof 值 === 'string' && 值.trim()) return 值.trim();
    if (Array.isArray(值) && typeof 值[0] === 'string' && 值[0].trim()) return 值[0].trim();
    return null;
  };
  for (const [节点Id, 节点] of Object.entries(全部)) {
    const 类型 = typeof 节点?.class_type === 'string' ? 节点.class_type : '';
    if (!采样器类型.test(类型)) continue;
    const 正 = 取引用(节点.inputs?.positive);
    const 负 = 取引用(节点.inputs?.negative);
    if (正 && 全部[正]) 正向.add(正);
    if (负 && 全部[负]) 负向.add(负);
    void 节点Id;
  }
  return { 正向: [...正向], 负向: [...负向] };
}

/**
 * 设置里的模型 / VAE / CLIP 是否真的在服务端。
 *
 * 这条路走的是 `%MODEL_NAME%` 这类占位符 —— `校验工作流资源` 只看**写死在 JSON 里**的值，
 * 占位符会被跳过，于是「设置里选了个服务器上没有的模型」就成了盲区：
 * 提交后才报 `Value not in list`，而那道报错只说节点号与类型。这里补上。
 */
function 检查设置资源(
  设置: 文生图系统设置,
  资源: Comfy可选资源 | null | undefined,
): 检查项[] {
  if (!资源) return [];
  const comfy = 设置.comfyui;
  const 档案 = comfy.档案列表[comfy.当前档案];
  if (!档案) return [];
  const 映射: Array<[string, string[], string]> = [
    ['checkpoint 模型', 资源.模型 ?? [], 档案.参数.模型],
    ['VAE', 资源.vae ?? [], 档案.参数.vae],
    ['CLIP', 资源.clip ?? [], 档案.参数.clip],
  ];
  const 项: 检查项[] = [];
  for (const [说明, 可用, 值] of 映射) {
    const 裁剪 = (值 ?? '').trim();
    // 空值 / 哨兵值由别的检查负责，这里只管「选了但服务器没有」。
    if (!裁剪 || 裁剪 === 未选择模型 || 可用.length === 0) continue;
    if (可用.includes(裁剪)) continue;
    项.push({
      级别: 'error',
      标题: `设置里的${说明}在 ComfyUI 上不存在：${裁剪}`,
      说明: `工作流用的是占位符（%MODEL_NAME% 这类），值来自「生成参数」，`
        + `但服务端列表里没有它。ComfyUI 会以「Value not in list」拒绝提交。`
        + `可用的${说明}：${可用.slice(0, 5).join('、')}${可用.length > 5 ? ` 等 ${可用.length} 个` : ''}。`
        + '请在「生成参数」里重新选择。',
    });
  }
  return 项;
}

function 检查ComfyUI(设置: 文生图系统设置, 资源?: Comfy可选资源 | null): 检查项[] {
  const 项: 检查项[] = [];
  const comfy = 设置.comfyui;

  const 档案 = comfy.档案列表[comfy.当前档案];
  if (!档案) {
    项.push({
      级别: 'error',
      标题: `找不到工作流档案「${comfy.当前档案}」`,
      说明: '到「工作流」页新建或切换一个档案。',
    });
    return 项;
  }

  if (!档案.连接.地址?.trim()) {
    项.push({
      级别: 'error',
      标题: '没有填 ComfyUI 地址',
      说明: '到「ComfyUI」页填写，例如 http://127.0.0.1:8188。'
        + '浏览器直连要求 ComfyUI 允许跨域（启动时加 --enable-cors-header）。',
    });
  }

  const 工作流 = 档案.工作流Json ?? '';
  if (!工作流.trim()) {
    项.push({
      级别: 'error',
      标题: '工作流是空的',
      说明: '到「工作流」页粘贴 ComfyUI 的 API 格式 JSON。',
    });
    return 项;
  }

  // 格式判定必须传**解析后的对象**——这两个判定函数检查的是 nodes/links 数组
  // 与节点 id → class_type 的映射结构，把 JSON 字符串原样传进去只会两头都不是。
  let 解析结果: unknown = null;
  let 可解析 = true;
  try {
    解析结果 = JSON.parse(工作流) as unknown;
  } catch (错误) {
    可解析 = false;
    项.push({
      级别: 'error',
      标题: '工作流不是合法 JSON',
      说明: `解析失败：${错误 instanceof Error ? 错误.message : String(错误)}`,
    });
  }

  if (可解析) {
    if (是ComfyUI界面格式(解析结果)) {
      项.push({
        级别: 'error',
        标题: '工作流是 UI 格式，不是 API 格式',
        说明: 'ComfyUI 默认导出的带 nodes/links 的 JSON 无法提交。'
          + '请在 ComfyUI 里用「Save (API Format)」重新导出，或开启开发者模式的 API 导出选项。',
      });
    } else if (!是ComfyUI接口格式(解析结果)) {
      项.push({
        级别: 'error',
        标题: '工作流不是合法的节点对象',
        说明: 'API 格式应是一个以节点 id 为键的对象，每个节点含 class_type 与 inputs。',
      });
    }
  }

  // 占位符必须带引号——上一步的文本替换依赖这一点。
  const 剩余 = 扫描剩余占位符(工作流);
  const 已知占位符 = new Set(Object.keys(占位符表));
  const 未知 = 剩余.filter((项) => !已知占位符.has(项.replace(/^%|%$/g, '')));
  if (未知.length > 0) {
    项.push({
      级别: 'warning',
      标题: `有 ${未知.length} 个不认识的占位符`,
      说明: `这些不会被替换，会原样发给 ComfyUI：${未知.slice(0, 6).join('、')}`
        + '。可替换的占位符见「工作流」页的推荐列表。',
    });
  }

  // 提示词占位符：顺手把「该改哪个节点」指出来 —— 只说「没有占位符」时，
  // 用户得自己在几十个节点里翻，实测就卡在这一步。
  const 文本节点 = 可解析 ? 找提示词节点(解析结果) : { 正向: [], 负向: [] };
  const 必需的: Array<[string, boolean, string[], string, string]> = [
    ['正向提示词', 工作流.includes('%prompt%') || 工作流.includes('%comfyuizhengxiangtishici%'), 文本节点.正向, '%prompt%', '正向'],
    ['负向提示词', 工作流.includes('%negative%') || 工作流.includes('%comfyuifuxiangtishici%'), 文本节点.负向, '%negative_prompt%', '负向'],
  ];
  for (const [名称, 存在, 节点列表, 占位符, 方向] of 必需的) {
    if (!存在) {
      项.push({
        级别: 'warning',
        标题: `工作流里可能没有${名称}占位符`,
        说明: 节点列表.length > 0
          ? `没有占位符时提示词不会进入工作流，出图会被工作流里的固定文本决定。`
            + `本次看起来是节点 ${节点列表.map((id) => `#${id}`).join('、')} 在提供${方向}条件，`
            + `请把它的 text 改成 "${占位符}"（必须带双引号，否则永远不会被替换）。`
          : `没有占位符时提示词不会进入工作流，出图会被工作流里的固定文本决定。`
            + `请在某处接一个 CLIPTextEncode 并把 text 写成 "${占位符}"（${
              '必须带双引号'
            }）。`,
      });
    }
  }

  if (comfy.参考图上传) {
    项.push(...检查参考图缺失(设置, 'ComfyUI'));
    if (!工作流.includes('%comfyuicankaotupian%')) {
      项.push({
        级别: 'warning',
        标题: '开了参考图上传，但工作流里没有参考图占位符',
        说明: '图片会被上传，但不会进入工作流。请在工作流的 LoadImage 节点写入 %comfyuicankaotupian%。',
      });
    }
  }

  项.push(...检查角色LoRA槽位(设置, 工作流, 资源));
  项.push(...检查设置资源(设置, 资源));

  return 项;
}

/**
 * 角色 LoRA 与工作流槽位是否对得上。
 *
 * 两类提示都指向「以为配了却没生效」：
 *   ① 角色绑了 LoRA，但工作流里没有任何 `%lora_name_1%` —— 那 LoRA 永远不会被加载；
 *   ② 角色绑的数量超过槽位数 —— 多出来的会被丢弃（写清楚是哪几个）。
 */
function 检查角色LoRA槽位(
  设置: 文生图系统设置,
  工作流: string,
  资源?: Comfy可选资源 | null,
): 检查项[] {
  const 项: 检查项[] = [];
  const 启用角色 = 设置.角色启用列表
    .map((id) => 设置.角色卡[id])
    .filter((角色): 角色 is NonNullable<typeof 角色> => Boolean(角色));
  const 带LoRA = 启用角色.filter((角色) => (角色.LoRA ?? []).some((项) => (项.名称 ?? '').trim()));
  if (带LoRA.length === 0) return 项;

  if (!工作流.includes('%lora_name_1%')) {
    项.push({
      级别: 'warning',
      标题: '角色绑了 LoRA，但工作流里没有 LoRA 槽位占位符',
      说明: `「${带LoRA.map((角色) => 角色.nameCN || 角色.id).join('、')}」配了 LoRA，`
        + '但工作流里没有 %lora_name_1%。请在 LoraLoader 链的第 1 槽写上它（第 N 槽写 %lora_name_N%），'
        + '否则这些 LoRA 不会生效。',
    });
    return 项;
  }

  const 超出 = 带LoRA.flatMap((角色) => (角色.LoRA ?? [])
    .map((条) => (条.名称 ?? '').trim())
    .filter(Boolean)
    .map((名称) => ({ 角色: 角色.nameCN || 角色.id, 名称 })));
  const 去重后 = new Set(超出.map((条) => 条.名称.toLowerCase()));
  if (去重后.size > LoRA槽位数) {
    项.push({
      级别: 'warning',
      标题: `角色 LoRA 共 ${去重后.size} 个，超过工作流的 ${LoRA槽位数} 个槽位`,
      说明: `超出的会被丢弃（按出场顺序取前 ${LoRA槽位数} 个）。要么精简绑定，要么在工作流里再加 LoraLoader 槽位`
        + '（占位符只有 1~4，加更多槽需要改代码）。',
    });
  }

  /*
   * 名字核对：角色 LoRA 走的是占位符，`校验工作流资源` 看不见它 ——
   * 名字打错/换了机器时，只有提交后才报 `Value not in list`（且只报节点号）。
   */
  const 可用LoRA = 资源?.lora ?? [];
  if (可用LoRA.length > 0) {
    const 缺失 = [...new Map(超出
      .filter((条) => !可用LoRA.includes(条.名称))
      .map((条) => [`${条.角色}|${条.名称}`, 条])).values()];
    if (缺失.length > 0) {
      项.push({
        级别: 'error',
        标题: `角色绑定的 LoRA 在 ComfyUI 上不存在：${缺失.map((条) => 条.名称).join('、')}`,
        说明: 缺失.map((条) => `「${条.角色}」的 ${条.名称}`).join('；')
          + '。绑定这些 LoRA 的角色出场时，ComfyUI 会以「Value not in list」拒绝本次提交。'
          + `可用的 LoRA：${可用LoRA.slice(0, 5).join('、')}${可用LoRA.length > 5 ? ` 等 ${可用LoRA.length} 个` : ''}。`,
      });
    }
  }
  return 项;
}

function 检查NovelAI(设置: 文生图系统设置): 检查项[] {
  const 项: 检查项[] = [];
  const nai = 设置.novelai;

  if (!nai.Token?.trim()) {
    项.push({
      级别: 'error',
      标题: '没有填 NovelAI Token',
      说明: '到「NovelAI」页填写。注意这是持久化 Token，不是账号密码。',
    });
  }
  const 候选 = NovelAI候选地址(nai);
  if (候选.length === 0) {
    项.push({
      级别: 'error',
      标题: 'NovelAI 地址为空',
      说明: '留空时会退回官方 image.novelai.net；若要用第三方站点请填完整地址。',
    });
  } else if (候选.length > 1) {
    项.push({
      级别: 'info',
      标题: `将依次尝试 ${候选.length} 个地址`,
      说明: `第三方站点的路径写法不统一，失败的那个会被跳过：${候选.join(' → ')}`,
    });
  }

  if (!Vibe模型已知(nai.模型)) {
    项.push({
      级别: 'warning',
      标题: `模型「${nai.模型}」不在已知列表里`,
      说明: `Vibe 与 params_version 会按默认规则处理（编码键退回 ${Vibe编码键(nai.模型)}），`
        + '可能不被服务端接受。建议用下拉里列出的模型。',
    });
  }

  if (nai.参考模式 === 'vibe') {
    const Vibe项 = 检查Vibe参考(设置);
    项.push(...Vibe项);
  } else {
    项.push(...检查参考图缺失(设置, 'NovelAI'));
  }

  return 项;
}

/** Vibe 模式的专门检查：最常见的失败是「文件里没有当前模型的编码」。 */
function 检查Vibe参考(设置: 文生图系统设置): 检查项[] {
  const 项: 检查项[] = [];
  const 条目列表 = Object.values(设置.角色卡).flatMap(
    (角色) => 角色.参考组?.references ?? [],
  );
  if (条目列表.length === 0) {
    项.push({
      级别: 'warning',
      标题: '参考模式是 Vibe，但没有任何 Vibe 条目',
      说明: '到「角色管理 → NovelAI 参考组」上传 .naiv4vibe 文件。',
    });
    return 项;
  }

  let 可用 = 0;
  const 失败样例: string[] = [];
  for (const 条目 of 条目列表) {
    let 结果;
    try {
      结果 = 提取Vibe编码(JSON.parse(条目.媒体Id) as unknown, 设置.novelai.模型);
    } catch {
      结果 = { 编码: null, 信息提取量: 1, 错误: '不是合法 JSON' };
    }
    if (结果.编码) 可用 += 1;
    else if (失败样例.length < 2) 失败样例.push(结果.错误 ?? '未知原因');
  }

  if (可用 === 0) {
    项.push({
      级别: 'error',
      标题: '没有一个 Vibe 能用于当前模型',
      说明: `${条目列表.length} 个条目全部取不到编码。原因：${失败样例.join('；')}`,
    });
  } else if (可用 < 条目列表.length) {
    项.push({
      级别: 'warning',
      标题: `${条目列表.length - 可用} 个 Vibe 会被跳过`,
      说明: `只有 ${可用} 个能用。原因：${失败样例.join('；')}`,
    });
  } else {
    项.push({
      级别: 'info',
      标题: `${可用} 个 Vibe 可用`,
      说明: `编码键 ${Vibe编码键(设置.novelai.模型)}。`,
    });
  }
  return 项;
}

function 检查SD(设置: 文生图系统设置): 检查项[] {
  const 项: 检查项[] = [];
  const sd = 设置.sd;
  if (!sd.地址?.trim()) {
    项.push({
      级别: 'error',
      标题: '没有填 SD WebUI 地址',
      说明: '到「SD WebUI」页填写，例如 http://127.0.0.1:7860。需要给 WebUI 加 --api 启动参数。',
    });
  }
  if (!sd.模型?.trim()) {
    项.push({
      级别: 'info',
      标题: '没有指定模型',
      说明: '留空时用 WebUI 当前已加载的模型；也可以点「测试并读取模型列表」后选择。',
    });
  }
  if (sd.高清修复 && sd.高清放大倍数 > 2) {
    项.push({
      级别: 'warning',
      标题: `高清放大倍数偏大（${sd.高清放大倍数}）`,
      说明: '倍数 × 原始尺寸超过 4096 时多数显卡会显存不足。',
    });
  }
  项.push({
    级别: 'info',
    标题: '请求会发到',
    说明: 拼接SDPath(sd.地址 || '（未填）', '/sdapi/v1/txt2img'),
  });
  项.push({
    级别: 'info',
    标题: 'SD 渠道没有参考图机制',
    说明: '上游的 SD 路径只有 ADetailer 面部重绘；参考图是 ComfyUI 的 IP-Adapter 节点能力。'
      + '需要参考图请改用 ComfyUI 或 NovelAI。',
  });
  return 项;
}

function 检查Banana(设置: 文生图系统设置): 检查项[] {
  const 项: 检查项[] = [];
  const banana = 设置.banana;
  if (!banana.APIKey?.trim()) {
    项.push({
      级别: 'error',
      标题: '没有填 API Key',
      说明: '到「Banana / Grok」页填写。',
    });
  }
  const 生成端点 = Banana生成端点(banana);
  if (!生成端点) {
    项.push({
      级别: 'error',
      标题: '地址为空，无法推导端点',
      说明: '填一个基址（如 https://api.openai.com），或在「自定义端点」里直接给完整地址。',
    });
  } else {
    项.push({
      级别: 'info',
      标题: '文生图会请求',
      说明: 生成端点,
    });
    if (banana.参考图上传) {
      项.push({
        级别: 'info',
        标题: '带参考图时会改请求',
        说明: `${Banana编辑端点(banana)}（形态：${banana.编辑格式 === 'json' ? 'JSON' : 'multipart/form-data'}）`,
      });
      项.push(...检查参考图缺失(设置, 'Banana'));
    }
  }
  项.push({
    级别: 'info',
    标题: 'Banana 不支持负面提示词与种子',
    说明: '负向词不会发给服务端；生成参数里的种子会记为「不适用」。',
  });
  return 项;
}
