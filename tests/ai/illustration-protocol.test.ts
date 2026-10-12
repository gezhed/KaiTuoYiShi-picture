import { describe, expect, it } from 'vitest';
import {
  解析插图提示词,
  转换新XML方言,
  归一化提示词标记,
  取出提示词正文,
  包回提示词标记,
  剥出尺寸,
  二元组相似度,
  最长公共子串相似度,
  词集合相似度,
  行相似度,
  匹配锚点行,
  截断锚点,
  合并锁定插图,
  锚点匹配阈值,
  锚点存储长度,
  默认插图标记,
} from '@/services/ai/imageGen/illustrationProtocol';

describe('归一化提示词标记', () => {
  it('全角标点转半角并规范逗号后空白', () => {
    // 来源只归一 `,` 后的空白，`;` `:` 后的空白不动。
    expect(归一化提示词标记('a，b；c：d')).toBe('a, b;c:d');
    expect(归一化提示词标记('a,   b,c')).toBe('a, b, c');
  });
});

describe('解析插图提示词', () => {
  it('解析 heredoc 方言：一张图一条记录', () => {
    const 回复 = [
      '<images>',
      '<image>',
      'regex:她站在窗前',
      'image### 1girl, window, night ###',
      '</image>',
      '</images>',
    ].join('\n');
    expect(解析插图提示词(回复)).toEqual([
      { regex: '她站在窗前', tag: 'image###1girl, window, night###' },
    ]);
  });

  it('一个正文里多张图各自成为一条记录（这是「一正文多图」的协议基础）', () => {
    const 回复 = [
      '<images>',
      '<image>regex:第一行\nimage### A ###</image>',
      '<image>regex:第二行\nimage### B ###</image>',
      '<image>regex:第三行\nimage### C ###</image>',
      '</images>',
    ].join('\n');
    const 结果 = 解析插图提示词(回复);
    expect(结果).toHaveLength(3);
    expect(结果.map((项) => 项.regex)).toEqual(['第一行', '第二行', '第三行']);
    expect(结果.map((项) => 项.tag)).toEqual(['image###A###', 'image###B###', 'image###C###']);
  });

  it('多个 <images> 容器会被合并', () => {
    const 回复 = '<images><image>regex:a\nimage### A ###</image></images>\n<images><image>regex:b\nimage### B ###</image></images>';
    expect(解析插图提示词(回复)).toHaveLength(2);
  });

  it('锚点可写在 <imgthink> 里', () => {
    const 回复 = '<images><image><imgthink>regex:思考里的锚点</imgthink>\nimage### A ###</image></images>';
    expect(解析插图提示词(回复)[0].regex).toBe('思考里的锚点');
  });

  it('按 (锚点, 提示词) 去重，忽略大小写差异', () => {
    const 回复 = '<images><image>regex:X\nimage### A ###</image><image>regex:x\nimage### a ###</image></images>';
    expect(解析插图提示词(回复)).toHaveLength(1);
  });

  it('没有标记块时返回空数组', () => {
    expect(解析插图提示词('这只是一段普通正文，没有任何插图标记。')).toEqual([]);
  });

  it('标记可配置', () => {
    const 回复 = '<images><image>regex:a\n[[[提示词]]]</image></images>';
    const 结果 = 解析插图提示词(回复, { 开始标记: '[[[', 结束标记: ']]]', 回显思考: false });
    expect(结果[0].tag).toBe('[[[提示词]]]');
  });

  it('回显思考开启时保留锚点之外的全部内容', () => {
    const 回复 = '<images><image>regex:锚点\nimage### A ###</image></images>';
    const 结果 = 解析插图提示词(回复, { ...默认插图标记, 回显思考: true });
    expect(结果[0].tag).toBe('image### A ###');
  });
});

describe('转换新XML方言', () => {
  it('把 <size> 的末段拼进提示词', () => {
    const 输入 = '<images><image><regex>锚点</regex><size>竖版, 960x1280</size><prompts>1girl</prompts></image></images>';
    const 输出 = 转换新XML方言(输入, 默认插图标记);
    expect(输出).toContain('regex:锚点');
    expect(输出).toContain('image###1girl,960x1280###');
  });

  it('把场景与分角色块转成旧方言', () => {
    const 输入 = [
      '<images><image>',
      '<regex>锚点</regex>',
      '<scene_composition>城市夜景</scene_composition>',
      '<character_1><prompt>1girl</prompt><centers>c3</centers><uc>bad</uc></character_1>',
      '</image></images>',
    ].join('');
    const 输出 = 转换新XML方言(输入, 默认插图标记);
    expect(输出).toContain('Scene Composition:城市夜景;');
    expect(输出).toContain('Character 1 Prompt:1girl|centers:c3|Character 1 UC:bad');
  });

  it('解析器在新方言输入上直接可用', () => {
    const 输入 = '<images><image><regex>她抬头</regex><size>1024x1024</size><prompts>1girl, sky</prompts></image></images>';
    const 结果 = 解析插图提示词(输入);
    expect(结果).toHaveLength(1);
    expect(结果[0].regex).toBe('她抬头');
    expect(结果[0].tag).toContain('1024x1024');
  });

  it('没有 <images> 容器时原样返回', () => {
    expect(转换新XML方言('普通文本', 默认插图标记)).toBe('普通文本');
  });
});

describe('提示词正文的取出与包回', () => {
  it('取出与包回互为逆操作（经过归一化）', () => {
    expect(取出提示词正文('image###a, b###')).toBe('a, b');
    expect(包回提示词标记('a，b')).toBe('image###a, b###');
  });

  it('没有标记时取出返回原文', () => {
    expect(取出提示词正文('裸提示词')).toBe('裸提示词');
  });
});

describe('剥出尺寸（LLM 决定每张图分辨率）', () => {
  it('提取 WxH 并从提示词里移除', () => {
    expect(剥出尺寸('1girl, 960x1280')).toEqual({ 提示词: '1girl', 宽度: 960, 高度: 1280 });
    // 后面是空白时只吃掉前置逗号，空白本身保留。
    expect(剥出尺寸('1girl, 960x1280 ; night')).toEqual({ 提示词: '1girl ; night', 宽度: 960, 高度: 1280 });
    expect(剥出尺寸('1girl 960x1280')).toEqual({ 提示词: '1girl', 宽度: 960, 高度: 1280 });
  });

  it('尺寸后面紧跟逗号时不匹配（前瞻是 [;\\s] 或串尾）', () => {
    // 这是来源的既有行为：`960x1280,` 不会被当成尺寸，提示词原样保留。
    expect(剥出尺寸('1girl,960x1280, night')).toEqual({
      提示词: '1girl,960x1280, night',
      宽度: null,
      高度: null,
    });
  });

  it('自主分辨率关闭时只剥不采纳', () => {
    expect(剥出尺寸('1girl, 960x1280', false)).toEqual({ 提示词: '1girl', 宽度: null, 高度: null });
  });

  it('没有尺寸时原样返回', () => {
    expect(剥出尺寸('1girl, solo')).toEqual({ 提示词: '1girl, solo', 宽度: null, 高度: null });
  });

  it('末位限定变体只在结尾匹配', () => {
    expect(剥出尺寸('960x1280, 1girl', true, true).宽度).toBeNull();
    expect(剥出尺寸('1girl, 960x1280', true, true).宽度).toBe(960);
  });

  it('同一正文的两张图可以取到不同分辨率', () => {
    expect(剥出尺寸('A, 960x1280').宽度).toBe(960);
    expect(剥出尺寸('B, 1024x1024').宽度).toBe(1024);
  });
});

describe('相似度函数', () => {
  it('二元组相似度：相同为 1，无交集为 0', () => {
    expect(二元组相似度('abc', 'abc')).toBe(1);
    expect(二元组相似度('abc', 'xyz')).toBe(0);
    expect(二元组相似度('', 'abc')).toBe(0);
  });

  it('最长公共子串相似度是占较短串的比例', () => {
    expect(最长公共子串相似度('abcdef', 'abc')).toBe(1);
    expect(最长公共子串相似度('abc', 'xyz')).toBe(0);
  });

  it('词集合相似度是 Jaccard', () => {
    expect(词集合相似度('a b', 'a b')).toBe(1);
    expect(词集合相似度('a b', 'a c')).toBeCloseTo(1 / 3, 5);
    expect(词集合相似度('a', '')).toBe(0);
  });

  it('行相似度取三者最大', () => {
    expect(行相似度('她站在窗前看雨', '她站在窗前看雨')).toBe(1);
    expect(行相似度('abc', 'xyz')).toBe(0);
  });
});

describe('匹配锚点行', () => {
  const 正文 = ['第一行：她抬起头。', '第二行：窗外的雨还在下。', '第三行：她转身离开。'];

  it('逐字包含时精确命中', () => {
    expect(匹配锚点行(正文, '窗外的雨还在下')?.行索引).toBe(1);
  });

  it('近似但有出入时靠模糊匹配命中', () => {
    // 锚点少了一个标点、措辞略有差异。
    const 命中 = 匹配锚点行(正文, '窗外雨还在下');
    expect(命中?.行索引).toBe(1);
    expect(命中!.相似度).toBeGreaterThanOrEqual(锚点匹配阈值);
  });

  it('完全无关时返回 null', () => {
    expect(匹配锚点行(正文, '完全不相干的另一句话语内容')).toBeNull();
  });

  it('空锚点返回 null', () => {
    expect(匹配锚点行(正文, '   ')).toBeNull();
  });

  it('多个候选时取相似度最高的', () => {
    const 多行 = ['她转身离开。', '她转身离开，没有再回头看一眼。'];
    expect(匹配锚点行(多行, '她转身离开，没有再回头看一眼')?.行索引).toBe(1);
  });
});

describe('锚点截断与锁定合入', () => {
  it('只保留末 40 字符', () => {
    const 长 = '甲'.repeat(60);
    expect(截断锚点(长)).toHaveLength(锚点存储长度);
    expect(截断锚点(长)).toBe(长.slice(-锚点存储长度));
    expect(截断锚点('短锚点')).toBe('短锚点');
  });

  it('锁定项优先合入且不重复', () => {
    const 新 = [{ regex: 'a', tag: 'image###A###' }];
    const 旧 = [
      { regex: 'b', tag: 'image###B###', locked: true },
      { regex: 'a', tag: 'image###A###', locked: true },
    ];
    expect(合并锁定插图(新, 旧)).toEqual([
      { regex: 'b', tag: 'image###B###', locked: true },
      { regex: 'a', tag: 'image###A###' },
    ]);
  });

  it('没有锁定项时原样返回新解析结果', () => {
    const 新 = [{ regex: 'a', tag: 'A' }];
    expect(合并锁定插图(新, [{ regex: 'b', tag: 'B' }])).toBe(新);
  });
});
