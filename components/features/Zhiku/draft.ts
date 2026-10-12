import type { 智库分类, 智库注入内容 } from '@/models/zhiku';
import { 创建空智库注入内容 } from '@/models/zhiku';

export type Draft = {
  标题: string; 分类: 智库分类; 来源: string; 关键词: string; 资料类型: string;
  关联角色ID: string; 关联形态ID: string; 解锁状态: string; 剧透等级: string;
  使用范围: string[]; 外貌锚点: string; 性格锚点: string; 说话方式: string;
  行为习惯: string; 关系边界: string; 禁止误写: string; 摘要: string; 原文: string;
  角色故事摘要: string; 重要度: number; 可用于联动: boolean;
  注入内容?: 智库注入内容;
};

export function 创建空草稿(分类: 智库分类 = 'story'): Draft {
  return {
    标题: '', 分类, 来源: '', 关键词: '', 资料类型: '', 关联角色ID: '', 关联形态ID: '',
    解锁状态: '', 剧透等级: '', 使用范围: [], 外貌锚点: '', 性格锚点: '', 说话方式: '',
    行为习惯: '', 关系边界: '', 禁止误写: '', 摘要: '', 原文: '', 角色故事摘要: '',
    重要度: 3, 可用于联动: true,
    注入内容: 创建空智库注入内容(分类),
  };
}
