/**
 * 跨设备同步（无弹窗）：窗口回到前台时，以本机 IDB 为准补齐磁盘，
 * 保证其它设备（如手机）下一次同步时能拿到本机最新最全的进度。
 *
 * 不再弹任何提示条——跨设备进度由实时通道 + 主机/遥控端流程自动处理。
 */
import { 对账并补齐磁盘 } from '@/services/storage/diskPersistence';

let 检查中 = false;

async function 检查一次(): Promise<void> {
  if (检查中) return;
  检查中 = true;
  try {
    await 对账并补齐磁盘();
  } finally {
    检查中 = false;
  }
}

/** 装好监听：聚焦 / 页面重新可见 / 启动 3 秒后 / 之后每 60 秒 各对账一次。 */
export function 安装跨设备同步检查(): void {
  window.addEventListener('focus', () => { void 检查一次(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void 检查一次();
  });
  window.setTimeout(() => { void 检查一次(); }, 3000);
  window.setInterval(() => { void 检查一次(); }, 60000);
}
