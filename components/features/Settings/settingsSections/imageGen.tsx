import { useCallback } from 'react';
import { Image as ImageIcon } from 'lucide-react';

import { ComfyUISettingsConsole } from '../ComfyUISettingsConsole';
import { 读取Comfy资源列表, 探测Comfy存活 } from '@/services/ai/imageGen/comfyClient';
import { 统计图片缓存, 清空图片缓存 } from '@/services/imageCache';
import { 取角色AI配置 } from '@/services/ai/imageGen/llmConfig';
import { 生成角色特征 } from '@/services/ai/imageGen/characterFeature';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import type { SettingsSectionContext, SettingsSectionDefinition } from './types';

/**
 * 文生图设置面板。
 *
 * 走子系统草稿语义（onGameSettingsChange + onPersistGameSettings），
 * 与手机/新闻等页一致：改内存、不落盘，只有页面上的「保存」写入。
 */
function ImageGenSection({
  gameSettings,
  deviceSettings,
  onGameSettingsChange,
  onPersistGameSettings,
  fetchModels,
}: SettingsSectionContext) {
  // LLM留空时回退主 API；把主配置的名称/模型/地址显示出来，用户才知道留空会发生什么。
  const 主配置 = deviceSettings.apiSettings.configs.find(
    (项) => 项.id === deviceSettings.apiSettings.activeConfigId,
  ) ?? null;

  /**
   * 一键生成角色特征的模型调用。
   *
   * 三级回退的判定在 `取角色AI配置` 里（角色 AI 覆盖 → 文生图 LLM 预设 → 主 API），
   * 这里只负责把请求发出去。故意**不**声明工具：这条链路要的是纯文本的 <人物> 区块，
   * 走 toolcall 反而会把内容塞进函数参数里。
   */
  const 请求生成角色特征 = useCallback(
    async ({
      系统,
      要求,
      角色,
      signal,
    }: {
      系统: import('@/models/genSystem').文生图系统设置;
      要求: string;
      角色?: import('@/models/genSystem').角色卡;
      signal?: AbortSignal;
    }) => {
      const 配置 = 取角色AI配置(gameSettings, deviceSettings.apiSettings);
      if (!配置) {
        throw new Error(
          '没有可用的模型接口。请先在「设置 → API」配置主 API，'
          + '或在「文生图 → LLM 预设」里启用并填写接口，或在本页填「接口覆盖」。',
        );
      }
      return 生成角色特征(
        {
          请求: async (消息, innerSignal) => chatCompletionNonStream(配置, {
            messages: 消息.map((项) => ({ role: 项.role, content: 项.content })),
            temperature: 系统.角色AI.温度,
            maxTokens: 系统.角色AI.最大输出,
            signal: innerSignal ?? signal,
          }),
        },
        { 要求, 角色, 提示词: 系统.角色AI.提示词 },
        signal,
      );
    },
    [deviceSettings.apiSettings, gameSettings],
  );

  return (
    <ComfyUISettingsConsole
      settings={gameSettings}
      onChange={onGameSettingsChange}
      onPersistSettings={onPersistGameSettings}
      主API名={主配置?.name}
      主API模型={主配置?.model}
      主API地址={主配置?.baseUrl}
      apiSettings={deviceSettings.apiSettings}
      onFetchModels={fetchModels}
      生成角色特征={请求生成角色特征}
      onTestConnection={async (地址: string) => {
        const 基址 = 地址.trim().replace(/\/+$/, '');
        if (!基址) throw new Error('请先填写 ComfyUI 地址。');
        const 可达 = await Promise.race([
          探测Comfy存活(基址),
          new Promise<boolean>((resolve) => globalThis.setTimeout(() => resolve(false), 6000)),
        ]);
        if (!可达) {
          throw new Error('无法连接。请确认 ComfyUI 已启动，且允许跨域（浏览器直连不发鉴权头）。');
        }
        // 顺带确认占位符替换链路要用的资源列表端点可用。
        await 读取Comfy资源列表(基址);
        return `连接成功：${基址}`;
      }}
      onFetchResources={(地址: string) => 读取Comfy资源列表(地址).then((结果) => 结果.资源)}
      onCacheStats={统计图片缓存}
      onClearCache={清空图片缓存}
    />
  );
}

export const imageGenSection: SettingsSectionDefinition = {
  key: 'imageGen',
  label: '文生图',
  icon: '▧',
  navIcon: ImageIcon,
  group: 'subsystems',
  subtitle: 'ComfyUI 工作流与提示词',
  Component: ImageGenSection,
};
