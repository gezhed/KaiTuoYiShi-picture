import { useEffect, useLayoutEffect, useRef, useCallback, useMemo, useState, memo } from 'react';
import type { 聊天消息, 叙事插图 } from '@/models/chat';
import type { NPC记录 } from '@/models/npc';
import type { 角色数据结构 } from '@/models/character';
import type { VisualTextSettings } from '@/models/settings';
import type { 相册系统 } from '@/models/imageGeneration';
import { useStreamingMessage } from '@/utils/streamingMessageStore';
import { 发布实时事件, 是主机端 } from '@/services/localSave/liveSync';
import type { TurnActionsApi, 回合动作上下文 } from '@/hooks/useGame/turnActionRuntime';
import { TurnItem } from './TurnItem';
import { mediumClip } from '@/components/ui/clipPaths';
import type { 插图重生选项 } from './illustrationActions';

interface ChatListProps {
  messages: 聊天消息[];
  loading: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onEditBody?: (id: string, newBody: string) => void;
  turnActions?: TurnActionsApi;
  turnActionContext?: 回合动作上下文;
  narrativeImageManualEnabled?: boolean;
  /** AVG 式逐句推进设置。 */
  逐句推进?: { 启用: boolean; 立即全显: boolean };
  /** 正文插图的显示方式（默认显示 / 默认展开）。 */
  插图显示?: { 默认显示: boolean; 默认展开: boolean };
  npcRecords?: NPC记录[];
  traveler?: 角色数据结构;
  album?: 相册系统;
  showInnerVoice?: boolean;
  visualTextSettings?: VisualTextSettings;
  devMode?: boolean;
  onIllustrationRegenerate?: (messageId: string, 插图: 叙事插图, 选项?: 插图重生选项) => void;
  onIllustrationRerollPrompts?: (messageId: string) => void;
}

interface NeighborMeta {
  fallbackPathId?: string;
  previousUserInput?: string;
}

const INITIAL_RENDER_TURNS = 20;
const RENDER_TURN_INCREMENT = 20;

function findHistoryWindowStart(messages: 聊天消息[], turnLimit: number): number {
  let assistantTurns = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'assistant') continue;
    assistantTurns += 1;
    if (assistantTurns > turnLimit) return index + 1;
  }
  return 0;
}

interface ChatHistoryListProps {
  messages: 聊天消息[];
  neighborMeta: NeighborMeta[];
  onEditBody?: (id: string, newBody: string) => void;
  turnActions?: TurnActionsApi;
  turnActionContext?: 回合动作上下文;
  narrativeImageManualEnabled?: boolean;
  /** AVG 式逐句推进设置。 */
  逐句推进?: { 启用: boolean; 立即全显: boolean };
  /** 正文插图的显示方式（默认显示 / 默认展开）。 */
  插图显示?: { 默认显示: boolean; 默认展开: boolean };
  npcRecords?: NPC记录[];
  traveler?: 角色数据结构;
  album?: 相册系统;
  showInnerVoice?: boolean;
  visualTextSettings?: VisualTextSettings;
  devMode?: boolean;
  onIllustrationRegenerate?: (messageId: string, 插图: 叙事插图, 选项?: 插图重生选项) => void;
  onIllustrationRerollPrompts?: (messageId: string) => void;
}

const ChatHistoryList = memo(function ChatHistoryList({
  messages,
  neighborMeta,
  onEditBody,
  turnActions,
  turnActionContext,
  narrativeImageManualEnabled = false,
  插图显示,
  逐句推进,
  npcRecords,
  traveler,
  album,
  showInnerVoice = true,
  visualTextSettings,
  devMode = false,
  onIllustrationRegenerate,
  onIllustrationRerollPrompts,
}: ChatHistoryListProps) {
  return (
    <>
      {messages.map((msg, idx) => {
        const meta = neighborMeta[idx];
        const actionView = turnActions && turnActionContext
          ? turnActions.视图状态(msg, turnActionContext)
          : undefined;
        const hasActions = actionView && Object.keys(actionView).length > 0;
        return (
          <TurnItem
            key={msg.id}
            message={msg}
            deferOffscreen
            onEditBody={onEditBody}
            turnActionView={actionView}
            onTurnAction={hasActions && turnActions && turnActionContext
              ? (id) => { void turnActions.执行(msg, id, turnActionContext); }
              : undefined}
            narrativeImageManualEnabled={narrativeImageManualEnabled}
            插图显示={插图显示}
        逐句推进={逐句推进}
            npcRecords={npcRecords}
            traveler={traveler}
            album={album}
            showInnerVoice={showInnerVoice}
            fallbackPathId={meta.fallbackPathId}
            previousUserInput={meta.previousUserInput}
            visualTextSettings={visualTextSettings}
            devMode={devMode}
            onIllustrationRegenerate={onIllustrationRegenerate}
            onIllustrationRerollPrompts={onIllustrationRerollPrompts}
          />
        );
      })}
    </>
  );
});

function buildNeighborMeta(messages: 聊天消息[]): NeighborMeta[] {
  let lastUserContent: string | undefined;
  let lastPathId: string | undefined;
  const meta: NeighborMeta[] = new Array<NeighborMeta>(messages.length);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    let fallbackPathId: string | undefined;
    let previousUserInput: string | undefined;

    if (msg.role === 'user') {
      lastUserContent = msg.content;
    } else if (msg.role === 'assistant') {
      previousUserInput = lastUserContent;
      const needsFallback =
        !!msg.parsedResponse
        && (msg.parsedResponse.awakenQuestions.trim() || msg.parsedResponse.awakenJudgement.trim())
        && !msg.parsedResponse.awakenPathId;
      if (needsFallback) {
        fallbackPathId = lastPathId;
      }
      const pid = msg.parsedResponse?.awakenPathId;
      if (pid) lastPathId = pid;
    }

    meta[i] = { fallbackPathId, previousUserInput };
  }

  return meta;
}

export function ChatList({ messages, loading, scrollRef, onEditBody, turnActions, turnActionContext, narrativeImageManualEnabled = false, 插图显示, 逐句推进, npcRecords, traveler, album, showInnerVoice = true, visualTextSettings, devMode = false, onIllustrationRegenerate, onIllustrationRerollPrompts }: ChatListProps) {
  const streamingMessage = useStreamingMessage();
  const 上次广播时刻 = useRef(0);
  // 只有「主机」才广播过程状态；遥控端（手机）只是显示，绝不转发。
  // 结束（turn-done）不在这里发：它由 stage12_save 在回合真正封版后发，
  // 好让其它端拿到的是变量结算完的完整回合。
  useEffect(() => {
    if (!是主机端()) return;
    if (streamingMessage) {
      // 预览可能每秒推 60 帧，直接广播就是把服务器当帧循环刷。
      // 限到 ~8 次/秒；收尾的完整正文由 turn-done 事件带过去，不会丢。
      const 现在 = Date.now();
      if (现在 - 上次广播时刻.current < 120) return;
      上次广播时刻.current = 现在;
      void 发布实时事件({ kind: 'stream', source: 'host', text: streamingMessage });
      return;
    }
    if (loading) {
      void 发布实时事件({ kind: 'typing', source: 'host' });
    }
  }, [streamingMessage, loading]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const nearBottomRef = useRef(true);
  const [renderTurnLimit, setRenderTurnLimit] = useState(INITIAL_RENDER_TURNS);
  const [historyIdentity, setHistoryIdentity] = useState<{ lastId?: string; length: number }>({ length: 0 });
  const [previousMessages, setPreviousMessages] = useState(messages);
  const scrollRafRef = useRef<number | null>(null);
  const scrollStateRafRef = useRef<number | null>(null);
  const pendingHistoryAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  if (messages !== previousMessages) {
    const wasReplaced = historyIdentity.length > 0
      && (messages.length < historyIdentity.length
        || (!!historyIdentity.lastId && !messages.some((message) => message.id === historyIdentity.lastId)));
    setPreviousMessages(messages);
    setHistoryIdentity({ lastId: messages[messages.length - 1]?.id, length: messages.length });
    if (wasReplaced) setRenderTurnLimit(INITIAL_RENDER_TURNS);
  }
  const previousHistoryStillPresent = !historyIdentity.lastId
    || messages.some((message) => message.id === historyIdentity.lastId);
  const historyWasReplaced = historyIdentity.length > 0
    && (messages.length < historyIdentity.length || !previousHistoryStillPresent);
  const effectiveRenderTurnLimit = historyWasReplaced ? INITIAL_RENDER_TURNS : renderTurnLimit;

  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  }, [scrollRef]);

  useEffect(() => {
    if (!nearBottom && streamingMessage) return;
    if (!nearBottom && messages.length > 0) return;

    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });

    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [messages, streamingMessage, nearBottom, scrollRef]);

  const handleScroll = useCallback(() => {
    if (scrollStateRafRef.current !== null) return;
    scrollStateRafRef.current = requestAnimationFrame(() => {
      scrollStateRafRef.current = null;
      const nextNearBottom = isNearBottom();
      if (nearBottomRef.current === nextNearBottom) return;
      nearBottomRef.current = nextNearBottom;
      setNearBottom(nextNearBottom);
    });
  }, [isNearBottom]);

  useEffect(() => () => {
    if (scrollStateRafRef.current !== null) {
      cancelAnimationFrame(scrollStateRafRef.current);
      scrollStateRafRef.current = null;
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    nearBottomRef.current = true;
    setNearBottom(true);
  }, []);

  const visibleMessages = useMemo(
    () => messages.filter((message) => !(message.role === 'user' && message.content.startsWith('[系统]'))),
    [messages],
  );
  const renderedStartIndex = useMemo(
    () => findHistoryWindowStart(visibleMessages, effectiveRenderTurnLimit),
    [effectiveRenderTurnLimit, visibleMessages],
  );
  const renderedMessages = useMemo(
    () => visibleMessages.slice(renderedStartIndex),
    [renderedStartIndex, visibleMessages],
  );
  const hasEarlierMessages = renderedStartIndex > 0;

  const allNeighborMeta = useMemo(
    () => buildNeighborMeta(visibleMessages),
    [visibleMessages],
  );
  const neighborMeta = useMemo(
    () => allNeighborMeta.slice(renderedStartIndex),
    [allNeighborMeta, renderedStartIndex],
  );

  const handleLoadEarlier = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      pendingHistoryAnchorRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
      };
    }
    setRenderTurnLimit((current) => current + RENDER_TURN_INCREMENT);
  }, [scrollRef]);

  useLayoutEffect(() => {
    const anchor = pendingHistoryAnchorRef.current;
    pendingHistoryAnchorRef.current = null;
    if (!anchor) return;
    if (historyWasReplaced) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = anchor.scrollTop + (el.scrollHeight - anchor.scrollHeight);
  }, [historyWasReplaced, renderedStartIndex, scrollRef]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="relative flex-1 overflow-y-auto px-4 py-4 md:px-4"
    >
      <div className="pointer-events-none fixed left-0 right-0 top-0 z-10 h-16 bg-gradient-to-b from-[rgba(var(--tj-bg-primary),0.74)] to-transparent md:hidden" />

      {hasEarlierMessages && (
        <div className="flex justify-center pb-4">
          <button
            type="button"
            onClick={handleLoadEarlier}
            className="px-3 py-1.5 text-xs"
            style={{ color: 'rgba(var(--tj-accent-primary), 0.92)' }}
          >
            继续渲染更早 20 回合
          </button>
        </div>
      )}

      {visibleMessages.length === 0 && !loading && (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <div
            className="text-5xl mb-5"
            style={{ color: 'rgba(var(--tj-accent-primary), 0.35)' }}
          >
            ✦
          </div>
          <p
            className="text-sm font-serif tracking-[0.15em]"
            style={{ color: 'rgba(var(--tj-text-primary), 0.7)' }}
          >
            星轨深处，尚无回响……
          </p>
          <p
            className="mt-2 text-xs tracking-wider"
            style={{ color: 'rgba(var(--tj-text-secondary), 0.6)' }}
          >
            在此写下开拓之旅的第一页
          </p>
        </div>
      )}

      <ChatHistoryList
        messages={renderedMessages}
        neighborMeta={neighborMeta}
        onEditBody={onEditBody}
        turnActions={turnActions}
        turnActionContext={turnActionContext}
        narrativeImageManualEnabled={narrativeImageManualEnabled}
        插图显示={插图显示}
        逐句推进={逐句推进}
        npcRecords={npcRecords}
        traveler={traveler}
        album={album}
        showInnerVoice={showInnerVoice}
        visualTextSettings={visualTextSettings}
        devMode={devMode}
        onIllustrationRegenerate={onIllustrationRegenerate}
        onIllustrationRerollPrompts={onIllustrationRerollPrompts}
      />

      {streamingMessage && (
        <TurnItem
          message={{
            id: 'streaming',
            role: 'assistant',
            content: streamingMessage,
            timestamp: Date.now(),
            isStreaming: true,
          }}
          isStreaming
          npcRecords={npcRecords}
          traveler={traveler}
          album={album}
          showInnerVoice={showInnerVoice}
          visualTextSettings={visualTextSettings}
        />
      )}

      {loading && !streamingMessage && (
        <div className="flex items-center gap-2 py-4">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-1.5 w-1.5 animate-pulse-soft rounded-full"
                style={{
                  background: 'rgb(var(--tj-accent-primary))',
                  boxShadow: '0 0 6px rgba(var(--tj-accent-primary), 0.5)',
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </div>
          <span
            className="text-xs font-serif tracking-wider"
            style={{ color: 'rgba(var(--tj-text-secondary), 0.8)' }}
          >
            正在沉思……
          </span>
        </div>
      )}

      <div ref={bottomRef} />

      {!nearBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="fixed bottom-[calc(var(--app-safe-bottom)+118px)] left-1/2 z-30 -translate-x-1/2 px-3 py-1.5 text-[11px] tracking-[0.16em] md:hidden"
          style={{
            color: 'rgba(var(--tj-accent-primary), 0.92)',
            background: 'rgba(var(--tj-surface), 0.92)',
            border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-strong))',
            backdropFilter: 'blur(4px)',
            clipPath: mediumClip,
          }}
        >
          回到底部
        </button>
      )}
    </div>
  );
}
