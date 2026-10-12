/**
 * 角色位置：网格与数值坐标的互转，以及按坐标排序。
 *
 * 派生自 st-chatu8（智绘姬）index.js 的 `centersToCoordinates` L9082-L9120
 * 与 `getSortedCharacterIds` L9039-L9046。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-15；
 *   修改目的：① 上游**没有坐标编辑器**——坐标只能由模型在提示词文本里写
 *   `centers:c3` 再被解析出来（规格书 §1.4 明确记录「There is no coordinate
 *   editor widget」）。本应用补一个：让玩家能直接指定角色的位置，而不必依赖模型
 *   每次都写对网格标记。② 上游的解析只产生坐标、不保留「用户填的是哪个格子」，
 *   因此回不到网格 UI；这里的 `角色位置` 同时存 `grid` 与数值，双向都可用。
 */

import type { 角色位置 } from '@/models/genSystem';

/** 5×5 网格的列与行取值，均为 0.1 / 0.3 / 0.5 / 0.7 / 0.9（上游 L9098-L9119）。 */
export const 网格列 = ['a', 'b', 'c', 'd', 'e'] as const;
export const 网格行 = ['1', '2', '3', '4', '5'] as const;
export const 网格值 = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

export type 网格字母 = typeof 网格列[number];

/** 网格标记（如 `c3`）→ 数值坐标。非法输入返回 null。 */
export function 网格转坐标(标记: string): { x: number; y: number; grid: string } | null {
  const 匹配 = (标记 ?? '').trim().toLowerCase().match(/^([a-e])([1-5])$/);
  if (!匹配) return null;
  const 列序号 = 网格列.indexOf(匹配[1] as 网格字母);
  const 行序号 = 网格行.indexOf(匹配[2] as typeof 网格行[number]);
  if (列序号 < 0 || 行序号 < 0) return null;
  return {
    x: 网格值[列序号],
    y: 网格值[行序号],
    grid: `${匹配[1]}${匹配[2]}`,
  };
}

/**
 * 数值坐标 → 最接近的网格标记。
 *
 * 只有落在网格点上才返回标记；否则返回 null，因为这时的位置**不是**网格
 * 能表达的，硬凑成最近的格子会悄悄改掉用户填的坐标。
 */
export function 坐标转网格(x: number, y: number): string | null {
  const 列序号 = 网格值.findIndex((值) => Math.abs(值 - x) < 1e-6);
  const 行序号 = 网格值.findIndex((值) => Math.abs(值 - y) < 1e-6);
  if (列序号 < 0 || 行序号 < 0) return null;
  return `${网格列[列序号]}${网格行[行序号]}`;
}

/** 夹到 [0,1] 并保留 3 位小数，与上游 `centersToCoordinates` 的取舍一致。 */
export function 规范化坐标(值: number): number {
  if (!Number.isFinite(值)) return 0.5;
  return Number(Math.min(1, Math.max(0, 值)).toFixed(3));
}

export function 建网格位置(标记: string): 角色位置 | null {
  const 坐标 = 网格转坐标(标记);
  if (!坐标) return null;
  return { mode: 'grid', x: 坐标.x, y: 坐标.y, grid: 坐标.grid };
}

export function 建数值位置(x: number, y: number): 角色位置 {
  const 规整X = 规范化坐标(x);
  const 规整Y = 规范化坐标(y);
  const 网格 = 坐标转网格(规整X, 规整Y);
  return 网格
    ? { mode: 'grid', x: 规整X, y: 规整Y, grid: 网格 }
    : { mode: 'center', x: 规整X, y: 规整Y };
}

/** 位置是否为「未设置」。 */
export function 位置为空(位置: 角色位置 | null | undefined): boolean {
  return !位置;
}

/** 位置的中文描述，供界面与日志使用。 */
export function 描述位置(位置: 角色位置 | null | undefined): string {
  if (!位置) return '未指定（交给模型决定）';
  if (位置.mode === 'grid' && 位置.grid) {
    return 网格描述(位置.grid) ?? `数值 (${位置.x}, ${位置.y})`;
  }
  return `数值 (${位置.x}, ${位置.y})`;
}

/** 网格标记的可读描述；未知标记返回 null。 */
export function 网格描述(标记: string): string | null {
  const 坐标 = 网格转坐标(标记);
  if (!坐标) return null;
  const 列序号 = 网格列.indexOf(坐标.grid[0] as 网格字母);
  const 行序号 = 网格行.indexOf(坐标.grid[1] as typeof 网格行[number]);
  const 横向 = ['最左', '偏左', '中间', '偏右', '最右'][列序号];
  const 纵向 = ['最上', '偏上', '居中', '偏下', '最下'][行序号];
  return `${横向}·${纵向}（${坐标.grid}）`;
}

/**
 * 按位置排序角色序号，供 `getSortedCharacterIds` 的同类用途。
 *
 * 上游 `getSortedCharacterIds` 只按数字 id 升序；这里额外支持「按位置从左到右」，
 * 用于需要稳定出图顺序的场合（位置固定时同一角色落在同一区域）。
 */
export function 按位置排序序号(
  条目列表: Array<{ 序号: number; 位置: 角色位置 | null | undefined }>,
): number[] {
  return [...条目列表]
    .sort((甲, 乙) => {
      const 甲空 = 位置为空(甲.位置);
      const 乙空 = 位置为空(乙.位置);
      // 未指定位置的一律排在后，保持 id 升序。
      if (甲空 !== 乙空) return 甲空 ? 1 : -1;
      if (甲空 && 乙空) return 甲.序号 - 乙.序号;
      const 甲X = 甲.位置?.x ?? 0;
      const 乙X = 乙.位置?.x ?? 0;
      if (Math.abs(甲X - 乙X) > 1e-6) return 甲X - 乙X;
      return 甲.序号 - 乙.序号;
    })
    .map((项) => 项.序号);
}
