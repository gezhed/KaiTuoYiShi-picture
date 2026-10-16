import * as z from 'zod';
import { AI提供商列表 } from '@/models/settings';
import type { AI提供商, API设置, 游戏设置 } from '@/models/settings';

export interface API配置包 {
  app: 'KaiTuoYiShi';
  kind: 'api-profile';
  version: 1;
  exportedAt: string;
  includeApiKeys: boolean;
  enableClaudeMode?: boolean;
  deepSeekMainMode?: 游戏设置['deepSeekMainMode'];
  apiSettings: API设置;
  routes: {
    variableApi: 游戏设置['variableApi'];
    新闻系统: 游戏设置['新闻系统']['api'];
    手机系统: 游戏设置['手机系统']['api'];
    智库系统: 游戏设置['智库系统']['api'];
    剧情编织系统: 游戏设置['剧情编织系统']['api'];
    记忆总结API: 游戏设置['记忆系统']['记忆总结API'];
    忆庭召回API: 游戏设置['记忆系统']['忆庭召回API'];
    忆庭精炼API: 游戏设置['记忆系统']['忆庭精炼API'];
    /**
     * 上联服务端口的地址不在配置包里；这里只带 LLM 预设的覆盖。
     *
     * 键名保持 `文生图词组转化器API` **不要改**：这个字面量会写进用户导出/导入的
     * API 配置包 JSON 里，改名会让已有配置包认不出来。UI 上它已经叫「LLM 预设」。
     */
    文生图词组转化器API: 游戏设置['文生图系统']['LLM']['API'];
    /**
     * 「角色管理 → 生成」用的覆盖（一键生成角色特征）。
     *
     * 与 LLM 预设同样是文生图里的文本接口，所以一起进配置包；**可选**是因为
     * 旧配置包（以及上游导出的包）里没有这一项，缺省时保留本机现值。
     */
    文生图角色生成API?: 游戏设置['文生图系统']['角色AI']['API'];
  };
}

/** 路由只声明 resolveApiOverrideFields 实际消费的覆盖字段；高级采样参数属于主配置。 */
const AI提供商Schema = z.enum(AI提供商列表);
const API覆盖Schema = z.object({
  provider: AI提供商Schema,
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
  maxTokens: z.number().int().optional(),
  temperature: z.number().optional(),
  retryCount: z.number().int().min(0).optional(),
});
const 可空ProviderAPI覆盖Schema = API覆盖Schema.extend({ provider: AI提供商Schema.or(z.literal('')) });
const 忆庭API覆盖Schema = 可空ProviderAPI覆盖Schema.extend({
  retryCount: z.number().int().min(0).optional().default(2),
});

const API配置项Schema = API覆盖Schema.extend({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  topA: z.number().optional(),
  minP: z.number().optional(),
  repetitionPenalty: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
  maxContext: z.number().int().optional(),
  enableClaudeMode: z.boolean().optional(),
});

const API设置Schema = z.object({
  activeConfigId: z.string().nullable(),
  configs: z.array(API配置项Schema),
});

const LLMAPI覆盖Schema = z.object({
  provider: z.string(),
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
});

export const API配置包信封Schema = z.object({
  app: z.literal('KaiTuoYiShi'),
  kind: z.literal('api-profile'),
  version: z.literal(1),
  exportedAt: z.string(),
  includeApiKeys: z.boolean(),
  enableClaudeMode: z.boolean().optional(),
  deepSeekMainMode: z.enum(['off', 'standard', 'lock_format']).optional(),
  apiSettings: API设置Schema,
  routes: z.object({
    variableApi: API覆盖Schema,
    新闻系统: API覆盖Schema,
    手机系统: API覆盖Schema,
    智库系统: API覆盖Schema,
    剧情编织系统: API覆盖Schema,
    记忆总结API: 忆庭API覆盖Schema,
    忆庭召回API: 忆庭API覆盖Schema,
    忆庭精炼API: 忆庭API覆盖Schema,
    文生图词组转化器API: LLMAPI覆盖Schema,
    文生图角色生成API: LLMAPI覆盖Schema.optional(),
  }),
});

export type API配置包信封 = z.infer<typeof API配置包信封Schema>;

export interface API方案槽位 {
  id: string;
  name: string;
  savedAt: number;
  profile: API配置包;
}

export interface 已持久化API方案 {
  apiSettings: API设置;
  gameSettings: 游戏设置;
}

export interface AuxApiProfileState {
  provider: AI提供商;
  baseUrl: string;
  apiKey: string;
  model: string;
}
