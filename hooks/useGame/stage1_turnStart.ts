import { 创建聊天消息 } from '@/models/chat';
import type { 世界状态 } from '@/models/world';
import type { TurnRecoveryContext } from '@/models/turnRecovery';
import { compactPreTurnSnapshot } from '@/utils/saveRuntimeCompactor';
import { compactChatHistoryForLongSession } from '@/utils/longSessionRetention';
import { writeTurnLeaf } from './workflowTransaction';
import { projectRecovery } from './recoveryActions';
import type { TurnContext } from './turnTypes';

export async function stage1_turnStart(
  ctx: TurnContext,
  headNodeId: string | null,
  userInput: string,
  effectiveWorld: 世界状态,
) {
  const { state } = ctx;
  const preTurnSnapshot = compactPreTurnSnapshot({
    旅人: state.旅人,
    世界: effectiveWorld,
    记忆: state.记忆,
    忆庭: state.忆庭,
    智库: state.智库,
    手机: state.手机,
    NPC: state.NPC,
    相册: state.相册,
    新闻: state.新闻,
    剧情: state.剧情,
    剧情编织: state.剧情编织,
    variableBatches: state.variableBatches,
    queueTasks: state.queueTasks,
    turnCount: state.turnCount,
  });

  const userMsg = 创建聊天消息('user', userInput, {
    gameTime: `${state.turnCount}`,
    preTurnSnapshot,
  });

  const purgedHistory = compactChatHistoryForLongSession(state.chatHistory.map((m) =>
    m.role === 'assistant' && m.preTurnSnapshot
      ? { ...m, preTurnSnapshot: undefined }
      : m,
  ));

  const updatedHistory = [...purgedHistory, userMsg];
  const recoveryContext: TurnRecoveryContext = {
    turnAtStart: state.turnCount,
    userInput,
    userMessageId: userMsg.id,
  };

  await writeTurnLeaf(ctx, headNodeId, {
    chatHistory: updatedHistory,
    turnPhase: 'awaitingLanding',
    recoveryContext,
  });

  state.setChatHistory(updatedHistory);
  projectRecovery(state, 'awaitingLanding', recoveryContext);

  return { preTurnSnapshot, userMsg, purgedHistory, recoveryContext, updatedHistory };
}
