import { motion, useReducedMotion } from 'motion/react';

/**
 * 标题逐字升起。
 * 不用共享元素做标题：layout 动画缩放的是字形本身，中文会糊成一团；
 * 逐字位移则是重新排版，每个字都是清晰的。
 * 无障碍与测试都走 aria-label 的可访问名，不依赖被拆开的文本节点。
 */
const charVariants = {
  initial: { opacity: 0, y: 22, scale: 0.86 },
  animate: (index: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 440,
      damping: 28,
      mass: 0.5,
      delay: Math.min(index * 0.028, 0.32),
    },
  }),
};

export function StaggerTitle({
  text,
  className,
  as: Tag = 'h2',
}: {
  text: string;
  className?: string;
  as?: 'h1' | 'h2';
}) {
  const reduced = useReducedMotion();

  if (reduced) {
    return <Tag className={className}>{text}</Tag>;
  }

  return (
    <Tag className={className} aria-label={text}>
      {Array.from(text).map((char, index) => (
        <motion.span
          key={`${char}-${index}`}
          aria-hidden="true"
          style={{ display: 'inline-block', whiteSpace: 'pre' }}
          custom={index}
          variants={charVariants}
          initial="initial"
          animate="animate"
        >
          {char}
        </motion.span>
      ))}
    </Tag>
  );
}

