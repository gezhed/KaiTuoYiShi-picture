import type { 回合动作ID } from '@/hooks/useGame/turnActionRuntime';

export interface 回合动作展示 {
  label: string;
  glyph: string;
}

export const 回合动作展示表: Record<回合动作ID, 回合动作展示> = {
  regenerate_snapshot: { label: '重新生成快照', glyph: '▧' },
  reparse_variables: { label: '重新解析变量', glyph: '⟳' },
};
