import type { TurnAfterReply, TurnContext, TurnDeltas } from './turnTypes';
import { 归一化世界状态 } from '@/models/world';
import { appendWorldEvents } from '@/utils/worldEvents';
import { 解析命途ID, 应用狭间结果, type 狭间评判 } from '@/services/pathService';
import { 解析天气标签, 验证天气合法性 } from '@/data/weatherRules';

export function stage7_worldTraveler(
  ctx: TurnContext,
  d: TurnAfterReply,
): Partial<TurnDeltas> {
  const { state, effectiveWorld } = ctx;
  const parsedForDisplay = d.parsedForDisplay;
  const displayText = d.displayText;

  let worldAfter: typeof state.世界 = 归一化世界状态(effectiveWorld);
  let travelerAfter: typeof state.旅人 = state.旅人;

  if (parsedForDisplay.worldEvents.length) {
    worldAfter = {
      ...worldAfter,
      全局事件: appendWorldEvents(worldAfter.全局事件, parsedForDisplay.worldEvents),
    };
  }

  // 邀请落地须为「已踏上 + 待升阶」的命途：AI 偶发误标（把已过去的命途又邀请一次）直接静默丢弃。
  if (parsedForDisplay.awakenInvite.trim() && !worldAfter.待触发狭间 && !worldAfter.进行中狭间) {
    const invitedId = 解析命途ID(parsedForDisplay.awakenInvite);
    if (invitedId) {
      const target = travelerAfter.命途列表.find((p) => p.id === invitedId);
      if (target?.待升阶) {
        worldAfter = { ...worldAfter, 待触发狭间: invitedId };
      } else {
        console.warn('[sendWorkflow] 命途狭间邀请被忽略:目标命途未达待升阶状态:', invitedId);
      }
    } else {
      console.warn('[sendWorkflow] 无法解析狭间邀请的命途 ID:', parsedForDisplay.awakenInvite);
    }
  }

  if (parsedForDisplay.awakenJudgement.trim() && worldAfter.进行中狭间) {
    const pathId = worldAfter.进行中狭间;
    const judgementRaw = parsedForDisplay.awakenJudgement.trim();
    const judgement: 狭间评判 | null =
      judgementRaw.includes('升阶')
      || judgementRaw.includes('突破')
      || judgementRaw.includes('确认')
      || /promote|advance|awaken/i.test(judgementRaw)
        ? '升阶'
        : null;
    if (judgement) {
      const res = 应用狭间结果(travelerAfter, pathId, judgement);
      if (res.ok) {
        travelerAfter = res.traveler;
      } else {
        console.warn('[sendWorkflow] 应用狭间结果失败:', res.reason);
      }
      // 不论成功失败都清掉 进行中狭间,避免卡死在狭间回合
      worldAfter = { ...worldAfter, 进行中狭间: undefined };
    } else {
      console.warn('[sendWorkflow] 无法识别的狭间评判:', judgementRaw);
    }
  }

  // worldAfter.当前地点 仍是本回合开始前的旧地点（变量模型尚未运行）：
  // 若 AI 同回合切地点+换天气，用旧地点校验会误拒，因此地点白名单只作 prompt 引导，不强制校验。
  const rawResponseTextForTurn = d.rawFullText || displayText;
  const 天气 = 解析天气标签(rawResponseTextForTurn);
  if (天气) {
    if (!验证天气合法性(天气, worldAfter.当前地点)) {
      console.info('[天气] 天气与当前地点白名单不匹配，仍接受（地点可能在本回合由变量模型更新）:', 天气, '| 旧地点:', worldAfter.当前地点);
    }
    worldAfter = { ...worldAfter, 当前天气: 天气 };
  }

  return { worldAfter, travelerAfter };
}
