// @vitest-environment jsdom
/**
 * 拿用户真实预设文件验证导入。
 *
 * 历史：用户最早的 `llm预设.json` 导入报「文件里没有可用的条目」，但在酒馆里能导入。
 * 原因是那是一份**导出信封**：`{ type, version, exportedAt, data: { enabled, messages: [...] } }`，
 * 条目在 `data.messages`，而最初的实现只看顶层的 `entries`。
 * 后来那份文件被用户删除，改留 `llm预设2.json`——它是**预设映射**结构
 * （`{ 预设名: { entries } }`）。两种真实形状都在这里覆盖；文件不在时该组用例跳过
 * （守卫而非报错），合成样例始终运行。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { 归一化导入 } from '@/components/features/Settings/LlmSettingsPanel';

function 读文件(名: string): unknown | null {
  const 路径 = resolve(__dirname, `../../../${名}`);
  if (!existsSync(路径)) return null;
  try {
    return JSON.parse(readFileSync(路径, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

const 映射预设 = 读文件('llm预设2.json');
const 信封预设 = 读文件('llm预设.json');

describe('导入用户真实预设文件', () => {
  it.skipIf(!映射预设)('llm预设2.json：读出所有预设名', () => {
    const 结果 = 归一化导入(映射预设, 'llm预设2.json');
    expect(Object.keys(结果)).toEqual(['new2_comfyui生图变量', 'new2_nai生图变量']);
  });

  it.skipIf(!映射预设)('每个预设的条目数与原始文件一致（不截断）', () => {
    const 原始 = 映射预设 as Record<string, { entries?: unknown[] }>;
    const 结果 = 归一化导入(映射预设, 'llm预设2.json');
    for (const 名称 of Object.keys(结果)) {
      expect(结果[名称].entries.length).toBe((原始[名称].entries ?? []).length);
    }
  });

  it.skipIf(!映射预设)('角色被完整保留（含 assistant 示例输出）', () => {
    const 结果 = 归一化导入(映射预设, 'llm预设2.json');
    const 条目 = 结果['new2_comfyui生图变量'].entries;
    const 角色集合 = new Set(条目.map((项) => 项.role));
    expect(角色集合.has('user')).toBe(true);
    expect(角色集合.has('assistant')).toBe(true);
    for (const 项 of 条目) expect(项.content.trim().length).toBeGreaterThan(0);
  });

  it.skipIf(!信封预设)('llm预设.json：从导出信封的 data.messages 里读出条目', () => {
    const 结果 = 归一化导入(信封预设, 'llm预设.json');
    const 名称列表 = Object.keys(结果);
    expect(名称列表.length).toBeGreaterThan(0);
    expect(结果[名称列表[0]].entries.length).toBeGreaterThan(0);
  });
});

describe('归一化导入：各种社区形状', () => {
  const 一条 = { role: 'system', content: '把正文转成插图提示词' };

  it('导出信封（data.messages）', () => {
    const 结果 = 归一化导入({ type: 'x', version: '1.0', data: { enabled: true, messages: [一条] } }, 'p.json');
    expect(Object.values(结果)[0].entries).toHaveLength(1);
  });

  it('导出信封（data.entries）', () => {
    const 结果 = 归一化导入({ data: { entries: [一条] } }, 'p.json');
    expect(Object.values(结果)[0].entries).toHaveLength(1);
  });

  it('嵌套信封（data.data.messages）', () => {
    const 结果 = 归一化导入({ data: { data: { messages: [一条] } } }, 'p.json');
    expect(Object.values(结果)[0].entries).toHaveLength(1);
  });

  it('单个预设对象用 messages 键', () => {
    const 结果 = 归一化导入({ name: '我的预设', messages: [一条] });
    expect(Object.keys(结果)).toEqual(['我的预设']);
  });

  it('预设表里每个值用 messages 键', () => {
    const 结果 = 归一化导入({ 甲: { messages: [一条] }, 乙: { messages: [一条] } });
    expect(Object.keys(结果).sort()).toEqual(['乙', '甲']);
  });

  it('预设表里再嵌信封', () => {
    const 结果 = 归一化导入({ 甲: { data: { messages: [一条] } } });
    expect(Object.keys(结果)).toEqual(['甲']);
    expect(结果.甲.entries).toHaveLength(1);
  });

  it('信封里没有条目时继续往下找，不误判为空', () => {
    const 结果 = 归一化导入({ data: { 无关: 1 }, entries: [一条] });
    expect(Object.values(结果)[0].entries).toHaveLength(1);
  });

  it('信封无限套娃会停下，不挂死', () => {
    let 深: unknown = { messages: [一条] };
    for (let i = 0; i < 8; i += 1) 深 = { data: 深 };
    expect(() => 归一化导入(深, 'p.json')).not.toThrow();
  });
});
