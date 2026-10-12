import { createContext, useContext, type ReactNode } from 'react';
import type { 叙事插图 } from '@/models/chat';

/** 单张插图的出图操作。`覆盖尺寸` 优先于提示词里写的 `WxH`。 */
export interface 插图重生选项 {
  新提示词正文?: string;
  覆盖尺寸?: { 宽度: number; 高度: number } | null;
}

export interface 插图动作 {
  重生: (messageId: string, 插图: 叙事插图, 选项?: 插图重生选项) => void;
  换提示词: (messageId: string) => void;
}

const 插图动作上下文 = createContext<插图动作 | null>(null);

export function 插图动作提供者({ value, children }: { value: 插图动作 | null; children: ReactNode }) {
  return <插图动作上下文.Provider value={value}>{children}</插图动作上下文.Provider>;
}

export function use插图动作(): 插图动作 | null {
  return useContext(插图动作上下文);
}
