
import type { STPreset, STPresetPrompt, STPresetOrder, STPresetOrderSlot, STPresetEntryV2 } from '@/models/stTypes';


const readText = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : '';

const readBool = (v: unknown): boolean =>
  v === true;

const readNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return null;
};


export function normalizeSTPrompt(raw: unknown): STPresetPrompt | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const identifier = readText(obj.identifier);
  if (!identifier) return null;

  const roleRaw = readText(obj.role).toLowerCase();
  const role: STPresetPrompt['role'] =
    roleRaw === 'user' || roleRaw === 'assistant'
      ? roleRaw
      : 'system';

  const content = readText(obj.content) || readText(obj.prompt) || '';
  if (!content) return null;

  return {
    identifier,
    name: readText(obj.name) || readText(obj.title) || undefined,
    role,
    content,
    system_prompt: readBool(obj.system_prompt),
    injection_position: readNum(obj.injection_position) ?? undefined,
    injection_depth: readNum(obj.injection_depth) ?? undefined,
    injection_order: readNum(obj.injection_order) ?? undefined,
    forbid_overrides: readBool(obj.forbid_overrides),
  };
}


export function normalizeSTOrder(raw: unknown): STPresetOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const characterId = readNum(obj.character_id);
  if (characterId === null) return null;

  const orderRaw = Array.isArray(obj.order) ? obj.order : [];
  const order: STPresetOrderSlot[] = orderRaw
    .map((slot: unknown) => {
      if (!slot || typeof slot !== 'object') return null;
      const s = slot as Record<string, unknown>;
      const identifier = readText(s.identifier);
      if (!identifier) return null;
      return {
        identifier,
        enabled: s.enabled !== false,
      };
    })
    .filter((slot): slot is STPresetOrderSlot => slot !== null);

  return { character_id: characterId, order };
}


interface SamplingParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  repetition_penalty?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

function extractSamplingParams(obj: Record<string, unknown>): SamplingParams {
  return {
    temperature: readNum(obj.temperature) ?? undefined,
    top_p: readNum(obj.top_p) ?? undefined,
    top_k: readNum(obj.top_k) ?? undefined,
    max_tokens: readNum(obj.max_tokens) ?? undefined,
    repetition_penalty: readNum(obj.repetition_penalty) ?? undefined,
    frequency_penalty: readNum(obj.frequency_penalty) ?? undefined,
    presence_penalty: readNum(obj.presence_penalty) ?? undefined,
  };
}


export function normalizeSTPreset(raw: unknown): STPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const prompts = Array.isArray(obj.prompts)
    ? obj.prompts.map(normalizeSTPrompt).filter((p): p is STPresetPrompt => p !== null)
    : [];
  const promptOrder = Array.isArray(obj.prompt_order)
    ? obj.prompt_order.map(normalizeSTOrder).filter((o): o is STPresetOrder => o !== null)
    : [];

  if (prompts.length === 0 || promptOrder.length === 0) return null;

  return {
    ...obj,
    prompts,
    prompt_order: promptOrder,
    ...extractSamplingParams(obj),
  };
}


export function normalizeSTPresetList(raw: unknown): STPresetEntryV2[] {
  const listRaw = Array.isArray(raw) ? raw : [];
  return listRaw.reduce<STPresetEntryV2[]>((acc, item, index) => {
    if (!item || typeof item !== 'object') return acc;
    const src = item as Record<string, unknown>;

    const preset = normalizeSTPreset(src.preset ?? src.预设 ?? src);
    if (!preset) return acc;

    const idRaw = readText(src.id);
    const id = idRaw || `preset_${index + 1}`;

    const nameRaw = readText(src.名称) || readText(src.name);
    const name = nameRaw || `酒馆预设${index + 1}`;

    acc.push({
      id,
      name,
      preset,
      characterId: readNum(src.角色ID ?? src.characterId) ?? undefined,
      importedAt: typeof src.导入时间 === 'number' && Number.isFinite(src.导入时间)
        ? Math.floor(src.导入时间)
        : Date.now(),
      updatedAt: Date.now(),
      isBuiltin: readBool(src.isBuiltin),
    });
    return acc;
  }, []);
}


export function getCurrentSTPresetV2(settings: {
  stPresetsV2?: STPresetEntryV2[];
  currentStPresetIdV2?: string | null;
}, extraPresets: STPresetEntryV2[] = []): STPresetEntryV2 | null {
  const presetList = [
    ...extraPresets,
    ...(Array.isArray(settings.stPresetsV2) ? settings.stPresetsV2 : []),
  ];
  const id = readText(settings.currentStPresetIdV2).trim();
  if (!id) return null;
  return presetList.find((entry) => entry.id === id) ?? null;
}
