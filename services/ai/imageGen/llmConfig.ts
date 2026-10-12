/**
 * 文生图 / 角色 AI 的接口解析。
 *
 * 派生自 st-chatu8（智绘姬）的「LLM 预设」取值段（`llm_profiles` + 请求体拼装，
 * 见 `chatu8-llm-spec.md`）；本仓库改成「覆盖字段 + 主 API」的字段级合并，
 * 并把结果收敛成应用自己的 `API配置项`，这样调用方只要拿到一个配置就能发请求。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-16；
 *   修改目的：① 上游把接口配置塞在 `llm_profiles` 里并依赖酒馆的服务端代理，
 *   这里统一走设置里的覆盖字段（`resolveApiOverrideFields`）；
 *   ② 角色 AI 的接口优先级写死为「角色 AI 覆盖 → 文生图 LLM 预设 → 主 API」，
 *   三级都在这里，界面上的提示与实际行为才能一致；
 *   ③ 主 API 只经 `services/apiConfig.ts` 的出口读取（该文件是全仓唯一允许直读
 *   `apiSettings.configs` 的地方）。
 *
 * 与 `resolveApiConfig(apiSettings, settings, slot)` 的关系：槽位那一套要求
 * provider/baseUrl/apiKey/model **四项都齐**才返回配置，而文生图链路历史上允许
 * 本地端点不填密钥。这里保留后者的宽松判据，只借用它的主配置读取口。
 */

import type { API配置项, API设置, 游戏设置 } from '@/models/settings';
import { resolveApiOverrideFields, type API覆盖字段 } from '@/models/settings';
import { resolveMainApiConfig } from '@/services/apiConfig';

/** 设备设置里当前生效的主 API；没有就返回 null。 */
export function 取主API(apiSettings: API设置 | null | undefined): API配置项 | null {
  return resolveMainApiConfig(apiSettings);
}

function 组装(
  基础: API配置项 | null,
  解析后: ReturnType<typeof resolveApiOverrideFields>,
  id: string,
  名称: string,
  游戏: 游戏设置,
): API配置项 {
  // 空 provider 表示回退主 API；回退后仍为空时按 OpenAI 兼容处理。
  const provider: API配置项['provider'] = 解析后.provider || 'openai_compatible';
  if (基础?.id === id) return { ...基础, ...解析后, provider };
  return {
    id,
    name: 名称,
    provider,
    baseUrl: 解析后.baseUrl,
    apiKey: 解析后.apiKey,
    model: 解析后.model,
    maxTokens: 解析后.maxTokens,
    temperature: 解析后.temperature,
    retryCount: 解析后.retryCount,
    enableClaudeMode: 游戏.enableClaudeMode,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** 「文生图 → LLM 预设」的接口；未启用或没填全时返回 null。 */
export function 取文生图LLM配置(
  设置: 游戏设置,
  apiSettings: API设置 | null | undefined,
): API配置项 | null {
  const LLM = 设置.文生图系统.LLM;
  if (!LLM.启用) return null;
  const 主配置 = 取主API(apiSettings);
  const 解析后 = resolveApiOverrideFields(
    {
      provider: LLM.API.provider as API覆盖字段['provider'],
      baseUrl: LLM.API.baseUrl,
      apiKey: LLM.API.apiKey,
      model: LLM.API.model,
      temperature: LLM.温度,
      retryCount: LLM.重试次数,
    },
    主配置,
  );
  if (!解析后.baseUrl.trim() || !解析后.model.trim()) return null;
  return 组装(主配置, 解析后, '__image_illustration_converter__', '文生图LLM', 设置);
}

/** 角色 AI 显式填了模型或地址，才算「有覆盖」。 */
export function 有角色AI覆盖(设置: 游戏设置): boolean {
  const API = 设置.文生图系统.角色AI.API;
  return Boolean(API.model.trim() || API.baseUrl.trim());
}

/**
 * 把一组覆盖字段与主 API 合并成一个可直接用于请求的配置。
 *
 * 用途是「测试连接并读取模型列表」：那时**模型还可以是空的**（用户正要选），
 * 所以这里只要求地址能从覆盖或主 API 里取到；密钥同样由 `fetchModels` 自己校验。
 * 返回 null 表示连地址都还没有，界面据此给出「先配主 API」的提示。
 */
export function 建候选配置(
  设置: 游戏设置,
  apiSettings: API设置 | null | undefined,
  覆盖: { provider?: string; baseUrl: string; apiKey: string; model?: string },
  id: string,
  名称: string,
): API配置项 | null {
  const 主配置 = 取主API(apiSettings);
  const 解析后 = resolveApiOverrideFields(
    {
      provider: (覆盖.provider ?? '') as API覆盖字段['provider'],
      baseUrl: 覆盖.baseUrl,
      apiKey: 覆盖.apiKey,
      model: 覆盖.model ?? '',
    },
    主配置,
  );
  if (!解析后.baseUrl.trim()) return null;
  return 组装(主配置, 解析后, id, 名称, 设置);
}

/**
 * 角色 AI（一键生成角色特征）的接口。
 *
 * 三级回退：角色 AI 的显式覆盖 → 文生图 LLM 预设 → 主 API。
 */
export function 取角色AI配置(
  设置: 游戏设置,
  apiSettings: API设置 | null | undefined,
): API配置项 | null {
  const 主配置 = 取主API(apiSettings);
  const 角色AI = 设置.文生图系统.角色AI;
  if (有角色AI覆盖(设置)) {
    const 解析后 = resolveApiOverrideFields(
      {
        provider: 角色AI.API.provider as API覆盖字段['provider'],
        baseUrl: 角色AI.API.baseUrl,
        apiKey: 角色AI.API.apiKey,
        model: 角色AI.API.model,
        temperature: 角色AI.温度,
      },
      主配置,
    );
    if (解析后.baseUrl.trim() && 解析后.model.trim()) {
      return 组装(主配置, 解析后, '__character_ai__', '角色AI', 设置);
    }
  }
  const LLM配置 = 取文生图LLM配置(设置, apiSettings);
  if (LLM配置) return LLM配置;
  if (主配置 && 主配置.baseUrl.trim() && 主配置.model.trim()) {
    return { ...主配置, temperature: 角色AI.温度 };
  }
  return null;
}
