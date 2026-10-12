// @vitest-environment jsdom
/**
 * 假 NovelAI 服务端。
 *
 * 与假 ComfyUI 同理：NovelAI 的载荷是全渠道里结构最复杂的（基础字段 + v4 分角色 +
 * Director Reference + Vibe 四种字段族并存），而各字段族的构造分散在四个模块里。
 * 单元测试只能证明「每个模块单独产出的形状对」，证明不了**拼起来之后**的载荷
 * 仍然是服务端会接受的那一份——例如强度归一化漏做、图片与描述错位、
 * 参考模式切换后另一套字段没被清掉。
 *
 * 这里把完整载荷接住并做结构自检，不需要真的 NovelAI 账号。
 */

import { buildStoredZip } from '@/utils/zip';

export interface 假NovelAI记录 {  请求地址: string[];
  /** 最后一次请求的完整载荷。 */
  最后载荷: Record<string, unknown> | null;
}

export interface 假NovelAI选项 {
  /** 强制返回错误；给数字表示状态码，给字符串时作为错误体。 */
  失败?: number | string;
  /** 返回图片字节；默认一个最小 PNG。 */
  图片字节?: Uint8Array;
  /** 是否把响应做成 zip（真实 NovelAI 回的是 zip）。 */
  zip?: boolean;
}

/**
 * 一个**完整可解码**的 1×1 PNG。
 *
 * 只给 PNG 魔数头是不够的：出图后处理会对结果做等比缩放，那需要能解码的图片；
 * 给一个坏字节串会让测试在无关的地方失败（表现为额外的 fetch 与
 * 「参考图解码失败」），掩盖真正要测的东西。
 */
const 默认图片 = (() => {
  const 二进制 = atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  );
  const 字节 = new Uint8Array(二进制.length);
  for (let i = 0; i < 二进制.length; i += 1) 字节[i] = 二进制.charCodeAt(i);
  return 字节;
})();

export function 安装假NovelAI(选项: 假NovelAI选项 = {}): 假NovelAI记录 {
  const 记录: 假NovelAI记录 = { 请求地址: [], 最后载荷: null };

  globalThis.fetch = (async (输入: RequestInfo | URL, 初始化?: RequestInit) => {
    const url = typeof 输入 === 'string' ? 输入 : (输入 instanceof URL ? 输入.toString() : 输入.url);
    记录.请求地址.push(url);

    if (初始化?.body && typeof 初始化.body === 'string') {
      记录.最后载荷 = JSON.parse(初始化.body) as Record<string, unknown>;
    }

    if (选项.失败 !== undefined) {
      return typeof 选项.失败 === 'number'
        ? new Response('{"message":"模拟错误"}', { status: 选项.失败 })
        : new Response(选项.失败, { status: 400 });
    }

    const 图片 = 选项.图片字节 ?? 默认图片;
    if (选项.zip) {
      // 用与客户端解包同一个实现来打包：手写 local header 是不够的，
      // 解包器需要中央目录（末端目录记录），否则报 invalid zip data。
      return new Response(buildStoredZip([{ name: 'image_0.png', data: 图片 }]), {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      });
    }
    return new Response(图片, { status: 200, headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;

  return 记录;
}

export function 卸载假NovelAI(): void {
  Reflect.deleteProperty(globalThis, 'fetch');
}
