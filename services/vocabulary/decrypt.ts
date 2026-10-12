/**
 * 词库文件解密。
 *
 * 派生自 st-chatu8（智绘姬）index.js L93661-L93871 的 `tagData/*.json` 加载逻辑。
 *
 * 修改声明（AFPL v9 §2(c)(i)）：
 *   修改者：KaiTuoYiShi 移植作者；修改日期：2026-02-15；
 *   修改目的：上游用 CryptoJS 的字符串口令模式解密（`CryptoJS.AES.decrypt(text, key)`）。
 *   本应用不引入 CryptoJS（约 47 KB），改为自带 EVP_BytesToKey(MD5) 派生 + WebCrypto AES-CBC，
 *   产出与上游逐字节一致；同时把「口令写死在代码里」这一事实显式记录，因为它是
 *   上游资产能被任何客户端解开的根本原因。
 *
 * 格式：OpenSSL `Salted__`（8 字节魔数）+ 8 字节盐 + AES-256-CBC 密文，
 * 密钥与 IV 由 `EVP_BytesToKey(MD5, 1 次迭代)` 派生 48 字节后前 32/后 16 切分。
 */

import { md5Bytes } from '@/utils/md5';

/** 上游硬编码口令（index.js L93662）。解码上游资产必需，不是本应用的安全边界。 */
export const 词库口令 = 'a-very-secret-key-that-is-not-so-secret';
const 魔数 = 'Salted__';

/** base64 解码；输入含非 base64 字符时返回 null。 */
function 尝试Base64解码(文本: string): Uint8Array | null {
  const 紧凑 = 文本.replace(/\s+/g, '');
  if (!紧凑 || !/^[A-Za-z0-9+/]+={0,2}$/.test(紧凑) || 紧凑.length % 4 !== 0) return null;
  try {
    const 二进制 = atob(紧凑);
    const 字节 = new Uint8Array(二进制.length);
    for (let i = 0; i < 二进制.length; i += 1) 字节[i] = 二进制.charCodeAt(i);
    return 字节;
  } catch {
    return null;
  }
}

/**
 * 把上游文件内容归一成密文字节。
 *
 * 上游把 CryptoJS 的密文以 **base64 文本**存进 `tagData/*.json`
 * （文件头是 `U2FsdGVkX18`，即 `Salted__` 的 base64），
 * 而 `CryptoJS.AES.decrypt(text, key)` 正好按 base64 解入口令模式密文。
 * 这里两种形态都接受：真正的二进制密文与 base64 文本。
 */
export function 归一化密文负载(原始: Uint8Array): Uint8Array {
  if (原始.length >= 8 && String.fromCharCode(...原始.slice(0, 8)) === 魔数) return 原始;
  const 文本 = new TextDecoder('utf-8', { fatal: false }).decode(原始).trim();
  const 解码后 = 尝试Base64解码(文本);
  if (解码后) return 解码后;
  return 原始;
}

function 读取盐与密文(原始输入: Uint8Array): { salt: Uint8Array; 密文: Uint8Array } {
  const 原始 = 归一化密文负载(原始输入);
  if (原始.length < 16) throw new Error('词库文件太短，不是有效的加密负载。');
  const 魔数文本 = String.fromCharCode(...原始.slice(0, 8));
  if (魔数文本 !== 魔数) {
    throw new Error(`词库文件缺少 OpenSSL Salted__ 头（实际前 8 字节为 "${魔数文本}"）。请确认选的是 st-chatu8 的 tagData 文件。`);
  }
  return { salt: 原始.slice(8, 16), 密文: 原始.slice(16) };
}

/**
 * `EVP_BytesToKey` 的 MD5 变体：反复 MD5(前一轮结果 + 口令 + 盐) 并拼接若干轮。
 *
 * 必须用 `md5Bytes` 而不是 `md5`——后者接收字符串并按 UTF-8 编码，而这里的输入是
 * 任意字节（口令与盐都可能含 ≥ 0x80 的字节），走 UTF-8 往返会把 1 字节变成 2 字节，
 * 派生出的密钥完全错误（实测表现为 AES 解密报填充校验失败）。
 */
export function 派生密钥与iv(口令: string, salt: Uint8Array, 长度 = 48): Uint8Array {
  const 口令字节 = new TextEncoder().encode(口令);
  const 输出 = new Uint8Array(长度);
  let 已产出 = 0;
  let 上一轮 = new Uint8Array(0);
  while (已产出 < 长度) {
    const 输入 = new Uint8Array(上一轮.length + 口令字节.length + salt.length);
    输入.set(上一轮, 0);
    输入.set(口令字节, 上一轮.length);
    输入.set(salt, 上一轮.length + 口令字节.length);
    const 摘要 = 十六进制转字节(md5Bytes(输入));
    上一轮 = 摘要;
    const 本轮可用 = Math.min(摘要.length, 长度 - 已产出);
    输出.set(摘要.subarray(0, 本轮可用), 已产出);
    已产出 += 本轮可用;
  }
  return 输出;
}

function 十六进制转字节(十六进制: string): Uint8Array {
  const 输出 = new Uint8Array(十六进制.length / 2);
  for (let i = 0; i < 输出.length; i += 1) {
    输出[i] = Number.parseInt(十六进制.substr(i * 2, 2), 16);
  }
  return 输出;
}

/** 解密为字节。WebCrypto 的 AES-CBC 会自行校验并剥离 PKCS#7 填充。 */
export async function 解密词库字节(原始: Uint8Array, 口令 = 词库口令): Promise<Uint8Array> {
  const { salt, 密文 } = 读取盐与密文(原始);
  if (密文.length === 0 || 密文.length % 16 !== 0) {
    throw new Error('词库密文长度不是 16 的整数倍，文件可能被截断。');
  }
  const 密钥材料 = 派生密钥与iv(口令, salt, 48);
  const key = await crypto.subtle.importKey('raw', 密钥材料.slice(0, 32), { name: 'AES-CBC' }, false, ['decrypt']);
  try {
    const 明文 = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-CBC', iv: 密钥材料.slice(32, 48) }, key, 密文),
    );
    return 明文;
  } catch (错误) {
    throw new Error(
      '词库解密失败：口令或填充校验不通过。若文件来自其他版本，口令可能已变更。'
      + `（底层错误：${错误 instanceof Error ? 错误.message : String(错误)}）`,
    );
  }
}

export interface 解密词库结果 {
  /** 已解析的 JSON。 */
  数据: unknown;
  /** 原始文件字节数。 */
  原始字节: number;
  /** 解密后文本字节数。 */
  明文字节: number;
}

export async function 解密词库文本(原始: Uint8Array, 口令 = 词库口令): Promise<解密词库结果> {
  const 明文 = await 解密词库字节(原始, 口令);
  const 文本 = new TextDecoder('utf-8').decode(明文);
  let 数据: unknown;
  try {
    数据 = JSON.parse(文本);
  } catch (错误) {
    throw new Error(
      `词库解密后不是合法 JSON：${错误 instanceof Error ? 错误.message : String(错误)}。`
      + `若文件来自其他版本，口令可能已变更。明文预览：${文本.slice(0, 120)}`,
    );
  }
  return { 数据, 原始字节: 原始.length, 明文字节: 明文.length };
}
