/**
 * Banana / Grok（OpenAI 兼容图像接口）客户端。
 *
 * 派生自 st-chatu8（智绘姬）index.js：
 *   `resolveGrokGenerationsUrl` L47901-L47919、`generateBananaImage` 的载荷与响应段
 *   L48300-L48435（`generationsPayload`、响应里 `data[0]` / `images[]` / `image` 三种形态、
 *   `b64_json`|`base64`|`url` 三种取图路径）。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-15；
 *   修改目的：① 上游把这一渠道整个包裹在 `taskQueue` 与 toast 里；
 *   这里抽成纯函数，队列与提示由外层负责；
 *   ② 上游支持 `edits`（带参考图走 multipart）与视频分流，本应用第一版只做
 *   `/v1/images/generations` 纯文生图，理由与 SD 渠道一致：参考图的渠道表达
 *   要三处一起设计（见 `referenceImage.ts` 的修改声明）。
 */

import type { Banana设置 } from '@/models/genSystem';

export function 规范化Banana地址(地址: string): string {
  return 地址.trim().replace(/\/+$/, '');
}

/**
 * 推导 generations 端点。
 *
 * 与上游同序（L47901-L47919）：自定义端点优先（绝对地址直接用，相对路径拼在基址后）；
 * 否则按基址形态判断——已带 `/images/generations` 或 `/image/generation` 就原样用，
 * 带 `/images/edits` 就替换掉，`/v1` 或 `/v1beta` 结尾就补 `/images/generations`，
 * 其余补 `/v1/images/generations`。
 */
export function Banana生成端点(设置: Banana设置): string {
  const 基址 = 规范化Banana地址(设置.地址);
  const 自定义 = 设置.自定义端点.trim();
  if (自定义) {
    if (/^https?:\/\//i.test(自定义)) return 自定义;
    if (!基址) return '';
    return `${基址}${自定义.startsWith('/') ? 自定义 : `/${自定义}`}`;
  }
  if (!基址) return '';
  if (/\/images\/generations$/i.test(基址) || /\/image\/generation$/i.test(基址)) return 基址;
  if (/\/images\/edits$/i.test(基址) || /\/image\/edit$/i.test(基址)) {
    return 基址.replace(/\/images?\/edits?$/i, '/images/generations');
  }
  if (/\/v1$/i.test(基址) || /\/v1beta$/i.test(基址)) return `${基址}/images/generations`;
  return `${基址}/v1/images/generations`;
}

/**
 * 推导 edits（带参考图）端点。
 *
 * 与 `Banana生成端点` 同构但方向相反（上游 L47920-L47938）。
 * 注意 `保真度` 与上游一致：`edits` 走 multipart 时只带第一张参考图（L48327），
 * 因为该接口的 `image` 字段只接受单张。
 */
export function Banana编辑端点(设置: Banana设置): string {
  const 基址 = 规范化Banana地址(设置.地址);
  const 自定义 = 设置.自定义端点.trim();
  if (自定义) {
    if (/^https?:\/\//i.test(自定义)) return 自定义;
    if (!基址) return '';
    return `${基址}${自定义.startsWith('/') ? 自定义 : `/${自定义}`}`;
  }
  if (!基址) return '';
  if (/\/images\/edits$/i.test(基址) || /\/image\/edit$/i.test(基址)) return 基址;
  if (/\/images\/generations$/i.test(基址) || /\/image\/generation$/i.test(基址)) {
    return 基址.replace(/\/images?\/generations?$/i, '/images/edits');
  }
  if (/\/v1$/i.test(基址) || /\/v1beta$/i.test(基址)) return `${基址}/images/edits`;
  return `${基址}/v1/images/edits`;
}

export interface Banana载荷输入 {
  设置: Banana设置;
  正向提示词: string;
  /** `宽x高`；给出时覆盖设置里的尺寸。 */
  尺寸?: string;
}

/** 上游：`imagen*` 模型不发 `size`（L48280）。 */
export function Banana是否发尺寸(模型: string): boolean {
  return !模型.trim().toLowerCase().startsWith('imagen');
}

export function 构造Banana载荷(输入: Banana载荷输入): Record<string, unknown> {
  const { 设置 } = 输入;
  const 模型 = 设置.模型.trim();
  const 载荷: Record<string, unknown> = {
    model: 模型,
    prompt: 输入.正向提示词,
    n: 1,
  };
  const 尺寸 = (输入.尺寸 ?? 设置.尺寸).trim();
  if (尺寸 && Banana是否发尺寸(模型)) 载荷.size = 尺寸;
  if (设置.响应格式 !== 'none') 载荷.response_format = 设置.响应格式;
  return 载荷;
}

export interface Banana响应 {
  数据地址: string;
  mimeType: string;
  /** 远端原始地址；从 b64 得到结果时为空。 */
  原始地址?: string;
}

function 猜测Mime(地址: string): string {
  if (/\.jpe?g(\?|$)/i.test(地址)) return 'image/jpeg';
  if (/\.webp(\?|$)/i.test(地址)) return 'image/webp';
  return 'image/png';
}

function blob转数据地址(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const 读取器 = new FileReader();
    读取器.onload = () => resolve(typeof 读取器.result === 'string' ? 读取器.result : '');
    读取器.onerror = () => reject(读取器.error ?? new Error('读取图片失败。'));
    读取器.readAsDataURL(blob);
  });
}

/**
 * 从 OpenAI 兼容响应里取图。
 *
 * 兼容上游认得的全部形态（L48390-L48412）：
 * `data[0].b64_json` / `data[0].base64` / `data[0].url`，
 * 顶层 `images[0]`（字符串或对象）、顶层 `image`。
 */
export function 提取Banana图片项(数据: unknown): { b64?: string; url?: string } | null {
  if (!数据 || typeof 数据 !== 'object') return null;
  const 记录 = 数据 as Record<string, unknown>;
  const 数据列表 = Array.isArray(记录.data) ? 记录.data : [];
  const 首项 = 数据列表[0] as Record<string, unknown> | undefined;
  const 候选 = 首项
    ?? (Array.isArray(记录.images) && 记录.images.length > 0
      ? (typeof 记录.images[0] === 'string' ? { b64_json: 记录.images[0] } : 记录.images[0] as Record<string, unknown>)
      : undefined)
    ?? (记录.image ? { b64_json: 记录.image } : undefined);
  if (!候选 || typeof 候选 !== 'object') return null;

  const b64 = 候选.b64_json ?? 候选.base64;
  const url = 候选.url;
  const 结果: { b64?: string; url?: string } = {};
  if (typeof b64 === 'string' && b64.trim()) 结果.b64 = b64.trim();
  if (typeof url === 'string' && url.trim()) 结果.url = url.trim();
  return (结果.b64 || 结果.url) ? 结果 : null;
}

export interface BananaResponse {
  数据地址: string;
  mimeType: string;
  /** 远端原始地址；从 b64 得到结果时为空。 */
  原始地址?: string;
}

/** 上游 edits 接口的发送形态（L48319-L48358）。 */
export type Banana编辑格式 = 'form_data' | 'json';

export interface Banana请求参数 {
  设置: Banana设置;
  载荷: Record<string, unknown>;
  /** 参考图数据地址。给出时改走 edits 接口。 */
  参考图?: string | null;
   /** edits 的发送形态；上游默认 `form_data`。 */
  编辑格式?: Banana编辑格式;
  signal?: AbortSignal;
}

/** 数据地址 → Blob。edits 的 multipart 分支需要真实字节。 */
export async function 数据地址转Blob(数据地址: string): Promise<Blob> {
  const 响应 = await fetch(数据地址);
  if (!响应.ok) throw new Error(`参考图读取失败：HTTP ${响应.status}`);
  const blob = await 响应.blob();
  if (!blob.size) throw new Error('参考图内容为空。');
  return blob;
}

export async function 请求Banana图片(
  参数: Banana请求参数,
): Promise<BananaResponse> {
  const { 设置, 载荷, 参考图, signal } = 参数;
  const key = 设置.APIKey.trim();
  if (!key) throw new Error('请先填写 Banana / Grok 的 API Key。');

  const 有参考图 = Boolean(参考图);
  const 端点 = 有参考图 ? Banana编辑端点(设置) : Banana生成端点(设置);
  if (!端点) throw new Error('请先填写 Banana / Grok 地址。');

  let 请求头: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
  let 请求体: BodyInit;

  // 编辑格式从设置读（上游的 `bananaSettings.grokEditsFormat`）。
  // 早先这里误写成读 `参数.编辑格式`——参数上没有这个字段，恒为 undefined，
  // 于是 JSON 模式永远落进 multipart 分支；multipart 因默认值恰好相同而掩盖了错误。
  const 编辑格式 = 参数.编辑格式 ?? 设置.编辑格式;

  // 注意顺序：JSON 模式**不能**走 数据地址转Blob——参考图本身已经是数据地址，
  // 再去 fetch 它等于把 data URL 当网址请求，纯属浪费且会掩盖真实错误。
  if (!有参考图) {
    请求体 = JSON.stringify(载荷);
  } else if (编辑格式 === 'json') {
    // JSON 模式：把参考图直接塞进载荷的 image 字段（上游 L48330-L48340）。
    请求体 = JSON.stringify({ ...载荷, image: 参考图 });
  } else {
    // multipart 模式：上游的默认形态（L48343-L48358）。
    const 表单 = new FormData();
    表单.append('image', await 数据地址转Blob(参考图 as string), 'image.png');
    表单.append('prompt', String(载荷.prompt ?? ''));
    表单.append('model', String(载荷.model ?? ''));
    表单.append('n', String(载荷.n ?? 1));
    if (载荷.size !== undefined) 表单.append('size', String(载荷.size));
    if (载荷.response_format !== undefined) 表单.append('response_format', String(载荷.response_format));
    请求体 = 表单;
    // Content-Type 必须让浏览器自己带 boundary，故只留认证头。
    请求头 = { Authorization: `Bearer ${key}` };
  }

  const 响应 = await fetch(端点, { method: 'POST', headers: 请求头, body: 请求体, signal });

  if (!响应.ok) {
    const 文本 = await 响应.text().catch(() => '');
    throw new Error(`Banana / Grok 请求失败：HTTP ${响应.status}${文本 ? ` ${文本.slice(0, 300)}` : ''}`);
  }

  const 数据 = (await 响应.json()) as unknown;
  const 项 = 提取Banana图片项(数据);
  if (!项) {
    throw new Error(
      `Banana / Grok 响应里没有图片（data[0] / images / image 都没有）。`
      + `原始响应：${JSON.stringify(数据).slice(0, 300)}`,
    );
  }

  if (项.b64) {
    const 数据地址 = 项.b64.startsWith('data:image')
      ? 项.b64
      : `data:image/png;base64,${项.b64}`;
    const mimeType = 数据地址.slice(5, 数据地址.indexOf(';')) || 'image/png';
    return { 数据地址, mimeType };
  }

  // 远端地址：这里必须自己下载，因为浏览器端 <img> 直连常被跨域/CORS 挡掉。
  const 图片响应 = await fetch(项.url as string, { signal });
  if (!图片响应.ok) throw new Error(`下载生成图片失败：HTTP ${图片响应.status}`);
  const blob = await 图片响应.blob();
  const 数据地址 = await blob转数据地址(blob);
  return {
    数据地址,
    mimeType: blob.type || 猜测Mime(项.url as string),
    原始地址: 项.url,
  };
}

/** 上游 banana 的常见模型，供设置页下拉（也允许手填）。 */
export const Banana模型列表 = [
  'gpt-image-1',
  'gpt-image-1-mini',
  'dall-e-3',
  'grok-2-image',
  'gemini-2.5-flash-image',
  'imagen-4.0-generate-001',
] as const;
