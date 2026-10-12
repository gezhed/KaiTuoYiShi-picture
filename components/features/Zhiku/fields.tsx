import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="zk-field">
      <span className="zk-field__label">{label}</span>
      {children}
    </label>
  );
}

export function PerformanceTextarea({ label, value, editable, rows = 3, placeholder, onChange }: {
  label: string;
  value: string;
  editable: boolean;
  rows?: number;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={!editable}
        rows={rows}
        placeholder={placeholder}
        className="zk-input zk-scroll"
      />
    </Field>
  );
}

export function StructuredFlag({ label, checked, editable, onChange }: {
  label: string;
  checked?: boolean;
  editable: boolean;
  onChange: (checked: boolean | undefined) => void;
}) {
  return (
    <Field label={label}>
      <select
        value={typeof checked === 'boolean' ? String(checked) : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
        disabled={!editable}
        className="zk-input"
      >
        <option value="">继承范围</option>
        <option value="true">允许</option>
        <option value="false">禁止</option>
      </select>
    </Field>
  );
}

/** 开关是一条会真的滑过去的轨道：弹簧位移，不是颜色切换。 */
export function ToggleRow({ label, checked, disabled, onChange }: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const reduced = useReducedMotion();
  return (
    <label className="zk-toggle" data-disabled={disabled ? 'true' : 'false'}>
      <span className="min-w-0 truncate">{label}</span>
      <span style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          style={{ position: 'absolute', inset: 0, opacity: 0, margin: 0, cursor: disabled ? 'not-allowed' : 'pointer' }}
        />
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 18,
            borderRadius: 9,
            display: 'inline-block',
            background: checked ? 'rgba(var(--zk-gold), 0.85)' : 'rgba(var(--zk-text), 0.14)',
            border: '1px solid var(--zk-hair)',
            transition: 'background 160ms linear',
          }}
        >
          <motion.span
            aria-hidden="true"
            style={{
              display: 'block',
              width: 12,
              height: 12,
              marginTop: 2,
              borderRadius: 6,
              background: checked ? 'rgb(var(--zk-ink))' : 'rgb(var(--zk-faint))',
            }}
            animate={{ x: checked ? 17 : 2 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 26 }}
          />
        </span>
      </span>
    </label>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="zk-section__label">{children}</div>;
}

/**
 * 空与未解锁是大多数玩家见到的第一个状态，所以它不是一个「兜底分支」，
 * 而是一个被正式设计的入口：能说出为什么空、以及下一步能做什么。
 */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="zk-empty">
      <strong className="zk-empty__title">{title}</strong>
      {hint && <span className="zk-empty__hint">{hint}</span>}
      {action}
    </div>
  );
}
