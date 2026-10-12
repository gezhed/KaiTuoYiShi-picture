import type { Dispatch, SetStateAction } from 'react';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import type { ZhikuCatalogStatus, 智库系统 } from '@/models/zhiku';
import type { 智库系统设置 } from '@/models/settings';
import { ZhikuExperience, type ZhikuSurface } from './ZhikuExperience';

interface Props {
  zhikuSystem: 智库系统;
  storyWeavingSystem: 剧情编织系统;
  onZhikuSystemChange: Dispatch<SetStateAction<智库系统>>;
  settings: 智库系统设置;
  onSaveZhikuSystem: (system: 智库系统) => Promise<void>;
  onZhikuMigration: (current: 智库系统) => Promise<智库系统>;
  onClose?: () => void;
  catalogStatus?: ZhikuCatalogStatus;
  surface?: ZhikuSurface;
}

export function ZhikuSystemPanel({
  zhikuSystem,
  storyWeavingSystem,
  onZhikuSystemChange,
  onSaveZhikuSystem,
  onZhikuMigration,
  onClose,
  catalogStatus = 'ready',
  surface = 'ingame',
}: Props) {
  return (
    <ZhikuExperience
      zhikuSystem={zhikuSystem}
      storyWeavingSystem={storyWeavingSystem}
      onZhikuSystemChange={onZhikuSystemChange}
      onSaveZhikuSystem={onSaveZhikuSystem}
      onRefreshBundled={onZhikuMigration}
      onClose={onClose}
      catalogStatus={catalogStatus}
      surface={surface}
    />
  );
}
