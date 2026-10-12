/**
 * ComfyUI 工作流与生成结果的共享类型。
 *
 * 派生自 st-chatu8（智绘姬）对 API 格式工作流的隐式用法（index.js L45391-L45500、
 * L46968-L46993、L47405-L47420）。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-14；
 *   修改目的：原实现把工作流当作 `any` 直接 JSON.parse，这里补上最小结构类型。
 *   来源不支持 UI 格式工作流（`{nodes:[…],links:[…]}`），也没有 UI→API 转换器
 *   （L45914 / L46848 / L96991 三处都是拒绝导入并提示用户改用 Save (API Format)）。
 */

import type { 生图渠道 } from '@/models/genSystem';

export interface Comfy节点 {
  class_type?: string;
  inputs?: Record<string, unknown>;
  _meta?: { title?: string };
  /** 用户在可视化编辑器里标记的跳过；提交前由跳节点重映射处理。 */
  _skip?: boolean;
  [键: string]: unknown;
}

export type ComfyUI工作流 = Record<string, Comfy节点>;

/** UI 格式（含 nodes/links 数组）的工作流，来源明确拒绝。 */
export function 是ComfyUI界面格式(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const 记录 = value as { nodes?: unknown; links?: unknown };
  return Array.isArray(记录.nodes) && Array.isArray(记录.links);
}

/** API 格式：顶层是 `节点id -> {class_type, inputs}` 的映射。 */
export function 是ComfyUI接口格式(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const 节点列表 = Object.values(value as Record<string, unknown>).filter((项) => 项 && typeof 项 === 'object');
  return 节点列表.length > 0 && 节点列表.some((项) => typeof (项 as Comfy节点).class_type === 'string');
}

export interface 生成请求 {
  正向提示词: string;
  负向提示词: string;
  /** 指定尺寸时覆盖全局设置。 */
  宽度?: number;
  高度?: number;
  种子?: number;
  参考图?: { 数据地址: string; 文件名: string } | null;
  标题?: string;
  signal?: AbortSignal;
}

export interface 生成结果 {
  数据地址: string;
  mimeType: string;
  模型: string;
  渠道: 生图渠道;
  宽度: number;
  高度: number;
  种子: number;
}
