// @vitest-environment jsdom
/**
 * SD WebUI 与 Banana / Grok 的出图链路集成测试。
 *
 * 与 ComfyUI / NovelAI 同层：走 `生成单张插图` 的真实分派与载荷构造，
 * 只把服务端换成假的。抓的是「端点选错、认证头发错、形态混用」这类跨模块问题。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { 安装假SD, 安装假Banana, 卸载假服务端 } from './helpers/fakeSdBanana';
import { 生成单张插图 } from '@/services/ai/imageGen/generateIllustration';
import { 读取SD资源列表 } from '@/services/ai/imageGen/sdClient';
import { 创建默认文生图系统设置 } from '@/models/genSystem';
import type { 文生图系统设置 } from '@/models/genSystem';

const 上下文 = { 启用列表: [] as string[], 全部角色: {} as Record<string, never> };

function 建设置(补丁: Partial<文生图系统设置> = {}): 文生图系统设置 {
  const 设置 = 创建默认文生图系统设置();
  设置.启用 = true;
  // 缓存写入会对数据地址再 fetch 一次，干扰请求计数；默认关掉，单独用例再开。
  设置.图片缓存.启用 = false;
  Object.assign(设置, 补丁);
  return 设置;
}

afterEach(() => {
  卸载假服务端();
});

describe('SD WebUI 出图链路', () => {
  it('提交到 /sdapi/v1/txt2img 并取回图片', async () => {
    const 记录 = 安装假SD();
    const 设置 = 建设置({ 渠道: 'sd' });
    设置.sd.地址 = 'http://127.0.0.1:7860';
    const 结果 = await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);

    expect(记录.地址).toHaveLength(1);
    expect(记录.地址[0]).toBe('http://127.0.0.1:7860/sdapi/v1/txt2img');
    expect(结果.结果.数据地址).toContain('data:image/png');
    expect(结果.结果.渠道).toBe('sd');
  });

  it('上行的载荷字段与类型都正确', async () => {
    const 记录 = 安装假SD();
    const 设置 = 建设置({ 渠道: 'sd' });
    设置.sd.地址 = 'http://127.0.0.1:7860';
    设置.sd.步数 = 30;
    设置.sd.cfg = 7.5;
    设置.sd.种子 = 42;
    await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);

    const 载荷 = 记录.最后Json as Record<string, unknown>;
    expect(载荷.steps).toBe(30);
    expect(载荷.cfg_scale).toBe(7.5);
    expect(载荷.seed).toBe(42);
    // 尺寸必须是数字；上游发字符串，这里显式收窄过。
    expect(typeof 载荷.width).toBe('number');
    expect(typeof 载荷.height).toBe('number');
    // override_settings 必须带上 CLIP 跳过层与 VAE。
    expect(载荷.override_settings).toMatchObject({ sd_vae: 'Automatic' });
    expect(载荷.negative_prompt).toBeDefined();
    expect(载荷.prompt).toContain('best quality');
  });

  it('未填种子时发 -1（交给服务端随机），而不是 0', async () => {
    const 记录 = 安装假SD();
    const 设置 = 建设置({ 渠道: 'sd' });
    设置.sd.地址 = 'http://127.0.0.1:7860';
    设置.sd.种子 = -1;
    await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    expect((记录.最后Json as Record<string, unknown>).seed).toBe(-1);
  });

  it('种子取服务端回传的 info.seed（高清修复可能改写它）', async () => {
    安装假SD({ info: { seed: 20250101 } });
    const 设置 = 建设置({ 渠道: 'sd' });
    设置.sd.地址 = 'http://127.0.0.1:7860';
    设置.sd.种子 = 42;
    const 结果 = await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    expect(结果.结果.种子).toBe(20250101);
  });

  it('info 不是合法 JSON 时退回请求里的种子，而不是报错', async () => {
    安装假SD({ info: '这不是 JSON' });
    const 设置 = 建设置({ 渠道: 'sd' });
    设置.sd.地址 = 'http://127.0.0.1:7860';
    设置.sd.种子 = 42;
    const 结果 = await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    expect(结果.结果.种子).toBe(42);
  });

  it('有认证时发 Basic 头', async () => {
    const 记录 = 安装假SD();
    const 设置 = 建设置({ 渠道: 'sd' });
    设置.sd.地址 = 'http://127.0.0.1:7860';
    设置.sd.认证 = 'u:p';
    await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    expect(记录.头[0].Authorization).toBe(`Basic ${btoa('u:p')}`);
  });

  it('没有认证时不发 Authorization', async () => {
    const 记录 = 安装假SD();
    const 设置 = 建设置({ 渠道: 'sd' });
    设置.sd.地址 = 'http://127.0.0.1:7860';
    设置.sd.认证 = '';
    await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    expect(记录.头[0].Authorization).toBeUndefined();
  });

  it('多张图时取第一张非空', async () => {
    安装假SD({ 图片数: 2 });
    const 设置 = 建设置({ 渠道: 'sd' });
    设置.sd.地址 = 'http://127.0.0.1:7860';
    const 结果 = await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    expect(结果.结果.数据地址).toContain('data:image/png');
  });

  it('服务端报错时抛出状态码', async () => {
    安装假SD({ 失败: 500 });
    const 设置 = 建设置({ 渠道: 'sd' });
    设置.sd.地址 = 'http://127.0.0.1:7860';
    await expect(生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文))
      .rejects.toThrow(/500/);
  });

  it('地址为空时立刻报错，不发请求', async () => {
    const 记录 = 安装假SD();
    const 设置 = 建设置({ 渠道: 'sd' });
    设置.sd.地址 = '';
    await expect(生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文))
      .rejects.toThrow(/地址/);
    expect(记录.地址).toHaveLength(0);
  });

  it('资源列表能读回模型、采样器、VAE、调度器、放大算法', async () => {
    安装假SD();
    const 设置 = 建设置({ 渠道: 'sd' });
    设置.sd.地址 = 'http://127.0.0.1:7860';
    const 资源 = await 读取SD资源列表(设置.sd);
    expect(资源.模型).toContain('模型甲.safetensors');
    expect(资源.采样器).toContain('Euler a');
    expect(资源.VAE).toContain('vae-ft.safetensors');
    expect(资源.调度器).toContain('Karras');
    expect(资源.放大算法).toContain('R-ESRGAN 4x+');
  });

  it('开了高清修复与 ADetailer 时字段进入载荷', async () => {
    const 记录 = 安装假SD();
    const 设置 = 建设置({ 渠道: 'sd' });
    设置.sd.地址 = 'http://127.0.0.1:7860';
    设置.sd.高清修复 = true;
    设置.sd.高清放大倍数 = 2;
    设置.sd.高清第二轮步数 = 15;
    设置.sd.ADetailer = true;
    await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    const 载荷 = 记录.最后Json as Record<string, unknown>;
    expect(载荷.enable_hr).toBe(true);
    expect(载荷.hr_scale).toBe(2);
    expect(载荷.hr_second_pass_steps).toBe(15);
    expect(载荷.alwayson_scripts).toBeDefined();
  });
});

describe('Banana / Grok 出图链路', () => {
  it('推导出 /v1/images/generations 并取回 b64', async () => {
    const 记录 = 安装假Banana();
    const 设置 = 建设置({ 渠道: 'banana' });
    设置.banana.地址 = 'https://api.openai.com';
    设置.banana.APIKey = 'k';
    const 结果 = await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);

    expect(记录.地址).toHaveLength(1);
    expect(记录.地址[0]).toBe('https://api.openai.com/v1/images/generations');
    expect(结果.结果.数据地址).toContain('data:image/png');
    expect(结果.结果.渠道).toBe('banana');
    // 该渠道没有种子概念。
    expect(结果.结果.种子).toBe(-1);
  });

  it('上行载荷含 model / prompt / n / size', async () => {
    const 记录 = 安装假Banana();
    const 设置 = 建设置({ 渠道: 'banana' });
    设置.banana.地址 = 'https://api.openai.com';
    设置.banana.APIKey = 'k';
    设置.banana.模型 = 'gpt-image-1';
    设置.banana.尺寸 = '1024x1024';
    await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    const 载荷 = 记录.最后Json as Record<string, unknown>;
    expect(载荷.model).toBe('gpt-image-1');
    expect(载荷.n).toBe(1);
    expect(载荷.size).toBe('1024x1024');
    expect(String(载荷.prompt)).toContain('best quality');
  });

  it('imagen 模型不发 size', async () => {
    const 记录 = 安装假Banana();
    const 设置 = 建设置({ 渠道: 'banana' });
    设置.banana.地址 = 'https://api.openai.com';
    设置.banana.APIKey = 'k';
    设置.banana.模型 = 'imagen-4.0-generate-001';
    await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    expect(记录.最后Json).not.toHaveProperty('size');
  });

  it('AI 自主分辨率给出的尺寸覆盖设置', async () => {
    const 记录 = 安装假Banana();
    const 设置 = 建设置({ 渠道: 'banana' });
    设置.banana.地址 = 'https://api.openai.com';
    设置.banana.APIKey = 'k';
    设置.banana.模型 = 'gpt-image-1';
    await 生成单张插图(设置, { 提示词标记: 'image###1girl 1536x1024###' }, 上下文);
    expect((记录.最后Json as Record<string, unknown>).size).toBe('1536x1024');
  });

  it('认顶层 images 数组形态', async () => {
    安装假Banana({ 形态: 'images' });
    const 设置 = 建设置({ 渠道: 'banana' });
    设置.banana.地址 = 'https://api.openai.com';
    设置.banana.APIKey = 'k';
    const 结果 = await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    expect(结果.结果.数据地址).toContain('data:image/png');
  });

  it('认顶层 image 字符串形态', async () => {
    安装假Banana({ 形态: 'image' });
    const 设置 = 建设置({ 渠道: 'banana' });
    设置.banana.地址 = 'https://api.openai.com';
    设置.banana.APIKey = 'k';
    const 结果 = await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    expect(结果.结果.数据地址).toContain('data:image/png');
  });

  it('url 形态时自己下载成数据地址（浏览器直连常被跨域挡掉）', async () => {
    const 记录 = 安装假Banana({ 形态: 'url' });
    const 设置 = 建设置({ 渠道: 'banana' });
    设置.banana.地址 = 'https://api.openai.com';
    设置.banana.APIKey = 'k';
    const 结果 = await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    expect(记录.地址).toHaveLength(2);
    expect(记录.地址[1]).toContain('/下载/');
    expect(结果.结果.数据地址).toContain('data:image/png');
  });

  it('发 Bearer 认证头', async () => {
    const 记录 = 安装假Banana();
    const 设置 = 建设置({ 渠道: 'banana' });
    设置.banana.地址 = 'https://api.openai.com';
    设置.banana.APIKey = '假Key';
    await 生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文);
    expect(记录.头[0].Authorization).toBe('Bearer 假Key');
  });

  it('缺 API Key 时立刻报错，不发请求', async () => {
    const 记录 = 安装假Banana();
    const 设置 = 建设置({ 渠道: 'banana' });
    设置.banana.地址 = 'https://api.openai.com';
    设置.banana.APIKey = '';
    await expect(生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文))
      .rejects.toThrow(/API Key/);
    expect(记录.地址).toHaveLength(0);
  });

  it('服务端报错时抛出状态码与响应体', async () => {
    安装假Banana({ 失败: 429 });
    const 设置 = 建设置({ 渠道: 'banana' });
    设置.banana.地址 = 'https://api.openai.com';
    设置.banana.APIKey = 'k';
    await expect(生成单张插图(设置, { 提示词标记: 'image###1girl###' }, 上下文))
      .rejects.toThrow(/429/);
  });

  it('参考图开关关闭时走 generations，不读参考图也不发上传', async () => {
    const 记录 = 安装假Banana();
    const 设置 = 建设置({ 渠道: 'banana' });
    设置.banana.地址 = 'https://api.openai.com';
    设置.banana.APIKey = 'k';
    设置.banana.参考图上传 = false;
    await 生成单张插图(
      设置,
      { 提示词标记: 'image###1girl###', 参考图: { 数据地址: 'data:image/png;base64,AQID', 文件名: 'r.png' } },
      上下文,
    );
    // 开关关闭 → 不读参考图，直接发一次 generations 请求。
    expect(记录.地址).toHaveLength(1);
    expect(记录.地址[0]).toBe('https://api.openai.com/v1/images/generations');
  });

  it('参考图开关开启时改走 edits 并读一次参考图', async () => {
    const 记录 = 安装假Banana();
    const 设置 = 建设置({ 渠道: 'banana' });
    设置.banana.地址 = 'https://api.openai.com';
    设置.banana.APIKey = 'k';
    设置.banana.参考图上传 = true;
    设置.banana.编辑格式 = 'form_data';
    await 生成单张插图(
      设置,
      { 提示词标记: 'image###1girl###', 参考图: { 数据地址: 'data:image/png;base64,AQID', 文件名: 'r.png' } },
      上下文,
    );
    // 第一次读参考图（数据地址），第二次才是 edits。
    expect(记录.地址[1]).toBe('https://api.openai.com/v1/images/edits');
    expect(记录.最后表单?.get('prompt')).toBeDefined();
    expect(String(记录.最后表单?.get('model'))).toBe('gpt-image-1');
  });
});
