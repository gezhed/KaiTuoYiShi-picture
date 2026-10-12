import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { API配置项, 游戏设置, 文生图系统设置 } from '@/models/settings';
import type { 叙事插图, 聊天消息 } from '@/models/chat';
import type { 相册系统 } from '@/models/imageGeneration';
import { resolveApiOverrideFields, type API覆盖字段 } from '@/models/settings';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import type { 传输诊断 } from '@/services/ai/imageGen/illustrationAgent';
import { 思考工具声明, 默认工具名 } from '@/services/ai/imageGen/illustrationAgent';
import { 创建相册图片条目, 添加图片到相册 } from '@/utils/albumActions';
import { writeLeafNode } from '@/services/storage/saveTree';
import { 读取已落盘资产记录, 写入已落盘资产记录 } from '@/services/storage/saveCrud';
import { getAlbumAssetBlob, dataUrlToBlob, rememberAlbumAssetBlob } from '@/utils/albumObjectUrl';
import { cleanLeafPatch } from './workflowTransaction';
import { ensureHeadLeafWritable } from './saveLoadWorkflow';
import { devLog, devLogError } from '@/utils/devLog';
import { 生成单张插图 } from '@/services/ai/imageGen/generateIllustration';
import {
  生成正文插图,
  重生成单张插图,
  建提示词依赖,
  type 插图流水线依赖,
  type 生成正文插图结果,
} from '@/services/ai/imageGen/illustrationPipeline';
import type { 角色匹配上下文 } from '@/services/ai/imageGen/characterPrompt';
import { 选参考图 } from '@/services/ai/imageGen/referenceImage';
import { 读取角色媒体数据地址 } from '@/services/characterMedia';

/** 转出给上游的中间结果，附上归档后的相册。 */
export interface 插图作业结果 {
  插图: 叙事插图[];
  相册: 相册系统;
  /**
   * 本次归档新增的相册条目（含图片字节）。
   *
   * 落盘时必须用它，**不能**回头去查内存里的资产缓存：
   * 那个缓存是可被回收的（`pruneAlbumAssetCache`），一旦在生成与落盘之间被清掉，
   * 就拿不到字节，于是写成一条空引用 —— 现象正是「只有还在缓存里的最后一张留下来了」。
   */
  新增条目: 归档条目[];
  提示词诊断?: string;
  /** LLM 的原始回复；用于界面显示「模型到底回了什么」。 */
  原始回复?: string;
  成功数: number;
  失败数: number;
}

export interface 归档条目 {
  asset: import('@/models/imageGeneration').图片资源;
  entry: import('@/models/imageGeneration').相册条目;
  /**
   * 归档那一刻的图片字节。
   *
   * 必须在这里带着走：相册里存的只是 `asset:<id>` 引用，而字节放在
   * 一个**可被回收**的内存缓存里（`pruneAlbumAssetCache` 会清）。落盘发生在
   * 「全部出完图」之后，中间任何一次回收都会让早先几张的字节取不到，
   * 结果只有最后一张留在缓存里能被写进去 —— 这正是「四张只保住一张」的成因。
   */
  blob?: Blob;
}

function 取LLM配置(设置: 游戏设置, apiSettings: UseGameStateReturn['deviceSettings']['apiSettings']): API配置项 | null {
  const LLM = 设置.文生图系统.LLM;
  if (!LLM.启用) return null;
  const 主配置 = apiSettings.configs.find((项) => 项.id === apiSettings.activeConfigId) ?? null;
  const 解析后 = resolveApiOverrideFields(
    {
      provider: (LLM.API.provider || '') as API覆盖字段['provider'],
      baseUrl: LLM.API.baseUrl,
      apiKey: LLM.API.apiKey,
      model: LLM.API.model,
      temperature: LLM.温度,
      retryCount: LLM.重试次数,
    },
    主配置,
  );
  if (!解析后.baseUrl.trim() || !解析后.model.trim()) return null;
  const id = '__image_illustration_converter__';
  // 空 provider 表示回退主 API；回退后仍为空时按 OpenAI 兼容处理。
  const provider: API配置项['provider'] = (解析后.provider || 'openai_compatible') as API配置项['provider'];
  if (主配置?.id === id) return { ...主配置, ...解析后, provider };
  return {
    id,
    name: '文生图LLM',
    provider,
    baseUrl: 解析后.baseUrl,
    apiKey: 解析后.apiKey,
    model: 解析后.model,
    maxTokens: 解析后.maxTokens,
    temperature: 解析后.temperature,
    retryCount: 解析后.retryCount,
    enableClaudeMode: 设置.enableClaudeMode,
    createdAt: 0,
    updatedAt: 0,
  };
}

export function 组装角色上下文(设置: 文生图系统设置): 角色匹配上下文 {
  return { 启用列表: 设置.角色启用列表, 全部角色: 设置.角色卡 };
}

/**
 * 挑出本次出图要用的参考图。
 *
 * 正文配图可能覆盖多名角色，而 ComfyUI 的参考图是「单张上传 + 文件名占位符」，
 * 一次只有一张能进去。取用顺序：启用列表里有参考图的第一个角色 → 任何有参考图的角色。
 * 上游的 `charRefGroups` 支持多张与强度数组，那是 NovelAI 的载荷能力，
 * 等接 NAI 渠道时再放开（见 `referenceImage.ts` 的修改声明）。
 */
export async function 解析本次参考图(
  设置: 文生图系统设置,
): Promise<{ 数据地址: string; 文件名: string } | null> {
  if (!设置.comfyui.参考图上传) return null;
  const 候选角色 = [
    ...设置.角色启用列表.map((键) => 设置.角色卡[键]).filter(Boolean),
    ...Object.values(设置.角色卡),
  ];
  for (const 角色 of 候选角色) {
    const 引用 = 选参考图(角色);
    if (!引用) continue;
    try {
      const 数据地址 = await 读取角色媒体数据地址(引用.媒体Id);
      if (!数据地址) continue;
      return { 数据地址, 文件名: `${引用.媒体Id}.png` };
    } catch {
      // 单张读不出来就继续找下一个角色，而不是让整轮配图失败。
    }
  }
  return null;
}

/**
 * 构造正文插图流水线。
 *
 * 依赖注入点的取法：
 * - 提示词：走应用自己的 `chatCompletionNonStream`（直连上游，不经 ST 代理）；
 * - 出图：走 `生成单张插图`（内部完成提示词组装 + ComfyUI 占位符替换 + 落缓存）；
 * - 归档：写进相册，并把 `asset:` 引用回填给聊天消息，保持既有头像/立绘渲染链路可用。
 */
export function 构造插图依赖(
  state: UseGameStateReturn,
  onAlbumItem: (item: 归档条目) => void,
): 插图流水线依赖 {
  const 设置 = state.deviceSettings.gameSettings;
  const 系统 = 设置.文生图系统;
  const LLM配置 = 取LLM配置(设置, state.deviceSettings.apiSettings);

  return {
    生成提示词: async ({ 正文, signal }) => {
      if (!LLM配置) {
        throw new Error('正文配图的LLM未配置：请启用LLM并填写可用的模型接口。');
      }
      // 传输层诊断用来区分空回的成因（安全拦截 / 额度耗尽 / 只回推理内容）。
      // 不订阅它的话，这几种情况在界面上完全一样：正文是空字符串。
      let 诊断: 传输诊断 | undefined;
      const 结果 = await 建提示词依赖(
        async (消息, innerSignal) => chatCompletionNonStream(LLM配置, {
          messages: 消息.map((项) => ({ role: 项.role, content: 项.content })),
          temperature: 系统.LLM.温度,
          maxTokens: 系统.LLM.最大输出,
          signal: innerSignal ?? signal,
          onResponseDiagnostics: (下一个) => { 诊断 = 下一个; },
          // 预设要求「只用 toolcall 回复」，所以必须把工具声明出去，
          // 否则模型既不直出文本也无工具可用，只能返回空内容。
          tools: 思考工具声明,
          // 只声明工具不够：模型仍可选择回普通文本。预设明确禁止直出时必须强制。
          toolChoice: { type: 'function', function: { name: 默认工具名 } },
          parallelToolCalls: false,
        }),
        () => 诊断,
      )({ 正文, 设置: 系统, signal });
      return 结果;
    },
    出图: async ({ 提示词标记, 覆盖尺寸, 标题, 参考图, signal }) => {
      const 结果 = await 生成单张插图(
        系统,
        { 提示词标记, 覆盖尺寸, 标题, 参考图, signal },
        组装角色上下文(系统),
      );
      return {
        数据地址: 结果.结果.数据地址,
        正向提示词: 结果.正向提示词,
        负向提示词: 结果.负向提示词,
        宽度: 结果.结果.宽度,
        高度: 结果.结果.高度,
      };
    },
    归档: async ({ 插图, 提示词标记, 宽度, 高度 }) => {
      if (插图.status !== 'done') return undefined;
      const 引用 = 插图.dataUrl;
      if (!引用) return undefined;
      const 条目 = 创建相册图片条目({
        title: 插图.description || '正文插图',
        src: 引用,
        source: 'generated',
        targetType: 'scene',
        slot: 'scene',
        prompt: 提示词标记,
        negativePrompt: 插图.negativePrompt,
        finalPrompt: 提示词标记,
        dimensions: `${宽度}x${高度}`,
        backend: 'comfyui',
        tags: ['正文插图'],
      });
      // 立刻把字节抓在手里：缓存随时可能被回收，而落盘要等所有图都出完。
      const 字节 = getAlbumAssetBlob(条目.asset.id) ?? dataUrlToBlob(引用) ?? undefined;
      if (字节) rememberAlbumAssetBlob(条目.asset.id, 字节, 条目.asset.mimeType || 字节.type);
      onAlbumItem({ ...条目, blob: 字节 });
      return { 数据地址: `asset:${条目.asset.id}` };
    },
  };
}

/** 为一条助手消息生成插图（多图）。 */
export async function 生成消息插图(
  state: UseGameStateReturn,
  消息Id: string,
  正文: string,
  已有插图?: 叙事插图[],
  选项?: { 只重新生成提示词?: boolean; signal?: AbortSignal },
): Promise<插图作业结果> {
  const 设置 = state.deviceSettings.gameSettings.文生图系统;
  const 新增条目: 归档条目[] = [];
  const 依赖 = 构造插图依赖(state, (条目) => 新增条目.push(条目));
  const 参考图 = await 解析本次参考图(设置);

  const 结果 = await 生成正文插图({
    消息Id,
    正文,
    设置,
    依赖,
    已有插图,
    只重新生成提示词: 选项?.只重新生成提示词,
    参考图,
    signal: 选项?.signal,
  });

  let 相册 = state.相册;
  for (const 条目 of 新增条目) 相册 = 添加图片到相册(相册, 条目);
  return { ...结果, 相册, 新增条目 };
}

/**
 * 把插图结果落盘，并**回读校验**。
 *
 * 为什么必须显式保存：回合内的改动由 `commitTurn` 在收尾时统一写入活跃叶子，
 * 但**手动生图发生在回合之外**，没有任何提交点。不写这一下的话，
 * 界面当场能看到图，一旦重新进入（读存档）就发现图和相册都没了 —— 实际反馈过。
 *
 * 为什么要回读：写失败的原因藏在好几层里（叶子被封印、资产 store 缺表、
 * 事务被中止），而这里的 `catch` 为了不抹掉已出好的图必须吞掉异常。
 * 吞掉之后用户只会看到「图没了」，看不出到底写没写成。
 * 所以写完立刻读一次，把结论作为返回值交给界面显示。
 */
export interface 插图落盘报告 {
  成功: boolean;
  /** 本次写进去的图片字节数。 */
  资产数: number;
  /** 回读时确认能取回字节的图片数。 */
  回读确认数: number;
  /** 失败原因（成功时为空）。 */
  原因?: string;
}

/**
 * 把归档条目里的图片字节直接写进资产库。
 *
 * 为什么要绕过 `writeLeafNode` 里的自动提取：那条路靠内存缓存找字节，
 * 而缓存是可被回收的。字节本来是「刚出图时明明在手里」的东西，
 * 却因为放在可失效的地方而在落盘那一刻取不到 —— 这就是「只剩最后一张」的成因。
 */
async function 落盘归档资产(条目列表: 归档条目[]): Promise<void> {
  const 记录列表: import('@/utils/saveAssetStorage').SaveAssetRecord[] = [];
  for (const 条目 of 条目列表) {
    // 优先用归档时抓下来的字节；缓存里可能已经被回收了。
    const blob = 条目.blob ?? getAlbumAssetBlob(条目.asset.id);
    if (!blob) continue;
    记录列表.push({
      id: 条目.asset.id,
      blob,
      mimeType: 条目.asset.mimeType || blob.type || 'image/png',
      width: 条目.asset.width,
      height: 条目.asset.height,
      size: 条目.asset.size || blob.size,
      updatedAt: Date.now(),
    });
  }
  if (记录列表.length === 0) return;
  await 写入已落盘资产记录(记录列表);
}

export async function 保存插图结果(
  state: UseGameStateReturn,
  下一份历史: 聊天消息[],
  相册: 相册系统,
  /**
   * 本次归档新增的条目。传了就直接用它们的字节落盘；
   * 不传才退回「从内存缓存里找」——那条路是可失效的，只作兼容。
   */
  新增条目?: 归档条目[],
): Promise<插图落盘报告> {
  try {
    // 只校验本次正文真正用到的那些图片；相册里可能有历史资产，不属于本次写入。
    const 目标资产 = new Set(
      下一份历史
        .flatMap((项) => (项.narrativeImages ?? []).map((图) => 图.dataUrl))
        .filter((项):项 is string => typeof 项 === 'string' && 项.startsWith('asset:'))
        .map((项) => 项.slice('asset:'.length)),
    );
    // 归档条目里带着原始字节，优先用它们，避免被缓存回收坑到。
    for (const 条目 of 新增条目 ?? []) {
      if (条目.asset?.id) 目标资产.add(条目.asset.id);
    }

    const newest = await ensureHeadLeafWritable(state);
    if (!newest.headNodeId) {
      return { 成功: false, 资产数: 目标资产.size, 回读确认数: 0, 原因: '活跃叶子指针为空，本次没有落盘。' };
    }

    /*
     * 先把字节直接写进资产库，再写存档行。
     *
     * 顺序很重要：`writeLeafNode` 内部的 `stripSaveAssetPayloadForStorage` 会把
     * `dataUrl` 改写成 `asset:<id>` 引用，而字节的提取原先完全依赖内存缓存。
     * 这里直接落字节，就不再看缓存脸色。
     */
    if (新增条目 && 新增条目.length > 0) {
      await 落盘归档资产(新增条目);
    }
    await writeLeafNode(newest.headNodeId, cleanLeafPatch({ chatHistory: 下一份历史, 相册 }));

    // 回读校验：直接从 IndexedDB 取，不看内存缓存，取到字节才算真的落盘。
    const 记录表 = await 读取已落盘资产记录([...目标资产]);
    let 确认 = 0;
    for (const id of 目标资产) {
      const 记录 = 记录表.get(id);
      if (记录?.blob instanceof Blob && 记录.blob.size > 0) 确认 += 1;
    }

    devLog('save', 'illustration-leaf-write', {
      nodeId: newest.headNodeId,
      资产数: 目标资产.size,
      回读确认数: 确认,
    });
    const 成功 = 确认 === 目标资产.size;
    return {
      成功,
      资产数: 目标资产.size,
      回读确认数: 确认,
      原因: 成功
        ? undefined
        : `写入后回读只确认了 ${确认}/${目标资产.size} 张图片，字节可能没有真正落盘。`,
    };
  } catch (错误) {
    // 落盘失败不该把已经出好的图从界面上抹掉，所以只记日志不抛。
    devLogError('save', 'illustration-leaf-write-failed', 错误);
    return {
      成功: false,
      资产数: 0,
      回读确认数: 0,
      原因: 错误 instanceof Error ? 错误.message : String(错误),
    };
  }
}

/** 重生成单张插图，并把新图归档进相册。 */
export async function 重生成消息单张插图(
  state: UseGameStateReturn,
  插图: 叙事插图,
  选项?: {
    新提示词正文?: string;
    覆盖尺寸?: { 宽度: number; 高度: number } | null;
    signal?: AbortSignal;
  },
): Promise<{ 插图: 叙事插图; 相册: 相册系统; 新增条目: 归档条目[] }> {
  const 新增条目: 归档条目[] = [];
  const 依赖 = 构造插图依赖(state, (条目) => 新增条目.push(条目));
  const 参考图 = await 解析本次参考图(state.deviceSettings.gameSettings.文生图系统);
  const 新插图 = await 重生成单张插图({
    插图,
    新提示词正文: 选项?.新提示词正文,
    覆盖尺寸: 选项?.覆盖尺寸,
    参考图,
    依赖,
    signal: 选项?.signal,
  });
  let 相册 = state.相册;
  for (const 条目 of 新增条目) 相册 = 添加图片到相册(相册, 条目);
  return { 插图: 新插图, 相册, 新增条目 };
}

export type { 生成正文插图结果 };
