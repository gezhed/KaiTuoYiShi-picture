import type { TurnContext, TurnDeltas } from './turnTypes';
import { compressNpcMemoryLedger } from './memoryUtils';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';
import { attachNpcLedgerUpdateDebug, pushUniqueText } from './npcLedgerWorkflow';

export function stage9_npcLedger(
  ctx: TurnContext,
  d: TurnDeltas,
): Partial<TurnDeltas> {
  const { state, turnCountAtStart } = ctx;
  const variableOverrides = d.variableOverrides;
  if (!d.finalHistory || !d.aiMsg) {
    throw new Error('stage9_npcLedger: stage5 必须写入 finalHistory 与 aiMsg');
  }
  const finalHistory = d.finalHistory;
  const aiMsg = d.aiMsg;

  const npcSource = variableOverrides?.NPC ?? state.NPC;
  const archiveEnrichment = enrichNpcArchives(npcSource, {
    nsfwEnabled: state.deviceSettings.gameSettings.enableNsfw,
    maleNsfwArchiveEnabled: state.deviceSettings.gameSettings.enableMaleNsfwArchive,
    zhiku: state.智库,
  });

  const npcSourceForCompression = archiveEnrichment.records;
  const memorySettings = state.deviceSettings.gameSettings.记忆系统;
  const npcCompressionSummaryTriggered: string[] = [];
  const npcAfterCompression = npcSourceForCompression.map((npc) => {
    const ledgerCompression = compressNpcMemoryLedger({
      npcId: npc.id,
      entries: npc.同行记忆 ?? [],
      summaries: npc.总结记忆 ?? [],
      threshold: memorySettings.NPC记忆压缩阈值,
      prompt: memorySettings.NPC记忆压缩提示词,
      turn: turnCountAtStart,
      source: '变量',
    });
    if (!ledgerCompression.changed) {
      return npc;
    }
    if (ledgerCompression.summaryTriggered) {
      pushUniqueText(npcCompressionSummaryTriggered, npc.姓名);
    }
    return {
      ...npc,
      同行记忆: ledgerCompression.memories,
      总结记忆: ledgerCompression.summaries,
    };
  });
  const npcChanged =
    archiveEnrichment.changed ||
    npcAfterCompression.length !== npcSource.length ||
    npcAfterCompression.some((npc, index) => npc !== npcSource[index]);
  if (npcChanged) {
    state.setNPC(npcAfterCompression);
  }
  const npcLedgerUpdateDebug = variableOverrides?.npcLedgerUpdate || npcCompressionSummaryTriggered.length
    ? {
        updatedNames: variableOverrides?.npcLedgerUpdate?.updatedNames ?? [],
        memoryAppended: variableOverrides?.npcLedgerUpdate?.memoryAppended ?? [],
        ledgerFieldsUpdated: variableOverrides?.npcLedgerUpdate?.ledgerFieldsUpdated ?? [],
        summaryTriggered: [
          ...(variableOverrides?.npcLedgerUpdate?.summaryTriggered ?? []),
          ...npcCompressionSummaryTriggered,
        ].filter((name, index, list) => Boolean(name) && list.indexOf(name) === index),
        warnings: variableOverrides?.npcLedgerUpdate?.warnings ?? [],
      }
    : undefined;
  let updatedFinalHistory = finalHistory;
  if (npcLedgerUpdateDebug) {
    updatedFinalHistory = attachNpcLedgerUpdateDebug(finalHistory, aiMsg.id, npcLedgerUpdateDebug);
  }

  return { npcAfterCompression, finalHistory: updatedFinalHistory };
}
