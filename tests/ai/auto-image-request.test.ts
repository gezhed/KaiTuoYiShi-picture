/**
 * 自动生图必须**真的发起生成请求**。
 *
 * 这条链路的入口是回合后台任务 `stage11_backgroundJobs` → `runNarrativeImageJob`。
 * 用户报「自动生图模式没有正常的去请求生图」，而这条路径原先在门禁不通过时
 * **静默 return**，所以先在这里把「会调用生成器」这件事钉死。
 *
 * 只 mock 掉需要网络与持久化的子任务（新闻 / 忆庭 / 手机），
 * 生图这一支用 spy 替身，验证它到底有没有被调用、拿到了什么参数。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { 聊天消息 } from '@/models/chat';
import { 创建默认文生图系统设置 } from '@/models/genSystem';

const 生成消息插图 = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useGame/illustrationWorkflow', () => ({ 生成消息插图 }));
vi.mock('@/hooks/useGame/newsWorkflow', () => ({
  buildRecentTurnWindowForNews: () => [],
  runNewsGenerationStep: async () => null,
}));
vi.mock('@/services/yitingArchive', () => ({
  buildYitingArchiveEntry: async () => ({ entry: null, yiting: null }),
}));
vi.mock('@/hooks/useGame/phoneWorkflow', () => ({
  buildFallbackPhoneSeed: () => null,
}));
vi.mock('@/services/apiConfig', () => ({
  resolveApiConfig: () => ({ provider: 'openai', baseUrl: '', apiKey: '', model: '' }),
}));

const { stage11_backgroundJobs } = await import('@/hooks/useGame/stage11_backgroundJobs');

const 正文 = '她推开舱门。';

function 造State(文生图系统: unknown, turnCount = 7) {
  const queueTasks: unknown[] = [];
  const state = {
    turnCount,
    queueTasks,
    // 真实 state 的 setter 接收 updater 函数，桩也必须照这个签名，否则 pushQueueTask 会炸。
    setQueueTasks: (更新: unknown) => {
      const 下一份 = typeof 更新 === 'function'
        ? (更新 as (prev: unknown[]) => unknown[])(queueTasks)
        : (更新 as unknown[]);
      queueTasks.splice(0, queueTasks.length, ...下一份);
    },
    deviceSettings: {
      gameSettings: {
        文生图系统,
        新闻系统: { enabled: false, autoGenerate: false },
        记忆系统: { 忆庭召回API: { retryCount: 0 } },
        手机系统: { enabled: false, autoGenerateSeeds: false, maxSeedsPerTurn: 0, contactCooldownTurns: 0 },
        backgroundTaskMode: 'sequential',
      },
      apiSettings: { configs: [], activeConfigId: null },
    },
    手机: { messageSeeds: [], unreadTotal: 0 },
    忆庭: { 回忆档案: [] },
    剧情编织: { 运行时: { factLedger: [] } },
    新闻: [],
    世界: {},
  };
  return { state, queueTasks };
}

function 造参数(state: unknown) {
  const aiMsg = { id: 'msg_1', role: 'assistant', content: 正文 } as 聊天消息;
  const finalHistory: 聊天消息[] = [aiMsg];
  const ctx = {
    state,
    userInput: '继续',
    deps: {},
    config: {},
    mainStoryConfig: {},
    isOpeningSystemTrigger: false,
    isAwakeningEnterTrigger: false,
    awakeningPathId: undefined,
    awakeningInstruction: '',
    openingInstruction: '',
    effectiveWorld: { 当前日期: '', 当前时间: '', 当前地点: '' },
    worldAtStart: {},
    travelerAtStart: {},
    zhikuAtStart: {},
    phoneAtStart: { messageSeeds: [], unreadTotal: 0 },
    turnCountAtStart: 7,
    variableBatchesAtStart: [],
    queueTasksMirror: undefined,
    abortController: new AbortController(),
    isCurrentWorkflow: () => true,
    assertWorkflowActive: () => {},
    streamMessageSetter: () => {},
    rollbackSnapshotOnAbort: null,
  };
  const d = {
    displayText: 正文,
    finalHistory,
    aiMsg,
    npcAfterCompression: [],
    yitingWithCompression: { 回忆档案: [] },
    parsedForDisplay: { memory: '', worldEvents: [], actionOptions: [] },
  };
  return { ctx, d };
}

function 可自动生图的设置() {
  const 基础 = 创建默认文生图系统设置();
  return { ...基础, 启用: true, 正文配图: { ...基础.正文配图, 启用: true, 模式: 'auto' as const } };
}

beforeEach(() => {
  生成消息插图.mockReset();
  生成消息插图.mockResolvedValue({
    插图: [{ id: 'nar_1', dataUrl: 'asset:a1', status: 'done', description: '她推开舱门。', prompt: 'image###p###' }],
    相册: { assets: [], entries: [] },
    新增条目: [],
    成功数: 1,
    失败数: 0,
  });
});

describe('自动生图会发起请求', () => {
  it('auto 模式下调用生成器，并带上本回合正文与消息 id', async () => {
    const { state } = 造State(可自动生图的设置());
    const { ctx, d } = 造参数(state);
    // 参数用 any 绕过完整 TurnContext 的约束：这里只关心生图这一支是否被触发。
    await stage11_backgroundJobs(ctx as never, d as never);
    expect(生成消息插图).toHaveBeenCalledTimes(1);
    const 调用 = 生成消息插图.mock.calls[0];
    expect(调用[2]).toBe(正文); // displayText
  });

  it('生成结果会并回该条消息的 narrativeImages（否则界面看不到图）', async () => {
    const { state } = 造State(可自动生图的设置());
    const { ctx, d } = 造参数(state);
    const 返回 = await stage11_backgroundJobs(ctx as never, d as never);
    const 历史 = 返回.finalHistoryForSave as 聊天消息[];
    expect(历史[0].narrativeImages).toHaveLength(1);
    expect(历史[0].narrativeImages?.[0].id).toBe('nar_1');
  });

  it('生成结果里的相册会带回去保存（否则图进不了相册）', async () => {
    const { state } = 造State(可自动生图的设置());
    const { ctx, d } = 造参数(state);
    const 返回 = await stage11_backgroundJobs(ctx as never, d as never);
    expect(返回.相册After).toBeDefined();
  });
});

describe('自动生图过程中界面上必须有反馈', () => {
  it('等待期间就有一条 pending，说明正在写提示词', async () => {
    const { state, queueTasks } = 造State(可自动生图的设置());
    const { ctx, d } = 造参数(state);
    // 让生成器「悬停」在飞行中，检查这时队列里有没有东西。
    let 放行: () => void = () => {};
    const 飞行中 = new Promise<void>((resolve) => { 放行 = resolve; });
    生成消息插图.mockImplementation(async () => {
      await 飞行中;
      return { 插图: [], 相册: { assets: [], entries: [] }, 新增条目: [], 成功数: 0, 失败数: 0 };
    });
    const 任务 = stage11_backgroundJobs(ctx as never, d as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = (queueTasks as Array<{ id: string; status: string; detail?: string; 阶段?: string }>)
      .filter((项) => 项.status === 'pending');
    expect(pending.some((项) => 项.id === 'narrative_image_parse' && 项.阶段 === '等提示词')).toBe(true);
    expect(pending.some((项) => 项.detail?.includes('正在为正文生成插图'))).toBe(true);
    放行();
    await 任务;
  });

  it('进入出图阶段会另报一条 pending（与「等提示词」分得开）', async () => {
    const { state, queueTasks } = 造State(可自动生图的设置());
    const { ctx, d } = 造参数(state);
    生成消息插图.mockImplementation(async (_state, _id, _正文, _已有, 选项?: { on进度?: (事件: unknown) => void }) => {
      选项?.on进度?.({ 阶段: '出图', 完成数: 0, 总数: 3 });
      return {
        插图: [{ id: 'nar_1', dataUrl: '', status: 'done', description: 'x', prompt: 'image###p###' }],
        相册: { assets: [], entries: [] },
        新增条目: [],
        成功数: 1,
        失败数: 0,
      };
    });
    await stage11_backgroundJobs(ctx as never, d as never);
    const 出图任务 = (queueTasks as Array<{ id: string; status: string; detail?: string; 阶段?: string }>)
      .filter((项) => 项.id === 'narrative_image_generate' && 项.status === 'pending');
    expect(出图任务).toHaveLength(1);
    expect(出图任务[0].阶段).toBe('出图中');
    expect(出图任务[0].detail).toContain('共 3 张');
  });
});

describe('不满足条件时不发请求，但对用户可见', () => {
  it('手动模式不发请求', async () => {
    const 基础 = 创建默认文生图系统设置();
    const { state } = 造State({ ...基础, 启用: true, 正文配图: { ...基础.正文配图, 启用: true, 模式: 'manual' } });
    const { ctx, d } = 造参数(state);
    await stage11_backgroundJobs(ctx as never, d as never);
    expect(生成消息插图).not.toHaveBeenCalled();
  });

  it('总开关关闭时不发请求', async () => {
    const { state } = 造State({ ...可自动生图的设置(), 启用: false });
    const { ctx, d } = 造参数(state);
    await stage11_backgroundJobs(ctx as never, d as never);
    expect(生成消息插图).not.toHaveBeenCalled();
  });

  it('被拦下时要在队列里说明原因，而不是静默', async () => {
    const { state, queueTasks } = 造State({ ...可自动生图的设置(), 启用: false });
    const { ctx, d } = 造参数(state);
    await stage11_backgroundJobs(ctx as never, d as never);
    const 记录 = JSON.stringify(queueTasks);
    expect(记录).toContain('未自动生图');
    expect(记录).toContain('总开关');
  });
});
