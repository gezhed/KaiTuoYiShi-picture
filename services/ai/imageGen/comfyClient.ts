/**
 * ComfyUI HTTP 客户端。
 *
 * 派生自 st-chatu8（智绘姬）`utils/comfyuiAdapter.js`（index.js L46997-L47075）与
 * `utils/comfyui.js` 的网络段（L47399-L47680）。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：把散落在生成函数里的裸 fetch 抽成带超时与取消的客户端；原实现的
 *   「酒馆客户端」分支依赖 SillyTavern 服务端路由（/api/sd/comfy/*），此处只保留
 *   浏览器直连分支，并显式抛出可读错误。
 *
 * 端点与顺序严格对齐来源：POST /prompt（无鉴权头）→ GET /history/{id}（先立即一次、
 * 之后固定 1000ms）→ GET /view?filename=…&subfolder=…&type=output。
 * 来源没有任何 WebSocket，轮询是唯一的进度机制。
 */

import type { ComfyUI工作流 } from './types';
import { 格式化ComfyUI错误 } from './comfyError';

export const COMFY_CLIENT_ID = '533ef3a3-39c0-4e39-9ced-37d290f371f8';
export const COMFY轮询间隔毫秒 = 1000;

/** ComfyUI 单节点历史输出。 */
export interface Comfy输出媒体 {
  filename: string;
  subfolder: string;
  type: string;
  isVideo: boolean;
}

export interface Comfy历史条目 {
  status?: { status_str?: string; messages?: unknown[]; exception_message?: string };
  outputs?: Record<string, { images?: Array<{ filename?: unknown; subfolder?: unknown; type?: unknown }>; gifs?: Array<{ filename?: unknown; subfolder?: unknown; type?: unknown }> }>;
}

export function 规范化Comfy地址(地址: string): string {
  return 地址.trim().replace(/\/+$/, '');
}

function 拼接(地址: string, 路径: string): string {
  const 基址 = 规范化Comfy地址(地址);
  return `${基址}${路径.startsWith('/') ? 路径 : `/${路径}`}`;
}

async function 读Json(response: Response): Promise<unknown> {
  const 文本 = await response.text().catch(() => '');
  if (!文本.trim()) return null;
  try {
    return JSON.parse(文本);
  } catch {
    return 文本;
  }
}

export async function 提交Comfy工作流(
  地址: string,
  工作流: ComfyUI工作流,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(拼接(地址, '/prompt'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: COMFY_CLIENT_ID, prompt: 工作流 }),
    signal,
  });
  const 文本 = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(格式化ComfyUI错误(文本, `ComfyUI 请求失败, 状态码: ${response.status}`));
  }
  const 数据 = 文本.trim() ? (JSON.parse(文本) as { prompt_id?: unknown }) : null;
  const promptId = 数据?.prompt_id;
  if (typeof promptId !== 'string' || !promptId.trim()) {
    throw new Error('ComfyUI 未返回 prompt_id。');
  }
  return promptId;
}

export async function 读取Comfy历史(地址: string, promptId: string, signal?: AbortSignal): Promise<Comfy历史条目 | null> {
  const response = await fetch(拼接(地址, `/history/${encodeURIComponent(promptId)}`), { signal });
  if (!response.ok) {
    throw new Error(`ComfyUI 历史查询失败: ${response.status}`);
  }
  const 数据 = (await 读Json(response)) as Record<string, Comfy历史条目> | null;
  return 数据?.[promptId] ?? null;
}

/** 从历史输出的优先级链里取第一个可用媒体，对齐来源 L47600-L47610。 */
export function 提取Comfy输出媒体(条目: Comfy历史条目): Comfy输出媒体 | null {
  const 输出列表 = 条目.outputs && typeof 条目.outputs === 'object' ? Object.values(条目.outputs) : [];
  for (const 输出 of 输出列表) {
    if (!输出) continue;
    const 动图 = Array.isArray(输出.gifs) ? 输出.gifs[0] : undefined;
    if (动图?.filename) {
      return {
        filename: String(动图.filename),
        subfolder: typeof 动图.subfolder === 'string' ? 动图.subfolder : '',
        type: typeof 动图.type === 'string' ? 动图.type : 'output',
        isVideo: true,
      };
    }
    const 图片列表 = Array.isArray(输出.images) ? 输出.images : [];
    const 视频文件 = 图片列表.find((项) => 项?.type === 'output' && /\.(mp4|webm|mkv|mov|avi)$/i.test(String(项.filename ?? '')));
    const 图片 = 视频文件 ?? 图片列表.find((项) => 项?.type === 'output') ?? 图片列表[0];
    if (图片?.filename) {
      return {
        filename: String(图片.filename),
        subfolder: typeof 图片.subfolder === 'string' ? 图片.subfolder : '',
        type: typeof 图片.type === 'string' ? 图片.type : 'output',
        isVideo: Boolean(视频文件),
      };
    }
  }
  return null;
}

export async function 读取Comfy图片(
  地址: string,
  媒体: { filename: string; subfolder: string; type: string },
  signal?: AbortSignal,
): Promise<Blob> {
  const 参数 = new URLSearchParams({
    filename: 媒体.filename,
    subfolder: encodeURIComponent(媒体.subfolder),
    type: 媒体.type,
  });
  const response = await fetch(拼接(地址, `/view?${参数.toString()}`), { signal });
  if (!response.ok) {
    throw new Error(`获取图片失败,状态码: ${response.status}`);
  }
  return response.blob();
}

/** 中断与清队列：`/api/interrupt`（注意不是 `/interrupt`）与 `/queue delete`。 */
export async function 中断Comfy任务(地址: string, promptId?: string): Promise<void> {
  const 任务: Promise<unknown>[] = [];
  if (promptId) {
    任务.push(
      fetch(拼接(地址, '/queue'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete: [promptId] }),
      }).catch(() => undefined),
    );
  }
  任务.push(fetch(拼接(地址, '/api/interrupt'), { method: 'POST' }).catch(() => undefined));
  await Promise.all(任务);
}

/** 参考图上传：multipart/form-data，字段名 `image`，带 `overwrite=true`。 */
export async function 上传参考图(地址: string, 文件: Blob, 文件名: string): Promise<string> {
  const 表单 = new FormData();
  表单.append('image', 文件, 文件名);
  表单.append('overwrite', 'true');
  const response = await fetch(拼接(地址, '/upload/image'), { method: 'POST', body: 表单 });
  if (!response.ok) {
    const 文本 = await response.text().catch(() => '');
    throw new Error(`ComfyUI 参考图上传失败: ${文本 || response.status}`);
  }
  const 数据 = (await 读Json(response)) as { name?: unknown; subfolder?: unknown } | null;
  const 名称 = typeof 数据?.name === 'string' ? 数据.name : '';
  if (!名称) throw new Error('ComfyUI 参考图上传未返回文件名。');
  const 子目录 = typeof 数据?.subfolder === 'string' ? 数据.subfolder : '';
  return 子目录 ? `${子目录}/${名称}` : 名称;
}

export async function 探测Comfy存活(地址: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(拼接(地址, '/system_stats'), { signal });
    return response.ok;
  } catch {
    return false;
  }
}

/** `/object_info` 驱动的模型列表，对齐来源 L89504-L89518 的节点类型集合。 */
export interface Comfy可选资源 {
  模型: string[];
  采样器: string[];
  调度器: string[];
  vae: string[];
  clip: string[];
  lora: string[];
}

export const Comfy资源节点: Record<keyof Comfy可选资源, Array<{ 节点: string; 输入: string }>> = {
  模型: [
    { 节点: 'CheckpointLoaderSimple', 输入: 'ckpt_name' },
    { 节点: 'UNETLoader', 输入: 'unet_name' },
    { 节点: 'UnetLoaderGGUF', 输入: 'unet_name' },
  ],
  采样器: [{ 节点: 'KSampler', 输入: 'sampler_name' }],
  调度器: [{ 节点: 'KSampler', 输入: 'scheduler' }],
  vae: [{ 节点: 'VAELoader', 输入: 'vae_name' }],
  clip: [
    { 节点: 'CLIPLoader', 输入: 'clip_name' },
    { 节点: 'CLIPLoaderGGUF', 输入: 'clip_name' },
  ],
  lora: [{ 节点: 'LoraLoader', 输入: 'lora_name' }],
};

export async function 读取Comfy资源列表(地址: string, signal?: AbortSignal): Promise<{ 资源: Comfy可选资源; objectInfo: Record<string, unknown> }> {
  const response = await fetch(拼接(地址, '/object_info'), { signal });
  if (!response.ok) {
    throw new Error(`ComfyUI 资源列表请求失败, 状态码: ${response.status}`);
  }
  const objectInfo = ((await 读Json(response)) ?? {}) as Record<string, unknown>;
  const 资源: Comfy可选资源 = { 模型: [], 采样器: [], 调度器: [], vae: [], clip: [], lora: [] };
  for (const [键, 映射表] of Object.entries(Comfy资源节点) as Array<[keyof Comfy可选资源, Array<{ 节点: string; 输入: string }>]>) {
    const 收集 = new Set<string>();
    for (const { 节点, 输入 } of 映射表) {
      const 节点信息 = objectInfo[节点];
      if (!节点信息 || typeof 节点信息 !== 'object') continue;
      const 输入表 = (节点信息 as { input?: { required?: Record<string, unknown> } }).input?.required;
      const 候选 = 输入表?.[输入];
      if (!Array.isArray(候选) || !Array.isArray(候选[0])) continue;
      for (const 项 of 候选[0] as unknown[]) {
        if (typeof 项 === 'string' && 项.trim()) 收集.add(项);
      }
    }
    资源[键] = [...收集];
  }
  return { 资源, objectInfo };
}
