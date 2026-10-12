import { resolveStaticAssetReference } from '@/utils/staticAssets';
import { devLogError } from '@/utils/devLog';

/**
 * 头像缩略图缓存。
 *
 * 远端头像各自约 117 KB / 768×768。总览一次要摆近百个，等于让浏览器把 10 MB 的
 * 大图解到 30px 的圆圈里——HTTP 缓存救不了这一步，解码本身就要花掉两百毫秒。
 *
 * 这里每个 URL 只解码一次：缩到 THUMB² 存成 data URL，之后任何一处渲染都是贴一张
 * 几 KB 的小图。第二次进总览、以及同一个人物出现在别处时，都是即时可见。
 */

const THUMB = 128;
const MAX_CONCURRENT = 6;

const cache = new Map<string, string>();
const failed = new Set<string>();
const inflight = new Map<string, Promise<string | null>>();

let active = 0;
const queue: (() => void)[] = [];

function schedule(run: () => void): void {
  const start = () => {
    active += 1;
    run();
  };
  if (active < MAX_CONCURRENT) start();
  else queue.push(start);
}

function release(): void {
  active -= 1;
  const next = queue.shift();
  if (next) next();
}

/** 居中裁切到正方形并缩到 THUMB：头像本来就是方图，cover 裁切不会切掉脸。 */
function drawThumb(image: HTMLImageElement): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB;
  canvas.height = THUMB;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const w = image.naturalWidth || THUMB;
  const h = image.naturalHeight || THUMB;
  const scale = Math.max(THUMB / w, THUMB / h);
  const dw = w * scale;
  const dh = h * scale;
  ctx.drawImage(image, (THUMB - dw) / 2, (THUMB - dh) / 2, dw, dh);
  try {
    return canvas.toDataURL('image/webp', 0.85);
  } catch {
    /* 画布被跨域污染时会抛错；退回 png，再不行就放弃缓存。 */
    try {
      return canvas.toDataURL('image/png');
    } catch (fallbackError) {
      devLogError('ui', 'zhiku-avatar-thumb-encode-failed', fallbackError);
      return null;
    }
  }
}

function decode(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    /* 源站带 access-control-allow-origin: *，所以可以跨域取像素。 */
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(drawThumb(image));
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export function getCachedThumb(src: string | undefined): string | undefined {
  if (!src) return undefined;
  const url = resolveStaticAssetReference(src) ?? src;
  return cache.get(url);
}

export function loadThumb(src: string): Promise<string | null> {
  const url = resolveStaticAssetReference(src) ?? src;
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  if (failed.has(url)) return Promise.resolve(null);
  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = new Promise<string | null>((resolve) => {
    schedule(() => {
      decode(url)
        .then((dataUrl) => {
          if (dataUrl) cache.set(url, dataUrl);
          else failed.add(url);
          inflight.delete(url);
          resolve(dataUrl);
        })
        .catch((error: unknown) => {
          devLogError('ui', 'zhiku-avatar-thumb-failed', error, { url });
          failed.add(url);
          inflight.delete(url);
          resolve(null);
        })
        .finally(release);
    });
  });

  inflight.set(url, promise);
  return promise;
}
