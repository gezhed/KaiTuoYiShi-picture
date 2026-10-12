import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { getCachedThumb, loadThumb } from './avatarCache';

/**
 * 头像统一走缩略图缓存：每个 URL 只解码一次，之后都是几 KB 的小图。
 *
 * 占位盘始终留在原地，图片只是叠在它上面淡入。
 * 关键点：加载前后这个盒子的尺寸、位置、圆角都不变——既不换元素，也不做缩放，
 * 所以无论图片什么时候到，周围的排版都不会动一下。
 */
export function Avatar({
  src,
  alt,
  className,
  fallback,
}: {
  src?: string;
  alt: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const [thumb, setThumb] = useState<string | undefined>(() => getCachedThumb(src));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    /* 换条目时必须先清空，哪怕新条目根本没有头像：
       提前 return 会让上一条人物的照片留在原地，挂到一条事件资料上。 */
    setThumb(src ? getCachedThumb(src) : undefined);
    setFailed(false);
    if (!src) return;
    if (getCachedThumb(src)) return;

    let alive = true;
    void loadThumb(src).then((value) => {
      if (!alive) return;
      if (value) setThumb(value);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [src]);

  const showImage = Boolean(thumb) && !failed;

  return (
    <span className={className}>
      {/* 永远在场：先占好位，图到了也只是盖上去。 */}
      <span className="zk-ava-ph" aria-hidden="true">
        {showImage ? null : failed || !src ? fallback : null}
      </span>
      {showImage && (
        <motion.img
          src={thumb}
          alt={alt}
          draggable={false}
          className="zk-ava-img"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduced ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
        />
      )}
    </span>
  );
}
