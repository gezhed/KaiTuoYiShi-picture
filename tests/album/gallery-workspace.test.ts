import { describe, expect, it } from 'vitest';
import { 创建空角色 } from '@/models/character';
import { 归一化NPC记录列表 } from '@/models/npc';
import { 创建相册资源引用 } from '@/utils/albumActions';
import { 计算挂载结果, 槽位键转目标 } from '@/utils/avatarActions';
import {
  buildAssetMap,
  buildCharacterLibraryRecords,
  buildImportedImageItem,
  buildVisibleCharacterEntries,
  classifySceneLibraryEntry,
  cleanupAlbumAssets,
  sortGalleryEntries,
  标题去后缀,
} from '@/components/features/GameSystems/album/galleryWorkspaceLogic';
import { albumAssetMapOf, makeAlbumAsset, makeAlbumEntry, registerAlbumCacheTeardown } from '../helpers/albumFixture';

registerAlbumCacheTeardown();

/** 一个旅人 + 一个伙伴 + 一张已归档头像的最小相册。 */
function 建设场景() {
  const traveler = { ...创建空角色(), 姓名: '开拓者' };
  // 故意用一个非原著角色名：原著角色会带内置头像候选，槽位计数就不唯一了。
  const [npc] = 归一化NPC记录列表([{ id: 'npc-easy', 姓名: '测试伙伴甲', 阶位: 'companion' }]);
  const asset = makeAlbumAsset({ id: 'asset-1', url: 'https://example.test/a.png' });
  const entry = makeAlbumEntry({
    id: 'album-1',
    assetId: 'asset-1',
    title: '测试伙伴甲 · 档案头像',
    targetType: 'npc',
    targetId: npc.id,
    slot: 'avatar_profile',
  });
  const album = { assets: [asset], entries: [entry], tasks: [] };
  return { traveler, npc, album };
}

describe('图库投影', () => {
  it('旅人永远排第一，伙伴带上已装槽位计数', () => {
    const { traveler, npc, album } = 建设场景();
    const records = buildCharacterLibraryRecords(traveler, [npc], album, buildAssetMap(album), true);

    expect(records[0].kind).toBe('traveler');
    expect(records[1].kind).toBe('npc');
    expect(records[1].name).toBe('测试伙伴甲');
    expect(records[1].resourceCount).toBe(1);
  });

  it('挂到档案槽位的头像会同时成为正文与手机头像的显示来源', () => {
    const { traveler, npc, album } = 建设场景();
    const 挂载后 = 计算挂载结果({ traveler, npcs: [npc] }, { kind: 'npc', npcId: npc.id, slot: '档案' }, 创建相册资源引用('asset-1'));

    const records = buildCharacterLibraryRecords(traveler, 挂载后.npcs, album, buildAssetMap(album), true);
    const 伙伴记录 = records.find((记录) => 记录.id === npc.id);
    // 与 `读取NPC头像` 同口径：正文/手机槽位没单独设时会回落到档案头像，
    // 因此三个头像槽位都算「正在显示这张图」，计数与界面看到的一致。
    expect(伙伴记录?.mountedCount).toBe(3);
    for (const 槽位 of ['avatar-profile', 'avatar-story', 'avatar-phone']) {
      expect(伙伴记录?.slots.find((项) => 项.key === 槽位)?.src).toBe('https://example.test/a.png');
    }
    expect(伙伴记录?.slots.find((项) => 项.key === 'portrait')?.src).toBeUndefined();
    expect(伙伴记录?.avatar).toBe('https://example.test/a.png');
  });

  it('老存档里没有 targetId 的条目按标题里的角色名归档', () => {
    const { traveler, npc } = 建设场景();
    const 无主条目 = makeAlbumEntry({
      id: 'album-legacy',
      assetId: 'asset-legacy',
      title: '测试伙伴甲的立绘',
      targetType: 'misc',
      targetId: undefined,
      slot: 'portrait',
    });
    const album = {
      assets: [makeAlbumAsset({ id: 'asset-legacy', url: 'https://example.test/legacy.png' })],
      entries: [无主条目],
      tasks: [],
    };

    const records = buildCharacterLibraryRecords(traveler, [npc], album, buildAssetMap(album), true);
    const 伙伴记录 = records.find((记录) => 记录.id === npc.id);
    expect(伙伴记录?.entries.map((项) => 项.entry.id)).toContain('album-legacy');
  });

  it('内置头像排在归档图片前面', () => {
    const 条目A = makeAlbumEntry({ id: 'album-new', assetId: 'asset-new', createdAt: 900 });
    const 条目B = makeAlbumEntry({ id: 'album-old', assetId: 'asset-old', createdAt: 100 });
    const 排序后 = sortGalleryEntries([
      { entry: 条目A, src: 'a' },
      { entry: { ...条目B, id: 'builtin-avatar:npc-1:x' }, src: 'b' },
      { entry: 条目B, src: 'c' },
    ]);

    expect(排序后[0].entry.id.startsWith('builtin-avatar:')).toBe(true);
    expect(排序后[1].entry.id).toBe('album-new');
    expect(排序后[2].entry.id).toBe('album-old');
  });

  it('场景分类认得标签、槽位与备注', () => {
    expect(classifySceneLibraryEntry(makeAlbumEntry({ id: 's1', assetId: 'a', slot: 'scene', targetType: 'scene' }))).toBe('scene');
    expect(classifySceneLibraryEntry(makeAlbumEntry({ id: 's2', assetId: 'a', slot: 'phone_wallpaper', targetType: 'phone' }))).toBe('phone');
    expect(classifySceneLibraryEntry(makeAlbumEntry({ id: 's3', assetId: 'a', tags: ['正文插图'], slot: 'misc' }))).toBe('snapshot');
    expect(classifySceneLibraryEntry(makeAlbumEntry({ id: 's4', assetId: 'a', targetType: 'misc', slot: 'misc' }))).toBeNull();
  });

  it('删掉条目之后回收没有引用的资源', () => {
    const 保留 = makeAlbumAsset({ id: 'asset-keep', url: 'https://example.test/keep.png' });
    const 孤立 = makeAlbumAsset({ id: 'asset-orphan', url: 'https://example.test/orphan.png' });
    const album = {
      assets: [保留, 孤立],
      entries: [makeAlbumEntry({ id: 'album-keep', assetId: 'asset-keep' })],
      tasks: [],
    };

    const 清理后 = cleanupAlbumAssets(album);
    expect(清理后.assets.map((资源) => 资源.id)).toEqual(['asset-keep']);
  });
});

describe('本地图片导入', () => {
  it('归属绑到目标角色，保证不会出现在每个角色的图库列表里', () => {
    const { traveler, npc, album } = 建设场景();
    const 条目 = buildImportedImageItem({
      数据地址: 'data:image/png;base64,AAAA',
      文件名: 'my-avatar.png',
      归属: { id: npc.id, kind: 'npc', name: npc.姓名 },
    });
    const 导入后 = { ...album, assets: [条目.asset, ...album.assets], entries: [条目.entry, ...album.entries] };

    const records = buildCharacterLibraryRecords(traveler, [npc], 导入后, buildAssetMap(导入后), true);
    const 伙伴记录 = records.find((记录) => 记录.id === npc.id);
    const 旅人记录 = records.find((记录) => 记录.id === 'traveler');
    expect(伙伴记录?.entries.map((项) => 项.entry.id)).toContain(条目.entry.id);
    expect(旅人记录?.entries.map((项) => 项.entry.id)).not.toContain(条目.entry.id);
  });

  it('旅人导入写 traveler 归属与档案头像槽位', () => {
    const 条目 = buildImportedImageItem({
      数据地址: 'data:image/png;base64,AAAA',
      文件名: '旅人.png',
      归属: { id: 'traveler', kind: 'traveler' },
    });

    expect(条目.entry.targetType).toBe('traveler');
    expect(条目.entry.targetId).toBe('traveler');
    expect(条目.entry.slot).toBe('avatar_profile');
    expect(条目.asset.source).toBe('upload');
    expect(条目.entry.tags).toContain('本地导入');
  });

  it('标题取文件名去扩展名，空名字有兜底', () => {
    expect(标题去后缀('头像-01.webp')).toBe('头像-01');
    expect(标题去后缀('   ')).toBe('本地导入');
    const 兜底 = buildImportedImageItem({
      数据地址: 'data:image/png;base64,AAAA',
      归属: { id: 'traveler', kind: 'traveler' },
    });
    expect(兜底.entry.title).toBe('本地导入');
  });
});

describe('槽位键映射', () => {
  it('旅人的四类槽位各自映射到模型里的槽位名', () => {
    expect(槽位键转目标('traveler', 'avatar-profile')).toEqual({ kind: 'traveler', slot: '头像' });
    expect(槽位键转目标('traveler', 'avatar-story')).toEqual({ kind: 'traveler', slot: '正文头像' });
    expect(槽位键转目标('traveler', 'avatar-phone')).toEqual({ kind: 'traveler', slot: '手机头像' });
    expect(槽位键转目标('traveler', 'portrait')).toEqual({ kind: 'traveler', slot: '立绘' });
  });

  it('伙伴的槽位键带上角色 id', () => {
    expect(槽位键转目标('npc-easy', 'avatar-story')).toEqual({ kind: 'npc', npcId: 'npc-easy', slot: '正文' });
    expect(槽位键转目标('npc-easy', 'portrait')).toEqual({ kind: 'npc', npcId: 'npc-easy', slot: '立绘' });
  });
});

describe('图库可见条目', () => {
  it('把内置头像与归档条目合并去重', () => {
    const { traveler, npc, album } = 建设场景();
    const record = buildCharacterLibraryRecords(traveler, [npc], album, buildAssetMap(album), true)
      .find((项) => 项.id === npc.id);
    const 内置条目 = {
      entry: makeAlbumEntry({ id: 'builtin-avatar:npc-easy:01', assetId: 'asset-builtin', targetId: npc.id }),
      src: 'https://example.test/builtin.png',
    };
    const 可见 = buildVisibleCharacterEntries(
      record ? { ...record, entries: [...record.entries, 内置条目, 内置条目] } : null,
      record?.entries ?? [],
      album,
    );

    const ids = 可见.map((项) => 项.entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('album-1');
  });

  it('没有选中角色时返回空列表', () => {
    expect(buildVisibleCharacterEntries(null, [], { assets: [], entries: [], tasks: [] })).toEqual([]);
  });

  it('资源查找表按 id 建索引', () => {
    const { album } = 建设场景();
    const map = buildAssetMap(album);
    expect(map.get('asset-1')?.url).toBe('https://example.test/a.png');
    // 兼容旧测试工具构造的查找表形状。
    expect(albumAssetMapOf(album.assets).get('asset-1')?.url).toBe('https://example.test/a.png');
  });
});
