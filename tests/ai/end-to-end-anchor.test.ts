// 端到端：真实回复 → 解析 → 锚点能否在正文里匹配到。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { 剥掉思维链 } from '@/services/ai/imageGen/illustrationAgent';
import { 解析插图提示词, 剥掉内联插图 } from '@/services/ai/imageGen/illustrationProtocol';
import { 解析插图锚点 } from '@/services/ai/imageGen/illustrationPipeline';
import { 匹配锚点行 } from '@/services/ai/imageGen/illustrationProtocol';

/*
 * 夹具放在仓库内（tests/fixtures/），不要写死机器上的绝对路径：
 * 原先指向工作区里的一个临时文件，工作区一挪动测试就整份报 ENOENT。
 */
const 夹具路径 = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/real-reply-anchors.txt');
const 原文 = readFileSync(夹具路径, 'utf8').replace(/^LLM 原文：\n/, '');
const 选项 = { 开始标记: 'image###', 结束标记: '###', 回显思考: false };

/** 模拟一段真实正文：含回复里那三句锚点。 */
const 正文 = [
  '广播刺耳地响了三遍。',
  '舷窗外，原本静谧的星海被几道暗红色的高能轨迹骤然撕裂。',
  '她下意识后退半步。',
  '走廊两侧的常态冷白照明在两秒内悉数熄灭，取而代之的是自顶棚压下的暗橙色应急警示光带。',
  '脚步声由远及近。',
  '白色的冷却剂蒸汽正从缝隙中嘶嘶喷涌，隐约能看见通道内部幽暗曲折的金属走线。',
].join('\n');

describe('端到端：锚点能否落到正文行上', () => {
  it('解析出的三条锚点都能在正文里匹配到', () => {
    const 记录 = 解析插图提示词(剥掉思维链(原文), 选项);
    expect(记录).toHaveLength(3);

    const 锚点 = 解析插图锚点(记录, 正文, undefined, true);
    expect(锚点).toHaveLength(3);

    const 行列表 = 正文.split('\n');
    for (const [i, 项] of 锚点.entries()) {
      const 命中 = 匹配锚点行(行列表, 项.锚点);
      console.log(`[${i}] 锚点="${项.锚点}" → 行号=${命中?.行索引 ?? '未命中'} 相似度=${命中?.相似度?.toFixed(2) ?? '-'}`);
      expect(命中, `第 ${i} 张图的锚点没匹配上：${项.锚点}`).not.toBeNull();
    }
  });

  it('三张图的行号分别是 1 / 3 / 5', () => {
    const 记录 = 解析插图提示词(剥掉思维链(原文), 选项);
    const 锚点 = 解析插图锚点(记录, 正文, undefined, true);
    const 行列表 = 正文.split('\n');
    const 行号 = 锚点.map((项) => 匹配锚点行(行列表, 项.锚点)?.行索引 ?? -1);
    expect(行号).toEqual([1, 3, 5]);
  });

  it('提示词里没有残留尺寸以外的杂物', () => {
    const 记录 = 解析插图提示词(剥掉思维链(原文), 选项);
    const 锚点 = 解析插图锚点(记录, 正文, undefined, true);
    for (const 项 of 锚点) {
      expect(项.提示词标记).toContain('image###');
      expect(项.提示词标记).not.toContain('<prompts>');
      expect(项.提示词标记).not.toContain('<regex>');
    }
  });

  it('正文里若残留插图文法，剥离后锚点仍在', () => {
    const 带块 = 正文.replace(
      '她下意识后退半步。',
      '她下意识后退半步。\n<image>1girl, solo</image>',
    );
    const 干净 = 剥掉内联插图(带块);
    expect(干净).not.toContain('<image>');
    const 行列表 = 干净.split('\n');
    const 记录 = 解析插图提示词(剥掉思维链(原文), 选项);
    const 锚点 = 解析插图锚点(记录, 干净, undefined, true);
    for (const 项 of 锚点) {
      expect(匹配锚点行(行列表, 项.锚点), `锚点没匹配上：${项.锚点}`).not.toBeNull();
    }
  });
});

describe('真实场景：正文本身就内联着 <image> 块', () => {
  /** 这正是渲染层拿到的东西：模型把提示词块写在了正文里。 */
  const 内联正文 = [
    '广播刺耳地响了三遍。',
    '舷窗外，原本静谧的星海被几道暗红色的高能轨迹骤然撕裂。',
    '<image>sāfe&1girl, masterpiece</image>',
    '她下意识后退半步。',
    '走廊两侧的常态冷白照明在两秒内悉数熄灭，取而代之的是自顶棚压下的暗橙色应急警示光带。',
    '<image>sāfe&1girl, emergency lighting</image>',
    '脚步声由远及近。',
    '白色的冷却剂蒸汽正从缝隙中嘶嘶喷涌，隐约能看见通道内部幽暗曲折的金属走线。',
    '<image>sāfe&1girl, cooling steam</image>',
  ].join('\n');

  it('内联块自己就能提供挂载点（块前最后一个非空行）', () => {
    const 锚点 = 解析插图锚点([], 内联正文, undefined, true);
    expect(锚点).toHaveLength(3);
    for (const 项 of 锚点) {
      expect(项.锚点.length).toBeGreaterThan(5);
      expect(项.锚点).not.toContain('<image>');
      expect(项.锚点索引).toBeGreaterThanOrEqual(0);
    }
  });

  it('展示用正文剥离后，锚点仍能在渲染行里匹配到', () => {
    const 展示 = 剥掉内联插图(内联正文);
    const 行列表 = 展示.split('\n');
    const 锚点 = 解析插图锚点([], 内联正文, undefined, true);
    for (const [i, 项] of 锚点.entries()) {
      const 命中 = 匹配锚点行(行列表, 项.锚点);
      console.log(`[${i}] 锚点="${项.锚点}" → ${命中?.行索引 ?? '未命中'}`);
      expect(命中, `第 ${i} 张插不进去`).not.toBeNull();
    }
  });

  it('两套实现（内联块 / LLM 另给 regex）都能落到同一批行上', () => {
    const 记录 = 解析插图提示词(剥掉思维链(原文), 选项);
    const 从记录 = 解析插图锚点(记录, 剥掉内联插图(内联正文), undefined, true);
    const 从内联 = 解析插图锚点([], 内联正文, undefined, true);
    const 行列表 = 剥掉内联插图(内联正文).split('\n');
    const 行号 = (列表: typeof 从记录) =>
      列表.map((项) => 匹配锚点行(行列表, 项.锚点)?.行索引 ?? -1);
    expect(行号(从记录)).toEqual(行号(从内联));
  });
});
