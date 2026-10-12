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
  hasLocalSaveData,
  readManifest,
  readStoreRows,
  resolveSaveRoot,
  wipeAll,
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
      const afterKey = url.searchParams.get('after');
      const limit = Number(url.searchParams.get('limit') ?? '25');
      const page = await readStoreRows(store, {
        afterKey: afterKey || null,
        limit: Number.isFinite(limit) ? limit : 25,
      });
      return json({ ok: true, store, ...page });
    }

    if (request.method === 'GET' && route === 'stats') {
      return json({ ok: true, stores: LOCAL_SAVE_STORE_NAMES, hasData: await hasLocalSaveData() });
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
