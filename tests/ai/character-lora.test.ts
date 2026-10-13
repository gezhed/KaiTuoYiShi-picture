/**
 * 角色 LoRA：槽位收集 + 提交前把空槽摘掉。
 *
 * 用户要的是「不同角色用不同 LoRA 固定形象」。ComfyUI 侧不改工作流**结构**，
 * 只靠固定槽位（`%lora_name_1%`…）+ 空槽跳过 —— 这里把这两件事钉住。
 */
import { describe, expect, it } from 'vitest';
import { 创建空角色部位字段, 建LoRA条目, 归一化LoRA列表, 渲染LoRA标签, LoRA槽位数 } from '@/models/genSystem';
import type { 角色卡 } from '@/models/genSystem';
import { 取LoRA槽位, 统计LoRA超出数 } from '@/services/ai/imageGen/characterLora';
import { 标记未用LoRA槽, 处理跳过节点 } from '@/services/ai/imageGen/comfyEngine';
import { 组装单图提示词 } from '@/services/ai/imageGen/generateIllustration';
import { 创建默认文生图系统设置 } from '@/models/genSystem';
import type { ComfyUI工作流 } from '@/services/ai/imageGen/types';

function 建角色(id: string, LoRA?: Array<{ 名称: string; 权重: number }>): 角色卡 {
  return {
    ...创建空角色部位字段(),
    id,
    nameCN: id,
    nameEN: '',
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
    ...(LoRA ? { LoRA: LoRA.map((项) => ({ ...建LoRA条目(项.名称), 权重: 项.权重 })) } : {}),
  };
}

describe('归一化与文本标签', () => {
  it('丢空名、夹权重、补 id', () => {
    const 列表 = 归一化LoRA列表([
      { 名称: ' a.safetensors ', 权重: 9 },
      { 名称: '   ' },
      { name: 'b.safetensors', weight: -3 },
      '乱写',
    ]);
    expect(列表).toHaveLength(2);
    expect(列表[0]).toMatchObject({ 名称: 'a.safetensors', 权重: 2 });
    expect(列表[1]).toMatchObject({ 名称: 'b.safetensors', 权重: 0 });
    expect(列表[1].id).toBeTruthy();
  });

  it('渲染成 A1111 标签；整数权重不带小数点', () => {
    expect(渲染LoRA标签([
      { ...建LoRA条目('krea.safetensors'), 权重: 0.6 },
      { ...建LoRA条目('detail.safetensors'), 权重: 1 },
    ])).toBe('<lora:krea.safetensors:0.6>, <lora:detail.safetensors:1>');
    expect(渲染LoRA标签(undefined)).toBe('');
    expect(渲染LoRA标签([{ ...建LoRA条目('  '), 权重: 1 }])).toBe('');
  });
});

describe('取LoRA槽位', () => {
  it('按角色顺序摊平，并去重（同名只保留第一次）', () => {
    const 甲 = 建角色('甲', [{ 名称: 'shared.safetensors', 权重: 0.5 }]);
    const 乙 = 建角色('乙', [{ 名称: 'shared.safetensors', 权重: 1 }, { 名称: 'b.safetensors', 权重: 0.7 }]);
    const 槽位 = 取LoRA槽位([甲, 乙]);
    expect(槽位).toEqual([
      { 名称: 'shared.safetensors', 权重: 0.5 },
      { 名称: 'b.safetensors', 权重: 0.7 },
    ]);
  });

  it('上限是槽位数，超出的丢弃并可被统计出来', () => {
    const 多 = 建角色('多', [1, 2, 3, 4, 5, 6].map((序号) => ({ 名称: `l${序号}.safetensors`, 权重: 1 })));
    expect(取LoRA槽位([多])).toHaveLength(LoRA槽位数);
    expect(统计LoRA超出数([多])).toBe(2);
  });

  it('没配 LoRA / 未定义角色都不报错', () => {
    expect(取LoRA槽位([undefined, 建角色('甲')])).toEqual([]);
    expect(统计LoRA超出数([undefined])).toBe(0);
  });
});

describe('未用槽自动跳过', () => {
  /** Checkpoint → Lora1 → Lora2 → KSampler，两槽绑占位符。 */
  function 建链(): ComfyUI工作流 {
    return {
      1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'm.safetensors' } },
      2: { class_type: 'LoraLoader', inputs: { model: ['1', 0], clip: ['1', 1], lora_name: '%lora_name_1%', strength_model: '%lora_weight_1%', strength_clip: '%lora_weight_1%' } },
      3: { class_type: 'LoraLoader', inputs: { model: ['2', 0], clip: ['2', 1], lora_name: '%lora_name_2%', strength_model: '%lora_weight_2%', strength_clip: '%lora_weight_2%' } },
      4: { class_type: 'KSampler', inputs: { model: ['3', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['7', 0] } },
      5: { class_type: 'CLIPTextEncode', inputs: { clip: ['3', 1], text: '%prompt%' } },
      6: { class_type: 'CLIPTextEncode', inputs: { clip: ['3', 1], text: '%negative_prompt%' } },
      7: { class_type: 'EmptyLatentImage', inputs: { width: '%width%', height: '%height%' } },
    };
  }

  it('只有 1 个 LoRA 时，第 2 槽的节点被标跳过并接到上游', () => {
    const 工作流 = 建链();
    const 改动 = 标记未用LoRA槽(工作流, [{ 名称: 'a.safetensors' }]);
    expect(改动).toBe(true);
    expect(工作流['2']._skip).toBeUndefined();
    expect(工作流['3']._skip).toBe(true);

    const 处理后 = 处理跳过节点(工作流);
    expect(处理后['3']).toBeUndefined();
    // 下游应接到存活的那个 LoRA 节点（id 2），且**槽位要对**：
    // model → 0（MODEL），clip → 1（CLIP）。两路都接 0 会被 ComfyUI 判类型不符。
    expect(处理后['4'].inputs?.model).toEqual(['2', 0]);
    expect(处理后['5'].inputs?.clip).toEqual(['2', 1]);
    expect(处理后['6'].inputs?.clip).toEqual(['2', 1]);
  });

  it('两个槽都有值时不动结构', () => {
    const 工作流 = 建链();
    expect(标记未用LoRA槽(工作流, [{ 名称: 'a' }, { 名称: 'b' }])).toBe(false);
    expect(处理跳过节点(工作流)['3']).toBeDefined();
  });

  it('一个 LoRA 都没有时两槽都跳过，KSampler 直接接 Checkpoint', () => {
    const 工作流 = 建链();
    expect(标记未用LoRA槽(工作流, [])).toBe(true);
    const 处理后 = 处理跳过节点(工作流);
    expect(处理后['2']).toBeUndefined();
    expect(处理后['3']).toBeUndefined();
    expect(处理后['4'].inputs?.model).toEqual(['1', 0]);
    expect(处理后['5'].inputs?.clip).toEqual(['1', 1]);
  });

  it('没绑 LoRA 占位符的节点不受影响', () => {
    const 工作流: ComfyUI工作流 = {
      1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'm.safetensors' } },
      2: { class_type: 'LoraLoader', inputs: { lora_name: '写死.safetensors', model: ['1', 0] } },
    };
    expect(标记未用LoRA槽(工作流, [])).toBe(false);
    expect(工作流['2']._skip).toBeUndefined();
  });
});

describe('组装单图提示词：出场角色 → 槽位', () => {
  function 建设置(角色列表: 角色卡[]) {
    const 设置 = 创建默认文生图系统设置();
    设置.启用 = true;
    设置.角色卡 = Object.fromEntries(角色列表.map((角色) => [角色.id, 角色]));
    设置.角色启用列表 = 角色列表.map((角色) => 角色.id);
    // 角色替换需要预设存在（默认设置里就有「默认」）。
    return 设置;
  }

  it('$…$ 段里的角色带出 LoRA；没有 $…$ 时按名字命中兜底', async () => {
    const 甲 = 建角色('流萤', [{ 名称: 'krea.safetensors', 权重: 0.7 }]);
    甲.nameEN = 'firefly';
    const 设置 = 建设置([甲]);

    const 显式 = 组装单图提示词(设置, 'image###1girl, $流萤-sfw-upperbody$###', { 启用列表: ['流萤'], 全部角色: { 流萤: 甲 } });
    expect(显式.lora).toEqual([{ 名称: 'krea.safetensors', 权重: 0.7 }]);
    expect(显式.出场角色).toEqual(['流萤']);

    // 纯 tag、没有 $…$：靠英文名命中
    const 兜底 = 组装单图提示词(设置, 'image###1girl, firefly, smiling###', { 启用列表: ['流萤'], 全部角色: { 流萤: 甲 } });
    expect(兜底.lora).toEqual([{ 名称: 'krea.safetensors', 权重: 0.7 }]);
  });

  it('没出场的角色不占用槽位', async () => {
    const 甲 = 建角色('流萤', [{ 名称: 'a.safetensors', 权重: 1 }]);
    const 乙 = 建角色('三月七', [{ 名称: 'b.safetensors', 权重: 1 }]);
    const 设置 = 建设置([甲, 乙]);
    const 上下文 = { 启用列表: ['流萤', '三月七'], 全部角色: { 流萤: 甲, 三月七: 乙 } };
    const 结果 = 组装单图提示词(设置, 'image###1girl, $流萤-sfw-upperbody$###', 上下文);
    expect(结果.lora).toEqual([{ 名称: 'a.safetensors', 权重: 1 }]);
  });
});
