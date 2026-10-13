/**
 * 局域网游玩的客户端封装：拉取服务端地址信息、开关访问口令。
 *
 * 依赖 `/api/lan/*` 中间件（见 vite.config.ts 与 services/localSave/server/lanInfo.ts）。
 */
export interface LanAddress {
  网卡: string;
  地址: string;
  /** 手机可直接打开的链接；开启口令时已带上 `?k=…`。 */
  链接: string;
}

export interface LanInfo {
  ok: true;
  hostname: string;
  port: number;
  saveDir: string;
  guardEnabled: boolean;
  token: string | null;
  addresses: LanAddress[];
  urls: string[];
  primary: string | null;
  /** 电脑磁盘上每个 store 的行数（诊断用）。 */
  disk: Record<string, number>;
}

const LAN_API = '/api/lan';

/** 拉取局域网信息；服务端不可用时返回 null。 */
export async function 拉取局域网信息(): Promise<LanInfo | null> {
  try {
    const response = await fetch(`${LAN_API}/info`, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return (await response.json()) as LanInfo;
  } catch {
    return null;
  }
}

/** 开启（可指定口令，缺省由服务端生成）或关闭访问口令；返回最新信息。 */
export async function 设置访问口令(enabled: boolean, token?: string): Promise<LanInfo | null> {
  try {
    const response = await fetch(`${LAN_API}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled, token }),
    });
    if (!response.ok) return null;
    return (await response.json()) as LanInfo;
  } catch {
    return null;
  }
}
