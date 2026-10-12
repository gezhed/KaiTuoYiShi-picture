import { useState } from 'react';
import { useGitHubCloudSave, type GitHubCloudSaveDeps, type GitHubCloudBackupListing } from '@/hooks/useGitHubCloudSave';
import { cardClip, smallClip, tinyClip } from '@/components/ui/clipPaths';

interface Props extends GitHubCloudSaveDeps {
  onClose: () => void;
}


export function GitHubCloudSaveModal(props: Props) {
  const { onClose, ...deps } = props;
  const {
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
  } = useGitHubCloudSave(deps);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleClose = () => {
    handleCancel();
    onClose();
  };

  return (
    <div
      className="kaituo-modal-overlay fixed inset-0 z-50 flex items-stretch justify-center p-0 md:items-center md:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        className="flex h-[100dvh] w-full max-w-[920px] flex-col overflow-hidden md:h-[82vh]"
        style={{
          background: 'linear-gradient(180deg, rgba(var(--tj-bg-secondary), 0.97), rgba(var(--tj-bg-primary), 0.98))',
          boxShadow:
            'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.45), 0 0 32px rgba(var(--tj-accent-primary), 0.12), 0 20px 60px rgba(0, 0, 0, 0.6)',
        }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-5" style={{ borderBottom: '1px solid rgba(var(--tj-accent-primary), 0.25)' }}>
          <div>
            <h2 className="font-serif text-lg font-bold tracking-[0.22em] md:tracking-[0.3em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
              GitHub 云存档
            </h2>
            <p className="mt-1 text-[12px] tracking-wider" style={{ color: 'rgba(var(--tj-text-secondary), 0.72)' }}>
              先打包一份完整备份再上传；下载后与本地合并去重，不会清空现有存档。
            </p>
          </div>
          <button onClick={handleClose} className="kaituo-close-btn" aria-label="关闭">
            X
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 md:px-5">
          <section className="space-y-4">
            <div
              className="px-3 py-3 text-[12px] leading-relaxed tracking-wider"
              style={{
                color: 'rgba(var(--tj-text-secondary), 0.82)',
                background: 'rgba(var(--tj-bg-secondary), 0.42)',
                border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
                clipPath: cardClip,
              }}
            >
              绑定后会自动使用或创建私有仓库 <span className="font-mono">kaituoyishi-cloud-save</span>。上传会先在本机生成有界分卷，再以一次提交发布完整备份；下载只会合并新增内容，重复项自动跳过。
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div
                className="px-3 py-3"
                style={{
                  background: 'rgba(var(--tj-bg-primary), 0.32)',
                  border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
                  clipPath: cardClip,
                }}
              >
                {account ? (
                  <div className="flex min-w-0 items-center gap-3">
                    {account.avatarUrl && (
                      <img src={account.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-serif text-[14px] tracking-[0.16em]" style={{ color: 'rgba(var(--tj-text-primary), 0.92)' }}>
                        已绑定 {account.login}
                      </div>
                      <div className="mt-1 truncate text-[12px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.72)' }}>
                        {cloudConfig.owner}/{cloudConfig.repo} · {cloudConfig.branch}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="font-serif text-[14px] tracking-[0.16em]" style={{ color: 'rgba(var(--tj-text-primary), 0.92)' }}>
                      尚未绑定 GitHub 账号
                    </div>
                    <div className="text-[12px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.74)' }}>
                      点击授权后会跳转到 GitHub 登录，授权完成会回到开拓轶事，并自动创建或使用私有云存档仓库。
                    </div>
                  </div>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 md:min-w-[220px] md:grid-cols-1">
                <CloudButton
                  label={account ? '重新授权' : (oauthPending ? '等待授权' : 'GitHub 授权')}
                  tone="primary"
                  disabled={cloudBusy || oauthPending}
                  onClick={handleOAuthBind}
                />
                {account && <CloudButton label="解除绑定" disabled={cloudBusy} onClick={handleUnbind} />}
              </div>
            </div>

            <details open={showAdvanced} onToggle={(event) => setShowAdvanced(event.currentTarget.open)}>
              <summary className="cursor-pointer font-serif text-[12px] tracking-[0.18em]" style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.84), rgba(var(--tj-accent-secondary),0.78))' }}>
                高级配置 / Token 备用绑定
              </summary>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                <CloudInput label="Owner" value={cloudConfig.owner} onChange={(value) => patchCloudConfig({ owner: value })} placeholder="用户名或组织" />
                <CloudInput label="Repo" value={cloudConfig.repo} onChange={(value) => patchCloudConfig({ repo: value })} placeholder="私有仓库名" />
                <CloudInput label="Branch" value={cloudConfig.branch} onChange={(value) => patchCloudConfig({ branch: value })} placeholder="main" />
                <CloudInput label="Path" value={cloudConfig.rootPath} onChange={(value) => patchCloudConfig({ rootPath: value })} placeholder="kaituoyishi-cloud" />
                <CloudInput label="Token" value={cloudConfig.token} onChange={(value) => patchCloudConfig({ token: value })} placeholder="fine-grained PAT" password />
              </div>
              <div className="mt-2 max-w-[240px]">
                <CloudButton label="使用 Token 绑定" tone="primary" disabled={cloudBusy} onClick={handleBindAccount} />
              </div>
            </details>

            <div className="grid gap-2 sm:grid-cols-3">
              <CloudButton label="刷新数据" disabled={cloudBusy || !cloudConfig.token} onClick={handleCloudRefresh} />
              <CloudButton label="生成并上传完整备份" tone="primary" disabled={cloudBusy || !cloudConfig.token} onClick={handleCloudSyncAll} />
              <CloudButton label="下载并合并到本地" tone="primary" disabled={cloudBusy || !cloudConfig.token} onClick={handleCloudDownloadAll} />
            </div>

            {cloudBusy && (
              <div className="max-w-[240px]">
                <CloudButton label="取消当前任务" onClick={handleCancel} />
              </div>
            )}

            {syncProgress && (
              <CloudProgress
                label={syncProgress.label}
                current={syncProgress.current}
                total={syncProgress.total}
              />
            )}

            {(cloudMessage || oauthError) && (
              <div className="px-3 py-2 text-[12px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.82)', background: 'rgba(var(--tj-bg-primary), 0.32)', clipPath: smallClip }}>
                {cloudMessage || oauthError}
              </div>
            )}

            <CloudRecordSummary backup={cloudBackup} />
          </section>
        </div>
      </div>
    </div>
  );
}

function CloudInput({
  label,
  value,
  onChange,
  placeholder,
  password = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  password?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <div className="mb-1 font-serif text-[11px] tracking-[0.16em]" style={{ color: 'rgba(var(--tj-accent-primary), 0.76)' }}>
        {label}
      </div>
      <input
        type={password ? 'password' : 'text'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 bg-transparent px-3 py-2 text-[12px] outline-none"
        style={{
          color: 'rgba(var(--tj-text-primary), 0.9)',
          background: 'rgba(var(--tj-bg-primary), 0.34)',
          border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
          clipPath: smallClip,
        }}
      />
    </label>
  );
}

function CloudButton({
  label,
  tone = 'quiet',
  disabled,
  onClick,
}: {
  label: string;
  tone?: 'primary' | 'quiet';
  disabled?: boolean;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void onClick()}
      className="w-full px-4 py-2 text-sm font-serif tracking-[0.18em] transition-all hover:opacity-90 disabled:opacity-50"
      style={{
        color: tone === 'primary' ? 'rgb(var(--tj-bg-primary))' : 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.94), rgba(var(--tj-accent-secondary),0.9))',
        background: tone === 'primary'
          ? 'linear-gradient(135deg, rgba(var(--tj-accent-primary), 0.95), rgba(var(--tj-amber-deep), 0.95))'
          : 'rgba(var(--tj-bg-secondary), 0.55)',
        border: tone === 'primary'
          ? '1px solid rgba(var(--tj-text-primary), var(--tj-edge))'
          : '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
        clipPath: smallClip,
      }}
    >
      {label}
    </button>
  );
}

function CloudProgress({
  label,
  current,
  total,
}: {
  label: string;
  current: number;
  total: number;
}) {
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div
      className="px-3 py-3"
      style={{
        background: 'rgba(var(--tj-bg-primary), 0.32)',
        border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
        clipPath: smallClip,
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-[12px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.82)' }}>
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 font-mono">{current}/{total}</span>
      </div>
      <div
        className="h-2 overflow-hidden"
        style={{
          background: 'rgba(var(--tj-bg-secondary), 0.8)',
          border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
          clipPath: tinyClip,
        }}
      >
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${percent}%`,
            background: 'linear-gradient(90deg, rgba(var(--tj-accent-primary), 0.95), rgba(var(--tj-amber-deep), 0.95))',
          }}
        />
      </div>
    </div>
  );
}

function CloudRecordSummary({ backup }: { backup: GitHubCloudBackupListing | null }) {
  return (
    <div
      className="grid gap-2 px-3 py-3 text-[12px] sm:grid-cols-[auto_1fr]"
      style={{
        background: 'rgba(var(--tj-bg-primary), 0.3)',
        border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
        clipPath: smallClip,
      }}
    >
      <div className="font-serif tracking-[0.18em]" style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.86), rgba(var(--tj-accent-secondary),0.82))' }}>
        最近云端记录
      </div>
      <div style={{ color: 'rgba(var(--tj-text-secondary), 0.78)' }}>
        {backup && backup.format !== 'empty'
          ? `${new Date(backup.updatedAt).toLocaleString('zh-CN')} · ${backup.nodeCount} 个节点${backup.treeCount ? ` · ${backup.treeCount} 棵树` : ''} · ${formatCloudBytes(backup.totalBytes)}${backup.format === 'v1' ? ' · 旧版格式' : ''}`
          : '暂无云端完整备份'}
      </div>
    </div>
  );
}

function formatCloudBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${Math.max(0, bytes)} B`;
}
