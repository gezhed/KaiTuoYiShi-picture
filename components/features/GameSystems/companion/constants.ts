import type { CSSProperties } from 'react';

import { badgeClip as cardClip, smallClip } from '@/components/ui/clipPaths';
export { cardClip, smallClip };

const panelStripe =
  'linear-gradient(90deg, rgba(var(--tj-tech-cyan-deep, var(--tj-accent-primary)), var(--tj-edge-tint-strong)) 0 3px, transparent 3px)';

export const panelStyle: CSSProperties = {
  background: `${panelStripe}, radial-gradient(circle at 12% 0%, rgba(var(--tj-tech-cyan), 0.12), transparent 34%), linear-gradient(180deg, rgba(var(--tj-surface), 0.74), rgba(var(--tj-bg-primary), 0.92))`,
  border: '1px solid rgba(var(--tj-border), var(--tj-edge-strong))',
  clipPath: cardClip,
};
export const titleColor = 'rgb(var(--tj-ui-title))';
export const bodyColor = 'rgba(var(--tj-ui-body), 0.95)';
export const mutedColor = 'rgba(var(--tj-ui-muted), 0.82)';
export const faintColor = 'rgba(var(--tj-ui-faint), 0.74)';
export const accentColor = 'rgb(var(--tj-accent-primary))';
export const nsfwColor = 'rgb(var(--tj-ui-nsfw))';
export const activeSurface = 'linear-gradient(90deg, rgba(var(--tj-btn-primary-start), 0.16), rgba(var(--tj-tech-cyan), 0.055))';
export const quietSurface = 'linear-gradient(135deg, rgba(var(--tj-ui-panel), 0.62), rgba(var(--tj-ui-panel-strong), 0.72))';
