import { describe, expect, it } from 'vitest';
import { 合并重跑提示词 } from '@/services/ai/imageGen/illustrationPipeline';
import type { 叙事插图 } from '@/models/chat';

function 建插图(覆盖: Partial<叙事插图> & { id: string }): 叙事插图 {
  return {
    dataUrl: `asset:${覆盖.id}`,
    type: 'scene',
    kind: 'snapshot',
    prompt: 'image###旧词###',
    description: '旧锚点',
    status: 'done',
    ...覆盖,
  };
}

describe('合并重跑提示词', () => {
  it('只换提示词与描述，保留图片地址与状态', () => {
    const 旧 = [建插图({ id: 'a', dataUrl: 'asset:keep_me', status: 'done' })];
    const 新 = [建插图({ id: 'x', prompt: 'image###新词###', description: '新锚点' })];
    const 结果 = 合并重跑提示词(旧, 新);
    expect(结果).toHaveLength(1);
    expect(结果[0].prompt).toBe('image###新词###');
    expect(结果[0].description).toBe('新锚点');
    // 关键：已经出好的图不能被丢掉，否则玩家一换提示词就白出了一轮。
    expect(结果[0].dataUrl).toBe('asset:keep_me');
    expect(结果[0].status).toBe('done');
    expect(结果[0].id).toBe('a');
  });

  it('逐张按序号对应，不影响其它张', () => {
    const 旧 = [
      建插图({ id: 'a', prompt: 'image###A旧###', dataUrl: 'asset:A' }),
      建插图({ id: 'b', prompt: 'image###B旧###', dataUrl: 'asset:B' }),
    ];
    const 新 = [
      建插图({ id: 'x', prompt: 'image###A新###' }),
      建插图({ id: 'y', prompt: 'image###B新###' }),
    ];
    const 结果 = 合并重跑提示词(旧, 新);
    expect(结果.map((项) => 项.prompt)).toEqual(['image###A新###', 'image###B新###']);
    expect(结果.map((项) => 项.dataUrl)).toEqual(['asset:A', 'asset:B']);
  });

  it('新结果更少时多出来的旧记录原样保留（少给几条不等于要删图）', () => {
    const 旧 = [
      建插图({ id: 'a', prompt: 'image###A旧###' }),
      建插图({ id: 'b', prompt: 'image###B旧###' }),
      建插图({ id: 'c', prompt: 'image###C旧###' }),
    ];
    const 新 = [建插图({ id: 'x', prompt: 'image###A新###' })];
    const 结果 = 合并重跑提示词(旧, 新);
    expect(结果).toHaveLength(3);
    expect(结果[0].prompt).toBe('image###A新###');
    expect(结果[1].prompt).toBe('image###B旧###');
    expect(结果[2].prompt).toBe('image###C旧###');
  });

  it('新提示词为空时回退旧提示词，不把记录清空', () => {
    const 旧 = [建插图({ id: 'a', prompt: 'image###保留###', description: '保留锚点' })];
    const 新 = [建插图({ id: 'x', prompt: '', description: '' })];
    const 结果 = 合并重跑提示词(旧, 新);
    expect(结果[0].prompt).toBe('image###保留###');
    expect(结果[0].description).toBe('保留锚点');
  });

  it('旧记录为空时返回空数组', () => {
    expect(合并重跑提示词([], [建插图({ id: 'x' })])).toEqual([]);
  });

  it('失败的旧记录也会被换上新提示词', () => {
    const 旧 = [建插图({ id: 'a', status: 'failed', error: '超时', dataUrl: '' })];
    const 新 = [建插图({ id: 'x', prompt: 'image###新###' })];
    const 结果 = 合并重跑提示词(旧, 新);
    expect(结果[0].prompt).toBe('image###新###');
    expect(结果[0].status).toBe('failed');
    expect(结果[0].error).toBe('超时');
  });
});
