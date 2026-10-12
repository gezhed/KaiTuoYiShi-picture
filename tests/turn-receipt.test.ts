import { describe, expect, it } from 'vitest';
import { createTurnReceiptFromMessages } from '@/hooks/useGame/turnReceipt';
import { requireTurnAfterReply } from '@/hooks/useGame/turnTypes';

describe('turn receipt', () => {
  it('produces a frozen receipt carrying the derived batch identity', () => {
    const receipt = createTurnReceiptFromMessages({
      sessionEpoch: 7,
      turn: 3,
      leafId: 'leaf-1',
      userMessage: { id: 'user-1', content: 'go' },
      assistantMessage: { id: 'assistant-1' },
    });

    expect(receipt).toMatchObject({ turn: 3, assistantMessageId: 'assistant-1' });
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it('rejects tail execution before the reply is landed', () => {
    expect(() => requireTurnAfterReply({})).toThrow('回合结算必须先完成回复落地');
  });
});
