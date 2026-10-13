import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, RefreshCw, ShieldCheck, ShieldOff, Smartphone, Wifi } from 'lucide-react';

import { QrCode } from '@/components/ui/QrCode';
import { cardClip, smallClip } from '@/components/ui/clipPaths';
import { 拉取局域网信息, 设置访问口令, type LanInfo } from '@/services/localSave/lanPlay';
import { 强制全量落盘, 统计本机存档 } from '@/services/storage/diskPersistence';

const 防火墙命令 = 'netsh advfirewall firewall add rule name="KaiTuoYiShi LAN 3000" dir=in action=allow protocol=TCP localport=3000';

async function 复制到剪贴板(文本: string): Promise<boolean> {
  // 局域网 HTTP 下 navigator.clipboard 可能不存在；缺失时提示用户手动复制。
  const 剪贴板 = (navigator as { clipboard?: Clipboard }).clipboard;
  if (!剪贴板?.writeText) return false;
  try {
    await 剪贴板.writeText(文本);
    return true;
  } catch {
    return false;
  }
}

const 计数标签: Record<string, string> = {
  saves: '存档',
  saveSummaries: '摘要',
  newestStory: '当前进度',
  settings: '设置',
  saveNodeDeltas: '增量',
  saveAssets: '资源',
};

function 计数文本(统计: Record<string, number> | null): string {
  if (!统计) return '读取中…';
  return ['saves', 'saveSummaries', 'newestStory', 'settings']
    .map((k) => `${计数标签[k] ?? k} ${统计[k] ?? 0}`)
    .join(' · ');
}

function 小标签(文字: string, 色: string): ReactElement {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] tracking-wider"
      style={{ background: `rgba(${色}, 0.14)`, color: `rgb(${色})`, border: `1px solid rgba(${色}, 0.32)` }}
    >
      {文字}
    </span>
  );
}

export function LanPlaySettingsTab(): ReactElement {
  const [信息, set信息] = useState<LanInfo | null>(null);
  const [本机统计, set本机统计] = useState<Record<string, number> | null>(null);
  const [载入中, set载入中] = useState(true);
  const [提示, set提示] = useState<string | null>(null);
  const [已复制, set已复制] = useState<string | null>(null);

  const 应用结果 = useCallback((结果: LanInfo | null): void => {
    set信息(结果);
    set载入中(false);
    统计本机存档().then(set本机统计).catch(() => set本机统计(null));
  }, []);

  useEffect(() => {
    let 取消 = false;
    拉取局域网信息()
      .then((结果) => { if (!取消) 应用结果(结果); })
      .catch(() => { if (!取消) 应用结果(null); });
    return () => { 取消 = true; };
  }, [应用结果]);

  const 刷新 = useCallback((): void => {
    set载入中(true);
    拉取局域网信息()
      .then(应用结果)
      .catch(() => 应用结果(null));
  }, [应用结果]);

  const 复制 = useCallback(async (文本: string): Promise<void> => {
    const 成功 = await 复制到剪贴板(文本);
    if (成功) {
      set已复制(文本);
      window.setTimeout(() => set已复制(null), 1500);
    } else {
      set提示('复制失败，请手动选中复制。');
    }
  }, []);

  const 切换口令 = useCallback(async (开启: boolean): Promise<void> => {
    set提示(null);
    const 结果 = await 设置访问口令(开启);
    if (!结果) {
      set提示('操作失败：口令只能在电脑上（本机）修改。');
      return;
    }
    set信息(结果);
  }, []);

  const 推送到磁盘 = useCallback((): void => {
    set提示('正在把本机存档推送到磁盘…');
    强制全量落盘()
      .then(() => 拉取局域网信息())
      .then((结果) => {
        set信息(结果);
        set提示('已推送到磁盘。手机端重新加载即可看到。');
      })
      .catch(() => set提示('推送失败，请查看控制台日志。'));
  }, []);

  const 首选链接 = 信息?.primary ?? null;

  const 卡片 = (内容: ReactElement, key?: string): ReactElement => (
    <div
      key={key}
      className="p-3 md:p-4"
      style={{
        background: 'rgba(var(--tj-bg-card, 20 24 34), 0.55)',
        border: '1px solid rgba(var(--tj-accent-primary), 0.16)',
        clipPath: cardClip,
      }}
    >
      {内容}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 顶部说明 */}
      {卡片(
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Wifi size={16} style={{ color: 'rgb(var(--tj-accent-primary))' }} />
            <span className="font-serif text-sm tracking-[0.2em]" style={{ color: 'rgb(var(--tj-text-primary))' }}>
              局域网远程游玩
            </span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.82)' }}>
            游戏本体仍在这台电脑上运行。<strong style={{ color: 'rgb(var(--tj-accent-primary))' }}>手机连同一个 Wi-Fi</strong>
            后，打开下面的链接即可远程游玩；进度与存档都保存在电脑上（磁盘为真相，多端自动对齐）。
          </p>
        </div>,
      )}

      {提示 && (
        <div
          className="px-3 py-2 text-xs"
          style={{ color: 'rgb(var(--tj-accent-primary))', background: 'rgba(var(--tj-accent-primary), 0.1)', clipPath: smallClip }}
        >
          {提示}
        </div>
      )}

      {/* 连接链接 */}
      {卡片(
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone size={15} style={{ color: 'rgb(var(--tj-accent-primary))' }} />
              <span className="text-xs tracking-wider" style={{ color: 'rgb(var(--tj-text-primary))' }}>连接链接</span>
            </div>
            <button
              type="button"
              onClick={刷新}
              className="flex items-center gap-1 px-2 py-1 text-[11px]"
              style={{ color: 'rgba(var(--tj-text-secondary), 0.9)', border: '1px solid rgba(var(--tj-text-secondary), 0.25)', clipPath: smallClip }}
            >
              <RefreshCw size={12} className={载入中 ? 'animate-spin' : ''} />
              刷新
            </button>
          </div>

          {载入中 && <div className="text-xs" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>正在读取…</div>}

          {!载入中 && 信息 && 信息.addresses.length === 0 && (
            <div className="text-xs" style={{ color: 'rgba(var(--tj-text-secondary), 0.85)' }}>
              未检测到局域网地址——请确认电脑已连上 Wi-Fi / 网线。也可稍后刷新重试。
            </div>
          )}

          {!载入中 && 信息 && 信息.addresses.map((项) => (
            <div key={`${项.网卡}-${项.地址}`} className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[10px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.6)' }}>
                  {项.网卡} · {项.地址}
                  {信息.guardEnabled && 小标签('需口令', 'var(--tj-accent-secondary, 180 140 255)')}
                </div>
                <div
                  className="mt-0.5 select-all break-all font-mono text-xs"
                  style={{ color: 'rgb(var(--tj-accent-primary))' }}
                >
                  {项.链接}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { void 复制(项.链接); }}
                className="flex items-center gap-1 px-2 py-1 text-[11px]"
                style={{ color: 'rgba(var(--tj-text-secondary), 0.92)', border: '1px solid rgba(var(--tj-text-secondary), 0.25)', clipPath: smallClip }}
              >
                {已复制 === 项.链接 ? <Check size={12} /> : <Copy size={12} />}
                复制
              </button>
            </div>
          ))}
        </div>,
      )}

      {/* 二维码 */}
      {首选链接 && 卡片(
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="text-xs tracking-wider" style={{ color: 'rgba(var(--tj-text-secondary), 0.82)' }}>
            手机扫码直达
          </div>
          <div className="rounded p-2" style={{ background: '#ffffff' }}>
            <QrCode 内容={首选链接} 尺寸={180} />
          </div>
          <div className="text-[10px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.6)' }}>
            与电脑连同一 Wi-Fi，用相机/微信扫这个码
          </div>
        </div>,
      )}

      {/* 存档同步：本机 vs 磁盘 */}
      {信息 && 卡片(
        <div className="space-y-2">
          <div className="text-xs tracking-wider" style={{ color: 'rgb(var(--tj-text-primary))' }}>存档同步</div>
          <div className="space-y-1 text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.85)' }}>
            <div>本机浏览器：<span className="font-mono" style={{ color: 'rgb(var(--tj-accent-primary))' }}>{计数文本(本机统计)}</span></div>
            <div>电脑磁盘：<span className="font-mono" style={{ color: 'rgb(var(--tj-accent-primary))' }}>{计数文本(信息.disk)}</span></div>
          </div>
          <div className="text-[10px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.62)' }}>
            手机上的进度来自「电脑磁盘」。若磁盘行数为 0，说明存档还没落盘——点下面的按钮把本机进度推上去。
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={推送到磁盘}
              className="px-3 py-1 text-[11px]"
              style={{ color: 'rgb(var(--tj-accent-primary))', border: '1px solid rgba(var(--tj-accent-primary), 0.45)', background: 'rgba(var(--tj-accent-primary), 0.12)', clipPath: smallClip }}
            >
              把本机存档同步到磁盘
            </button>
            <button
              type="button"
              onClick={() => { window.location.reload(); }}
              className="px-3 py-1 text-[11px]"
              style={{ color: 'rgba(var(--tj-text-secondary), 0.92)', border: '1px solid rgba(var(--tj-text-secondary), 0.25)', clipPath: smallClip }}
            >
              重新加载（拉取磁盘）
            </button>
          </div>
          <div className="select-all break-all font-mono text-[10px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.55)' }}>
            {信息.saveDir}
          </div>
        </div>,
      )}

      {/* 访问口令 */}
      {信息 && 卡片(
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {信息.guardEnabled
                ? <ShieldCheck size={15} style={{ color: 'rgb(var(--tj-accent-primary))' }} />
                : <ShieldOff size={15} style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }} />}
              <span className="text-xs tracking-wider" style={{ color: 'rgb(var(--tj-text-primary))' }}>访问口令</span>
            </div>
            <button
              type="button"
              onClick={() => { void 切换口令(!信息.guardEnabled); }}
              className="px-3 py-1 text-[11px]"
              style={{
                color: 信息.guardEnabled ? 'rgb(var(--tj-text-primary))' : 'rgb(var(--tj-accent-primary))',
                border: '1px solid rgba(var(--tj-accent-primary), 0.35)',
                background: 信息.guardEnabled ? 'transparent' : 'rgba(var(--tj-accent-primary), 0.12)',
                clipPath: smallClip,
              }}
            >
              {信息.guardEnabled ? '关闭口令' : '开启口令'}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.8)' }}>
            {信息.guardEnabled
              ? '已开启：同一局域网内必须带对口令才能访问。手机用上面的链接（已含口令）打开一次即可，之后免输。'
              : '未开启：同一局域网内的任何人都能访问存档与 AI 接口。仅在可信网络下关闭。'}
          </p>
          {信息.guardEnabled && 信息.token && (
            <div className="flex items-center gap-2">
              <div className="select-all font-mono text-sm tracking-[0.2em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
                {信息.token}
              </div>
              <button
                type="button"
                onClick={() => { void 复制(信息.token ?? ''); }}
                className="flex items-center gap-1 px-2 py-0.5 text-[11px]"
                style={{ color: 'rgba(var(--tj-text-secondary), 0.9)', border: '1px solid rgba(var(--tj-text-secondary), 0.25)', clipPath: smallClip }}
              >
                <Copy size={11} /> 复制
              </button>
            </div>
          )}
        </div>,
      )}

      {/* 排障 */}
      {卡片(
        <div className="space-y-2">
          <div className="text-xs tracking-wider" style={{ color: 'rgb(var(--tj-text-primary))' }}>连不上？</div>
          <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.82)' }}>
            <li>手机与电脑必须在<strong>同一个 Wi-Fi/路由器</strong>下；路由器若开了「AP 隔离」，需关掉。</li>
            <li>打不开多半是 <strong>Windows 防火墙</strong>挡住了端口。以管理员身份运行下面这条命令（端口与你启动的端口一致）。</li>
            <li>电脑上的开发服务要保持运行；换设备同步时，回到另一台刷新一次。</li>
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 select-all break-all rounded bg-black/30 px-2 py-1 font-mono text-[10px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.9)' }}>
              {防火墙命令}
            </code>
            <button
              type="button"
              onClick={() => { void 复制(防火墙命令); }}
              className="flex items-center gap-1 px-2 py-1 text-[11px]"
              style={{ color: 'rgba(var(--tj-text-secondary), 0.92)', border: '1px solid rgba(var(--tj-text-secondary), 0.25)', clipPath: smallClip }}
            >
              <Copy size={12} /> 复制
            </button>
          </div>
        </div>,
      )}
    </div>
  );
}
