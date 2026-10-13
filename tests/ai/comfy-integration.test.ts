// @vitest-environment jsdom
/**
 * 假服务端集成测试。
 *
 * 覆盖单张出图的完整链路：占位符替换 → 提交 → 轮询历史 → 取回图片 → 落成数据地址。
 * 这些环节各自有单元测试，但**拼起来**才暴露得了「字符串当对象用」「轮询查错 id」
 * 这类跨模块缺陷。同时用提交体断言实际上行的工作流内容。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { 安装假ComfyUI, 卸载假ComfyUI } from './helpers/fakeComfy';
import { 生成ComfyUI图片 } from '@/services/ai/imageGen/comfyEngine';
import { 创建默认ComfyUI设置 } from '@/models/genSystem';
import type { ComfyUI设置 } from '@/models/genSystem';

/**
 * 一份含全部常用占位符的 API 格式工作流。
 *
 * 占位符名以 `workflowTokens.ts` 的占位符表为**准**（照搬上游）——不是
 * `%negative%` / `%model%` / `%sampler%` / `%cfg%` 这些想当然的写法。
 * 写错名字不会报错，只会留一个未替换的 token 在提交体里。
 */
const 工作流JSON = JSON.stringify({
  4: {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: '%MODEL_NAME%' },
  },
  5: {
    class_type: 'EmptyLatentImage',
    inputs: { width: '%width%', height: '%height%', batch_size: 1 },
  },
  6: {
    class_type: 'CLIPTextEncode',
    inputs: { text: '%prompt%', clip: ['4', 1] },
  },
  7: {
    class_type: 'CLIPTextEncode',
    inputs: { text: '%negative_prompt%', clip: ['4', 1] },
  },
  3: {
    class_type: 'KSampler',
    inputs: {
      seed: '%seed%',
      steps: '%steps%',
      cfg: '%cfg_scale%',
      sampler_name: '%sampler_name%',
      scheduler: '%scheduler%',
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
    },
  },
  10: {
    class_type: 'LoadImage',
    inputs: { image: '%comfyuicankaotupian%' },
  },
});

function 建设置(补丁: (项: ComfyUI设置) => void = () => {}): ComfyUI设置 {
  const 设置 = 创建默认ComfyUI设置();
  const 档案 = 设置.档案列表[设置.当前档案];
  档案.连接.地址 = 'http://假comfy:8188';
  // 超时压到很短，避免排队用例真的等 1800 秒。
  档案.连接.超时秒数 = 5;
  档案.参数.模型 = '模型A.safetensors';
  档案.参数.种子 = 12345;
  档案.工作流Json = 工作流JSON;
  补丁(设置);
  return 设置;
}

afterEach(() => {
  卸载假ComfyUI();
});

describe('出图链路（假 ComfyUI）', () => {
  it('提交 → 轮询 → 取图，返回数据地址与尺寸', async () => {
    const 记录 = 安装假ComfyUI();
    const 结果 = await 生成ComfyUI图片({
      正向提示词: '1girl, solo',
      负向提示词: 'lowres',
      宽度: 832,
      高度: 1216,
      种子: 999,
    }, { comfyui: 建设置() });

    expect(结果.数据地址.startsWith('data:image/png;base64,')).toBe(true);
    expect(结果.宽度).toBe(832);
    expect(结果.高度).toBe(1216);
    expect(结果.种子).toBe(999);
    // 三个必经端点都访问到了。
    expect(记录.请求.some((项) => 项.includes('/prompt'))).toBe(true);
    expect(记录.请求.some((项) => 项.includes('/history/'))).toBe(true);
    expect(记录.请求.some((项) => 项.includes('/view'))).toBe(true);
  });

  it('上行的工作流已把占位符换成真实值', async () => {
    const 记录 = 安装假ComfyUI();
    await 生成ComfyUI图片({
      正向提示词: '1girl, 银发',
      负向提示词: 'lowres, 模糊',
      宽度: 960,
      高度: 1280,
      种子: 4242,
    }, { comfyui: 建设置() });

    const 已提交 = 记录.最后提交?.prompt as Record<string, { inputs: Record<string, unknown> }>;
    expect(已提交).toBeTruthy();

    // 提示词进到了 CLIPTextEncode。
    expect(已提交['6'].inputs.text).toBe('1girl, 银发');
    expect(已提交['7'].inputs.text).toBe('lowres, 模糊');
    // 尺寸进到了 EmptyLatentImage，且是**数字**而不是字符串。
    expect(已提交['5'].inputs.width).toBe(960);
    expect(已提交['5'].inputs.height).toBe(1280);
    // 种子、步数、cfg 进到了 KSampler。
    expect(已提交['3'].inputs.seed).toBe(4242);
    expect(typeof 已提交['3'].inputs.steps).toBe('number');
    expect(typeof 已提交['3'].inputs.cfg).toBe('number');
    // 模型名进到了加载器。
    expect(已提交['4'].inputs.ckpt_name).toBe('模型A.safetensors');
  });

  it('角色 LoRA 槽位：只填出场角色的槽，空槽的 LoraLoader 被摘掉并接回上游', async () => {
    const 记录 = 安装假ComfyUI();
    // 在标准工作流上串两个 LoRA 槽：4 → 20 → 21 → KSampler / CLIPTextEncode。
    const 带LoRA = JSON.parse(工作流JSON) as Record<string, { class_type?: string; inputs: Record<string, unknown> }>;
    带LoRA['20'] = {
      class_type: 'LoraLoader',
      inputs: { model: ['4', 0], clip: ['4', 1], lora_name: '%lora_name_1%', strength_model: '%lora_weight_1%', strength_clip: '%lora_weight_1%' },
    };
    带LoRA['21'] = {
      class_type: 'LoraLoader',
      inputs: { model: ['20', 0], clip: ['20', 1], lora_name: '%lora_name_2%', strength_model: '%lora_weight_2%', strength_clip: '%lora_weight_2%' },
    };
    带LoRA['3'].inputs.model = ['21', 0];
    带LoRA['6'].inputs.clip = ['21', 1];
    带LoRA['7'].inputs.clip = ['21', 1];

    await 生成ComfyUI图片({
      正向提示词: '1girl, 流萤',
      负向提示词: 'lowres',
      种子: 7,
      // 只有一个角色出场 → 只有第 1 槽有值。
      lora: [{ 名称: 'krea.safetensors', 权重: 0.75 }],
    }, {
      comfyui: 建设置((设置) => {
        设置.档案列表[设置.当前档案].工作流Json = JSON.stringify(带LoRA);
      }),
    });

    const 已提交 = 记录.最后提交?.prompt as Record<string, { inputs: Record<string, unknown> }>;
    // 第 1 槽填上了名字与权重（权重是数字）。
    expect(已提交['20'].inputs.lora_name).toBe('krea.safetensors');
    expect(已提交['20'].inputs.strength_model).toBe(0.75);
    expect(已提交['20'].inputs.strength_clip).toBe(0.75);
    // 第 2 槽的节点整条消失，下游接到第 1 槽。
    expect(已提交['21']).toBeUndefined();
    expect((已提交['3'].inputs.model as unknown[])[0]).toBe('20');
    expect((已提交['6'].inputs.clip as unknown[])[0]).toBe('20');
    // 提交体里不该残留任何 LoRA 占位符。
    expect(JSON.stringify(已提交)).not.toContain('%lora_');
  });

  it('一个角色 LoRA 都没有时，两个槽都摘掉，KSampler 直接接 Checkpoint', async () => {
    const 记录 = 安装假ComfyUI();
    const 带LoRA = JSON.parse(工作流JSON) as Record<string, { class_type?: string; inputs: Record<string, unknown> }>;
    带LoRA['20'] = {
      class_type: 'LoraLoader',
      inputs: { model: ['4', 0], clip: ['4', 1], lora_name: '%lora_name_1%', strength_model: '%lora_weight_1%' },
    };
    带LoRA['3'].inputs.model = ['20', 0];
    带LoRA['6'].inputs.clip = ['20', 1];

    await 生成ComfyUI图片({
      正向提示词: 'x',
      负向提示词: 'y',
    }, {
      comfyui: 建设置((设置) => {
        设置.档案列表[设置.当前档案].工作流Json = JSON.stringify(带LoRA);
      }),
    });

    const 已提交 = 记录.最后提交?.prompt as Record<string, { inputs: Record<string, unknown> }>;
    expect(已提交['20']).toBeUndefined();
    expect((已提交['3'].inputs.model as unknown[])[0]).toBe('4');
    expect((已提交['6'].inputs.clip as unknown[])[0]).toBe('4');
  });

  it('提交体里不含任何未替换的占位符', async () => {
    const 记录 = 安装假ComfyUI();
    await 生成ComfyUI图片({
      正向提示词: 'x',
      负向提示词: 'y',
      参考图: { 数据地址: 'data:image/png;base64,AQID', 文件名: '参考.png' },
    }, { comfyui: 建设置() });

    const 文本 = JSON.stringify(记录.最后提交);
    expect(文本).not.toMatch(/%[a-zA-Z]+%/);
    // 参考图占位符被换成了上传返回的文件名。
    expect(文本).toContain('已上传.png');
  });

  it('有参考图时先上传再提交', async () => {
    const 记录 = 安装假ComfyUI();
    await 生成ComfyUI图片({
      正向提示词: 'x',
      负向提示词: 'y',
      // 用独立的数据地址：引擎按「地址::文件名::数据长度」缓存已上传的参考图，
      // 与前面的用例共用同一份数据会命中缓存而跳过上传（那是正确行为，不是缺陷）。
      参考图: { 数据地址: 'data:image/png;base64,QUJDRA==', 文件名: '参考-上传顺序.png' },
    }, { comfyui: 建设置() });

    const 上传下标 = 记录.请求.findIndex((项) => 项.includes('/upload/image'));
    const 提交下标 = 记录.请求.findIndex((项) => 项.includes('/prompt'));
    expect(上传下标).toBeGreaterThanOrEqual(0);
    expect(提交下标).toBeGreaterThan(上传下标);
  });

  it('同一张参考图第二次出图不再重复上传（命中上传缓存）', async () => {
    const 参考图 = { 数据地址: 'data:image/png;base64,QUJDREVG', 文件名: '参考-缓存.png' };
    const 首次 = 安装假ComfyUI();
    await 生成ComfyUI图片({ 正向提示词: 'x', 负向提示词: 'y', 参考图 }, { comfyui: 建设置() });
    expect(首次.请求.some((项) => 项.includes('/upload/image'))).toBe(true);

    const 二次 = 安装假ComfyUI();
    await 生成ComfyUI图片({ 正向提示词: 'x', 负向提示词: 'y', 参考图 }, { comfyui: 建设置() });
    expect(二次.请求.some((项) => 项.includes('/upload/image'))).toBe(false);
    expect(二次.请求.some((项) => 项.includes('/prompt'))).toBe(true);
  });

  it('排队时轮询会继续，直到历史里出现结果', async () => {
    const 记录 = 安装假ComfyUI({ 排队次数: 2 });
    const 结果 = await 生成ComfyUI图片({
      正向提示词: 'x',
      负向提示词: 'y',
    }, { comfyui: 建设置() });

    expect(结果.数据地址).toContain('data:image/png');
    const 历史次数 = 记录.请求.filter((项) => 项.includes('/history/')).length;
    expect(历史次数).toBeGreaterThanOrEqual(3);
  });

  it('轮询查询的是提交时返回的 promptId', async () => {
    const 记录 = 安装假ComfyUI();
    await 生成ComfyUI图片({ 正向提示词: 'x', 负向提示词: 'y' }, { comfyui: 建设置() });
    // promptId 会被 encodeURIComponent 编码，所以按解码后的路径比对。
    const 历史路径 = 记录.请求
      .map((项) => new URL(项).pathname)
      .filter((项) => 项.startsWith('/history/'))
      .map((项) => decodeURIComponent(项));
    expect(历史路径.length).toBeGreaterThan(0);
    expect(历史路径.every((项) => 项 === '/history/任务_1')).toBe(true);
  });

  it('取图时带上历史里给出的文件名与 subfolder', async () => {
    const 记录 = 安装假ComfyUI({
      输出: { 9: { images: [{ filename: '图.png', subfolder: '子目录', type: 'output' }] } },
    });
    await 生成ComfyUI图片({ 正向提示词: 'x', 负向提示词: 'y' }, { comfyui: 建设置() });
    expect(记录.最后视图参数?.get('filename')).toBe('图.png');
    expect(记录.最后视图参数?.get('type')).toBe('output');
  });

  it('提交被拒时报出服务端错误体，而不是静默失败', async () => {
    const 记录 = 安装假ComfyUI({ 提交失败: '{"error":{"type":"prompt_outputs_failed_validation","message":"模型不存在"}}' });
    await expect(生成ComfyUI图片({
      正向提示词: 'x',
      负向提示词: 'y',
    }, { comfyui: 建设置() })).rejects.toThrow(/模型不存在|prompt_outputs_failed_validation/);
    // 提交失败后不应再查历史。
    expect(记录.请求.some((项) => 项.includes('/history/'))).toBe(false);
  });

  it('历史里没有任何输出时报错', async () => {
    安装假ComfyUI({ 输出: {} });
    await expect(生成ComfyUI图片({
      正向提示词: 'x',
      负向提示词: 'y',
    }, { comfyui: 建设置() })).rejects.toThrow();
  });

  it('没有参考图时不访问上传端点', async () => {
    const 记录 = 安装假ComfyUI();
    await 生成ComfyUI图片({ 正向提示词: 'x', 负向提示词: 'y' }, { comfyui: 建设置() });
    expect(记录.请求.some((项) => 项.includes('/upload/image'))).toBe(false);
  });

  it('自主关闭参考图上传时不访问上传端点（即使给了参考图）', async () => {
    const 记录 = 安装假ComfyUI();
    await 生成ComfyUI图片({
      正向提示词: 'x',
      负向提示词: 'y',
      参考图: { 数据地址: 'data:image/png;base64,AQID', 文件名: '参考.png' },
    }, { comfyui: 建设置((项) => { 项.参考图上传 = false; }) });
    expect(记录.请求.some((项) => 项.includes('/upload/image'))).toBe(false);
  });

  it('探测存活与读取资源列表也走假服务端', async () => {
    const { 探测Comfy存活, 读取Comfy资源列表 } = await import('@/services/ai/imageGen/comfyClient');
    安装假ComfyUI();
    expect(await 探测Comfy存活('http://假comfy:8188')).toBe(true);
    const { 资源 } = await 读取Comfy资源列表('http://假comfy:8188');
    expect(资源.模型).toContain('模型A.safetensors');
    expect(资源.采样器).toContain('euler');
  });
});
