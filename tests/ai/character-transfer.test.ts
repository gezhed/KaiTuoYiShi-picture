import { describe, expect, it } from 'vitest';
import type { 角色卡 } from '@/models/genSystem';
import {
  导出角色包,
  导入角色包,
  混淆Base64,
  解混淆Base64,
} from '@/services/ai/imageGen/characterTransfer';

function 建角色(覆盖: Partial<角色卡> = {}): 角色卡 {
  return {
    id: 'char_1',
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
    nameEN: 'Firefly',
    characterTraits: '银发少女（不该被混淆，与上游一致）',
    facialFeatures: 'green eyes',
    facialFeaturesBack: 'silver hair back',
    upperBodySFW: 'white coat',
    upperBodySFWBack: 'white coat back',
    fullBodySFW: 'black skirt',
    fullBodySFWBack: 'black skirt back',
    upperBodyNSFW: 'small breasts',
    upperBodyNSFWBack: 'bare back',
    fullBodyNSFW: 'slender legs',
    fullBodyNSFWBack: 'round ass',
    negative: 'bad hands（负面词同样不混淆）',
    ...覆盖,
  };
}

/** 记录每次保存调用的假媒体库。 */
function 建假媒体库() {
  const 记录: Array<{ 角色Id: string; blob: Blob; name: string; 用途: string }> = [];
  let 序号 = 0;
  return {
    记录,
    依赖: {
      保存媒体: (参数: { 角色Id: string; blob: Blob; name: string; 用途: 角色卡['photoMedia'][number]['用途'] }) => {
        序号 += 1;
        记录.push({ ...参数, 用途: 参数.用途 });
        return Promise.resolve(`new_media_${序号}`);
      },
    },
  };
}

describe('混淆 base64', () => {
  it('往返一致，且空串保持空串（与上游 L24705-L24722 行为一致）', () => {
    expect(解混淆Base64(混淆Base64('银色长发, green eyes'))).toBe('银色长发, green eyes');
    expect(混淆Base64('')).toBe('');
    expect(解混淆Base64('')).toBe('');
  });
});

describe('导出角色包', () => {
  it('默认混淆，且角色特征与负面词保持明文（照搬上游的字段表）', async () => {
    const 结果 = await 导出角色包({ 角色列表: [建角色()], 含媒体: false, 混淆: true });
    const 信封 = JSON.parse(结果.文本) as Record<string, unknown>;
    expect(信封._encrypted).toBe(true);
    expect(信封._version).toBe('1.0');
    expect(typeof 信封._nameMap).toBe('string');

    // 键被混淆成 base64，取值要走 _nameMap。
    const 映射 = JSON.parse(解混淆Base64(信封._nameMap as string)) as { characters: Record<string, string> };
    const 编码Id = Object.keys(映射.characters)[0];
    expect(映射.characters[编码Id]).toBe('char_1');
    const 记录 = (信封.characters as Record<string, Record<string, unknown>>)[编码Id];
    expect(解混淆Base64(记录.nameCN as string)).toBe('流萤');
    expect(记录.characterTraits).toBe('银发少女（不该被混淆，与上游一致）');
    expect(记录.negative).toBe('bad hands（负面词同样不混淆）');
  });

  it('服装被摊平到 outfits 表，卡上只留 id 数组（上游形状）', async () => {
    const 角色 = 建角色({
      outfits: [{
        id: 'o1', name: '战斗服', 上半身: 'battle top', 下半身: 'battle skirt', 全身: '', 负面: '',
        英文名称: 'battle suit', 上半身背面: 'battle top back', 下半身背面: 'battle skirt back',
      }],
    });
    const 结果 = await 导出角色包({ 角色列表: [角色], 含媒体: false, 混淆: false });
    const 信封 = JSON.parse(结果.文本) as Record<string, unknown>;
    expect((信封.characters as Record<string, 角色卡>).char_1.outfits).toEqual(['o1']);
    expect((信封.outfits as Record<string, unknown>).o1).toMatchObject({ name: '战斗服', 英文名称: 'battle suit' });
    expect(结果.服装数).toBe(1);
  });

  it('媒体字节以 dataURL 收进 images/audio，读不到时给警告', async () => {
    const 角色 = 建角色({
      photoMedia: [{ id: 'm1', name: '照片', 用途: 'photo' }, { id: 'm2', name: '缺字节', 用途: 'photo' }],
      selectedPhotoId: 'm1',
    });
    const 结果 = await 导出角色包({
      角色列表: [角色],
      混淆: false,
      依赖: { 读取媒体: (id: string) => Promise.resolve(id === 'm1' ? 'data:image/png;base64,AAAA' : '') },
    });
    const 信封 = JSON.parse(结果.文本) as Record<string, unknown>;
    expect((信封.images as Record<string, string>).m1).toBe('data:image/png;base64,AAAA');
    expect(结果.媒体数).toBe(1);
    expect(结果.警告.join('')).toContain('m2');
  });
});

describe('导入：本应用角色包', () => {
  it('导出 → 导入往返，字段与服装都还在（用新 id 重建）', async () => {
    const 角色 = 建角色({
      outfits: [{
        id: 'o1', name: '战斗服', 上半身: 'battle top', 下半身: 'battle skirt', 全身: '', 负面: '',
        英文名称: 'battle suit', 归属人: 'Firefly', 上半身背面: 'battle top back', 下半身背面: 'battle skirt back',
      }],
    });
    const 导出 = await 导出角色包({ 角色列表: [角色], 含媒体: false, 混淆: true });
    const 导入 = await 导入角色包(导出.文本, { 现有角色: {} });
    expect(导入.来源格式).toBe('kaituoyishi');
    expect(导入.新增).toBe(1);
    const 卡 = 导入.角色卡.char_1;
    expect(卡.nameCN).toBe('流萤');
    expect(卡.characterTraits).toBe('银发少女（不该被混淆，与上游一致）');
    expect(卡.negative).toBe('bad hands（负面词同样不混淆）');
    expect(卡.fullBodyNSFWBack).toBe('round ass');
    expect(卡.outfits).toHaveLength(1);
    expect(卡.outfits[0]).toMatchObject({
      id: 'o1', name: '战斗服', 上半身: 'battle top', 下半身: 'battle skirt',
      英文名称: 'battle suit', 归属人: 'Firefly', 上半身背面: 'battle top back', 下半身背面: 'battle skirt back',
    });
  });
});

describe('导入：上游（st-chatu8）角色包', () => {
  it('角色名做键、服装是独立表、字段名一致时能直接吃进来', async () => {
    const 信封 = {
      characters: {
        流萤: {
          nameCN: '流萤',
          nameEN: 'Firefly',
          facialFeatures: 'green eyes',
          upperBodySFW: 'white coat',
          outfits: ['o1'],
          photoMedia: [{ id: 'img1', kind: 'image', mimeType: 'image/png', fileName: '流萤.png', description: '' }],
          selectedPhotoId: 'img1',
        },
      },
      outfits: {
        o1: { nameCN: '战斗服', nameEN: 'battle suit', upperBody: 'battle top', upperBodyBack: 'battle top back', fullBody: 'battle skirt', fullBodyBack: 'battle skirt back' },
      },
      images: { img1: 'data:image/png;base64,AAAA' },
    };
    const 假库 = 建假媒体库();
    const 导入 = await 导入角色包(JSON.stringify(信封), { 现有角色: {}, 依赖: 假库.依赖 });
    expect(导入.来源格式).toBe('chatu8');
    expect(导入.新增).toBe(1);
    expect(导入.媒体数).toBe(1);
    expect(导入.服装数).toBe(1);
    expect(假库.记录[0]).toMatchObject({ 角色Id: '__import__', name: 'img1', 用途: 'photo' });

    const 卡 = Object.values(导入.角色卡)[0];
    expect(卡.nameCN).toBe('流萤');
    expect(卡.facialFeatures).toBe('green eyes');
    // 媒体换成了新 id，并且卡上的引用一起改掉。
    expect(卡.photoMedia[0].id).toBe('new_media_1');
    expect(卡.selectedPhotoId).toBe('new_media_1');
    expect(卡.outfits[0]).toMatchObject({
      name: '战斗服', 上半身: 'battle top', 下半身: 'battle skirt',
      上半身背面: 'battle top back', 下半身背面: 'battle skirt back',
    });
  });

  it('上游的混淆包也能解开（键与文本字段都是 base64）', async () => {
    const 明文 = {
      characters: { 流萤: { nameCN: '流萤', facialFeatures: 'green eyes', characterTraits: '银发（明文）', outfits: ['o1'] } },
      outfits: { o1: { nameCN: '战斗服', upperBody: 'battle top' } },
    };
    // 按上游 encryptExportData 的规则手工构造：键与文本字段都 base64，另存 _nameMap。
    const 编码 = (文本: string) => 混淆Base64(文本);
    const 信封 = {
      characters: {
        [编码('流萤')]: {
          nameCN: 编码('流萤'),
          facialFeatures: 编码('green eyes'),
          characterTraits: '银发（明文）',
          outfits: [编码('o1')],
        },
      },
      outfits: { [编码('o1')]: { nameCN: 编码('战斗服'), upperBody: 编码('battle top') } },
      _encrypted: true,
      _version: '1.0',
      _nameMap: 混淆Base64(JSON.stringify({ characters: { [编码('流萤')]: '流萤' }, outfits: { [编码('o1')]: 'o1' } })),
    };
    const 导入 = await 导入角色包(JSON.stringify(信封), { 现有角色: {} });
    expect(导入.新增).toBe(1);
    const 卡 = Object.values(导入.角色卡)[0];
    expect(卡.nameCN).toBe('流萤');
    expect(卡.facialFeatures).toBe('green eyes');
    expect(卡.characterTraits).toBe('银发（明文）');
    expect(卡.outfits[0]).toMatchObject({ name: '战斗服', 上半身: 'battle top' });
    void 明文;
  });
});

describe('导入：合并规则与旧格式', () => {
  it('接受本应用 v1 的 { 角色卡, 角色启用列表 } 形态', async () => {
    const 文本 = JSON.stringify({ 角色卡: { char_1: 建角色() }, 角色启用列表: ['char_1'] });
    const 导入 = await 导入角色包(文本, { 现有角色: {} });
    expect(导入.来源格式).toBe('legacy');
    expect(导入.新增).toBe(1);
    expect(导入.启用角色).toEqual(['char_1']);
  });

  it('同 id 覆盖，同名字也覆盖（并保留原有 id）', async () => {
    const 现有 = { char_old: 建角色({ id: 'char_old', nameCN: '流萤', facialFeatures: '旧五官' }) };
    const 文本 = JSON.stringify({
      characters: { 流萤: { nameCN: '流萤', facialFeatures: '新五官' } },
    });
    const 导入 = await 导入角色包(文本, { 现有角色: 现有 });
    expect(导入.新增).toBe(0);
    expect(导入.覆盖).toBe(1);
    expect(Object.keys(导入.角色卡)).toEqual(['char_old']);
    expect(导入.角色卡.char_old.facialFeatures).toBe('新五官');
  });

  it('既不撞 id 也不撞名字时新建', async () => {
    const 现有 = { char_a: 建角色({ id: 'char_a', nameCN: '三月七' }) };
    const 文本 = JSON.stringify({ characters: { char_b: { nameCN: '流萤' } } });
    const 导入 = await 导入角色包(文本, { 现有角色: 现有 });
    expect(导入.新增).toBe(1);
    expect(Object.keys(导入.角色卡).sort()).toEqual(['char_a', 'char_b']);
  });

  it('不是角色包时抛出可读错误', async () => {
    await expect(导入角色包('{"foo":1}', { 现有角色: {} })).rejects.toThrow('characters');
    await expect(导入角色包('不是 JSON', { 现有角色: {} })).rejects.toThrow('JSON');
  });
});
