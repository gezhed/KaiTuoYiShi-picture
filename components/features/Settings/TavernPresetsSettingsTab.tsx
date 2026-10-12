import { TavernPresetsTab } from './TavernPresetsTab';
import type { 游戏设置 } from '@/models/settings';
import type { 世界书 } from '@/models/worldbook';
import type { STRegexScript } from '@/models/stTypes';
import type { TavernRegexDryRunResult, TavernRegexScriptSafety } from '@/contracts/ai';

interface TavernPresetsSettingsTabProps {
  settings: 游戏设置;
  onChange: (s: 游戏设置) => void;
  worldbooks: 世界书[];
  onWorldbooksChange: (books: 世界书[]) => void;
  onExtractTavernRegexScripts: (rawPreset: unknown) => STRegexScript[];
  onAnalyzeTavernRegexScript: (script: STRegexScript) => TavernRegexScriptSafety;
  onDryRunTavernRegexScript: (script: STRegexScript, sampleText: string) => TavernRegexDryRunResult;
}

export function TavernPresetsSettingsTab(props: TavernPresetsSettingsTabProps) {
  return <TavernPresetsTab {...props} />;
}
