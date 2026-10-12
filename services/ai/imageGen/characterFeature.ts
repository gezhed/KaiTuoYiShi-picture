/**
 * 一键生成角色特征：用 LLM 从「人物生成」提示词产出角色卡的 14 个部位字段。
 *
 * 派生自 st-chatu8（智绘姬）index.js：
 *   `preprocessTagContent2` L30312-L30318、`parseCharacterData` L30319-L30367、
 *   `parseOutfitData2` L30368-L30405、`extractCharacterAndOutfitTags` L30406-L30445、
 *   `buildCharacterText` L30468-L30490、`handleCharacterPromptModify` L30491-L30581、
 *   `updateCharacterPresetFromLLM` L30582+。
 *
 * 提示词不是上游的 `characterAI.systemPrompt`（那是一句占位说明），而是用户指定的
 * 「人物生成」预设，见 `prompts/cot/characterFeaturePrompt.ts`。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-16；
 *   修改目的：① 改写为 TypeScript 纯函数：解析、拼消息、合并三件事分开，
 *   便于单测与「预览后确认」的交互（上游解析完直接写设置）；
 *   ② 字段键的匹配改为「归一化后比对」，除上游的三处错字修正外还兼容
 *   `五官外貌（正面）`、`下半身 SFW 背面` 这类带括号/空格的写法；
 *   ③ 上游要求必须有中文名才算解析成功，这里放宽为「至少一个字段非空」——
 *   用户先让模型补外貌、名字回头再填也是正常用法；
 *   ④ 不支持参考图：本仓库的对话客户端只发文本消息（`ChatMessagePayload.content` 是字符串），
 *   上游那条「把参考图挂到 user 消息」的能力在这里没有落点，故未移植。
 */

import type { 角色卡, 角色部位字段, 服装条目, 文生图系统设置 } from '@/models/genSystem';
import { 角色部位字段名 } from '@/models/genSystem';
import { 剥掉思维链 } from './illustrationAgent';

export interface LLM消息 {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 归一化字段键：去掉空白、下划线、连字符、括号与冒号，拉丁字母转小写。 */
function 归一化键(键: string): string {
  return (键 ?? '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[_\-—:：*#]/g, '')
    .replace(/[（）()【】[\]]/g, '')
    .toLowerCase();
}

/**
 * 字段键 → 部位字段。
 *
 * 上游 `parseCharacterData` 的表里**没有「角色特征」**；本仓库的角色卡有
 * `characterTraits`，所以这里补上（提示词同步补了对应的输出行）。
 */
const 字段键表: Record<string, keyof 角色部位字段> = {
  中文名称: 'nameCN',
  英文名称: 'nameEN',
  角色特征: 'characterTraits',
  人物特征: 'characterTraits',
  特征: 'characterTraits',
  五官外貌: 'facialFeatures',
  五官外貌正面: 'facialFeatures',
  面部特征: 'facialFeatures',
  面部特征正面: 'facialFeatures',
  五官外貌背面: 'facialFeaturesBack',
  面部特征背面: 'facialFeaturesBack',
  上半身sfw: 'upperBodySFW',
  上半身sfw正面: 'upperBodySFW',
  上半身sfw背面: 'upperBodySFWBack',
  下半身sfw: 'fullBodySFW',
  下半身sfw正面: 'fullBodySFW',
  下半身sfw背面: 'fullBodySFWBack',
  全身sfw: 'fullBodySFW',
  上半身nsfw: 'upperBodyNSFW',
  上半身nsfw正面: 'upperBodyNSFW',
  上半身nsfw背面: 'upperBodyNSFWBack',
  下半身nsfw: 'fullBodyNSFW',
  下半身nsfw正面: 'fullBodyNSFW',
  下半身nsfw背面: 'fullBodyNSFWBack',
  // 上游 `preprocessTagContent2` 里专门修过的一个错写：模型偶尔把 `下半身NSFW背面`
  // 写成 `下半身NSWebcam`（"webcam" 看起来来自输入法联想）。
  下半身nswebcam: 'fullBodyNSFWBack',
  全身nsfw: 'fullBodyNSFW',
  负面: 'negative',
  角色负面: 'negative',
  角色负面提示词: 'negative',
  负面提示词: 'negative',
};

/** 服装块（`<服装>`）的字段键表。 */
const 服装键表: Record<string, 服装草稿字段> = {
  归属人: '归属人',
  中文名称: 'name',
  英文名称: '英文名称',
  上半身: '上半身',
  上半身正面: '上半身',
  上半身背面: '上半身背面',
  下半身: '下半身',
  下半身正面: '下半身',
  下半身背面: '下半身背面',
  全身: '全身',
  全身背面: '全身',
  负面: '负面',
  服装负面: '负面',
};

export type 服装草稿字段 = 'name' | '英文名称' | '归属人' | '上半身' | '上半身背面' | '下半身' | '下半身背面' | '全身' | '负面';

export type 服装草稿 = Record<服装草稿字段, string>;

function 空服装草稿(): 服装草稿 {
  return {
    name: '', 英文名称: '', 归属人: '',
    上半身: '', 上半身背面: '', 下半身: '', 下半身背面: '', 全身: '', 负面: '',
  };
}

/**
 * 逐行 `键:值` 解析成对象。
 *
 * 上游 `preprocessTagContent2` 会先把全角冒号/逗号归一，并修三处写错的行名
 * （`下半身NSWebcam:`、`下半身NSFW_背面:`、`上半身NSFW_背面:`）。
 * 这里改用「归一化键」比对，等价覆盖那些错写，且对空格/括号更宽容。
 */
function 解析键值块(内容: string): { 表: Record<string, string>; 未识别: string[] } {
  const 表: Record<string, string> = {};
  const 未识别: string[] = [];
  for (const 原行 of (内容 ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const 行 = 原行.replace(/[：]/g, ':').replace(/[，]/g, ',').trim();
    if (!行) continue;
    const 位置 = 行.indexOf(':');
    if (位置 <= 0) continue;
    const 键 = 归一化键(行.slice(0, 位置));
    const 值 = 行.slice(位置 + 1).trim();
    if (!键) continue;
    if (!表[键]) 表[键] = 值;
    else if (!未识别.includes(键)) 未识别.push(键);
  }
  return { 表, 未识别 };
}

export interface 解析人物结果 {
  /** 解析出的角色字段（只含识别到的键）。 */
  字段: Partial<角色部位字段>;
  /** 解析出的服装（`<服装>` 块），尚未分配 id。 */
  服装: 服装草稿[];
  /** 识别不了的键名，用于提示作者「可能是格式写错了」。 */
  未识别: string[];
}

/**
 * 从模型回复里解析 `<人物>` / `<服装>` 区块。
 *
 * 上游的 `extractCharacterAndOutfitTags` 还维护「服装归属到最近的人物」这层关系；
 * 本仓库的服装直接挂在角色卡上，一键生成的对象就是当前这张卡，因此只取全部区块，
 * 不做归属重排（归属关系在界面上由用户决定放哪张卡）。
 */
export function 解析人物区块(回复: string): 解析人物结果 {
  const 文本 = 剥掉思维链(回复 ?? '');
  const 字段: Partial<角色部位字段> = {};
  const 服装: 服装草稿[] = [];
  const 未识别: string[] = [];

  const 区块模式 = /<(人物|服装)>([\s\S]*?)<\/\1>/g;
  let 命中: RegExpExecArray | null;
  while ((命中 = 区块模式.exec(文本)) !== null) {
    const 类型 = 命中[1];
    const 内容 = 命中[2];
    if (类型 === '人物') {
      const { 表, 未识别: 坏键 } = 解析键值块(内容);
      for (const [键, 值] of Object.entries(表)) {
        const 部位 = 字段键表[键];
        if (部位) 字段[部位] = 值;
        else if (!未识别.includes(键)) 未识别.push(键);
      }
      for (const 键 of 坏键) if (!未识别.includes(键)) 未识别.push(键);
      continue;
    }
    const { 表, 未识别: 坏键 } = 解析键值块(内容);
    const 草稿 = 空服装草稿();
    let 有内容 = false;
    for (const [键, 值] of Object.entries(表)) {
      const 目标 = 服装键表[键];
      if (目标) {
        草稿[目标] = 值;
        if (值) 有内容 = true;
      } else if (!未识别.includes(键)) {
        未识别.push(键);
      }
    }
    for (const 键 of 坏键) if (!未识别.includes(键)) 未识别.push(键);
    // 背面两段没有独立字段可用时，兜进 `全身`（旧服装只有这一段）。
    if (!草稿.全身) {
      const 背面 = [草稿.上半身背面, 草稿.下半身背面].filter(Boolean);
      if (背面.length > 0) 草稿.全身 = 背面.join(', ');
    }
    if (有内容) 服装.push(草稿);
  }

  return { 字段, 服装, 未识别 };
}

/** 判断一次解析是否至少拿到了一个字段（不为空串）。 */
export function 解析有内容(结果: 解析人物结果): boolean {
  return Object.values(结果.字段).some((值) => (值 ?? '').trim().length > 0);
}

/** 服装草稿 → 可写进角色卡的服装条目。 */
export function 服装草稿转条目(草稿: 服装草稿, id = 新建服装Id()): 服装条目 {
  return {
    id,
    name: 草稿.name || 草稿.英文名称 || '未命名服装',
    上半身: 草稿.上半身,
    下半身: 草稿.下半身,
    全身: 草稿.全身,
    负面: 草稿.负面,
    英文名称: 草稿.英文名称,
    归属人: 草稿.归属人,
    上半身背面: 草稿.上半身背面,
    下半身背面: 草稿.下半身背面,
  };
}

export function 新建服装Id(): string {
  return `outfit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 把角色卡渲染回 `<人物>` 文本（上游 `buildCharacterText`，补了「角色特征」）。 */
export function 角色卡转人物文本(角色: 角色卡): string {
  const 行: string[] = ['<人物>'];
  for (const [标签, 键] of 部位输出顺序) 行.push(`${标签}: ${角色[键] ?? ''}`);
  行.push('</人物>');
  return 行.join('\n');
}

/** 输出用的中文字段名与顺序，对齐「人物生成」提示词里的格式。 */
export const 部位输出顺序: Array<[string, keyof 角色部位字段]> = [
  ['中文名称', 'nameCN'],
  ['英文名称', 'nameEN'],
  ['角色特征', 'characterTraits'],
  ['五官外貌', 'facialFeatures'],
  ['五官外貌背面', 'facialFeaturesBack'],
  ['上半身SFW', 'upperBodySFW'],
  ['上半身SFW背面', 'upperBodySFWBack'],
  ['下半身SFW', 'fullBodySFW'],
  ['下半身SFW背面', 'fullBodySFWBack'],
  ['上半身NSFW', 'upperBodyNSFW'],
  ['上半身NSFW背面', 'upperBodyNSFWBack'],
  ['下半身NSFW', 'fullBodyNSFW'],
  ['下半身NSFW背面', 'fullBodyNSFWBack'],
];

export interface 生成角色特征请求 {
  /** 用户描述 / 追加要求（可以只写名字与几句设定）。 */
  要求: string;
  /** 当前正在编辑的角色卡；有内容时会作为「现有设定」一起发过去。 */
  角色?: 角色卡;
  /** 生效的提示词；留空则报错，由调用方决定回退。 */
  提示词: string;
  /** 上一次生成时的上下文（`generationContext`），有就一并带上。 */
  生成上下文?: string;
}

/** 拼两次消息：system 是「人物生成」提示词，user 是本次任务与现有设定。 */
export function 构建角色特征消息(请求: 生成角色特征请求): LLM消息[] {
  const 要求 = (请求.要求 ?? '').trim();
  const 现有 = 请求.角色 && !角色卡为空(请求.角色) ? 角色卡转人物文本(请求.角色) : '';
  const 上下文 = (请求.生成上下文 ?? '').trim();

  const 段: string[] = [];
  段.push('请按上面的格式，为下面这个角色生成特征。每个字段都是 Stable Diffusion 可用的英文 tag，'
    + '并在括号里给出中文翻译；背面字段必须一起给出。');
  if (要求) 段.push(`【用户要求 / 角色设定】\n${要求}`);
  if (上下文) 段.push(`【生成时的上下文】\n${上下文}`);
  if (现有) {
    段.push('【当前角色卡（可以改写、补全或纠正其中不合适的部分）】\n' + 现有);
  } else {
    段.push('【当前角色卡】\n（空白，需要从零生成全部字段）');
  }
  段.push('直接输出 <人物>…</人物> 区块；如果这次还生成了服装，可以在其后追加 <服装>…</服装> 区块。');

  return [
    { role: 'system', content: 请求.提示词 },
    { role: 'user', content: 段.join('\n\n') },
  ];
}

export interface 生成角色特征依赖 {
  /** 传入已拼好的消息链，返回模型原始文本。 */
  请求: (消息: LLM消息[], signal?: AbortSignal) => Promise<string>;
}

export interface 生成角色特征结果 extends 解析人物结果 {
  原始回复: string;
}

/**
 * 跑一次生成。解析不到任何字段时**不抛错**，把原始回复交回界面显示——
 * 空回、被审查、格式跑偏的处置方式都不一样，界面需要原文才能说清。
 */
export async function 生成角色特征(
  依赖: 生成角色特征依赖,
  请求: 生成角色特征请求,
  signal?: AbortSignal,
): Promise<生成角色特征结果> {
  const 消息 = 构建角色特征消息(请求);
  const 原始回复 = await 依赖.请求(消息, signal);
  return { ...解析人物区块(原始回复), 原始回复 };
}

/**
 * 把选中的字段写回角色卡；未选中的字段保持原值。
 *
 * 空值不覆盖：模型偶尔会漏掉某个字段（尤其 NSFW 段被审查时），
 * 这时把已有内容抹成空串是最糟的结果。
 */
export function 合并生成字段(
  角色: 角色卡,
  字段: Partial<角色部位字段>,
  选中: Array<keyof 角色部位字段>,
): 角色卡 {
  const 下一份 = { ...角色 } as 角色卡;
  for (const 键 of 选中) {
    const 值 = 字段[键];
    if (值 === undefined || 值 === null || String(值).trim() === '') continue;
    下一份[键] = String(值).trim();
  }
  下一份.updatedAt = Date.now();
  return 下一份;
}

/** 该角色卡是否全空——空卡不需要把「现有设定」发给模型。 */
export function 角色卡为空(角色: 角色卡 | undefined): boolean {
  if (!角色) return true;
  return 角色部位字段名.every((键) => (角色[键] ?? '').trim() === '');
}

/** 从设置里取生效的「人物生成」提示词。 */
export function 取角色生成提示词(设置: 文生图系统设置): string {
  return (设置.角色AI?.提示词 ?? '').trim();
}
