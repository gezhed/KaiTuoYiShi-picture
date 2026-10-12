/**
 * LLM：让 LLM 读正文并产出插图提示词。
 *
 * 派生自 st-chatu8（智绘姬）index.js：
 *   `LLMRequestTypes.IMAGE_GEN` L2409、`handlePromptRequest` L38919 →
 *   `processImageLikeRequest` L39259、`buildPromptForRequestType` L20924、
 *   `replaceAllPlaceholders` L19730、`normalizeImagesReply` L16435/L16726、
 *   `buildParseFailureToastInfo` L38471-L38589。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：① 走直连 `/chat/completions`，去掉酒馆服务端代理；
 *   ② 把重试与失败诊断从 toast 里剥出来变成返回值，便于界面呈现与测试；
 *   ③ 保留来源的输出协议不变——这是社区预设能直接导入的前提。
 *
 * 输出协议**不是 JSON**，是两层文本。每张图一条 `<image>`：
 *
 *   <images>
 *   <image>
 *   regex:<正文里逐字出现的一行，用来决定插在哪一行之后>
 *   image### <提示词> ###
 *   </image>
 *   </images>
 *
 * 多图与「每张图自己决定分辨率」都靠这个结构：每张图一个 `<image>`，
 * 分辨率写成提示词末尾的 `WxH`，由 `剥出尺寸` 取走。
 */

import type { LLM条目, LLM设置 } from '@/models/genSystem';
import { 解析插图提示词, type 解析插图 } from './illustrationProtocol';
import { 应用词汇替换规则, 解析词汇替换规则 } from './wordReplacement';

/** 来源里的占位符集合（L39386-L39397）。缺失能力时按空串替换。 */
export const 占位符清单 = [
  '{{上下文}}',
  '{{正文}}',
  '{{世界书触发}}',
  '{{用户需求}}',
  '{{角色启用列表}}',
  '{{通用角色启用列表}}',
  '{{通用服装启用列表}}',
  '{{秒数}}',
  '{{视频秒数}}',
] as const;

export interface LLM输入 {
  正文: string;
  上下文?: string;
  世界书触发?: string;
  用户需求?: string;
  角色启用列表?: string;
  通用角色启用列表?: string;
  通用服装启用列表?: string;
}

export interface LLM消息 {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 按来源的替换顺序把占位符换成实际内容；未知占位符留空而不是原样保留。 */
export function 填充占位符(模板: string, 输入: LLM输入): string {
  const 映射: Record<string, string> = {
    '{{正文}}': 输入.正文 ?? '',
    '{{上下文}}': 输入.上下文 ?? '',
    '{{世界书触发}}': 输入.世界书触发 ?? '',
    '{{用户需求}}': 输入.用户需求 ?? '',
    '{{角色启用列表}}': 输入.角色启用列表 ?? '',
    '{{通用角色启用列表}}': 输入.通用角色启用列表 ?? '',
    '{{通用服装启用列表}}': 输入.通用服装启用列表 ?? '',
    '{{秒数}}': '',
    '{{视频秒数}}': '',
  };
  let 结果 = 模板;
  for (const [键, 值] of Object.entries(映射)) 结果 = 结果.replaceAll(键, 值);
  return 结果;
}

/** 按当前预设拼出一次请求的消息链；条目为空时抛错而不是发空请求。 */
export function 构建LLM消息(
  设置: LLM设置,
  输入: LLM输入,
): LLM消息[] {
  const 预设 = 设置.预设列表[设置.当前预设];
  if (!预设) throw new Error(`LLM预设不存在：${设置.当前预设}`);
  const 启用条目 = 预设.entries.filter((条目) => 条目.enabled !== false);
  if (启用条目.length === 0) {
    throw new Error('LLM预设没有任何启用的条目。请在设置里导入社区预设或自己编写 system 条目。');
  }

  const 命中 = 启用条目.filter((条目) => 条目是否触发(条目, 输入));
  if (命中.length === 0) {
    throw new Error('LLM预设的条目本次都没有触发，检查触发方式与触发词。');
  }

  const 消息 = 命中
    .slice()
    .sort((甲, 乙) => 排序权重(甲) - 排序权重(乙))
    .map((条目) => ({ role: 条目.role, content: 填充占位符(条目.content, 输入) }));

  return 保证以用户轮结尾(
    展开掷骰占位符(替换工具名(合并相邻同角色(丢弃空消息(消息)), 默认工具名)),
    输入,
  );
}

/** 丢掉内容为空的条目（上游 `dropKnownEmptyMessages` L19640，判据是 trim 后非空）。 */
export function 丢弃空消息(消息: LLM消息[]): LLM消息[] {
  return 消息.filter((项) => (项.content ?? '').trim().length > 0);
}

const 随机字符集 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 上游 `createSeededRandom` L19909：mulberry32，逐位与 JS 的 32 位语义对齐。 */
function 建可重复随机(种子: number): () => number {
  let 状态 = 种子;
  return () => {
    状态 += 1831565813;
    let 混 = 状态;
    混 = Math.imul(混 ^ (混 >>> 15), 混 | 1);
    混 ^= 混 + Math.imul(混 ^ (混 >>> 7), 混 | 61);
    return ((混 ^ (混 >>> 14)) >>> 0) / 4294967296;
  };
}

function 可重复随机串(种子: number, 长度 = 8): string {
  const 随机 = 建可重复随机(种子);
  let 结果 = '';
  for (let 位 = 0; 位 < 长度; 位 += 1) {
    结果 += 随机字符集[Math.floor(随机() * 随机字符集.length)];
  }
  return 结果;
}

/** `{{roll N}}` / `{{roll 1dN}}`，大小写不敏感。 */
const 掷骰模式 = /\{\{roll\s+(?:1d)?(\d+)\}\}/gi;

/**
 * 把 `{{roll N}}` 展开成随机串。
 *
 * 派生自上游 `processRollPlaceholders` L19943 / `processRollInContent` L19926。
 *
 * 为什么必须做：社区预设在**示例输出**里塞了大量 `{{roll 1999999}}`，用途是
 * 给「每次都要不一样」的字段（种子等）提供随机值。原样发给模型时，模型会把这串
 * 字面量当成需要模仿的内容，既浪费输出额度，也可能让它照抄而不是产出提示词。
 * 酒馆能正常工作，就是因为它先展开再发。
 */
export function 展开掷骰占位符(消息: LLM消息[]): LLM消息[] {
  return 消息.map((项) => ({
    ...项,
    content: 项.content.replace(掷骰模式, (匹配, 上限文本: string) => {
      let 上限 = Number.parseInt(上限文本, 10);
      if (!Number.isFinite(上限) || 上限 <= 0) 上限 = 100000;
      return 可重复随机串(Math.floor(Math.random() * (上限 + 1)));
    }),
  }));
}

/**
 * 合并相邻的同角色消息，内容用换行连接。
 *
 * 派生自上游 `mergeAdjacentMessages` L19661-L19694。
 *
 * 这一条**必须做**：社区预设常把说明拆成上百条同角色条目
 * （实测 `llm预设2.json` 有 184 条，其中 177 条是 `user`）。
 * 逐条发出去会让请求体变成几百条 message，模型侧直接 429（实测报错），
 * 或返回空内容——而同一份预设在酒馆里正常，正是因为酒馆走了这个合并。
 */
export function 合并相邻同角色(消息: LLM消息[]): LLM消息[] {
  const 结果: LLM消息[] = [];
  for (const 项 of 消息) {
    const 上一条 = 结果[结果.length - 1];
    if (上一条 && 上一条.role === 项.role) {
      上一条.content = `${上一条.content}\n${项.content}`;
    } else {
      结果.push({ ...项 });
    }
  }
  return 结果;
}

/**
 * 保证消息链以 `user` 结尾。
 *
 * 为什么要做这件事：社区预设的**最后一条通常是 assistant 的示例输出**
 * （few-shot 示范该按什么格式回复），而正文是通过 `{{正文}}` 占位符填在中间某条里的。
 * 于是整条链以 model 轮结尾——Gemini 一类的接口会直接拒收：
 * 「Requests ending with a model turn are not supported.」（HTTP 400）
 *
 * 这里在末尾补一条 user 消息把任务再说一遍。补的这条**不是**重复正文：
 * 示例输出之后需要一个明确的「现在照这个格式产出」指令，模型才知道该输出了。
 * 预设本身已经以 user 结尾时（例如条目里 `{{正文}}` 就是最后一条）不做改动。
 */
function 保证以用户轮结尾(消息: LLM消息[], 输入: LLM输入): LLM消息[] {
  const 末条 = 消息[消息.length - 1];
  // 以 user 结尾才算合格。以 system 结尾同样会被拒（整条链没有待回答的用户轮）。
  if (末条?.role === 'user') return 消息;

  const 正文 = (输入.正文 ?? '').trim();
  const 指令 = 正文
    ? `现在处理下面这段正文，按上面的格式与要求产出插图提示词。\n\n${正文}`
    : '现在按上面的格式与要求产出插图提示词。';

  return [...消息, { role: 'user', content: 指令 }];
}

function 排序权重(条目: LLM条目): number {
  if (条目.role === 'system') return 0;
  if (条目.role === 'user') return 1;
  return 2;
}

function 条目是否触发(条目: LLM条目, 输入: LLM输入): boolean {
  if (条目.触发方式 === 'always') return true;
  if (条目.触发方式 === 'manual') return false;
  const 触发词 = 条目.触发词.filter(Boolean);
  if (触发词.length === 0) return true;
  const 干草 = `${输入.正文}\n${输入.上下文 ?? ''}\n${输入.用户需求 ?? ''}`.toLowerCase();
  const 命中 = 触发词.map((词) => 干草.includes(词.toLowerCase()));
  return 条目.与触发 ? 命中.every(Boolean) : 命中.some(Boolean);
}

export interface 调用LLM依赖 {
  /** 传入 `signal` 与已拼好的消息链，返回模型原始文本。 */
  请求: (消息: LLM消息[], signal?: AbortSignal) => Promise<string>;
  /** 请求方把传输层诊断回填进来，供失败文案区分成因。 */
  取诊断?: () => 传输诊断 | undefined;
  /**
   * 预设用 `%TOOL_NAME%` 指代工具名。声明了工具就把它换掉，
   * 否则模型会照着「用 %TOOL_NAME% 工具回复」的字面指示而给不出有效输出。
   */
  工具名?: string;
}

/** 智绘姬系预设要求的工具名（上游 L20029 / L2281）。 */
export const 默认工具名 = 'thought_and_context';

/** 预设要求模型只用 toolcall 回复时留给模型的工具声明。 */
export const 思考工具声明 = [{
  type: 'function',
  function: {
    name: 默认工具名,
    description: '必须使用这个工具来进行内容思考和正文回复',
    parameters: {
      type: 'object',
      properties: {
        thought_and_context: { type: 'string', description: '你的思考与正文' },
      },
      required: ['thought_and_context'],
    },
  },
}];

/**
 * 把 `%TOOL_NAME%` 换成真实工具名。
 *
 * 上游在 `injectTailMessages` L20074 做同样的事。不换的话，预设里
 * 「不要使用 Text/Content 直出，而是使用 %TOOL_NAME% toolcall 工具进行回复」
 * 这句会变成对模型的一段无效指令，它既没有工具可用、又被禁止直出文本，
 * 于是返回空内容且 `finishReason=stop`。
 */
export function 替换工具名(消息: LLM消息[], 工具名: string): LLM消息[] {
  return 消息.map((项) => ({
    ...项,
    content: 项.content.replaceAll('%TOOL_NAME%', 工具名).replaceAll('TOOL_NAME%', 工具名),
  }));
}

/**
 * 上一次请求的传输层诊断。
 *
 * 为什么需要：空回有很多种成因（安全拦截、输出额度被思维链吃光、内容只落在
 * `reasoning_content`、代理实现差异），它们的**现象完全一样**——正文是空字符串。
 * 但接口返回的 `finishReason` 能把它们区分开：`SAFETY` 是拦截，
 * `MAX_TOKENS` 是额度，`undefined` + 有 reasoning 是分流。没有它只能靠猜。
 */
export interface 传输诊断 {
  finishReason?: string;
  sawReasoning?: boolean;
  sawVisibleContent?: boolean;
  selectedModel?: string;
  /** 响应键结构摘要，空回时用来判断内容到底落在哪个字段。 */
  响应结构?: string;
  /** 本次请求要求的最大输出。 */
  请求最大输出?: number;
}

export interface LLM结果 {
  插图: 解析插图[];
  原始回复: string;
  /** 重试了几次（0 表示一次成功）。 */
  重试次数: number;
}

/** 失败原因分类，对齐来源的五分支诊断（L38471-L38589）。 */
export type LLM失败原因 =
  | 'empty'
  | 'still_processing'
  | 'missing_container_children'
  | 'no_tags'
  | 'missing_anchor_or_tag';

export interface LLM失败 {
  原因: LLM失败原因;
  文案: string;
  原始回复: string;
}

export function 诊断解析失败(原始回复: string, 传输?: 传输诊断): LLM失败 {
  const 文本 = 原始回复 ?? '';
  if (!文本.trim()) {
    // 到这里为止都是「空回」。空回的成因必须靠 finishReason 区分，否则用户和我
    // 都只能猜——实测 Gemini 3f 就是这种情况。
    const 因 = (传输?.finishReason ?? '').toUpperCase();
    if (因 === 'SAFETY' || 因 === 'PROHIBITED_CONTENT' || 因 === 'BLOCKLIST') {
      return {
        原因: 'empty',
        文案: `模型以安全策略为由拒绝返回内容（finishReason=${传输?.finishReason}）。`
          + '这不是本应用能绕过的：换一个未开启内容审查的模型或中转，或调整预设里触发审查的措辞。',
        原始回复: 文本,
      };
    }
    if (因 === 'MAX_TOKENS') {
      return {
        原因: 'empty',
        文案: `模型把输出额度用完了却没产出正文（finishReason=MAX_TOKENS）。`
          + '常见于思考型模型把额度花在推理上：到「LLM 预设」页把「最大输出」调大，或换一个非思考模型。',
        原始回复: 文本,
      };
    }
    if (传输?.sawReasoning) {
      return {
        原因: 'empty',
        文案: '接口只返回了推理内容（reasoning_content），正文为空。'
          + '这是中转把思考内容与正文分流导致的：换一个中转，或关掉该模型的思考模式。',
        原始回复: 文本,
      };
    }
    const 后缀 = 传输?.finishReason ? `（finishReason=${传输.finishReason}）` : '';
    const 结构 = 传输?.响应结构 ? `\n接口返回的结构：${传输.响应结构}` : '';
    // `prompt_tokens=0` 是「请求根本没到模型」的铁证，直接点出来，省得继续调提示词。
    const 未到模型 = /prompt_tokens=0\b/.test(传输?.响应结构 ?? '');
    const 提示 = 未到模型
      ? '\n注意：返回的 prompt_tokens 为 0，说明这次请求**没有到达模型**，'
        + '是在网关/中转层就被拦下了（参数不被支持、体积过大、或鉴权差异）。'
        + '此时调整提示词或预设都不会有任何效果，应先排查中转。'
      : '';
    const 输出说明 = 传输?.请求最大输出 ? `\n本次请求的最大输出：${传输.请求最大输出}。` : '';
    return {
      原因: 'empty',
      文案: `模型返回为空${后缀}。请检查模型名、额度与网络。`
        + '若确认额度正常，多半是内容审查或思考额度被耗尽——可在「LLM 预设」页调大「最大输出」后再试。'
        + 输出说明 + 结构 + 提示,
      原始回复: 文本,
    };
  }
  if (/正在(处理|生成)|请稍候|processing|please wait/i.test(文本)) {
    return {
      原因: 'still_processing',
      文案: '模型看起来还在处理上一条请求，稍后会自动重试。若持续出现，请降低并发或换一个模型。',
      原始回复: 文本,
    };
  }
  if (/<images>/.test(文本) && !/<image>/.test(文本)) {
    return {
      原因: 'missing_container_children',
      文案: '模型给出了 <images> 容器但没有 <image> 块。这通常说明预设被截断或模型没按格式输出。',
      原始回复: 文本,
    };
  }
  const 标记 = 文本.match(/image###[\s\S]*?###/);
  if (!标记) {
    return {
      原因: 'no_tags',
      文案: '回复里完全没有插图标记。请确认预设里写清了 image###提示词### 的输出格式。',
      原始回复: 文本,
    };
  }
  return {
    原因: 'missing_anchor_or_tag',
    文案: '回复里有标记但缺少 regex: 锚点行，无法决定插图插在正文的哪一行之后。',
    原始回复: 文本,
  };
}

/**
 * 修复常见的格式瑕疵后再解析一次。
 *
 * 对齐来源的 `normalizeImagesReply`：补 `<images>` 容器、把中文标点包围的
 * 标记归一、把整段裸 `image###…###` 包进容器。
 */
export function 修复回复格式(文本: string): string {
  let 结果 = 文本 ?? '';
  if (!/<images>/i.test(结果) && /image###[\s\S]*?###/.test(结果)) {
    结果 = `<images>\n${结果}\n</images>`;
  }
  if (/<images>[\s\S]*?<\/image>/i.test(结果) && !/<\/images>/i.test(结果)) {
    结果 += '\n</images>';
  }
  // 全角尖括号与全角标记。
  结果 = 结果.replace(/＜/g, '<').replace(/＞/g, '>');
  结果 = 结果.replace(/image###\s*/g, 'image###');
  return 结果;
}

export interface 生成插图提示词请求 {
  /** 已解析的回复文本。调用方负责剥掉思考块等非正文内容。 */
  回复: string;
  输入: LLM输入;
  设置: LLM设置;
  /** 提示词入站前的 `"ai"` 词汇替换映射文本；留空则不做。 */
  词汇替换映射?: string;
  signal?: AbortSignal;
}

export interface 生成插图提示词结果 {
  插图: 解析插图[];
  原始回复: string;
  重试次数: number;
  诊断?: LLM失败;
  /** 最后一次请求的传输层诊断，用于区分空回的成因。 */
  传输诊断?: 传输诊断;
}

/**
 * 让模型为一条回复生成插图提示词。
 *
 * 重试策略与来源一致：解析不到插图就重问，最多 `重试次数` 次。
 * 全部失败时返回空插图与诊断，**不抛错**——自动配图链路上抛错会打断回合落地。
 */
export async function 生成插图提示词(
  依赖: 调用LLM依赖,
  请求: 生成插图提示词请求,
): Promise<生成插图提示词结果> {
  const 规则 = 请求.词汇替换映射 ? 解析词汇替换规则(请求.词汇替换映射) : [];
  const 最大重试 = Math.max(0, Math.trunc(请求.设置.重试次数));

  let 最后一次原始 = '';
  for (let 尝试 = 0; 尝试 <= 最大重试; 尝试 += 1) {
    const 消息 = 构建LLM消息(请求.设置, 请求.输入);
    const 原始 = await 依赖.请求(消息, 请求.signal);
    最后一次原始 = 原始;

    // 先剥思维链，再做词汇替换与解析：思维链里常有残缺的 <images> 草稿，会污染解析。
    const 去思考 = 剥掉思维链(原始);
    // 词汇替换必须发生在解析之前（来源在 `parseImagesFromPrompt` 第一行就做）。
    const 清洗后 = 规则.length > 0 ? 应用词汇替换规则(去思考, 规则) : 去思考;
    let 插图 = 解析插图提示词(清洗后);
    if (插图.length === 0) 插图 = 解析插图提示词(修复回复格式(清洗后));

    if (插图.length > 0) {
      return { 插图, 原始回复: 原始, 重试次数: 尝试 };
    }
  }

  return {
    插图: [],
    原始回复: 最后一次原始,
    重试次数: 最大重试,
    诊断: 诊断解析失败(最后一次原始, 依赖.取诊断?.()),
    传输诊断: 依赖.取诊断?.(),
  };
}

/**
 * 剥掉思维链块。
 *
 * 为什么必须做：预设要求先在 `<thinking>` 里按序号思考，而模型经常在思维链里
 * **预演一份 `<images>` 草稿**（有时还是被截断的）。实测用户的 Gemini 回复里，
 * `<thinking>` 内部就有一段残缺的 `<images><image><regex>…`。
 *
 * 解析器按「最后一个完整 `<images>` 块」取内容，但思维链里的残缺块会让容器匹配
 * 落到错误的位置，结果只解析出一张 9 个字符的假提示词——正文里自然什么也插不进去。
 */
export function 剥掉思维链(文本: string): string {
  return 文本
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    // 未闭合的 <thinking>（被截断时）直接丢到末尾。
    .replace(/<thinking>[\s\S]*$/i, '');
}

/** 按每轮上限截断；`上限 <= 0` 表示不限制。 */
export function 截断插图数量(插图: 解析插图[], 上限: number): 解析插图[] {
  if (!Number.isFinite(上限) || 上限 <= 0) return 插图;
  return 插图.slice(0, Math.trunc(上限));
}
