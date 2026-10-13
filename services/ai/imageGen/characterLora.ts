/**
 * 角色 LoRA 的槽位收集。
 *
 * ComfyUI 侧的接法是**固定槽位**：工作流里串 N 个 `LoraLoader`，各自的
 * `lora_name` 写 `"%lora_name_1%"`、`strength_model`/`strength_clip` 写 `"%lora_weight_1%"`；
 * 应用只负责把「这一张图里出场的角色」的 LoRA 按顺序填进去，没填的槽在提交前
 * 以 `_skip` 摘掉（见 comfyEngine 的 `标记未用LoRA槽`）。
 *
 * 为什么要按「出场」而不是「启用列表」：一次可能启用好几张卡，而这张图里只有其中一个，
 * 把没出场的角色 LoRA 也堆上去只会把画面拉歪。
 */

import type { 角色卡, 角色LoRA条目 } from '@/models/genSystem';
import { LoRA槽位数, 夹LoRA权重 } from '@/models/genSystem';

/** 一个槽位的取值：名称 + 权重。 */
export interface LoRA槽位 {
  名称: string;
  权重: number;
}

/**
 * 角色列表 → 槽位。
 *
 * 顺序 = 传入顺序（调用方按出场顺序给）；同名 LoRA 只保留**第一次**出现的那个
 * （权重按第一次的算），避免同一个 LoRA 被叠两次；超过 `LoRA槽位数` 的部分丢弃。
 */
export function 取LoRA槽位(角色列表: readonly (角色卡 | undefined)[]): LoRA槽位[] {
  const 结果: LoRA槽位[] = [];
  const 已见 = new Set<string>();
  for (const 角色 of 角色列表) {
    for (const 条目 of (角色?.LoRA ?? []) as 角色LoRA条目[]) {
      const 名称 = (条目?.名称 ?? '').trim();
      if (!名称) continue;
      const 键 = 名称.toLowerCase();
      if (已见.has(键)) continue;
      已见.add(键);
      if (结果.length >= LoRA槽位数) return 结果;
      结果.push({ 名称, 权重: 夹LoRA权重(条目?.权重) });
    }
  }
  return 结果;
}

/** 本次有没有被丢弃的 LoRA（用于自检提示：角色配了但槽位不够）。 */
export function 统计LoRA超出数(角色列表: readonly (角色卡 | undefined)[]): number {
  let 总数 = 0;
  const 已见 = new Set<string>();
  for (const 角色 of 角色列表) {
    for (const 条目 of (角色?.LoRA ?? []) as 角色LoRA条目[]) {
      const 名称 = (条目?.名称 ?? '').trim();
      if (!名称) continue;
      const 键 = 名称.toLowerCase();
      if (已见.has(键)) continue;
      已见.add(键);
      总数 += 1;
    }
  }
  return Math.max(0, 总数 - LoRA槽位数);
}
