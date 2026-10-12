// @vitest-environment jsdom
/**
 * 内联插图机制（`<image>提示词</image>` 直接写在正文行间）的回归。
 *
 * 起因：用户指出正版行为是「提示词直接插在正文中」，而我们的实现只认块内 `regex:` 行，
 * 于是这种写法一张图也插不进去。上游从**块前最后一个非空行**取挂载点（L17376-L17388）。
 */
import { describe, expect, it } from 'vitest';
import { 剥掉内联插图, 提取内联插图 } from '@/utils/illustrationMarkup';

const 正文 = [
  '她推开了舱门。',
  '舷窗外，星海被暗红色的高能轨迹撕裂。',
  '<image>sāfe&1girl, masterpiece, space station</image>',
  '她回头看向走廊。',
  '走廊两侧的照明悉数熄灭。',
  '<image>',
  'regex: 走廊两侧的照明悉数熄灭。',
  'sāfe&1girl, emergency lighting',
  '</image>',
  '最后一段正文。',
].join('\n');

describe('提取内联插图', () => {
  it('认出两个块', () => {
    const 块 = 提取内联插图(正文);
    expect(块).toHaveLength(2);
  });

  it('没有 regex 行时用块前最后一个非空行当挂载点', () => {
    const 块 = 提取内联插图(正文);
    expect(块[0].上文行).toBe('舷窗外，星海被暗红色的高能轨迹撕裂。');
    expect(块[0].显式锚点).toBe('');
    expect(块[0].提示词).toContain('space station');
  });

  it('有 regex 行时用它当显式锚点，并把它从提示词里去掉', () => {
    const 块 = 提取内联插图(正文);
    expect(块[1].显式锚点).toBe('走廊两侧的照明悉数熄灭。');
    expect(块[1].提示词).toBe('sāfe&1girl, emergency lighting');
    expect(块[1].提示词).not.toContain('regex');
  });

  it('跳过空行取上文（块前有空行时不能取到空串）', () => {
    const 带空行 = '正文行\n\n\n<image>x</image>';
    expect(提取内联插图(带空行)[0].上文行).toBe('正文行');
  });

  it('保留块位置，供渲染层决定插在第几行之后', () => {
    const 块 = 提取内联插图(正文);
    expect(块[0].起始).toBeLessThan(块[1].起始);
    expect(正文.slice(块[0].起始, 块[0].起始 + 7)).toBe('<image>');
  });

  it('多次调用结果一致（共享正则对象必须复位）', () => {
    expect(提取内联插图(正文)).toHaveLength(2);
    expect(提取内联插图(正文)).toHaveLength(2);
  });

  it('没有插图块时返回空数组', () => {
    expect(提取内联插图('只有正文。')).toEqual([]);
  });
});

describe('剥掉内联插图（发给模型前必须干净）', () => {
  it('去掉 <image> 块，正文其余部分保留', () => {
    const 干净 = 剥掉内联插图(正文);
    expect(干净).not.toContain('<image>');
    expect(干净).not.toContain('space station');
    expect(干净).not.toContain('emergency lighting');
    expect(干净).toContain('她推开了舱门。');
    expect(干净).toContain('舷窗外，星海被暗红色的高能轨迹撕裂。');
    expect(干净).toContain('最后一段正文。');
  });

  it('顺带去掉 heredoc 标记（老方言）', () => {
    const 旧 = '正文A\nimage###1girl, solo###\n正文B';
    const 干净 = 剥掉内联插图(旧);
    expect(干净).not.toContain('image###');
    expect(干净).toContain('正文A');
    expect(干净).toContain('正文B');
  });

  it('顺带去掉 <images> 容器（没被 image 块覆盖的残留）', () => {
    const 旧 = '正文A\n<images>\n<image>x</image>\n</images>\n正文B';
    const 干净 = 剥掉内联插图(旧);
    expect(干净).not.toContain('<images>');
    expect(干净).not.toContain('</images>');
  });

  it('压缩多余空行，不留大段空白', () => {
    const 多空行 = 'A\n\n\n\n<image>x</image>\n\n\n\nB';
    expect(剥掉内联插图(多空行)).toBe('A\n\nB');
  });

  it('空输入不抛错', () => {
    expect(剥掉内联插图('')).toBe('');
  });
});
