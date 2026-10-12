// @vitest-environment jsdom
/**
 * NovelAI 出图链路集成测试。
 *
 * 走真实调用路径：`生成单张插图` → 渠道分派 → `解析NovelAI参考`（读 IndexedDB 里的
 * 角色媒体、缩放、归一化强度）→ `构造NovelAI载荷` → 假服务端。
 *
 * 这一层专抓「各模块单独都对、拼起来错」的缺陷，例如：
 *   - 参考模式切到 Vibe 后，Director Reference 的字段残留；
 *   - 强度归一化漏做，四条 0.6 之和超过 1；
 *   - 图片条数与描述条数不一致（服务端直接拒绝）；
 *   - 角色位置没进 characterPrompts[].center。
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { 安装假NovelAI, 卸载假NovelAI } from './helpers/fakeNovelAI';
import { 生成单张插图 } from '@/services/ai/imageGen/generateIllustration';
import { 设置参考图解码超时 } from '@/services/ai/imageGen/novelaiReference';
import { 创建默认文生图系统设置 } from '@/models/genSystem';
import { 清空图片缓存, 统计图片缓存, 列出缓存图片 } from '@/services/imageCache';
import type { 角色卡, 文生图系统设置 } from '@/models/genSystem';

// jsdom 没有真实图片解码器，参考图缩放会走超时分支。把预算压到 20ms，
// 免得每个参考图用例都等满默认的 3 秒。
设置参考图解码超时(20);

/**
 * 1×1 的可解码 PNG 数据地址。
 *
 * 参考图路径会先读媒体库、再等比缩放。缩放需要能解码的图片，所以这里给真图；
 * 同时**不能**依赖「存进 fake-indexeddb 再读回来」——jsdom 的 FileReader 对
 * 非 jsdom 来源的 Blob 会抛 "parameter 1 is not of type 'Blob'"，那是测试环境
 * 的产物，不是实现缺陷。因此这里直接打桩「读媒体」这一步：
 * 本文件要验的是**参考图如何进入载荷**，不是媒体库本身（那有独立测试）。
 */
const 真实PNG数据地址 = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

vi.mock('@/services/characterMedia', async (导入原模块) => {
  const 原模块 = await 导入原模块<typeof import('@/services/characterMedia')>();
  return {
    ...原模块,
    // 只要媒体 id 非空就返回一张真实 PNG；其余保持原实现。
    读取角色媒体数据地址: vi.fn(async (媒体Id: string) => (媒体Id ? 真实PNG数据地址 : '')),
  };
});

function 建角色(补丁: Partial<角色卡> = {}): 角色卡 {
  return {
    id: 'c1',
    enabled: true,
    aliases: [],
    outfits: [],
    selectedOutfitId: '',
    photoMedia: [],
    audioMedia: [],
    selectedPhotoId: '',
    selectedAudioId: '',
    photoPrompt: '',
    sendPhoto: false,
    位置: null,
    createdAt: 0,
    updatedAt: 0,
    nameCN: '流萤',
    nameEN: '',
    characterTraits: '银发',
    facialFeatures: '绿眼',
    facialFeaturesBack: '',
    upperBodySFW: '白色上衣',
    upperBodySFWBack: '',
    fullBodySFW: '短裙',
    fullBodySFWBack: '',
    upperBodyNSFW: '',
    upperBodyNSFWBack: '',
    fullBodyNSFW: '',
    fullBodyNSFWBack: '',
    negative: '',
    ...补丁,
  } as 角色卡;
}

function 建设置(补丁: Partial<文生图系统设置> = {}): 文生图系统设置 {
  const 设置 = 创建默认文生图系统设置();
  设置.启用 = true;
  设置.渠道 = 'novelai';
  设置.novelai.Token = '假Token';
  设置.novelai.模型 = 'nai-diffusion-4-5-full';
  Object.assign(设置, 补丁);
  return 设置;
}

const 上下文 = { 启用列表: [] as string[], 全部角色: {} as Record<string, 角色卡> };

/** 参考图路径只需要「媒体 id → 有一张图」；实际读取已在上面的 mock 里打桩。 */
function 造参考条目(名: string, 强度 = 0.6) {
  return { 媒体Id: `媒体_${名}`, 类型: 'character' as const, 强度, 保真度: 0.6 };
}

afterEach(() => {
  卸载假NovelAI();
});

describe('NovelAI 出图链路（假服务端）', () => {
  it('基础出图：提交到官方端点并带上请求头', async () => {
    const 记录 = 安装假NovelAI({ zip: true });
    // 关掉图片缓存：缓存写入会对数据地址再 fetch 一次，干扰请求计数。
    const 设置 = 建设置();
    设置.图片缓存.启用 = false;
    const 结果 = await 生成单张插图(设置, { 提示词标记: 'image###1girl, solo###' }, 上下文);
    expect(记录.请求地址).toHaveLength(1);
    expect(记录.请求地址[0]).toBe('https://image.novelai.net/ai/generate-image');
    expect(结果.结果.数据地址).toContain('data:image/png');
    expect(结果.结果.宽度).toBe(1024);
    expect(结果.结果.高度).toBe(1024);
  });

  it('开启图片缓存时把字节写进缓存，且不再多取一次字节', async () => {
    await 清空图片缓存();
    const 记录 = 安装假NovelAI({ zip: true });
    const 设置 = 建设置();
    设置.图片缓存.启用 = true;
    await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    /*
     * 只应有出图那一次请求：data URL 由本地解码，不再 `fetch(数据地址)`。
     * 那次 fetch 归 `connect-src` 管，宿主下发 CSP 时会被拒，而异常又被空 catch
     * 吞掉 —— 用户看到的就是「图片缓存里永远没有图」。
     */
    expect(记录.请求地址).toHaveLength(1);
    expect(记录.请求地址[0]).toContain('image.novelai.net');
    const [统计, 列表] = await Promise.all([统计图片缓存(), 列出缓存图片()]);
    expect(统计.图片数).toBe(1);
    expect(列表[0].条目.prompt).toContain('1girl');
    // 用记录上的 size 而不是 blob.size：jsdom 的 Blob 经 fake-indexeddb 的结构化
    // 克隆回来会丢 Blob 原型（真实浏览器不会），这里只验字节确实写进去了。
    expect(统计.总字节).toBeGreaterThan(0);
  });

  it('载荷带齐 NovelAI 要求的字段族', async () => {
    const 记录 = 安装假NovelAI({ zip: true });
    await 生成单张插图(建设置(), { 提示词标记: 'image###1girl###' }, 上下文);
    const 载荷 = 记录.最后载荷 as Record<string, unknown>;
    expect(载荷.model).toBeUndefined(); // model 走 URL 之外的字段？核对下面单独断言
    for (const 键 of [
      'params_version', 'width', 'height', 'scale', 'sampler', 'steps',
      'ucPreset', 'qualityToggle', 'dynamic_thresholding', 'cfg_rescale',
      'noise_schedule', 'seed', 'negative_prompt', 'use_coords',
      'reference_image_multiple', 'reference_image_multiple_cached',
      'reference_strength_multiple', 'reference_information_extracted_multiple',
    ]) {
      expect(载荷, `缺少字段 ${键}`).toHaveProperty(键);
    }
    expect(载荷).not.toHaveProperty('stream');
  });

  it('zip 响应能被解开成图片', async () => {
    const 记录 = 安装假NovelAI({ zip: true });
    const 设置 = 建设置();
    设置.图片缓存.启用 = false;
    const 结果 = await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    expect(记录.请求地址).toHaveLength(1);
    expect(结果.结果.mimeType).toBe('image/png');
  });

  it('裸图片响应（部分第三方站点）也能用', async () => {
    安装假NovelAI({ zip: false });
    const 结果 = await 生成单张插图(建设置(), { 提示词标记: 'image###1girl###' }, 上下文);
    expect(结果.结果.数据地址).toContain('data:image/png');
  });

  it('角色位置进入 characterPrompts[].center（走分角色伪格式）', async () => {
    const 记录 = 安装假NovelAI({ zip: true });
    const 角色 = 建角色({ 位置: { mode: 'grid', x: 0.5, y: 0.7, grid: 'c4' } });
    const 设置 = 建设置({ 角色卡: { c1: 角色 }, 角色启用列表: ['c1'] });
    const 上下文 = { 启用列表: ['c1'], 全部角色: { c1: 角色 } };

    // 位置只在**分角色伪格式**下才有去处。注意提示词里同时要保留 `$角色名$`——
    // 角色卡上的位置是挂在这个段上被取出来的（`提取出场角色` 认的就是它）。
    const 标记 = 'image###Scene Composition:夜晚街道;Character 1 Prompt:$流萤-sfw-upperbody$|centers:;###';
    设置.novelai.AI默认位置 = false;
    await 生成单张插图(设置, { 提示词标记: 标记 }, 上下文);

    const 载荷 = 记录.最后载荷 as Record<string, unknown>;
    const 分角色 = 载荷.characterPrompts as Array<{ center: { x: number; y: number } }>;
    expect(分角色).toHaveLength(1);
    // 模型没写 centers，位置来自角色卡 → 0.5/0.7。
    expect(分角色[0].center).toEqual({ x: 0.5, y: 0.7 });
  });

  it('角色卡位置覆盖提示词里写的 centers', async () => {
    const 记录 = 安装假NovelAI({ zip: true });
    const 角色 = 建角色({ 位置: { mode: 'grid', x: 0.1, y: 0.1, grid: 'a1' } });
    const 设置 = 建设置({ 角色卡: { c1: 角色 }, 角色启用列表: ['c1'] });
    const 上下文 = { 启用列表: ['c1'], 全部角色: { c1: 角色 } };
    设置.novelai.AI默认位置 = false;

    await 生成单张插图(设置, {
      提示词标记: 'image###Character 1 Prompt:$流萤-sfw-upperbody$|centers:e5;###',
    }, 上下文);

    const 载荷 = 记录.最后载荷 as Record<string, unknown>;
    const 分角色 = 载荷.characterPrompts as Array<{ center: { x: number; y: number } }>;
    expect(分角色[0].center).toEqual({ x: 0.1, y: 0.1 });
  });

  it('只写 $…$ 而不写分角色伪格式时，角色进的是 base_caption，characterPrompts 为空', async () => {
    // 这是当前的**真实行为**，不是缺陷：`$…$` 会被替换成角色部位字段并留在
    // 基础提示词里，因此不存在「每个角色一条 caption」的结构。
    const 记录 = 安装假NovelAI({ zip: true });
    const 角色 = 建角色({ 位置: { mode: 'grid', x: 0.5, y: 0.7, grid: 'c4' } });
    const 设置 = 建设置({ 角色卡: { c1: 角色 }, 角色启用列表: ['c1'] });
    const 上下文 = { 启用列表: ['c1'], 全部角色: { c1: 角色 } };

    await 生成单张插图(设置, { 提示词标记: 'image###$流萤-sfw-upperbody$###' }, 上下文);

    const 载荷 = 记录.最后载荷 as Record<string, unknown>;
    expect(载荷.characterPrompts).toEqual([]);
    const v4 = 载荷.v4_prompt as { caption: { base_caption: string; char_captions: unknown[] } };
    expect(v4.caption.char_captions).toEqual([]);
    expect(v4.caption.base_caption).toContain('银发');
    // 位置在这种写法下进不去载荷——UI 与文档都按此说明。
    expect(载荷.use_coords).toBe(false);
  });

  it('AI 默认位置开启时坐标被抹成空对象', async () => {
    const 记录 = 安装假NovelAI({ zip: true });
    const 角色 = 建角色({ 位置: { mode: 'grid', x: 0.5, y: 0.7, grid: 'c4' } });
    const 基础 = 创建默认文生图系统设置().novelai;
    const 设置 = 建设置({
      角色卡: { c1: 角色 },
      角色启用列表: ['c1'],
      novelai: { ...基础, Token: 't', 模型: 'nai-diffusion-4-5-full', AI默认位置: true },
    });
    const 上下文 = { 启用列表: ['c1'], 全部角色: { c1: 角色 } };

    await 生成单张插图(设置, {
      提示词标记: 'image###Character 1 Prompt:$流萤-sfw-upperbody$|centers:c4;###',
    }, 上下文);

    const 载荷 = 记录.最后载荷 as Record<string, unknown>;
    expect(载荷.use_coords).toBe(false);
    const 分角色 = 载荷.characterPrompts as Array<{ center: unknown }>;
    expect(分角色).toHaveLength(1);
    expect(分角色[0].center).toEqual({});
  });

  it('角色参考：读媒体库里的图，填 director_reference_* 六字段', async () => {
    const 记录 = 安装假NovelAI({ zip: true });
    const 角色 = 建角色({
      参考组: {
        references: [造参考条目('参考')],
        createdAt: 0,
        updatedAt: 0,
      },
    });
    const 设置 = 建设置({ 角色卡: { c1: 角色 }, 角色启用列表: ['c1'] });


    await 生成单张插图(
      设置,
      { 提示词标记: 'image###1girl###' },
      { 启用列表: ['c1'], 全部角色: { c1: 角色 } },
    );

    const 载荷 = 记录.最后载荷 as Record<string, unknown>;
    const 图片 = 载荷.director_reference_images_cached as Array<{ cache_secret_key: string; data: string }>;
    expect(图片, '参考图没有被写进载荷').toBeDefined();
    expect(图片).toHaveLength(1);
    expect(图片[0].data).toContain('data:image');
    expect(typeof 图片[0].cache_secret_key).toBe('string');
    // 非 _cached 的保持为空（上游语义）。
    expect(载荷.director_reference_images).toEqual([]);
    // 描述、信息提取、两级强度都要与图片等长。
    expect((载荷.director_reference_descriptions as unknown[]).length).toBe(1);
    expect((载荷.director_reference_information_extracted as unknown[]).length).toBe(1);
    expect((载荷.director_reference_strength_values as unknown[]).length).toBe(1);
    const 次要 = 载荷.director_reference_secondary_strength_values as number[];
    expect(次要[0]).toBeCloseTo(0.4, 6);
  });

  it('角色参考：四条 0.6 的强度被归一化到和为 1', async () => {
    const 记录 = 安装假NovelAI({ zip: true });
    
    const 角色 = 建角色({
      参考组: {
        references: [造参考条目('a'), 造参考条目('b'), 造参考条目('c'), 造参考条目('d')],
        createdAt: 0,
        updatedAt: 0,
      },
    });
    const 设置 = 建设置({ 角色卡: { c1: 角色 }, 角色启用列表: ['c1'] });
    // 4.5 模型 + 归一化关闭 → 按总和分摊（2.4 → 每条 0.25）。
    await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, { 启用列表: ['c1'], 全部角色: { c1: 角色 } });

    const 载荷 = 记录.最后载荷 as Record<string, unknown>;
    const 强度 = 载荷.director_reference_strength_values as number[];
    expect(强度).toHaveLength(4);
    expect(强度.reduce((累计, 项) => 累计 + 项, 0)).toBeCloseTo(1, 5);
  });

  it('参考模式为 Vibe 时不带 director_reference 字段，改带 reference_* 族', async () => {
    const 记录 = 安装假NovelAI({ zip: true });
    const 角色 = 建角色({
      参考组: {
        references: [{
          媒体Id: JSON.stringify({ encodings: { 'v4-5full': { k: { encoding: '编码串', params: { information_extracted: 0.9 } } } } }),
          类型: 'style',
          强度: 0.6,
          保真度: 0.6,
        }],
        createdAt: 0,
        updatedAt: 0,
      },
    });
    const 基础 = 创建默认文生图系统设置().novelai;
    const 设置 = 建设置({
      角色卡: { c1: 角色 },
      角色启用列表: ['c1'],
      novelai: { ...基础, Token: 't', 模型: 'nai-diffusion-4-5-full', 参考模式: 'vibe' },
    });

    await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, { 启用列表: ['c1'], 全部角色: { c1: 角色 } });

    const 载荷 = 记录.最后载荷 as Record<string, unknown>;
    expect(载荷).not.toHaveProperty('director_reference_images_cached');
    const 缓存 = 载荷.reference_image_multiple_cached as Array<{ data: string }>;
    expect(缓存).toHaveLength(1);
    expect(缓存[0].data).toBe('编码串');
    expect(载荷.reference_strength_multiple).toEqual([0.6]);
    expect(载荷.reference_information_extracted_multiple).toEqual([0.9]);
  });

  it('Vibe 文件与模型不匹配时跳过该条，而不是发出坏载荷', async () => {
    const 记录 = 安装假NovelAI({ zip: true });
    const 角色 = 建角色({
      参考组: {
        references: [{
          媒体Id: JSON.stringify({ encodings: { v3: { k: { encoding: '不匹配' } } } }),
          类型: 'style',
          强度: 0.6,
          保真度: 0.6,
        }],
        createdAt: 0,
        updatedAt: 0,
      },
    });
    const 基础 = 创建默认文生图系统设置().novelai;
    const 设置 = 建设置({
      角色卡: { c1: 角色 },
      角色启用列表: ['c1'],
      novelai: { ...基础, Token: 't', 模型: 'nai-diffusion-4-5-full', 参考模式: 'vibe' },
    });

    await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, { 启用列表: ['c1'], 全部角色: { c1: 角色 } });

    const 载荷 = 记录.最后载荷 as Record<string, unknown>;
    expect(载荷.reference_image_multiple_cached).toEqual([]);
    expect(载荷.reference_strength_multiple).toEqual([]);
  });

  it('服务端报错时把状态码与响应体一并抛出', async () => {
    安装假NovelAI({ 失败: 401 });
    await expect(生成单张插图(建设置(), { 提示词标记: 'image###1girl###' }, 上下文))
      .rejects.toThrow(/401/);
  });

  it('没有 Token 时立刻报错，不发请求', async () => {
    const 记录 = 安装假NovelAI({ zip: true });
    const 设置 = 建设置();
    设置.novelai.Token = '';
    await expect(生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文))
      .rejects.toThrow(/Token/);
    expect(记录.请求地址).toHaveLength(0);
  });
});
