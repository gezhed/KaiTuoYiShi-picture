/**
 * 正文生图的「正在生成」反馈。
 *
 * 用户反馈：正文生成图片时没有提示，可能会多次点击。两条链路各缺一半：
 *   · 单张重生（卡片上的「重新生成」图标）：点下去到写回之间**什么都看不到**，
 *     按钮一直可点（点几次出几张）；
 *   · 自动配图：整段跑完才写回消息，中间界面上完全没有反馈。
 *
 * 这里锁住三件事：
 *   ① 流水线把「写提示词 / 逐张出图（i/N）」两个阶段报出来；
 *   ② 单张重生时那张图立刻变 `generating`（卡片换成无按钮的占位），失败能还原；
 *   ③ 队列任务上的 `阶段` 会被回合动作视图读走（界面据此换文案）。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  生成正文插图,
  type 插图流水线依赖,
  type 插图进度,
} from '@/services/ai/imageGen/illustrationPipeline';
import {
  标记插图失败,
  标记插图为生成中,
} from '@/hooks/useGame/illustrationWorkflow';
import { 派生回合动作视图 } from '@/hooks/useGame/turnActionRuntime';
import type { 队列任务记录 } from '@/models/queueTask';
import type { 聊天消息, 叙事插图 } from '@/models/chat';
import { 创建默认文生图系统设置 } from '@/models/genSystem';

const 正文 = '她推开舱门。\n雨落下来。';

function 建依赖(记录: 插图进度[], 出图数 = 2): 插图流水线依赖 {
  return {
    生成提示词: async () => ({
      插图: Array.from({ length: 出图数 }, (_, i) => ({
        regex: `第${i}行`,
        tag: `image###p${i}###`,
      })),
      原始回复: '<images></images>',
      重试次数: 0,
    }),
    出图: async ({ 提示词标记 }) => ({
      数据地址: `data:image/png;base64,${提示词标记}`,
      正向提示词: 'a',
      负向提示词: 'b',
      宽度: 512,
      高度: 512,
    }),
    on进度: (事件) => 记录.push(事件),
  };
}

function 建设置() {
  const 设置 = 创建默认文生图系统设置();
  设置.启用 = true;
  设置.正文配图 = { ...设置.正文配图, 启用: true, 模式: 'manual' };
  return 设置;
}

describe('流水线报进度', () => {
  it('先报提示词，再报 0/N 与每张完成', async () => {
    const 记录: 插图进度[] = [];
    await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      依赖: 建依赖(记录, 2),
    });
    expect(记录[0]).toEqual({ 阶段: '提示词' });
    const 出图事件 = 记录.filter((项) => 项.阶段 === '出图');
    expect(出图事件[0]).toEqual({ 阶段: '出图', 完成数: 0, 总数: 2 });
    expect(出图事件.at(-1)).toEqual({ 阶段: '出图', 完成数: 2, 总数: 2 });
    expect(出图事件.map((项) => 项.完成数)).toEqual([0, 1, 2]);
  });

  it('某张失败也算完成，进度不会永远停在 N-1', async () => {
    const 记录: 插图进度[] = [];
    const 依赖 = 建依赖(记录, 2);
    依赖.出图 = async () => {
      throw new Error('工作流校验失败');
    };
    await 生成正文插图({ 消息Id: 'm1', 正文, 设置: 建设置(), 依赖 });
    expect(记录.filter((项) => 项.阶段 === '出图').at(-1)).toEqual({ 阶段: '出图', 完成数: 2, 总数: 2 });
  });

  it('只重跑提示词时只报提示词阶段（不出图）', async () => {
    const 记录: 插图进度[] = [];
    await 生成正文插图({
      消息Id: 'm1',
      正文,
      设置: 建设置(),
      依赖: 建依赖(记录, 2),
      已有插图: [建插图('a'), 建插图('b')],
      只重新生成提示词: true,
    });
    expect(记录).toEqual([{ 阶段: '提示词' }]);
  });
});

function 建插图(id: string): 叙事插图 {
  return {
    id,
    dataUrl: 'asset:x',
    type: 'scene',
    kind: 'snapshot',
    prompt: 'image###p###',
    description: '锚点行',
    status: 'done',
  };
}

function 建历史(): 聊天消息[] {
  return [{
    id: 'm1',
    role: 'assistant',
    content: 正文,
    narrativeImages: [建插图('a'), 建插图('b')],
  } as 聊天消息];
}

describe('单张重生的界面标记', () => {
  it('标记生成中：只动那一张，并清掉上次的失败原因', () => {
    const 历史 = 建历史();
    历史[0].narrativeImages![0] = { ...历史[0].narrativeImages![0], status: 'failed', error: '上次失败' };
    const 下一份 = 标记插图为生成中(历史, 'm1', 'a');
    expect(下一份[0].narrativeImages?.[0]).toMatchObject({ status: 'generating', error: undefined });
    expect(下一份[0].narrativeImages?.[1]?.status).toBe('done');
    // 不可变：入参不被改。
    expect(历史[0].narrativeImages?.[0].status).toBe('failed');
  });

  it('标记失败：把那张还原成 failed，并带上原因（否则会永远停在「正在生成…」）', () => {
    const 历史 = 标记插图为生成中(建历史(), 'm1', 'a');
    const 下一份 = 标记插图失败(历史, 'm1', 'a', '工作流里没有 %prompt%');
    expect(下一份[0].narrativeImages?.[0]).toMatchObject({ status: 'failed', error: '工作流里没有 %prompt%' });
    expect(下一份[0].narrativeImages?.[0].prompt).toBe('image###p###');
  });

  it('消息对不上时原样返回（不会误改别的回合）', () => {
    const 历史 = 建历史();
    expect(标记插图为生成中(历史, '别的消息', 'a')[0].narrativeImages?.[0].status).toBe('done');
  });
});

describe('回合动作视图读任务上的阶段', () => {
  function 造任务(阶段?: '等提示词' | '出图中'): 队列任务记录 {
    return {
      id: 'narrative_image_generate',
      title: '故事快照生成',
      turn: 3,
      timestamp: 0,
      status: 'pending',
      targetMessageId: 'm1',
      ...(阶段 ? { 阶段 } : {}),
    };
  }

  it('任务写着「出图中」时，即使消息里没有 generating 的图也显示出图中', () => {
    const 视图 = 派生回合动作视图(
      { id: 'm1', role: 'assistant', content: 正文, narrativeImages: [建插图('a')] } as 聊天消息,
      { queueTasks: [造任务('出图中')], busy: false, 正文生图手动模式: false, 变量更新启用: false },
    );
    expect(视图.regenerate_snapshot?.running).toBe(true);
    expect(视图.regenerate_snapshot?.阶段).toBe('出图中');
    expect(视图.regenerate_snapshot?.enabled).toBe(false);
  });

  it('任务没写阶段时退回旧的推断（有 generating 的图＝出图中）', () => {
    const 视图 = 派生回合动作视图(
      {
        id: 'm1', role: 'assistant', content: 正文,
        narrativeImages: [{ ...建插图('a'), status: 'generating' }],
      } as 聊天消息,
      { queueTasks: [造任务()], busy: false, 正文生图手动模式: false, 变量更新启用: false },
    );
    expect(视图.regenerate_snapshot?.阶段).toBe('出图中');

    const 等提示词 = 派生回合动作视图(
      { id: 'm1', role: 'assistant', content: 正文, narrativeImages: [建插图('a')] } as 聊天消息,
      { queueTasks: [造任务()], busy: false, 正文生图手动模式: false, 变量更新启用: false },
    );
    expect(等提示词.regenerate_snapshot?.阶段).toBe('等提示词');
  });

  it('任务不是 pending 时不报阶段（结束后不该再显示正在生成）', () => {
    const 视图 = 派生回合动作视图(
      { id: 'm1', role: 'assistant', content: 正文, narrativeImages: [建插图('a')] } as 聊天消息,
      {
        queueTasks: [{ ...造任务('出图中'), status: 'success' }],
        busy: false,
        正文生图手动模式: false,
        变量更新启用: false,
      },
    );
    expect(视图.regenerate_snapshot?.running).toBe(false);
    expect(视图.regenerate_snapshot?.阶段).toBeUndefined();
  });
});

describe('标记与流水线一起用：点击即有反馈', () => {
  it('标记之后卡片进入「正在生成」态（该分支不渲染任何按钮）', () => {
    const 历史 = 标记插图为生成中(建历史(), 'm1', 'a');
    expect(历史[0].narrativeImages?.[0].status).toBe('generating');
    // 生成中分支不渲染按钮这件事由组件测试钉住（tests/chat/image-card-actions.test.tsx）。
    void vi;
  });
});
