
import { 是已落地命令结果, type 变量命令, type 变量命令批次 } from '@/models/variableCommand';
import type { VariableState } from '@/utils/variableRegistry';
import { stableHashHex } from '@/utils/stableHash';

export function variableStateFingerprint(state: VariableState): Promise<string> {
  return stableHashHex(state);
}

export function commandFingerprint(command: 变量命令): Promise<string> {
  return stableHashHex({
    action: command.action,
    key: command.key.trim(),
    value: command.value,
  });
}

export function listAppliedCommandFingerprints(batches: readonly 变量命令批次[]): Set<string> {
  const applied = new Set<string>();
  for (const batch of batches) {
    for (const result of batch.results) {
      if (!result.commandFingerprint || !是已落地命令结果(result)) continue;
      applied.add(result.commandFingerprint);
    }
  }
  return applied;
}

export function listAppliedFingerprintsForTurn(
  batches: readonly 变量命令批次[],
  turn: number,
  targetMessageId: string,
): Set<string> {
  return listAppliedCommandFingerprints(
    batches.filter((batch) => batch.turn === turn && batch.targetMessageId === targetMessageId),
  );
}

export async function filterCommandsByAppliedFingerprints(
  commands: readonly 变量命令[],
  applied: ReadonlySet<string>,
): Promise<Array<{ command: 变量命令; fingerprint: string }>> {
  const fingerprinted = await Promise.all(commands.map(async (command) => ({
    command,
    fingerprint: await commandFingerprint(command),
  })));
  return fingerprinted.filter((item) => !applied.has(item.fingerprint));
}
