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
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function stableHashHex(value: unknown): Promise<string> {
  return sha256Hex(new TextEncoder().encode(stableStringify(value)));
}
