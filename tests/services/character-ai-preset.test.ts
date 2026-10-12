/**
 * 角色 AI 预设的导入 / 导出。
 *
 * 预设从「内置」改成「空白 + 导入」之后，这条路就是唯一的入口：
 * 少认一种格式、或者解析失败后静默空手而归，用户看到的就是「导入没反应」。
 * 另外这里顺手当**金文件**的守门人：仓库里那份
 * `文生图教程/角色AI预设-人物生成.json` 必须与代码里的内置序列一致
 * （改了常量忘了改文件，就是这个测试红）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { 人物生成预设消息, 创建默认角色AI设置, 归一化角色AI消息列表 } from '@/models/genSystem';
import {
  导出角色AI预设文本,
  从设置导出预设文本,
  解析角色AI预设文本,
  角色AI预设格式,
} from '@/services/ai/imageGen/characterAIPreset';

const 预设文件 = new URL('../../文生图教程/角色AI预设-人物生成.json', import.meta.url);

/** 用 `UPDATE_PRESET_FILE=1 vitest run tests/services/character-ai-preset.test.ts` 重新生成金文件。 */
function 生成金文件(): string {
  return 导出角色AI预设文本({
    名称: '人物生成（破甲 + 格式规格）',
    说明: '来自 SillyTavern 完成预设「人物生成」的角色卡那一组：破甲对话 + <人物>/<服装> 格式规格。'
      + '在「文生图 → 角色管理 → 生成 → 角色 AI 设置」里点「导入预设 JSON」导入。',
    消息: 人物生成预设消息(),
    参数: { 温度: 0.9, 最大输出: 12288, 重试次数: 1 },
  });
}

describe('导出 / 导入往返', () => {
  it('导出的文本能被自己解析回来（含参数与启停状态）', () => {
    const 文本 = 导出角色AI预设文本({
      名称: '我的预设',
      说明: '说明',
      消息: 人物生成预设消息(),
      参数: { 附加要求: '只写 SFW', 温度: 0.5, 最大输出: 4096, 重试次数: 2 },
    });
    const { 预设, 错误 } = 解析角色AI预设文本(文本);
    expect(错误).toBeUndefined();
    expect(预设?.名称).toBe('我的预设');
    expect(预设?.消息).toEqual(人物生成预设消息());
    expect(预设?.参数).toEqual({ 附加要求: '只写 SFW', 温度: 0.5, 最大输出: 4096, 重试次数: 2 });
  });

  it('从设置导出：带上当前四个参数（导出即备份）', () => {
    const 设置 = { ...创建默认角色AI设置(), 消息: 人物生成预设消息(), 温度: 1.1, 最大输出: 2048, 重试次数: 3, 附加要求: '偏好中文括号' };
    const { 预设 } = 解析角色AI预设文本(从设置导出预设文本(设置, '备份'));
    expect(预设?.参数).toEqual({ 附加要求: '偏好中文括号', 温度: 1.1, 最大输出: 2048, 重试次数: 3 });
    expect(预设?.消息).toHaveLength(人物生成预设消息().length);
  });
});

describe('导入的宽容度（少认一种用户就以为没反应）', () => {
  const 裸消息 = [{ role: 'system', content: '你是助手' }, { role: 'user', content: '画个女孩', enabled: false }];

  it('信封形态：本应用的 _format 信封', () => {
    const { 预设 } = 解析角色AI预设文本(JSON.stringify({
      _format: 角色AI预设格式, _version: '1.0', 角色AI: { 消息: 裸消息 },
    }));
    expect(预设?.消息).toHaveLength(2);
    expect(预设?.消息[1].enabled).toBe(false);
  });

  it('通用导出信封：消息嵌在 data 里', () => {
    const { 预设 } = 解析角色AI预设文本(JSON.stringify({ data: { messages: 裸消息 } }));
    expect(预设?.消息.map((项) => 项.content)).toEqual(['你是助手', '画个女孩']);
  });

  it('裸数组 / 单条消息对象 / 其它常见键名', () => {
    expect(解析角色AI预设文本(JSON.stringify(裸消息)).预设?.消息).toHaveLength(2);
    expect(解析角色AI预设文本(JSON.stringify({ role: 'system', content: '单条' })).预设?.消息).toHaveLength(1);
    for (const 键 of ['消息', 'messages', 'entries', 'prompts', 'items']) {
      expect(解析角色AI预设文本(JSON.stringify({ [键]: 裸消息 })).预设?.消息, 键).toHaveLength(2);
    }
  });

  it('未知 role 退回 system，空内容条目丢掉，启停缺省为启用', () => {
    const { 预设 } = 解析角色AI预设文本(JSON.stringify({
      消息: [{ role: '乱写', content: 'A' }, { role: 'user', content: '   ' }, { content: 'B' }],
    }));
    expect(预设?.消息).toHaveLength(2);
    expect(预设?.消息[0].role).toBe('system');
    expect(预设?.消息[1]).toMatchObject({ role: 'system', content: 'B', enabled: true });
  });

  it('参数越界会被夹到合法区间，缺省则留空（保留当前设置）', () => {
    const { 预设 } = 解析角色AI预设文本(JSON.stringify({
      消息: 裸消息, 温度: 9, 最大输出: 10, 重试次数: 99,
    }));
    expect(预设?.参数).toEqual({ 温度: 2, 最大输出: 256, 重试次数: 5 });
    const 空 = 解析角色AI预设文本(JSON.stringify({ 消息: 裸消息 }));
    expect(空.预设?.参数).toBeUndefined();
  });

  it('给不出消息时说清原因，而不是静默空手而归', () => {
    expect(解析角色AI预设文本('').错误).toContain('空的');
    expect(解析角色AI预设文本('{不是 json').错误).toContain('JSON');
    expect(解析角色AI预设文本('{"foo":"bar"}').错误).toContain('没有可用的提示词消息');
    expect(解析角色AI预设文本('{"消息":[]}').错误).toContain('没有可用的提示词消息');
  });
});

describe('归一化角色AI消息列表', () => {
  it('不是数组时返回空', () => {
    expect(归一化角色AI消息列表(undefined)).toEqual([]);
    expect(归一化角色AI消息列表({ role: 'system', content: 'x' })).toEqual([]);
  });
});

describe('仓库里的预设文件（金文件）', () => {
  it('与内置序列一致；缺失时可用 UPDATE_PRESET_FILE=1 生成', () => {
    const 期望 = 生成金文件();
    if (process.env.UPDATE_PRESET_FILE === '1' || !existsSync(预设文件)) {
      writeFileSync(预设文件, 期望, 'utf8');
    }
    const 实际 = readFileSync(预设文件, 'utf8');
    expect(实际).toBe(期望);
  });

  it('文件能被导入器解析出 8 条消息，破甲与规格都在', () => {
    const { 预设 } = 解析角色AI预设文本(readFileSync(预设文件, 'utf8'));
    expect(预设?.消息).toHaveLength(8);
    const 文本 = 预设?.消息.map((项) => 项.content).join('\n') ?? '';
    expect(文本).toContain('小克:头好疼，我是谁？');
    expect(文本).toContain('<人物>');
    expect(文本).toContain('<服装>');
    expect(文本).not.toContain('{{roll');
  });
});
