import type { 存档数据 } from '@/models/settings';
import { 归一化NewestStory记录, NEWEST_STORY_STORE_KEY, 创建空NewestStory记录, 指向NewestStory记录, type NewestStory记录 } from '@/models/newestStory';
import { resetEphemeralFields, stripEphemeralFields } from '@/models/leafLifecycle';
import type { 存档树元信息 } from '@/utils/saveTree';
import { createUnifiedId } from '@/utils/id';
import { devLog, devLogError } from '@/utils/devLog';
import type { SaveCatalogSnapshot, SaveListItemSummary } from '@/contracts/storage';
import { buildSaveSummary, isUnsealedHeadSave, type SaveWithTree, type StoredSaveMeta } from './saveSummary';
import { loadRawSave, restoreDeltaSaveIfNeeded } from './saveRecord';
import { deleteManagedSaveItems, findAutoDeltaBase, getSaveCatalogSnapshot, loadSave, loadSaveIdByNodeId, saveGame } from './saveCrud';
import { createCatalogRecordFromSummary } from '@/services/storage/saveCatalog';
import { 对账并补齐磁盘 } from '@/services/storage/diskPersistence';
import { runWithSaveMutationPriority } from '@/services/storage/saveCatalogRepair';
import { openDB, SAVES_STORE, SAVE_SUMMARIES_STORE, SAVE_NODE_DELTAS_STORE, SAVE_ASSETS_STORE, NEWEST_STORY_STORE } from './dbConnection';
import { buildDeltaOnlyStoredSave, buildSaveNodeDeltaRecord, isDeltaOnlyStoredSave } from '@/utils/saveDeltaStorage';
import { extractSaveAssetRecords, materializeSaveAssetRecords, stripSaveAssetPayloadForStorage } from '@/utils/saveAssetStorage';
import { omitKeys, toError } from '@/utils/storageUtils';

export interface LeafNodeResult {
  saveId: number;
  saveTree: 存档树元信息;
}

export async function createLeafNode(payload: 存档数据): Promise<LeafNodeResult> {
  const withMarker = {
    ...payload,
    saveRuntime: { unsealedHead: true },
  } as StoredSaveMeta;
  const saveId = await saveGame(withMarker, { forceFullStore: true });
  const tree = (withMarker as SaveWithTree).saveTree;
  if (!tree?.nodeId) {
    throw new Error('创建叶子节点失败：缺少 saveTree 元信息。');
  }
  // 手动存档 / 导入存档：此时对账一次（频率低、时机明确）。
  if (payload.type !== 'auto') {
    await 对账并补齐磁盘().catch((error: unknown) => {
      devLogError('save', 'manual-save-reconcile-failed', error);
    });
  }
  return { saveId, saveTree: tree };
}

/** sealedPayload 必须是 loadSave 恢复出的完整状态（含叶子原 saveTree / id）。 */
export async function sealLeafRow(sealedPayload: 存档数据): Promise<void> {
  const saveId = sealedPayload.id;
  const db = await openDB();
  const raw = await loadRawSave(db, saveId);
  if (!raw) {
    throw new Error(`封版叶子失败：叶子行不存在（saveId=${saveId}）。`);
  }
  if (!isUnsealedHeadSave(raw)) {
    devLog('save', 'seal-leaf-skipped-already-sealed', { saveId });
    return;
  }
  const sealedFields = omitKeys(
    stripEphemeralFields(sealedPayload) as 存档数据 & { saveStorage?: unknown },
    ['queueTasks', 'saveStorage'] as const,
  );
  const sealedStored = stripSaveAssetPayloadForStorage({
    ...sealedFields,
    id: saveId,
    saveRuntime: undefined,
  });
  // 自动档封版后降级为「仅增量」（每 MAX_DELTA_NODES_PER_CHECKPOINT 个落一个全量检查点）；
  // 手动档 findAutoDeltaBase 直接返回 null，保持全量、独立、不被自动清理。
  const deltaBase = await findAutoDeltaBase(db, sealedStored);
  // 事务内二次确认未封版不可省：事务外预检到写入之间存在 TOCTOU 窗口，会覆写已封版检查点。
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SAVES_STORE, SAVE_SUMMARIES_STORE, SAVE_NODE_DELTAS_STORE], 'readwrite');
    const saveStore = tx.objectStore(SAVES_STORE);
    const summaryStore = tx.objectStore(SAVE_SUMMARIES_STORE);
    const deltaStore = tx.objectStore(SAVE_NODE_DELTAS_STORE);
    let skipped = false;
    const readRequest = saveStore.get(saveId);
    readRequest.onsuccess = () => {
      const current = readRequest.result as StoredSaveMeta | undefined;
      if (!current) {
        reject(new Error(`封版叶子失败：叶子行不存在（saveId=${saveId}）。`));
        return;
      }
      if (!isUnsealedHeadSave(current)) {
        skipped = true;
        devLog('save', 'seal-leaf-skipped-already-sealed', { saveId });
        resolve();
        return;
      }
      saveStore.put(deltaBase ? buildDeltaOnlyStoredSave(sealedStored, deltaBase.baseSaveId) : sealedStored);
      summaryStore.put(createCatalogRecordFromSummary(buildSaveSummary(sealedStored)));
      const delta = buildSaveNodeDeltaRecord(
        sealedStored,
        saveId,
        deltaBase
          ? { baseSave: deltaBase.baseSave, baseSaveId: deltaBase.baseSaveId, storageMode: 'delta' }
          : undefined,
      );
      if (delta) deltaStore.put(delta);
    };
    readRequest.onerror = () => reject(toError(readRequest.error));
    tx.oncomplete = () => {
      if (!skipped) {
        devLog('save', 'seal-leaf', { saveId, nodeId: (sealedStored as SaveWithTree).saveTree?.nodeId ?? null });
      }
      resolve();
    };
    tx.onerror = () => reject(toError(tx.error));
    tx.onabort = () => reject(tx.error ?? new Error('封版叶子事务已中止。'));
  });
  // 自动档滚动窗口：把旧全量已并入的部分清掉，恒保持「1 全量 + ≤5 增量」。
  if (sealedStored.type === 'auto') {
    const rootId = (sealedStored as SaveWithTree).saveTree?.rootId;
    if (rootId) {
      await compressAutoSaveWindow(rootId).catch((error: unknown) => {
        devLogError('save', 'auto-window-compress-failed', error);
      });
      // 只在刚落全量（检查点）时对账一次，避免频繁全库操作。
      if (deltaBase === null) {
        await 对账并补齐磁盘().catch((error: unknown) => {
          devLogError('save', 'checkpoint-reconcile-failed', error);
        });
      }
    }
  }
}

/** 自动档窗口保留的增量个数。 */
const AUTO_WINDOW_DELTAS = 5;

/**
 * 自动档滚动窗口：只保留「最新 1 个全量 + 其后 ≤AUTO_WINDOW_DELTAS 个增量」，更早的自动档整段清除。
 * 最新档是自足全量，删旧不会伤到它；手动档与其它分支一律不动。
 * 仅由 sealLeafRow 在「刚落下新全量」时调用。
 */
export async function compressAutoSaveWindow(rootId: string): Promise<number> {
  const trimmed = rootId.trim();
  if (!trimmed) return 0;
  const catalog = await getSaveCatalogSnapshot();
  if (!catalog.catalogComplete) return 0;
  const byNode = new Map<string, SaveListItemSummary>();
  for (const item of catalog.items) {
    const nodeId = item.saveTree?.nodeId;
    if (nodeId && item.saveTree?.rootId === trimmed && item.type === 'auto') byNode.set(nodeId, item);
  }
  const newest = await loadNewestStory();
  // 从 head 沿 parentNodeId 回溯自动链（链上都是本 root 的自动节点）
  const chain: SaveListItemSummary[] = [];
  const seenNodeIds = new Set<string>();
  let cursor = newest.headNodeId;
  while (cursor && byNode.has(cursor) && !seenNodeIds.has(cursor)) {
    seenNodeIds.add(cursor);
    const item = byNode.get(cursor) as SaveListItemSummary;
    chain.push(item);
    cursor = item.saveTree?.parentNodeId ?? null;
  }
  const drop = chain.slice(AUTO_WINDOW_DELTAS + 1);
  // 除当前链外，其它「整棵都是自动档」的树也一并清除（同步分叉留下的噪声树；含手动/导入的树一律不动）。
  const 当前根 = chain[0]?.saveTree?.rootId ?? null;
  const 按根 = new Map<string, SaveListItemSummary[]>();
  for (const item of catalog.items) {
    const 根 = item.saveTree?.rootId;
    if (!根 || !item.saveTree?.nodeId) continue;
    const 组 = 按根.get(根) ?? [];
    组.push(item);
    按根.set(根, 组);
  }
  for (const [根, 组] of 按根) {
    if (根 === 当前根) continue;
    if (组.every((项) => 项.type === 'auto')) drop.push(...组);
  }
  if (!drop.length) return 0;
  const keepOldest = chain[AUTO_WINDOW_DELTAS];
  const nextParentNodeId = drop[drop.length - 1]?.saveTree?.parentNodeId ?? null;
  const db = await openDB();
  await deleteManagedSaveItems(db, drop);
  await reparentSaveNode(db, keepOldest, nextParentNodeId);
  devLog('save', 'auto-window-compressed', {
    rootId: trimmed,
    dropped: drop.length,
    kept: chain.length - drop.length,
  });
  return drop.length;
}

/** 只改节点的 saveTree.parentNodeId（原样保留其余字段，避免用残缺行重算摘要）。 */
async function reparentSaveNode(
  db: IDBDatabase,
  item: SaveListItemSummary,
  parentNodeId: string | null,
): Promise<void> {
  if (!item.saveTree?.nodeId) return;
  const patchTree = (tree: 存档树元信息): 存档树元信息 => {
    const next = { ...tree } as 存档树元信息 & { parentNodeId?: string };
    if (parentNodeId) next.parentNodeId = parentNodeId;
    else delete next.parentNodeId;
    return next;
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SAVES_STORE, SAVE_SUMMARIES_STORE], 'readwrite');
    const saveStore = tx.objectStore(SAVES_STORE);
    const summaryStore = tx.objectStore(SAVE_SUMMARIES_STORE);
    const saveRequest = saveStore.get(item.id);
    saveRequest.onsuccess = () => {
      const row = saveRequest.result as (存档数据 & { saveTree?: 存档树元信息 }) | undefined;
      if (row?.saveTree) saveStore.put({ ...row, saveTree: patchTree(row.saveTree) });
      const summaryRequest = summaryStore.get(item.id);
      summaryRequest.onsuccess = () => {
        const summaryRow = summaryRequest.result as { saveTree?: 存档树元信息 } | undefined;
        if (summaryRow?.saveTree) summaryStore.put({ ...summaryRow, saveTree: patchTree(summaryRow.saveTree) });
      };
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(toError(tx.error));
    tx.onabort = () => reject(toError(tx.error ?? new Error('自动档窗口重定父节点事务已中止。')));
  });
}

// 同一父节点下可存在多个未封版子叶（读检查点分叉所致）；多叶歧义时返回 null 报告冲突，不按保存 ID 猜测。

async function findUnsealedChildLeaf(
  parentNodeId: string,
  expectedChildNodeId?: string | null,
): Promise<SaveListItemSummary | null> {
  const snapshot = await getSaveCatalogSnapshot();
  const children = snapshot.items.filter((item) =>
    item.saveTree?.parentNodeId === parentNodeId
    && item.unsealedHead === true,
  );
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  if (expectedChildNodeId) {
    const match = children.find((item) => item.saveTree?.nodeId === expectedChildNodeId);
    if (match) return match;
  }
  devLogError('save', 'recover-ambiguous-children', '同一父节点下存在多个未封版子叶子，无法按明确身份恢复，报告冲突而非猜测', {
    parentNodeId,
    expectedChildNodeId: expectedChildNodeId ?? null,
    children: children.map((item) => ({ nodeId: item.saveTree?.nodeId ?? null, saveId: item.id })),
  });
  return null;
}

/** 必须采纳已存在的子叶而非新建分叉：分叉会把 queueTasks 重置为空。 */
export async function adoptUnsealedChildLeaf(
  parentNodeId: string,
): Promise<NewestStory记录 | null> {
  const newest = await loadNewestStory();
  const child = await findUnsealedChildLeaf(parentNodeId, newest.pendingChildNodeId);
  const childNodeId = child?.saveTree?.nodeId;
  if (!child || !childNodeId) return null;
  const next = 指向NewestStory记录(newest, childNodeId);
  await saveNewestStory(next);
  devLog('save', 'adopt-orphan-child-leaf', {
    fromNodeId: parentNodeId,
    childNodeId,
    childSaveId: child.id,
  });
  return next;
}

/** sealed-conflict 状态不可写，调用方不得把检查点当作工作区水合。 */
export type ActiveLeafLoadResult =
  | { status: 'ok'; newest: NewestStory记录; leaf: 存档数据 }
  | { status: 'no-leaf'; newest: NewestStory记录 }
  | { status: 'sealed-conflict'; newest: NewestStory记录 };

export async function loadActiveLeaf(): Promise<ActiveLeafLoadResult> {
  let newest = await loadNewestStory();
  if (!newest.headNodeId) return { status: 'no-leaf', newest };
  const saveId = await loadSaveIdByNodeId(newest.headNodeId);
  if (!saveId) return { status: 'no-leaf', newest };
  const rawLeaf = await loadSave(saveId);
  if (!rawLeaf) return { status: 'no-leaf', newest };
  const leaf = rawLeaf;
  if (!isUnsealedHeadSave(leaf)) {
    const fromNodeId = newest.headNodeId;
    const child = await findUnsealedChildLeaf(fromNodeId, newest.pendingChildNodeId);
    const childNodeId = child?.saveTree?.nodeId;
    if (child && childNodeId) {
      const next = 指向NewestStory记录(newest, childNodeId);
      await saveNewestStory(next);
      newest = next;
      const adoptedLeaf = await loadSave(child.id);
      if (!adoptedLeaf) return { status: 'no-leaf', newest };
      devLog('save', 'active-leaf-adopted-child', {
        fromNodeId,
        childNodeId,
        childSaveId: child.id,
      });
      return { status: 'ok', newest, leaf: adoptedLeaf };
    }
    devLog('save', 'active-leaf-sealed-conflict', {
      fromNodeId,
      headNodeId: newest.headNodeId,
    });
    return { status: 'sealed-conflict', newest };
  }
  return { status: 'ok', newest, leaf };
}

export async function isActiveLeafWritable(headNodeId: string): Promise<boolean> {
  const saveId = await loadSaveIdByNodeId(headNodeId);
  if (!saveId) return false;
  const db = await openDB();
  const raw = await loadRawSave(db, saveId);
  return raw !== null && isUnsealedHeadSave(raw);
}

/**
 * delta-only 存储的历史行需先经 delta 链恢复全量再合并。
 * 「复核未封版 + 写入」必须在同一 readwrite 事务内完成，否则 sealLeafRow 可能在本事务提交前改写该行。
 */
async function putHeadRow(saveId: number, patch: Partial<存档数据>): Promise<void> {
  const startedAt = Date.now();
  const patchWithoutId = omitKeys(patch, ['id'] as const);
  const patchKeys = Object.keys(patchWithoutId);
  const db = await openDB();
  const rawPreview = await loadRawSave(db, saveId);
  if (!rawPreview) {
    const error = new Error('未找到要写入的草稿存档。');
    devLogError('save', 'puthead-rejected-missing', error, { saveId });
    throw error;
  }
  const restoredPreview = isDeltaOnlyStoredSave(rawPreview)
    ? await restoreDeltaSaveIfNeeded(db, rawPreview)
    : null;
  let restoredFromDelta = false;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SAVES_STORE, SAVE_SUMMARIES_STORE, SAVE_NODE_DELTAS_STORE, SAVE_ASSETS_STORE], 'readwrite');
    const saveStore = tx.objectStore(SAVES_STORE);
    const assetStore = tx.objectStore(SAVE_ASSETS_STORE);
    const summaryStore = tx.objectStore(SAVE_SUMMARIES_STORE);
    const deltaStore = tx.objectStore(SAVE_NODE_DELTAS_STORE);
    const readRequest = saveStore.get(saveId);
    readRequest.onsuccess = () => {
      const raw = readRequest.result as StoredSaveMeta | undefined;
      if (!raw) {
        const error = new Error('未找到要写入的草稿存档。');
        devLogError('save', 'puthead-rejected-missing', error, { saveId });
        reject(error);
        return;
      }
      if (!isUnsealedHeadSave(raw)) {
        const error = new Error('已封版历史节点不可通过 putHeadRow 改写。');
        devLogError('save', 'puthead-rejected-sealed', error, { saveId });
        reject(error);
        return;
      }
      restoredFromDelta = isDeltaOnlyStoredSave(raw);
      const current = restoredFromDelta ? (restoredPreview ?? raw) : raw;
      const next = { ...current, ...patchWithoutId, id: saveId } as StoredSaveMeta;
      /*
       * 图片字节必须在这里落进 `saveAssets`。
       *
       * `stripSaveAssetPayloadForStorage` 只把 `相册.assets[].dataUrl` 改写成 `asset:<id>`
       * 引用，**不会**保存字节本身；字节由调用方负责写进独立 store。
       * 新建叶子（`createLeafNode`）与整档保存（`saveGameInternal`）都做了这一步，
       * 而改活跃叶子这条路原来漏了 —— 于是回合外生成/重生的插图只有引用、
       * 没有字节，重新进入后图与相册一起消失（实际反馈过）。
       */
      const nextStored = stripSaveAssetPayloadForStorage(next);
      const assetRecords = materializeSaveAssetRecords(extractSaveAssetRecords(nextStored));
      for (const record of assetRecords) assetStore.put(record);
      saveStore.put(nextStored);
      summaryStore.put(createCatalogRecordFromSummary(buildSaveSummary(nextStored)));
      const delta = buildSaveNodeDeltaRecord(nextStored, saveId);
      if (delta) deltaStore.put(delta);
    };
    readRequest.onerror = () => reject(toError(readRequest.error));
    tx.oncomplete = () => {
      devLog('save', 'puthead', {
        saveId,
        fieldCount: patchKeys.length,
        restoredFromDelta,
        durationMs: Date.now() - startedAt,
      });
      resolve();
    };
    tx.onerror = () => reject(toError(tx.error));
    tx.onabort = () => reject(tx.error ?? new Error('草稿存档写入事务已中止。'));
  });
}

export async function writeLeafNode(nodeId: string, patch: Partial<存档数据>): Promise<void> {
  const saveId = await loadSaveIdByNodeId(nodeId);
  if (!saveId) {
    throw new Error(`写入叶子失败：活跃叶子节点不存在（nodeId=${nodeId}）。`);
  }
  await putHeadRow(saveId, patch);
}

export async function getSaveTreeNodeSubtree(rootId: string, nodeId: string): Promise<SaveListItemSummary[]> {
  const subtree = await collectSaveTreeNodeSubtreeSummaries(rootId.trim(), nodeId.trim());
  return subtree.sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
}

async function getNearestLivingAncestor(
  rootId: string,
  nodeId: string,
  excludedNodeIds: ReadonlySet<string>,
): Promise<SaveListItemSummary | null> {
  const normalizedRootId = rootId.trim();
  const normalizedNodeId = nodeId.trim();
  if (!normalizedRootId || !normalizedNodeId) return null;
  const tree = await collectSaveTreeSummaries(normalizedRootId);
  const nodeById = new Map<string, SaveListItemSummary>();
  for (const item of tree) {
    const treeNodeId = item.saveTree?.nodeId;
    if (treeNodeId) nodeById.set(treeNodeId, item);
  }
  let cursor = nodeById.get(normalizedNodeId)?.saveTree?.parentNodeId ?? null;
  while (cursor) {
    if (!excludedNodeIds.has(cursor)) {
      const summary = nodeById.get(cursor);
      if (summary) return summary;
    }
    cursor = nodeById.get(cursor)?.saveTree?.parentNodeId ?? null;
  }
  return null;
}

export interface ForkSaveTreeLeafResult {
  headNodeId: string | null;
}

/** 备份类检查点只在 legacyBackups 中，仅查 items 会漏掉。 */
export async function forkSaveTreeLeaf(params: {
  rootId: string;
  targetNodeId: string;
  branchName?: string;
}): Promise<ForkSaveTreeLeafResult> {
  return runWithSaveMutationPriority(async () => {
    const rootId = params.rootId.trim();
    const targetNodeId = params.targetNodeId.trim();
    if (!rootId || !targetNodeId) {
      throw new Error('分叉存档树需要 rootId 与目标节点 ID。');
    }
    const catalog = await getSaveCatalogSnapshot();
    if (!catalog.catalogComplete) {
      throw new Error(`仍有 ${catalog.pendingIds.length} 个节点目录待恢复，请先完成恢复后再分叉存档树。`);
    }
    const targetSummary = [...catalog.items, ...catalog.legacyBackups]
      .find((item) => item.saveTree?.nodeId === targetNodeId);
    if (!targetSummary || targetSummary.saveTree?.rootId !== rootId) {
      throw new Error(`未找到要分叉的目标检查点：${targetNodeId}`);
    }
    const targetSave = await loadSave(targetSummary.id);
    if (!targetSave) {
      throw new Error(`目标检查点数据缺失：${targetNodeId}`);
    }
    const targetTree = (targetSave as SaveWithTree).saveTree;
    if (!targetTree?.nodeId) {
      throw new Error(`目标检查点缺少存档树元信息：${targetNodeId}`);
    }
    const branchName = typeof params.branchName === 'string' && params.branchName.trim()
      ? params.branchName.trim()
      : undefined;
    const headNodeId = createUnifiedId();
    const timestamp = Date.now();
    const targetFields = omitKeys(
      targetSave as StoredSaveMeta & { saveStorage?: unknown },
      ['id', 'saveStorage', 'saveRuntime', 'queueTasks'] as const,
    );
    const leafPayload = resetEphemeralFields({
      ...targetFields,
      id: 0,
      type: 'auto' as const,
      timestamp,
      queueTasks: [],
      saveTree: {
        rootId: targetTree.rootId,
        nodeId: headNodeId,
        parentNodeId: targetTree.nodeId,
        ...(branchName ? { branchName } : {}),
        createdAt: timestamp,
      },
    }) as 存档数据;
    await createLeafNode(leafPayload);
    const newest = await loadNewestStory();
    await saveNewestStory(指向NewestStory记录(newest, headNodeId));
    devLog('save', 'tree-fork-leaf', {
      rootId,
      targetNodeId,
      targetSaveId: targetSummary.id,
      headNodeId,
      branchName,
    });
    return { headNodeId };
  });
}

export interface DeleteSaveTreeNodeResult {
  deletedCount: number;
  deletedLeaf: boolean;
  newestRedirected: boolean;
}

export async function deleteSaveTreeNode(params: {
  rootId: string;
  nodeId: string;
}): Promise<DeleteSaveTreeNodeResult> {
  return runWithSaveMutationPriority(() => deleteSaveTreeNodeInternal(params.rootId.trim(), params.nodeId.trim()));
}

async function deleteSaveTreeNodeInternal(rootId: string, nodeId: string): Promise<DeleteSaveTreeNodeResult> {
  if (!rootId || !nodeId) {
    throw new Error('删除存档树节点需要 rootId 与 nodeId。');
  }
  const catalog = await getSaveCatalogSnapshot();
  if (!catalog.catalogComplete) {
    throw new Error(`仍有 ${catalog.pendingIds.length} 个节点目录待恢复，完成后才能删除存档树节点。`);
  }
  const subtree = await collectSaveTreeNodeSubtreeSummaries(rootId, nodeId);
  if (!subtree.length) {
    throw new Error(`未找到要删除的存档树节点：${nodeId}`);
  }
  return performTreeNodeDeletion(rootId, catalog, subtree);
}

export async function deleteSaveTree(rootId: string): Promise<number> {
  return runWithSaveMutationPriority(() => deleteSaveTreeInternal(rootId));
}

async function deleteSaveTreeInternal(rootId: string): Promise<number> {
  const trimmedRootId = rootId.trim();
  if (!trimmedRootId) return 0;
  const catalog = await getSaveCatalogSnapshot();
  if (!catalog.catalogComplete) {
    throw new Error(`仍有 ${catalog.pendingIds.length} 个节点目录待恢复，完成后才能删除整棵存档树。`);
  }
  const tree = await collectSaveTreeSummaries(trimmedRootId);
  if (!tree.length) return 0;
  const result = await performTreeNodeDeletion(trimmedRootId, catalog, tree);
  return result.deletedCount;
}

async function performTreeNodeDeletion(
  rootId: string,
  catalog: SaveCatalogSnapshot,
  subtree: SaveListItemSummary[],
): Promise<DeleteSaveTreeNodeResult> {
  const deletedNodeIds = new Set<string>();
  for (const item of subtree) {
    const nodeId = item.saveTree?.nodeId;
    if (nodeId) deletedNodeIds.add(nodeId);
  }

  const db = await openDB();
  await deleteManagedSaveItems(db, subtree);

  const newest = await loadNewestStory();
  const currentHeadNodeId = newest.headNodeId;
  const headDeleted = currentHeadNodeId !== null && deletedNodeIds.has(currentHeadNodeId);

  let newestRedirected = false;
  if (headDeleted) {
    const ancestor = currentHeadNodeId
      ? await getNearestLivingAncestor(rootId, currentHeadNodeId, deletedNodeIds)
      : null;
    if (ancestor && ancestor.saveTree?.nodeId) {
      await saveNewestStory(指向NewestStory记录(newest, ancestor.saveTree.nodeId));
      newestRedirected = true;
    } else {
      await saveNewestStory(创建空NewestStory记录());
      newestRedirected = true;
    }
    devLog('save', 'tree-delete-newest-redirect', {
      rootId,
      deletedCount: subtree.length,
      oldHeadNodeId: newest.headNodeId,
      redirectedTo: ancestor?.saveTree?.nodeId ?? null,
      reason: ancestor ? 'living-ancestor' : 'no-living-ancestor',
    });
  }

  devLog('save', 'tree-delete-node', {
    rootId,
    deletedCount: subtree.length,
    deletedLeaf: subtree.length === 1,
    newestRedirected,
  });
  return { deletedCount: subtree.length, deletedLeaf: subtree.length === 1, newestRedirected };
}

async function collectSaveTreeSummaries(rootId: string): Promise<SaveListItemSummary[]> {
  const snapshot = await getSaveCatalogSnapshot();
  return snapshot.items.filter((item) => item.saveTree?.rootId === rootId);
}

async function collectSaveTreeNodeSubtreeSummaries(rootId: string, nodeId: string): Promise<SaveListItemSummary[]> {
  const tree = await collectSaveTreeSummaries(rootId);
  const nodeById = new Map<string, SaveListItemSummary>();
  for (const item of tree) {
    const treeNodeId = item.saveTree?.nodeId;
    if (treeNodeId) nodeById.set(treeNodeId, item);
  }
  if (!nodeById.has(nodeId)) return [];
  const childrenIndex = buildTreeChildrenIndex(tree);
  const result: SaveListItemSummary[] = [];
  const stack: string[] = [nodeId];
  let current = stack.pop();
  while (current) {
    const summary = nodeById.get(current);
    if (summary) result.push(summary);
    const children = childrenIndex.get(current) ?? [];
    for (const child of children) {
      const childNodeId = child.saveTree?.nodeId;
      if (childNodeId) stack.push(childNodeId);
    }
    current = stack.pop();
  }
  return result;
}

function buildTreeChildrenIndex(summaries: SaveListItemSummary[]): Map<string, SaveListItemSummary[]> {
  const children = new Map<string, SaveListItemSummary[]>();
  for (const item of summaries) {
    const parentNodeId = item.saveTree?.parentNodeId;
    if (!parentNodeId) continue;
    const list = children.get(parentNodeId) ?? [];
    list.push(item);
    children.set(parentNodeId, list);
  }
  return children;
}

export async function deleteLegacyBackupSaves(): Promise<number> {
  return runWithSaveMutationPriority(async () => {
    const catalog = await getSaveCatalogSnapshot();
    if (!catalog.legacyBackups.length) return 0;
    const db = await openDB();
    await deleteManagedSaveItems(db, catalog.legacyBackups);
    return catalog.legacyBackups.length;
  });
}

export async function loadSaveTree(rootId: string): Promise<存档数据[]> {
  const list = (await getSaveCatalogSnapshot()).items;
  const treeItems = list
    .filter((item) => item.saveTree?.rootId === rootId)
    .sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
  const saves: 存档数据[] = [];
  for (const item of treeItems) {
    const save = await loadSave(item.id);
    if (save) saves.push(save);
  }
  return saves;
}

export async function loadNewestStory(): Promise<NewestStory记录> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NEWEST_STORY_STORE, 'readonly');
    const request = tx.objectStore(NEWEST_STORY_STORE).get(NEWEST_STORY_STORE_KEY);
    request.onsuccess = () => resolve(归一化NewestStory记录(request.result));
    request.onerror = () => {
      const error = request.error;
      reject(error instanceof Error ? error : new Error('读取 newestStory 记录失败。'));
    };
  });
}

export async function saveNewestStory(record: NewestStory记录): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(NEWEST_STORY_STORE, 'readwrite');
    tx.objectStore(NEWEST_STORY_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      const error = tx.error;
      reject(error instanceof Error ? error : new Error('写入 newestStory 记录失败。'));
    };
  });
}
