import 'fake-indexeddb/auto';
/**
 * 真·往返测试：把带图片的相册写进活跃叶子，再重新读回来。
 *
 * 这是用户反复反馈「重新进入后图与相册都没了」的直接复现。
 * 用真实的 IndexedDB（fake-indexeddb）走 `writeLeafNode` → `loadSave`，
 * 而不是只测「提取记录」这种中间步骤 —— 中间步骤对了、端到端仍然丢，正是上一轮的情况。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/data/zhikuPreset', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/zhikuPreset')>();
  const { 创建空智库系统 } = await import('@/models/zhiku');
  return {
    ...actual,
    loadAllBundledZhikuPresets: () => Promise.resolve(创建空智库系统()),
  };
});

import { loadNewestStory, writeLeafNode } from '@/services/storage/saveTree';
import { loadSave, loadSaveIdByNodeId } from '@/services/storage/saveCrud';
import { seedDefaultWorkspace } from '../helpers/workspaceFixture';
import { clearAlbumAssetObjectUrlCache, getAlbumAssetBlob } from '@/utils/albumObjectUrl';
import { 创建相册图片条目, 添加图片到相册, 解析相册资源引用 } from '@/utils/albumActions';
import { 创建空相册系统 } from '@/models/imageGeneration';
import type { 相册系统 } from '@/models/imageGeneration';
import type { 聊天消息 } from '@/models/chat';

/** 1x1 PNG：真图片字节，能验证 blob 是否完好往返。 */
const 最小PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/** 造一条带插图的助手消息 + 对应相册，形状与手动出图落盘时一致。 */
function 建带图内容(): { 历史: 聊天消息[]; 相册: 相册系统 } {
  const { entry, asset } = 创建相册图片条目({
    title: '正文插图',
    src: 最小PNG,
    source: 'generated',
    targetType: 'scene',
    slot: 'scene',
    dimensions: '1024x1024',
    backend: 'comfyui',
  });
  const 相册 = 添加图片到相册(创建空相册系统(), { asset, entry });
  const 历史 = [{
    id: 'msg_1',
    role: 'assistant',
    content: '她推开了舱门。',
    parsedResponse: { body: '她推开了舱门。' },
    narrativeImages: [{
      id: 'narrative_1',
      dataUrl: `asset:${asset.id}`,
      type: 'scene',
      kind: 'snapshot',
      prompt: 'image###1girl###',
      description: '她推开了舱门。',
      status: 'done',
    }],
  }] as unknown as 聊天消息[];
  return { 历史, 相册 };
}

describe('图片字节往返活跃叶子', () => {
  it('writeLeafNode 写入的图片，loadSave 能连字节一起读回来', async () => {
    await seedDefaultWorkspace();
    const newest = await loadNewestStory();
    if (!newest.headNodeId) throw new Error('缺少初始工作区指针');
    const saveId = await loadSaveIdByNodeId(newest.headNodeId);
    if (!saveId) throw new Error('缺少活跃叶子 saveId');

    const { 历史, 相册 } = 建带图内容();
    const assetId = 相册.assets[0].id;

    await writeLeafNode(newest.headNodeId, { chatHistory: 历史, 相册 });

    // 模拟「重新进入」：清掉内存里的 blob 缓存，只靠 IndexedDB。
    clearAlbumAssetObjectUrlCache();

    const 读回 = await loadSave(saveId);
    expect(读回).not.toBeNull();
    const 读回相册 = (读回 as { 相册?: 相册系统 }).相册;
    expect(读回相册?.assets.some((项) => 项.id === assetId)).toBe(true);

    // 关键：字节必须回到内存缓存，否则界面上永远是一片空白。
    const blob = getAlbumAssetBlob(assetId);
    expect(blob, '图片字节没有随存档读回来').toBeInstanceOf(Blob);
    expect(blob?.size).toBeGreaterThan(0);
  });

  it('读回的相册引用能被解析成可显示地址', async () => {
    await seedDefaultWorkspace();
    const newest = await loadNewestStory();
    if (!newest.headNodeId) throw new Error('缺少初始工作区指针');
    const saveId = await loadSaveIdByNodeId(newest.headNodeId);
    if (!saveId) throw new Error('缺少活跃叶子 saveId');

    const { 历史, 相册 } = 建带图内容();
    await writeLeafNode(newest.headNodeId, { chatHistory: 历史, 相册 });
    clearAlbumAssetObjectUrlCache();

    const 读回 = await loadSave(saveId);
    const 读回相册 = (读回 as { 相册?: 相册系统 }).相册;
    expect(读回相册).toBeDefined();

    // 这正是渲染层做的事：拿 asset:<id> 换一个能放进 <img src> 的地址。
    const 地址 = 解析相册资源引用(读回相册, `asset:${相册.assets[0].id}`);
    expect(地址, '解析不出可显示地址，正文里就会是空白').toBeTruthy();
  });

  it('留存的插图记录本身也跟着存档回来', async () => {
    await seedDefaultWorkspace();
    const newest = await loadNewestStory();
    if (!newest.headNodeId) throw new Error('缺少初始工作区指针');
    const saveId = await loadSaveIdByNodeId(newest.headNodeId);
    if (!saveId) throw new Error('缺少活跃叶子 saveId');

    const { 历史, 相册 } = 建带图内容();
    await writeLeafNode(newest.headNodeId, { chatHistory: 历史, 相册 });
    clearAlbumAssetObjectUrlCache();

    const 读回 = await loadSave(saveId);
    const 读回历史 = (读回 as { chatHistory?: 聊天消息[] }).chatHistory ?? [];
    const 助手 = 读回历史.find((项) => 项.id === 'msg_1');
    expect(助手?.narrativeImages).toHaveLength(1);
    // 锚点必须保留，否则重新进入后图插不回正文。
    expect(助手?.narrativeImages?.[0].description).toBe('她推开了舱门。');
  });

  it('不带图片的写入不会被资产逻辑弄坏', async () => {
    await seedDefaultWorkspace();
    const newest = await loadNewestStory();
    if (!newest.headNodeId) throw new Error('缺少初始工作区指针');
    const saveId = await loadSaveIdByNodeId(newest.headNodeId);
    if (!saveId) throw new Error('缺少活跃叶子 saveId');

    await writeLeafNode(newest.headNodeId, {
      chatHistory: [{ id: 'm', role: 'assistant', content: '纯文本' }] as unknown as 聊天消息[],
    });
    const 读回 = await loadSave(saveId);
    expect((读回 as { chatHistory?: 聊天消息[] }).chatHistory?.[0]?.content).toBe('纯文本');
  });
});
