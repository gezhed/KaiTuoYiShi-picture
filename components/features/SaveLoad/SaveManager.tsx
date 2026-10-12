import { useSaveManager, type SaveManagerCallerActions } from '@/hooks/useSaveManager';

import { SaveManagerModalShell } from './saveManagerModalShell';
import { SaveManagerSettingsShell } from './saveManagerSettingsShell';

export type SaveManagerProps =
  | (SaveManagerCallerActions & {
      variant: 'modal';
      onExportActiveLeafPackage: () => Promise<number | null>;
      onClose: () => void;
    })
  | (SaveManagerCallerActions & {
      variant: 'settingsTab';
      onContinue: () => Promise<boolean>;
    });

export function SaveManager(props: SaveManagerProps) {
  const model = useSaveManager({
    ...props,
    operationErrorMode: props.variant === 'modal' ? 'alert' : 'inline',
  });

  if (props.variant === 'modal') {
    return (
      <SaveManagerModalShell
        model={model}
        onExportActiveLeafPackage={props.onExportActiveLeafPackage}
        onClose={props.onClose}
      />
    );
  }

  return <SaveManagerSettingsShell model={model} onContinue={props.onContinue} />;
}
