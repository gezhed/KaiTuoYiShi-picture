import 'fake-indexeddb/auto';
/**
 * 直接测 `保存插图结果` —— 手动生图真正调用的那个落盘函数。
 *
 * 上一轮我修了 `putHeadRow` 的资产落盘并做了原语级测试（写→读），但那不等于
 * 真实调用链一定成立：`保存插图结果` 内部有 `ensureHeadLeafWritable`、错误吞噬等分支，
 * 任何一处让它静默跳过，图就还是丢。这里用真实的 workspace + 真实的函数跑一遍。
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

import { createGameStateHarness } from '../helpers/gameStateHarness';
import { seedDefaultWorkspace } from '../helpers/workspaceFixture';
import { 保存插图结果, type 归档条目 } from '@/hooks/useGame/illustrationWorkflow';
import { loadActiveLeaf, loadNewestStory } from '@/services/storage/saveTree';
import { clearAlbumAssetObjectUrlCache, getAlbumAssetBlob, dataUrlToBlob } from '@/utils/albumObjectUrl';
import { 创建相册图片条目, 添加图片到相册, 解析相册资源引用 } from '@/utils/albumActions';
import { 创建空相册系统 } from '@/models/imageGeneration';
import type { 相册系统 } from '@/models/imageGeneration';
import type { 聊天消息 } from '@/models/chat';

const 最小PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function 建带图内容(): { 历史: 聊天消息[]; 相册: 相册系统; assetId: string } {
  const { entry, asset } = 创建相册图片条目({
    title: '正文插图',
    src: 最小PNG,
    source: 'generated',
    targetType: 'scene',
    slot: 'scene',
  });
  const 相册 = 添加图片到相册(创建空相册系统(), { asset, entry });
  const 历史 = [{
    id: 'msg_rt',
    role: 'assistant',
    content: '她推开了舱门。',
    parsedResponse: { body: '她推开了舱门。' },
    narrativeImages: [{
      id: 'narrative_rt',
      dataUrl: `asset:${asset.id}`,
      type: 'scene',
      kind: 'snapshot',
      prompt: 'image###1girl###',
      description: '她推开了舱门。',
      status: 'done',
    }],
  }] as unknown as 聊天消息[];
  return { 历史, 相册, assetId: asset.id };
}

describe('保存插图结果（真实调用链）', () => {
  it('写完之后重新读取活跃叶子，图片字节还在', async () => {
    const harness = await createGameStateHarness();
    await seedDefaultWorkspace();
    void harness;

    const { 历史, 相册, assetId } = 建带图内容();

    // 这是手动生图落盘时真正调用的函数。
    const 报告 = await 保存插图结果(harness.state, 历史, 相册);

    // 回读校验必须成功，否则界面会明确报「未确认」。
    expect(报告.资产数).toBe(1);
    expect(报告.回读确认数).toBe(1);
    expect(报告.成功).toBe(true);
    expect(报告.原因).toBeUndefined();

    // 模拟重新进入：清空内存里的 blob，只能靠 IndexedDB。
    clearAlbumAssetObjectUrlCache();

    const active = await loadActiveLeaf();
    expect(active.status).toBe('ok');
    if (active.status !== 'ok') return;

    expect(active.leaf.相册?.assets.some((项) => 项.id === assetId)).toBe(true);
    const blob = getAlbumAssetBlob(assetId);
    expect(blob, '保存插图结果没有把图片字节落盘').toBeInstanceOf(Blob);
    expect(blob?.size).toBeGreaterThan(0);
  });

  it('回读失败时报出未确认，而不是假装成功', async () => {
    const harness = await createGameStateHarness();
    await seedDefaultWorkspace();

    const { 历史 } = 建带图内容();
    // 故意给一个不存在的资产：字节从来没进过内存缓存，也就无从落盘。
    const 假相册 = {
      assets: [{ id: 'asset_不存在', dataUrl: 'asset:asset_不存在', source: 'generated', nsfw: false, createdAt: 0, status: 'ready' }],
      entries: [],
      tasks: [],
    } as unknown as 相册系统;

    const 报告 = await 保存插图结果(harness.state, 历史, 假相册);
    // 这种情况必须被识别出来 —— 否则用户只会看到「图没了」而查不出原因。
    expect(报告.成功).toBe(false);
    expect(报告.原因).toContain('回读');
  });

  it('四张图必须**全部**落盘（用户反馈只有最后一张保存上）', async () => {
    const harness = await createGameStateHarness();
    await seedDefaultWorkspace();

    // 逐张归档，形状与真实手动出图完全一致：每张一次 创建相册图片条目 + 添加图片到相册。
    let 相册 = 创建空相册系统();
    const 插图列表 = [] as unknown[];
    const 资产列表: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { entry, asset } = 创建相册图片条目({
        title: `第 ${i + 1} 段正文`,
        src: 最小PNG,
        source: 'generated',
        targetType: 'scene',
        slot: 'scene',
        finalPrompt: `image###prompt_${i}###`,
      });
      相册 = 添加图片到相册(相册, { asset, entry });
      资产列表.push(asset.id);
      插图列表.push({
        id: `nar_${i}`,
        dataUrl: `asset:${asset.id}`,
        type: 'scene',
        kind: 'snapshot',
        prompt: `image###prompt_${i}###`,
        description: `第 ${i + 1} 段正文`,
        status: 'done',
      });
    }
    const 历史 = [{
      id: 'msg_multi',
      role: 'assistant',
      content: '正文',
      parsedResponse: { body: '正文' },
      narrativeImages: 插图列表,
    }] as unknown as 聊天消息[];

    const 报告 = await 保存插图结果(harness.state, 历史, 相册);
    expect(报告.资产数).toBe(4);
    expect(报告.回读确认数, `应有 4 张落盘，实际 ${报告.回读确认数}`).toBe(4);
    expect(报告.成功).toBe(true);

    // 再确认一次：清空内存缓存后，四张的字节都要能从库里取回。
    clearAlbumAssetObjectUrlCache();
    const active = await loadActiveLeaf();
    if (active.status !== 'ok') throw new Error('活跃叶子读取失败');
    for (const id of 资产列表) {
      expect(getAlbumAssetBlob(id), `资产 ${id} 的字节没落盘`).toBeInstanceOf(Blob);
    }
    expect(active.leaf.相册?.assets).toHaveLength(4);
  });

  it('四张内容各不相同的图，字节不能被彼此覆盖', async () => {
    const harness = await createGameStateHarness();
    await seedDefaultWorkspace();

    // 每张用不同字节：如果实现里有「按某个键覆盖」的问题，只有最后一张能存活。
    const 造图 = (序号: number) => {
      const 负载 = `image-${序号}-`.repeat(20);
      return `data:image/png;base64,${btoa(负载)}`;
    };

    let 相册 = 创建空相册系统();
    const 插图列表 = [] as unknown[];
    const 资产列表: Array<{ id: string; 期望: string }> = [];
    for (let i = 0; i < 4; i += 1) {
      const 源 = 造图(i);
      const 期望 = btoa(`image-${i}-`.repeat(20));
      const { entry, asset } = 创建相册图片条目({
        title: `第 ${i + 1} 段正文`,
        src: 源,
        source: 'generated',
        targetType: 'scene',
        slot: 'scene',
      });
      相册 = 添加图片到相册(相册, { asset, entry });
      资产列表.push({ id: asset.id, 期望 });
      插图列表.push({
        id: `nar_${i}`,
        dataUrl: `asset:${asset.id}`,
        type: 'scene',
        kind: 'snapshot',
        prompt: `image###prompt_${i}###`,
        description: `第 ${i + 1} 段正文`,
        status: 'done',
      });
    }
    // 资产 id 必须互不相同——相同就会在 store 里互相覆盖，只剩最后一张。
    expect(new Set(资产列表.map((项) => 项.id)).size).toBe(4);

    const 历史 = [{
      id: 'msg_distinct',
      role: 'assistant',
      content: '正文',
      parsedResponse: { body: '正文' },
      narrativeImages: 插图列表,
    }] as unknown as 聊天消息[];

    await 保存插图结果(harness.state, 历史, 相册);

    clearAlbumAssetObjectUrlCache();
    const active = await loadActiveLeaf();
    if (active.status !== 'ok') throw new Error('活跃叶子读取失败');

    // 逐张核对内容，确保没有互相覆盖。
    for (const { id, 期望 } of 资产列表) {
      const blob = getAlbumAssetBlob(id);
      expect(blob, `资产 ${id} 丢失`).toBeInstanceOf(Blob);
      // 不用 blobToDataUrl：它依赖 FileReader，node 环境下没有。
      const 实际 = new TextDecoder().decode(await (blob as Blob).arrayBuffer());
      expect(实际, `资产 ${id} 的字节被别的图覆盖了`).toBe(`image-${资产列表.findIndex((项) => 项.id === id)}-`.repeat(20));
      expect(期望).toBeTruthy();
    }
  });

  it('缓存被回收后仍要全部落盘（这是「只剩最后一张」的真正成因）', async () => {
    const harness = await createGameStateHarness();
    await seedDefaultWorkspace();

    /*
     * 复现真实时序：出图是逐张的，而落盘发生在**全部出完之后**。
     * 中间任何一次 `pruneAlbumAssetCache`（会话水合就会调用）都会把还没落盘的
     * 字节从内存缓存里踢掉；如果落盘那一刻才回头去缓存里找字节，早先几张就找不到了，
     * 只剩最后一张还在缓存里 —— 正是用户看到的「第四张在、前三张没了」。
     */
    const 造图 = (序号: number) => `data:image/png;base64,${btoa(`img-${序号}-`.repeat(10))}`;

    let 相册 = 创建空相册系统();
    const 新增条目: 归档条目[] = [];
    const 插图列表 = [] as unknown[];
    for (let i = 0; i < 4; i += 1) {
      const 源 = 造图(i);
      const { entry, asset } = 创建相册图片条目({
        title: `第 ${i + 1} 段`,
        src: 源,
        source: 'generated',
        targetType: 'scene',
        slot: 'scene',
      });
      相册 = 添加图片到相册(相册, { asset, entry });
      // 与真实归档一致：归档当刻就把字节带在条目上，不依赖之后的缓存。
      新增条目.push({ asset, entry, blob: dataUrlToBlob(源) ?? undefined });
      插图列表.push({
        id: `nar_${i}`,
        dataUrl: `asset:${asset.id}`,
        type: 'scene',
        kind: 'snapshot',
        prompt: `image###p${i}###`,
        description: `第 ${i + 1} 段`,
        status: 'done',
      });
    }
    const 历史 = [{
      id: 'msg_evict',
      role: 'assistant',
      content: '正文',
      parsedResponse: { body: '正文' },
      narrativeImages: 插图列表,
    }] as unknown as 聊天消息[];

    // 关键一步：模拟「生成与落盘之间缓存被回收」。
    clearAlbumAssetObjectUrlCache();

    const 报告 = await 保存插图结果(harness.state, 历史, 相册, 新增条目);
    expect(报告.资产数).toBe(4);
    expect(报告.回读确认数, `缓存被清后仍应有 4 张落盘，实际 ${报告.回读确认数}`).toBe(4);

    clearAlbumAssetObjectUrlCache();
    const active = await loadActiveLeaf();
    if (active.status !== 'ok') throw new Error('活跃叶子读取失败');
    for (const 条目 of 新增条目) {
      expect(getAlbumAssetBlob(条目.asset.id), `资产 ${条目.asset.id} 没落盘`).toBeInstanceOf(Blob);
    }
  });

  it('读回后相册引用能解析出可显示地址', async () => {
    const harness = await createGameStateHarness();
    await seedDefaultWorkspace();

    const { 历史, 相册, assetId } = 建带图内容();
    await 保存插图结果(harness.state, 历史, 相册);
    clearAlbumAssetObjectUrlCache();

    const active = await loadActiveLeaf();
    if (active.status !== 'ok') throw new Error('活跃叶子读取失败');
    const 地址 = 解析相册资源引用(active.leaf.相册, `asset:${assetId}`);
    expect(地址, '重新进入后解析不出图片地址').toBeTruthy();
  });

  it('插图记录（含锚点）随存档回来', async () => {
    const harness = await createGameStateHarness();
    await seedDefaultWorkspace();

    const { 历史, 相册 } = 建带图内容();
    await 保存插图结果(harness.state, 历史, 相册);
    clearAlbumAssetObjectUrlCache();

    const active = await loadActiveLeaf();
    if (active.status !== 'ok') throw new Error('活跃叶子读取失败');
    const 助手 = active.leaf.chatHistory?.find((项) => 项.id === 'msg_rt');
    expect(助手?.narrativeImages).toHaveLength(1);
    expect(助手?.narrativeImages?.[0].description).toBe('她推开了舱门。');
  });

  it('活跃叶子指针存在（不然写到了别处，重进就找不到）', async () => {
    const harness = await createGameStateHarness();
    await seedDefaultWorkspace();

    const { 历史, 相册 } = 建带图内容();
    await 保存插图结果(harness.state, 历史, 相册);

    // 读回来的叶子必须就是 newest 指向的那个。
    const newest = await loadNewestStory();
    const active = await loadActiveLeaf();
    expect(newest.headNodeId).toBeTruthy();
    expect(active.status).toBe('ok');
    if (active.status !== 'ok') return;
    expect(active.newest.headNodeId).toBe(newest.headNodeId);
    expect(active.leaf.chatHistory?.some((项) => 项.id === 'msg_rt')).toBe(true);
  });
});
