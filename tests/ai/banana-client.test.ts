// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  规范化Banana地址,
  Banana生成端点,
  Banana编辑端点,
  Banana是否发尺寸,
  构造Banana载荷,
  提取Banana图片项,
  请求Banana图片,
} from '@/services/ai/imageGen/bananaClient';
import { 创建默认Banana设置 } from '@/models/genSystem';

function 建设置(覆盖: Partial<ReturnType<typeof 创建默认Banana设置>> = {}) {
  return { ...创建默认Banana设置(), ...覆盖 };
}

describe('规范化Banana地址', () => {
  it('去掉首尾空白与尾部斜杠', () => {
    expect(规范化Banana地址('  https://api.openai.com///  ')).toBe('https://api.openai.com');
  });
});

describe('Banana生成端点', () => {
  it('自定义端点优先：绝对地址直接用', () => {
    expect(Banana生成端点(建设置({ 地址: 'https://a.com', 自定义端点: 'https://b.com/x' })))
      .toBe('https://b.com/x');
  });

  it('自定义端点是相对路径时拼在基址后', () => {
    expect(Banana生成端点(建设置({ 地址: 'https://a.com', 自定义端点: '/custom/gen' })))
      .toBe('https://a.com/custom/gen');
    expect(Banana生成端点(建设置({ 地址: 'https://a.com', 自定义端点: 'custom/gen' })))
      .toBe('https://a.com/custom/gen');
  });

  it('基址已带 generations 时原样使用', () => {
    expect(Banana生成端点(建设置({ 地址: 'https://a.com/v1/images/generations' })))
      .toBe('https://a.com/v1/images/generations');
    expect(Banana生成端点(建设置({ 地址: 'https://a.com/v1/image/generation' })))
      .toBe('https://a.com/v1/image/generation');
  });

  it('基址带 edits 时替换成 generations', () => {
    expect(Banana生成端点(建设置({ 地址: 'https://a.com/v1/images/edits' })))
      .toBe('https://a.com/v1/images/generations');
    expect(Banana生成端点(建设置({ 地址: 'https://a.com/v1/image/edit' })))
      .toBe('https://a.com/v1/images/generations');
  });

  it('基址以 /v1 或 /v1beta 结尾时补 paths', () => {
    expect(Banana生成端点(建设置({ 地址: 'https://a.com/v1' }))).toBe('https://a.com/v1/images/generations');
    expect(Banana生成端点(建设置({ 地址: 'https://a.com/v1beta' }))).toBe('https://a.com/v1beta/images/generations');
  });

  it('其它基址补 /v1/images/generations', () => {
    expect(Banana生成端点(建设置({ 地址: 'https://api.openai.com' })))
      .toBe('https://api.openai.com/v1/images/generations');
  });

  it('地址为空且无自定义端点时返回空串', () => {
    expect(Banana生成端点(建设置({ 地址: '' }))).toBe('');
  });
});

describe('Banana是否发尺寸', () => {
  it('imagen 系列不发 size，其它都发', () => {
    expect(Banana是否发尺寸('imagen-4.0-generate-001')).toBe(false);
    expect(Banana是否发尺寸('IMAGEN-3')).toBe(false);
    expect(Banana是否发尺寸('gpt-image-1')).toBe(true);
    expect(Banana是否发尺寸('grok-2-image')).toBe(true);
  });
});

describe('构造Banana载荷', () => {
  it('发出 model / prompt / n / size', () => {
    const 载荷 = 构造Banana载荷({ 设置: 建设置({ 模型: 'gpt-image-1' }), 正向提示词: 'a cat' });
    expect(载荷).toEqual({ model: 'gpt-image-1', prompt: 'a cat', n: 1, size: '1024x1024' });
  });

  it('imagen 模型不带 size', () => {
    const 载荷 = 构造Banana载荷({
      设置: 建设置({ 模型: 'imagen-4.0-generate-001' }),
      正向提示词: 'a cat',
    });
    expect(载荷).not.toHaveProperty('size');
  });

  it('覆盖尺寸优先于设置', () => {
    const 载荷 = 构造Banana载荷({
      设置: 建设置(),
      正向提示词: 'a',
      尺寸: '1536x1024',
    });
    expect(载荷.size).toBe('1536x1024');
  });

  it('响应格式为 none 时不发该字段', () => {
    const 载荷 = 构造Banana载荷({ 设置: 建设置({ 响应格式: 'none' }), 正向提示词: 'a' });
    expect(载荷).not.toHaveProperty('response_format');
  });

  it('响应格式非 none 时发出', () => {
    expect(构造Banana载荷({ 设置: 建设置({ 响应格式: 'b64_json' }), 正向提示词: 'a' }).response_format)
      .toBe('b64_json');
    expect(构造Banana载荷({ 设置: 建设置({ 响应格式: 'url' }), 正向提示词: 'a' }).response_format)
      .toBe('url');
  });

  it('尺寸为空时不发 size', () => {
    const 载荷 = 构造Banana载荷({ 设置: 建设置({ 尺寸: '   ' }), 正向提示词: 'a' });
    expect(载荷).not.toHaveProperty('size');
  });

  it('超长尺寸原样透传（服务端自行校验）', () => {
    const 载荷 = 构造Banana载荷({ 设置: 建设置({ 尺寸: '768x1344' }), 正向提示词: 'a' });
    expect(载荷.size).toBe('768x1344');
  });
});

describe('Banana编辑端点', () => {
  it('自定义端点优先于推导', () => {
    expect(Banana编辑端点(建设置({ 地址: 'https://a.com', 自定义端点: '/custom/edit' })))
      .toBe('https://a.com/custom/edit');
  });

  it('基址已带 edits 时原样用', () => {
    expect(Banana编辑端点(建设置({ 地址: 'https://a.com/v1/images/edits' })))
      .toBe('https://a.com/v1/images/edits');
  });

  it('基址带 generations 时替换成 edits', () => {
    expect(Banana编辑端点(建设置({ 地址: 'https://a.com/v1/images/generations' })))
      .toBe('https://a.com/v1/images/edits');
  });

  it('裸域名补 /v1/images/edits', () => {
    expect(Banana编辑端点(建设置({ 地址: 'https://api.openai.com' })))
      .toBe('https://api.openai.com/v1/images/edits');
  });

  it('/v1 结尾补 paths', () => {
    expect(Banana编辑端点(建设置({ 地址: 'https://a.com/v1beta' })))
      .toBe('https://a.com/v1beta/images/edits');
  });

  it('与生成端点互为反向：生成端点把 edits 改回 generations', () => {
    const 设置 = 建设置({ 地址: 'https://a.com/v1/images/edits' });
    expect(Banana生成端点(设置)).toBe('https://a.com/v1/images/generations');
    expect(Banana编辑端点(设置)).toBe('https://a.com/v1/images/edits');
  });

  it('地址为空时返回空串', () => {
    expect(Banana编辑端点(建设置({ 地址: '' }))).toBe('');
  });
});

describe('请求Banana图片：端点选择与发送形态', () => {
  const PNG = 'iVBORw0KGgo=';

  it('无参考图时走 generations 且用 JSON', async () => {
    const 调用: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      调用.push({ url, init });
      return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 });
    }));
    await 请求Banana图片({
      设置: 建设置({ 地址: 'https://a.com', APIKey: 'k' }),
      载荷: { model: 'gpt-image-1', prompt: 'x', n: 1 },
    });
    expect(调用[0].url).toBe('https://a.com/v1/images/generations');
    expect(调用[0].init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    vi.unstubAllGlobals();
  });

  it('有参考图时走 edits 且用 multipart，不手写 Content-Type', async () => {
    const 调用: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      调用.push({ url, init });
      return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 });
    }));
    const 参考图Blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      // 第一次是读参考图，第二次才是出图。
      if (!init || !init.method) return new Response(参考图Blob, { status: 200 });
      调用.push({ url, init });
      return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 });
    }));

    await 请求Banana图片({
      设置: 建设置({ 地址: 'https://a.com', APIKey: 'k', 编辑格式: 'form_data' }),
      载荷: { model: 'gpt-image-1', prompt: 'x', n: 1, size: '1024x1024' },
      参考图: 'data:image/png;base64,AQID',
    });

    expect(调用).toHaveLength(1);
    expect(调用[0].url).toBe('https://a.com/v1/images/edits');
    expect(调用[0].init.body).toBeInstanceOf(FormData);
    // 必须让浏览器自己带 boundary，所以不能手写 Content-Type。
    const 头 = 调用[0].init.headers as Record<string, string>;
    expect(头['Content-Type']).toBeUndefined();
    expect(头.Authorization).toBe('Bearer k');

    const 表单 = 调用[0].init.body as FormData;
    expect(表单.get('prompt')).toBe('x');
    expect(表单.get('model')).toBe('gpt-image-1');
    expect(表单.get('n')).toBe('1');
    expect(表单.get('size')).toBe('1024x1024');
    vi.unstubAllGlobals();
  });

  it('编辑格式为 json 时仍走 edits 但用 JSON 且带 image 字段', async () => {
    let 捕获Url = '';
    let 捕获体 = '';
    let 捕获头: Record<string, string> = {};
    const 调用: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      调用.push(url);
      if (!init) throw new Error(`fetch 被调用时没有 init：${url}`);
      捕获Url = url;
      捕获体 = String(init.body);
      捕获头 = (init.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 });
    }));
    await 请求Banana图片({
      设置: 建设置({ 地址: 'https://a.com', APIKey: 'k', 编辑格式: 'json' }),
      载荷: { model: 'm', prompt: 'x', n: 1 },
      参考图: 'data:image/png;base64,ZZZ',
    });
    expect(捕获Url).toBe('https://a.com/v1/images/edits');
    const 体 = JSON.parse(捕获体) as Record<string, unknown>;
    expect(体.image).toBe('data:image/png;base64,ZZZ');
    expect(捕获头['Content-Type']).toBe('application/json');
    vi.unstubAllGlobals();
  });

  it('缺 API Key 时立刻报错，不发请求', async () => {
    const 假 = vi.fn();
    vi.stubGlobal('fetch', 假);
    await expect(请求Banana图片({
      设置: 建设置({ 地址: 'https://a.com', APIKey: '' }),
      载荷: { model: 'm', prompt: 'x' },
    })).rejects.toThrow(/API Key/);
    expect(假).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('multipart 时不带 size 则不加该字段', async () => {
    let 表单捕获: FormData | null = null;
    const 参考图Blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || !init.method) return new Response(参考图Blob, { status: 200 });
      表单捕获 = init.body as FormData;
      return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 });
    }));
    await 请求Banana图片({
      设置: 建设置({ 地址: 'https://a.com', APIKey: 'k' }),
      载荷: { model: 'imagen-3', prompt: 'x', n: 1 },
      参考图: 'data:image/png;base64,AQ==',
    });
    expect(表单捕获).not.toBeNull();
    expect((表单捕获 as unknown as FormData).has('size')).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('提取Banana图片项', () => {
  it('认 data[0].b64_json', () => {
    expect(提取Banana图片项({ data: [{ b64_json: 'AAA' }] })).toEqual({ b64: 'AAA' });
  });

  it('认 data[0].base64', () => {
    expect(提取Banana图片项({ data: [{ base64: 'BBB' }] })).toEqual({ b64: 'BBB' });
  });

  it('认 data[0].url', () => {
    expect(提取Banana图片项({ data: [{ url: 'https://x/y.png' }] })).toEqual({ url: 'https://x/y.png' });
  });

  it('认顶层 images[0] 字符串形态', () => {
    expect(提取Banana图片项({ images: ['CCC'] })).toEqual({ b64: 'CCC' });
  });

  it('认顶层 images[0] 对象形态', () => {
    expect(提取Banana图片项({ images: [{ url: 'https://x/z.png' }] })).toEqual({ url: 'https://x/z.png' });
  });

  it('认顶层 image 字符串形态', () => {
    expect(提取Banana图片项({ image: 'DDD' })).toEqual({ b64: 'DDD' });
  });

  it('b64 与 url 并存时都带出', () => {
    expect(提取Banana图片项({ data: [{ b64_json: 'E', url: 'https://x/e.png' }] }))
      .toEqual({ b64: 'E', url: 'https://x/e.png' });
  });

  it('空值 / 非法结构返回 null', () => {
    expect(提取Banana图片项(null)).toBeNull();
    expect(提取Banana图片项('字符串')).toBeNull();
    expect(提取Banana图片项({})).toBeNull();
    expect(提取Banana图片项({ data: [] })).toBeNull();
    expect(提取Banana图片项({ data: [{}] })).toBeNull();
    expect(提取Banana图片项({ data: [{ b64_json: '   ' }] })).toBeNull();
  });
});
