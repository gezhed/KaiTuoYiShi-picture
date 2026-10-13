/**
 * 跨设备同步提示：窗口回到前台时检查磁盘是否被其他设备（如手机）推进过，
 * 若是则弹一个非侵入式提示，点「刷新同步」重新加载即可拉到最新进度。
 *
 * 不做自动静默回灌——那会与当前会话内存里的进度冲突；只提示，由用户决定。
 */
import { 对账并补齐磁盘, 检查磁盘是否领先 } from '@/services/storage/diskPersistence';

const 提示条ID = 'kty-cross-device-sync';

function 移除提示条(): void {
  document.getElementById(提示条ID)?.remove();
}

function 显示提示条(): void {
  if (document.getElementById(提示条ID)) return;
  const 条 = document.createElement('div');
  条.id = 提示条ID;
  条.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:20px',
    'transform:translateX(-50%)',
    'z-index:2147483000',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'padding:10px 14px',
    'border-radius:10px',
    'background:rgba(22,26,36,0.97)',
    'border:1px solid rgba(126,180,255,0.45)',
    'color:#e8eef8',
    'font:13px/1.5 system-ui,-apple-system,sans-serif',
    'box-shadow:0 8px 28px rgba(0,0,0,0.45)',
    'max-width:min(92vw,520px)',
  ].join(';');

  const 文字 = document.createElement('span');
  文字.textContent = '检测到其他设备有更新的进度';

  const 刷新 = document.createElement('button');
  刷新.textContent = '刷新同步';
  刷新.style.cssText = 'padding:5px 10px;border-radius:7px;border:1px solid rgba(126,180,255,0.55);background:rgba(126,180,255,0.16);color:#cfe4ff;cursor:pointer;font:inherit';
  刷新.onclick = () => { window.location.reload(); };

  const 关闭 = document.createElement('button');
  关闭.textContent = '×';
  关闭.setAttribute('aria-label', '关闭');
  关闭.style.cssText = 'border:none;background:transparent;color:#8fa0b8;cursor:pointer;font-size:16px;line-height:1';
  关闭.onclick = () => { 移除提示条(); };

  条.append(文字, 刷新, 关闭);
  document.body.appendChild(条);
}

let 检查中 = false;

async function 检查一次(): Promise<void> {
  if (检查中) return;
  检查中 = true;
  try {
    if (await 检查磁盘是否领先()) {
      显示提示条();
      return;
    }
    // 磁盘没有领先：以本机 IDB 为准补齐磁盘，保证手机拿到的进度最全。
    await 对账并补齐磁盘();
  } finally {
    检查中 = false;
  }
}

/** 装好监听：聚焦 / 页面重新可见 / 启动 3 秒后 / 之后每 60 秒 各查一次。 */
export function 安装跨设备同步检查(): void {
  window.addEventListener('focus', () => { void 检查一次(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void 检查一次();
  });
  window.setTimeout(() => { void 检查一次(); }, 3000);
  window.setInterval(() => { void 检查一次(); }, 60000);
}
