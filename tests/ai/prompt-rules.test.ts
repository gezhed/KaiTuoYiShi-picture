import { describe, expect, it } from 'vitest';
import {
  切分规则行,
  解析正则包装,
  提取条件,
  求值条件,
  安全求值条件,
  应用替换规则,
  应用分角色替换规则,
  剥离中文注释,
  组装正面提示词,
  组装负面提示词,
  插入键列表,
} from '@/services/ai/imageGen/promptRules';

describe('切分规则行', () => {
  it('在第一个等号处切分', () => {
    expect(切分规则行('陈思宇=前置前|<lora:x:0.6>')).toEqual(['陈思宇', '前置前|<lora:x:0.6>']);
    expect(切分规则行('a=b=c')).toEqual(['a', 'b=c']);
  });

  it('忽略空行与没有等号的行', () => {
    expect(切分规则行('')).toBeNull();
    expect(切分规则行('   ')).toBeNull();
    expect(切分规则行('没有等号')).toBeNull();
  });

  it('re(...) 前缀时先跳过配对括号再找等号', () => {
    // 正则内部的等号不能把规则切断。
    expect(切分规则行('re(a=b)=替换|x')).toEqual(['re(a=b)', '替换|x']);
    // 字符组内的右括号不计入深度。
    expect(切分规则行('re([)]) = 替换|y')).toEqual(['re([)])', '替换|y']);
    // 转义字符被跳过。
    expect(切分规则行('re(a\\)b)=替换|z')).toEqual(['re(a\\)b)', '替换|z']);
  });
});

describe('解析正则包装', () => {
  it('识别 re(...) 并取出内容', () => {
    expect(解析正则包装('re(ab+)')).toEqual({ isRe: true, content: 'ab+' });
    expect(解析正则包装('RE( x )')).toEqual({ isRe: true, content: ' x ' });
  });

  it('非 re(...) 原样返回', () => {
    expect(解析正则包装('abc')).toEqual({ isRe: false, content: 'abc' });
    expect(解析正则包装('re(ab')).toEqual({ isRe: false, content: 're(ab' });
  });
});

describe('提取条件', () => {
  it('拆出 @if 条件并保留值', () => {
    expect(提取条件('插入词@if(雨天)')).toEqual({ value: '插入词', condition: '雨天' });
    expect(提取条件('值@if(a && b)')).toEqual({ value: '值', condition: 'a && b' });
  });

  it('没有 @if 或括号不平衡时不拆', () => {
    expect(提取条件('插入词')).toEqual({ value: '插入词', condition: null });
    expect(提取条件('插入词@if()')).toEqual({ value: '插入词@if()', condition: null });
    expect(提取条件('插入词@if(未闭合')).toEqual({ value: '插入词@if(未闭合', condition: null });
  });

  it('@if 必须紧贴尾部括号', () => {
    expect(提取条件('值 @if (条件)').condition).toBe('条件');
    expect(提取条件('值@ifx(条件)').condition).toBeNull();
  });
});

describe('求值条件', () => {
  it('每个原子都是小写子串包含测试', () => {
    expect(求值条件('雨天', '今天是个雨天')).toBe(true);
    expect(求值条件('RAIN', 'rainy day')).toBe(true);
    expect(求值条件('雪天', '今天是个雨天')).toBe(false);
  });

  it('支持 && || ! 与括号优先级', () => {
    expect(求值条件('a && b', 'a b')).toBe(true);
    expect(求值条件('a && b', 'a')).toBe(false);
    expect(求值条件('a || b', 'b')).toBe(true);
    expect(求值条件('!a', 'b')).toBe(true);
    expect(求值条件('!a', 'a')).toBe(false);
    expect(求值条件('a || b && c', 'a')).toBe(true);
    expect(求值条件('(a || b) && c', 'a')).toBe(false);
    expect(求值条件('(a || b) && c', 'a c')).toBe(true);
  });

  it('支持带转义引号的引号原子', () => {
    expect(求值条件('"两 个"', '这里有 两 个 字')).toBe(true);
    expect(求值条件('"a\\"b"', 'x a"b y')).toBe(true);
  });

  it('语法错误抛出，由安全包装吞掉', () => {
    expect(() => 求值条件('(a', 'a')).toThrow();
    expect(() => 求值条件('"未闭合', 'a')).toThrow();
    expect(安全求值条件('(a', 'a')).toBe(false);
    expect(安全求值条件('a', 'a')).toBe(true);
  });
});

describe('应用替换规则', () => {
  it('空规则返回原提示词与全空插入桶', () => {
    const 结果 = 应用替换规则('原词', '');
    expect(结果.modifiedPrompt).toBe('原词');
    for (const 键 of 插入键列表) expect(结果.insertions[键]).toBe('');
  });

  it('替换动作改写提示词本体', () => {
    const 结果 = 应用替换规则('一个女孩站着', '女孩=替换|1girl');
    expect(结果.modifiedPrompt).toBe('一个1girl站着');
  });

  it('替换动作留空值等于删除触发词', () => {
    expect(应用替换规则('一个女孩站着', '女孩=替换|').modifiedPrompt).toBe('一个站着');
  });

  it('五个插入动作各自进入对应桶', () => {
    const 规则 = [
      '甲=前置前|A',
      '甲=前置后|B',
      '甲=后置前|C',
      '甲=后置后|D',
      '甲=最后置|E',
    ].join('\n');
    const 结果 = 应用替换规则('甲', 规则);
    expect(结果.modifiedPrompt).toBe('甲');
    expect(结果.insertions).toEqual({ 前置前: 'A', 前置后: 'B', 后置前: 'C', 后置后: 'D', 最后置: 'E' });
  });

  it('同一桶的多次命中以 ", " 连接', () => {
    const 结果 = 应用替换规则('甲', '甲=前置前|A\n甲=前置前|B');
    expect(结果.insertions.前置前).toBe('A, B');
  });

  it('触发词支持 | 分隔的多个别名', () => {
    const 结果 = 应用替换规则('张雅来了', '陈思宇|张雅|XXX=前置前|<lora:Krea:0.6>');
    expect(结果.insertions.前置前).toBe('<lora:Krea:0.6>');
  });

  it('未知动作被忽略', () => {
    const 结果 = 应用替换规则('甲', '甲=不存在的动作|X');
    expect(结果.modifiedPrompt).toBe('甲');
    expect(结果.insertions.前置前).toBe('');
  });

  it('没有竖线的规则行被忽略', () => {
    expect(应用替换规则('甲', '甲=替换X').modifiedPrompt).toBe('甲');
  });

  it('@if 条件为假时跳过该规则', () => {
    const 规则 = '甲=前置前|雨天词@if(雨天)\n甲=前置前|晴天词@if(晴天)';
    const 结果 = 应用替换规则('甲', 规则, '今天是晴天');
    expect(结果.insertions.前置前).toBe('晴天词');
  });

  it('触发的匹配范围含第二个参数，但替换只作用于提示词本体', () => {
    // 触发词只出现在上下文里：替换动作不应改动提示词。
    const 结果 = 应用替换规则('原提示词', '雨天=替换|晴天', '今天是雨天');
    expect(结果.modifiedPrompt).toBe('原提示词');
  });

  it('正则触发支持捕获组反向引用', () => {
    // 反向引用要求值本身也用 re(...) 包装（与来源一致）。
    const 结果 = 应用替换规则('画面有 abc123', 're(abc(\\d+))=替换|re(num$1)');
    expect(结果.modifiedPrompt).toBe('画面有 num123');
  });

  it('未用 re(...) 包装的值不展开反向引用', () => {
    const 结果 = 应用替换规则('画面有 abc123', 're(abc(\\d+))=替换|num$1');
    expect(结果.modifiedPrompt).toBe('画面有 num$1');
  });

  it('非法正则降级为字面量匹配而不抛错', () => {
    const 结果 = 应用替换规则('a[b 出现了', 're(a[b)=替换|X');
    expect(结果.modifiedPrompt).toBe('X 出现了');
  });

  it('替换内容里的 $ 不被当作反向引用解释', () => {
    expect(应用替换规则('甲', '甲=替换|$&价格').modifiedPrompt).toBe('$&价格');
  });
});

describe('应用分角色替换规则', () => {
  it('只认替换类动作，且返回裸字符串', () => {
    const 结果 = 应用分角色替换规则('女孩', '女孩=替换|1girl\n甲=前置前|X');
    expect(结果).toBe('1girl');
  });

  it('空提示词或空规则原样返回', () => {
    expect(应用分角色替换规则('', '甲=替换|X')).toBe('');
    expect(应用分角色替换规则('甲', '')).toBe('甲');
  });

  it('匹配范围只看提示词自身', () => {
    expect(应用分角色替换规则('原词', '雨天=替换|晴天')).toBe('原词');
  });
});

describe('剥离中文注释', () => {
  it('递归剥掉嵌套圆括号', () => {
    expect(剥离中文注释('1girl（一个女孩（含说明））')).toBe('1girl');
  });

  it('半角括号不受影响', () => {
    expect(剥离中文注释('1girl (solo)')).toBe('1girl (solo)');
  });

  it('空输入返回空串', () => {
    expect(剥离中文注释('')).toBe('');
  });
});

describe('组装正面提示词', () => {
  const 空插入 = { 前置前: '', 前置后: '', 后置前: '', 后置后: '', 最后置: '' };

  it('九段顺序固定，空段被过滤', () => {
    const 结果 = 组装正面提示词('固定', '主体', '结尾', '质量', 空插入);
    expect(结果).toBe('固定, 主体, 结尾, 质量');
  });

  it('插入段落在正确位置', () => {
    const 结果 = 组装正面提示词('固定', '主体', '结尾', '质量', {
      前置前: 'A', 前置后: 'B', 后置前: 'C', 后置后: 'D', 最后置: 'E',
    });
    expect(结果).toBe('A, 固定, B, 主体, C, 结尾, D, 质量, E');
  });

  it('每段都先剥中文注释', () => {
    const 结果 = 组装正面提示词('固定（注）', '主体（注）', '', '', 空插入);
    expect(结果).toBe('固定, 主体');
  });
});

describe('组装负面提示词', () => {
  it('UCP 在前、用户负面在后', () => {
    expect(组装负面提示词('用户负面', 'UCP')).toBe('UCP, 用户负面');
  });

  it('单边为空时直接用另一边', () => {
    expect(组装负面提示词('', 'UCP')).toBe('UCP');
    expect(组装负面提示词('用户负面', '')).toBe('用户负面');
    expect(组装负面提示词('', '')).toBe('');
  });

  it('把 nsfw 提到最前且不重复', () => {
    expect(组装负面提示词('a, nsfw, b', 'NSFW, c')).toBe('nsfw, c, a, b');
  });

  it('先剥中文注释', () => {
    expect(组装负面提示词('用户（注）', 'UCP（注）')).toBe('UCP, 用户');
  });
});
