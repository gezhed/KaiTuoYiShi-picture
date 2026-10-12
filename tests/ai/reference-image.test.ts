import { describe, expect, it, vi } from 'vitest';
import {
  选参考图,
  描述参考图,
  数据地址转Blob,
  预告参考图,
} from '@/services/ai/imageGen/referenceImage';
import type { 角色卡, 角色媒体 } from '@/models/genSystem';

function 建媒体(id: string, 用途: 角色媒体['用途'], name = id): 角色媒体 {
  return { id, name, 用途 };
}

function 建角色(覆盖: Partial<角色卡> = {}): 角色卡 {
  return {
    id: 'c1',
    enabled: true,
    aliases: [],
    outfits: [],
    selectedOutfitId: '',
    photoMedia: [],
    audioMedia: [],
    selectedPhotoId: '',
    selectedAudioId: '',
    photoPrompt: '',
    sendPhoto: false,
    位置: null,
    createdAt: 0,
    updatedAt: 0,
    nameCN: '流萤',
    nameEN: '',
    characterTraits: '',
    facialFeatures: '',
    facialFeaturesBack: '',
    upperBodySFW: '',
    upperBodySFWBack: '',
    fullBodySFW: '',
    fullBodySFWBack: '',
    upperBodyNSFW: '',
    upperBodyNSFWBack: '',
    fullBodyNSFW: '',
    fullBodyNSFWBack: '',
    negative: '',
    ...覆盖,
  };
}

describe('选参考图', () => {
  it('没有角色或没有媒体时返回 null', () => {
    expect(选参考图(undefined)).toBeNull();
    expect(选参考图(建角色())).toBeNull();
  });

  it('显式指定的媒体 id 优先', () => {
    const 角色 = 建角色({
      photoMedia: [建媒体('a', 'photo'), 建媒体('b', 'reference')],
      selectedPhotoId: 'a',
    });
    expect(选参考图(角色, 'b')?.媒体Id).toBe('b');
  });

  it('显式 id 不存在时退回后续优先级，而不是返回 null', () => {
    const 角色 = 建角色({
      photoMedia: [建媒体('a', 'photo')],
    });
    expect(选参考图(角色, '不存在')?.媒体Id).toBe('a');
  });

  it('其次取角色卡勾选的 selectedPhotoId', () => {
    const 角色 = 建角色({
      photoMedia: [建媒体('a', 'reference'), 建媒体('b', 'photo')],
      selectedPhotoId: 'b',
    });
    expect(选参考图(角色)?.媒体Id).toBe('b');
  });

  it('再取第一张用途为 reference 的媒体', () => {
    const 角色 = 建角色({
      photoMedia: [建媒体('p', 'photo'), 建媒体('r1', 'reference'), 建媒体('r2', 'reference')],
    });
    expect(选参考图(角色)?.媒体Id).toBe('r1');
  });

  it('最后退回第一张非音频媒体', () => {
    const 角色 = 建角色({ photoMedia: [建媒体('p1', 'photo'), 建媒体('p2', 'photo')] });
    expect(选参考图(角色)?.媒体Id).toBe('p1');
  });

  it('音频永远不会被选为参考图', () => {
    const 角色 = 建角色({
      audioMedia: [建媒体('a1', 'audio')],
    });
    expect(选参考图(角色)).toBeNull();
    // 有图时也不取音频。
    const 有图 = 建角色({
      photoMedia: [建媒体('p', 'photo')],
      audioMedia: [建媒体('a1', 'audio')],
    });
    expect(选参考图(有图)?.媒体Id).toBe('p');
  });

  it('显式指定音频 id 时也不会采纳', () => {
    const 角色 = 建角色({
      photoMedia: [建媒体('p', 'photo')],
      audioMedia: [建媒体('a1', 'audio')],
    });
    expect(选参考图(角色, 'a1')?.媒体Id).toBe('p');
  });

  it('空白 id 视为未指定', () => {
    const 角色 = 建角色({ photoMedia: [建媒体('p', 'photo')] });
    expect(选参考图(角色, '   ')?.媒体Id).toBe('p');
    expect(选参考图(角色, '')?.媒体Id).toBe('p');
  });

  it('带出媒体名称供界面展示', () => {
    const 角色 = 建角色({ photoMedia: [建媒体('p', 'photo', '正面参考.png')] });
    expect(选参考图(角色)?.名称).toBe('正面参考.png');
  });
});

describe('预告参考图', () => {
  function 建设置(覆盖: {
    参考图上传?: boolean;
    角色卡?: Record<string, 角色卡>;
    角色启用列表?: string[];
  }) {
    return {
      comfyui: { 参考图上传: 覆盖.参考图上传 ?? true },
      角色卡: 覆盖.角色卡 ?? {},
      角色启用列表: 覆盖.角色启用列表 ?? [],
    } as unknown as import('@/models/genSystem').文生图系统设置;
  }

  it('开关关闭时明说已关闭，且 enabled 为 false', () => {
    const 预告 = 预告参考图(建设置({ 参考图上传: false }));
    expect(预告.available).toBe(false);
    expect(预告.enabled).toBe(false);
    expect(预告.说明).toContain('已关闭');
  });

  it('开关开启但没有带图角色时给出可操作提示', () => {
    const 预告 = 预告参考图(建设置({ 角色卡: { c1: 建角色({ id: 'c1' }) } }));
    expect(预告.available).toBe(false);
    expect(预告.enabled).toBe(true);
    expect(预告.说明).toContain('还没有任何角色带图片');
  });

  it('有带图角色时报出角色名与媒体名', () => {
    const 角色 = 建角色({
      id: 'c1',
      nameCN: '流萤',
      photoMedia: [建媒体('m1', 'reference', '正面.png')],
    });
    const 预告 = 预告参考图(建设置({ 角色卡: { c1: 角色 }, 角色启用列表: ['c1'] }));
    expect(预告.available).toBe(true);
    expect(预告.角色名).toBe('流萤');
    expect(预告.媒体名).toBe('正面.png');
    expect(预告.说明).toContain('流萤');
    expect(预告.说明).toContain('正面.png');
  });

  it('只有音频的角色不算「有图」', () => {
    const 角色 = 建角色({ id: 'c1', audioMedia: [建媒体('a1', 'audio')] });
    const 预告 = 预告参考图(建设置({ 角色卡: { c1: 角色 }, 角色启用列表: ['c1'] }));
    expect(预告.available).toBe(false);
  });

  it('启用列表里的角色优先于未启用的', () => {
    const 未启用 = 建角色({ id: 'x', nameCN: '未启用角色', photoMedia: [建媒体('mx', 'reference', 'x.png')] });
    const 启用 = 建角色({ id: 'y', nameCN: '启用角色', photoMedia: [建媒体('my', 'reference', 'y.png')] });
    const 预告 = 预告参考图(建设置({
      角色卡: { x: 未启用, y: 启用 },
      角色启用列表: ['y'],
    }));
    expect(预告.角色名).toBe('启用角色');
  });
});

describe('描述参考图', () => {
  it('有参考图时带上名称', () => {
    expect(描述参考图('流萤', { 媒体Id: 'x', 名称: '正面.png' }))
      .toBe('流萤：使用参考图「正面.png」');
  });

  it('没有参考图时明说未指定', () => {
    expect(描述参考图('流萤', null)).toBe('流萤：未指定参考图');
  });

  it('角色名为空时用「角色」兜底', () => {
    expect(描述参考图('', { 媒体Id: 'x', 名称: 'a.png' })).toContain('角色：');
  });
});

describe('数据地址转Blob', () => {
  it('把 data URL 转成 Blob', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })));
    const blob = await 数据地址转Blob('data:image/png;base64,AQID');
    expect(blob.size).toBe(3);
    vi.unstubAllGlobals();
  });

  it('响应非 200 时报出可读错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(数据地址转Blob('data:image/png;base64,AQID')).rejects.toThrow(/HTTP 404/);
    vi.unstubAllGlobals();
  });

  it('内容为空时报错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([]), { status: 200 })));
    await expect(数据地址转Blob('data:image/png;base64,')).rejects.toThrow(/内容为空/);
    vi.unstubAllGlobals();
  });
});
