/**
 * 教程里那份工作流（`文生图教程/工作流.json`）的守门测试。
 *
 * 它是用户复制粘贴的第一份配置，错了的代价是「出图与正文无关」或
 * `Value not in list` —— 而且都不会在应用里报错。用户实际踩过：
 * 提示词用的是 `__PROMPT__`、模型名写死、缺 LoRA 槽位。
 *
 * 所以这里按「应用真的会怎么用它」来验，而不是只比对文本：
 *   ① 占位符能被替换干净，且替换后是合法 JSON；
 *   ② 正负提示词真的进了 CLIPTextEncode，模型/尺寸/采样参数真的到位；
 *   ③ 4 个 LoRA 槽位在链上（KSampler 与 CLIPTextEncode 指向最后一环）；
 *   ④ 拿一份服务端资源列表跑自检，不出现「缺提示词占位符 / 缺 LoRA 槽位」这类警告。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { 占位符表, 替换工作流占位符, 扫描剩余占位符 } from '@/services/ai/imageGen/workflowTokens';
import { 运行自检 } from '@/services/ai/imageGen/preflight';
import { 创建默认文生图系统设置, 创建空角色部位字段 } from '@/models/genSystem';
import type { 占位符取值 } from '@/models/genSystem';

const 工作流路径 = resolve(__dirname, '../../文生图教程/工作流.json');
const 工作流原文 = readFileSync(工作流路径, 'utf8');

const 取值: 占位符取值 = {
  seed: 12345,
  steps: 28,
  cfgScale: 7,
  samplerName: 'euler_ancestral',
  scheduler: 'normal',
  width: 832,
  height: 1216,
  prompt: '1girl, silver hair',
  negativePrompt: 'lowres',
  modelName: 'sd_xl_base_1.0.safetensors',
  vae: '',
  clip: '',
  ipaPreset: '',
  ipaWeight: 0.8,
  ipaFaceWeight: 1.1,
  ipaDetailStrength: 0.8,
  ipaAtmosphereStrength: 0.8,
  referenceImage: '',
  inpaintDenoise: 0.75,
};

/** 假的服务端资源列表（自检的资源类检查需要它）。 */
const 资源 = {
  模型: ['sd_xl_base_1.0.safetensors'],
  采样器: ['euler_ancestral'],
  调度器: ['normal'],
  vae: [],
  clip: [],
  lora: ['krea.safetensors'],
};

function 替换后节点表(): Record<string, { class_type?: string; inputs: Record<string, unknown> }> {
  return JSON.parse(替换工作流占位符(工作流原文, 取值)) as Record<
    string,
    { class_type?: string; inputs: Record<string, unknown> }
  >;
}

describe('教程工作流：能被应用正确使用', () => {
  it('替换后没有残留占位符，且是合法 JSON', () => {
    const 替换后 = 替换工作流占位符(工作流原文, 取值);
    expect(扫描剩余占位符(替换后)).toEqual([]);
    expect(() => JSON.parse(替换后)).not.toThrow();
  });

  it('只用了占位符表里真实存在的 token', () => {
    const 已知 = new Set(占位符表.map((项) => 项.占位符));
    const 用到 = [...工作流原文.matchAll(/%[A-Za-z_0-9]+%/g)].map((项) => 项[0]);
    expect(用到.length).toBeGreaterThan(0);
    for (const token of 用到) {
      expect(已知.has(token), `用了一个表里没有的 token：${token}`).toBe(true);
    }
  });

  it('提示词、模型、尺寸、采样参数都真的落到节点上', () => {
    const 节点表 = 替换后节点表();
    expect(节点表['6'].inputs.text).toBe('1girl, silver hair');
    expect(节点表['7'].inputs.text).toBe('lowres');
    expect(节点表['4'].inputs.ckpt_name).toBe('sd_xl_base_1.0.safetensors');
    expect(节点表['5'].inputs.width).toBe(832);
    expect(节点表['5'].inputs.height).toBe(1216);
    expect(节点表['3'].inputs.seed).toBe(12345);
    expect(节点表['3'].inputs.steps).toBe(28);
    expect(节点表['3'].inputs.cfg).toBe(7);
    expect(节点表['3'].inputs.sampler_name).toBe('euler_ancestral');
    // 数值必须是数字，不能是字符串（否则 ComfyUI 会以类型不符拒绝）。
    for (const 键 of ['seed', 'steps', 'cfg']) {
      expect(typeof 节点表['3'].inputs[键]).toBe('number');
    }
  });

  it('4 个 LoRA 槽位串在同一条链上，采样器与文本编码指向链尾', () => {
    const 节点表 = 替换后节点表();
    // token 在原文里（替换后会变成设置里的值或空串）。
    const 原文表 = JSON.parse(工作流原文) as Record<string, { inputs: Record<string, unknown> }>;
    let 上一环 = ['4', 0];
    let 上一环Clip = ['4', 1];
    for (const 序号 of [1, 2, 3, 4]) {
      const 节点 = 节点表[`${19 + 序号}`];
      expect(节点.class_type, `槽位 ${序号} 的节点类型`).toBe('LoraLoader');
      expect(节点.inputs.model).toEqual(上一环);
      expect(节点.inputs.clip).toEqual(上一环Clip);
      expect(原文表[`${19 + 序号}`].inputs.lora_name).toBe(`%lora_name_${序号}%`);
      expect(原文表[`${19 + 序号}`].inputs.strength_model).toBe(`%lora_weight_${序号}%`);
      // 这次取值里没有 LoRA → 替换成空串；应用会在提交前把这类节点整条跳过。
      expect(节点.inputs.lora_name).toBe('');
      上一环 = [`${19 + 序号}`, 0];
      上一环Clip = [`${19 + 序号}`, 1];
    }
    expect(节点表['3'].inputs.model).toEqual(['23', 0]);
    expect(节点表['6'].inputs.clip).toEqual(['23', 1]);
    expect(节点表['7'].inputs.clip).toEqual(['23', 1]);
  });

  it('只有一个出图节点（SaveImage），否则应用可能取到中途那张', () => {
    const 节点表 = 替换后节点表();
    const 出图节点 = Object.entries(节点表).filter(([, 节点]) => /^(SaveImage|PreviewImage)$/.test(节点.class_type ?? ''));
    expect(出图节点.map(([id]) => id)).toEqual(['9']);
  });

  it('自检不报「缺提示词占位符」与「缺 LoRA 槽位」', () => {
    const 设置 = 创建默认文生图系统设置();
    设置.启用 = true;
    设置.渠道 = 'comfyui';
    const 档案 = 设置.comfyui.档案列表[设置.comfyui.当前档案];
    档案.连接.地址 = 'http://127.0.0.1:8188';
    档案.参数.模型 = 'sd_xl_base_1.0.safetensors';
    档案.工作流Json = 工作流原文;

    const 检查 = 运行自检(设置, 资源);
    const 标题列表 = 检查.检查项.map((项) => 项.标题);
    expect(标题列表.some((标题) => 标题.includes('没有正向提示词占位符'))).toBe(false);
    expect(标题列表.some((标题) => 标题.includes('没有负向提示词占位符'))).toBe(false);
    expect(标题列表.some((标题) => 标题.includes('没有 LoRA 槽位占位符'))).toBe(false);
    // 也不该出现「不认识的占位符」——这份工作流用的每个 token 都在表里。
    expect(标题列表.some((标题) => 标题.includes('不认识的占位符'))).toBe(false);
    expect(检查.检查项.filter((项) => 项.级别 === 'error')).toEqual([]);
  });

  it('角色绑了 LoRA 时，自检也不会说名字不存在（槽位已就位）', () => {
    const 设置 = 创建默认文生图系统设置();
    设置.启用 = true;
    设置.渠道 = 'comfyui';
    const 角色 = {
      ...创建空角色部位字段(),
      id: 'char_test',
      nameCN: '流萤',
      nameEN: 'firefly',
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
      LoRA: [{ id: 'l1', 名称: 'krea.safetensors', 权重: 0.8 }],
    };
    设置.角色卡 = { char_test: 角色 };
    设置.角色启用列表 = ['char_test'];
    const 档案 = 设置.comfyui.档案列表[设置.comfyui.当前档案];
    档案.连接.地址 = 'http://127.0.0.1:8188';
    档案.参数.模型 = 'sd_xl_base_1.0.safetensors';
    档案.工作流Json = 工作流原文;

    const 检查 = 运行自检(设置, 资源);
    // 名字在资源列表里 → 不报；缺槽位也不报（槽位已内置）。
    expect(检查.检查项.some((项) => 项.标题.includes('角色绑定的 LoRA 在 ComfyUI 上不存在'))).toBe(false);
    expect(检查.检查项.some((项) => 项.标题.includes('没有 LoRA 槽位占位符'))).toBe(false);
  });
});
