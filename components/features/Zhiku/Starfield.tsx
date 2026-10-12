import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect, useRef } from 'react';

/* 三层深度。近处的星更大更亮、位移更多；远层几乎不动——纵深靠视差量差表示，不靠模糊。 */
const LAYERS = [
  { depth: 7, density: 0.00042, minR: 0.5, maxR: 1.6, alpha: 0.85, bright: 0.02 },
  { depth: 18, density: 0.00026, minR: 0.4, maxR: 1.1, alpha: 0.5, bright: 0.008 },
  { depth: 38, density: 0.00016, minR: 0.3, maxR: 0.8, alpha: 0.3, bright: 0 },
] as const;

/* 星色固定为宇宙色，不跟主题走：两套主题都是深空，星野本就该是同一种光。 */
const TINTS: readonly [number, number, number][] = [
  [255, 255, 255],
  [255, 255, 255],
  [255, 255, 255],
  [255, 244, 212],
  [245, 217, 122],
  [117, 214, 216],
];

/** 固定种子的伪随机：星位在重渲染与 HMR 之间保持稳定，不会每次重排。 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function Starfield() {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  const reduced = useReducedMotion();

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, { stiffness: 46, damping: 22, mass: 1.1 });
  const springY = useSpring(pointerY, { stiffness: 46, damping: 22, mass: 1.1 });

  const x0 = useTransform(springX, (v) => v * LAYERS[0].depth);
  const y0 = useTransform(springY, (v) => v * LAYERS[0].depth);
  const x1 = useTransform(springX, (v) => v * LAYERS[1].depth);
  const y1 = useTransform(springY, (v) => v * LAYERS[1].depth);
  const x2 = useTransform(springX, (v) => v * LAYERS[2].depth);
  const y2 = useTransform(springY, (v) => v * LAYERS[2].depth);

  useEffect(() => {
    if (reduced) return;
    const handle = (event: PointerEvent) => {
      const nx = event.clientX / window.innerWidth - 0.5;
      const ny = event.clientY / window.innerHeight - 0.5;
      pointerX.set(-nx);
      pointerY.set(-ny);
    };
    window.addEventListener('pointermove', handle, { passive: true });
    return () => window.removeEventListener('pointermove', handle);
  }, [pointerX, pointerY, reduced]);

  useEffect(() => {
    /* 尺寸没变就不要再画一遍：iOS 收起地址栏也会发 resize，那一次重排三块
       上千颗星的画布纯属白烧。 */
    let painted = '';
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      const stamp = `${w}x${h}@${dpr}`;
      if (stamp === painted) return;
      painted = stamp;
      refs.current.forEach((_, index) => {
        const canvas = refs.current[index];
        if (!canvas) return;
        const layer = LAYERS[index];
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const random = makeRandom(0x9e37 + index * 7919);
        const count = Math.round(w * h * layer.density);
        for (let i = 0; i < count; i += 1) {
          const x = random() * w;
          const y = random() * h;
          const radius = layer.minR + random() * (layer.maxR - layer.minR);
          const tint = TINTS[Math.floor(random() * TINTS.length)];
          /* 每颗星自带一个亮度档，星野才有疏密而不是均匀噪点。 */
          const alpha = layer.alpha * (0.3 + random() * 0.7);
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${alpha})`;
          ctx.fill();
          /* 少量亮星带一圈柔晕，眼睛把它读成「近」，星野才有纵深而不是一张噪点纸。 */
          if (random() < layer.bright) {
            ctx.beginPath();
            ctx.arc(x, y, radius * 3.4, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${alpha * 0.12})`;
            ctx.fill();
          }
        }
      });
    };
    draw();
    let frame = 0;
    const onResize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(draw);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const motions = [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ];

  return (
    <div className="zk-starfield" aria-hidden="true">
      {LAYERS.map((layer, index) => (
        <motion.canvas
          key={layer.depth}
          ref={(node) => {
            refs.current[index] = node;
          }}
          style={{
            position: 'absolute',
            inset: 0,
            x: reduced ? 0 : motions[index].x,
            y: reduced ? 0 : motions[index].y,
          }}
        />
      ))}
    </div>
  );
}
