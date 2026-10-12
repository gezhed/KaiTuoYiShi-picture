import type { STPreset } from '@/models/stTypes';
import { parseJsonWithRepair } from './jsonRepair';
import { normalizeSTPreset } from './stSettingsNormalizer';

export interface STPresetV2ParseResult {
  preset: STPreset | null;
  usedRepair: boolean;
  error?: string;
}

export function parseSTPresetV2(jsonText: string): STPresetV2ParseResult {
  const parsed = parseJsonWithRepair(jsonText);
  if (parsed.value === null) {
    return {
      preset: null,
      usedRepair: parsed.usedRepair,
      error: parsed.error ?? 'ST 预设 JSON 解析失败',
    };
  }

  const preset = normalizeSTPreset(parsed.value);
  if (!preset) {
    return {
      preset: null,
      usedRepair: parsed.usedRepair,
      error: '未找到有效的 prompts / prompt_order 结构',
    };
  }

  return {
    preset,
    usedRepair: parsed.usedRepair,
  };
}
