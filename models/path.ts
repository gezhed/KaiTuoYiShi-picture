import type { 命途ID, 命途定义 } from './journey';

// 自然推进最高只能到 stage 3(伪令使),stage 4(令使)需要剧情触发"星神亲自授力"。
export type 命途阶段 = 0 | 1 | 2 | 3 | 4;

export const PATH_STAGE_DEFS: { stage: 命途阶段; name: string; title: string; blurb: string }[] = [
  {
    stage: 0,
    name: '浅涉',
    title: '初步感知',
    blurb: '隐约感受到命途的召唤，尚未形成明确的行者意志，力量微弱且不稳定。',
  },
  {
    stage: 1,
    name: '践行',
    title: '命途行者',
    blurb: '正式踏上命途，能稳定调用命途之力，形成个人战斗风格。',
  },
  {
    stage: 2,
    name: '深诣',
    title: '资深行者',
    blurb: '对命途理念有深刻理解，力量显著增长，开始展现独特的践行方式。',
  },
  {
    stage: 3,
    name: '伪令使',
    title: '准令使级',
    blurb: '命途意志主动垂青，实力产生质变，言行开始影响周围环境，被视为命途的代言人候选。自然修行的天花板。',
  },
  {
    stage: 4,
    name: '令使',
    title: '令使级',
    blurb: '命途星神亲自下旨授予力量的使者，实力与普通行者有天壤之别，拥有改变战局的能力。仅由星神亲临剧情触发，不可凭自身修行抵达。',
  },
];

export const STAGE_PROGRESS_MAX = 100;

/** 超过此值的 add 会被 variableExecutor 截断,并向玩家提示今天已有所感悟。 */
export const DAILY_PROGRESS_CAP = 10;

export interface 命途进度 {
  id: 命途ID;
  阶段: 命途阶段;
  进度: number;
  是否主命途: boolean;
  觉醒于: string;
  备注: string;
  今日累计?: number;
  今日日期?: string;
  /** stage 3→4 永远不会进入此状态(走星神授力路径)。 */
  待升阶?: boolean;
}

export function 创建命途进度(
  id: 命途ID,
  isPrimary: boolean,
  awakenedAt: string,
  notes = '',
): 命途进度 {
  return {
    id,
    阶段: 0,
    进度: 0,
    是否主命途: isPrimary,
    觉醒于: awakenedAt,
    备注: notes,
    今日累计: 0,
    今日日期: '',
    待升阶: false,
  };
}

export interface 命途增量 {
  pathId: 命途ID;
  progressDelta?: number;
  newPath?: boolean;
  setPrimary?: boolean;
  reason?: string;
}

export interface 命途特质 {
  名称: string;
  说明: string;
}

export interface 命途核心理念 {
  核心: string;
  拷问: string[];
}

export interface 命途目录项 extends 命途定义 {
  traits: 命途特质[];
  belief: 命途核心理念;
}

export {
  PATH_CORE_BELIEFS,
  PATH_TRAIT_DEFS,
  获取命途特质,
} from '@/data/pathCatalog';

/** stage >= 2 起按比率衰减其它非主命途进度；主命途 (isPrimary) 不受影响。 */
export const FORGET_RATE_BY_STAGE: Record<命途阶段, number> = {
  0: 0,
  1: 0,
  2: 0.1,
  3: 0.2,
  4: 0.35,
};
