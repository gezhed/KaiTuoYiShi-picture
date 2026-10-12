import { describe, expect, it } from 'vitest';
import type { API配置项, API设置 } from '@/models/settings';
import {
  activateApiConfig,
  addApiConfig,
  findApiConfig,
  listApiConfigs,
  removeApiConfig,
  replaceApiConfigs,
  resolveMainApiConfig,
  updateApiConfig,
} from '@/services/apiConfig';

function 建配置(id: string, patch: Partial<API配置项> = {}): API配置项 {
  return {
    id,
    name: id,
    provider: 'openai_compatible',
    baseUrl: 'https://example.test/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

const 原设置: API设置 = {
  activeConfigId: 'b',
  configs: [建配置('a'), 建配置('b'), 建配置('c')],
};

describe('resolveMainApiConfig', () => {
  it('activeConfigId 命中即用', () => {
    expect(resolveMainApiConfig(原设置)?.id).toBe('b');
  });

  it('activeConfigId 悬空时回落首项', () => {
    expect(resolveMainApiConfig({ ...原设置, activeConfigId: '不存在' })?.id).toBe('a');
  });

  it('activeConfigId 为 null 时回落首项', () => {
    expect(resolveMainApiConfig({ ...原设置, activeConfigId: null })?.id).toBe('a');
  });

  it('空表返回 null', () => {
    expect(resolveMainApiConfig({ activeConfigId: null, configs: [] })).toBeNull();
  });

  it('传 null / undefined 返回 null', () => {
    expect(resolveMainApiConfig(null)).toBeNull();
    expect(resolveMainApiConfig(undefined)).toBeNull();
  });
});

describe('listApiConfigs / findApiConfig', () => {
  it('listApiConfigs 返回全部配置', () => {
    expect(listApiConfigs(原设置).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('findApiConfig 按 id 取单条，与 activeConfigId 无关', () => {
    expect(findApiConfig(原设置, 'c')?.id).toBe('c');
    expect(findApiConfig(原设置, 'a')?.id).toBe('a');
  });

  it('findApiConfig 对 null 与未知 id 返回 null', () => {
    expect(findApiConfig(原设置, null)).toBeNull();
    expect(findApiConfig(原设置, '不存在')).toBeNull();
  });
});

describe('removeApiConfig', () => {
  it('删掉活动项时，活动指针改为剩余首项', () => {
    const next = removeApiConfig(原设置, 'b');
    expect(next.activeConfigId).toBe('a');
    expect(next.configs.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('删掉非活动项时，活动指针不动', () => {
    const next = removeApiConfig(原设置, 'a');
    expect(next.activeConfigId).toBe('b');
    expect(next.configs.map((c) => c.id)).toEqual(['b', 'c']);
  });

  it('删到一条不剩时活动指针置空', () => {
    const only: API设置 = { activeConfigId: 'a', configs: [建配置('a')] };
    expect(removeApiConfig(only, 'a')).toEqual({ activeConfigId: null, configs: [] });
  });
});

describe('addApiConfig', () => {
  it('已有活动项时不抢走活动指针', () => {
    const next = addApiConfig(原设置, 建配置('d'));
    expect(next.activeConfigId).toBe('b');
    expect(next.configs.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('原本没有活动项时才激活新项', () => {
    const empty: API设置 = { activeConfigId: null, configs: [建配置('a')] };
    const next = addApiConfig(empty, 建配置('b'));
    expect(next.activeConfigId).toBe('b');
    expect(next.configs.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('空表新增时激活新项', () => {
    const next = addApiConfig({ activeConfigId: null, configs: [] }, 建配置('a'));
    expect(next.activeConfigId).toBe('a');
  });
});

describe('updateApiConfig', () => {
  it('按 id 合并字段并 bump updatedAt', () => {
    const next = updateApiConfig(原设置, 'b', { model: '新模型' });
    const b = findApiConfig(next, 'b');
    expect(b?.model).toBe('新模型');
    expect(b?.updatedAt).toBeGreaterThan(原设置.configs[1].updatedAt);
    expect(findApiConfig(next, 'a')?.model).toBe('test-model');
  });

  it('空 patch 即「保存」按钮的 touch：只 bump 时间戳', () => {
    const next = updateApiConfig(原设置, 'b', {});
    expect(findApiConfig(next, 'b')?.updatedAt).toBeGreaterThan(原设置.configs[1].updatedAt);
    expect(findApiConfig(next, 'b')?.model).toBe('test-model');
  });
});

describe('activateApiConfig', () => {
  it('只动指针，不碰配置内容', () => {
    const next = activateApiConfig(原设置, 'c');
    expect(next.activeConfigId).toBe('c');
    expect(next.configs).toStrictEqual(原设置.configs);
  });
});

describe('replaceApiConfigs', () => {
  it('沿用来源指针并全部 bump updatedAt', () => {
    const 来源: API设置 = { activeConfigId: 'x', configs: [建配置('x'), 建配置('y')] };
    const next = replaceApiConfigs(来源);
    expect(next.activeConfigId).toBe('x');
    expect(next.configs.every((c) => c.updatedAt > 1)).toBe(true);
  });

  it.each([null, '不存在'])('来源活动指针为 %s 时统一指向首项', (activeConfigId) => {
    const next = replaceApiConfigs({ activeConfigId, configs: [建配置('x'), 建配置('y')] });
    expect(next.activeConfigId).toBe('x');
  });

  it('来源配置为空时活动指针统一为 null', () => {
    expect(replaceApiConfigs({ activeConfigId: '不存在', configs: [] }).activeConfigId).toBeNull();
  });
});

describe('编辑函数不修改入参', () => {
  const 快照 = () => structuredClone(原设置);

  it('removeApiConfig 返回新对象且原对象不变', () => {
    const before = 快照();
    const next = removeApiConfig(原设置, 'b');
    expect(next).not.toBe(原设置);
    expect(next.configs).not.toBe(原设置.configs);
    expect(原设置).toStrictEqual(before);
  });

  it('addApiConfig 返回新对象且原对象不变', () => {
    const before = 快照();
    const next = addApiConfig(原设置, 建配置('d'));
    expect(next).not.toBe(原设置);
    expect(原设置).toStrictEqual(before);
  });

  it('updateApiConfig 不原地改写被更新的那条', () => {
    const before = 快照();
    const next = updateApiConfig(原设置, 'b', { model: '新模型' });
    expect(findApiConfig(next, 'b')).not.toBe(原设置.configs[1]);
    expect(原设置).toStrictEqual(before);
  });

  it('activateApiConfig 返回新对象且原对象不变', () => {
    const before = 快照();
    expect(activateApiConfig(原设置, 'c')).not.toBe(原设置);
    expect(原设置).toStrictEqual(before);
  });
});
