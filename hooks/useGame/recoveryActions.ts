import type { UseGameStateReturn } from '@/hooks/useGameState';
import { resetEphemeralFields } from '@/models/leafLifecycle';
import type { TurnPhase, TurnRecoveryContext } from '@/models/turnRecovery';
import { loadActiveLeaf, writeLeafNode } from '@/services/storage/saveTree';
import { devLog, devLogError } from '@/utils/devLog';

export interface AbandonTurnRecoveryResult {
  ok: boolean;
  text: string | null;
}

/** 恢复态投影的唯一写入点：turnPhase 与 recovery 必须成对写，否则两者会不一致。 */
export function projectRecovery(
  state: UseGameStateReturn,
  phase: TurnPhase | null,
  recovery: TurnRecoveryContext | null,
): void {
  state.setTurnPhase(phase);
  state.activeWorkflow.setRecovery(recovery);
}

export function clearRecoveryProjection(state: UseGameStateReturn): void {
  projectRecovery(state, null, null);
}

export async function writeClearedRecovery(headNodeId: string | null): Promise<boolean> {
  if (!headNodeId) return false;
  try {
    await writeLeafNode(headNodeId, resetEphemeralFields({}));
    return true;
  } catch (error) {
    devLogError('recover', 'leaf-recovery-clear-failed', error, { headNodeId });
    return false;
  }
}

export async function abandonTurnRecovery(state: UseGameStateReturn): Promise<AbandonTurnRecoveryResult> {
  const recovery = state.activeWorkflow.recovery;
  const phase = state.turnPhase;
  if (!recovery || !phase) return { ok: true, text: null };

  let ok = true;
  try {
    const active = await loadActiveLeaf();
    if (active.status === 'ok' && active.newest.headNodeId) {
      const stripPendingUserMessage = phase === 'awaitingLanding';
      const chatHistory = stripPendingUserMessage
        ? active.leaf.chatHistory.filter((message) => message.id !== recovery.userMessageId)
        : active.leaf.chatHistory;
      await writeLeafNode(active.newest.headNodeId, resetEphemeralFields({
        chatHistory,
      }));
      state.setChatHistory(chatHistory);
      devLog('recover', 'turn-recovery-abandoned', {
        phase,
        headNodeId: active.newest.headNodeId,
        strippedUserMessage: stripPendingUserMessage,
      });
    } else {
      ok = false;
      devLog('recover', 'turn-recovery-abandon-skipped', { phase, reason: active.status });
    }
  } catch (error) {
    ok = false;
    devLogError('recover', 'turn-recovery-abandon-failed', error, { phase });
  } finally {
    clearRecoveryProjection(state);
  }
  return { ok, text: recovery.userInput };
}
