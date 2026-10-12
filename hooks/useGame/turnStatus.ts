export type TurnStatus =
  | { kind: 'idle' }
  | { kind: 'searching'; text: string }
  | { kind: 'generating'; text: string }
  | { kind: 'settling'; text: string }
  | { kind: 'failed'; text: string; failCount: number }
  | { kind: 'stopped'; text: string };

export const TURN_STATUS_IDLE: TurnStatus = { kind: 'idle' };

export function isTurnStatusCancellable(status: TurnStatus): boolean {
  return status.kind === 'searching' || status.kind === 'generating';
}

export function isTurnStatusActive(status: TurnStatus): boolean {
  return status.kind === 'searching' || status.kind === 'generating' || status.kind === 'settling';
}
