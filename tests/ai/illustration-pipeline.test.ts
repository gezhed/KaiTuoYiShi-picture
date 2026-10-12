import { describe, expect, it } from 'vitest';
import {
  解析插图锚点,
  锚点兜底提示词,
  生成正文插图,
  重生成单张插图,
  派生正文插槽,
  建提示词依赖,
  type 插图流水线依赖,
} from '@/services/ai/imageGen/illustrationPipeline';
import type { 叙事插图 } from '@/models/chat';
import type { 文生图系统设置 } from '@/models/genSystem';
import { 创建默认文生图系统设置 } from '@/models/genSystem';

function 建设置(改写?: (设置: 文生图系统设置) => void): 文生图系统设置 {
  const 设置 = 创建默认文生图系统设置();
  设置.启用 = true;
  设置.渠道 = 'comfyui';
  设置.正文配图.启用 = true;
  改写?.(设置);
  return 设置;
}

const 正文 = ['第一行：她抬起头。', '第二行：窗外的雨还在下。', '第三行：她转身离开。'].join('\n');

function 建依赖(覆盖: Partial<插图流水线依赖> = {}): {
  依赖: 插图流水线依赖;
  出图次数: () => number;
  归档次数: () => number;
} {
  let 出图计数 = 0;
  let 归档计数 = 0;
  const 依赖: 插图流水线依赖 = {
    生成提示词: async () => ({
      插图: [
        { regex: '窗外的雨还在下', tag: 'image###1girl, rain, 960x1280###' },
        { regex: '她转身离开', tag: 'image###1girl, leaving###' },
      ],
      原始回复: '<images>…</images>',
      重试次数: 0,
    }),
    出图: async ({ 提示词标记 }) => {
      出图计数 += 1;
      return {
        数据地址: `data:image/png;base64,${提示词标记.length}`,
        正向提示词: 'positive',
        负向提示词: 'negative',
        宽度: 960,
        高度: 1280,
      };
    },
    归档: async () => {
      归档计数 += 1;
      return { 数据地址: `asset:asset_${归档计数}` };
    },
    ...覆盖,
  };
  return { 依赖, 出图次数: () => 出图计数, 归档次数: () => 归档计数 };
}

describe('解析插图锚点', () => {
  it('把锚点行匹配成行索引并剥出尺寸', () => {
    const 结果 = 解析插图锚点(
      [
        { regex: '窗外的雨还在下', tag: 'image###1girl, 960x1280###' },
        { regex: '她转身离开', tag: 'image###solo###' },
      ],
      正文,
    );
    expect(结果).toHaveLength(2);
    expect(结果[0].锚点索引).toBe(1);
    expect(结果[0].宽度).toBe(960);
    expect(结果[0].高度).toBe(1280);
    expect(结果[1].锚点索引).toBe(2);
    expect(结果[1].宽度).toBeNull();
  });

  it('匹配不到的行索引为 -1 但仍然保留条目', () => {
    const 结果 = 解析插图锚点([{ regex: '完全不存在的一行', tag: 'image###A###' }], 正文);
    expect(结果[0].锚点索引).toBe(-1);
  });

  it('锚点被截断到末 40 字符', () => {
    const 长锚点 = '甲'.repeat(60);
    expect(解析插图锚点([{ regex: 长锚点, tag: 'image###A###' }], `前缀${长锚点}后缀`)[0].锚点).toHaveLength(40);
  });
});

describe('锚点兜底提示词', () => {
  it('拿锚点行当画面描述', () => {
    expect(锚点兜底提示词('她抬起头。')).toContain('她抬起头');
    // 只剥引号类标点，全角逗号不在此列（来源同样只处理引号）。
    expect(锚点兜底提示词('「雨」落下')).toBe('雨落下, anime style, detailed');
  });

  it('空锚点回退到通用描述', () => {
    expect(锚点兜底提示词('')).toBe('anime style illustration, detailed');
  });
});

describe('生成正文插图（一正文多图）', () => {
  it('两条 LLM 记录产出两张图，各自独立', async () => {
    const { 依赖, 出图次数 } = 建依赖();
    const 结果 = await 生成正文插图({ 消息Id: 'm1', 正文, 设置: 建设置(), 依赖 });
    expect(结果.插图).toHaveLength(2);
    expect(结果.成功数).toBe(2);
    expect(结果.失败数).toBe(0);
    expect(出图次数()).toBe(2);
  });

  it('每张图各自保留自己的描述锚点', async () => {
    const { 依赖 } = 建依赖();
    const 结果 = await 生成正文插图({ 消息Id: 'm1', 正文, 设置: 建设置(), 依赖 });
    expect(结果.插图[0].description).toBe('窗外的雨还在下');
    expect(结果.插图[1].description).toBe('她转身离开');
  });

  it('每轮上限截断图数', async () => {
    const { 依赖, 出图次数 } = 建依赖();
    const 结果 = await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置((项) => { 项.正文配图.每轮上限 = 1; }),
      依赖,
    });
    expect(结果.插图).toHaveLength(1);
    expect(出图次数()).toBe(1);
  });

  it('上限为 0 表示不限制', async () => {
    const { 依赖 } = 建依赖();
    const 结果 = await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置((项) => { 项.正文配图.每轮上限 = 0; }),
      依赖,
    });
    expect(结果.插图).toHaveLength(2);
  });

  it('单张出图失败不影响其它张', async () => {
    let 调用 = 0;
    const { 依赖 } = 建依赖({
      出图: async ({ 提示词标记 }) => {
        调用 += 1;
        if (调用 === 1) throw new Error('ComfyUI 服务器超时（已超过 30 分钟）。');
        return {
          数据地址: 'data:image/png;base64,ok',
          正向提示词: 'p',
          负向提示词: 'n',
          宽度: 1024,
          高度: 1024,
        };
      },
    });
    const 结果 = await 生成正文插图({ 消息Id: 'm1', 正文, 设置: 建设置(), 依赖 });
    expect(结果.成功数).toBe(1);
    expect(结果.失败数).toBe(1);
    expect(结果.插图[0].status).toBe('failed');
    expect(结果.插图[0].error).toContain('ComfyUI 服务器超时');
    expect(结果.插图[1].status).toBe('done');
  });

  it('提示词解析失败时返回空插图与诊断而不抛错', async () => {
    const 诊断 = { 原因: 'no_tags' as const, 文案: '回复里完全没有插图标记。', 原始回复: 'x' };
    const { 依赖, 出图次数 } = 建依赖({
      生成提示词: async () => ({ 插图: [], 原始回复: 'x', 重试次数: 2, 诊断 }),
    });
    const 结果 = await 生成正文插图({ 消息Id: 'm1', 正文, 设置: 建设置(), 依赖 });
    expect(结果.插图).toEqual([]);
    expect(结果.提示词诊断).toBe('回复里完全没有插图标记。');
    expect(出图次数()).toBe(0);
  });

  it('归档返回的引用会替换掉数据地址', async () => {
    const { 依赖 } = 建依赖();
    const 结果 = await 生成正文插图({ 消息Id: 'm1', 正文, 设置: 建设置(), 依赖 });
    expect(结果.插图[0].dataUrl).toMatch(/^asset:asset_/);
  });

  it('没有归档依赖时保留原始数据地址', async () => {
    const 依赖: 插图流水线依赖 = {
      生成提示词: async () => ({
        插图: [{ regex: '她转身离开', tag: 'image###A###' }],
        原始回复: 'x',
        重试次数: 0,
      }),
      出图: async () => ({
        数据地址: 'data:image/png;base64,raw',
        正向提示词: 'p',
        负向提示词: 'n',
        宽度: 512,
        高度: 512,
      }),
    };
    const 结果 = await 生成正文插图({ 消息Id: 'm1', 正文, 设置: 建设置(), 依赖 });
    expect(结果.插图[0].dataUrl).toBe('data:image/png;base64,raw');
  });

  it('中止信号会让循环提前退出', async () => {
    const controller = new AbortController();
    const { 依赖 } = 建依赖({
      出图: async () => {
        controller.abort();
        return {
          数据地址: 'data:image/png;base64,x',
          正向提示词: 'p',
          负向提示词: 'n',
          宽度: 1,
          高度: 1,
        };
      },
    });
    const 结果 = await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      依赖,
      signal: controller.signal,
    });
    expect(结果.插图).toHaveLength(1);
  });

  it('提示词标记为空时用锚点兜底，仍然出图', async () => {
    const 依赖: 插图流水线依赖 = {
      生成提示词: async () => ({
        插图: [{ regex: '她转身离开', tag: '' }],
        原始回复: 'x',
        重试次数: 0,
      }),
      出图: async ({ 提示词标记 }) => ({
        数据地址: `len:${提示词标记.length}`,
        正向提示词: 'p',
        负向提示词: 'n',
        宽度: 1,
        高度: 1,
      }),
    };
    const 结果 = await 生成正文插图({ 消息Id: 'm1', 正文, 设置: 建设置(), 依赖 });
    expect(结果.插图[0].status).toBe('done');
    expect(结果.插图[0].prompt).toContain('她转身离开');
  });
});

describe('只重新生成提示词（用户要求的能力）', () => {
  it('不调后端出图，只回报新提示词', async () => {
    const { 依赖, 出图次数 } = 建依赖();
    const 已有: 叙事插图[] = [
      { id: 'a', dataUrl: 'asset:old1', type: 'scene', prompt: 'image###旧词一###', description: '窗外的雨还在下', status: 'done' },
      { id: 'b', dataUrl: 'asset:old2', type: 'scene', prompt: 'image###旧词二###', description: '她转身离开', status: 'done' },
    ];
    const 结果 = await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      依赖,
      已有插图: 已有,
      只重新生成提示词: true,
    });
    expect(出图次数()).toBe(0);
    expect(结果.插图).toHaveLength(2);
    // 注意：标记里的尺寸文本已被剥掉。`剥出尺寸` 的语义是「文本一律去掉，
    // 宽高只在开启自主分辨率时才取」，所以这里不再保留 `960x1280`。
    // 分辨率仍在 `宽度/高度` 上产出，由调用方决定怎么用。
    expect(结果.插图[0].prompt).toBe('image###1girl, rain###');
    expect(结果.插图[1].prompt).toBe('image###1girl, leaving###');
  });

  it('保留原有图片地址，不丢已出好的图', async () => {
    const { 依赖 } = 建依赖();
    const 已有: 叙事插图[] = [
      { id: 'a', dataUrl: 'asset:keep_me', type: 'scene', prompt: 'image###旧###', description: '窗外的雨还在下', status: 'done' },
    ];
    const 结果 = await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      依赖,
      已有插图: 已有,
      只重新生成提示词: true,
    });
    expect(结果.插图[0].dataUrl).toBe('asset:keep_me');
    expect(结果.插图[0].status).toBe('done');
  });

  it('重跑后可以再正常出图（两步走）', async () => {
    const { 依赖, 出图次数 } = 建依赖();
    const 重跑 = await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      依赖,
      只重新生成提示词: true,
    });
    const 出图 = await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      依赖,
      已有插图: 重跑.插图,
    });
    expect(出图次数()).toBe(2);
    expect(出图.插图).toHaveLength(2);
  });
});

describe('重生成单张插图', () => {
  const 原图: 叙事插图 = {
    id: 'a',
    dataUrl: 'asset:old',
    type: 'scene',
    prompt: 'image###旧提示词###',
    description: '窗前',
    status: 'done',
  };

  it('用编辑后的提示词重出这一张', async () => {
    const { 依赖, 出图次数 } = 建依赖();
    const 结果 = await 重生成单张插图({ 插图: 原图, 新提示词正文: '1girl，solo', 依赖 });
    expect(出图次数()).toBe(1);
    expect(结果.status).toBe('done');
    expect(结果.prompt).toBe('image###1girl, solo###');
  });

  it('不传新提示词时沿用原标记', async () => {
    let 收到标记 = '';
    const { 依赖 } = 建依赖({
      出图: async ({ 提示词标记 }) => {
        收到标记 = 提示词标记;
        return { 数据地址: 'd', 正向提示词: 'p', 负向提示词: 'n', 宽度: 1, 高度: 1 };
      },
    });
    await 重生成单张插图({ 插图: 原图, 依赖 });
    expect(收到标记).toBe('image###旧提示词###');
  });

  it('显式尺寸覆盖提示词里的尺寸', async () => {
    let 收到尺寸: { 宽度: number; 高度: number } | null | undefined;
    const { 依赖 } = 建依赖({
      出图: async ({ 覆盖尺寸 }) => {
        收到尺寸 = 覆盖尺寸;
        return { 数据地址: 'd', 正向提示词: 'p', 负向提示词: 'n', 宽度: 1, 高度: 1 };
      },
    });
    await 重生成单张插图({ 插图: 原图, 覆盖尺寸: { 宽度: 512, 高度: 768 }, 依赖 });
    expect(收到尺寸).toEqual({ 宽度: 512, 高度: 768 });
  });

  it('失败时保留原记录并写入错误', async () => {
    const { 依赖 } = 建依赖({
      出图: async () => {
        throw new Error('跨域');
      },
    });
    const 结果 = await 重生成单张插图({ 插图: 原图, 依赖 });
    expect(结果.status).toBe('failed');
    expect(结果.error).toBe('跨域');
    expect(结果.id).toBe('a');
  });
});

describe('参考图透传', () => {
  it('逐张出图时把参考图传给每一次调用', async () => {
    const 收到: Array<{ 数据地址: string; 文件名: string } | null | undefined> = [];
    const { 依赖 } = 建依赖({
      出图: async ({ 参考图 }) => {
        收到.push(参考图);
        return { 数据地址: 'd', 正向提示词: 'p', 负向提示词: 'n', 宽度: 1, 高度: 1 };
      },
    });
    const 参考图 = { 数据地址: 'data:image/png;base64,AAAA', 文件名: 'ref.png' };
    await 生成正文插图({ 消息Id: 'm1', 正文, 设置: 建设置(), 依赖, 参考图 });
    expect(收到).toHaveLength(2);
    expect(收到[0]).toEqual(参考图);
    expect(收到[1]).toEqual(参考图);
  });

  it('不传参考图时每次调用都收到 undefined（不回退成上一张）', async () => {
    const 收到: Array<unknown> = [];
    const { 依赖 } = 建依赖({
      出图: async ({ 参考图 }) => {
        收到.push(参考图);
        return { 数据地址: 'd', 正向提示词: 'p', 负向提示词: 'n', 宽度: 1, 高度: 1 };
      },
    });
    await 生成正文插图({ 消息Id: 'm1', 正文, 设置: 建设置(), 依赖 });
    expect(收到.every((项) => 项 === undefined)).toBe(true);
  });

  it('单张重生也透传参考图', async () => {
    let 捕获: unknown = '未调用';
    const { 依赖 } = 建依赖({
      出图: async ({ 参考图 }) => {
        捕获 = 参考图;
        return { 数据地址: 'd', 正向提示词: 'p', 负向提示词: 'n', 宽度: 1, 高度: 1 };
      },
    });
    const 参考图 = { 数据地址: 'data:image/png;base64,BBBB', 文件名: 'x.png' };
    await 重生成单张插图({
      插图: {
        id: 'a',
        dataUrl: '',
        type: 'scene',
        prompt: 'image###旧###',
        description: '锚',
        status: 'done',
      },
      参考图,
      依赖,
    });
    expect(捕获).toEqual(参考图);
  });
});

describe('派生正文插槽', () => {
  it('按行索引排序并过滤未命中的锚点', () => {
    const 插槽 = 派生正文插槽([
      { 锚点: 'a', 锚点索引: 2, 提示词标记: 'A', 宽度: null, 高度: null },
      { 锚点: 'b', 锚点索引: -1, 提示词标记: 'B', 宽度: null, 高度: null },
      { 锚点: 'c', 锚点索引: 0, 提示词标记: 'C', 宽度: null, 高度: null },
    ]);
    expect(插槽).toEqual([
      { 行索引: 0, 插图索引: 2 },
      { 行索引: 2, 插图索引: 0 },
    ]);
  });
});

describe('建提示词依赖', () => {
  it('把调用包成生成提示词的形状并把正文传下去', async () => {
    let 捕获消息: Array<{ role: string; content: string }> = [];
    const 生成 = 建提示词依赖(async (消息) => {
      捕获消息 = 消息;
      return '<images><image>regex:锚点\nimage###A###</image></images>';
    });
    const 设置 = 建设置((项) => {
      项.LLM.预设列表['默认'] = {
        entries: [{
          id: 'e1',
          name: '系统',
          role: 'system',
          content: '正文={{正文}}',
          enabled: true,
          触发方式: 'always',
          触发词: [],
          与触发: false,
        }],
        createdAt: 0,
        updatedAt: 0,
      };
    });
    const 结果 = await 生成({ 正文: '她抬头', 设置 });
    expect(捕获消息[0].content).toBe('正文=她抬头');
    expect(结果.插图).toHaveLength(1);
  });
});
