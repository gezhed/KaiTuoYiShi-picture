import type { ReactNode } from 'react';

const 标签样式 = {
  color: 'rgb(var(--tj-text-primary))',
} as const;

export function 设置字段({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 font-serif text-xs tracking-[0.22em]" style={标签样式}>{label}</div>
      {children}
      {hint ? (
        <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.62)' }}>
          {hint}
        </div>
      ) : null}
    </label>
  );
}

export function 开关行({
  label,
  desc,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2"
      style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
    >
      <div className="min-w-0 mr-3">
        <div className="font-serif font-bold text-sm tracking-wider" style={标签样式}>{label}</div>
        {desc ? (
          <div className="text-xs mt-0.5" style={{ color: 'rgba(var(--tj-text-secondary), 0.65)' }}>{desc}</div>
        ) : null}
      </div>
      <button
        type="button"
        aria-pressed={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 flex-shrink-0 transition-all disabled:opacity-40"
        style={{
          background: checked
            ? 'linear-gradient(135deg, rgba(var(--tj-btn-primary-start),0.95), rgba(var(--tj-btn-primary-end),0.85))'
            : 'rgba(var(--tj-ui-panel-strong), 0.6)',
          border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-weak))',
        }}
      >
        <span
          className="absolute top-0.5 h-5 w-5 transition-transform"
          style={{
            transform: checked ? 'translateX(22px)' : 'translateX(2px)',
            background: 'rgb(var(--tj-text-primary))',
          }}
        />
      </button>
    </div>
  );
}

export function 面板({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section
      className="space-y-3 px-4 py-4"
      style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))' }}
    >
      <div className="flex items-center gap-2">
        <span className="h-4 w-[3px]" style={{ background: 'rgb(var(--tj-accent-primary))' }} />
        <span className="font-serif text-[13px] font-semibold tracking-[0.28em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
          {title}
        </span>
      </div>
      {desc ? (
        <div className="text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.68)' }}>{desc}</div>
      ) : null}
      {children}
    </section>
  );
}

export function 提示条({ kind, text }: { kind: 'info' | 'ok' | 'error'; text: string }) {
  if (!text) return null;
  const 色 = kind === 'error'
    ? 'rgb(var(--tj-danger))'
    : kind === 'ok'
      ? 'rgb(var(--tj-ui-success))'
      : 'rgba(var(--tj-text-secondary), 0.78)';
  return (
    <div className="px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 色, border: `1px solid ${色}` }}>
      {text}
    </div>
  );
}

export function 主按钮({ children, onClick, disabled }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full py-3 text-sm font-serif tracking-[0.4em] transition-all hover:opacity-90 disabled:opacity-50"
      style={{
        color: 'rgb(var(--tj-ui-active-text))',
        background: 'linear-gradient(135deg, rgba(var(--tj-btn-primary-start),0.95), rgba(var(--tj-btn-primary-end),0.82))',
        border: '1px solid rgba(var(--tj-text-primary), var(--tj-edge-weak))',
      }}
    >
      {children}
    </button>
  );
}

export function 次级按钮({ children, onClick, disabled, active }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-2 text-xs font-serif tracking-wider transition-all disabled:opacity-40"
      style={{
        color: active ? 'rgb(var(--tj-ui-active-text))' : 'rgba(var(--tj-text-primary), 0.86)',
        background: active
          ? 'linear-gradient(135deg, rgba(var(--tj-btn-primary-start),0.95), rgba(var(--tj-btn-primary-end),0.82))'
          : 'rgba(var(--tj-ui-panel-strong), 0.5)',
        border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
      }}
    >
      {children}
    </button>
  );
}

/** 页签条：把多页设置收进一个面板。 */
export function 页签条<T extends string>({ 页签, 当前, onSelect }: {
  页签: Array<{ id: T; label: string; desc?: string }>;
  当前: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
      {页签.map((项) => (
        <button
          key={项.id}
          type="button"
          onClick={() => onSelect(项.id)}
          className="px-3 py-2 text-left transition-all"
          style={{
            color: 当前 === 项.id ? 'rgb(var(--tj-ui-active-text))' : 'rgba(var(--tj-ui-body), 0.82)',
            background: 当前 === 项.id
              ? 'linear-gradient(135deg, rgba(var(--tj-btn-primary-start),0.95), rgba(var(--tj-btn-primary-end),0.82))'
              : 'rgba(var(--tj-ui-panel-strong), 0.42)',
            border: 当前 === 项.id
              ? '1px solid rgba(var(--tj-text-primary), var(--tj-edge-weak))'
              : '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
          }}
        >
          <div className="font-serif text-sm font-bold tracking-[0.16em]">{项.label}</div>
          {项.desc ? <div className="mt-0.5 text-[11px] opacity-75">{项.desc}</div> : null}
        </button>
      ))}
    </div>
  );
}
