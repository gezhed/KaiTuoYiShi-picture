import { normalizeTurnRecoveryContext, type TurnPhase, type TurnRecoveryContext } from './turnRecovery';

const EPHEMERAL_LEAF_FIELDS = ['turnPhase', 'recoveryContext'] as const;

/** 迁移期只剥不读的旧瞬态字段：旧叶子行仍可能携带该键，封版时一并剥离，不参与归一化与重置。 */
const LEGACY_EPHEMERAL_FIELDS = ['pendingOpeningTrigger'] as const;

export type EphemeralFieldName = (typeof EPHEMERAL_LEAF_FIELDS)[number];

export interface EphemeralFieldIssue {
  field: EphemeralFieldName;
  reason: string;
  raw: unknown;
}

export interface NormalizedEphemeralFields {
  turnPhase: TurnPhase | null;
  recoveryContext: TurnRecoveryContext | null;
}

export function stripEphemeralFields<T extends object>(payload: T): T {
  const keys = new Set<string>([...EPHEMERAL_LEAF_FIELDS, ...LEGACY_EPHEMERAL_FIELDS]);
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!keys.has(key)) cleaned[key] = value;
  }
  return cleaned as T;
}

/** 字段特定的默认值与合法性规则只在这里；非法值返回 issue 并显式置默认值，调用方负责记录并在需要时写回。 */
export function normalizeEphemeralFields(raw: unknown): {
  fields: NormalizedEphemeralFields;
  issues: EphemeralFieldIssue[];
} {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const fields: NormalizedEphemeralFields = { turnPhase: null, recoveryContext: null };
  const issues: EphemeralFieldIssue[] = [];

  const rawPhase = source.turnPhase;
  if (rawPhase !== null && typeof rawPhase !== 'undefined') {
    if (rawPhase === 'awaitingLanding' || rawPhase === 'settling') {
      fields.turnPhase = rawPhase;
    } else {
      issues.push({ field: 'turnPhase', reason: '不是合法的回合相位', raw: rawPhase });
    }
  }

  const context = normalizeTurnRecoveryContext(source.recoveryContext);
  fields.recoveryContext = context.value;
  if (context.issue) {
    issues.push({ field: 'recoveryContext', reason: context.issue, raw: source.recoveryContext });
  }
  // 无相位 = 封版后无状态，恢复上下文必须一并作废。
  if (fields.turnPhase === null) fields.recoveryContext = null;

  return { fields, issues };
}

export const EPHEMERAL_DEFAULTS: NormalizedEphemeralFields = normalizeEphemeralFields({}).fields;

export function resetEphemeralFields<T extends object>(payload: T): T {
  const next = { ...payload } as Record<string, unknown>;
  for (const key of EPHEMERAL_LEAF_FIELDS) {
    next[key] = EPHEMERAL_DEFAULTS[key];
  }
  return next as T;
}
