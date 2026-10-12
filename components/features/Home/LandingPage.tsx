import { memo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { HomePageCommands, HomePageView } from '@/hooks/useHomePage';
import { LANDING_STARS } from '@/components/features/Home/starfield';
import { mediumClip } from '@/components/ui/clipPaths';

interface LandingPageProps {
  view: HomePageView;
  commands: HomePageCommands;
}

const UTILITY_FRAME: CSSProperties = {
  color: 'rgba(var(--tj-accent-primary), 0.92)',
  background: 'rgba(var(--tj-bg-primary), 0.32)',
  border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-strong))',
  clipPath: mediumClip,
};

const UTILITY_CLASS =
  'px-4 py-2 font-serif text-[12px] tracking-[0.18em] transition-all hover:opacity-90 disabled:pointer-events-none disabled:opacity-60 sm:text-[13px]';

const HERO_SHINE = 'linear-gradient(90deg, transparent, rgba(var(--tj-accent-primary), 0.25), transparent)';
const HERO_SHINE_PRIMARY = 'linear-gradient(90deg, transparent, rgba(var(--tj-text-primary), 0.45), transparent)';

const StarField = memo(function StarField() {
  return (
    <div aria-hidden="true">
      {LANDING_STARS.map((star) => (
        <div
          key={star.id}
          className="absolute rounded-full"
          style={{
            left: star.left,
            top: star.top,
            width: `${star.size}px`,
            height: `${star.size}px`,
            background: star.color,
            boxShadow: star.glow ?? 'none',
          }}
        />
      ))}
    </div>
  );
});

const HeroEmblem = memo(function HeroEmblem() {
  return (
    <div className="relative my-0.5 sm:my-1">
      <svg width="100" height="50" viewBox="-50 -25 100 50" style={{ display: 'block' }}>
        <defs>
          <radialGradient id="hero-star-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(var(--tj-ui-title),1)" />
            <stop offset="25%" stopColor="rgba(var(--tj-accent-primary),0.9)" />
            <stop offset="60%" stopColor="rgba(var(--tj-accent-primary),0.4)" />
            <stop offset="100%" stopColor="rgba(var(--tj-accent-primary),0)" />
          </radialGradient>
          <filter id="hero-star-glow">
            <feGaussianBlur stdDeviation="1" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path
          d="M 0,-22 Q 0,0 14,0 Q 0,0 0,22 Q 0,0 -14,0 Q 0,0 0,-22 Z"
          fill="url(#hero-star-core)"
          filter="url(#hero-star-glow)"
        />
        <line x1="0" y1="-25" x2="0" y2="25" stroke="rgba(var(--tj-accent-primary),0.4)" strokeWidth="0.6" />
        <line x1="-25" y1="0" x2="25" y2="0" stroke="rgba(var(--tj-accent-primary),0.4)" strokeWidth="0.6" />
      </svg>
      <div
        className="absolute rounded-full"
        style={{
          left: '50%',
          top: '50%',
          width: '80px',
          height: '80px',
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(circle, rgba(var(--tj-accent-primary),0.4) 0%, rgba(var(--tj-accent-secondary),0.1) 40%, transparent 70%)',
          animation: 'star-glow-pulse 3s ease-in-out infinite',
        }}
      />
    </div>
  );
});

function UtilityButton({
  onClick,
  disabled,
  className = '',
  ariaExpanded,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  className?: string;
  ariaExpanded?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={ariaExpanded}
      className={`${UTILITY_CLASS} ${className}`}
      style={UTILITY_FRAME}
    >
      {children}
    </button>
  );
}

function HeroButton({
  className,
  label,
  shine,
  disabled,
  onClick,
}: {
  className: string;
  label: string;
  shine: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`kaituo-btn group w-full ${className}`}
    >
      <span
        className="pointer-events-none absolute inset-0 -translate-x-full transition-transform duration-700 ease-out group-hover:translate-x-full"
        style={{ background: shine }}
      />
      <span className="relative">{label}</span>
    </button>
  );
}

export function LandingPage({ view, commands }: LandingPageProps) {
  const { busy, dataReady } = view;
  // 载入路径 / 打开档案都要读内置预置数据，数据未落定时点开只会看到一份空档案。
  const dataGated = busy || !dataReady;

  const [moreOpen, setMoreOpen] = useState(false);

  const collapsedUtilities = [
    { id: 'cloudSave', label: 'GitHub 云存档', run: commands.openCloudSave },
    { id: 'announcements', label: '更新公告', run: commands.openAnnouncements },
    { id: 'discord', label: 'Discord 帖', run: commands.openDiscord },
    { id: 'mysteryChat', label: '神秘聊天', run: commands.openMysteryChat },
  ];

  return (
    <div
      className="relative flex h-[100dvh] flex-col items-center justify-center overflow-hidden px-5 py-6"
      style={{ background: 'rgb(var(--tj-bg-primary))' }}
    >
      <StarField />

      <div
        aria-hidden="true"
        className="absolute inset-0 z-[1] pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 48%, rgba(var(--tj-bg-secondary),0) 15%, rgba(var(--tj-bg-secondary),0) 35%, rgba(var(--tj-bg-primary),0.6) 60%, rgba(var(--tj-bg-primary),0.9) 80%, rgba(var(--tj-bg-primary),1) 100%)',
        }}
      />

      <div className="kaituo-safe-toolbar absolute z-20">
        <div className="flex flex-wrap items-center gap-2">
          {collapsedUtilities.map((item) => (
            <UtilityButton
              key={item.id}
              className="hidden md:inline-flex"
              onClick={item.run}
              disabled={busy}
            >
              {item.label}
            </UtilityButton>
          ))}
          <UtilityButton
            className="md:hidden"
            onClick={() => setMoreOpen((open) => !open)}
            disabled={busy}
            ariaExpanded={moreOpen}
          >
            {moreOpen ? '收起' : '更多'}
          </UtilityButton>
          <UtilityButton onClick={commands.openSettings} disabled={busy}>设置</UtilityButton>
        </div>
        {moreOpen && (
          <div className="mt-2 flex w-40 flex-col gap-2 md:hidden">
            {collapsedUtilities.map((item) => (
              <UtilityButton key={item.id} className="w-full text-left" onClick={item.run} disabled={busy}>
                {item.label}
              </UtilityButton>
            ))}
          </div>
        )}
      </div>

      <div
        className={`kaituo-safe-badge absolute z-20 flex items-center gap-2 font-serif text-[12px] tracking-[0.16em] sm:text-[13px] ${UTILITY_CLASS}`}
        style={UTILITY_FRAME}
      >
        <span style={{ color: 'rgba(var(--tj-accent-primary), 0.8)' }}>◆</span>
        <span>v{view.version}</span>
      </div>

      <div className="relative z-10 flex min-h-0 w-full max-w-[520px] flex-col items-center justify-center animate-fade-in">
        <div className="mb-3 flex w-full items-center justify-center gap-3 sm:gap-6">
          <span className="hidden text-2xl sm:inline" style={{ color: 'rgba(var(--tj-accent-primary), 0.55)' }}>◆</span>
          <h1
            className="flex flex-col items-center gap-1 text-center font-serif text-[clamp(2.8rem,17vw,4rem)] font-bold leading-[0.98] tracking-[0.12em] sm:block sm:text-6xl sm:tracking-[0.28em]"
            style={{
              background: 'linear-gradient(180deg, rgb(var(--tj-text-primary)) 0%, rgb(var(--tj-accent-primary)) 50%, rgb(var(--tj-accent-secondary)) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter: 'drop-shadow(0 0 24px rgba(var(--tj-accent-primary), 0.35))',
            }}
          >
            <span>开拓</span>
            <span>轶事</span>
          </h1>
          <span className="hidden text-2xl sm:inline" style={{ color: 'rgba(var(--tj-accent-primary), 0.55)' }}>◆</span>
        </div>

        <div className="mb-3 flex w-full items-center justify-center gap-3 sm:mb-4 sm:gap-4">
          <div
            className="h-px w-10 sm:w-14"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(var(--tj-accent-primary), 0.65))' }}
          />
          <p
            className="font-serif text-sm tracking-[0.28em] sm:text-lg sm:tracking-[0.5em]"
            style={{ color: 'rgb(var(--tj-accent-primary))' }}
          >
            崩坏·星穹铁道
          </p>
          <div
            className="h-px w-10 sm:w-14"
            style={{ background: 'linear-gradient(90deg, rgba(var(--tj-accent-primary), 0.65), transparent)' }}
          />
        </div>

        <p
          className="mb-3 text-center text-xs leading-relaxed tracking-[0.16em] sm:mb-4 sm:text-sm sm:tracking-[0.22em]"
          style={{ color: 'rgba(var(--tj-text-secondary),0.6)' }}
        >
          踏上命途，遨游星海，写下你的开拓之旅吧
        </p>

        <HeroEmblem />

        <div className="mt-3 flex w-full max-w-[340px] flex-col gap-3 animate-slide-up sm:w-72 sm:gap-3.5">
          <HeroButton
            className="kaituo-btn-primary px-6 py-3.5 text-base font-medium"
            label="踏上旅途"
            shine={HERO_SHINE_PRIMARY}
            disabled={busy}
            onClick={commands.newGame}
          />
          <HeroButton
            className="kaituo-btn-secondary px-6 py-3 text-base"
            label="读取光锥"
            shine={HERO_SHINE}
            disabled={dataGated}
            onClick={commands.loadSave}
          />
          <HeroButton
            className="kaituo-btn-secondary px-6 py-3 text-base"
            label="如我所书"
            shine={HERO_SHINE}
            disabled={busy}
            onClick={commands.openWorldbook}
          />
          <HeroButton
            className="kaituo-btn-secondary px-6 py-3 text-base"
            label="智库"
            shine={HERO_SHINE}
            disabled={dataGated}
            onClick={commands.openZhiku}
          />
        </div>
      </div>

      <div
        className="kaituo-safe-footer absolute z-10 flex flex-col items-center gap-1 text-center text-xs opacity-60"
        style={{ color: 'rgb(var(--tj-text-secondary))' }}
      >
        <p>开拓轶事 v{view.version}</p>
        <p className="text-[11px] leading-relaxed">
          作者：{view.author} · 贡献者：{view.contributors.join('，')}
        </p>
      </div>
    </div>
  );
}
