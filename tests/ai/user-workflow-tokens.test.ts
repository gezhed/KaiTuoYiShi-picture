// @vitest-environment jsdom
/**
 * 用用户实际的工作流验证占位符表。
 *
 * 用户报的是 `Value not in list`（模型名写死），但他的工作流还有第二个问题：
 * 提示词用的是 `__PROMPT__` / `__NEGATIVE_PROMPT__`，而本应用只认 `%prompt%` 这类
 * 带百分号的 token。结果就是**提示词根本不会被替换**——这个不会报错，只会出图与正文无关。
 *
 * 这里把两种工作流放在一起对比，把「哪些写法不生效」固定下来。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { 占位符表, 替换工作流占位符, 扫描剩余占位符 } from '@/services/ai/imageGen/workflowTokens';

const 用户工作流路径 = resolve(__dirname, '../../../工作流.json');
const 修正版路径 = resolve(__dirname, '../../../工作流-修正版.json');

function 读(路径: string): string | null {
  try {
    return readFileSync(路径, 'utf8');
  } catch {
    return null;
  }
}

/** 一份完整的取值，用于观察替换效果。 */
const 取值 = {
  seed: 12345,
  steps: 28,
  cfgScale: 7,
  samplerName: 'euler_ancestral',
  scheduler: 'normal',
  width: 832,
  height: 1216,
  prompt: '1girl, 银发',
  negativePrompt: 'lowres',
  modelName: 'v1-5-pruned-emaonly.safetensors',
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

describe('用户原始工作流', () => {
  const 原文 = 读(用户工作流路径);

  it.skipIf(!原文)('提示词用的是 __PROMPT__，这套写法本应用不认', () => {
    const 替换后 = 替换工作流占位符(原文 as string, 取值);
    // `%…%` 体系只认带百分号的 token，所以 __PROMPT__ 原样留着。
    expect(替换后).toContain('__PROMPT__');
    expect(替换后).toContain('__NEGATIVE_PROMPT__');
    // 也就是说正文提示词根本没进工作流。
    expect(替换后).not.toContain('1girl, 银发');
  });

  it.skipIf(!原文)('模型名写死了，设置里的模型不会生效', () => {
    const 替换后 = 替换工作流占位符(原文 as string, 取值);
    expect(替换后).toContain('"ckpt_name": "v1-5-pruned-emaonly.safetensors"');
    // 服务端没有这个模型时就是用户遇到的 Value not in list。
    expect(替换后).toContain('v1-5-pruned-emaonly.safetensors');
  });

  it.skipIf(!原文)('尺寸与采样参数也写死了', () => {
    const 替换后 = 替换工作流占位符(原文 as string, 取值);
    expect(替换后).toContain('"width": 512');
    expect(替换后).toContain('"height": 768');
    expect(替换后).toContain('"steps": 20');
  });
});

describe('修正版工作流', () => {
  const 修正 = 读(修正版路径);

  it.skipIf(!修正)('替换后没有任何残留占位符', () => {
    const 替换后 = 替换工作流占位符(修正 as string, 取值);
    expect(扫描剩余占位符(替换后)).toEqual([]);
  });

  it.skipIf(!修正)('六个关键字段都被真实值替换', () => {
    const 替换后 = 替换工作流占位符(修正 as string, 取值);
    const 解析 = JSON.parse(替换后) as Record<string, { inputs: Record<string, unknown> }>;
    expect(解析['4'].inputs.ckpt_name).toBe('v1-5-pruned-emaonly.safetensors');
    expect(解析['6'].inputs.text).toBe('1girl, 银发');
    expect(解析['7'].inputs.text).toBe('lowres');
    expect(解析['5'].inputs.width).toBe(832);
    expect(解析['5'].inputs.height).toBe(1216);
    expect(解析['3'].inputs.seed).toBe(12345);
    expect(解析['3'].inputs.steps).toBe(28);
    expect(解析['3'].inputs.cfg).toBe(7);
    expect(解析['3'].inputs.sampler_name).toBe('euler_ancestral');
  });

  it.skipIf(!修正)('替换前后都是合法 JSON', () => {
    expect(() => JSON.parse(修正 as string)).not.toThrow();
    expect(() => JSON.parse(替换工作流占位符(修正 as string, 取值))).not.toThrow();
  });

  it.skipIf(!修正)('只用了占位符表里真实存在的 token', () => {
    const 已知 = new Set(占位符表.map((项) => 项.占位符));
    const 用到 = [...(修正 as string).matchAll(/%[A-Za-z_]+%/g)].map((项) => 项[0]);
    expect(用到.length).toBeGreaterThan(0);
    for (const token of 用到) {
      expect(已知.has(token), `修正版用了一个表里没有的 token：${token}`).toBe(true);
    }
  });
});
