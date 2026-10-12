// @vitest-environment jsdom
/**
 * 假 SD WebUI（A1111 / Forge）与假 Banana / Grok 服务端。
 *
 * 两个渠道都是「JSON 进、base64 出」的简单形状，但**拼起来**仍会出错：
 * 端点推导选错路径、认证头发错、multipart 与 JSON 形态混用、
 * `imagen*` 误发 size、参考图没改走 edits。这些都要在整条链路上验。
 */

export interface 假请求记录 {
  地址: string[];
  头: Array<Record<string, string>>;
  /** 最后一次 JSON 请求体；multipart 时为 null。 */
  最后Json: Record<string, unknown> | null;
  /** 最后一次 multipart 表单。 */
  最后表单: FormData | null;
}

function 空记录(): 假请求记录 {
  return { 地址: [], 头: [], 最后Json: null, 最后表单: null };
}

/** 1×1 可解码 PNG 的 base64（不带 data URL 前缀，A1111 就是这样回的）。 */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/* ------------------------------------------------------------------ *
 * SD WebUI
 * ------------------------------------------------------------------ */

export interface 假SD选项 {
  失败?: number | string;
  /** `/sdapi/v1/txt2img` 返回几张图（含空串占位）。 */
  图片数?: number;
  /** info 字段；给字符串就原样返回。 */
  info?: unknown;
  资源列表?: boolean;
}

export function 安装假SD(选项: 假SD选项 = {}): 假请求记录 {
  const 记录 = 空记录();

  globalThis.fetch = (async (输入: RequestInfo | URL, 初始化?: RequestInit) => {
    const url = typeof 输入 === 'string' ? 输入 : (输入 instanceof URL ? 输入.toString() : 输入.url);
    记录.地址.push(url);
    记录.头.push((初始化?.headers ?? {}) as Record<string, string>);
    const 路径 = new URL(url, 'http://localhost').pathname;

    if (选项.失败 !== undefined && 路径.includes('txt2img')) {
      return typeof 选项.失败 === 'number'
        ? new Response('{"detail":"模拟错误"}', { status: 选项.失败 })
        : new Response(选项.失败, { status: 400 });
    }

    if (路径 === '/sdapi/v1/txt2img') {
      if (初始化?.body && typeof 初始化.body === 'string') {
        记录.最后Json = JSON.parse(初始化.body) as Record<string, unknown>;
      }
      const 张数 = 选项.图片数 ?? 1;
      const 图 = Array.from({ length: 张数 }, (_项, 下标) => (下标 === 1 ? '' : PNG_B64));
      return new Response(JSON.stringify({
        images: 图,
        info: typeof 选项.info === 'string' ? 选项.info : JSON.stringify(选项.info ?? { seed: 777 }),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (路径 === '/sdapi/v1/sd-models') {
      return new Response(JSON.stringify([{ title: '模型甲.safetensors' }, { title: '模型乙.safetensors' }]), { status: 200 });
    }
    if (路径 === '/sdapi/v1/samplers') {
      return new Response(JSON.stringify([{ name: 'Euler a' }, { name: 'DPM++ 2M' }]), { status: 200 });
    }
    if (路径 === '/sdapi/v1/sd-vae') {
      return new Response(JSON.stringify([{ model_name: 'vae-ft.safetensors' }]), { status: 200 });
    }
    if (路径 === '/sdapi/v1/schedulers') {
      return new Response(JSON.stringify(['Automatic', 'Karras']), { status: 200 });
    }
    if (路径 === '/sdapi/v1/upscalers') {
      return new Response(JSON.stringify(['Latent', 'R-ESRGAN 4x+']), { status: 200 });
    }

    return new Response(`未知路径 ${路径}`, { status: 404 });
  }) as typeof fetch;

  return 记录;
}

/* ------------------------------------------------------------------ *
 * Banana / Grok
 * ------------------------------------------------------------------ */

export interface 假Banana选项 {
  失败?: number | string;
  /** 响应形态：b64 / url / images / image。 */
  形态?: 'b64' | 'url' | 'images' | 'image';
  设置要求?: number;
}

export function 安装假Banana(选项: 假Banana选项 = {}): 假请求记录 {
  const 记录 = 空记录();
  const 形态 = 选项.形态 ?? 'b64';

  globalThis.fetch = (async (输入: RequestInfo | URL, 初始化?: RequestInit) => {
    const url = typeof 输入 === 'string' ? 输入 : (输入 instanceof URL ? 输入.toString() : 输入.url);
    记录.地址.push(url);
    记录.头.push((初始化?.headers ?? {}) as Record<string, string>);

    if (选项.失败 !== undefined) {
      return typeof 选项.失败 === 'number'
        ? new Response('{"error":"模拟错误"}', { status: 选项.失败 })
        : new Response(选项.失败, { status: 400 });
    }

    // 远端图片地址的下载（形态 url 时）。
    if (url.includes('/下载/')) {
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }

    if (初始化?.body instanceof FormData) {
      记录.最后表单 = 初始化.body;
      记录.最后Json = null;
    } else if (初始化?.body && typeof 初始化.body === 'string') {
      记录.最后Json = JSON.parse(初始化.body) as Record<string, unknown>;
      记录.最后表单 = null;
    }

    const 主体 = 形态 === 'b64'
      ? { data: [{ b64_json: PNG_B64 }] }
      : 形态 === 'url'
        ? { data: [{ url: 'https://假图床/下载/图.png' }] }
        : 形态 === 'images'
          ? { images: [PNG_B64] }
          : { image: PNG_B64 };

    return new Response(JSON.stringify(主体), {
      status: 选项.设置要求 ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return 记录;
}

export function 卸载假服务端(): void {
  Reflect.deleteProperty(globalThis, 'fetch');
}
