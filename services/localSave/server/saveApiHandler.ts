/**
 * 本地落盘的 HTTP 处理器：vite 中间件与未来的独立本地服务共用同一份路由。
 * 返回标准 Response，与 services/ai 下的代理核心同构，便于任何宿主承载。
 * 仅服务端导入——依赖 node:fs。
 */
import {
  LOCAL_SAVE_MANIFEST_VERSION,
  LOCAL_SAVE_STORE_NAMES,
  isLocalSaveStoreName,
  type LocalSaveMutation,
} from '../saveStoreSchema';
import {
  applyMutation,
  countStoreRows,
  deleteAssetFile,
  hasLocalSaveData,
  readAssetFile,
  readManifest,
  readStoreRow,
  readStoreRows,
  resolveSaveRoot,
  wipeAll,
  writeAssetFile,
  writeTranscript,
} from './saveFileStore';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function handleSaveApi(request: Request): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return json({ ok: false, error: 'invalid-url' }, 400);
  }
  const segments = url.pathname.split('/').filter(Boolean); // ['api','saves',...]
  const route = segments.slice(2).join('/');

  try {
    if (request.method === 'GET' && route === 'health') {
      const manifest = await readManifest();
      return json({
        ok: true,
        dir: resolveSaveRoot(),
        manifestVersion: LOCAL_SAVE_MANIFEST_VERSION,
        hasData: manifest !== null,
        dbVersion: manifest?.dbVersion ?? null,
        updatedAt: manifest?.updatedAt ?? null,
      });
    }

    if (request.method === 'GET' && route === 'manifest') {
      return json({ ok: true, manifest: await readManifest() });
    }

    if (request.method === 'GET' && route.startsWith('store/')) {
      const store = route.slice('store/'.length);
      if (!isLocalSaveStoreName(store)) return json({ ok: false, error: 'unknown-store' }, 404);
      // 按键取单行：供客户端「按需读取」未预载的存档（不再整库回灌）。
      const 单键 = url.searchParams.get('key');
      if (单键 !== null) {
        const 行 = await readStoreRow(store, 单键);
        return json({ ok: true, store, rows: 行 === null ? [] : [行] });
      }
      const afterKey = url.searchParams.get('after');
      const limit = Number(url.searchParams.get('limit') ?? '25');
      const tail = url.searchParams.get('tail');
      const page = await readStoreRows(store, {
        afterKey: afterKey || null,
        limit: Number.isFinite(limit) ? limit : 25,
        ...(tail ? { tail: Number(tail) } : {}),
      });
      return json({ ok: true, store, ...page });
    }

    // 资产（图片等二进制）：GET 取 / POST|PUT 写 / DELETE 删。名字只允许安全字符。
    if (route.startsWith('asset/')) {
      const name = decodeURIComponent(route.slice('asset/'.length));
      if (request.method === 'GET') {
        const file = await readAssetFile(name);
        if (!file) return json({ ok: false, error: 'not-found' }, 404);
        return new Response(new Uint8Array(file.data), {
          status: 200,
          headers: { 'content-type': file.mime, 'cache-control': 'no-cache' },
        });
      }
      if (request.method === 'POST' || request.method === 'PUT') {
        const bytes = Buffer.from(await request.arrayBuffer());
        if (!bytes.length) return json({ ok: false, error: 'empty' }, 400);
        const stored = await writeAssetFile(name, bytes);
        if (!stored) return json({ ok: false, error: 'invalid-name' }, 400);
        return json({ ok: true, name: stored, bytes: bytes.length });
      }
      if (request.method === 'DELETE') {
        return json({ ok: await deleteAssetFile(name) });
      }
      return json({ ok: false, error: 'method-not-allowed' }, 405);
    }

    if (request.method === 'GET' && route === 'stats') {
      return json({
        ok: true,
        stores: LOCAL_SAVE_STORE_NAMES,
        hasData: await hasLocalSaveData(),
        counts: await countStoreRows(),
      });
    }

    if (request.method === 'POST' && route === 'mutate') {
      const mutation = (await request.json()) as LocalSaveMutation;
      await applyMutation(mutation);
      return json({ ok: true, updatedAt: mutation.updatedAt ?? Date.now() });
    }

    if (request.method === 'POST' && route === 'transcript') {
      const entry = (await request.json()) as { turn?: unknown; traveler?: unknown; body?: unknown };
      const turn = Number(entry.turn);
      if (!Number.isFinite(turn)) return json({ ok: false, error: 'invalid-turn' }, 400);
      const filePath = await writeTranscript({
        turn,
        traveler: typeof entry.traveler === 'string' ? entry.traveler : undefined,
        body: typeof entry.body === 'string' ? entry.body : '',
      });
      return json({ ok: true, path: filePath });
    }

    if (request.method === 'POST' && route === 'wipe') {
      await wipeAll();
      return json({ ok: true });
    }

    return json({ ok: false, error: 'not-found', route }, 404);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
