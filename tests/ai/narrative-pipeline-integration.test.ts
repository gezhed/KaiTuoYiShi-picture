// @vitest-environment jsdom
/**
 * 正文配图全链路集成测试。
 *
 * 从「LLM返回 XML」开始，一路走到「图插到正文的哪一行为止」：
 *   假 LLM XML → 剥外壳 → 逐张剥尺寸 → 建锚点 → 逐张出图 → 归档 → 行间插槽
 *
 * 这是用户最初提出的两个核心诉求所在的链路：
 *   ① 一个正文能配多张图；
 *   ② 每张图可以有各自的分辨率。
 * 分开看每段都有测试，但**拼起来**才知道「多张是否真的都出了、尺寸是否各归各的、
 * 锚点是否落在正确的行上」。
 */
import { describe, expect, it } from 'vitest';
import { 生成正文插图, 派生正文插槽, 建提示词依赖 } from '@/services/ai/imageGen/illustrationPipeline';
import { 创建默认文生图系统设置 } from '@/models/genSystem';
import type { 文生图系统设置 } from '@/models/genSystem';

const 正文 = [
  '雨还在下。',
  '她站在窗前，看着外面的街灯。',
  '然后她转过身来。',
  '“你来了。”她说。',
].join('\n');

/** LLM按上游方言返回的回复：两级 XML + heredoc 标记。 */
const LLM回复 = [
  '<images>',
  '<image>regex:她站在窗前\nimage###1girl, window, rain, 960x1280###</image>',
  '<image>regex:然后她转过身来\nimage###1girl, turning, 1024x1024###</image>',
  '</images>',
].join('\n');

function 建设置(补丁: Partial<文生图系统设置> = {}): 文生图系统设置 {
  const 设置 = 创建默认文生图系统设置();
  设置.启用 = true;
  设置.渠道 = 'comfyui';
  设置.图片缓存.启用 = false;
  设置.comfyui.自主分辨率 = true;
  // 默认LLM预设是**空的**（要用户自己导入社区预设）。这里给一条启用的 system 条目，
  // 否则 `构建LLM消息` 会直接抛「没有任何启用的条目」。
  设置.LLM.启用 = true;
  设置.LLM.预设列表.默认.entries = [{
    id: 'e1',
    name: '格式说明',
    role: 'system',
    content: '把正文转成插图提示词。',
    enabled: true,
    触发方式: 'always',
    触发词: [],
    与触发: false,
  }];
  Object.assign(设置, 补丁);
  return 设置;
}

interface 出图记录项 {
  提示词标记: string;
  宽度: number;
  高度: number;
}

/** 组装一份全链路依赖：提示词走假 LLM，出图按覆盖尺寸回填。 */
function 建全链路依赖(出图记录: 出图记录项[]) {
  return {
    // 注意 `建提示词依赖` 返回的就是 `生成提示词` 本身，不要再调一次。
    生成提示词: 建提示词依赖(async () => LLM回复),
    出图: async (参数: {
      提示词标记: string;
      覆盖尺寸?: { 宽度: number; 高度: number } | null;
      标题?: string;
    }) => {
      const 宽 = 参数.覆盖尺寸?.宽度 ?? 1024;
      const 高 = 参数.覆盖尺寸?.高度 ?? 1024;
      出图记录.push({ 提示词标记: 参数.提示词标记, 宽度: 宽, 高度: 高 });
      return {
        数据地址: `data:image/png;base64,图${出图记录.length}`,
        正向提示词: `正向${出图记录.length}`,
        负向提示词: '负向',
        宽度: 宽,
        高度: 高,
      };
    },
  };
}

/** 归档回调的实际签名（`插图.description` 是可选的）。 */
function 建归档收集(归档: Array<{ 标记: string; 宽度: number; 高度: number; 锚点索引: number }>) {
  return async (参数: {
    插图: { description?: string };
    提示词标记: string;
    锚点索引: number;
    宽度: number;
    高度: number;
  }) => {
    归档.push({
      标记: 参数.提示词标记,
      宽度: 参数.宽度,
      高度: 参数.高度,
      锚点索引: 参数.锚点索引,
    });
    return { 数据地址: `asset:${归档.length}` };
  };
}

describe('正文配图全链路', () => {
  it('一次回复产出多张图（一正文多图）', async () => {
    const 记录: 出图记录项[] = [];
    const 结果 = await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      依赖: 建全链路依赖(记录),
    });

    expect(结果.插图).toHaveLength(2);
    expect(结果.成功数).toBe(2);
    expect(记录).toHaveLength(2);
    // 两次出图用的提示词不同（各自那张的），不是同一张重复。
    expect(记录[0].提示词标记).not.toBe(记录[1].提示词标记);
    expect(记录[0].提示词标记).toContain('window');
    expect(记录[1].提示词标记).toContain('turning');
  });

  it('每张图用各自的分辨率出图（AI 自主分辨率）', async () => {
    const 记录: 出图记录项[] = [];
    await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      依赖: 建全链路依赖(记录),
    });
    expect(记录.map((项) => `${项.宽度}x${项.高度}`)).toEqual(['960x1280', '1024x1024']);
  });

  it('交给生图后端的提示词已剥掉尺寸（尺寸另走 覆盖尺寸）', async () => {
    const 记录: 出图记录项[] = [];
    await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      依赖: 建全链路依赖(记录),
    });
    for (const 项 of 记录) {
      expect(项.提示词标记, `尺寸残留：${项.提示词标记}`).not.toMatch(/\d{3,4}x\d{3,4}/);
    }
  });

  it('派生出的插槽让图落在正确的行下方，而不是堆在末尾', async () => {
    const 记录: 出图记录项[] = [];
    const 归档: Array<{ 标记: string; 宽度: number; 高度: number; 锚点索引: number }> = [];
    const 依赖 = { ...建全链路依赖(记录), 归档: 建归档收集(归档) };
    const 结果 = await 生成正文插图({ 消息Id: 'm1', 正文, 设置: 建设置(), 依赖 });

    // 归档时带的锚点索引：第 0 行是「雨还在下。」，所以命中行是 1 与 2。
    expect(归档.map((项) => 项.锚点索引)).toEqual([1, 2]);
    // 归档拿到的尺寸也是各归各的。
    expect(归档.map((项) => `${项.宽度}x${项.高度}`)).toEqual(['960x1280', '1024x1024']);

    const 插槽 = 派生正文插槽(结果.插图.map((项) => ({
      锚点: 项.description ?? '',
      锚点索引: 归档.find((甲) => 甲.标记 === 项.prompt)?.锚点索引 ?? -1,
      提示词标记: 项.prompt,
      宽度: null,
      高度: null,
    })));
    expect(插槽).toEqual([
      { 行索引: 1, 插图索引: 0 },
      { 行索引: 2, 插图索引: 1 },
    ]);
  });

  it('锚点保留LLM给出的原文，渲染期再按相似度找行', async () => {
    // 锚点不是从正文里截出来的「真实那一行」，而是LLM写的 regex/描述——
    // 渲染时靠 `匹配锚点行` 做模糊匹配。写死成正文原文会失去容错能力。
    const 记录: 出图记录项[] = [];
    const 结果 = await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      依赖: 建全链路依赖(记录),
    });
    expect(结果.插图[0].description).toBe('她站在窗前');
    expect(结果.插图[1].description).toBe('然后她转过身来');
  });

  it('每张图都归档，且带回可显示的地址', async () => {
    const 记录: 出图记录项[] = [];
    const 归档: Array<{ 标记: string; 宽度: number; 高度: number; 锚点索引: number }> = [];
    const 结果 = await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      依赖: { ...建全链路依赖(记录), 归档: 建归档收集(归档) },
    });
    expect(归档).toHaveLength(2);
    expect(结果.插图.map((项) => 项.dataUrl)).toEqual(['asset:1', 'asset:2']);
  });

  it('一张出图失败不影响另一张', async () => {
    const 记录: 出图记录项[] = [];
    const 基础 = 建全链路依赖(记录);
    let 序号 = 0;
    const 结果 = await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      依赖: {
        生成提示词: 基础.生成提示词,
        出图: async (参数: { 提示词标记: string; 覆盖尺寸?: { 宽度: number; 高度: number } | null }) => {
          序号 += 1;
          if (序号 === 1) throw new Error('第一张炸了');
          return 基础.出图(参数);
        },
      },
    });

    expect(结果.插图).toHaveLength(2);
    expect(结果.成功数).toBe(1);
    expect(结果.失败数).toBe(1);
    expect(结果.插图[0].status).not.toBe('done');
    expect(结果.插图[1].status).toBe('done');
  });

  it('每轮上限会截断张数', async () => {
    const 记录: 出图记录项[] = [];
    const 结果 = await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置({ 正文配图: { ...创建默认文生图系统设置().正文配图, 每轮上限: 1 } }),
      依赖: 建全链路依赖(记录),
    });
    expect(结果.插图).toHaveLength(1);
    expect(记录).toHaveLength(1);
  });

  it('只重新生成提示词时保留已出的图，不重新出图', async () => {
    const 记录: 出图记录项[] = [];
    const 已有 = [
      {
        id: 'a',
        dataUrl: 'asset:旧1',
        type: 'scene' as const,
        prompt: 'image###旧词一###',
        description: '她站在窗前，看着外面的街灯。',
        status: 'done' as const,
      },
      {
        id: 'b',
        dataUrl: 'asset:旧2',
        type: 'scene' as const,
        prompt: 'image###旧词二###',
        description: '然后她转过身来。',
        status: 'done' as const,
      },
    ];

    const 结果 = await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      已有插图: 已有,
      只重新生成提示词: true,
      依赖: 建全链路依赖(记录),
    });

    // 不出图，只换提示词。
    expect(记录).toHaveLength(0);
    expect(结果.成功数).toBe(0);
    expect(结果.插图).toHaveLength(2);
    expect(结果.插图[0].prompt).toContain('window');
    expect(结果.插图[1].prompt).toContain('turning');
    // 已出的图保留。
    expect(结果.插图[0].dataUrl).toBe('asset:旧1');
    expect(结果.插图[1].dataUrl).toBe('asset:旧2');
  });

  it('关闭 AI 自主分辨率时不取尺寸，改用渠道默认尺寸', async () => {
    const 记录: 出图记录项[] = [];
    await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置({
        comfyui: { ...创建默认文生图系统设置().comfyui, 自主分辨率: false },
      }),
      依赖: 建全链路依赖(记录),
    });
    // 开关关闭 → 不取宽高 → 覆盖尺寸为空 → 用渠道默认 1024x1024。
    expect(记录.map((项) => `${项.宽度}x${项.高度}`)).toEqual(['1024x1024', '1024x1024']);
  });

  it('尺寸文本一律从提示词里去掉，避免被后端画成字符', async () => {
    const 记录: 出图记录项[] = [];
    await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置({
        comfyui: { ...创建默认文生图系统设置().comfyui, 自主分辨率: false },
      }),
      依赖: 建全链路依赖(记录),
    });
    // `剥出尺寸` 的语义是「文本一律去掉，宽高只在开启时才取」——
    // 关闭自主分辨率只是不取尺寸，不代表把 `960x1280` 当画面内容发出去。
    for (const 项 of 记录) {
      expect(项.提示词标记).not.toMatch(/\d{3,4}x\d{3,4}/);
    }
  });
  it('参考图逐张传给每一次出图', async () => {
    const 收到: Array<unknown> = [];
    const 参考图 = { 数据地址: 'data:image/png;base64,参考', 文件名: 'r.png' };
    const 基础 = 建全链路依赖([]);
    await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      参考图,
      依赖: {
        生成提示词: 基础.生成提示词,
        出图: async (参数: { 参考图?: unknown; 覆盖尺寸?: { 宽度: number; 高度: number } | null }) => {
          收到.push(参数.参考图);
          return {
            数据地址: 'data:image/png;base64,x',
            正向提示词: 'p',
            负向提示词: 'n',
            宽度: 参数.覆盖尺寸?.宽度 ?? 1024,
            高度: 参数.覆盖尺寸?.高度 ?? 1024,
          };
        },
      },
    });
    expect(收到).toHaveLength(2);
    expect(收到[0]).toEqual(参考图);
    expect(收到[1]).toEqual(参考图);
  });

  it('LLM返回非 XML 时静默 0 张，但诊断文案可给可不给', async () => {
    const 记录: 出图记录项[] = [];
    const 基础 = 建全链路依赖(记录);
    const 结果 = await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      依赖: {
        ...基础,
        // 没有任何 <image> 记录时 `生成插图提示词` 不会产出诊断（诊断只在解析失败时给）。
        生成提示词: async () => ({ 插图: [], 原始回复: '模型没按格式回', 重试次数: 0 }),
      },
    });
    expect(结果.插图).toHaveLength(0);
    expect(结果.成功数).toBe(0);
    expect(结果.失败数).toBe(0);
  });
});
