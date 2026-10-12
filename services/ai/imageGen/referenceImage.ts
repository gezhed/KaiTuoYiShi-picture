/**
 * 角色参考图解析。
 *
 * 派生自 st-chatu8（智绘姬）的角色参考组逻辑：
 *   `applyCharacterReferenceGroup` L84002（NovelAI `director_reference_*`）、
 *   `settings.charRefGroups[name] = { references:[{imageId, type, strength, fidelity}] }` L620，
 *   以及 `getRandomYusheId` L9174 的「随机预设」随机化思路。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-15；
 *   修改目的：上游的参考组是独立于角色卡的另一个映射（`charRefGroups`），
 *   并把强度/保真度一组参数一起带上。本应用第一版只做 ComfyUI，
 *   而 ComfyUI 的参考图是**单张上传 + 文件名占位符**，没有强度数组，
 *   因此这里把参考图直接挂在角色卡的媒体上（`角色媒体.用途 === 'reference'`），
 *   并保留「优先参考图、退回照片」的取用顺序。强度数组留到 NovelAI 渠道时再加。
 */

import type { 角色卡, 角色媒体, 文生图系统设置 } from '@/models/genSystem';

export interface 参考图引用 {
  媒体Id: string;
  /** 展示名，用于日志与界面。 */
  名称: string;
}

/**
 * 决定一次生成该用哪张参考图。
 *
 * 优先级：
 * 1. 本次显式指定的媒体 id（玩家在界面上选了某张）；
 * 2. 角色卡上勾选的 `selectedPhotoId`；
 * 3. 第一张用途为 `reference` 的媒体；
 * 4. 第一张非音频媒体（照片兜底）。
 *
 * 明确不取音频：把音频当参考图上传只会让 ComfyUI 报错。
 */
export function 选参考图(角色: 角色卡 | undefined, 显式媒体Id?: string | null): 参考图引用 | null {
  if (!角色) return null;
  const 全部 = [...角色.photoMedia, ...角色.audioMedia].filter((项) => 项.用途 !== 'audio');
  if (全部.length === 0) return null;

  const 按Id = (id: string | null | undefined) => {
    const 裁剪 = (id ?? '').trim();
    if (!裁剪) return null;
    const 命中 = 全部.find((项) => 项.id === 裁剪);
    return 命中 ? { 媒体Id: 命中.id, 名称: 命中.name } : null;
  };

  return 按Id(显式媒体Id)
    ?? 按Id(角色.selectedPhotoId)
    ?? 取第一张(全部.filter((项) => 项.用途 === 'reference'))
    ?? 取第一张(全部);
}

function 取第一张(列表: 角色媒体[]): 参考图引用 | null {
  const 首 = 列表[0];
  return 首 ? { 媒体Id: 首.id, 名称: 首.name } : null;
}

/**
 * 把角色名写进提示词用的参考标记。
 *
 * 只用于界面提示与日志，不改动提示词内容——上游也不这么做：
 * 参考图是靠载荷字段传的，不是靠提示词里的标签。
 */
export function 描述参考图(角色名: string, 参考图: 参考图引用 | null): string {
  if (!参考图) return `${角色名 || '角色'}：未指定参考图`;
  return `${角色名 || '角色'}：使用参考图「${参考图.名称}」`;
}

/** 数据地址 → Blob。参考图上传需要 Blob，而媒体库读出来的是 data URL。 */
export async function 数据地址转Blob(数据地址: string): Promise<Blob> {
  const 响应 = await fetch(数据地址);
  if (!响应.ok) throw new Error(`参考图读取失败：HTTP ${响应.status}`);
  const blob = await 响应.blob();
  if (!blob.size) throw new Error('参考图内容为空。');
  return blob;
}

export interface 参考图预告 {
  /** 开关关着，或没有任何带图的角色。 */
  available: boolean;
  /** 开关关着时为 false，用于区分「没开」与「开了但没图」。 */
  enabled: boolean;
  角色名?: string;
  媒体名?: string;
  说明: string;
}

/**
 * 不读字节、只告诉界面「这次会用谁当参考图」。
 *
 * 与 `解析本次参考图` 共用同一套取用顺序；两边分开是因为界面只需要名字，
 * 每次打开设置都去读一遍图片字节是浪费。
 */
export function 预告参考图(设置: 文生图系统设置): 参考图预告 {
  if (!设置.comfyui.参考图上传) {
    return { available: false, enabled: false, 说明: '参考图上传已关闭（在「总览」页可开启）。' };
  }
  const 候选角色 = [
    ...设置.角色启用列表.map((键) => 设置.角色卡[键]).filter(Boolean),
    ...Object.values(设置.角色卡),
  ];
  for (const 角色 of 候选角色) {
    const 引用 = 选参考图(角色);
    if (!引用) continue;
    return {
      available: true,
      enabled: true,
      角色名: 角色.nameCN || 角色.nameEN,
      媒体名: 引用.名称,
      说明: `本次出图会用「${角色.nameCN || 角色.nameEN}」的「${引用.名称}」作为参考图。`,
    };
  }
  return {
    available: false,
    enabled: true,
    说明: '已开启参考图上传，但还没有任何角色带图片。到「角色管理」给角色上传参考图，并把它标为「参考」用途。',
  };
}
