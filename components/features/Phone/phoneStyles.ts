export { smallClip, panelClip as cardClip } from '@/components/ui/clipPaths';

export const phoneShellClip =
  'polygon(28px 0, calc(100% - 28px) 0, 100% 28px, 100% calc(100% - 28px), calc(100% - 28px) 100%, 28px 100%, 0 calc(100% - 28px), 0 28px)';
/* 不能改写成 8px 真边框：外壳定高且带 p-3，内容框两轴会各缩 16px，里面的屏幕跟着变小；
   内阴影垫片又会被丢弃。故用四层背景渐变拼成一整圈内衬，且完全不参与布局。 */
export const phoneBezelFrame = [
  'linear-gradient(180deg, rgba(var(--tj-surface), 0.48) 0 8px, transparent 8px)',
  'linear-gradient(0deg, rgba(var(--tj-surface), 0.48) 0 8px, transparent 8px)',
  'linear-gradient(90deg, rgba(var(--tj-surface), 0.48) 0 8px, transparent 8px)',
  'linear-gradient(270deg, rgba(var(--tj-surface), 0.48) 0 8px, transparent 8px)',
].join(', ');

export const phoneShellSurface =
  'radial-gradient(circle at 50% 0%, rgba(var(--tj-tech-cyan, var(--tj-accent-primary)), 0.16), transparent 32%), linear-gradient(180deg, rgba(var(--tj-bubble), 0.99), rgba(var(--tj-surface-strong), 0.98))';
export const phoneScreenSurface =
  'linear-gradient(180deg, rgba(var(--tj-surface), 0.98), rgba(var(--tj-bg-secondary), 0.96))';
export const phoneCardSurface =
  'linear-gradient(135deg, rgba(var(--tj-bubble), 0.96), rgba(var(--tj-surface-strong), 0.82))';

