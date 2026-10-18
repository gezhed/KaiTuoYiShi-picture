export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) || 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const source = value as Record<string, unknown>;
  const entries = Object.keys(source)
    .sort()
    .filter((key) => typeof source[key] !== 'undefined' && typeof source[key] !== 'function')
    .map((key) => `${JSON.stringify(key)}:${stableStringify(source[key])}`);
  return `{${entries.join(',')}}`;
}

export function toOwnedBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? Uint8Array.from(input) : new Uint8Array(input.slice(0));
}

export async function sha256Hex(input: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = toOwnedBytes(input);
  // crypto.subtle 只在安全上下文（https / localhost）下可用。
  // 手机通过 http://192.168.x.x:3000 打开时它是 undefined —— 直接调用会抛错，
  // 而这里的哈希只用于缓存键，所以退回纯 JS 的确定性哈希即可。
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (typeof subtle?.digest === 'function') {
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return 'fnv:' + fnv1aHex(bytes);
}

/** 双路 FNV-1a，拼成 16 位十六进制。仅作缓存键，不作安全校验。 */
function fnv1aHex(bytes: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < bytes.length; i += 1) {
    a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0;
    b = Math.imul(b ^ bytes[i], 0x85ebca6b) >>> 0;
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0'));
}

export async function stableHashHex(value: unknown): Promise<string> {
  return sha256Hex(new TextEncoder().encode(stableStringify(value)));
}
