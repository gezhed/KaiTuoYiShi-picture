import { type LucideIcon } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { mediumClip as iconClip, smallClip } from '@/components/ui/clipPaths';


interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  description?: string;
  disabledReason?: string;
  active?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  onClick?: () => void;
  /**
   * `sm` 用于正文里的紧凑操作条（插图卡片那一排）：`md` 的 44px 触控高度
   * 在聊天正文里会把整行撑起来，而这些按钮是密排的次要操作。
   */
  size?: 'sm' | 'md';
}

export function IconButton({
  icon: Icon,
  label,
  description,
  disabledReason,
  active,
  disabled,
  pressed,
  onClick,
  size = 'md',
}: IconButtonProps) {
  const 紧凑 = size === 'sm';
  return (
    <Tooltip label={label} description={disabled ? disabledReason ?? description : description}>
      <button
        type="button"
        onClick={() => { if (!disabled) onClick?.(); }}
        aria-label={label}
        aria-disabled={disabled || undefined}
        aria-pressed={pressed}
        className={
          紧凑
            ? 'flex h-7 w-7 items-center justify-center transition-[color,background-color,box-shadow,opacity] duration-100 hover:bg-[rgba(var(--tj-accent-primary),0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--tj-accent-primary),0.72)] motion-reduce:transition-none'
            : 'flex h-11 w-11 items-center justify-center transition-[color,background-color,box-shadow,opacity] duration-100 hover:bg-[rgba(var(--tj-accent-primary),0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--tj-accent-primary),0.72)] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--tj-surface))] motion-reduce:transition-none md:h-8 md:w-10'
        }
        style={{
          color: active ? 'rgb(var(--tj-accent-primary))' : 'rgba(var(--tj-accent-primary), 0.85)',
          background: active ? 'rgba(var(--tj-accent-primary), 0.14)' : 'rgba(var(--tj-accent-primary), 0.05)',
          border: active ? '1px solid rgba(var(--tj-accent-primary), var(--tj-edge))' : '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
          clipPath: 紧凑 ? smallClip : iconClip,
          opacity: disabled ? 0.35 : 1,
          cursor: disabled ? 'not-allowed' : 'default',
        }}
      >
        <Icon aria-hidden="true" size={紧凑 ? 15 : 18} strokeWidth={1.9} />
      </button>
    </Tooltip>
  );
}
