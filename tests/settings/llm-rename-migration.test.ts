// @vitest-environment jsdom
/**
 * 「转化器」→「LLM」重命名的存档兼容测试。
 *
 * 重命名最容易踩的坑是**旧存档读不回来**：字段名换了，旧数据里的 `转化器`
 * 块会被忽略，于是用户配好的模型与预设被默认值悄悄覆盖——不报错，只是配置没了。
 *
 * 这里锁定两条：
 *   ① 旧键 `转化器` 的内容必须被迁移到新键 `LLM`；
 *   ② API 配置包里的路由键 `文生图词组转化器API` **不能改**，
 *      它已经写进了用户导出/导入的 JSON，改名会让旧配置包认不出来。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { 归一化文生图系统设置 } from '@/models/settings';
import { 创建默认文生图系统设置 } from '@/models/genSystem';
import type { 文生图系统设置 } from '@/models/genSystem';

describe('旧存档迁移：转化器 → LLM', () => {
  it('旧键里的模型与地址被搬到新键', () => {
    const 旧存档 = {
      ...创建默认文生图系统设置(),
      LLM: undefined,
      转化器: {
        ...创建默认文生图系统设置().LLM,
        启用: true,
        API: { provider: 'openai_compatible', baseUrl: 'https://旧地址/v1', apiKey: 'k', model: '旧模型' },
        温度: 0.3,
      },
    } as unknown as Partial<文生图系统设置>;

    const 结果 = 归一化文生图系统设置(旧存档);
    expect(结果.LLM.启用).toBe(true);
    expect(结果.LLM.API.model).toBe('旧模型');
    expect(结果.LLM.API.baseUrl).toBe('https://旧地址/v1');
    expect(结果.LLM.温度).toBe(0.3);
  });

  it('旧键里的预设与条目一并保留', () => {
    const 旧存档 = {
      ...创建默认文生图系统设置(),
      LLM: undefined,
      转化器: {
        ...创建默认文生图系统设置().LLM,
        当前预设: '我的预设',
        预设列表: {
          我的预设: {
            entries: [{
              id: 'e1',
              name: '格式说明',
              role: 'system' as const,
              content: '把正文转成插图提示词',
              enabled: true,
              触发方式: 'always' as const,
              触发词: [],
              与触发: false,
            }],
            createdAt: 0,
            updatedAt: 0,
          },
        },
      },
    } as unknown as Partial<文生图系统设置>;

    const 结果 = 归一化文生图系统设置(旧存档);
    expect(结果.LLM.当前预设).toBe('我的预设');
    expect(结果.LLM.预设列表.我的预设.entries).toHaveLength(1);
    expect(结果.LLM.预设列表.我的预设.entries[0].content).toBe('把正文转成插图提示词');
  });

  it('新键存在时优先用新键，不被旧键覆盖', () => {
    const 设置 = 创建默认文生图系统设置();
    const 混合 = {
      ...设置,
      LLM: { ...设置.LLM, API: { provider: '', baseUrl: '', apiKey: '', model: '新模型' } },
      转化器: { ...设置.LLM, API: { provider: '', baseUrl: '', apiKey: '', model: '旧模型' } },
    } as unknown as Partial<文生图系统设置>;

    expect(归一化文生图系统设置(混合).LLM.API.model).toBe('新模型');
  });

  it('两个键都没有时给默认值，不崩', () => {
    const 设置 = 创建默认文生图系统设置() as Partial<文生图系统设置>;
    delete (设置 as Record<string, unknown>).LLM;
    const 结果 = 归一化文生图系统设置(设置);
    expect(结果.LLM.预设列表).toBeDefined();
    expect(结果.LLM.启用).toBe(false);
  });
});

describe('旧存档迁移：正文配图显示开关', () => {
  it('旧存档没有这两个键时给默认值：显示 + 折叠', () => {
    const 默认 = 创建默认文生图系统设置();
    const 旧存档 = {
      ...默认,
      正文配图: { 启用: true, 模式: 'manual', 每轮上限: 0, 时机: 'queue_background', 插入原文: false },
    } as unknown as Partial<文生图系统设置>;

    const 结果 = 归一化文生图系统设置(旧存档);
    expect(结果.正文配图.默认显示).toBe(true);
    expect(结果.正文配图.默认展开).toBe(false);
    // 旧字段不能被吃掉落。
    expect(结果.正文配图.启用).toBe(true);
    expect(结果.正文配图.模式).toBe('manual');
  });

  it('显式关闭默认显示会被保留（不能被默认值覆盖）', () => {
    const 设置 = 创建默认文生图系统设置();
    const 结果 = 归一化文生图系统设置({
      ...设置,
      正文配图: { ...设置.正文配图, 默认显示: false, 默认展开: true },
    });
    expect(结果.正文配图.默认显示).toBe(false);
    expect(结果.正文配图.默认展开).toBe(true);
  });

  it('只有默认展开为 true 时，默认显示仍为 true', () => {
    const 设置 = 创建默认文生图系统设置();
    const 结果 = 归一化文生图系统设置({
      ...设置,
      正文配图: { ...设置.正文配图, 默认展开: true },
    });
    expect(结果.正文配图.默认显示).toBe(true);
  });
});

describe('API 配置包的路由键必须保持旧名', () => {
  it('源码里仍用字面量 文生图词组转化器API（改名会让旧配置包失效）', () => {
    const 路径 = resolve(__dirname, '../../models/apiProfiles.ts');
    const 源码 = readFileSync(路径, 'utf8');
    expect(源码).toContain('文生图词组转化器API');
  });

  it('该路由指向的已经是新的 LLM 字段', () => {
    const 路径 = resolve(__dirname, '../../models/apiProfiles.ts');
    const 源码 = readFileSync(路径, 'utf8');
    expect(源码).toContain("游戏设置['文生图系统']['LLM']['API']");
  });
});
