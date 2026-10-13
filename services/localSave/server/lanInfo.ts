/**
 * 局域网游玩的服务端支撑：列出本机局域网地址、读写与校验「访问口令」。
 *
 * 仅由 vite 中间件导入——依赖 node:os / node:fs / node:crypto，浏览器构建绝不导入本文件。
 *
 * 设计取舍：
 * - 是否开启口令，以「口令文件是否存在」为准（save/lan-token.txt 存在 = 开启），
 *   服务端是唯一权威，客户端设置页只负责开关与展示。
 * - 回环地址（localhost / 127.0.0.1）永远放行：本机自己从不受口令约束，
 *   只有从局域网 IP 进来的请求才需要口令，避免「电脑自己把自己锁在门外」。
 * - 口令通过链接上的 `?k=…` 首次带入，服务端换成 Cookie 下发；之后浏览器每次同源请求
 *   自动携带，客户端代码一行都不用改。
 */

import { randomInt } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { countStoreRows } from './saveFileStore';
import { resolveSaveRoot } from './saveFileStore';

const TOKEN_FILE_NAME = 'lan-token.txt';

/** 携带口令的 Cookie 名。 */
export const LAN_TOKEN_COOKIE = 'kty_lan_token';
/** 链接里携带口令的查询参数名。 */
export const LAN_TOKEN_QUERY = 'k';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** 去掉 0/O/1/I 等易混字符，口令更好念、更好抄。 */
const 口令字符表 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface LanAddress {
  网卡: string;
  地址: string;
  /** 手机可直接打开的链接；开启口令时已带上 `?k=…`。 */
  链接: string;
}

export interface LanInfo {
  ok: true;
  /** 电脑的主机名。 */
  hostname: string;
  /** 实际监听端口。 */
  port: number;
  /** 存档落盘目录（数据就存在这里，全在这台电脑上）。 */
  saveDir: string;
  /** 是否已开启访问口令。 */
  guardEnabled: boolean;
  /** 当前口令明文；未开启为 null。 */
  token: string | null;
  /** 逐个网卡的地址明细。 */
  addresses: LanAddress[];
  /** 与 addresses 对齐的链接列表。 */
  urls: string[];
  /** 首选链接（第一条）。 */
  primary: string | null;
  /** 磁盘上每个 store 的行数（诊断用）。 */
  disk: Record<string, number>;
}

function tokenFilePath(): string {
  return path.join(resolveSaveRoot(), TOKEN_FILE_NAME);
}

/** 读取当前口令；文件不存在或为空视为未开启。 */
export async function readLanToken(): Promise<string | null> {
  try {
    const raw = await fs.readFile(tokenFilePath(), 'utf8');
    const token = raw.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** 写入或清除口令；传 null/空串即关闭口令（删除文件）。 */
export async function writeLanToken(token: string | null): Promise<void> {
  const file = tokenFilePath();
  const next = token === null ? '' : token.trim();
  if (!next) {
    await fs.rm(file, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, next, 'utf8');
}

/** 生成一个 8 位口令。 */
export function 生成访问口令(): string {
  let token = '';
  for (let index = 0; index < 8; index += 1) {
    token += 口令字符表[randomInt(口令字符表.length)];
  }
  return token;
}

function 是否IPv4(info: os.NetworkInterfaceInfo): boolean {
  return info.family === 'IPv4';
}

/** 收集所有非回环的 IPv4 地址（跳过 127.x、虚拟机常见的无效网段留给用户自己判断）。 */
function 收集局域网地址(): Array<{ 网卡: string; 地址: string }> {
  const 结果: Array<{ 网卡: string; 地址: string }> = [];
  const interfaces = os.networkInterfaces();
  for (const [网卡, 列表] of Object.entries(interfaces)) {
    for (const info of 列表 ?? []) {
      if (!是否IPv4(info) || info.internal) continue;
      结果.push({ 网卡, 地址: info.address });
    }
  }
  return 结果;
}

function 组装链接(地址: string, port: number, token: string | null): string {
  const base = `http://${地址}:${port}/`;
  return token ? `${base}?${LAN_TOKEN_QUERY}=${encodeURIComponent(token)}` : base;
}

/** 组装完整的局域网信息；port 由调用方从实际连接的 socket 上取。 */
export async function 构建局域网信息(port: number): Promise<LanInfo> {
  const token = await readLanToken();
  const guardEnabled = token !== null;
  const addresses: LanAddress[] = 收集局域网地址().map((item) => ({
    网卡: item.网卡,
    地址: item.地址,
    链接: 组装链接(item.地址, port, token),
  }));
  const urls = addresses.map((item) => item.链接);
  return {
    ok: true,
    hostname: os.hostname(),
    port,
    saveDir: resolveSaveRoot(),
    guardEnabled,
    token,
    addresses,
    urls,
    primary: urls[0] ?? null,
    disk: await countStoreRows(),
  };
}

function 主机名(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  const 值 = hostHeader.trim().toLowerCase();
  if (值.startsWith('[')) return 值.slice(0, 值.indexOf(']') + 1);
  return 值.split(':')[0];
}

/** 请求是否来自本机（回环）。无 Host 头（本机进程）也按放行处理。 */
export function 是否来自本机(hostHeader: string | undefined): boolean {
  const 主机 = 主机名(hostHeader);
  if (!主机) return true;
  return 主机 === 'localhost' || 主机 === '127.0.0.1' || 主机 === '::1' || 主机 === '[::1]';
}

function 解析Cookie(header: string | undefined): Record<string, string | undefined> {
  const 结果: Record<string, string | undefined> = {};
  if (!header) return 结果;
  for (const 片段 of header.split(';')) {
    const 等号 = 片段.indexOf('=');
    if (等号 < 0) continue;
    const 名 = 片段.slice(0, 等号).trim();
    const 值 = 片段.slice(等号 + 1).trim();
    if (名) 结果[名] = decodeURIComponent(值);
  }
  return 结果;
}

/** 从请求里取出口令候选：查询串 `?k=` 优先，其次 Cookie。 */
export function 读取请求口令(
  url: URL | null,
  cookieHeader: string | undefined,
): string | null {
  const 查询 = url?.searchParams.get(LAN_TOKEN_QUERY)?.trim();
  if (查询) return 查询;
  const cookie = 解析Cookie(cookieHeader)[LAN_TOKEN_COOKIE]?.trim();
  return cookie || null;
}

/** 给响应下发口令 Cookie（仅在 `?k=` 命中时调用）。 */
export function 下发口令Cookie(res: { setHeader(name: string, value: string): void }, token: string): void {
  res.setHeader(
    'Set-Cookie',
    `${LAN_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`,
  );
}

export interface 口令校验结果 {
  /** 未开启口令时恒为 true。 */
  allowed: boolean;
  guardEnabled: boolean;
  /** 命中口令时返回该口令，供中间件决定是否下发 Cookie。 */
  matchedToken: string | null;
}

/**
 * 判定一次请求是否可以访问受保护接口（存档 / AI 代理）。
 * 规则：未开口令 → 放行；来自本机 → 放行；口令命中（查询或 Cookie）→ 放行；否则拒绝。
 */
export async function 校验局域网访问(
  url: URL | null,
  hostHeader: string | undefined,
  cookieHeader: string | undefined,
): Promise<口令校验结果> {
  const token = await readLanToken();
  if (token === null) return { allowed: true, guardEnabled: false, matchedToken: null };
  if (是否来自本机(hostHeader)) return { allowed: true, guardEnabled: true, matchedToken: null };
  const 候选 = 读取请求口令(url, cookieHeader);
  if (候选 !== null && 候选 === token) {
    return { allowed: true, guardEnabled: true, matchedToken: token };
  }
  return { allowed: false, guardEnabled: true, matchedToken: null };
}
