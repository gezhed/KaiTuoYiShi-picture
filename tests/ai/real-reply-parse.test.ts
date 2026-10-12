// @vitest-environment jsdom
/**
 * 用用户真实的 Gemini 回复做端到端解析回归。
 *
 * 这份回复（`诊断信息.txt`）是修复前完全解析不出来的真实样本，含两个坑：
 *   ① 模型在 `<thinking>` 里**预演了一份残缺的 `<images>`**，容器匹配会落到错的位置，
 *      结果只得到一张 9 字符的假提示词 → 正文里插不进任何图；
 *   ② 每个 tag 都带预设要求的 `sāfe&` 前缀，不是合法绘图标签，必须剥掉。
 *
 * 文件不在时该组用例跳过（守卫而非报错）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { 剥掉思维链 } from '@/services/ai/imageGen/illustrationAgent';
import { 解析插图提示词 } from '@/services/ai/imageGen/illustrationProtocol';
import { 剥安全前缀 } from '@/services/ai/imageGen/wordReplacement';

const 路径 = resolve(__dirname, '../../../诊断信息.txt');

function 读回复(): string | null {
  if (!existsSync(路径)) return null;
  return readFileSync(路径, 'utf8').replace(/^LLM 原文：\n/, '');
}

const 回复 = 读回复();
const 选项 = { 开始标记: 'image###', 结束标记: '###', 回显思考: false };

describe('用户真实回复的解析回归', () => {
  it.skipIf(!回复)('这段回复确实在思维链里藏了一份残缺的 <images>', () => {
    // 记录这个坑的存在：思维链里出现 <images> 是模型没遵守「禁止在思维链输出 images」。
    const 思维链 = (回复 as string).match(/<thinking>[\s\S]*?<\/thinking>/i)?.[0] ?? '';
    expect(思维链).toContain('<images>');
  });

  it.skipIf(!回复)('不剥思维链时第一张图的锚点被污染成空（这正是当初不出图的原因）', () => {
    const 坏 = 解析插图提示词(回复 as string, 选项);
    const 好 = 解析插图提示词(剥掉思维链(回复 as string), 选项);

    // 污染的具体表现：思维链里那段残缺 <images> 先被容器匹配吃掉，
    // 于是第一张图的 <regex> 落空、tag 里混进了思维链文本。
    expect(坏[0].regex).toBe('');
    expect(坏[0].tag).toContain('完整闭合');

    // 修复后三张图的锚点都来自真实正文行。
    expect(好).toHaveLength(3);
    for (const 项 of 好) expect(项.regex.length).toBeGreaterThan(10);
    expect(好[0].tag).not.toContain('完整闭合');
    expect(好[0].tag).not.toContain('思维链');
  });

  it.skipIf(!回复)('剥掉思维链后解析出 3 张图，且锚点来自思维链之外的真实正文行', () => {
    const 好 = 解析插图提示词(剥掉思维链(回复 as string), 选项);
    expect(好).toHaveLength(3);
    for (const 项 of 好) {
      expect(项.regex.length).toBeGreaterThan(10);
      expect(项.regex).not.toContain('<images>');
      expect(项.regex).not.toContain('</thinking>');
    }
    // 锚点必须是正文里真实存在的句子（模型给的挂载点）。
    expect(好[0].regex).toContain('舷窗外');
    expect(好[1].regex).toContain('走廊两侧');
    expect(好[2].regex).toContain('冷却剂蒸汽');
  });

  it.skipIf(!回复)('每张图的提示词都有足够多的标签（不是空壳）', () => {
    const 好 = 解析插图提示词(剥掉思维链(回复 as string), 选项);
    for (const 项 of 好) {
      expect(项.tag.length).toBeGreaterThan(500);
    }
  });

  it.skipIf(!回复)('剥掉 sāfe& 前缀后不再残留该标记', () => {
    const 好 = 解析插图提示词(剥掉思维链(回复 as string), 选项);
    for (const 项 of 好) {
      const 干净 = 剥安全前缀(项.tag);
      expect(干净).not.toContain('sāfe&');
      // 标签本体必须保留，不能把内容一起删掉。
      expect(干净).toContain('masterpiece');
      expect(干净.length).toBeLessThan(项.tag.length);
    }
  });

  it.skipIf(!回复)('尺寸能被剥出来（预设给了 1216x832 / 832x1216 / 1024x1024）', () => {
    const 好 = 解析插图提示词(剥掉思维链(回复 as string), 选项);
    const 尺寸 = 好.map((项) => 项.tag.match(/(\d{2,4})\s*[xX*]\s*(\d{2,4})/)?.[0] ?? '');
    expect(尺寸[0]).toContain('1216x832');
    expect(尺寸[1]).toContain('832x1216');
    expect(尺寸[2]).toContain('1024x1024');
  });
});

describe('剥掉思维链的各种形态', () => {
  it('剥掉闭合的 <thinking>', () => {
    expect(剥掉思维链('前<thinking>污染<images>x</images></thinking>后')).toBe('前后');
  });

  it('剥掉 <thought>（另一种写法）', () => {
    expect(剥掉思维链('前<thought>污染</thought>后')).toBe('前后');
  });

  it('被截断的未闭合 <thinking> 丢到末尾', () => {
    expect(剥掉思维链('保留<thinking>截断了')).toBe('保留');
  });

  it('大小写不敏感', () => {
    expect(剥掉思维链('a<THINKING>x</THINKING>b')).toBe('ab');
  });

  it('多个思维链块全部剥掉', () => {
    expect(剥掉思维链('a<thinking>1</thinking>b<thinking>2</thinking>c')).toBe('abc');
  });

  it('没有思维链时原样返回', () => {
    expect(剥掉思维链('普通内容')).toBe('普通内容');
  });
});

describe('剥安全前缀', () => {
  it('去掉 sāfe& 与 safe&', () => {
    expect(剥安全前缀('sāfe&1girl, safe&solo')).toBe('1girl, solo');
  });

  it('保留带权重的标签本体', () => {
    expect(剥安全前缀('sāfe&(crimson light:1.3)')).toBe('(crimson light:1.3)');
  });

  it('不含前缀时不变', () => {
    expect(剥安全前缀('1girl, solo')).toBe('1girl, solo');
  });

  it('空输入不抛错', () => {
    expect(剥安全前缀('')).toBe('');
  });
});
