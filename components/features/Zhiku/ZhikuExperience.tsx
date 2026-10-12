import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ChevronLeft, Minus, PenLine, Plus, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import type { ZhikuCatalogStatus, 智库系统 } from '@/models/zhiku';
import {
  buildZhikuArchiveView,
  isEmptyZhikuArchiveView,
  type ZhikuArchiveChapter,
  type ZhikuArchiveLoreCategoryId,
} from '@/services/zhikuArchive';
import { devLogError } from '@/utils/devLog';
import { CustomWorkspace } from './CustomWorkspace';
import { EntryList, IndexColumn, type CategoryRow, type LoreCategory } from './IndexColumn';
import { Overview } from './Overview';
import { ReaderPane } from './ReaderPane';
import { ChapterReader, getInitialChapter, VolumeList } from './StoryArchive';
import { Starfield } from './Starfield';
import { EmptyState } from './fields';
import { useZhikuReaderFontSize } from './readerFontSize';
import { useCompactSurface } from './useCompactSurface';
import './zhiku.css';

export type ZhikuSurface = 'home' | 'ingame';
export type ReaderRefreshStatus = 'idle' | 'loading' | 'done' | 'error';

type ZhikuView = 'archive' | 'custom';
type RailCategory = LoreCategory | 'all';

type StackLevel = 1 | 2 | 3;

const STACK_VARIANTS = {
  enter: (dir: number) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? '-100%' : '100%', opacity: 0 }),
};

/* 顶栏返回键：统一使用规范的 ChevronLeft 图标，比例匀称自然。 */
function BackGlyph() {
  return <ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" />;
}

export interface ZhikuExperienceProps {
  zhikuSystem: 智库系统;
  storyWeavingSystem: 剧情编织系统;
  onZhikuSystemChange: Dispatch<SetStateAction<智库系统>>;
  onSaveZhikuSystem: (system: 智库系统) => Promise<void>;
  onRefreshBundled?: (current: 智库系统) => Promise<智库系统>;
  onClose?: () => void;
  catalogStatus?: ZhikuCatalogStatus;
  surface?: ZhikuSurface;
}

export function ZhikuExperience({
  zhikuSystem,
  storyWeavingSystem,
  onZhikuSystemChange,
  onSaveZhikuSystem,
  onRefreshBundled,
  onClose,
  catalogStatus = 'ready',
  surface = 'ingame',
}: ZhikuExperienceProps) {
  const reduced = useReducedMotion();
  const compact = useCompactSurface();
  const [view, setView] = useState<ZhikuView>('archive');
  const [category, setCategory] = useState<RailCategory>('all');
  const [entryId, setEntryId] = useState('');
  const [chapterId, setChapterId] = useState('');
  /* 只用来定进退方向；层本身由 category / entryId / chapterId 推出来。 */
  const [stackDir, setStackDir] = useState<1 | -1>(1);
  const [refreshStatus, setRefreshStatus] = useState<ReaderRefreshStatus>('idle');
  const refreshTimerRef = useRef<number | null>(null);
  const { fontSize, decreaseFontSize, increaseFontSize } = useZhikuReaderFontSize();

  const archive = useMemo(
    () => buildZhikuArchiveView(zhikuSystem, storyWeavingSystem),
    [storyWeavingSystem, zhikuSystem],
  );

  const categories: CategoryRow[] = useMemo(
    () => archive.categories
      .filter((row) => row.id !== 'custom')
      .map((row) => ({
        id: row.id as LoreCategory,
        label: row.label,
        description: row.description,
        count: row.count,
        countLabel: row.id === 'story'
          ? `${row.count} 卷 / ${archive.chapterCount} 章`
          : `${row.count} 条`,
      })),
    [archive],
  );

  const isEmpty = isEmptyZhikuArchiveView(archive);
  const items = category === 'all' ? [] : (archive.itemsByCategory[category as ZhikuArchiveLoreCategoryId] ?? []);
  const activeItem = items.find((item) => item.id === entryId) ?? items.at(0);
  const categoryLabel = categories.find((row) => row.id === category)?.label ?? '';

  /* 剧情档案没有单独的总览：卷宗列表本身就在导轨里，右侧直接进阅读。 */
  const initialChapterId = useMemo(() => {
    const volume = archive.volumes.find((v) => !v.locked);
    return (volume && getInitialChapter(volume)?.id) || '';
  }, [archive.volumes]);

  const effectiveChapterId = chapterId || initialChapterId;

  const compactLevel: StackLevel = category === 'all'
    ? 1
    : category === 'story'
      ? (chapterId ? 3 : 2)
      : (entryId ? 3 : 2);

  const compactChapterTitle = useMemo(() => {
    const volume = archive.volumes.find((v) => v.chapters.some((c) => c.id === chapterId));
    const chapter = volume?.chapters.find((c) => c.id === chapterId);
    return chapter?.title ?? '剧情档案';
  }, [archive.volumes, chapterId]);

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();

      if (view !== 'archive') {
        setStackDir(-1);
        setView('archive');
        return;
      }

      if (compact) {
        if (category === 'all') {
          onClose?.();
          return;
        }
        setStackDir(-1);
        if (category === 'story' ? chapterId : entryId) {
          if (category === 'story') setChapterId('');
          else setEntryId('');
          return;
        }
        setCategory('all');
        setEntryId('');
        setChapterId('');
        return;
      }

      if (entryId) {
        setEntryId('');
        return;
      }
      if (chapterId) {
        setChapterId('');
        return;
      }
      onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [category, chapterId, compact, entryId, onClose, view]);

  const scheduleRefreshIdle = (delay: number) => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      setRefreshStatus('idle');
    }, delay);
  };

  const handleRefreshBundled = async () => {
    if (!onRefreshBundled || refreshStatus === 'loading') return;
    setRefreshStatus('loading');
    try {
      const next = await onRefreshBundled(zhikuSystem);
      onZhikuSystemChange(next);
      setRefreshStatus('done');
      scheduleRefreshIdle(2000);
    } catch (error) {
      devLogError('ui', 'zhiku-refresh-failed', error);
      setRefreshStatus('error');
      scheduleRefreshIdle(3200);
    }
  };

  const goAll = () => {
    setStackDir(-1);
    setCategory('all');
    setEntryId('');
    setChapterId('');
  };

  const handleSelectCategory = (id: LoreCategory) => {
    setStackDir(1);
    setCategory(id);
    setEntryId('');
    if (id !== 'story') setChapterId('');
  };

  const handleSelectEntry = (id: string) => {
    setStackDir(1);
    setEntryId(id);
  };

  const handleSelectChapter = (chapter: ZhikuArchiveChapter) => {
    setStackDir(1);
    setChapterId(chapter.id);
  };

  const goBackOneLevel = () => {
    if (view !== 'archive') {
      setStackDir(-1);
      setView('archive');
      return;
    }
    setStackDir(-1);
    if (category === 'story' ? chapterId : entryId) {
      if (category === 'story') setChapterId('');
      else setEntryId('');
      return;
    }
    setCategory('all');
    setEntryId('');
    setChapterId('');
  };

  const swap = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 300, damping: 30, mass: 0.6 };
  const railSwap = reduced
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.5 };
  /* 整屏横扫：两个房间同时位移，扫出与跳入是一次连贯敏捷的换场。 */
  const sweep = reduced
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 380, damping: 32, mass: 0.5 };

  const showWorkbench = !compact || view === 'custom' || compactLevel === 1;
  const showRefresh = !compact || view === 'custom' || compactLevel === 1;
  const showFontSize = !compact || view === 'custom' || compactLevel === 3;

  const crumb = view === 'custom'
    ? '自制工作台'
    : category === 'all'
      ? '智库'
      : category === 'story'
        ? compactChapterTitle
        : (compactLevel === 3 ? (activeItem?.title ?? categoryLabel) : categoryLabel);

  const backLabel = compactLevel === 3
    ? (category === 'story' ? '返回章节列表' : '返回条目列表')
    : '返回总览';

  const stackPaneProps = {
    className: 'zk-stack__pane',
    custom: stackDir,
    variants: STACK_VARIANTS,
    initial: 'enter',
    animate: 'center',
    exit: 'exit',
    transition: sweep,
  };

  const readerPane = category === 'story' ? (
    <ChapterReader
      volumes={archive.volumes}
      fontSize={fontSize}
      selectedChapterId={effectiveChapterId}
      onSelectChapter={handleSelectChapter}
      onBack={goAll}
    />
  ) : activeItem ? (
    <ReaderPane item={activeItem} categoryLabel={categoryLabel} fontSize={fontSize} onBack={goAll} />
  ) : (
    <section className="zk-reader" aria-live="polite">
      <EmptyState
        title="该分类暂无可见资料"
        hint="该分类的条目还没有在剧情里解锁；解锁后会出现在这里。"
      />
    </section>
  );

  const indexList = (activeChapterId: string, activeItemId: string, autoSelectOnOpen: boolean) =>
    category === 'story' ? (
      <VolumeList
        volumes={archive.volumes}
        activeChapterId={activeChapterId}
        onSelectChapter={handleSelectChapter}
        autoSelectOnOpen={autoSelectOnOpen}
      />
    ) : (
      <EntryList items={items} activeItemId={activeItemId} onSelectItem={handleSelectEntry} />
    );

  return (
    <div
      className="zk-root"
      data-surface={surface}
      data-catalog-status={catalogStatus}
      data-archive-state={isEmpty ? 'empty' : 'ready'}
      data-compact={compact ? 'true' : 'false'}
    >
      <Starfield />

      <header className="zk-top">
        <div className="zk-top__id">
          {/* 工作台是模式切换，不是层级返回，所以只有它有返回键；总览靠导轨里那块展开的格子收回。 */}
          {view === 'custom' ? (
            <button
              type="button"
              className="zk-btn zk-btn--back"
              onClick={() => {
                setStackDir(-1);
                setView('archive');
              }}
              aria-label="返回档案"
              title="返回档案"
            >
              <ArrowLeft size={15} strokeWidth={2.2} aria-hidden="true" />
              返回档案
            </button>
          ) : compact && compactLevel > 1 ? (
            <button
              type="button"
              className="zk-navback"
              onClick={goBackOneLevel}
              aria-label={backLabel}
              title={backLabel}
            >
              <BackGlyph />
            </button>
          ) : null}

          <span className="zk-brand">ZHIKU</span>

          {compact ? (
            <span className="zk-top__crumb" data-crumb={category === 'all' ? 'root' : 'deep'}>{crumb}</span>
          ) : (
            <span className="zk-top__total">
              {archive.itemCount} 条 · {archive.volumes.length} 卷 · {archive.chapterCount} 章
            </span>
          )}
        </div>

        <div className="zk-top__actions">
          {showWorkbench && (
            <button
              type="button"
              className="zk-btn"
              data-active={view === 'custom' ? 'true' : 'false'}
              aria-pressed={view === 'custom'}
              aria-label="切换自制工作台"
              title="自制条目的新建与编辑"
              onClick={() => setView(view === 'custom' ? 'archive' : 'custom')}
            >
              <PenLine size={12} strokeWidth={1.7} aria-hidden="true" />
              工作台
            </button>
          )}

          {showFontSize && (
            <>
              <button type="button" className="zk-btn zk-iconbtn" aria-label="减小档案字号" title="减小档案字号" onClick={decreaseFontSize}>
                <Minus size={12} strokeWidth={2} aria-hidden="true" />
              </button>
              <output className="zk-top__total" aria-live="polite" style={{ minWidth: 20, textAlign: 'center' }}>
                {fontSize}
              </output>
              <button type="button" className="zk-btn zk-iconbtn" aria-label="增大档案字号" title="增大档案字号" onClick={increaseFontSize}>
                <Plus size={12} strokeWidth={2} aria-hidden="true" />
              </button>
            </>
          )}

          {showRefresh && onRefreshBundled && (
            <button
              type="button"
              className="zk-btn zk-iconbtn"
              data-refresh-status={refreshStatus}
              aria-label="重载内置档案"
              title="重载内置档案"
              disabled={refreshStatus === 'loading'}
              onClick={() => void handleRefreshBundled()}
            >
              <motion.span
                aria-hidden="true"
                style={{ display: 'inline-flex' }}
                animate={refreshStatus === 'loading' && !reduced ? { rotate: 360 } : { rotate: 0 }}
                transition={refreshStatus === 'loading' && !reduced
                  ? { repeat: Infinity, duration: 1.1, ease: 'linear' }
                  : swap}
              >
                <RefreshCw size={12} strokeWidth={1.8} />
              </motion.span>
            </button>
          )}

          {onClose && (
            <button type="button" className="zk-btn zk-iconbtn" onClick={onClose} aria-label="关闭智库" title="关闭智库">
              <X size={13} strokeWidth={1.7} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      <div className="zk-stage">
        <AnimatePresence initial={false}>
          {view === 'custom' ? (
            /* 编辑面板从右侧跳入，档案室整体向左扫出；关闭时原路退回。 */
            <motion.div
              key="custom"
              className="zk-room"
              data-view="custom"
              initial={reduced ? { x: 0 } : { x: '100%' }}
              animate={{ x: 0 }}
              exit={reduced ? { x: 0 } : { x: '100%' }}
              transition={sweep}
            >
              <CustomWorkspace
                zhikuSystem={zhikuSystem}
                onZhikuSystemChange={onZhikuSystemChange}
                onSaveZhikuSystem={onSaveZhikuSystem}
                compact={compact}
              />
            </motion.div>
          ) : (
            <motion.div
              key="archive"
              className="zk-room"
              data-solo={compact || category === 'all' ? 'true' : 'false'}
              initial={reduced ? { x: 0 } : { x: '-100%' }}
              animate={{ x: 0 }}
              exit={reduced ? { x: 0 } : { x: '-100%' }}
              transition={sweep}
            >
              {isEmpty ? (
                <section className="zk-reader" role="region" aria-label="智库分类大厅">
                  <EmptyState
                    title="档案尚未收录"
                    hint="内置资料还没载入，或当前存档还没有可归档的剧情章节。可尝试顶栏的重载按钮。"
                  />
                </section>
              ) : compact ? (
                /* 手机：把「索引 + 阅读面」拉成一条纵向的路。
                   每一层占满整屏、只做一件事，来的时候从右边推进，回的时候原路退回。 */
                <div className="zk-stack">
                  <AnimatePresence initial={false} custom={stackDir}>
                    {compactLevel === 1 && (
                      <motion.div key="stack-overview" {...stackPaneProps} data-stack-level="1">
                        <Overview
                          categories={categories}
                          itemsByCategory={archive.itemsByCategory}
                          volumes={archive.volumes}
                          onSelectCategory={handleSelectCategory}
                        />
                      </motion.div>
                    )}

                    {compactLevel === 2 && (
                      <motion.div key="stack-list" {...stackPaneProps} data-stack-level="2" className="zk-stack__pane zk-stack__pane--panel">
                        <div className="zk-listpane">{indexList(chapterId, entryId, false)}</div>
                      </motion.div>
                    )}

                    {compactLevel === 3 && (
                      <motion.div key="stack-reader" {...stackPaneProps} data-stack-level="3" className="zk-stack__pane zk-stack__pane--panel">
                        {readerPane}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : category === 'all' ? (
                /* 宽屏的第一眼也是总览：整屏便当盒，没有左右分栏。 */
                <Overview
                  categories={categories}
                  itemsByCategory={archive.itemsByCategory}
                  volumes={archive.volumes}
                  onSelectCategory={handleSelectCategory}
                />
              ) : (
                <>
                  <IndexColumn
                    categories={categories}
                    activeCategory={category}
                    onSelectCategory={handleSelectCategory}
                    onSelectAll={goAll}
                    itemCount={archive.itemCount}
                    chapterCount={archive.chapterCount}
                  >
                    {/* 整表替换只做一次容器位移，不做逐行动画。 */}
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={`rail-${category}`}
                        className="zk-railbody"
                        initial={reduced ? false : { opacity: 0, x: -14 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={reduced ? undefined : { opacity: 0, x: 14 }}
                        transition={railSwap}
                      >
                        {indexList(effectiveChapterId, activeItem?.id ?? '', true)}
                      </motion.div>
                    </AnimatePresence>
                  </IndexColumn>

                  {readerPane}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
