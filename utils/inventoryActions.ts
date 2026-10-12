// 调用方不要直接改 traveler.背包，否则会漏掉堆叠合并等副作用。

import type { 角色数据结构 } from '@/models/character';
import type {
  背包物品,
  物品分类,
  物品品质,
  物品来源,
  物品使用效果,
  使用效果目标,
} from '@/models/inventory';
import {
  创建背包物品,
  defaultStackable,
  NARRATIVE_ITEM_CATEGORIES,
} from '@/models/inventory';
import type { VariableExecContext } from './variableExecContext';

export interface 获取物品输入 {
  类别: 物品分类;
  名称: string;
  描述?: string;
  数量?: number;
  品质?: 物品品质;
  可堆叠?: boolean;
  叙事效果?: string[];
  使用效果?: 物品使用效果[];
  价值?: number;
  来源?: 物品来源;
  来源描述?: string;
  获得时间?: string;
}

export interface 获取物品结果 {
  traveler: 角色数据结构;
  item: 背包物品;
  stacked: boolean;
  message: string;
}

export function 获取物品(
  traveler: 角色数据结构,
  input: 获取物品输入,
  options: { 获得回合: number } = { 获得回合: 0 },
  ctx?: VariableExecContext,
): 获取物品结果 {
  const inventory = traveler.背包;
  const requested = Math.max(1, Math.trunc(input.数量 ?? 1));
  const stackable = input.可堆叠 ?? defaultStackable(input.类别);

  if (NARRATIVE_ITEM_CATEGORIES.includes(input.类别) || !stackable) {
    const item = 创建背包物品({
      ...input,
      数量: requested,
      可堆叠: false,
      获得回合: options.获得回合,
    }, ctx);
    return {
      traveler: { ...traveler, 背包: [...inventory, item] },
      item,
      stacked: false,
      message: `获得 ${item.名称}${requested > 1 ? ` ×${requested}` : ''}`,
    };
  }

  const existIdx = inventory.findIndex(
    (it) => it.类别 === input.类别 && it.名称 === input.名称 && it.可堆叠,
  );
  if (existIdx >= 0) {
    const existing = inventory[existIdx];
    const next: 背包物品 = { ...existing, 数量: existing.数量 + requested };
    const nextInventory = [...inventory];
    nextInventory[existIdx] = next;
    return {
      traveler: { ...traveler, 背包: nextInventory },
      item: next,
      stacked: true,
      message: `获得 ${next.名称} ×${requested}(已堆叠至 ${next.数量})`,
    };
  }

  const item = 创建背包物品({
    ...input,
    数量: requested,
    可堆叠: true,
    获得回合: options.获得回合,
  }, ctx);
  return {
    traveler: { ...traveler, 背包: [...inventory, item] },
    item,
    stacked: false,
    message: `获得 ${item.名称}${requested > 1 ? ` ×${requested}` : ''}`,
  };
}

export interface 使用物品结果 {
  traveler: 角色数据结构;
  ok: boolean;
  consumed: boolean;
  effects: { 目标属性: 使用效果目标; 数值: number }[];
  message: string;
}

const USABLE_CATEGORIES: 物品分类[] = ['food', 'consumable'];

export function 使用物品(
  traveler: 角色数据结构,
  itemId: string,
  count = 1,
): 使用物品结果 {
  const inventory = traveler.背包;
  const idx = inventory.findIndex((it) => it.id === itemId);
  if (idx < 0) {
    return { traveler, ok: false, consumed: false, effects: [], message: '背包中未找到该物品' };
  }
  const item = inventory[idx];
  if (!USABLE_CATEGORIES.includes(item.类别)) {
    return { traveler, ok: false, consumed: false, effects: [], message: '此物品不可使用' };
  }
  const useCount = Math.max(1, Math.min(item.数量, Math.trunc(count)));

  const next = { ...traveler };
  const applied: { 目标属性: 使用效果目标; 数值: number }[] = [];
  if (Array.isArray(item.使用效果)) {
    for (const eff of item.使用效果) {
      const delta = eff.数值 * useCount;
      applied.push({ 目标属性: eff.目标属性, 数值: delta });
    }
  }

  const remain = item.数量 - useCount;
  const nextInventory = [...inventory];
  if (remain > 0) {
    nextInventory[idx] = { ...item, 数量: remain };
  } else {
    nextInventory.splice(idx, 1);
  }

  const effectSummary = applied.length
    ? applied.map((e) => `${e.目标属性} ${e.数值 >= 0 ? '+' : ''}${e.数值}`).join('、')
    : '';
  const message = effectSummary
    ? `使用 ${item.名称}${useCount > 1 ? ` ×${useCount}` : ''}(${effectSummary})`
    : `使用 ${item.名称}${useCount > 1 ? ` ×${useCount}` : ''}`;

  return {
    traveler: { ...next, 背包: nextInventory },
    ok: true,
    consumed: true,
    effects: applied,
    message,
  };
}

export interface 丢弃物品结果 {
  traveler: 角色数据结构;
  ok: boolean;
  message: string;
}

export function 丢弃物品(
  traveler: 角色数据结构,
  itemId: string,
  count?: number,
): 丢弃物品结果 {
  const inventory = traveler.背包;
  const idx = inventory.findIndex((it) => it.id === itemId);
  if (idx < 0) return { traveler, ok: false, message: '背包中未找到该物品' };
  const item = inventory[idx];

  const requested = count === undefined || count === Infinity
    ? item.数量
    : Math.max(1, Math.trunc(count));
  const drop = Math.min(item.数量, requested);
  const remain = item.数量 - drop;

  const nextInventory = [...inventory];
  if (remain > 0) {
    nextInventory[idx] = { ...item, 数量: remain };
  } else {
    nextInventory.splice(idx, 1);
  }

  return {
    traveler: { ...traveler, 背包: nextInventory },
    ok: true,
    message: drop > 1 ? `丢弃 ${item.名称} ×${drop}` : `丢弃 ${item.名称}`,
  };
}
