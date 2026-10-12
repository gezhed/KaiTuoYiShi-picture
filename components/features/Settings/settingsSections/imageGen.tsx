import { Image as ImageIcon } from 'lucide-react';

import { ComfyUISettingsConsole } from '../ComfyUISettingsConsole';
import { 读取Comfy资源列表, 探测Comfy存活 } from '@/services/ai/imageGen/comfyClient';
import { 统计图片缓存, 清空图片缓存 } from '@/services/imageCache';
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
}: SettingsSectionContext) {
  // LLM留空时回退主 API；把主配置的名称/模型/地址显示出来，用户才知道留空会发生什么。
  const 主配置 = deviceSettings.apiSettings.configs.find(
    (项) => 项.id === deviceSettings.apiSettings.activeConfigId,
  ) ?? null;

  return (
    <ComfyUISettingsConsole
      settings={gameSettings}
      onChange={onGameSettingsChange}
      onPersistSettings={onPersistGameSettings}
      主API名={主配置?.name}
      主API模型={主配置?.model}
      主API地址={主配置?.baseUrl}
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
