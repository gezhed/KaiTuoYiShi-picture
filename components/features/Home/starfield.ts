export interface TwinkleStar {
  id: number;
  left: string;
  top: string;
  size: number;
  color: string;
  glow: string | null;
}

export interface OverlayParticle {
  id: number;
  left: string;
  top: string;
  size: number;
  delay: string;
  drift: number;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const percent = (value: number): string => `${value.toFixed(2)}%`;

function buildTwinkleStars(count: number, seed: number): TwinkleStar[] {
  const random = createRandom(seed);
  return Array.from({ length: count }, (_, id) => {
    const bright = random() < 0.12;
    const warm = random() < 0.08;
    const size = bright ? 2 + random() * 2 : 0.5 + random() * 1.5;
    const alpha = bright ? 0.5 + random() * 0.5 : 0.15 + random() * 0.45;
    const red = warm ? 255 : 180 + Math.floor(random() * 60);
    const green = warm ? 200 + Math.floor(random() * 55) : 210 + Math.floor(random() * 35);
    const blue = warm ? 150 + Math.floor(random() * 50) : 240 + Math.floor(random() * 15);
    return {
      id,
      left: percent(random() * 100),
      top: percent(random() * 100),
      size,
      color: `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`,
      glow: size > 2
        ? `0 0 ${(size * 3).toFixed(1)}px ${(size * 0.8).toFixed(1)}px rgba(${red}, ${green}, ${blue}, ${(alpha * 0.6).toFixed(3)})`
        : null,
    };
  });
}

/** 步长与跨度互质才能铺满整个画面。 */
interface ParticleFieldSpec {
  count: number;
  xStart: number;
  xStep: number;
  xSpan: number;
  yStart: number;
  yStep: number;
  ySpan: number;
  sizes: readonly number[];
  delayCycle: number;
  delayStep: number;
}

function buildParticleField(spec: ParticleFieldSpec): OverlayParticle[] {
  const position = (start: number, step: number, span: number, index: number): string =>
    percent(start + (index * step) % span);
  return Array.from({ length: spec.count }, (_, index) => ({
    id: index,
    left: position(spec.xStart, spec.xStep, spec.xSpan, index),
    top: position(spec.yStart, spec.yStep, spec.ySpan, index),
    size: spec.sizes[index % spec.sizes.length],
    delay: `${((index % spec.delayCycle) * spec.delayStep).toFixed(3)}s`,
    drift: index % 2 === 0 ? -1 : 1,
  }));
}

export const LANDING_STARS: readonly TwinkleStar[] = buildTwinkleStars(26, 0x5eed);

export const JOURNEY_LAUNCH_PARTICLES: readonly OverlayParticle[] = buildParticleField({
  count: 34,
  xStart: 8,
  xStep: 17,
  xSpan: 84,
  yStart: 10,
  yStep: 29,
  ySpan: 78,
  sizes: [1, 1.42, 1.84, 2.26],
  delayCycle: 8,
  delayStep: 0.045,
});

export const HOME_JOURNEY_PARTICLES: readonly OverlayParticle[] = buildParticleField({
  count: 18,
  xStart: 10,
  xStep: 23,
  xSpan: 80,
  yStart: 14,
  yStep: 31,
  ySpan: 70,
  sizes: [2],
  delayCycle: 6,
  delayStep: 0.055,
});

export const SAVE_LOAD_PARTICLES: readonly OverlayParticle[] = buildParticleField({
  count: 24,
  xStart: 8,
  xStep: 19,
  xSpan: 84,
  yStart: 12,
  yStep: 37,
  ySpan: 74,
  sizes: [2, 3, 4],
  delayCycle: 8,
  delayStep: 0.045,
});

export const BOOK_OPEN_PARTICLES: readonly OverlayParticle[] = buildParticleField({
  count: 22,
  xStart: 12,
  xStep: 21,
  xSpan: 76,
  yStart: 18,
  yStep: 29,
  ySpan: 62,
  sizes: [2],
  delayCycle: 7,
  delayStep: 0.05,
});
