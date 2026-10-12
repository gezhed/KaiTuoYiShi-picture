import type { ReactNode } from 'react';
import { smallClip, tinyClip } from '@/components/ui/clipPaths';

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
        /* 开关本身没有文字，把标题给它当无障碍名称：读屏与测试都靠它定位。 */
        aria-label={label}
        aria-pressed={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 flex-shrink-0 transition-all disabled:opacity-40"
        style={{
          /*
           * 样式与其余设置页里手写的开关**逐字对齐**（新闻/手机/记忆/忆馆/智库/剧情编织/
           * 变量/游戏本体/NSFW/额外功能/提示词 这 11 处各写了一份同样的实现）。
           *
           * 为什么要对齐：这一处过去是「直角轨道 + 米色实心旋钮 + translateX 定位」，
           * 而别处是「切角轨道 + 深色切角旋钮 + left 定位」。结果只有用到本组件的两个地方
           * （文生图、视觉设置的 galgame 段）开关长得不一样：轨道没有斜边描边，旋钮变成
           * 一块米色方块并且跑出轨道右侧 —— 用户报的「按钮显示 bug」就是它。
           * 修的时候**改这一处**，不要去改那 11 处：共用件对齐既有实现，风险最小。
           */
          background: checked
            ? 'linear-gradient(135deg, rgba(var(--tj-btn-primary-start), 0.95), rgba(var(--tj-btn-primary-end), 0.86))'
            : 'rgba(var(--tj-bg-secondary), 0.68)',
          border: checked
            ? '1px solid rgba(var(--tj-text-primary), var(--tj-edge))'
            : '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
          clipPath: smallClip,
        }}
      >
        <span
          className="absolute top-0.5 h-5 w-5 transition-transform"
          style={{
            // 用 `left` 而不是 `transform`：按钮默认 text-align:center，
            // 绝对定位元素在 left:auto 时会落到静态位置（居中），再叠加 transform 就会跑出轨道。
            left: checked ? 'calc(100% - 1.375rem)' : '0.125rem',
            background: checked ? 'rgb(var(--tj-bg-primary))' : 'rgba(var(--tj-text-secondary), 0.78)',
            clipPath: tinyClip,
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
