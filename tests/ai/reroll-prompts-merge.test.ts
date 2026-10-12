// @vitest-environment jsdom
/**
 * 「重新生成本回合提示词」必须真的替换掉原提示词。
 *
 * 用户反馈：点了重新生成，提示词却没有替换。
 * 这里锁定合并语义 —— 新提示词必须覆盖旧的，而**图与锚点要保留**
 * （对提示词不满意不该连带丢掉已经出好的图）。
 */
import { describe, expect, it } from 'vitest';
import { 合并重跑提示词 } from '@/services/ai/imageGen/illustrationPipeline';
import type { 叙事插图 } from '@/models/chat';

function 建插图(补丁: Partial<叙事插图> = {}): 叙事插图 {
  return {
    id: 'n1',
    dataUrl: 'asset:asset_1',
    type: 'scene',
    kind: 'snapshot',
    prompt: 'image###旧提示词###',
    description: '她推开了舱门。',
    status: 'done',
    ...补丁,
  };
}

describe('合并重跑提示词', () => {
  it('新提示词覆盖旧提示词', () => {
    const 旧 = [建插图()];
    const 新 = [建插图({ prompt: 'image###新提示词###', description: '她推开了舱门。' })];
    const 合并 = 合并重跑提示词(旧, 新);
    expect(合并[0].prompt).toBe('image###新提示词###');
  });

  it('保留图片地址与状态（不该把已出好的图丢掉）', () => {
    const 旧 = [建插图({ dataUrl: 'asset:asset_keep', status: 'done' })];
    const 新 = [建插图({ prompt: 'image###新###', dataUrl: '' })];
    const 合并 = 合并重跑提示词(旧, 新);
    expect(合并[0].dataUrl).toBe('asset:asset_keep');
    expect(合并[0].status).toBe('done');
  });

  it('锚点变化时跟着更新（模型这次给的挂载点可能不同）', () => {
    const 旧 = [建插图({ description: '旧锚点' })];
    const 新 = [建插图({ prompt: 'image###新###', description: '新锚点' })];
    expect(合并重跑提示词(旧, 新)[0].description).toBe('新锚点');
  });

  it('新提示词为空时保留旧提示词，不清空', () => {
    const 旧 = [建插图({ prompt: 'image###旧###' })];
    const 新 = [建插图({ prompt: '' })];
    expect(合并重跑提示词(旧, 新)[0].prompt).toBe('image###旧###');
  });

  it('新结果比旧少时，多出来的旧记录原样保留（模型少给几条不等于删图）', () => {
    const 旧 = [建插图({ id: 'a' }), 建插图({ id: 'b' }), 建插图({ id: 'c' })];
    const 新 = [建插图({ id: 'x', prompt: 'image###新1###' })];
    const 合并 = 合并重跑提示词(旧, 新);
    expect(合并).toHaveLength(3);
    expect(合并[0].prompt).toBe('image###新1###');
    expect(合并[1].prompt).toBe('image###旧提示词###');
    expect(合并[2].prompt).toBe('image###旧提示词###');
  });

  it('逐张一一对应，不会把第二张的新提示词贴到第一张上', () => {
    const 旧 = [
      建插图({ id: 'a', prompt: 'image###旧A###', description: '锚点A' }),
      建插图({ id: 'b', prompt: 'image###旧B###', description: '锚点B' }),
    ];
    const 新 = [
      建插图({ id: 'x', prompt: 'image###新A###', description: '锚点A' }),
      建插图({ id: 'y', prompt: 'image###新B###', description: '锚点B' }),
    ];
    const 合并 = 合并重跑提示词(旧, 新);
    expect(合并[0].prompt).toBe('image###新A###');
    expect(合并[1].prompt).toBe('image###新B###');
    // id 必须保持旧值，否则界面上的卡片会整片重建、状态丢失。
    expect(合并.map((项) => 项.id)).toEqual(['a', 'b']);
  });

  it('旧数组为空时返回空数组，不抛错', () => {
    expect(合并重跑提示词([], [建插图()])).toEqual([]);
  });
});
