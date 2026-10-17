import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGame } from '@/hooks/useGame';
import { useDeviceSettings } from '@/hooks/useDeviceSettings';
import { useAiTools, type AiToolsActions } from '@/hooks/useAiTools';
import { useHomePage } from '@/hooks/useHomePage';
import {
  exportAlbumInWorker,
  importAlbumInWorker,
  albumOperationStageLabel,
} from '@/components/features/GameSystems/album/albumArchiveWorkerClient';
import type { AlbumImportMode } from '@/components/features/GameSystems/album/albumArchive';
import { 写入相册设定 } from '@/utils/avatarActions';
import { LiveSyncBridge } from '@/components/features/Chat/LiveSyncBridge';
import { 发送远程输入, 是主机端 } from '@/services/localSave/liveSync';
import { devLog, devLogError } from '@/utils/devLog';
import { LandingPage } from '@/components/features/Home/LandingPage';
import { HomeTransitionOverlay, MysteryChatModal } from '@/components/features/Home/HomeOverlays';
import { GameView } from '@/components/layout/GameView';
import { TopBar } from '@/components/layout/TopBar';
import { LeftPanel } from '@/components/layout/LeftPanel';
import { RightMenu } from '@/components/layout/RightMenu';
import { SystemDrawer } from '@/components/layout/SystemDrawer';
import { MobileQuickMenu } from '@/components/layout/MobileQuickMenu';
import { ChatList } from '@/components/features/Chat/ChatList';
import { InputArea } from '@/components/features/Chat/InputArea';
import { RecoveryBanner } from '@/components/features/Chat/RecoveryBanner';
import { VariableDrawer } from '@/components/features/Variable/VariableDrawer';
import type { SettingsTab } from '@/components/features/Settings/SettingsModal';
import { PathAwakeningInvitation } from '@/components/features/Path/PathAwakeningInvitation';
import { ContinuityBanner } from '@/components/features/Chat/ContinuityBanner';
import { TravelerProfileModal } from '@/components/features/Character/TravelerProfileModal';
import { VariableRepairPreviewModal } from '@/components/features/Variable/VariableRepairPreviewModal';
import { GAME_MENU_ITEMS, type GameSystemId } from '@/data/gameMenu';
import { saveSetting } from '@/services/storage/settings';
import { getCurrentStoryChapterLabel } from '@/services/storyProgressService';
import { isOpeningLanded, shouldStartOpening } from '@/models/opening';
import { pushQueueTask } from '@/hooks/useGame/workflowTaskRuntime';
import type { 角色数据结构 } from '@/models/character';
import type { NPC记录 } from '@/models/npc';
import type { 世界书 } from '@/models/worldbook';
import type { 相册系统 } from '@/models/imageGeneration';
import type { 新闻条目 } from '@/models/news';
import type { 剧情节点 } from '@/models/plot';
import type { 记忆系统 } from '@/models/memory';
import type { 忆庭系统 } from '@/models/yiting';
import type { 智库系统 } from '@/models/zhiku';
import type { 命途ID } from '@/models/journey';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import type { 战技生成草稿, 战技生成上下文 } from '@/contracts/ai';
import {
  CompanionPanel,
  GitHubCloudSaveModal,
  ImageWorkbenchPanel,
  InventoryPanel,
  LazySurface,
  MemoryPanel,
  NewGameWizard,
  NewsPanel,
  PathPanel,
  PhoneModal,
  PlotPanel,
  ReleaseAnnouncementsModal,
  SaveManager,
  SettingsModal,
  SkillPanel,
  WorldbookManagerModal,
  YitingPanel,
  ZhikuManagerModal,
  ZhikuSystemPanel,
} from '@/components/lazy/surfaces';
import { useSurfaceWarmup } from '@/hooks/useSurfaceWarmup';
import { PresetLoadBar } from '@/components/ui/PresetLoadBar';

export function App() {
  const { state, actions, canRerollWithTree, rerollParentStatus } = useGame();
  const { apiSettings, gameSettings, theme: currentTheme, worldbooks } = state.deviceSettings;
  const {
    persistGameSettings,
    persistApiSettings,
    persistTheme,
    persistWorldbooks,
    persistApiProfile,
    loadApiProfileSlots,
    persistApiProfileSlots,
    loadAuxApiProfiles,
    persistAuxApiProfiles,
    loadGitHubCloudSaveConfig,
    persistGitHubCloudSaveConfig,
  } = useDeviceSettings();
  const aiTools = useAiTools();
  const {
    fetchModels,
    testConnection,
    loadApiErrorReports,
    clearApiErrorReports,
  } = aiTools;
  const [showSettings, setShowSettings] = useState(false);
  const [showWorldbookManager, setShowWorldbookManager] = useState(false);
  const [showZhikuManager, setShowZhikuManager] = useState(false);
  const [showSaveLoad, setShowSaveLoad] = useState(false);
  const [showCloudSave, setShowCloudSave] = useState(() => window.location.pathname === '/oauth/github/callback');
  const [showReleaseAnnouncements, setShowReleaseAnnouncements] = useState(false);
  const [showMysteryChat, setShowMysteryChat] = useState(false);
  const [showCharacter, setShowCharacter] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  /**
   * 只在「从某处深链打开设置」时给值；普通打开留空，由 SettingsModal 回到上次那一页。
   */
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined);
  const [activeSystem, setActiveSystem] = useState<GameSystemId | null>(null);
  const [undoDraft, setUndoDraft] = useState<{ id: string; text: string } | null>(null);

  const handleMenuSelect = useCallback((id: GameSystemId) => {
    if (id === 'worldbook') {
      setActiveSystem(null);
      setShowWorldbookManager(true);
      return;
    }
    setActiveSystem((current) => (current === id ? null : id));
  }, []);

  const handleOpenNews = useCallback(() => setActiveSystem('news'), []);
  const handleOpenProfile = useCallback(() => setShowCharacter(true), []);
  const handleOpenPhone = useCallback(() => setShowPhone(true), []);
  const handleOpenSaveLoad = useCallback(() => setShowSaveLoad(true), []);
  const handleOpenSettings = useCallback(() => {
    setSettingsInitialTab(undefined);
    setShowSettings(true);
  }, []);

  /**
   * 打开设置并直接落在指定页签。
   *
   * 用于「视觉资产」这类页面里的引导按钮：文生图设置埋在「子系统」分组里，
   * 只写一句「去设置里开」用户很可能找不到（实际反馈过）。
   */
  const handleOpenSettingsAt = useCallback((页签: SettingsTab) => {
    setSettingsInitialTab(页签);
    setShowSettings(true);
  }, []);
  const handleCloseSystemDrawer = useCallback(() => setActiveSystem(null), []);

  /*
   * 相册备份的导入导出。
   *
   * 旧分支这两件事在相册面板里，新版工作台把面板换掉后没有接上，
   * 于是图库既导不出去也导不回来。这里复用归档 worker，
   * 导出只是下载文件，导入则替换/合并当前相册并立刻写进活跃叶子。
   */
  const [albumOperationLabel, setAlbumOperationLabel] = useState('');

  const handleExportAlbum = useCallback(() => {
    setAlbumOperationLabel('正在导出相册…');
    void (async () => {
      try {
        const 结果 = await exportAlbumInWorker(state.相册, (进度) => {
          const 后缀 = 进度.total && 进度.total > 0
            ? ` ${Math.min(进度.completed ?? 0, 进度.total)}/${进度.total}`
            : '';
          setAlbumOperationLabel(`${albumOperationStageLabel(进度)}${后缀}`);
        });
        devLog('save', 'album-export-done', { ...结果 });
      } catch (错误) {
        devLogError('save', 'album-export-failed', 错误);
      } finally {
        setAlbumOperationLabel('');
      }
    })();
  }, [state.相册]);

  const handleImportAlbum = useCallback((file: File | null, mode: AlbumImportMode) => {
    if (!file) return;
    setAlbumOperationLabel('正在导入相册…');
    void (async () => {
      try {
        const 结果 = await importAlbumInWorker({
          file,
          currentAlbum: state.相册,
          mode,
          onProgress: (进度) => setAlbumOperationLabel(albumOperationStageLabel(进度)),
        });
        if (!结果) return;
        const 落盘 = await 写入相册设定(state, 结果.album);
        devLog('save', 'album-import-done', { ...结果.stats, 已落盘: 落盘.成功 });
      } catch (错误) {
        devLogError('save', 'album-import-failed', 错误);
      } finally {
        setAlbumOperationLabel('');
      }
    })();
  }, [state]);
  const closeTransientUi = useCallback(() => {
    setActiveSystem(null);
    setShowCharacter(false);
    setShowPhone(false);
    setShowSaveLoad(false);
    setShowSettings(false);
    setShowWorldbookManager(false);
    setShowZhikuManager(false);
  }, []);
  const loadSaveIntoGame = useCallback(async (id: number) => {
    const ok = await actions.handleLoadSave(id);
    if (ok) closeTransientUi();
    return ok;
  }, [actions, closeTransientUi]);
  const branchSaveIntoGame = useCallback(async (id: number) => {
    const ok = await actions.handleBranch(id);
    if (ok) closeTransientUi();
    return ok;
  }, [actions, closeTransientUi]);
  const handleGoHomeClick = useCallback(() => {
    closeTransientUi();
    actions.handleGoHome();
  }, [actions, closeTransientUi]);
  const handleToggleStreaming = useCallback(() => {
    state.setDeviceGameSettings((prev) => ({
      ...prev,
      enableStreaming: !prev.enableStreaming,
    }));
  }, [state]);
  const handleEditBody = useCallback((id: string, newBody: string) => {
    state.setChatHistory((prev) =>
      prev.map((m) =>
        m.id === id && m.parsedResponse
          ? {
              ...m,
              content: newBody,
              parsedResponse: { ...m.parsedResponse, body: newBody },
            }
          : m,
      ),
    );
  }, [state]);
  const handlePathAwakeningTrigger = useCallback(() => {
    void actions.handleSend('[系统] 踏入命途狭间');
  }, [actions]);
  const handleAwakenedNewPath = useCallback((id: 命途ID) => {
    console.info('[path] 命途狭间触发:', id);
  }, []);

  // boot 门禁：预置数据（原著正文 + 智库目录）两路都 ready 才放行，失败不解除门禁。
  const presetDataReady = state.presetDataReady;
  const zhikuCatalogStatus = state.zhikuCatalogStatus;
  const presetBar = (
    <PresetLoadBar loader={state.presetLoader} onRetry={state.retryPresetLoad} />
  );

  const home = useHomePage({
    onEnterNewGame: () => { actions.handleNewGame(); },
    onEnterLoadSave: () => setShowSaveLoad(true),
    onEnterWorldbook: () => setShowWorldbookManager(true),
    onEnterGame: () => state.setView('game'),
    onOpenZhiku: () => setShowZhikuManager(true),
    onOpenSettings: handleOpenSettings,
    onOpenCloudSave: () => setShowCloudSave(true),
    onOpenAnnouncements: () => setShowReleaseAnnouncements(true),
    onOpenMysteryChat: () => setShowMysteryChat(true),
    dataReady: presetDataReady,
  });

  const activeMenuItem = activeSystem
    ? GAME_MENU_ITEMS.find((item) => item.id === activeSystem) ?? null
    : null;
  const currentStoryChapter = useMemo(() => {
    return getCurrentStoryChapterLabel(state.剧情编织);
  }, [state.剧情编织]);
  const latestRecallSummary = useMemo(() => {
    if (state.activeWorkflow.loading && state.activeWorkflow.liveRecallSummary.trim()) return state.activeWorkflow.liveRecallSummary.trim();
    const latest = [...state.chatHistory]
      .reverse()
      .find((msg) =>
        msg.role === 'assistant' &&
        (
          msg.debugContext?.recallSummary?.trim() ||
          msg.debugContext?.zhikuRecallPreview?.trim()
        ),
      );
    return latest?.debugContext?.recallSummary?.trim()
      || latest?.debugContext?.zhikuRecallPreview?.trim()
      || '';
  }, [state.chatHistory, state.activeWorkflow.liveRecallSummary, state.activeWorkflow.loading]);
  const latestRecallFullContent = useMemo(() => {
    if (state.activeWorkflow.loading && state.activeWorkflow.liveRecallFullContent.trim()) return state.activeWorkflow.liveRecallFullContent.trim();
    const latest = [...state.chatHistory]
      .reverse()
      .find((msg) =>
        msg.role === 'assistant' &&
        (
          msg.debugContext?.recallFullContent?.trim() ||
          msg.debugContext?.zhikuRecallInjection?.trim()
        ),
      );
    return latest?.debugContext?.recallFullContent?.trim()
      || latest?.debugContext?.zhikuRecallInjection?.trim()
      || '';
  }, [state.chatHistory, state.activeWorkflow.liveRecallFullContent, state.activeWorkflow.loading]);

  const actionOptions = useMemo(() => (
    [...state.chatHistory]
      .reverse()
      .find((m) => m.role === 'assistant')?.parsedResponse?.actionOptions ?? []
  ), [state.chatHistory]);

  const canReroll = useMemo(
    () => state.chatHistory.some((m) => m.role === 'assistant') && canRerollWithTree,
    [state.chatHistory, canRerollWithTree],
  );
  const rerollDisabledReason = useMemo(
    () => (rerollParentStatus === 'pending'
      ? '正在验证历史存档…'
      : !canRerollWithTree ? '当前没有可以回退的历史存档' : undefined),
    [rerollParentStatus, canRerollWithTree],
  );

  const narrativeImageManualEnabled = gameSettings.文生图系统.正文配图.启用
    && gameSettings.文生图系统.正文配图.模式 === 'manual';

  // 正文插图的显示方式。用 useMemo 保持引用稳定，否则每次渲染都会重建对象、
  // 让下游依赖它的 memo 全部失效。
  const 插图显示 = useMemo(() => ({
    默认显示: gameSettings.文生图系统.正文配图.默认显示,
    默认展开: gameSettings.文生图系统.正文配图.默认展开,
  }), [
    gameSettings.文生图系统.正文配图.默认显示,
    gameSettings.文生图系统.正文配图.默认展开,
  ]);

  // 逐句推进设置：同样保持引用稳定，否则每轮渲染都会让正文整片重算。
  const 逐句推进 = useMemo(() => ({
    启用: gameSettings.逐句推进?.启用 === true,
    立即全显: gameSettings.逐句推进?.立即全显 === true,
  }), [gameSettings.逐句推进?.启用, gameSettings.逐句推进?.立即全显]);

  const turnBusy = state.activeWorkflow.loading || state.activeWorkflow.pendingVariable;

  const turnActionContext = useMemo(() => ({
    queueTasks: state.queueTasks,
    busy: turnBusy,
    正文生图手动模式: narrativeImageManualEnabled,
    变量更新启用: gameSettings.enableVariableUpdate,
  }), [state.queueTasks, turnBusy, narrativeImageManualEnabled, gameSettings.enableVariableUpdate]);
  const recoveryPhase = state.turnPhase;
  const hasRecovery = Boolean(state.activeWorkflow.recovery);

  // openingLanded 单独 memo 成布尔值，否则无关更新会反复触发开局派发。
  const openingLanded = useMemo(
    () => isOpeningLanded(state.turnCount, state.chatHistory),
    [state.turnCount, state.chatHistory],
  );
  useEffect(() => {
    if (state.view !== 'game') return;
    if (!shouldStartOpening({
      turnPhase: state.turnPhase,
      openingLanded,
      hasRecovery,
    })) return;
    void actions.handleStartOpening();
  }, [state.view, state.turnPhase, openingLanded, hasRecovery, actions]);

  useSurfaceWarmup({
    bootSettled: state.bootSettled,
    view: state.view,
    busy: state.activeWorkflow.loading,
  });

  const topBar = (
    <TopBar
      worldState={state.世界}
      currentTheme={currentTheme}
      onHome={handleGoHomeClick}
      news={state.新闻}
      onOpenNews={handleOpenNews}
    />
  );

  const leftPanel = (
    <LeftPanel
      traveler={state.旅人}
      album={state.相册}
      onOpenProfile={handleOpenProfile}
      onOpenPhone={handleOpenPhone}
      phoneUnread={state.手机.unreadTotal}
      currentStoryChapter={currentStoryChapter}
      recallSummary={latestRecallSummary}
      recallFullContent={latestRecallFullContent}
    />
  );

  const rightPanel = (
    <RightMenu
      activeId={activeSystem}
      onSelect={handleMenuSelect}
      onSaveGame={handleOpenSaveLoad}
      onLoadGame={handleOpenSaveLoad}
      onSettings={handleOpenSettings}
    />
  );

  const chatArea = (
    <>
      <VariableDrawer
        batches={state.variableBatches}
        tasks={state.queueTasks}
        pending={state.activeWorkflow.pendingVariable}
        onRetryTask={actions.handleRetryQueueTask}
        onCancelTask={actions.handleCancelTask}
      />
      <ChatList
        messages={state.chatHistory}
        loading={state.activeWorkflow.loading}
        scrollRef={state.scrollRef}
        npcRecords={state.NPC}
        traveler={state.旅人}
        album={state.相册}
        showInnerVoice={gameSettings.enableInnerVoice}
        visualTextSettings={gameSettings.visualTextSettings}
        turnActions={actions.turnActions}
        turnActionContext={turnActionContext}
        narrativeImageManualEnabled={narrativeImageManualEnabled}
        插图显示={插图显示}
        逐句推进={逐句推进}
        onEditBody={handleEditBody}
        devMode={gameSettings.devMode}
        onIllustrationRegenerate={(messageId, 插图, 选项) => {
          // 单张重生失败结果已写在插图自身（卡片上会显示），这里只兜住未捕获的异常。
          void actions.handleRegenerateIllustration(messageId, 插图, 选项).catch((错误) => {
            pushQueueTask(
              state,
              'narrative_image_generate',
              'failed',
              {
                detail: `插图重新生成失败：${错误 instanceof Error ? 错误.message : String(错误)}`,
                targetMessageId: messageId,
              },
              state.turnCount,
            );
          });
        }}
        onIllustrationRerollPrompts={(messageId) => {
          void actions.handleRerollIllustrationPrompts(messageId).catch((错误) => {
            pushQueueTask(
              state,
              'narrative_image_parse',
              'failed',
              {
                detail: `重跑插图提示词失败：${错误 instanceof Error ? 错误.message : String(错误)}`,
                targetMessageId: messageId,
              },
              state.turnCount,
            );
          });
        }}
      />
      <PathAwakeningInvitation
        world={state.世界}
        setWorld={state.set世界}
        onTrigger={handlePathAwakeningTrigger}
        disabled={turnBusy}
      />
      <ContinuityBanner
        world={state.世界}
        storyWeaving={state.剧情编织}
        setWorld={state.set世界}
        setStoryWeaving={state.set剧情编织}
      />
      {hasRecovery && !turnBusy ? (
        <RecoveryBanner
          phase={recoveryPhase}
          onResume={() => { void actions.handleResumeRecovery(); }}
          onAbandon={() => { void actions.handleAbandonRecovery(); }}
          onRetry={() => { void actions.handleRetryRecovery(); }}
          onUndo={() => {
            void actions.handleUndoRecovery().then((text) => {
              if (text) setUndoDraft({ id: `undo-${Date.now()}`, text });
            });
          }}
        />
      ) : null}
      <InputArea
        key={state.activeWorkflow.sessionEpoch}
        onSend={(text) => {
          if (是主机端()) {
            void actions.handleSend(text);
            return;
          }
          // 遥控端（手机，局域网）：不本地生成，把输入转给主机；同时本地补一条用户消息（纯显示）。
          void 发送远程输入(text);
          state.setChatHistory((前) => [
            ...前,
            { id: `remote-user-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() },
          ]);
        }}
        onAbort={actions.handleAbort}
        loading={state.activeWorkflow.loading}
        disabled={state.activeWorkflow.pendingVariable}
        canRestartOpening={state.turnCount <= 5}
        canReroll={canReroll}
        rerollDisabledReason={rerollDisabledReason}
        onRestartOpening={() => {
          void actions.handleRestartOpening();
        }}
        onReroll={actions.handleReroll}
        streamingEnabled={gameSettings.enableStreaming}
        onToggleStreaming={handleToggleStreaming}
        turnStatus={state.activeWorkflow.turnStatus}
        onCancelWorkflow={actions.handleAbort}
        actionOptions={actionOptions}
        draft={undoDraft}
        onParseActionOptions={actions.handleParseActionOptionsBlock}
      />
      <SystemDrawer
        open={activeSystem !== null}
        title={activeMenuItem?.label ?? ''}
        subtitle={activeMenuItem?.subtitle}
        glyph={activeMenuItem?.glyph}
        onClose={handleCloseSystemDrawer}
      >
        <LazySurface label="系统面板载入中">
          {renderSystemPanel(activeSystem, {
            traveler: state.旅人,
            onTravelerChange: state.set旅人,
            onAwakenedNewPath: handleAwakenedNewPath,
            npcRecords: state.NPC,
            onNpcRecordsChange: state.setNPC,
            album: state.相册,
            onAlbumChange: state.set相册,
            state,
            onExportAlbum: handleExportAlbum,
            onImportAlbum: handleImportAlbum,
            albumOperationLabel,
            albumOperationBusy: Boolean(albumOperationLabel),
            phone: state.手机,
            onPhoneChange: state.set手机,
            memorySystem: state.记忆,
            onMemorySystemChange: state.set记忆,
            onRetryMemoryDraft: actions.handleRetryMemoryDraft,
            onIgnoreMemoryDraft: actions.handleIgnoreMemoryDraft,
            yitingSystem: state.忆庭,
            zhikuSystem: state.智库,
            onZhikuSystemChange: state.set智库,
            zhikuSettings: gameSettings.智库系统,
            onSaveZhikuSystem: actions.handleSaveZhikuSystem,
            onZhikuMigration: actions.handleZhikuMigration,
            memorySettings: gameSettings.记忆系统,
            news: state.新闻,
            onNewsChange: state.set新闻,
            plotNodes: state.剧情,
            onPlotNodesChange: state.set剧情,
            storyWeaving: state.剧情编织,
            onStoryWeavingChange: state.set剧情编织,
            gameSettings,
            onGameSettingsChange: state.setDeviceGameSettings,
            onPersistGameSettings: persistGameSettings,
            apiSettings,
            turnCount: state.turnCount,
            mainChatHistory: state.chatHistory,
            fetchModels,
            onSaveStoryWeaving: actions.handleSaveStoryWeaving,
            onGenerateSkillDraft: actions.handleGenerateSkillDraft,
            onOpenSettingsAt: handleOpenSettingsAt,
          })}
        </LazySurface>
      </SystemDrawer>
    </>
  );

  if (state.view === 'home') {
    return (
      <>
        <LandingPage view={home.view} commands={home.commands} />
        <HomeTransitionOverlay transition={home.transition} />
        {presetBar}
        {showWorldbookManager && (
          <LazySurface label="如我所书载入中">
            <WorldbookManagerModal
              worldbooks={worldbooks}
              onSave={(books: 世界书[]) => {
                state.setDeviceWorldbooks(books);
                void saveSetting('worldbooks', books);
              }}
              onClose={() => setShowWorldbookManager(false)}
            />
          </LazySurface>
        )}
        {showZhikuManager && (
          <LazySurface label="智库载入中">
            <ZhikuManagerModal
              zhikuSystem={state.智库}
              storyWeavingSystem={state.剧情编织}
              onZhikuSystemChange={state.set智库}
              settings={gameSettings.智库系统}
              onSaveZhikuSystem={actions.handleSaveZhikuSystem}
              onZhikuMigration={actions.handleZhikuMigration}
              onClose={() => setShowZhikuManager(false)}
              catalogStatus={zhikuCatalogStatus}
            />
          </LazySurface>
        )}
        {showSaveLoad && (
          <LazySurface label="存档系统载入中">
            <SaveManager
              variant="modal"
              showAutoArchives={gameSettings.enableAutoSaveEveryTurn}
              onExportActiveLeafPackage={actions.handleExportActiveLeafPackage}
              onLoad={loadSaveIntoGame}
              onBranch={branchSaveIntoGame}
              onDeleteSave={actions.handleDeleteSave}
              onDeleteSaveTree={actions.handleDeleteSaveTree}
              onClearActiveSaveTreeMeta={actions.handleClearActiveSaveTreeMeta}
              onGetSaveCatalogSnapshot={actions.handleGetSaveCatalogSnapshot}
              onStartSaveCatalogRepair={actions.handleStartSaveCatalogRepair}
              onSubscribeSaveCatalogRepair={actions.handleSubscribeSaveCatalogRepair}
              onRepairSaveDatabase={actions.handleRepairSaveDatabase}
              onDeleteLegacyBackupSaves={actions.handleDeleteLegacyBackupSaves}
              onExportSavePackage={actions.handleExportSavePackage}
              onExportSaveTreePackage={actions.handleExportSaveTreePackage}
              onImportSaveFileAsMany={actions.handleImportSaveFileAsMany}
              onClose={() => setShowSaveLoad(false)}
            />
          </LazySurface>
        )}
        {showCloudSave && (
          <LazySurface label="云存档载入中">
            <GitHubCloudSaveModal
              onClose={() => setShowCloudSave(false)}
              onLoadCloudConfig={loadGitHubCloudSaveConfig}
              onPersistCloudConfig={persistGitHubCloudSaveConfig}
              onGetSaveCatalogSnapshot={actions.handleGetSaveCatalogSnapshot}
              onLoadSaveForCloudTransfer={actions.handleLoadSaveForCloudTransfer}
            />
          </LazySurface>
        )}
        {showReleaseAnnouncements && (
          <LazySurface label="公告载入中">
            <ReleaseAnnouncementsModal
              onClose={() => setShowReleaseAnnouncements(false)}
            />
          </LazySurface>
        )}
        {showMysteryChat && (
          <MysteryChatModal onClose={() => setShowMysteryChat(false)} />
        )}
        {showSettings && (
          <LazySurface label="设置载入中">
            <SettingsModal
              onClose={() => setShowSettings(false)}
              deviceSettings={state.deviceSettings}
              onApiSettingsChange={state.setDeviceApiSettings}
              onGameSettingsChange={state.setDeviceGameSettings}
              onThemeChange={state.setDeviceTheme}
              onPersistGameSettings={persistGameSettings}
              onPersistApiSettings={persistApiSettings}
              onPersistTheme={persistTheme}
              onPersistApiProfile={persistApiProfile}
              onLoadApiProfileSlots={loadApiProfileSlots}
              onPersistApiProfileSlots={persistApiProfileSlots}
              onLoadAuxApiProfiles={loadAuxApiProfiles}
              onPersistAuxApiProfiles={persistAuxApiProfiles}
              fetchModels={fetchModels}
              testConnection={testConnection}
              loadApiErrorReports={loadApiErrorReports}
              clearApiErrorReports={clearApiErrorReports}
              onContinue={actions.handleContinue}
              onLoadSave={loadSaveIntoGame}
              onBranchSave={branchSaveIntoGame}
              initialTab={settingsInitialTab}
              旅人={state.旅人}
              世界={state.世界}
              on世界Change={state.set世界}
              记忆={state.记忆}
              忆庭={state.忆庭}
              智库={state.智库}
              手机={state.手机}
              NPC={state.NPC}
              新闻={state.新闻}
              剧情编织={state.剧情编织}
              on剧情编织Change={state.set剧情编织}
              getContextSnapshot={actions.getContextSnapshot}
            变量修复中心={actions.变量修复中心}

              onWorldbooksChange={(books: 世界书[]) => {

                state.setDeviceWorldbooks(books);

                void persistWorldbooks(books);

              }}
              onDeleteSave={actions.handleDeleteSave}
              onDeleteSaveTree={actions.handleDeleteSaveTree}
              onClearActiveSaveTreeMeta={actions.handleClearActiveSaveTreeMeta}
              onGetSaveCatalogSnapshot={actions.handleGetSaveCatalogSnapshot}
              onStartSaveCatalogRepair={actions.handleStartSaveCatalogRepair}
              onSubscribeSaveCatalogRepair={actions.handleSubscribeSaveCatalogRepair}
              onRepairSaveDatabase={actions.handleRepairSaveDatabase}
              onDeleteLegacyBackupSaves={actions.handleDeleteLegacyBackupSaves}
              onExportSavePackage={actions.handleExportSavePackage}
              onExportSaveTreePackage={actions.handleExportSaveTreePackage}
              onImportSaveFileAsMany={actions.handleImportSaveFileAsMany}
              onExtractTavernRegexScripts={actions.handleExtractTavernRegexScripts}
              onAnalyzeTavernRegexScript={actions.handleAnalyzeTavernRegexScript}
              onDryRunTavernRegexScript={actions.handleDryRunTavernRegexScript}
              variableSetters={{
                set旅人: state.set旅人,
                set世界: state.set世界,
                set记忆: state.set记忆,
                set忆庭: state.set忆庭,
                set智库: state.set智库,
                set手机: state.set手机,
                setNPC: state.setNPC,
                set新闻: state.set新闻,
                set剧情: state.set剧情,
              }}
              variableEditingLocked={turnBusy}
            />
          </LazySurface>
        )}
      </>
    );
  }

  if (state.view === 'new_game') {
    return (
      <>
        <LazySurface label="开局档案载入中">
          <NewGameWizard
            onStart={async (draft) => {
              const ok = await actions.handlePrepareNewGame(draft);
              if (!ok) return;
              home.commands.launchJourney();
            }}
            onBack={() => state.setView('home')}
            onLoadOpeningPresets={actions.handleLoadOpeningPresets}
            onSaveOpeningPresets={actions.handleSaveOpeningPresets}
            onParseOpeningArchive={actions.handleParseOpeningArchive}
            onGenerateTravelerTemplate={actions.handleGenerateTravelerTemplate}
            presetReady={presetDataReady}
          />
        </LazySurface>
        <HomeTransitionOverlay transition={home.transition} />
        {presetBar}
      </>
    );
  }

  return (
    <>
      <LiveSyncBridge
        on远程输入={(text) => { void actions.handleSend(text); }}
        on追加消息={(消息) => {
          // 遥控端：把主机这一回合追加到本地聊天（纯显示；不载入、不分叉）
          state.setChatHistory((前) => (
            前.some((项) => 项.id === 消息.id) ? 前 : [...前, 消息]
          ));
        }}
      />
      <GameView
        weatherId={state.世界.当前天气}
        topBar={topBar}
        leftPanel={leftPanel}
        rightPanel={rightPanel}
        chatArea={chatArea}
      />

      {!activeSystem && !showSettings && !showWorldbookManager && !showZhikuManager && !showSaveLoad && !showCharacter && !showPhone && (
        <MobileQuickMenu
          onHome={handleGoHomeClick}
          onCharacter={handleOpenProfile}
          onPhone={handleOpenPhone}
          onSettings={handleOpenSettings}
          onSave={handleOpenSaveLoad}
          onSystemSelect={handleMenuSelect}
          phoneUnread={state.手机.unreadTotal}
        />
      )}

      {showSettings && (
        <LazySurface label="设置载入中">
          <SettingsModal
            onClose={() => setShowSettings(false)}
            deviceSettings={state.deviceSettings}
            onApiSettingsChange={state.setDeviceApiSettings}
            onGameSettingsChange={state.setDeviceGameSettings}
            onThemeChange={state.setDeviceTheme}
            onPersistGameSettings={persistGameSettings}
            onPersistApiSettings={persistApiSettings}
            onPersistTheme={persistTheme}
            onPersistApiProfile={persistApiProfile}
            onLoadApiProfileSlots={loadApiProfileSlots}
            onPersistApiProfileSlots={persistApiProfileSlots}
            onLoadAuxApiProfiles={loadAuxApiProfiles}
            onPersistAuxApiProfiles={persistAuxApiProfiles}
            fetchModels={fetchModels}
            testConnection={testConnection}
            loadApiErrorReports={loadApiErrorReports}
            clearApiErrorReports={clearApiErrorReports}
            onContinue={actions.handleContinue}
            onLoadSave={loadSaveIntoGame}
            onBranchSave={branchSaveIntoGame}
            initialTab={settingsInitialTab}
            旅人={state.旅人}
            世界={state.世界}
            on世界Change={state.set世界}
            记忆={state.记忆}
            忆庭={state.忆庭}
            智库={state.智库}
            手机={state.手机}
            NPC={state.NPC}
            新闻={state.新闻}
            剧情编织={state.剧情编织}
            on剧情编织Change={state.set剧情编织}
            getContextSnapshot={actions.getContextSnapshot}
            变量修复中心={actions.变量修复中心}
            onWorldbooksChange={(books: 世界书[]) => {
              state.setDeviceWorldbooks(books);
              void persistWorldbooks(books);
            }}
            onDeleteSave={actions.handleDeleteSave}
            onDeleteSaveTree={actions.handleDeleteSaveTree}
            onClearActiveSaveTreeMeta={actions.handleClearActiveSaveTreeMeta}
            onGetSaveCatalogSnapshot={actions.handleGetSaveCatalogSnapshot}
            onStartSaveCatalogRepair={actions.handleStartSaveCatalogRepair}
            onSubscribeSaveCatalogRepair={actions.handleSubscribeSaveCatalogRepair}
            onRepairSaveDatabase={actions.handleRepairSaveDatabase}
            onDeleteLegacyBackupSaves={actions.handleDeleteLegacyBackupSaves}
            onExportSavePackage={actions.handleExportSavePackage}
            onExportSaveTreePackage={actions.handleExportSaveTreePackage}
            onImportSaveFileAsMany={actions.handleImportSaveFileAsMany}
            onExtractTavernRegexScripts={actions.handleExtractTavernRegexScripts}
            onAnalyzeTavernRegexScript={actions.handleAnalyzeTavernRegexScript}
            onDryRunTavernRegexScript={actions.handleDryRunTavernRegexScript}
            variableSetters={{
              set旅人: state.set旅人,
              set世界: state.set世界,
              set记忆: state.set记忆,
              set忆庭: state.set忆庭,
              set智库: state.set智库,
              set手机: state.set手机,
              setNPC: state.setNPC,
              set新闻: state.set新闻,
              set剧情: state.set剧情,
            }}
            variableEditingLocked={turnBusy}
          />
        </LazySurface>
      )}

      {showCharacter && (
        <TravelerProfileModal
          traveler={state.旅人}
          album={state.相册}
          onClose={() => setShowCharacter(false)}
        />
      )}

      {actions.变量修复.计划 && (
        <VariableRepairPreviewModal
          plan={actions.变量修复.计划}
          receipt={actions.变量修复.回执}
          committing={actions.变量修复.提交中}
          onClose={actions.变量修复.关闭}
          onCommit={(confirmedItemIds) => { void actions.变量修复.提交(confirmedItemIds); }}
        />
      )}

      {showPhone && (
        <LazySurface label="手机载入中">
          <PhoneModal
            phone={state.手机}
            traveler={state.旅人}
            world={state.世界}
            news={state.新闻}

            zhiku={state.智库}
            apiSettings={apiSettings}
            gameSettings={gameSettings}
            turnCount={state.turnCount}
            mainChatHistory={state.chatHistory}
            npcRecords={state.NPC}
            album={state.相册}
            onPhoneChange={state.set手机}
            onPhoneMemoryCommit={actions.handlePhoneMemoryCommit}
            onGeneratePhoneReply={actions.handleGeneratePhoneReply}
            onClose={() => setShowPhone(false)}
          />
        </LazySurface>
      )}

      {showWorldbookManager && (
        <LazySurface label="如我所书载入中">
          <WorldbookManagerModal
            worldbooks={worldbooks}
            onSave={(books: 世界书[]) => {
              state.setDeviceWorldbooks(books);
              void saveSetting('worldbooks', books);
            }}
            onClose={() => setShowWorldbookManager(false)}
          />
        </LazySurface>
      )}

      {showZhikuManager && (
        <LazySurface label="智库载入中">
          <ZhikuManagerModal
            zhikuSystem={state.智库}
            storyWeavingSystem={state.剧情编织}
            onZhikuSystemChange={state.set智库}
            settings={gameSettings.智库系统}
            onSaveZhikuSystem={actions.handleSaveZhikuSystem}
            onZhikuMigration={actions.handleZhikuMigration}
            onClose={() => setShowZhikuManager(false)}
            catalogStatus={zhikuCatalogStatus}
          />
        </LazySurface>
      )}

      {showSaveLoad && (
        <LazySurface label="存档系统载入中">
          <SaveManager
            variant="modal"
            showAutoArchives={gameSettings.enableAutoSaveEveryTurn}
            onExportActiveLeafPackage={actions.handleExportActiveLeafPackage}
            onLoad={loadSaveIntoGame}
            onBranch={branchSaveIntoGame}
            onDeleteSave={actions.handleDeleteSave}
            onDeleteSaveTree={actions.handleDeleteSaveTree}
            onClearActiveSaveTreeMeta={actions.handleClearActiveSaveTreeMeta}
            onGetSaveCatalogSnapshot={actions.handleGetSaveCatalogSnapshot}
            onStartSaveCatalogRepair={actions.handleStartSaveCatalogRepair}
            onSubscribeSaveCatalogRepair={actions.handleSubscribeSaveCatalogRepair}
            onRepairSaveDatabase={actions.handleRepairSaveDatabase}
            onDeleteLegacyBackupSaves={actions.handleDeleteLegacyBackupSaves}
            onExportSavePackage={actions.handleExportSavePackage}
            onExportSaveTreePackage={actions.handleExportSaveTreePackage}
            onImportSaveFileAsMany={actions.handleImportSaveFileAsMany}
            onClose={() => setShowSaveLoad(false)}
          />
        </LazySurface>
      )}

      {showCloudSave && (
        <LazySurface label="云存档载入中">
          <GitHubCloudSaveModal
            onClose={() => setShowCloudSave(false)}
            onLoadCloudConfig={loadGitHubCloudSaveConfig}
            onPersistCloudConfig={persistGitHubCloudSaveConfig}
            onGetSaveCatalogSnapshot={actions.handleGetSaveCatalogSnapshot}
            onLoadSaveForCloudTransfer={actions.handleLoadSaveForCloudTransfer}
          />
        </LazySurface>
      )}
    </>
  );
}

function renderSystemPanel(
  id: GameSystemId | null,
  ctx: {
    traveler: 角色数据结构;
    onTravelerChange: React.Dispatch<React.SetStateAction<角色数据结构>>;
    onAwakenedNewPath: (id: 命途ID) => void;
    npcRecords: NPC记录[];
    onNpcRecordsChange: React.Dispatch<React.SetStateAction<NPC记录[]>>;
    album: 相册系统;
    onAlbumChange: React.Dispatch<React.SetStateAction<相册系统>>;
    /** 视觉资产页需要整套状态：头像挂载要写活跃叶子。 */
    state: ReturnType<typeof useGame>['state'];
    onExportAlbum: () => void;
    onImportAlbum: (file: File | null, mode: AlbumImportMode) => void;
    albumOperationLabel: string;
    albumOperationBusy: boolean;
    phone: import('@/models/phone').手机系统;
    onPhoneChange: React.Dispatch<React.SetStateAction<import('@/models/phone').手机系统>>;
    memorySystem: 记忆系统;
    onMemorySystemChange: React.Dispatch<React.SetStateAction<记忆系统>>;
    onRetryMemoryDraft: (draftId: string) => Promise<void>;
    onIgnoreMemoryDraft: (draftId: string) => Promise<void>;
    yitingSystem: 忆庭系统;
    zhikuSystem: 智库系统;
    onZhikuSystemChange: React.Dispatch<React.SetStateAction<智库系统>>;
    zhikuSettings: import('@/models/settings').智库系统设置;
    onSaveZhikuSystem: (system: 智库系统) => Promise<void>;
    onZhikuMigration: (current: 智库系统) => Promise<智库系统>;
    memorySettings: import('@/models/settings').记忆系统设置;
    news: 新闻条目[];
    onNewsChange: React.Dispatch<React.SetStateAction<新闻条目[]>>;
    plotNodes: 剧情节点[];
    onPlotNodesChange: React.Dispatch<React.SetStateAction<剧情节点[]>>;
    storyWeaving: import('@/models/storyWeaving').剧情编织系统;
    onStoryWeavingChange: React.Dispatch<React.SetStateAction<import('@/models/storyWeaving').剧情编织系统>>;
    gameSettings: import('@/models/settings').游戏设置;
    onGameSettingsChange: React.Dispatch<React.SetStateAction<import('@/models/settings').游戏设置>>;
    onPersistGameSettings: (next: import('@/models/settings').游戏设置) => Promise<void>;
    apiSettings: import('@/models/settings').API设置;
    turnCount: number;
    mainChatHistory: import('@/models/chat').聊天消息[];
    fetchModels: AiToolsActions['fetchModels'];
    onSaveStoryWeaving: (system: 剧情编织系统) => Promise<void>;
    onGenerateSkillDraft: (apiConfig: import('@/models/settings').API配置项, context: 战技生成上下文) => Promise<战技生成草稿>;
    /** 打开设置并落在指定页签；用于面板里的引导入口。 */
    onOpenSettingsAt: (页签: SettingsTab) => void;
  },
) {
  switch (id) {
    case 'path':
      return (
        <PathPanel
          traveler={ctx.traveler}
          onTravelerChange={ctx.onTravelerChange}
          onAwakenedNewPath={ctx.onAwakenedNewPath}
        />
      );
      case 'skill':
        return <SkillPanel traveler={ctx.traveler} onTravelerChange={ctx.onTravelerChange} apiSettings={ctx.apiSettings} onGenerateSkillDraft={ctx.onGenerateSkillDraft} />;
    case 'inventory':
      return (
        <InventoryPanel
          traveler={ctx.traveler}
          onTravelerChange={ctx.onTravelerChange}
          turnCount={ctx.turnCount}
        />
      );
    case 'companion':
      return (
        <CompanionPanel
          npcRecords={ctx.npcRecords}
          onNpcRecordsChange={ctx.onNpcRecordsChange}
          album={ctx.album}
          turnCount={ctx.turnCount}
          nsfwEnabled={ctx.gameSettings.enableNsfw}
          maleNsfwArchiveEnabled={ctx.gameSettings.enableMaleNsfwArchive}
          zhikuSystem={ctx.zhikuSystem}
          devMode={ctx.gameSettings.devMode}
          state={ctx.state}
          onOpenImageGenSettings={() => ctx.onOpenSettingsAt('imageGen')}
        />
      );
    case 'album':
      return (
        <ImageWorkbenchPanel
          album={ctx.album}
          onAlbumChange={ctx.onAlbumChange}
          traveler={ctx.traveler}
          npcs={ctx.npcRecords}
          state={ctx.state}
          gameSettings={ctx.gameSettings}
          onOpenImageGenSettings={() => ctx.onOpenSettingsAt('imageGen')}
          onExportAlbum={ctx.onExportAlbum}
          onImportAlbum={ctx.onImportAlbum}
          albumOperationLabel={ctx.albumOperationLabel}
          albumOperationBusy={ctx.albumOperationBusy}
        />
      );
    case 'news':
      return (
        <NewsPanel
          news={ctx.news}
          onNewsChange={ctx.onNewsChange}
          turnCount={ctx.turnCount}
        />
      );
    case 'plot':
      return (
        <PlotPanel
          storyWeaving={ctx.storyWeaving}
          onStoryWeavingChange={ctx.onStoryWeavingChange}
          gameSettings={ctx.gameSettings}
          apiSettings={ctx.apiSettings}
          onSaveStoryWeaving={ctx.onSaveStoryWeaving}
        />
      );
    case 'yiting':
      return <YitingPanel yitingSystem={ctx.yitingSystem} />;
    case 'zhiku':
      return (
        <ZhikuSystemPanel
          zhikuSystem={ctx.zhikuSystem}
          storyWeavingSystem={ctx.storyWeaving}
          onZhikuSystemChange={ctx.onZhikuSystemChange}
          settings={ctx.zhikuSettings}
          onSaveZhikuSystem={ctx.onSaveZhikuSystem}
          onZhikuMigration={ctx.onZhikuMigration}
        />
      );
    case 'memory':
      return (
        <MemoryPanel
          memorySystem={ctx.memorySystem}
          onMemorySystemChange={ctx.onMemorySystemChange}
          turnCount={ctx.turnCount}
          settings={ctx.memorySettings}
          onRetryFailedDraft={ctx.onRetryMemoryDraft}
          onIgnoreFailedDraft={ctx.onIgnoreMemoryDraft}
        />
      );
    case 'worldbook':
    case null:
      return null;
  }
}
