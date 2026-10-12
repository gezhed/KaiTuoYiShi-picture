// ⚠️ 斜边上的真 border 由 CSS 的属性选择器按内联 polygon 的字面前缀挂上去，前缀由本文件的
//    `cornerClip()` 生成；改这里的输出格式会让那些选择器静默失配，斜边描边消失。
//
// 不要改用 hyperellipse 垫片：它会把内联 clip-path 改写成 `path(…)`，抹掉上述选择器赖以匹配
// 的字符串，重扫时 border-radius 归零、元素退回直角。
//
// clip-path 会连同元素自身的外阴影一起裁掉；在这些元素上写外投影画不出来，需用 inset 阴影
// 或套一层不裁切的父元素。
export const cornerClip = (n: number): string =>
  `polygon(${n}px 0, 100% 0, 100% calc(100% - ${n}px), calc(100% - ${n}px) 100%, 0 100%, 0 ${n}px)`;

export const tinyClip = cornerClip(4);
export const smallClip = cornerClip(6);
export const mediumClip = cornerClip(8);
export const cardClip = cornerClip(10);
export const badgeClip = cornerClip(12);
export const panelClip = cornerClip(14);
export const shellClip = cornerClip(18);

/** CSS 侧按这些值生成 border-radius/corner-shape 规则；改这里不同步会让两者错位。 */
export const CHAMFER_SCALES = [4, 6, 8, 10, 12, 14, 18] as const;
