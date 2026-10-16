import { describe, expect, it } from 'vitest';
import { buildApiProfile, validateApiProfile } from '@/utils/apiProfile';
import { 创建默认游戏设置, type API设置 } from '@/models/settings';

const 合法包 = {
  app: 'KaiTuoYiShi',
  kind: 'api-profile',
  version: 1,
  exportedAt: '2026-08-31T00:00:00.000Z',
  includeApiKeys: false,
  apiSettings: { activeConfigId: null, configs: [] },
  routes: {
    variableApi: { provider: 'openai_compatible', baseUrl: '', apiKey: '', model: '', retryCount: 2 },
    新闻系统: { provider: 'openai_compatible', baseUrl: '', apiKey: '', model: '', retryCount: 2 },
    手机系统: { provider: 'openai_compatible', baseUrl: '', apiKey: '', model: '', retryCount: 2 },
    智库系统: { provider: 'openai_compatible', baseUrl: '', apiKey: '', model: '', retryCount: 2 },
    剧情编织系统: { provider: 'openai_compatible', baseUrl: '', apiKey: '', model: '', retryCount: 2 },
    记忆总结API: { provider: '', baseUrl: '', apiKey: '', model: '', retryCount: 2 },
    忆庭召回API: { provider: 'openai_compatible', baseUrl: '', apiKey: '', model: '', retryCount: 2 },
    忆庭精炼API: { provider: 'openai_compatible', baseUrl: '', apiKey: '', model: '', retryCount: 2 },
    文生图词组转化器API: { provider: '', baseUrl: '', apiKey: '', model: '' },
  },
};

describe('API 配置包导入校验', () => {
  it('合法包原样通过', () => {
    expect(validateApiProfile(合法包)).toStrictEqual(合法包);
  });

  it('保留主配置的高级采样字段', () => {
    const profile = {
      ...合法包,
      apiSettings: {
        activeConfigId: 'config-1',
        configs: [{
          id: 'config-1', name: '主配置', provider: 'openai', baseUrl: '', apiKey: '', model: 'gpt',
          maxTokens: 32000, temperature: 0.7, topP: 0.9, topK: 40, topA: 0.1, minP: 0.05,
          repetitionPenalty: 1.1, frequencyPenalty: 0.2, presencePenalty: 0.3, maxContext: 64000,
          retryCount: 3, enableClaudeMode: true, createdAt: 1, updatedAt: 2,
        }],
      },
    };
    expect(validateApiProfile(profile)).toStrictEqual(profile);
  });

  it('允许旧包省略可选覆盖字段', () => {
    const legacy = structuredClone(合法包);
    for (const route of [
      legacy.routes.variableApi,
      legacy.routes.新闻系统,
      legacy.routes.手机系统,
      legacy.routes.智库系统,
      legacy.routes.剧情编织系统,
      legacy.routes.记忆总结API,
      legacy.routes.忆庭召回API,
      legacy.routes.忆庭精炼API,
      legacy.routes.文生图词组转化器API,
    ]) {
      delete (route as Record<string, unknown>).retryCount;
      delete (route as Record<string, unknown>).maxTokens;
      delete (route as Record<string, unknown>).temperature;
    }
    const parsed = validateApiProfile(legacy);
    expect(parsed.routes.variableApi.retryCount).toBeUndefined();
    expect(parsed.routes['记忆总结API'].retryCount).toBe(2);
    expect(parsed.routes['文生图词组转化器API']).toStrictEqual(legacy.routes['文生图词组转化器API']);
  });

  it('应用标识或包类型不对时报「不是有效的配置包」', () => {
    expect(() => validateApiProfile({ ...合法包, app: '别的游戏' }))
      .toThrow('不是有效的开拓轶事 API 配置包。');
    expect(() => validateApiProfile({ ...合法包, kind: 'save' }))
      .toThrow('不是有效的开拓轶事 API 配置包。');
    expect(() => validateApiProfile('不是对象')).toThrow('不是有效的开拓轶事 API 配置包。');
  });

  it('版本不对时报版本不兼容', () => {
    expect(() => validateApiProfile({ ...合法包, version: 2 }))
      .toThrow('API 配置包版本不兼容，请更新客户端后再导入。');
  });

  it('缺必要结构时报缺少必要配置', () => {
    expect(() => validateApiProfile({ ...合法包, apiSettings: {} }))
      .toThrow('API 配置包缺少必要配置。');
    expect(() => validateApiProfile({ ...合法包, routes: undefined }))
      .toThrow('API 配置包缺少必要配置。');
  });

  it('深层配置形状错误时拒绝导入', () => {
    expect(() => validateApiProfile({ ...合法包, routes: { ...合法包.routes, variableApi: { provider: 'invalid' } } }))
      .toThrow('API 配置包缺少必要配置。');
  });
});

describe('文生图里走文本 LLM 的两个接口都要进配置包', () => {
  const 空API设置: API设置 = { activeConfigId: null, configs: [] };

  const 建游戏设置 = () => {
    const game = 创建默认游戏设置();
    game.文生图系统.LLM.API = { provider: 'deepseek', baseUrl: 'https://llm.test/v1', apiKey: 'sk-llm', model: 'llm-model' };
    game.文生图系统.角色AI.API = { provider: 'gemini', baseUrl: 'https://char.test/v1', apiKey: 'sk-char', model: 'char-model' };
    return game;
  };

  it('导出带上 LLM 预设与角色生成，导入后原样保留', () => {
    const game = 建游戏设置();
    const profile = buildApiProfile(空API设置, game, true);

    expect(profile.routes.文生图词组转化器API).toEqual(game.文生图系统.LLM.API);
    expect(profile.routes.文生图角色生成API).toEqual(game.文生图系统.角色AI.API);
    expect(validateApiProfile(profile).routes.文生图角色生成API).toEqual(game.文生图系统.角色AI.API);
  });

  it('安全包（不含 Key）会把角色生成的 Key 一起清空', () => {
    const profile = buildApiProfile(空API设置, 建游戏设置(), false);

    expect(profile.routes.文生图词组转化器API.apiKey).toBe('');
    expect(profile.routes.文生图角色生成API?.apiKey).toBe('');
    // 其余字段要留着，否则导入方不知道该填哪个地址。
    expect(profile.routes.文生图角色生成API?.baseUrl).toBe('https://char.test/v1');
    expect(profile.routes.文生图角色生成API?.model).toBe('char-model');
  });

  it('没有这一项的旧包仍然能导入', () => {
    const 旧包 = structuredClone(合法包);
    expect(旧包.routes).not.toHaveProperty('文生图角色生成API');
    expect(validateApiProfile(旧包).routes.文生图角色生成API).toBeUndefined();
  });
});
