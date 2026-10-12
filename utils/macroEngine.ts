
export interface MacroGameState {
  charName?: string;
  userName?: string;
  lastMessage?: string;
  lastUserMessage?: string;
  lastCharMessage?: string;
  messageCount?: number;
  turnCount?: number;
  modelName?: string;
  maxContext?: number;
}

export interface MacroContext {
  local: Record<string, string>;
  global: Record<string, string>;
  gameState?: MacroGameState;
  pickHistory?: Record<string, string[]>;
}

export function createMacroContext(
  initialGlobals?: Record<string, string>,
  gameState?: MacroGameState,
): MacroContext {
  return {
    local: {},
    global: { ...(initialGlobals ?? {}) },
    gameState,
    pickHistory: {},
  };
}

export function buildPromptMacroContext(input: {
  history: Array<{ role: string; content: string }>;
  playerName: string;
  turnCount: number;
  modelName?: string;
  maxContext?: number;
  globals?: Record<string, string>;
}): MacroContext {
  const lastMessage = input.history.at(-1);
  const lastUserMessage = [...input.history].reverse().find((message) => message.role === 'user');
  const lastAssistantMessage = [...input.history].reverse().find((message) => message.role === 'assistant');
  return createMacroContext(input.globals, {
    charName: input.playerName,
    userName: input.playerName,
    lastMessage: lastMessage?.content ?? '',
    lastUserMessage: lastUserMessage?.content ?? '',
    lastCharMessage: lastAssistantMessage?.content ?? '',
    messageCount: input.history.length,
    turnCount: input.turnCount,
    modelName: input.modelName,
    maxContext: input.maxContext,
  });
}

/** 调换处理顺序会改变宏语义；if 块内的 setvar 无论条件真假都会被执行。 */
export function processMacros(text: string, ctx: MacroContext): string {
  let result = text;

  result = processSTMacros(result, ctx);

  result = processRandom(result);

  result = executeAssignments(result, ctx);

  result = processIfBlocks(result, ctx);

  result = processReads(result, ctx);

  return result;
}


function processSTMacros(text: string, ctx: MacroContext): string {
  const gs = ctx.gameState ?? {};
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const datetimeStr = `${dateStr} ${timeStr}`;

  let result = text;

  result = result.replace(/\{\{char\}\}/g, gs.charName ?? '');
  result = result.replace(/\{\{user\}\}/g, gs.userName ?? '');

  result = result.replace(/\{\{lastMessage\}\}/g, gs.lastMessage ?? '');
  result = result.replace(/\{\{lastUserMessage\}\}/g, gs.lastUserMessage ?? '');
  result = result.replace(/\{\{lastCharMessage\}\}/g, gs.lastCharMessage ?? '');

  result = result.replace(/\{\{time\}\}/g, timeStr);
  result = result.replace(/\{\{date\}\}/g, dateStr);
  result = result.replace(/\{\{datetime\}\}/g, datetimeStr);

  result = result.replace(/\{\{model\}\}/g, gs.modelName ?? '');
  result = result.replace(/\{\{messageCount\}\}/g, gs.messageCount !== undefined ? String(gs.messageCount) : '');
  result = result.replace(/\{\{turnCount\}\}/g, gs.turnCount !== undefined ? String(gs.turnCount) : '');
  result = result.replace(/\{\{maxPrompt\}\}/g, gs.maxContext !== undefined ? String(gs.maxContext) : '');

  result = result.replace(/\{\{noop\}\}/g, '');
  result = result.replace(/\{\{newline\}\}/g, '\n');
  result = result.replace(new RegExp('\\{\\{//[^}]*\\}\\}', 'g'), '');
  result = result.replace(/\{\{bias::[^}]*\}\}/g, '');
  result = result.replace(/\{\{trim::([^}]*)\}\}/g, (_m, s: string) => s.trim());
  result = result.replace(/\{\{lower::([^}]*)\}\}/g, (_m, s: string) => s.toLowerCase());
  result = result.replace(/\{\{upper::([^}]*)\}\}/g, (_m, s: string) => s.toUpperCase());

  result = result.replace(/\{\{pick::([^}]*)\}\}/g, (match, options: string) => {
    const trimmed = options.trim();
    if (!trimmed) return '';
    const parts = trimmed.split('::').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    let pickHistory = ctx.pickHistory;
    if (!pickHistory) {
      pickHistory = {};
      Object.assign(ctx, { pickHistory });
    }
    const key = match;
    const used = pickHistory[key] ?? [];
    const remaining = parts.filter((p) => !used.includes(p));
    const candidates = remaining.length > 0 ? remaining : parts;
    const idx = Math.floor(Math.random() * candidates.length);
    const chosen = candidates[idx];
    if (remaining.length > 0) {
      pickHistory[key] = [...used, chosen];
    } else {
      pickHistory[key] = [chosen];
    }
    return chosen;
  });

  result = result.replace(/\{\{pick_var::([^}]+)\}\}/g, (_m, name: string) => {
    const key = name.trim();
    if (!ctx.pickHistory) return '';
    const history = ctx.pickHistory[key] as string[] | undefined;
    if (!history || history.length === 0) return '';
    return history[history.length - 1];
  });

  result = result.replace(/\{\{roll:([^}]+)\}\}/g, (_m, spec: string) => {
    const s = spec.trim();
    const dMatch = s.match(/^(\d*)d(\d+)$/i);
    if (dMatch) {
      const count = dMatch[1] ? parseInt(dMatch[1], 10) : 1;
      const sides = parseInt(dMatch[2], 10);
      if (sides <= 0 || count <= 0) return '0';
      let total = 0;
      for (let i = 0; i < count; i++) {
        total += Math.floor(Math.random() * sides) + 1;
      }
      return String(total);
    }
    const nMatch = s.match(/^(\d+)$/);
    if (nMatch) {
      const n = parseInt(nMatch[1], 10);
      if (n <= 0) return '0';
      return String(Math.floor(Math.random() * n) + 1);
    }
    return _m;
  });

  return result;
}

function processRandom(text: string): string {
  return text.replace(/\{\{random::([^}]*)\}\}/g, (_match, options: string) => {
    const trimmed = options.trim();
    if (!trimmed) return '';
    const parts = trimmed.split('::');
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].trim();
    const idx = Math.floor(Math.random() * parts.length);
    return parts[idx].trim();
  });
}

function processIfBlocks(text: string, ctx: MacroContext): string {
  const IF_PATTERN = /\{\{if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  let result = text;
  let prev: string;
  for (let i = 0; i < 10; i++) {
    prev = result;
    result = result.replace(IF_PATTERN, (_match, condition: string, body: string) => {
      const elseMatch = body.match(/^([\s\S]*?)\{\{else\}\}([\s\S]*)$/);
      const cond = evaluateCondition(condition.trim(), ctx);
      if (elseMatch) {
        return cond ? elseMatch[1] : elseMatch[2];
      }
      return cond ? body : '';
    });
    if (result === prev) break;
  }
  return result;
}

function evaluateCondition(condition: string, ctx: MacroContext): boolean {
  let cond = condition;
// ST 官方 if 条件用不带 {{}} 的裸语法
  cond = cond.replace(/\bgetvar::([a-zA-Z_]\w*)/g, (_m, name: string) => ctx.local[name.trim()] ?? '');
  cond = cond.replace(/\bgetglobalvar::([a-zA-Z_]\w*)/g, (_m, name: string) => ctx.global[name.trim()] ?? '');
  cond = cond.replace(/\{\{getvar::([^}]+)\}\}/g, (_m, name: string) => ctx.local[name.trim()] ?? '');
  cond = cond.replace(/\{\{getglobalvar::([^}]+)\}\}/g, (_m, name: string) => ctx.global[name.trim()] ?? '');
  cond = cond.replace(/\{\{\.([^}]+)\}\}/g, (_m, name: string) => {
    const trimmed = name.trim();
    if (!trimmed.includes('=')) return ctx.local[trimmed] ?? '';
    return _m;
  });
  cond = cond.replace(/\{\{\$([^}]+)\}\}/g, (_m, name: string) => {
    const trimmed = name.trim();
    if (!trimmed.includes('=')) return ctx.global[trimmed] ?? '';
    return _m;
  });

  cond = cond.trim();

  const eqMatch = cond.match(/^(.+?)\s*==\s*(.+)$/);
  if (eqMatch) {
    return eqMatch[1].trim() === eqMatch[2].trim();
  }

  const neqMatch = cond.match(/^(.+?)\s*!=\s*(.+)$/);
  if (neqMatch) {
    return neqMatch[1].trim() !== neqMatch[2].trim();
  }

  return cond.length > 0 && cond !== 'false' && cond !== '0';
}

function executeAssignments(text: string, ctx: MacroContext): string {
  let result = text;
  const local = ctx.local;
  const globals = ctx.global;

  result = result.replace(/\{\{setvar::([^:}]+)::([^}]*)\}\}/g, (_m, name: string, value: string) => {
    local[name.trim()] = value.trim();
    return '';
  });

  result = result.replace(/\{\{setglobalvar::([^:}]+)::([^}]*)\}\}/g, (_m, name: string, value: string) => {
    globals[name.trim()] = value.trim();
    return '';
  });

  result = result.replace(/\{\{\.(\w+)\s*=\s*([^}]+)\}\}/g, (_m, name: string, value: string) => {
    local[name.trim()] = value.trim();
    return '';
  });

  result = result.replace(/\{\{\$(\w+)\s*=\s*([^}]+)\}\}/g, (_m, name: string, value: string) => {
    globals[name.trim()] = value.trim();
    return '';
  });

  return result;
}

function processReads(text: string, ctx: MacroContext): string {
  let result = text;

  result = result.replace(/\{\{getvar::([^}]+)\}\}/g, (_m, name: string) => {
    return ctx.local[name.trim()] ?? '';
  });

  result = result.replace(/\{\{getglobalvar::([^}]+)\}\}/g, (_m, name: string) => {
    return ctx.global[name.trim()] ?? '';
  });

  result = result.replace(/\{\{\.(\w+)\}\}/g, (_m, name: string) => {
    return ctx.local[name.trim()] ?? '';
  });

  result = result.replace(/\{\{\$(\w+)\}\}/g, (_m, name: string) => {
    return ctx.global[name.trim()] ?? '';
  });

  return result;
}
