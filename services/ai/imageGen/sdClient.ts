/**
 * Stable Diffusion WebUI（A1111 / Forge）载荷构造与客户端。
 *
 * 派生自 st-chatu8（智绘姬）index.js：
 *   `sdGenerate` / `generateSDImage` 的载荷段 L80065-L80109、
 *   端点 `/sdapi/v1/txt2img` L80195、种子语义 L80065-L80069。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-15；
 *   修改目的：① 去掉酒馆服务端代理分支，只保留浏览器直连 A1111；
 *   ② 上游把 `steps` / `cfg_scale` / `hr_scale` 等以**字符串**直接发出去
 *   （设置里全是字符串），依赖服务端容错。这里显式转成数字，避免不同版本的
 *   A1111 对字符串参数行为不一致；③ 保留上游的 `override_settings` 用法。
 *
 * LoRA 沿用上游约定：`<lora:名称:权重>` 直接写在提示词里，由 A1111 自己解析。
 * 这是刻意的——用 token 而不是结构化数组，才能同时兼容 ComfyUI 工作流文本。
 */

import type { SD设置 } from '@/models/genSystem';

export interface SD载荷输入 {
  设置: SD设置;
  正向提示词: string;
  负向提示词: string;
  宽度?: number;
  高度?: number;
  种子?: number;
}

/**
 * 上游种子语义：空 / 负 / 非数字都表示随机（`seed = -1` 交给服务端随机）。
 *
 * 注意**不能**用 `Number('')`：它得到 0，而 0 在 A1111 里是有效固定种子。
 * 空值必须先判掉，否则「没填种子」会静默变成「每次都用种子 0」。
 */
export function 解析SD种子(种子: number | string | undefined): number {
  if (种子 === undefined || 种子 === null) return -1;
  if (typeof 种子 === 'string' && 种子.trim() === '') return -1;
  const 值 = typeof 种子 === 'number' ? 种子 : Number(种子.trim());
  if (!Number.isFinite(值) || 值 < 0) return -1;
  return Math.trunc(值);
}

/** 高清修复的第二次采样步数：上游 `0` 表示「用主步数」。 */
export function 归一化第二轮步数(值: number, 主步数: number): number {
  const 有效主步数 = Number.isFinite(主步数) ? Math.max(1, Math.trunc(主步数)) : 1;
  if (!Number.isFinite(值) || 值 <= 0) return 有效主步数;
  return Math.trunc(值);
}

export function 构造SD载荷(输入: SD载荷输入): Record<string, unknown> {
  const { 设置 } = 输入;
  const 主步数 = Math.max(1, Math.trunc(设置.步数));
  const 载荷: Record<string, unknown> = {
    prompt: 输入.正向提示词,
    negative_prompt: 输入.负向提示词,
    sampler_name: 设置.采样器,
    scheduler: 设置.调度器,
    steps: 主步数,
    cfg_scale: 设置.cfg,
    width: Math.max(64, Math.trunc(输入.宽度 ?? 设置.宽度)),
    height: Math.max(64, Math.trunc(输入.高度 ?? 设置.高度)),
    restore_faces: 设置.面部修复,
    enable_hr: 设置.高清修复,
    hr_upscaler: 设置.高清放大算法,
    hr_scale: 设置.高清放大倍数,
    hr_additional_modules: [],
    denoising_strength: 设置.高清去噪强度,
    hr_second_pass_steps: 归一化第二轮步数(设置.高清第二轮步数, 主步数),
    seed: 解析SD种子(输入.种子 ?? 设置.种子),
    override_settings: {
      CLIP_stop_at_last_layers: Number.isFinite(设置.CLIP跳过层) ? 设置.CLIP跳过层 : 1,
      sd_vae: 设置.VAE,
    },
    override_settings_restore_afterwards: true,
    save_images: true,
    send_images: true,
    do_not_save_grid: false,
    do_not_save_samples: false,
  };

  // ADetailer 的 args 是位置参数：先两个布尔开关，再是参数字典。
  if (设置.ADetailer) {
    载荷.alwayson_scripts = {
      ADetailer: {
        args: [
          true,
          true,
          { ad_model: 'face_yolov8n.pt' },
        ],
      },
    };
  }

  return 载荷;
}

export function 规范化SD地址(地址: string): string {
  return 地址.trim().replace(/\/+$/, '');
}

export function 拼接SDPath(地址: string, 路径: string): string {
  const 基址 = 规范化SD地址(地址);
  return `${基址}${路径.startsWith('/') ? 路径 : `/${路径}`}`;
}

/** 基础认证头；上游用 `st_chatu8_sd_auth`。留空则不发 Authorization。 */
export function SD认证头(认证: string): Record<string, string> {
  const 裁剪 = 认证.trim();
  if (!裁剪) return {};
  // 已带 scheme 时原样用，否则按 `user:pass` 做 Basic。
  if (/^basic\s+/i.test(裁剪)) return { Authorization: 裁剪 };
  return { Authorization: `Basic ${btoa(裁剪)}` };
}

export interface SD响应 {
  字节: Uint8Array;
  mimeType: string;
  /** 服务端回传的 info，含实际 seed 等；解析失败时为 null。 */
  信息: Record<string, unknown> | null;
}

/** 解析 `/sdapi/v1/txt2img` 的响应体。 */
export function 解析SD响应(数据: unknown): SD响应 {
  if (!数据 || typeof 数据 !== 'object') throw new Error('SD WebUI 返回的内容不是对象。');
  const 记录 = 数据 as { images?: unknown; info?: unknown };
  const 列表 = Array.isArray(记录.images) ? 记录.images : [];
  const 首张 = 列表.find((项): 项 is string => typeof 项 === 'string' && 项.length > 0);
  if (!首张) throw new Error('SD WebUI 没有返回图片，请检查模型是否已加载。');

  // 服务端回的是裸 base64（不带 data URL 前缀），但也见过带前缀的实现。
  const 纯Base64 = 首张.replace(/^data:image\/\w+;base64,/, '');
  const 二进制 = atob(纯Base64);
  const 字节 = new Uint8Array(二进制.length);
  for (let i = 0; i < 二进制.length; i += 1) 字节[i] = 二进制.charCodeAt(i);

  let 信息: Record<string, unknown> | null = null;
  if (typeof 记录.info === 'string' && 记录.info.trim()) {
    try {
      信息 = JSON.parse(记录.info) as Record<string, unknown>;
    } catch {
      // info 是附加信息，解析失败不该让出图失败。
      信息 = null;
    }
  } else if (记录.info && typeof 记录.info === 'object') {
    信息 = 记录.info as Record<string, unknown>;
  }

  return { 字节, mimeType: 嗅探图片类型(字节), 信息 };
}

function 嗅探图片类型(字节: Uint8Array): string {
  if (字节[0] === 0x89 && 字节[1] === 0x50) return 'image/png';
  if (字节[0] === 0xff && 字节[1] === 0xd8) return 'image/jpeg';
  if (字节[0] === 0x52 && 字节[1] === 0x49) return 'image/webp';
  return 'image/png';
}

export async function 请求SD图片(
  设置: SD设置,
  载荷: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<SD响应> {
  const 地址 = 规范化SD地址(设置.地址);
  if (!地址) throw new Error('请先填写 SD WebUI 地址。');
  const 端点 = 拼接SDPath(地址, '/sdapi/v1/txt2img');

  const 响应 = await fetch(端点, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...SD认证头(设置.认证) },
    body: JSON.stringify(载荷),
    signal,
  });

  if (!响应.ok) {
    const 文本 = await 响应.text().catch(() => '');
    throw new Error(`SD WebUI 请求失败：HTTP ${响应.status}${文本 ? ` ${文本.slice(0, 300)}` : ''}`);
  }

  return 解析SD响应(await 响应.json());
}

/** 读取模型 / 采样器 / VAE 列表，供设置页下拉。 */
export interface SD可选资源 {
  模型: string[];
  采样器: string[];
  VAE: string[];
  调度器: string[];
  放大算法: string[];
}

export async function 读取SD资源列表(设置: SD设置, signal?: AbortSignal): Promise<SD可选资源> {
  const 地址 = 规范化SD地址(设置.地址);
  if (!地址) throw new Error('请先填写 SD WebUI 地址。');
  const 头 = SD认证头(设置.认证);

  const 取列表 = async (路径: string, 字段: string): Promise<string[]> => {
    const 响应 = await fetch(拼接SDPath(地址, 路径), { headers: 头, signal });
    if (!响应.ok) throw new Error(`${路径} 请求失败：HTTP ${响应.status}`);
    const 数据 = (await 响应.json()) as unknown;
    if (!Array.isArray(数据)) return [];
    return 数据
      .map((项) => {
        if (!项 || typeof 项 !== 'object') return '';
        const 值 = (项 as Record<string, unknown>)[字段];
        return typeof 值 === 'string' ? 值 : '';
      })
      .filter(Boolean);
  };

  const 取字符串数组 = async (路径: string): Promise<string[]> => {
    const 响应 = await fetch(拼接SDPath(地址, 路径), { headers: 头, signal });
    if (!响应.ok) return [];
    const 数据 = (await 响应.json()) as unknown;
    return Array.isArray(数据) ? 数据.filter((项): 项 is string => typeof 项 === 'string') : [];
  };

  const [模型, 采样器, VAE, 调度器, 放大算法] = await Promise.all([
    取列表('/sdapi/v1/sd-models', 'title'),
    取列表('/sdapi/v1/samplers', 'name'),
    取列表('/sdapi/v1/sd-vae', 'model_name'),
    取字符串数组('/sdapi/v1/schedulers'),
    取字符串数组('/sdapi/v1/upscalers'),
  ]);

  return { 模型, 采样器, VAE, 调度器, 放大算法 };
}
