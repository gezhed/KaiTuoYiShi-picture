import { memo, useCallback, useMemo, useState } from 'react';
import type { 聊天消息, 叙事插图 } from '@/models/chat';
import type { NPC记录 } from '@/models/npc';
import type { 角色数据结构 } from '@/models/character';
import type { VisualTextSettings } from '@/models/settings';
import type { 相册系统 } from '@/models/imageGeneration';
import { BodyBlock, StreamingPreview } from './MessageRenderers';
import { getPath } from '@/data/journeyPresets';
import { 分类命途狭间回合, 判定评判是否升阶 } from '@/utils/awakening';
import { 格式化请求上下文 } from '@/utils/debugContextFormat';
import { 剥掉内联插图 } from '@/utils/illustrationMarkup';
import { UserTurnBubble } from './userTurnBubble';
import { AwakeningOracleBlock, AwakeningQuestionsBlock, AwakeningJudgementBadge, AwakeningAftermathLine } from './awakeningBlocks';
import { EditBodyPanel, PanelText, ToolButton, TurnBadge } from './turnToolbar';
import { UsagePanel } from './usagePanel';
import { 格式化本地诊断 } from './diagnosticsPanel';
import { NarrativeImageCard, NarrativeImageManualCard } from './narrativeImageCards';
import type { 插图重生选项 } from './illustrationActions';
import { 回合动作展示表 } from './turnActionPresentation';
import { cardClip, panelClip } from './turnStyles';
import type { 回合动作ID, 回合动作视图 } from '@/hooks/useGame/turnActionRuntime';

interface TurnItemProps {
  message: 聊天消息;
  isStreaming?: boolean;
  deferOffscreen?: boolean;
  onEditBody?: (id: string, newBody: string) => void;
  turnActionView?: Partial<Record<回合动作ID, 回合动作视图>>;
  onTurnAction?: (id: 回合动作ID) => void;
  narrativeImageManualEnabled?: boolean;
  /** AVG 式逐句推进设置。 */
  逐句推进?: { 启用: boolean; 立即全显: boolean };
  /** 正文插图的显示方式（默认显示 / 默认展开）。 */
  插图显示?: { 默认显示: boolean; 默认展开: boolean };
  npcRecords?: NPC记录[];
  traveler?: 角色数据结构;
  album?: 相册系统;
  showInnerVoice?: boolean;
  previousUserInput?: string;
  visualTextSettings?: VisualTextSettings;
  /** 不改变主剧情请求。 */
  devMode?: boolean;
  // 历史消息可能没有 awakenPathId，由 ChatList 向前查找补齐。
  fallbackPathId?: string;
  onIllustrationRegenerate?: (messageId: string, 插图: 叙事插图, 选项?: 插图重生选项) => void;
  onIllustrationRerollPrompts?: (messageId: string) => void;
}

type ToolKey = 'edit' | 'thinking' | 'usage' | 'storyPlan' | 'summary' | 'raw' | 'context' | 'diagnostics';

const HISTORY_TURN_VISIBILITY_STYLE = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 640px',
} as const;

function TurnItemImpl({ message, isStreaming, deferOffscreen = false, onEditBody, turnActionView, onTurnAction, narrativeImageManualEnabled = false, 插图显示, 逐句推进, npcRecords, traveler, album, showInnerVoice = true, fallbackPathId, previousUserInput, visualTextSettings, devMode = false, onIllustrationRegenerate, onIllustrationRerollPrompts }: TurnItemProps) {
  const isUser = message.role === 'user';
  const parsed = message.parsedResponse;
  const shouldDeferOffscreen = deferOffscreen && !isStreaming && !message.isStreaming;
  const visibilityStyle = shouldDeferOffscreen ? HISTORY_TURN_VISIBILITY_STYLE : undefined;

  if (isUser) {
    return (
      <div className="mb-4 animate-slide-up" style={visibilityStyle}>
        <UserTurnBubble content={message.content} traveler={traveler} album={album} fontSize={visualTextSettings?.playerFontSize ?? 14} />
      </div>
    );
  }

  return (
    <div className="mb-4 animate-slide-up" style={visibilityStyle}>
      {parsed ? (
        <AiTurnCard
          message={message}
          parsed={parsed}
          isStreaming={isStreaming}
          deferOffscreen={shouldDeferOffscreen}
          onEditBody={onEditBody}
          turnActionView={turnActionView}
          onTurnAction={onTurnAction}
          narrativeImageManualEnabled={narrativeImageManualEnabled}
          插图显示={插图显示}
          逐句推进={逐句推进}
          npcRecords={npcRecords}
          traveler={traveler}
          album={album}
          showInnerVoice={showInnerVoice}
          fallbackPathId={fallbackPathId}
          previousUserInput={previousUserInput}
          visualTextSettings={visualTextSettings}
          devMode={devMode}
          onIllustrationRegenerate={onIllustrationRegenerate}
          onIllustrationRerollPrompts={onIllustrationRerollPrompts}
        />
      ) : message.isStreaming ? (
        <StreamingPreview
          content={message.content}
          npcRecords={npcRecords}
          traveler={traveler}
          album={album}
          showInnerVoice={showInnerVoice}
          userInput={previousUserInput}
          visualTextSettings={visualTextSettings}
        />
      ) : null}
    </div>
  );
}

export const TurnItem = memo(TurnItemImpl);

interface AiTurnCardProps {
  message: 聊天消息;
  parsed: NonNullable<聊天消息['parsedResponse']>;
  isStreaming?: boolean;
  deferOffscreen?: boolean;
  onEditBody?: (id: string, newBody: string) => void;
  turnActionView?: Partial<Record<回合动作ID, 回合动作视图>>;
  onTurnAction?: (id: 回合动作ID) => void;
  narrativeImageManualEnabled?: boolean;
  /** AVG 式逐句推进设置。 */
  逐句推进?: { 启用: boolean; 立即全显: boolean };
  /** 正文插图的显示方式（默认显示 / 默认展开）。 */
  插图显示?: { 默认显示: boolean; 默认展开: boolean };
  npcRecords?: NPC记录[];
  traveler?: 角色数据结构;
  album?: 相册系统;
  showInnerVoice?: boolean;
  fallbackPathId?: string;
  previousUserInput?: string;
  visualTextSettings?: VisualTextSettings;
  devMode?: boolean;
  onIllustrationRegenerate?: (messageId: string, 插图: 叙事插图, 选项?: 插图重生选项) => void;
  onIllustrationRerollPrompts?: (messageId: string) => void;
}

function AiTurnCard({ message, parsed, isStreaming, deferOffscreen = false, onEditBody, turnActionView, onTurnAction, narrativeImageManualEnabled = false, 插图显示, 逐句推进, npcRecords, traveler, album, showInnerVoice = true, fallbackPathId, previousUserInput, visualTextSettings, devMode = false, onIllustrationRegenerate, onIllustrationRerollPrompts }: AiTurnCardProps) {
  const [openTool, setOpenTool] = useState<ToolKey | null>(null);
  const [draft, setDraft] = useState(parsed.body);

  const toggle = (key: ToolKey) => {
    setOpenTool((cur) => (cur === key ? null : key));
    if (key === 'edit') setDraft(parsed.body);
  };

  const handleEditSave = () => {
    if (onEditBody) onEditBody(message.id, draft);
    setOpenTool(null);
  };

  const awakeningKind = 分类命途狭间回合(parsed);
  const judgementOutcome: '升阶' | null =
    awakeningKind === '评判' && 判定评判是否升阶(parsed.awakenJudgement) ? '升阶' : null;
  const snapshotAction = turnActionView?.regenerate_snapshot;
  const snapshotRegenerate = onTurnAction ? () => onTurnAction('regenerate_snapshot') : undefined;

  /**
   * 有锚点的插图交给正文行间渲染，没有锚点的（例如历史存档）留在正文下方。
   *
   * 判定用「锚点非空」而不是「已匹配到某一行」：匹配在 BodyBlock 内部进行，
   * 这里若也判一次就会两处逻辑分叉。
   */
  const 全部插图 = message.narrativeImages ?? [];
  const 已有锚点 = 全部插图.filter((插图) => (插图.description ?? '').trim().length > 0);
  const 未落位插图 = 全部插图.filter((插图) => !(插图.description ?? '').trim());

  /**
   * 去掉正文里的插图文法再渲染。
   *
   * 正文模型会把 `<image>提示词</image>` 直接写在正文行间（这是预设要求的写法），
   * 这些块是给渲染层用的**中间产物**，不是正文。若不剥掉：
   *   ① 用户会在正文里看到一堆 XML 标签；
   *   ② 更关键的是 —— 锚点匹配是对**渲染后的行**做的，标签占位会让行内容与锚点错位，
   *      插图就插不进正文（这正是实际反馈的现象）。
   */
  const 展示正文 = useMemo(() => 剥掉内联插图(parsed.body), [parsed.body]);

  const 插图锚点 = useMemo(
    () => 已有锚点.map((插图) => ({ id: 插图.id, 锚点: 插图.description ?? '' })),
    // 插图数组每次重解析都会换引用，用 id+锚点拼出的签名做依赖更稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [已有锚点.map((插图) => `${插图.id}:${插图.description ?? ''}`).join('|')],
  );

  const 渲染插图 = useCallback((插图Id: string) => {
    const 插图 = 全部插图.find((项) => 项.id === 插图Id);
    if (!插图) return null;
    return (
      <NarrativeImageCard
        image={插图}
        album={album}
        // 插在正文行间的图走的是这条渲染路径，同样要听「默认展开」开关，
        // 否则开关只对正文末尾的兜底卡片生效（实际反馈过这个不对称）。
        defaultExpanded={插图显示?.默认展开 === true}
        regenerating={snapshotAction?.running}
        onRegenerate={onIllustrationRegenerate
          ? (选项) => onIllustrationRegenerate(message.id, 插图, 选项)
          : undefined}
        onRerollPrompts={onIllustrationRerollPrompts
          ? () => onIllustrationRerollPrompts(message.id)
          : undefined}
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [全部插图, album, snapshotAction?.running, onIllustrationRegenerate, onIllustrationRerollPrompts, message.id, 插图显示?.默认展开]);

  const effectivePathId = parsed.awakenPathId || fallbackPathId || '';
  const pathName = effectivePathId ? getPath(effectivePathId)?.name ?? '' : '';

  const card = (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5">
        <ToolButton
          label="修改正文"
          glyph="✎"
          active={openTool === 'edit'}
          onClick={() => toggle('edit')}
        />
        {turnActionView?.reparse_variables && (
          <ToolButton
            label={回合动作展示表.reparse_variables.label}
            glyph={回合动作展示表.reparse_variables.glyph}
            disabled={!turnActionView.reparse_variables.enabled}
            title={turnActionView.reparse_variables.detail ?? 回合动作展示表.reparse_variables.label}
            onClick={() => onTurnAction?.('reparse_variables')}
          />
        )}
        <ToolButton
          label="思维链"
          glyph="◇"
          active={openTool === 'thinking'}
          onClick={() => toggle('thinking')}
        />
        <ToolButton
          label="响应详情"
          glyph="◉"
          active={openTool === 'usage'}
          onClick={() => toggle('usage')}
        />
        <TurnBadge value={message.gameTime ?? '?'} />
        <ToolButton
          label="剧情规划"
          glyph="◇"
          active={openTool === 'storyPlan'}
          disabled={!parsed.storyPlan.trim()}
          onClick={() => toggle('storyPlan')}
        />
        <ToolButton
          label="小总结"
          glyph="✦"
          active={openTool === 'summary'}
          disabled={!parsed.memory}
          onClick={() => toggle('summary')}
        />
        <ToolButton
          label="原始消息"
          glyph="▣"
          active={openTool === 'raw'}
          onClick={() => toggle('raw')}
        />
        <ToolButton
          label="请求上下文"
          glyph="⬡"
          active={openTool === 'context'}
          onClick={() => toggle('context')}
        />
        {devMode && (
          <ToolButton
            label="请求诊断"
            glyph="◈"
            active={openTool === 'diagnostics'}
            onClick={() => toggle('diagnostics')}
          />
        )}
      </div>

      {openTool && (
        <div
          className="mb-2 animate-fade-in"
          style={{
            background: 'rgba(var(--tj-btn-primary-start), 0.04)',
            border: '1px solid rgba(var(--tj-btn-primary-start), var(--tj-edge-tint))',
            clipPath: cardClip,
          }}
        >
          {openTool === 'edit' && (
            <EditBodyPanel
              draft={draft}
              setDraft={setDraft}
              onSave={handleEditSave}
              onCancel={() => {
                setDraft(parsed.body);
                setOpenTool(null);
              }}
            />
          )}
          {openTool === 'thinking' && (
            <PanelText content={parsed.thinking.trim() || '本回合未输出思维链。'} label="思绪痕迹" />
          )}
          {openTool === 'usage' && (
            <UsagePanel message={message} onClose={() => setOpenTool(null)} />
          )}
          {openTool === 'storyPlan' && (
            <PanelText content={parsed.storyPlan.trim() || '本回合没有剧情规划保留项。'} label="剧情规划" />
          )}
          {openTool === 'summary' && <PanelText content={parsed.memory} label="记忆收录" />}
          {openTool === 'raw' && (
            <PanelText content={parsed.rawText.trim() || message.content || '本回合没有保存原始消息。'} label="原始消息" />
          )}
          {openTool === 'context' && (
            <PanelText content={格式化请求上下文(message)} label="请求上下文" />
          )}
          {openTool === 'diagnostics' && (
            <PanelText content={格式化本地诊断(message)} label="本地诊断（不会发送给主剧情）" />
          )}
        </div>
      )}

      <div className="px-1 py-2">
        {awakeningKind ? (
          <AwakeningOracleBlock
            content={parsed.body}
            pathName={pathName}
            kind={awakeningKind}
            npcRecords={npcRecords}
            traveler={traveler}
            album={album}
            showInnerVoice={showInnerVoice}
            deferOffscreen={deferOffscreen}
            visualTextSettings={visualTextSettings}
          />
        ) : (
          <BodyBlock
            content={展示正文}
            npcRecords={npcRecords}
            traveler={traveler}
            album={album}
            showInnerVoice={showInnerVoice}
            userInput={previousUserInput}
            visualTextSettings={visualTextSettings}
            deferOffscreen={deferOffscreen}
            行间插图={插图锚点}
            renderIllustration={渲染插图}
            逐句推进={逐句推进}
            生成中={isStreaming || message.isStreaming === true}
          />
        )}

        {isStreaming && (
          <span
            className="inline-block w-1.5 h-4 ml-1 animate-pulse-soft"
            style={{ background: 'rgb(var(--tj-btn-primary-start))', boxShadow: '0 0 6px rgba(var(--tj-btn-primary-start), 0.6)' }}
          />
        )}
      </div>

      {/*
        「默认显示文生图」关闭时，已出的插图不再占用正文空间（手动生成入口仍保留，
        否则用户就没有任何途径触发出图了）。
      */}
      {(
        (插图显示?.默认显示 === false
          ? false
          : (message.narrativeImages && message.narrativeImages.length > 0))
        || (narrativeImageManualEnabled && !isStreaming)
      ) && (
        <div className="px-1 py-2 space-y-2">
          {/* 已按锚点插进正文行间的插图不再在这里重复渲染。 */}
          {(插图显示?.默认显示 === false ? [] : 未落位插图).map((img) => (
            <NarrativeImageCard
              key={img.id}
              image={img}
              album={album}
              defaultExpanded={插图显示?.默认展开 === true}
              regenerating={snapshotAction?.running}
              onRegenerate={onIllustrationRegenerate
                ? (选项) => onIllustrationRegenerate(message.id, img, 选项)
                : undefined}
              onRerollPrompts={onIllustrationRerollPrompts
                ? () => onIllustrationRerollPrompts(message.id)
                : undefined}
            />
          ))}
          {/*
            手动入口就是一个按钮，始终保留（不再因为已出图而消失）：
            出图与「提示词不满意再来一次」都是它。
          */}
          {narrativeImageManualEnabled && (
            <NarrativeImageManualCard
              regenerating={snapshotAction?.running}
              阶段={snapshotAction?.阶段}
              onRegenerate={snapshotRegenerate}
              失败原因={snapshotAction?.detail}
            />
          )}
        </div>
      )}

      {awakeningKind === '出题' && parsed.awakenQuestions.trim() && (
        <AwakeningQuestionsBlock raw={parsed.awakenQuestions} />
      )}
      {awakeningKind === '评判' && parsed.awakenJudgement.trim() && (
        <>
          <AwakeningJudgementBadge judgement={parsed.awakenJudgement} />
          {judgementOutcome && (
            <AwakeningAftermathLine pathName={pathName} />
          )}
        </>
      )}

      <div
        className="mt-1 flex items-center justify-between px-1 text-xs tracking-wider"
        style={{ color: 'rgba(var(--tj-text-secondary), 0.65)' }}
      >
        <span>
          {message.responseDurationSec !== undefined ? (
            <>
              <span style={{ color: 'rgba(var(--tj-btn-primary-start), 0.5)' }}>◆</span>
              <span className="ml-1.5">{message.responseDurationSec}s</span>
            </>
          ) : (
            ''
          )}
        </span>
        <span>
          <span className="mr-1.5">{Array.from(parsed.body).length} 字</span>
          <span style={{ color: 'rgba(var(--tj-btn-primary-start), 0.5)' }}>◆</span>
        </span>
      </div>
    </div>
  );

  if (!awakeningKind) return card;

  return (
    <div
      className="p-3"
      style={{
        background:
          'linear-gradient(135deg, rgba(var(--tj-panel-bg-start),0.55) 0%, rgba(var(--tj-panel-bg-end),0.55) 60%, rgba(var(--tj-btn-primary-end),0.55) 100%)',
        border: '1px solid rgba(var(--tj-btn-primary-end), var(--tj-edge-tint-strong))',
        clipPath: panelClip,
      }}
    >
      <div
        className="mb-2 flex items-center justify-between text-[11px] font-serif tracking-[0.4em]"
        style={{ color: 'rgba(var(--tj-btn-primary-start),0.85)' }}
      >
        <span>◇ 命 途 狭 间 · {awakeningKind}</span>
        <span style={{ color: 'rgba(var(--tj-btn-primary-end),0.6)' }}>虚 境 之 问</span>
      </div>
      {card}
    </div>
  );
}
