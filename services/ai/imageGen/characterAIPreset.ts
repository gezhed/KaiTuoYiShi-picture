/**
 * 「角色 AI 预设」的导入 / 导出。
 *
 * 为什么要有它：角色 AI 的提示词序列（破甲对话 + 格式规格）本来内置在代码里，
 * 但那让每个用户都背着一份自己没看过的提示词，也不好换。现在默认空白，
 * 预设以 JSON 文件形式流通（仓库里放了一份在 `文生图教程/`）。
 *
 * 导入刻意做宽松：社区导出的格式五花八门，少认一种用户就会以为「导入没反应」。
 * 目前覆盖：
 *   ① 本应用的信封：`{ _format: 'kaituoyishi-character-ai-preset', 角色AI: { 消息: [...] } }`；
 *   ② 通用导出信封：`{ data: … }`（递归一层，参照 LLM 预设导入的做法）；
 *   ③ 直接给消息数组，或 `{ 消息 | messages | entries | prompts | items: [...] }`；
 *   ④ 单条消息对象（`{ role, content }`）也当一条收下。
 *
 * 不做的事：不校验提示词内容、不限制条数——那是用户自己的预设。
 */
import type { 角色AI消息, 角色AI设置 } from '@/models/genSystem';
import { 归一化角色AI消息列表 } from '@/models/genSystem';

export const 角色AI预设格式 = 'kaituoyishi-character-ai-preset';
export const 角色AI预设版本 = '1.0';

/** 导出文件里除消息外的采样参数；缺省表示「用当前设置里的值」。 */
export interface 角色AI预设参数 {
  附加要求?: string;
  温度?: number;
  最大输出?: number;
  重试次数?: number;
}

export interface 角色AI预设 {
  名称?: string;
  说明?: string;
  消息: 角色AI消息[];
  参数?: 角色AI预设参数;
}

export interface 解析角色AI预设结果 {
  预设?: 角色AI预设;
  错误?: string;
}

const 消息键 = ['消息', 'messages', 'entries', 'prompts', 'items', 'preset'] as const;

function 取数字(值: unknown, 最小: number, 最大: number): number | undefined {
  const 数 = typeof 值 === 'number' ? 值 : Number(值);
  if (!Number.isFinite(数)) return undefined;
  return Math.min(最大, Math.max(最小, 数));
}

function 取字符串(值: unknown): string | undefined {
  return typeof 值 === 'string' && 值.trim() ? 值.trim() : undefined;
}

/** 从任意一层对象里收集消息数组；找不到返回 null。 */
function 取消息数组(根: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(根)) return 根;
  for (const 键 of 消息键) {
    if (Array.isArray(根[键])) return 根[键] as unknown[];
  }
  // 单条消息对象：直接收下，别让用户为了一个字段去包一层数组。
  if (typeof 根.role === 'string' && typeof 根.content === 'string') return [根];
  return null;
}

function 提参数(根: Record<string, unknown>): 角色AI预设参数 | undefined {
  const 源 = (根.参数 && typeof 根.参数 === 'object' ? 根.参数 : 根) as Record<string, unknown>;
  const 参数: 角色AI预设参数 = {};
  const 附加 = 取字符串(源.附加要求);
  if (附加 !== undefined) 参数.附加要求 = 附加;
  const 温度 = 取数字(源.温度 ?? 源.temperature, 0, 2);
  if (温度 !== undefined) 参数.温度 = 温度;
  const 最大输出 = 取数字(源.最大输出 ?? 源.maxTokens ?? 源.max_tokens, 256, 1_000_000);
  if (最大输出 !== undefined) 参数.最大输出 = Math.trunc(最大输出);
  const 重试次数 = 取数字(源.重试次数 ?? 源.retries, 0, 5);
  if (重试次数 !== undefined) 参数.重试次数 = Math.trunc(重试次数);
  return Object.keys(参数).length > 0 ? 参数 : undefined;
}

/**
 * 解析一份预设文本。解析不出消息时给出**具体原因**（而不是静默空手而归）。
 */
export function 解析角色AI预设文本(文本: string): 解析角色AI预设结果 {
  const 原文 = (文本 ?? '').trim();
  if (!原文) return { 错误: '文件是空的。' };
  let 解析: unknown;
  try {
    解析 = JSON.parse(原文);
  } catch (错误) {
    return { 错误: `不是合法的 JSON：${错误 instanceof Error ? 错误.message : String(错误)}` };
  }

  const 试 = (值: unknown, 深度: number): 角色AI预设 | null => {
    if (深度 > 4) return null;
    if (Array.isArray(值)) {
      const 消息 = 归一化角色AI消息列表(值);
      return 消息.length > 0 ? { 消息 } : null;
    }
    if (!值 || typeof 值 !== 'object') return null;
    const 根 = 值 as Record<string, unknown>;

    // 信封：`{ data: … }` / `{ 角色AI: … }` 往里递归一层。
    for (const 键 of ['data', '角色AI', 'characterAI', '预设', 'preset']) {
      const 内层 = 根[键];
      if (内层 && typeof 内层 === 'object') {
        const 结果 = 试(内层, 深度 + 1);
        if (结果) {
          // 名称/说明/参数在信封外层写了也算数。
          return {
            ...结果,
            名称: 结果.名称 ?? 取字符串(根.名称 ?? 根.name),
            说明: 结果.说明 ?? 取字符串(根.说明 ?? 根.description),
            参数: 结果.参数 ?? 提参数(根),
          };
        }
      }
    }

    const 数组 = 取消息数组(根);
    if (!数组) return null;
    const 消息 = 归一化角色AI消息列表(数组);
    if (消息.length === 0) return null;
    return {
      名称: 取字符串(根.名称 ?? 根.name),
      说明: 取字符串(根.说明 ?? 根.description),
      消息,
      参数: 提参数(根),
    };
  };

  const 预设 = 试(解析, 0);
  if (!预设) return { 错误: '文件里没有可用的提示词消息（支持消息数组，或含 消息/messages/entries 键的对象）。' };
  return { 预设 };
}

/** 把消息序列与参数导出成可流通的 JSON 文本（键序稳定，便于进版本库比对）。 */
export function 导出角色AI预设文本(
  预设: 角色AI预设,
): string {
  const { 消息, 参数 } = 预设;
  const 信封: Record<string, unknown> = {
    _format: 角色AI预设格式,
    _version: 角色AI预设版本,
    ...(预设.名称 ? { 名称: 预设.名称 } : {}),
    ...(预设.说明 ? { 说明: 预设.说明 } : {}),
    角色AI: {
      消息: 消息.map((项) => ({
        id: 项.id,
        role: 项.role,
        content: 项.content,
        enabled: 项.enabled !== false,
      })),
      ...(参数?.附加要求 ? { 附加要求: 参数.附加要求 } : {}),
      ...(参数?.温度 !== undefined ? { 温度: 参数.温度 } : {}),
      ...(参数?.最大输出 !== undefined ? { 最大输出: 参数.最大输出 } : {}),
      ...(参数?.重试次数 !== undefined ? { 重试次数: 参数.重试次数 } : {}),
    },
  };
  return `${JSON.stringify(信封, null, 2)}\n`;
}

/** 从当前设置导出（面板的「导出当前预设」用它）。 */
export function 从设置导出预设文本(角色AI: 角色AI设置, 名称?: string): string {
  return 导出角色AI预设文本({
    名称,
    说明: '角色 AI 提示词预设：按顺序发送，最后追加本次生成任务。',
    消息: 角色AI.消息,
    参数: {
      附加要求: 角色AI.附加要求,
      温度: 角色AI.温度,
      最大输出: 角色AI.最大输出,
      重试次数: 角色AI.重试次数,
    },
  });
}

/** 触发浏览器下载；非浏览器环境（测试）直接跳过。 */
export function 下载文本文件(文件名: string, 文本: string): void {
  const 文档 = (globalThis as { document?: Document }).document;
  const 造地址 = (globalThis as { URL?: typeof URL }).URL?.createObjectURL;
  if (!文档 || typeof 造地址 !== 'function') return;
  const 链接 = 文档.createElement('a');
  const 地址 = 造地址(new Blob([文本], { type: 'application/json' }));
  链接.href = 地址;
  链接.download = 文件名;
  文档.body.appendChild(链接);
  链接.click();
  链接.remove();
  globalThis.setTimeout(() => (globalThis as { URL?: typeof URL }).URL?.revokeObjectURL?.(地址), 0);
}
