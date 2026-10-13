import { describe, expect, it } from 'vitest';
import {
  替换工作流占位符,
  推荐占位符,
  是占位符值,
  是数值占位符,
  扫描剩余占位符,
  stringifyJsonNumber,
  stringifyJsonString,
  占位符表,
} from '@/services/ai/imageGen/workflowTokens';
import type { 占位符取值 } from '@/models/genSystem';

function 建取值(覆盖: Partial<占位符取值> = {}): 占位符取值 {
  return {
    seed: 12345,
    steps: 28,
    cfgScale: 6,
    samplerName: 'euler',
    scheduler: 'normal',
    width: 1024,
    height: 1024,
    prompt: 'a girl',
    negativePrompt: 'bad',
    modelName: 'model.safetensors',
    vae: 'vae.safetensors',
    clip: 'clip.safetensors',
    ipaPreset: 'STANDARD (medium strength)',
    ipaWeight: 0.8,
    ipaFaceWeight: 1.1,
    ipaDetailStrength: 0.8,
    ipaAtmosphereStrength: 0.8,
    referenceImage: 'ref.png',
    ...覆盖,
  };
}

describe('stringifyJsonNumber / stringifyJsonString', () => {
  it('数值型产出裸数字，字符串型产出带引号的 JSON 字符串', () => {
    expect(stringifyJsonNumber(28)).toBe('28');
    expect(stringifyJsonNumber('28')).toBe('28');
    expect(stringifyJsonString('euler')).toBe('"euler"');
  });

  it('数值型遇到非有限值时回退，回退也非法则取 0', () => {
    expect(stringifyJsonNumber('abc', 7)).toBe('7');
    expect(stringifyJsonNumber(undefined, 0.75)).toBe('0.75');
    expect(stringifyJsonNumber('abc')).toBe('0');
  });

  it('字符串型对 null/undefined 产出空串而不是 "null"', () => {
    expect(stringifyJsonString(null)).toBe('""');
    expect(stringifyJsonString(undefined)).toBe('""');
    expect(stringifyJsonString('a"b')).toBe('"a\\"b"');
  });
});

describe('替换工作流占位符', () => {
  it('数值占位符替换后成为裸 JSON 数字，工作流仍可解析', () => {
    const 工作流 = '{"3":{"class_type":"KSampler","inputs":{"seed":"%seed%","steps":"%steps%","cfg":"%cfg_scale%"}}}';
    const 结果 = 替换工作流占位符(工作流, 建取值());
    expect(结果).toContain('"seed":12345');
    expect(结果).toContain('"steps":28');
    expect(结果).toContain('"cfg":6');
    expect(JSON.parse(结果)).toBeTruthy();
  });

  it('字符串占位符替换后成为带引号的 JSON 字符串', () => {
    const 工作流 = '{"4":{"inputs":{"text":"%prompt%","negative":"%negative_prompt%"}}}';
    const 结果 = 替换工作流占位符(工作流, 建取值({ prompt: 'a "quoted" girl' }));
    expect(JSON.parse(结果)).toEqual({ 4: { inputs: { text: 'a "quoted" girl', negative: 'bad' } } });
  });

  it('不带双引号书写的占位符永远不会被替换', () => {
    const 工作流 = '{"inputs":{"seed": %seed%}}';
    expect(替换工作流占位符(工作流, 建取值())).toBe(工作流);
  });

  it('占位符嵌在更长字符串中间时同样被替换，且结果仍是合法 JSON', () => {
    // 来源默认工作流的 layer_weights 写法：搜索串自带双引号，因此替换会把
    // 内层引号一起去掉，只留下数字——这正是 JSON 仍然合法的原因。
    const 工作流 = '{"1":{"inputs":{"layer_weights":"0:0, 3:\"%c_xijie%\", 6:\"%c_fenwei%\", 9:0"}}}';
    const 结果 = 替换工作流占位符(工作流, 建取值({ ipaDetailStrength: 0.8, ipaAtmosphereStrength: 0.9 }));
    expect(JSON.parse(结果)).toEqual({
      1: { inputs: { layer_weights: '0:0, 3:0.8, 6:0.9, 9:0' } },
    });
  });

  it('未提供重绘取值时重绘类占位符替换为空串，强度回退 0.75', () => {
    const 工作流 = '{"inputs":{"i":"%inpaint_image%","m":"%inpaint_mask%","d":"%inpaint_denoise%"}}';
    const 结果 = 替换工作流占位符(工作流, 建取值());
    expect(JSON.parse(结果)).toEqual({ inputs: { i: '', m: '', d: 0.75 } });
  });
});

describe('扫描剩余占位符', () => {
  it('只报告仍以带引号形式存在的占位符', () => {
    const 文本 = '{"a":"%seed%","b":"%prompt%","c":"%width%"}';
    expect(扫描剩余占位符(文本).sort()).toEqual(['%prompt%', '%seed%', '%width%']);
    expect(扫描剩余占位符('{"a":"%seed%"}')).toHaveLength(1);
    expect(扫描剩余占位符('{"a":1}')).toEqual([]);
  });
});

describe('推荐占位符', () => {
  it('按键名推荐，且优先级按占位符表顺序', () => {
    expect(推荐占位符('seed')).toBe('%seed%');
    expect(推荐占位符('sampling_steps')).toBe('%steps%');
    expect(推荐占位符('cfg')).toBe('%cfg_scale%');
    expect(推荐占位符('ckpt_name')).toBe('%MODEL_NAME%');
    expect(推荐占位符('image')).toBe('%comfyuicankaotupian%');
    expect(推荐占位符('unrelated')).toBeNull();
  });
});

describe('占位符表与识别', () => {
  it('表内含来源那 23 个占位符 + 4 组角色 LoRA 槽位', () => {
    // 23 个来自上游 replacepro；LoRA 槽位是本应用新增的（4 组 × 名称/权重 = 8 个）。
    expect(占位符表).toHaveLength(23 + 8);
    const 全部 = 占位符表.map((项) => 项.占位符);
    expect(全部).toContain('%MODEL_NAME%');
    expect(全部).toContain('%inpaint_negative%');
    for (const 序号 of [1, 2, 3, 4]) {
      expect(全部).toContain(`%lora_name_${序号}%`);
      expect(全部).toContain(`%lora_weight_${序号}%`);
    }
  });

  it('LoRA 槽位：名称是字符串、权重是数字，且按出场顺序替换', () => {
    const 文本 = JSON.stringify({
      1: { class_type: 'LoraLoader', inputs: { lora_name: '%lora_name_1%', strength_model: '%lora_weight_1%', strength_clip: '%lora_weight_1%' } },
      2: { class_type: 'LoraLoader', inputs: { lora_name: '%lora_name_2%', strength_model: '%lora_weight_2%' } },
    });
    const 替换后 = 替换工作流占位符(文本, {
      ...建取值(),
      lora: [{ 名称: 'a.safetensors', 权重: 0.8 }],
    });
    // 输入是紧凑 JSON，替换后仍紧凑。
    expect(替换后).toContain('"lora_name":"a.safetensors"');
    expect(替换后).toContain('"strength_model":0.8');
    expect(替换后).toContain('"strength_clip":0.8');
    // 没填的槽替换成空串（真正的「跳过该节点」由 comfyEngine 在替换前处理）。
    expect(替换后).toContain('"lora_name":""');
    expect(替换后).toContain('"strength_model":1');
  });

  it('是占位符值只认 %…%', () => {
    expect(是占位符值('%seed%')).toBe(true);
    expect(是占位符值('seed')).toBe(false);
    expect(是占位符值('%%')).toBe(false);
  });

  it('数值占位符集合覆盖所有 number 类型定义', () => {
    for (const 定义 of 占位符表) {
      expect(是数值占位符(定义.占位符)).toBe(定义.类型 === 'number');
    }
  });
});
