/**
 * ComfyUI 生图引擎。
 *
 * 派生自 st-chatu8（智绘姬）`generateComfyUIImage`（index.js L47148-L47705）、
 * `comfyuigenerate`（L47706-L47760）、`replacepro`（L47103-L47147）、
 * `processSkippedNodes`（L45489-L45592）与 `handleComfyuiCancel`（L47797-L47845）。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：① 去掉「酒馆客户端」服务端代理分支，只保留浏览器直连；
 *   ② 把节点错误格式化接进普通生图链路（来源只接在视频链路上，见 comfyError.ts）；
 *   ③ 并发额度在取消时同步归还，修掉来源 L47178 的额度泄漏；
 *   ④ 去掉视频、RunningHub 与重绘对话框，保留重绘占位符的替换能力。
 *
 * 关键行为（必须保持，否则「和酒馆不一样」）：
 *   - 参数定位是**按 token 文本替换**，绝不按 class_type 查找节点。
 *   - 轮询先立即一次，之后固定 1000ms；全程没有 WebSocket。
 *   - 结果一律是 `data:` URL。
 */

import type { ComfyUI参数设置, ComfyUI设置 } from '@/models/genSystem';
import { 替换工作流占位符, 扫描剩余占位符 } from './workflowTokens';
import {
  中断Comfy任务,
  读取Comfy历史,
  读取Comfy图片,
  提交Comfy工作流,
  提取Comfy输出媒体,
  上传参考图,
  规范化Comfy地址,
  COMFY轮询间隔毫秒,
} from './comfyClient';
import { ComfyConcurrencyGate, ComfyQueueAbort } from './comfyGate';
import { 格式化ComfyUI错误, 规范化ComfyUI异常消息 } from './comfyError';
import type { ComfyUI工作流, 生成请求, 生成结果 } from './types';

/** 面板上「连接后选择」的哨兵值，表示用户还没选模型。 */
export const 未选择模型 = '连接后选择';

const 闸门表 = new Map<string, { 闸门: ComfyConcurrencyGate; 上限: number }>();

function 取闸门(地址: string, 最大并发: number): ComfyConcurrencyGate {
  const 键 = 规范化Comfy地址(地址);
  const 现有 = 闸门表.get(键);
  if (现有 && 现有.上限 === 最大并发) return 现有.闸门;
  const 闸门 = new ComfyConcurrencyGate(最大并发);
  闸门表.set(键, { 闸门, 上限: 最大并发 });
  return 闸门;
}

/** 活跃任务表，用于取消。来源 `activeComfyuiTasks` L47782。 */
const 活跃任务 = new Map<string, { controller: AbortController; promptId?: string; 地址: string }>();

export function 登记任务(任务Id: string, 地址: string): AbortController {
  const controller = new AbortController();
  活跃任务.set(任务Id, { controller, 地址: 规范化Comfy地址(地址) });
  return controller;
}

export async function 取消任务(任务Id: string): Promise<void> {
  const 任务 = 活跃任务.get(任务Id);
  if (!任务) return;
  任务.controller.abort();
  await 中断Comfy任务(任务.地址, 任务.promptId);
}

export function 任务是否活跃(任务Id: string): boolean {
  return 活跃任务.has(任务Id);
}

/** 来源 L9167：种子为 0 / "" / -1 时随机；上限 1e10。 */
export function 生成随机种子(): number {
  return Math.floor(Math.random() * 1e10);
}

export function 解析种子(种子: number | string): number {
  const 值 = typeof 种子 === 'number' ? 种子 : Number(String(种子).trim());
  if (!Number.isFinite(值) || 值 === 0 || 值 === -1) return 生成随机种子();
  return Math.trunc(值);
}

/** `\\{2,}` → `\`，对齐来源的模型名归一化。 */
export function 规范化反斜杠路径(值: string): string {
  return 值.replace(/\\{2,}/g, '\\');
}

function 取模型名(参数: ComfyUI参数设置): string {
  const 原始 = 参数.模型.trim();
  if (!原始 || 原始 === 未选择模型) return '';
  return 规范化反斜杠路径(原始);
}

function 取可选资源值(值: string, 回退: unknown): string {
  const 裁剪 = 值.trim();
  if (!裁剪 || 裁剪 === 未选择模型) return typeof 回退 === 'string' ? 回退 : '';
  return 裁剪;
}

/** 参考图在缓存里的文件名（避免每次重新上传）。 */
const 参考图缓存 = new Map<string, string>();

async function 准备参考图(
  地址: string,
  参考图: 生成请求['参考图'],
): Promise<string> {
  if (!参考图?.数据地址) return '';
  const 缓存键 = `${规范化Comfy地址(地址)}::${参考图.文件名}::${参考图.数据地址.length}`;
  const 已缓存 = 参考图缓存.get(缓存键);
  if (已缓存) return 已缓存;
  const blob = await (await fetch(参考图.数据地址)).blob();
  const 名称 = await 上传参考图(地址, blob, 参考图.文件名);
  参考图缓存.set(缓存键, 名称);
  return 名称;
}

/**
 * 跳节点处理：删除 `_skip` 节点，并把指向它们的输入重映射到上游。
 *
 * 派生自 `processSkippedNodes`（L45489-L45592）。来源按 `objectInfo` 的输入类型
 * 择优接入，这里保留同一策略。
 */
export function 处理跳过节点(
  工作流: ComfyUI工作流,
  objectInfo: Record<string, unknown> = {},
): ComfyUI工作流 {
  const 跳过集合 = new Set(Object.entries(工作流).filter(([, 节点]) => 节点?._skip).map(([id]) => id));
  if (跳过集合.size === 0) {
    return Object.fromEntries(Object.entries(工作流).map(([id, 节点]) => [id, { ...节点, _skip: undefined }]));
  }

  const 清理后: ComfyUI工作流 = {};
  for (const [id, 节点] of Object.entries(工作流)) {
    if (跳过集合.has(id)) continue;
    const { _skip: _丢弃, ...其余 } = 节点;
    void _丢弃;
    清理后[id] = { ...其余 };
  }

  /** 沿跳过链向上找到第一个存活节点；返回 `[节点id, 输出槽]`。 */
  const 追溯 = (节点Id: string, 槽位: unknown): [string, number] | null => {
    let 当前: string | undefined = 节点Id;
    let 当前槽 = typeof 槽位 === 'number' ? 槽位 : 0;
    const 已访问 = new Set<string>();
    while (当前 && 跳过集合.has(当前)) {
      if (已访问.has(当前)) return null;
      已访问.add(当前);
      const 节点 = 工作流[当前];
      const 输入 = 节点?.inputs ?? {};
      const 候选 = Object.entries(输入).find(([, 值]) => Array.isArray(值) && typeof 值[0] === 'string');
      if (!候选) return null;
      const [上游Id, 上游槽] = 候选[1] as [string, unknown];
      当前 = 上游Id;
      当前槽 = typeof 上游槽 === 'number' ? 上游槽 : 0;
    }
    return 当前 ? [当前, 当前槽] : null;
  };

  const 节点输入类型 = (节点Id: string, 输入名: string): string[] => {
    const 类名 = 工作流[节点Id]?.class_type;
    if (!类名) return [];
    const 定义 = objectInfo[类名];
    if (!定义 || typeof 定义 !== 'object') return [];
    const 必填 = (定义 as { input?: { required?: Record<string, unknown> } }).input?.required;
    const 候选 = 必填?.[输入名];
    if (!Array.isArray(候选)) return [];
    const 类型 = 候选[0];
    if (typeof 类型 === 'string') return [类型];
    if (Array.isArray(类型)) return 类型.filter((项): 项 is string => typeof 项 === 'string');
    return [];
  };

  for (const 节点 of Object.values(清理后)) {
    const 输入 = 节点.inputs;
    if (!输入) continue;
    for (const [输入名, 值] of Object.entries(输入)) {
      if (!Array.isArray(值) || typeof 值[0] !== 'string') continue;
      if (!跳过集合.has(值[0])) continue;
      const 目标 = 追溯(值[0], 值[1]);
      if (!目标) continue;
      const 目标Id = 目标[0];
      const 目标槽 = 目标[1];
      const 期望类型 = 节点输入类型(目标Id, 输入名);
      // 被跳过节点把不同类型的两路接在一起时，直连会让下游拿到错误类型；
      // objectInfo 可用时改接同类型的旁路上游。缺失时按来源的直接接入处理。
      if (期望类型.length > 0) {
        const 替代 = Object.keys(清理后).find((候选Id) => {
          if (候选Id === 目标Id) return false;
          return 节点输入类型(候选Id, 输入名).some((项) => 期望类型.includes(项));
        });
        if (替代) {
          输入[输入名] = [替代, 目标槽];
          continue;
        }
      }
      输入[输入名] = [目标Id, 目标槽];
    }
  }

  return 清理后;
}

function 解析工作流文本(文本: string): ComfyUI工作流 {
  const 裁剪 = 文本.trim();
  if (!裁剪) throw new Error('ComfyUI 工作流为空。请在设置里导入 API 格式工作流。');
  let 解析后: unknown;
  try {
    解析后 = JSON.parse(裁剪);
  } catch (错误) {
    throw new Error(`ComfyUI 工作流 JSON 无效: ${错误 instanceof Error ? 错误.message : String(错误)}`);
  }
  if (!解析后 || typeof 解析后 !== 'object' || Array.isArray(解析后)) {
    throw new Error('ComfyUI 工作流必须是 API 格式的对象。');
  }
  return 解析后 as ComfyUI工作流;
}

export interface Comfy生成上下文 {
  comfyui: ComfyUI设置;
  对象信息?: Record<string, unknown>;
  任务Id?: string;
}

export async function 生成ComfyUI图片(
  请求: 生成请求,
  上下文: Comfy生成上下文,
): Promise<生成结果> {
  const 档案 = 上下文.comfyui.档案列表[上下文.comfyui.当前档案];
  if (!档案) throw new Error(`ComfyUI 配置档案不存在：${上下文.comfyui.当前档案}`);
  const 参数 = 档案.参数;
  const 地址 = 规范化Comfy地址(档案.连接.地址);
  if (!地址) throw new Error('请先填写 ComfyUI 地址。');

  const 模型名 = 取模型名(参数);
  if (!模型名) {
    if (参数.模型.trim() === 未选择模型) throw new Error('请填写 ComfyUI 模型。');
    throw new Error('ComfyUI 模型名为空或只包含空白字符。');
  }

  const 任务Id = 上下文.任务Id ?? `comfy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const 外部信号 = 请求.signal;
  const controller = 登记任务(任务Id, 地址);
  const 合并信号 = 外部信号
    ? AbortSignal.any([外部信号, controller.signal])
    : controller.signal;

  const 闸门 = 取闸门(地址, 档案.连接.最大并发);
  let 已获额度 = false;
  const 归档 = 活跃任务.get(任务Id);

  try {
    await 闸门.获取(合并信号);
    已获额度 = true;

    const 宽度 = Math.max(64, Math.trunc(请求.宽度 ?? 参数.宽度));
    const 高度 = Math.max(64, Math.trunc(请求.高度 ?? 参数.高度));
    const 种子 = 解析种子(请求.种子 ?? 参数.种子);
    const 参考图文件名 = 上下文.comfyui.参考图上传 && 请求.参考图
      ? await 准备参考图(地址, 请求.参考图)
      : '';

    let 工作流文本 = 档案.工作流Json;
    if (!工作流文本.trim()) {
      throw new Error('ComfyUI 工作流为空。请在设置里导入 API 格式工作流。');
    }

    // 先做跳节点重映射，再做 token 替换：替换是纯文本的，重映射会改结构。
    const 工作流对象 = 解析工作流文本(工作流文本);
    const 有跳过 = Object.values(工作流对象).some((节点) => 节点?._skip);
    if (有跳过) {
      工作流文本 = JSON.stringify(处理跳过节点(工作流对象, 上下文.对象信息 ?? {}));
    }

    const 替换后 = 替换工作流占位符(工作流文本, {
      seed: 种子,
      steps: 参数.步数,
      cfgScale: 参数.cfg,
      samplerName: 取可选资源值(参数.采样器, 'euler'),
      scheduler: 取可选资源值(参数.调度器, 'normal'),
      width: 宽度,
      height: 高度,
      prompt: 请求.正向提示词,
      negativePrompt: 请求.负向提示词,
      modelName: 模型名,
      vae: 取可选资源值(参数.vae, ''),
      clip: 取可选资源值(参数.clip, ''),
      ipaPreset: 参数.ipa预设,
      ipaWeight: 参数.ipa权重,
      ipaFaceWeight: 参数.ipa面部权重,
      ipaDetailStrength: 参数.ipa细节强度,
      ipaAtmosphereStrength: 参数.氛围强度,
      referenceImage: 参考图文件名,
      inpaintDenoise: 参数.重绘强度,
    });

    let 最终工作流: ComfyUI工作流;
    try {
      最终工作流 = JSON.parse(替换后) as ComfyUI工作流;
    } catch (错误) {
      const 剩余 = 扫描剩余占位符(替换后);
      throw new Error(
        剩余.length > 0
          ? `ComfyUI 工作流占位符替换后不是合法 JSON，剩余占位符：${剩余.join('、')}。数值型占位符必须写成 "seed": "%seed%"（带双引号）。`
          : `ComfyUI 工作流占位符替换后不是合法 JSON：${错误 instanceof Error ? 错误.message : String(错误)}`,
      );
    }

    const promptId = await 提交Comfy工作流(地址, 最终工作流, 合并信号);
    if (归档) 归档.promptId = promptId;

    const 超时毫秒 = (Math.max(1, Math.trunc(档案.连接.超时秒数 || 1800))) * 1000;
    const 起点 = Date.now();
    let 轮次 = 0;
    for (;;) {
      if (合并信号.aborted) throw new ComfyQueueAbort();
      if (Date.now() - 起点 > 超时毫秒 || 轮次 > Math.ceil(超时毫秒 / COMFY轮询间隔毫秒)) {
        throw new Error(`ComfyUI 服务器超时（已超过 ${Math.round(超时毫秒 / 60000)} 分钟）。`);
      }

      const 历史 = await 读取Comfy历史(地址, promptId, 合并信号);
      if (历史) {
        const 状态 = 历史.status;
        if (状态?.status_str === 'error') {
          throw new Error(格式化ComfyUI错误({ status_str: 'error', messages: 状态.messages, exception_message: 状态.exception_message }, 'ComfyUI 执行错误'));
        }
        const 媒体 = 提取Comfy输出媒体(历史);
        if (!媒体) throw new Error('未能从API响应中找到文件名。');
        if (媒体.isVideo) throw new Error('该工作流输出的是视频；本版本只处理图片，请检查工作流输出节点。');
        const blob = await 读取Comfy图片(地址, 媒体, 合并信号);
        const 数据地址 = await new Promise<string>((resolve, reject) => {
          const 读取器 = new FileReader();
          读取器.onload = () => resolve(typeof 读取器.result === 'string' ? 读取器.result : '');
          读取器.onerror = () => reject(读取器.error ?? new Error('读取生成图片失败。'));
          读取器.readAsDataURL(blob);
        });
        if (!数据地址) throw new Error('未能生成图片 URL。');
        return {
          数据地址,
          mimeType: blob.type || 'image/png',
          模型: 模型名,
          渠道: 'comfyui',
          宽度,
          高度,
          种子,
        };
      }

      await new Promise((resolve) => globalThis.setTimeout(resolve, COMFY轮询间隔毫秒));
      轮次 += 1;
    }
  } catch (错误) {
    const 原始 = 错误 instanceof Error ? 错误.message : String(错误);
    if (错误 instanceof ComfyQueueAbort || 合并信号.aborted) throw new ComfyQueueAbort();
    throw new Error(规范化ComfyUI异常消息(原始), { cause: 错误 });
  } finally {
    活跃任务.delete(任务Id);
    闸门.释放(已获额度);
  }
}
