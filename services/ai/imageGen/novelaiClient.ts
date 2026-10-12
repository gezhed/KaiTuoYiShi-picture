/**
 * NovelAI HTTP 客户端。
 *
 * 派生自 st-chatu8（智绘姬）index.js 的 `postNovelAIWithFallback` L83589 与
 * `getNovelAICandidateUrls` L83552、以及 `novelaigenerate` 的网络段 L84867-L84890。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-15；
 *   修改目的：① 去掉酒馆服务端代理分支（上游 L84850 POST `/api/novelai/generate-image`），
 *   只保留浏览器直连；② 保留上游的**候选地址回退**机制——第三方站点常常
 *   既接受带 `/ai/generate-image` 的完整 URL，也接受裸域名，上游因此会把两种都试一遍；
 *   ③ 上游把「哪个候选可用」缓存进 Map，这里保留同等行为，避免每次都重试失败的那个。
 *
 * 响应是 **zip**（内含一张图片），不是裸图片流。上游用 JSZip 解，这里用本仓库自带的
 * `readZipEntries`（fflate），省掉一个 93 KB 的依赖。
 */

import { readZipEntries } from '@/utils/zip';
import type { NovelAI设置 } from '@/models/genSystem';

const 路径 = '/ai/generate-image';

export function 规范化NovelAI站点(地址: string): string {
  return 地址.trim().replace(/\/+$/, '');
}

/**
 * 生成候选地址。
 *
 * - 官方站点：只有 `https://image.novelai.net/ai/generate-image` 一个候选。
 * - 第三方站点：若地址里已含 `ai/generate-image` 就直接用；
 *   否则既试「地址 + 路径」也试「裸地址」（上游 L83569-L83577）。
 */
export function NovelAI候选地址(设置: NovelAI设置): string[] {
  const 基址 = 规范化NovelAI站点(设置.地址);
  if (!基址 || /^https?:\/\/image\.novelai\.net$/i.test(基址)) {
    return [`https://image.novelai.net${路径}`];
  }
  if (基址.includes('ai/generate-image') || 基址.endsWith(路径)) {
    return [基址];
  }
  const 拼接 = `${基址}${路径}`;
  return [拼接, 基址];
}

/** 记住上次成功的候选，下次先用它（上游 `workingNovelAIUrlCache`）。 */
const 可用候选缓存 = new Map<string, string>();

function 排序候选(候选: string[], 键: string): string[] {
  const 已知可用 = 可用候选缓存.get(键);
  if (!已知可用 || !候选.includes(已知可用)) return 候选;
  return [已知可用, ...候选.filter((项) => 项 !== 已知可用)];
}

export interface NovelAI响应 {
  /** 图片字节。 */
  字节: Uint8Array;
  mimeType: string;
  使用地址: string;
}

function 嗅探Mime(字节: Uint8Array): string {
  if (字节[0] === 0x89 && 字节[1] === 0x50) return 'image/png';
  if (字节[0] === 0xff && 字节[1] === 0xd8) return 'image/jpeg';
  return 'image/png';
}

/** 从 zip 里取出第一张图片；不是 zip 时按裸图片处理（部分第三方站点会直接回图）。 */
export function 提取NovelAI图片(字节: Uint8Array): { 字节: Uint8Array; mimeType: string } {
  // zip 魔数：PK\x03\x04。
  const 是Zip = 字节[0] === 0x50 && 字节[1] === 0x4b;
  if (!是Zip) return { 字节, mimeType: 嗅探Mime(字节) };

  let 条目: Map<string, Uint8Array>;
  try {
    条目 = readZipEntries(字节);
  } catch (错误) {
    throw new Error(`NovelAI 返回的 zip 无法解开：${错误 instanceof Error ? 错误.message : String(错误)}`);
  }
  for (const [名称, 内容] of 条目) {
    if (/\.(png|jpe?g|webp)$/i.test(名称)) {
      return { 字节: 内容, mimeType: 嗅探Mime(内容) };
    }
  }
  throw new Error('NovelAI 返回的 zip 里没有图片文件。');
}

export async function 请求NovelAI图片(
  设置: NovelAI设置,
  载荷: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<NovelAI响应> {
  const token = 设置.Token.trim();
  if (!token) throw new Error('请先填写 NovelAI Token。');

  const 候选 = NovelAI候选地址(设置);
  if (候选.length === 0) throw new Error('NovelAI 地址为空。');
  const 键 = 规范化NovelAI站点(设置.地址);
  const 顺序 = 排序候选(候选, 键);

  const 失败: string[] = [];
  for (const 地址 of 顺序) {
    let 响应: Response;
    try {
      响应 = await fetch(地址, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(载荷),
        signal,
      });
    } catch (错误) {
      // 网络层失败（跨域/不可达）也记下来，继续试下一个候选。
      失败.push(`${地址}：${错误 instanceof Error ? 错误.message : String(错误)}`);
      continue;
    }

    if (!响应.ok) {
      const 文本 = await 响应.text().catch(() => '');
      失败.push(`${地址}：HTTP ${响应.status}${文本 ? ` ${文本.slice(0, 200)}` : ''}`);
      continue;
    }

    const 字节 = new Uint8Array(await 响应.arrayBuffer());
    const 图片 = 提取NovelAI图片(字节);
    可用候选缓存.set(键, 地址);
    return { 字节: 图片.字节, mimeType: 图片.mimeType, 使用地址: 地址 };
  }

  throw new Error(`NovelAI 请求失败，已尝试 ${顺序.length} 个地址：\n${失败.join('\n')}`);
}

/** NovelAI 没有公开的模型列表接口，用内置目录。 */
export const NovelAI模型目录 = [
  'nai-diffusion-5-full',
  'nai-diffusion-5-curated',
  'nai-diffusion-4-5-full',
  'nai-diffusion-4-5-curated',
  'nai-diffusion-4-full',
  'nai-diffusion-4-curated-preview',
  'nai-diffusion-3',
] as const;
