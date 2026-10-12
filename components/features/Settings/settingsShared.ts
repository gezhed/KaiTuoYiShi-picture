export { providerOptions } from '@/data/apiProviders';
export { cardClip, smallClip } from '@/components/ui/clipPaths';

/**
 * 不可变地从预设表里删掉一个键。
 *
 * 为什么不写 `delete 表[名称]`：动态 `delete` 在 lint 里是硬错误（`no-dynamic-delete`），
 * 而且它原地修改对象——预设表经常来自 props，原地删会让 React 的引用比较失效。
 */
export function 去掉键<T>(表: Record<string, T>, 键: string): Record<string, T> {
  return Object.fromEntries(Object.entries(表).filter(([名称]) => 名称 !== 键));
}
