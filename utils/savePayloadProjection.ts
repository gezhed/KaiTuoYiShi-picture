import type { 存档数据 } from '@/models/settings';
import { compactChatHistoryForSave, compactChatHistoryForLongSession } from '@/utils/longSessionRetention';
import { buildPersistedStoryWeavingSystem } from '@/data/storyWeavingPreset';
import { buildPersistedZhikuSystem } from '@/data/zhikuPreset';

/**
 * 落盘前的存档投影：剥掉「读回时能重新水合 / 能重新算出来」的重字段。
 *
 * 为什么必须在**所有**写入路径上做：存档树是「载入上一个叶子 → 打补丁 → 再存」，
 * 任何一条路径漏掉投影，胖档就会被原样复制下去。实测单档 43.5MB 里，
 * debugContext 12.3MB + preTurnSnapshot 6.4MB + 剧情编织 canon 17.3MB 全是赘肉，
 * 而真正的正文只有约 0.8MB；每回合还要写两次（新头叶子 + 封版旧叶子），
 * 客户端与服务端各 stringify 一遍 → 内存上下蹦迪。
 *
 * - 'sealed'：封版 / 存档快照。不保留任何调试与推理字段（读侧读正文即可）。
 * - 'head'  ：当前回合的活跃叶子。保留最近若干回合的调试与推理，供「继续结算」与诊断面板使用。
 *
 * 剧情编织剥到只留进度，读侧由 `hydratePersistedStoryWeavingSystem` 从内置预设水合回来。
 */
export function 投影存档载荷为落盘(payload: 存档数据, mode: 'sealed' | 'head'): 存档数据 {
  const next: 存档数据 = { ...payload };
  if (Array.isArray(payload.chatHistory)) {
    next.chatHistory = mode === 'sealed'
      ? compactChatHistoryForSave(payload.chatHistory)
      : compactChatHistoryForLongSession(payload.chatHistory);
  }
  if (payload.剧情编织) {
    next.剧情编织 = buildPersistedStoryWeavingSystem(payload.剧情编织);
  }
  // 智库同理：读侧 `prepareHydration` 会用 `mergeBundledZhikuSystem` 重新合并内置预设，
  // 存档里只需留进度与自制条目（实测内置资料占 ~2.3MB/档）。
  if (payload.智库) {
    next.智库 = buildPersistedZhikuSystem(payload.智库);
  }
  return next;
}
