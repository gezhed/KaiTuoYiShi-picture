import { describe, expect, it } from 'vitest';
import { 处理跳过节点, 解析种子, 规范化反斜杠路径, 生成随机种子, 未选择模型 } from '@/services/ai/imageGen/comfyEngine';
import type { ComfyUI工作流 } from '@/services/ai/imageGen/types';

describe('解析种子', () => {
  it('0 / -1 / 非有限值都视为随机', () => {
    for (const 输入 of [0, -1, '0', '-1', '', 'abc', Number.NaN]) {
      const 结果 = 解析种子(输入 as number | string);
      expect(Number.isFinite(结果)).toBe(true);
      expect(结果).toBeGreaterThanOrEqual(0);
      expect(结果).toBeLessThan(1e10);
    }
  });

  it('正整数原样取整', () => {
    expect(解析种子(12345)).toBe(12345);
    expect(解析种子('987')).toBe(987);
    expect(解析种子(42.9)).toBe(42);
  });

  it('随机种子落在 [0, 1e10)', () => {
    for (let i = 0; i < 20; i += 1) {
      const 结果 = 生成随机种子();
      expect(结果).toBeGreaterThanOrEqual(0);
      expect(结果).toBeLessThan(1e10);
    }
  });
});

describe('规范化反斜杠路径', () => {
  it('把连续反斜杠压成单个', () => {
    expect(规范化反斜杠路径('a\\\\b')).toBe('a\\b');
    expect(规范化反斜杠路径('a\\b')).toBe('a\\b');
    expect(规范化反斜杠路径('normal.safetensors')).toBe('normal.safetensors');
  });
});

describe('处理跳过节点', () => {
  it('没有 _skip 时只清理标记，不改连接', () => {
    const 工作流: ComfyUI工作流 = {
      1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'a' } },
      2: { class_type: 'KSampler', inputs: { model: ['1', 0] } },
    };
    const 结果 = 处理跳过节点(工作流);
    expect(结果[1]._skip).toBeUndefined();
    expect(结果[2].inputs?.model).toEqual(['1', 0]);
  });

  it('删除被跳过节点并把下游接到它的上游', () => {
    const 工作流: ComfyUI工作流 = {
      1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'a' } },
      2: { class_type: 'LoraLoader', inputs: { model: ['1', 0] }, _skip: true },
      3: { class_type: 'KSampler', inputs: { model: ['2', 0] } },
    };
    const 结果 = 处理跳过节点(工作流);
    expect(结果[2]).toBeUndefined();
    expect(结果[3].inputs?.model).toEqual(['1', 0]);
  });

  it('连续多个跳过节点沿链一路上溯', () => {
    const 工作流: ComfyUI工作流 = {
      1: { class_type: 'A', inputs: { x: 'a' } },
      2: { class_type: 'B', inputs: { x: ['1', 0] }, _skip: true },
      3: { class_type: 'C', inputs: { x: ['2', 1] }, _skip: true },
      4: { class_type: 'D', inputs: { x: ['3', 0] } },
    };
    const 结果 = 处理跳过节点(工作流);
    expect(结果[4].inputs?.x).toEqual(['1', 0]);
  });

  it('跳过链成环时保留原连接而不死循环', () => {
    const 工作流: ComfyUI工作流 = {
      1: { class_type: 'A', inputs: { x: ['2', 0] }, _skip: true },
      2: { class_type: 'B', inputs: { x: ['1', 0] }, _skip: true },
      3: { class_type: 'C', inputs: { x: ['1', 0] } },
    };
    const 结果 = 处理跳过节点(工作流);
    expect(结果[3].inputs?.x).toEqual(['1', 0]);
  });

  it('objectInfo 可用时改接同类型的旁路上游', () => {
    const 工作流: ComfyUI工作流 = {
      1: { class_type: 'SaveImage', inputs: { images: ['2', 0] }, _skip: true },
      2: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 0] }, _skip: true },
      3: { class_type: 'KSampler', inputs: { latent_image: ['5', 0] } },
      4: { class_type: 'VAELoader', inputs: { vae_name: 'v' } },
      5: { class_type: 'EmptyLatentImage', inputs: { width: 512 } },
    };
    const objectInfo = {
      VAELoader: { input: { required: { vae_name: [['v.safetensors']] } } },
      KSampler: { input: { required: { latent_image: ['LATENT'] } } },
      EmptyLatentImage: { input: { required: { width: ['INT'] } } },
    };
    const 结果 = 处理跳过节点(工作流, objectInfo);
    expect(结果[2]).toBeUndefined();
    expect(结果[1]).toBeUndefined();
    expect(结果[3]).toBeDefined();
  });

  it('未选择模型哨兵值保持来源文案', () => {
    expect(未选择模型).toBe('连接后选择');
  });
});
