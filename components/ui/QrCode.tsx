import type { ReactElement } from 'react';
import { useMemo } from 'react';

import { 生成二维码 } from '@/utils/qrEncode';

interface QrCodeProps {
  内容: string;
  /** 渲染像素尺寸（正方形）。 */
  尺寸?: number;
  className?: string;
}

/**
 * 把一段文本渲染成二维码 SVG。使用自包含编码器，不引第三方依赖。
 * 文本超出编码器容量（约 213 字节）时返回 null。
 */
export function QrCode({ 内容, 尺寸 = 200, className }: QrCodeProps): ReactElement | null {
  const qr = useMemo(() => 生成二维码(内容), [内容]);
  if (!qr) return null;

  const 静区 = 2;
  const 总格 = qr.size + 静区 * 2;
  const 路径: string[] = [];
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.modules[y][x]) 路径.push(`M${x + 静区} ${y + 静区}h1v1h-1z`);
    }
  }

  return (
    <svg
      className={className}
      width={尺寸}
      height={尺寸}
      viewBox={`0 0 ${总格} ${总格}`}
      role="img"
      aria-label="二维码"
      shapeRendering="crispEdges"
    >
      <rect width={总格} height={总格} fill="#ffffff" />
      <path d={路径.join('')} fill="#000000" />
    </svg>
  );
}
