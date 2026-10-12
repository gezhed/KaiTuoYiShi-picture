import { useMemo } from 'react';
import type { 文生图系统设置 } from '@/models/genSystem';
import { 运行自检, type 检查项 } from '@/services/ai/imageGen/preflight';
import { 面板, 提示条, 设置字段 as 字段 } from '@/components/features/Settings/settingsPrimitives';

const 级别样式: Record<检查项['级别'], { 色: string; 前缀: string }> = {
  error: { 色: 'rgb(var(--tj-danger))', 前缀: '✕' },
  warning: { 色: 'rgb(var(--tj-warning))', 前缀: '!' },
  info: { 色: 'rgba(var(--tj-text-secondary), 0.8)', 前缀: 'i' },
};

/**
 * 自检面板。
 *
 * 存在的理由是「配置错误」与「运行时错误」在现象上无法区分——都是「不出图」，
 * 但排查方向完全不同。这里在发请求前把它们分开，且不联网、不消耗额度。
 *
 * `可选资源` 由设置页在「测试连接」后传入，用于校验工作流里写死的模型名是否
 * 真的存在——这是客户端唯一能提前发现 `Value not in list` 的办法。
 */
export function SelfCheckPanel({
  系统,
  可选资源,
}: {
  系统: 文生图系统设置;
  可选资源?: import('@/services/ai/imageGen/comfyClient').Comfy可选资源 | null;
}) {
  const 结果 = useMemo(() => 运行自检(系统, 可选资源), [系统, 可选资源]);
  const 错误数 = 结果.检查项.filter((项) => 项.级别 === 'error').length;
  const 警告数 = 结果.检查项.filter((项) => 项.级别 === 'warning').length;

  return (
    <面板
      title="自检"
      desc="在发请求之前检查配置。不联网、不消耗任何额度。"
    >
      <提示条
        kind={结果.可出图 ? (警告数 > 0 ? 'info' : 'ok') : 'error'}
        text={结果.可出图
          ? (警告数 > 0
            ? `基本条件已满足，但有 ${警告数} 项警告需要留意。`
            : '配置完整，可以出图。')
          : `有 ${错误数} 项阻塞问题，现在出图一定会失败。`}
      />

      <div className="space-y-1">
        {结果.检查项.length === 0 ? (
          <提示条 kind="ok" text="没有发现任何问题。" />
        ) : (
          结果.检查项.map((项, 序号) => {
            const 样式 = 级别样式[项.级别];
            return (
              <div
                key={`${项.标题}-${序号}`}
                className="flex gap-2 px-2 py-1.5 text-[11px] leading-relaxed"
                style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
              >
                <span className="shrink-0 font-mono font-bold" style={{ color: 样式.色 }}>{样式.前缀}</span>
                <div className="min-w-0 flex-1">
                  <div style={{ color: 样式.色 }}>{项.标题}</div>
                  <div className="mt-0.5" style={{ color: 'rgba(var(--tj-text-secondary), 0.85)' }}>{项.说明}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <字段 label="当前渠道" hint="切换渠道后重新自检，各渠道的检查项不同。">
        <div className="text-[11px] font-mono" style={{ color: 'rgba(var(--tj-text-secondary), 0.85)' }}>
          {结果.渠道}
        </div>
      </字段>
    </面板>
  );
}
