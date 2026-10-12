import type { 存档数据 } from '@/models/settings';
import type { 聊天消息 } from '@/models/chat';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import { loadSave, loadSaveIdByNodeId, saveGame } from '@/services/storage/saveCrud';
import { writeTurnTranscript } from '@/services/storage/diskPersistence';
import { createLeafNode, saveNewestStory, sealLeafRow } from '@/services/storage/saveTree';
import { 创建空NewestStory记录, 指向NewestStory记录, 登记待采纳子叶, type NewestStory记录, type 工作区字段集 } from '@/models/newestStory';
import { commitActiveSaveTreeMeta, ensureHeadLeafWritable, assertCheckpointPayloadNoQueueTasks } from './saveLoadWorkflow';
import { attachSaveTreeMeta, buildNextSaveTreeMeta } from '@/utils/saveTree';
import { normalizeEphemeralFields, resetEphemeralFields, stripEphemeralFields } from '@/models/leafLifecycle';
import { omitKeys } from '@/utils/storageUtils';
import { devLog, devLogError } from '@/utils/devLog';
import type { TurnContext, TurnDeltas } from './turnTypes';

type SaveWithTree = 存档数据 & { saveTree?: import('@/utils/saveTree').存档树元信息 };

export type 新局初始字段 = 工作区字段集;

export async function 初始化新局checkpoint(
  fields: 新局初始字段,
  state: UseGameStateReturn,
): Promise<{ checkpointId: number }> {
  try {
    const timestamp = Date.now();
    const rootFields = omitKeys(stripEphemeralFields(fields), ['queueTasks'] as const);
    const rootPayload = {
      id: 0,
      type: 'auto' as const,
      timestamp,
      ...rootFields,
    } as 存档数据;
    const rootWithTree = attachSaveTreeMeta(rootPayload, buildNextSaveTreeMeta({
      previous: null,
      type: 'auto',
      timestamp,
    }));
    assertCheckpointPayloadNoQueueTasks(rootWithTree, 'new-game');
    const rootId = await saveGame(rootWithTree);

    const leafEphemeral = normalizeEphemeralFields(fields).fields;
    const leafPayload = {
      ...rootWithTree,
      turnPhase: leafEphemeral.turnPhase,
      recoveryContext: leafEphemeral.recoveryContext,
      id: 0,
      timestamp: timestamp + 1,
      queueTasks: fields.queueTasks ?? [],
      saveTree: buildNextSaveTreeMeta({
        previous: rootWithTree,
        type: 'auto',
        timestamp: timestamp + 1,
      }),
    } as 存档数据;
    const { saveId, saveTree } = await createLeafNode(leafPayload);
    await saveNewestStory(指向NewestStory记录(创建空NewestStory记录(), saveTree.nodeId));
    devLog('save', 'new-game-leaf-created', {
      rootCheckpointId: rootId,
      leafId: saveId,
      headNodeId: saveTree.nodeId,
    });
    commitActiveSaveTreeMeta(leafPayload, state);
    return { checkpointId: rootId };
  } catch (error) {
    devLogError('save', 'new-game-checkpoint-failed', error);
    throw error;
  }
}

/** 每回合必写，与 enableAutoSaveEveryTurn 开关无关（开关只控是否保留可见 auto 存档）。 */
export async function commitTurn(
  ctx: TurnContext,
  d: TurnDeltas,
  newest: NewestStory记录,
): Promise<void> {
  const { state, assertWorkflowActive } = ctx;
  assertWorkflowActive();
  let headNodeId = newest.headNodeId;
  if (!headNodeId) {
    const ensured = await ensureHeadLeafWritable(state);
    headNodeId = ensured.headNodeId;
    if (!headNodeId) {
      throw new Error('commitTurn 失败：无法建立活跃叶子工作区。');
    }
  }

  const leafSaveId = await loadSaveIdByNodeId(headNodeId);
  if (!leafSaveId) {
    throw new Error(`commitTurn 失败：活跃叶子节点不存在（nodeId=${headNodeId}）。`);
  }
  const leaf = await loadSave(leafSaveId);
  if (!leaf) {
    throw new Error(`commitTurn 失败：活跃叶子数据缺失（saveId=${leafSaveId}）。`);
  }
  assertWorkflowActive();

  const queueTasks = leaf.queueTasks;
  const timestamp = Date.now();
  const sealedPayload = omitKeys(
    stripEphemeralFields({ ...leaf, id: leafSaveId, type: 'auto' as const, timestamp }),
    ['queueTasks'] as const,
  );
  assertCheckpointPayloadNoQueueTasks(sealedPayload, 'commit-turn');

  // 先建新叶子，再封版旧叶子：若反序，封版后、建叶前崩溃会让原叶子已剥离 queueTasks
  // 而新叶子未创建，恢复分叉只能得到空队列（工作区队列永久丢失）。
  const nextLeafPayload = resetEphemeralFields({
    ...sealedPayload,
    id: 0,
    timestamp: timestamp + 1,
    queueTasks,
    saveTree: buildNextSaveTreeMeta({
      previous: sealedPayload,
      type: 'auto',
      timestamp: timestamp + 1,
    }),
  }) as 存档数据;
  const nextHeadNodeId = (nextLeafPayload as SaveWithTree).saveTree?.nodeId ?? null;
  if (!nextHeadNodeId) {
    throw new Error('commitTurn 失败：新叶子缺少 saveTree 元信息。');
  }

  // 建叶前登记目标 childNodeId：若「封版 → 写指针」之间崩溃，恢复侧按明确身份采纳该子叶，
  // 不再在多个未封版子叶之间按保存 ID 猜测（读检查点分叉可产生多子叶）。
  // 指针移动会在同一次写入中清空该字段。
  await saveNewestStory(登记待采纳子叶(newest, nextHeadNodeId));
  devLog('save', 'checkpoint-pending-child-registered', {
    parentNodeId: headNodeId,
    pendingChildNodeId: nextHeadNodeId,
  });

  const { saveId } = await createLeafNode(nextLeafPayload);

  await sealLeafRow(sealedPayload);

  await saveNewestStory(指向NewestStory记录(newest, nextHeadNodeId));
  assertWorkflowActive();
  devLog('save', 'checkpoint-committed', {
    checkpointId: saveId,
    leafNodeId: nextHeadNodeId,
    queueTasksStrippedFromPayload: true,
    queueTasksKeptInWorkspace: queueTasks !== undefined,
  });

  commitActiveSaveTreeMeta(nextLeafPayload, state);

  // 正文另存一份人可读的磁盘记录：与存档同一提交点触发，但失败绝不影响回合。
  const transcriptBody = extractLatestAssistantBody(sealedPayload.chatHistory);
  if (transcriptBody) {
    void writeTurnTranscript({
      turn: sealedPayload.turnCount ?? sealedPayload.chatHistory.length + 1,
      traveler: sealedPayload.旅人.姓名,
      body: transcriptBody,
    });
  }
}

function extractLatestAssistantBody(chatHistory: readonly 聊天消息[]): string {
  for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
    const message = chatHistory[index];
    if (message.role !== 'assistant') continue;
    return (message.parsedResponse?.body || message.content || '').trim();
  }
  return '';
}
