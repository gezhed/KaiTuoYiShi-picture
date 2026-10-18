import { defineConfig } from 'vitest/config';
import type { PreviewServer, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { handleQianfanProxyRequest } from './services/ai/qianfanProxyCore';
import { handleOpenCodeProxyRequest } from './services/ai/opencodeProxyCore';
import { handlePioneerProxyRequest } from './services/ai/pioneerProxyCore';
import { handleArkProxyRequest } from './services/ai/arkProxyCore';
import { handleClineProxyRequest } from './services/ai/clineProxyCore';
import { handleSaveApi } from './services/localSave/server/saveApiHandler';
import {
  LAN_TOKEN_QUERY,
  writeLanToken,
  下发口令Cookie,
  构建局域网信息,
  是否来自本机,
  生成访问口令,
  校验局域网访问,
} from './services/localSave/server/lanInfo';
import { 发布实时事件, 处理实时订阅, 读取实时事件 } from './services/localSave/server/liveBus';
import { 转发AI请求, 转发AI流, type AI中转请求 } from './services/localSave/server/aiRelay';

function readRequestBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * 读原始二进制请求体。
 *
 * 资产（图片等）**绝不能**走 `readRequestBody`：那个函数 `setEncoding('utf8')` 会把字节
 * 当字符串解码再编码，二进制一过就变形（实测 70 字节的 PNG 上传后变 94 字节）。
 */
function readRequestBodyBuffer(req: import('node:http').IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

type ProxyMiddleware = (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
) => void;

function createProxyMiddleware(
  targetUrl: string,
  handle: (request: Request) => Promise<Response>,
): ProxyMiddleware {
  return (req, res) => {
    const target = res;
    const respond = async (): Promise<void> => {
      if (req.method === 'OPTIONS') {
        target.statusCode = 200;
        target.setHeader('content-type', 'application/json; charset=utf-8');
        target.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method !== 'POST') {
        target.statusCode = 405;
        target.setHeader('content-type', 'application/json; charset=utf-8');
        target.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }
      const body = await readRequestBody(req);
      const response = await handle(new Request(targetUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }));
      target.statusCode = response.status;
      response.headers.forEach((value, key) => {
        target.setHeader(key, value);
      });
      target.end(Buffer.from(await response.arrayBuffer()));
    };
    void respond();
  };
}

/**
 * 本地存档落盘中间件：把浏览器发来的 /api/saves/* 转成一个 Request，交由与宿主无关的
 * handleSaveApi 处理，返回值再写回 http 响应。开发与预览两种宿主共用同一挂载。
 */
function createSaveMiddleware(): ProxyMiddleware {
  return (req, res) => {
    const target = res;
    const respond = async (): Promise<void> => {
      const method = req.method ?? 'GET';
      const originalUrl = (req as { originalUrl?: string }).originalUrl;
      const requestPath = originalUrl ?? `/api/saves${req.url ?? ''}`;
      // 资产路由必须按二进制读：JSON 路由才能走 utf8 字符串。
      const isAsset = requestPath.startsWith('/api/saves/asset/');
      const body = method === 'GET' || method === 'HEAD'
        ? undefined
        : isAsset
          ? await readRequestBodyBuffer(req)
          : await readRequestBody(req);
      const response = await handleSaveApi(new Request(`http://localhost${requestPath}`, {
        method,
        headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
        body,
      }));
      target.statusCode = response.status;
      response.headers.forEach((value, key) => target.setHeader(key, value));
      target.end(Buffer.from(await response.arrayBuffer()));
    };
    respond().catch((error: unknown) => {
      target.statusCode = 500;
      target.setHeader('content-type', 'application/json; charset=utf-8');
      target.end(JSON.stringify({ ok: false, error: String(error) }));
    });
  };
}

function mountLocalSave(middlewares: { use: (route: string, handler: ProxyMiddleware) => void }): void {
  middlewares.use('/api/saves', createSaveMiddleware());
}

type NextFn = (err?: unknown) => void;

type Connect中间件 = (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  next: NextFn,
) => void;

interface 中间件宿主 {
  use(handler: Connect中间件): void;
}

/** 取当前实际监听的端口；未监听时退回配置里的端口。 */
function 取监听端口(server: ViteDevServer | PreviewServer): number {
  const address = server.httpServer?.address();
  if (address && typeof address === 'object' && typeof address.port === 'number') return address.port;
  return server.config.server.port;
}

function 解析请求URL(req: import('node:http').IncomingMessage): URL | null {
  try {
    return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  } catch {
    return null;
  }
}

function jsonResponse(res: import('node:http').ServerResponse, status: number, 数据: unknown): void {
  const target = res;
  target.statusCode = status;
  target.setHeader('content-type', 'application/json; charset=utf-8');
  target.end(JSON.stringify(数据));
}

/**
 * 局域网游玩的三道中间件（顺序即优先级）：
 *   ① 任何请求带对口令的 `?k=` → 换成 Cookie 下发，之后同源请求自动携带；
 *   ② `/api/lan/*` → 地址与口令管理（口令管理只允许本机操作）；
 *   ③ 其余 `/api/*`（存档 / AI 代理）→ 开启口令时校验，不通过返回 401。
 * 未读口令文件时 ③ 形同虚设，与改造前完全一致。
 */
function 安装局域网门禁(middlewares: 中间件宿主, 取端口: () => number): void {
  middlewares.use((req, res, next) => {
    void (async () => {
      const url = 解析请求URL(req);
      const 候选 = url?.searchParams.get(LAN_TOKEN_QUERY)?.trim();
      if (url && 候选) {
        const 结果 = await 校验局域网访问(url, req.headers.host, req.headers.cookie);
        if (结果.matchedToken) 下发口令Cookie(res, 结果.matchedToken);
      }
      next();
    })();
  });

  middlewares.use((req, res, next) => {
    const url = 解析请求URL(req);
    if (!url || !url.pathname.startsWith('/api/lan')) {
      next();
      return;
    }
    void (async () => {
      const 路由 = url.pathname.replace(/^\/api\/lan\/?/, '');
      if (req.method === 'GET' && (路由 === '' || 路由 === 'info')) {
        jsonResponse(res, 200, await 构建局域网信息(取端口()));
        return;
      }
      if (req.method === 'POST' && 路由 === 'token') {
        if (!是否来自本机(req.headers.host)) {
          jsonResponse(res, 403, { ok: false, error: 'local-only' });
          return;
        }
        const 原始 = await readRequestBody(req).catch(() => '');
        let 载荷: { enabled?: unknown; token?: unknown } = {};
        try {
          载荷 = JSON.parse(原始 || '{}') as typeof 载荷;
        } catch {
          载荷 = {};
        }
        if (载荷.enabled === true) {
          const 指定 = typeof 载荷.token === 'string' ? 载荷.token.trim() : '';
          await writeLanToken(指定 || 生成访问口令());
        } else {
          await writeLanToken(null);
        }
        jsonResponse(res, 200, await 构建局域网信息(取端口()));
        return;
      }
      jsonResponse(res, 404, { ok: false, error: 'not-found', route: 路由 });
    })().catch((error: unknown) => jsonResponse(res, 500, { ok: false, error: String(error) }));
  });

  middlewares.use((req, res, next) => {
    const url = 解析请求URL(req);
    if (!url || !url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/lan')) {
      next();
      return;
    }
    void (async () => {
      const 结果 = await 校验局域网访问(url, req.headers.host, req.headers.cookie);
      if (!结果.allowed) {
        jsonResponse(res, 401, { ok: false, error: 'lan-token-required' });
        return;
      }
      next();
    })();
  });
}

/** 多端实时通道：SSE 订阅 / 发布 / 诊断。放在口令守卫之后，所以同样受口令保护。 */
function 安装实时通道(middlewares: 中间件宿主): void {
  middlewares.use((req, res, next) => {
    const url = 解析请求URL(req);
    if (!url || !(url.pathname.startsWith('/api/live') || url.pathname.startsWith('/api/ai'))) {
      next();
      return;
    }
    if (url.pathname === '/api/live/stream' && req.method === 'GET') {
      处理实时订阅(req, res);
      return;
    }
    if (url.pathname === '/api/live/publish' && req.method === 'POST') {
      void (async () => {
        const 原始 = await readRequestBody(req).catch(() => '');
        let 载荷: Record<string, unknown> = {};
        try {
          载荷 = JSON.parse(原始 || '{}') as Record<string, unknown>;
        } catch {
          // 解析失败则保留空对象
        }
        jsonResponse(res, 200, { ok: true, seq: 发布实时事件(载荷).seq });
      })();
      return;
    }
    if (url.pathname === '/api/ai/stream' && req.method === 'POST') {
      void (async () => {
        const 原始 = await readRequestBody(req).catch(() => '');
        let 载荷: AI中转请求;
        try {
          载荷 = JSON.parse(原始) as AI中转请求;
        } catch {
          jsonResponse(res, 400, { ok: false, error: 'bad-json' });
          return;
        }
        const 控制器 = new AbortController();
        req.on('close', () => 控制器.abort());
        const 响应 = res;
        try {
          const 上游 = await 转发AI流(载荷, 控制器.signal);
          响应.statusCode = 上游.status;
          上游.headers.forEach((值, 键) => {
            const 小写 = 键.toLowerCase();
            if (小写 !== 'content-encoding' && 小写 !== 'content-length') 响应.setHeader(键, 值);
          });
          if (上游.body) {
            const 读端 = 上游.body.getReader();
            for (;;) {
              const { done, value } = await 读端.read();
              if (done) break;
              响应.write(Buffer.from(value));
            }
          }
          响应.end();
        } catch {
          try {
            响应.statusCode = 502;
            响应.end();
          } catch {
            // 响应已结束，忽略。
          }
        }
      })();
      return;
    }
    if (url.pathname === '/api/live/events' && req.method === 'GET') {
      jsonResponse(res, 200, { ok: true, events: 读取实时事件() });
      return;
    }
    // 朴素转发：浏览器直连撞 CORS 时的兜底通道。只回传上游的状态码与 content-type，
    // 正文原样带回；不进实时通道（模型列表是 GET，广播 typing/turn-done 是噪声）。
    if (url.pathname === '/api/ai/proxy' && req.method === 'POST') {
      void (async () => {
        const 原始 = await readRequestBody(req).catch(() => '');
        let 载荷: AI中转请求;
        try {
          载荷 = JSON.parse(原始) as AI中转请求;
        } catch {
          jsonResponse(res, 400, { ok: false, error: 'bad-json' });
          return;
        }
        if (typeof 载荷.url !== 'string' || !/^https?:/i.test(载荷.url)) {
          jsonResponse(res, 400, { ok: false, error: 'bad-url' });
          return;
        }
        const 响应 = res;
        try {
          const 上游 = await 转发AI请求(载荷);
          响应.statusCode = 上游.status;
          const 类型 = 上游.headers.get('content-type');
          if (类型) 响应.setHeader('content-type', 类型);
          响应.end(Buffer.from(await 上游.arrayBuffer()));
        } catch {
          响应.statusCode = 502;
          响应.end();
        }
      })();
      return;
    }
    jsonResponse(res, 404, { ok: false, error: 'not-found' });
  });
}

/** 启动后在控制台打印可给手机打开的局域网链接，省得自己去查 IP。 */
function 打印局域网链接(server: ViteDevServer | PreviewServer): void {
  server.httpServer?.once('listening', () => {
    void 构建局域网信息(取监听端口(server)).then((信息) => {
      if (!信息.urls.length) {
        console.log('\n  [局域网游玩] 未检测到局域网地址（可能没连 Wi-Fi / 网线）。\n');
        return;
      }
      console.log([
        '',
        '  ┌─ 局域网游玩 · 手机连同一 Wi-Fi 后打开 ─────────────',
        ...信息.urls.map((url) => `  │  ${url}`),
        `  │  存档保存在：${信息.saveDir}`,
        `  │  访问口令：${信息.guardEnabled ? `已开启 · ${信息.token}` : '未开启（同网均可访问）'}`,
        '  └──────────────────────────────────────────────',
        '',
      ].join('\n'));
    });
  });
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'kty-local-ai-proxy',
      configureServer(server) {
        安装局域网门禁(server.middlewares, () => 取监听端口(server));
        安装实时通道(server.middlewares);
        server.middlewares.use('/api/qianfan', createProxyMiddleware('http://localhost/api/qianfan', handleQianfanProxyRequest));
        server.middlewares.use('/api/opencode', createProxyMiddleware('http://localhost/api/opencode', handleOpenCodeProxyRequest));
        server.middlewares.use('/api/pioneer', createProxyMiddleware('http://localhost/api/pioneer', handlePioneerProxyRequest));
        server.middlewares.use('/api/ark', createProxyMiddleware('http://localhost/api/ark', handleArkProxyRequest));
        server.middlewares.use('/api/cline', createProxyMiddleware('http://localhost/api/cline', handleClineProxyRequest));
        mountLocalSave(server.middlewares);
        打印局域网链接(server);
      },
      configurePreviewServer(server) {
        安装局域网门禁(server.middlewares, () => 取监听端口(server));
        安装实时通道(server.middlewares);
        mountLocalSave(server.middlewares);
        打印局域网链接(server);
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
  },
});
