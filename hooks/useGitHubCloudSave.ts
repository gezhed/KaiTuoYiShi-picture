import { useCallback, useEffect, useRef, useState } from 'react';
import { useGitHubOAuth } from '@/hooks/useGitHubOAuth';
import type { CloudTransferSaveBundle } from '@/contracts/cloudSave';
import type { SaveCatalogSnapshot } from '@/contracts/storage';
import { buildCompleteCloudBackup } from '@/services/cloudBackupBuilder';
import { mergeDownloadedCloudBackup, mergeLegacyCloudBackup } from '@/services/cloudBackupMerge';
import {
  bindGitHubCloudAccount,
  createDefaultGitHubCloudConfig,
  downloadCompleteBackupFromGitHub,
  downloadLegacySaveFromGitHub,
  getGitHubAccountInfo,
  inspectGitHubCloudBackup,
  uploadCompleteBackupToGitHub,
  type GitHubAccountInfo,
  type GitHubCloudBackupListing,
  type GitHubCloudSaveConfig,
} from '@/services/githubCloudSave';

export type { GitHubCloudBackupListing } from '@/services/githubCloudSave';

export interface GitHubCloudSaveDeps {
  onLoadCloudConfig: () => Promise<GitHubCloudSaveConfig | null>;
  onPersistCloudConfig: (next: GitHubCloudSaveConfig) => Promise<void>;
  onGetSaveCatalogSnapshot: () => Promise<SaveCatalogSnapshot>;
  onLoadSaveForCloudTransfer: (id: number) => Promise<CloudTransferSaveBundle | null>;
}

export function useGitHubCloudSave({
  onLoadCloudConfig,
  onPersistCloudConfig,
  onGetSaveCatalogSnapshot,
  onLoadSaveForCloudTransfer,
}: GitHubCloudSaveDeps) {
  const [cloudConfig, setCloudConfig] = useState<GitHubCloudSaveConfig>(createDefaultGitHubCloudConfig);
  const [cloudBackup, setCloudBackup] = useState<GitHubCloudBackupListing | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMessage, setCloudMessage] = useState('');
  const [account, setAccount] = useState<GitHubAccountInfo | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ label: string; current: number; total: number } | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const { pending: oauthPending, error: oauthError, startGitHubOAuth, consumeGitHubOAuthCallback } = useGitHubOAuth();

  const patchCloudConfig = (patch: Partial<GitHubCloudSaveConfig>) => {
    setCloudConfig((prev) => ({ ...prev, ...patch }));
  };

  const persistCloudConfig = useCallback(async (next: GitHubCloudSaveConfig) => {
    const clean = {
      ...next,
      owner: next.owner.trim(),
      repo: next.repo.trim(),
      branch: next.branch.trim() || 'main',
      rootPath: next.rootPath.trim() || 'kaituoyishi-cloud',
      token: next.token.trim(),
    };
    await onPersistCloudConfig(clean);
    setCloudConfig(clean);
    return clean;
  }, [onPersistCloudConfig]);

  useEffect(() => {
    onLoadCloudConfig()
      .then((saved) => {
        if (!saved) return;
        const next = { ...createDefaultGitHubCloudConfig(), ...saved };
        setCloudConfig(next);
        if (next.token) {
          getGitHubAccountInfo(next.token)
            .then(setAccount)
            .catch(() => {});
          inspectGitHubCloudBackup(next)
            .then(setCloudBackup)
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [onLoadCloudConfig]);

  useEffect(() => {
    if (window.location.pathname !== '/oauth/github/callback') return;
    const cancelled: { current: boolean } = { current: false };
    const isCancelled = (): boolean => cancelled.current;
    void (async () => {
      await Promise.resolve();
      if (isCancelled()) return;
      setCloudBusy(true);
      setCloudMessage('正在完成 GitHub 授权绑定...');
      const token = await consumeGitHubOAuthCallback();
      if (!token || isCancelled()) return;
      const result = await bindGitHubCloudAccount(token);
      if (isCancelled()) return;
      await persistCloudConfig(result.config);
      if (isCancelled()) return;
      setAccount(result.account);
      const listing = await inspectGitHubCloudBackup(result.config);
      if (isCancelled()) return;
      setCloudBackup(listing);
      setCloudMessage(`已绑定 GitHub：${result.account.login}。`);
    })().catch((err: unknown) => {
      if (!isCancelled()) setCloudMessage(err instanceof Error ? err.message : 'GitHub OAuth 绑定失败。');
    }).finally(() => {
      if (!isCancelled()) setCloudBusy(false);
    });
    return () => {
      cancelled.current = true;
    };
  }, [consumeGitHubOAuthCallback, persistCloudConfig]);

  useEffect(() => () => {
    activeControllerRef.current?.abort(new DOMException('云备份弹窗已关闭。', 'AbortError'));
  }, []);

  const runCloudTask = async (task: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    activeControllerRef.current = controller;
    setCloudBusy(true);
    setCloudMessage('');
    setSyncProgress(null);
    try {
      await task(controller.signal);
    } catch (err) {
      if (controller.signal.aborted) setCloudMessage('云备份操作已取消，本地存档和当前有效云备份均未被覆盖。');
      else setCloudMessage(err instanceof Error ? err.message : 'GitHub 云存档操作失败。');
    } finally {
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
      setCloudBusy(false);
      setSyncProgress(null);
    }
  };

  const updateProgress = (progress: { label: string; current: number; total: number }) => setSyncProgress({
    ...progress,
    total: Math.max(1, progress.total),
  });

  const handleBindAccount = () => runCloudTask(async (signal) => {
    const token = cloudConfig.token.trim();
    const result = await bindGitHubCloudAccount(token, signal);
    await persistCloudConfig(result.config);
    setAccount(result.account);
    const listing = await inspectGitHubCloudBackup(result.config, { signal });
    setCloudBackup(listing);
    setCloudMessage(`已绑定 GitHub：${result.account.login}。`);
  });

  const handleOAuthBind = () => runCloudTask(async () => {
    await startGitHubOAuth();
  });

  const handleUnbind = () => runCloudTask(async () => {
    await persistCloudConfig(createDefaultGitHubCloudConfig());
    setAccount(null);
    setCloudBackup(null);
    setCloudMessage('已解除本机 GitHub 云存档绑定。云端文件不会被删除。');
  });

  const handleCloudRefresh = () => runCloudTask(async (signal) => {
    const config = await persistCloudConfig(cloudConfig);
    const listing = await inspectGitHubCloudBackup(config, { signal });
    setCloudBackup(listing);
    setCloudMessage(listing.format === 'empty'
      ? '云端还没有完整备份。'
      : `已刷新云端备份：${listing.nodeCount} 个节点。`);
  });

  const handleCloudSyncAll = () => runCloudTask(async (signal) => {
    const config = await persistCloudConfig(cloudConfig);
    const snapshot = await onGetSaveCatalogSnapshot();
    if (!snapshot.items.length && !snapshot.legacyBackups.length) throw new Error('本地还没有可上传的存档。');
    const built = await buildCompleteCloudBackup({
      summaries: snapshot.items,
      legacyBackups: snapshot.legacyBackups,
      catalogComplete: snapshot.catalogComplete,
      pendingCount: snapshot.pendingIds.length,
      unreadableCount: snapshot.unreadableIds.length,
      loadSaveBundle: onLoadSaveForCloudTransfer,
    }, {
      signal,
      onProgress: updateProgress,
    });
    setCloudMessage(`完整备份已打包为 ${built.pointer.parts.length} 个分卷，正在上传。`);
    const pointer = await uploadCompleteBackupToGitHub(config, built.transferId, built.pointer, {
      signal,
      onProgress: updateProgress,
    });
    setCloudBackup({
      format: 'v2',
      updatedAt: pointer.createdAt,
      nodeCount: pointer.nodeCount,
      treeCount: pointer.treeCount,
      assetCount: pointer.assetCount,
      totalBytes: pointer.totalBytes,
      pointer,
    });
    setCloudMessage(`完整云备份已提交：${pointer.nodeCount} 个节点、${pointer.treeCount} 棵存档树、${pointer.parts.length} 个分卷。`);
  });

  const handleCloudDownloadAll = () => runCloudTask(async (signal) => {
    const config = await persistCloudConfig(cloudConfig);
    const listing = await inspectGitHubCloudBackup(config, { signal });
    if (listing.format === 'empty') throw new Error('云端还没有可下载的存档。');
    const confirmed = window.confirm(
      `将下载云端的 ${listing.nodeCount} 个节点并与本地存档合并。\n\n相同节点和资源会跳过；发生 ID 冲突时保留本地，并把云端冲突树作为新副本导入。本地现有存档不会被清空。确定继续吗？`,
    );
    if (!confirmed) return;

    const pointer = listing.pointer;
    let result;
    if (listing.format === 'v2' && pointer) {
      const downloaded = await downloadCompleteBackupFromGitHub(config, pointer, {
        signal,
        onProgress: updateProgress,
      });
      result = await mergeDownloadedCloudBackup(downloaded.transferId, downloaded.pointer, {
        signal,
        onProgress: updateProgress,
      });
    } else {
      const legacyItems = listing.legacyManifest?.saves ?? [];
      // 回调入参是 LegacyCloudBackupItem，下载需要同序的 GitHubCloudSaveItem，故按下标取原始项。
      result = await mergeLegacyCloudBackup(legacyItems, async (_item, index, mergeSignal) =>
        downloadLegacySaveFromGitHub(config, legacyItems[index], {
          signal: mergeSignal,
          onProgress: updateProgress,
        }), {
        signal,
        onProgress: updateProgress,
      });
    }
    setCloudBackup(listing);
    setCloudMessage(`合并完成：新增 ${result.addedNodes} 个节点，跳过 ${result.skippedDuplicateNodes} 个重复节点，冲突树副本 ${result.remappedConflictTrees} 棵；新增资源 ${result.addedAssets} 个，复用 ${result.reusedAssets} 个。`);
  });

  const handleCancel = () => {
    activeControllerRef.current?.abort(new DOMException('用户取消了云备份操作。', 'AbortError'));
  };

  return {
    cloudConfig,
    cloudBackup,
    cloudBusy,
    cloudMessage,
    account,
    syncProgress,
    oauthPending,
    oauthError,
    patchCloudConfig,
    handleBindAccount,
    handleOAuthBind,
    handleUnbind,
    handleCloudRefresh,
    handleCloudSyncAll,
    handleCloudDownloadAll,
    handleCancel,
  };
}
