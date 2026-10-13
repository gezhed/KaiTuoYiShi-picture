import type { ReactElement } from 'react';
import { Radio } from 'lucide-react';

import { LanPlaySettingsTab } from '../LanPlaySettingsTab';
import type { SettingsSectionDefinition } from './types';

function LanPlaySection(): ReactElement {
  return <LanPlaySettingsTab />;
}

export const lanPlaySection: SettingsSectionDefinition = {
  key: 'lanPlay',
  label: '局域网游玩',
  icon: '⌁',
  navIcon: Radio,
  group: 'data',
  subtitle: '手机同网远程游玩 · 存档留在电脑',
  Component: LanPlaySection,
};
