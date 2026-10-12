import { describe, expect, it } from 'vitest';
import {
  解析词汇替换规则,
  应用词汇替换规则,
  应用出站词汇替换,
  应用入站反向替换,
  解转义序列,
  默认出站词汇替换,
} from '@/services/ai/imageGen/wordReplacement';
import { 默认词汇替换 } from '@/models/genSystem';

describe('解转义序列', () => {
  it('只认 \\s \\t \\n \\\\', () => {
    expect(解转义序列('a\\sb')).toBe('a b');
    expect(解转义序列('a\\tb')).toBe('a\tb');
    expect(解转义序列('a\\nb')).toBe('a\nb');
    expect(解转义序列('a\\\\b')).toBe('a\\b');
    expect(解转义序列('a\\qb')).toBe('a\\qb');
  });
});

describe('解析词汇替换规则', () => {
  it('每行在第一个等号处切分', () => {
    expect(解析词汇替换规则('肉棒=🥒\n小穴=🌸')).toEqual([
      { find: '肉棒', replace: '🥒' },
      { find: '小穴', replace: '🌸' },
    ]);
  });

  it('替换值里的等号保留', () => {
    expect(解析词汇替换规则('a=x=y')).toEqual([{ find: 'a', replace: 'x=y' }]);
  });

  it('忽略空行与无等号行，find 为空则丢弃', () => {
    expect(解析词汇替换规则('\n\n无等号\n=空查找\n有效=值')).toEqual([{ find: '有效', replace: '值' }]);
  });

  it('find 会解转义而替换值保持原样', () => {
    // 替换值不做 trim，只做解转义——空格是有意义的。
    expect(解析词汇替换规则('  多 空格  = x ')).toEqual([{ find: '多 空格', replace: ' x ' }]);
  });

  it('空输入返回空数组', () => {
    expect(解析词汇替换规则('')).toEqual([]);
  });
});

describe('应用词汇替换规则', () => {
  it('默认映射把违禁词换成符号', () => {
    const 规则 = 解析词汇替换规则(默认词汇替换);
    expect(应用词汇替换规则('肉棒和小穴', 规则)).toBe('🥒和🌸');
  });

  it('查找串按字面量处理，正则元字符不生效', () => {
    const 规则 = 解析词汇替换规则('a.b=X');
    expect(应用词汇替换规则('a.b 与 axb', 规则)).toBe('X 与 axb');
  });

  it('全局替换所有出现，大小写敏感', () => {
    const 规则 = 解析词汇替换规则('ab=X');
    expect(应用词汇替换规则('ab ab AB', 规则)).toBe('X X AB');
  });

  it('保留列表顺序造成的子串遮蔽（与来源一致）', () => {
    // 默认表里 `小学` 在 `小学生` 之前，因此 `小学生` 被吃成 `🏬生`。
    const 规则 = 解析词汇替换规则(默认词汇替换);
    expect(应用词汇替换规则('小学生', 规则)).toBe('🏬生');
  });

  it('替换内容里的 $ 不被解释为反向引用', () => {
    const 规则 = 解析词汇替换规则('a=$1');
    expect(应用词汇替换规则('a', 规则)).toBe('$1');
  });

  it('空文本或空规则原样返回', () => {
    expect(应用词汇替换规则('', 解析词汇替换规则('a=b'))).toBe('');
    expect(应用词汇替换规则('a', [])).toBe('a');
  });
});

describe('反向替换', () => {
  it('把符号还原回原词', () => {
    expect(应用入站反向替换('🥒和🌸', 默认词汇替换)).toBe('肉棒和小穴');
  });
});

describe('出站 / 入站映射', () => {
  it('默认映射逐字来自来源：sf_ 与 safe_ 删成空', () => {
    expect(默认出站词汇替换).toBe('sf_=\nsafe_=');
    expect(应用出站词汇替换('sf_danger safe_x')).toBe('danger x');
    // 替换值为空串是「删掉前缀」语义，反向无从还原，原样保留。
    expect(应用入站反向替换('sf_danger safe_x')).toBe('sf_danger safe_x');
  });

  it('反向只有替换值非空的条目才会被还原', () => {
    expect(应用入站反向替换('b', 'a=b')).toBe('a');
    // 空值条目被跳过，不会生成空 find 的坏规则。
    expect(应用入站反向替换('x', 'a=')).toBe('x');
  });
});
