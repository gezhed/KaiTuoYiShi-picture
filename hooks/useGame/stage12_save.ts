import type { TurnContext, TurnDeltas } from './turnTypes';
import type { NewestStory记录 } from '@/models/newestStory';
import { commitTurn } from './commitTurn';
import { clearRecoveryProjection } from './recoveryActions';
import { pushQueueTask } from './workflowTaskRuntime';
import { 发布实时事件, 是主机端 } from '@/services/localSave/liveSync';
import { devLog } from '@/utils/devLog';

export async function stage12_save(
  ctx: TurnContext,
  d: TurnDeltas,
  newest: NewestStory记录,
): Promise<Partial<TurnDeltas>> {
  const {
    state,
    assertWorkflowActive,
    turnCountAtStart,
    queueTasksMirror,
  } = ctx;
  devLog('stage', 'stage12_save.enter', { turn: turnCountAtStart });

  pushQueueTask(state, 'autosave', 'pending', { detail: '正在写入本回合自动存档。' }, turnCountAtStart, queueTasksMirror);
  assertWorkflowActive();
  await commitTurn(ctx, d, newest);
  assertWorkflowActive();
  // 回合已封版（变量结算 / 记忆 / 配图都已落定）→ 此时才通知其它端同步，
  // 避免手机拿到“变量还没更新”的半成品。
  if (是主机端()) void 发布实时事件({ kind: 'turn-done', source: 'host' });
  pushQueueTask(state, 'autosave', 'success', { detail: '本回合自动存档完成。' }, turnCountAtStart, queueTasksMirror);
  state.setHasSave(true);
  clearRecoveryProjection(state);

  devLog('stage', 'stage12_save.exit', { turn: turnCountAtStart, outputs: [] });
  return {};
}
