import { 创建智库条目, type 智库条目 } from '@/models/zhiku';

type 条目输入 = Parameters<typeof 创建智库条目>[0];

export const buildZhikuEntryWithId = (id: string, input: 条目输入): 智库条目 => ({
  ...创建智库条目(input),
  id,
});
