import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { handleQianfanProxyRequest } from './services/ai/qianfanProxyCore';
import { handleOpenCodeProxyRequest } from './services/ai/opencodeProxyCore';
import { handlePioneerProxyRequest } from './services/ai/pioneerProxyCore';
import { handleArkProxyRequest } from './services/ai/arkProxyCore';
import { handleClineProxyRequest } from './services/ai/clineProxyCore';
import { handleSaveApi } from './services/localSave/server/saveApiHandler';

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
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readRequestBody(req);
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

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'kty-local-ai-proxy',
      configureServer(server) {
        server.middlewares.use('/api/qianfan', createProxyMiddleware('http://localhost/api/qianfan', handleQianfanProxyRequest));
        server.middlewares.use('/api/opencode', createProxyMiddleware('http://localhost/api/opencode', handleOpenCodeProxyRequest));
        server.middlewares.use('/api/pioneer', createProxyMiddleware('http://localhost/api/pioneer', handlePioneerProxyRequest));
        server.middlewares.use('/api/ark', createProxyMiddleware('http://localhost/api/ark', handleArkProxyRequest));
        server.middlewares.use('/api/cline', createProxyMiddleware('http://localhost/api/cline', handleClineProxyRequest));
        mountLocalSave(server.middlewares);
      },
      configurePreviewServer(server) {
        mountLocalSave(server.middlewares);
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
