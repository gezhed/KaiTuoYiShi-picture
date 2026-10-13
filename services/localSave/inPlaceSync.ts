/**
 * 就地同步登记处：把「原地载入最新工作区」（应用的 handleContinue）注册成全局可用的动作，
 * 供非 React 的浮层/弹条调用，避免到处用整页 reload。
 */
type 就地同步处理器 = () => void;

let 处理器: 就地同步处理器 | null = null;

export function 注册就地同步(fn: 就地同步处理器 | null): void {
  处理器 = fn;
}

/** 执行一次就地同步；未注册时返回 false（调用方可退化为整页刷新）。 */
export function 就地同步(): boolean {
  if (!处理器) return false;
  try {
    处理器();
    return true;
  } catch {
    return false;
  }
}
