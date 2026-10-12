import { 归一化变量修复草稿, type 变量修复草稿 } from '@/models/variableRepairBatch';
import { deleteSetting, loadSetting, saveSetting } from './settings';

const 草稿键 = 'variableRepairDraft';

export async function 保存变量修复草稿(draft: 变量修复草稿): Promise<void> {
  await saveSetting(草稿键, draft);
}

export async function 读取变量修复草稿(): Promise<
  { draft?: 变量修复草稿; issues: string[] }
> {
  const raw = await loadSetting<unknown>(草稿键);
  if (raw === null) return { issues: [] };
  return 归一化变量修复草稿(raw);
}

export async function 清除变量修复草稿(): Promise<void> {
  await deleteSetting(草稿键);
}
