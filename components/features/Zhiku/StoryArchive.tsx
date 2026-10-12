import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, FileText, Lock } from 'lucide-react';
import type { ZhikuArchiveChapter, ZhikuArchiveChapterStatus, ZhikuArchiveVolume } from '@/services/zhikuArchive';
import { Prose } from './Prose';
import { StaggerTitle } from './StaggerTitle';
import { EmptyState } from './fields';

const CHAPTER_STATUS: Record<ZhikuArchiveChapterStatus, { label: string; glyph: string }> = {
  read: { label: '已阅', glyph: '●' },
  current: { label: '阅读中', glyph: '◉' },
  unread: { label: '未读', glyph: '○' },
  locked: { label: '未解锁', glyph: '·' },
};

const CHAPTER_ORDINAL = /^第\s*[0-9０-９一二三四五六七八九十百零两]+\s*[章节回]/u;

export function formatChapterTitle(chapter: ZhikuArchiveChapter): string {
  return CHAPTER_ORDINAL.test(chapter.title.trim())
    ? chapter.title
    : `${chapter.number} ${chapter.title}`;
}

/** 一卷默认落到哪一章：优先「阅读中」，其次第一个已解锁的。总览入口与卷宗展开共用这一条。 */
export function getInitialChapter(volume: ZhikuArchiveVolume): ZhikuArchiveChapter | undefined {
  return volume.chapters.find((chapter) => chapter.status === 'current')
    ?? volume.chapters.find((chapter) => chapter.status !== 'locked');
}

function getAvailableSibling(
  chapters: ZhikuArchiveChapter[],
  currentIndex: number,
  direction: -1 | 1,
): ZhikuArchiveChapter | undefined {
  for (let index = currentIndex + direction; index >= 0 && index < chapters.length; index += direction) {
    if (chapters[index].status !== 'locked') return chapters[index];
  }
  return undefined;
}

/** 卷宗列表：展开是真正的容器收放（高度动画），不是条件渲染出来的瞬切。 */
export function VolumeList({
  volumes,
  activeChapterId,
  onSelectChapter,
  autoSelectOnOpen = true,
}: {
  volumes: ZhikuArchiveVolume[];
  activeChapterId: string;
  onSelectChapter: (chapter: ZhikuArchiveChapter) => void;
  autoSelectOnOpen?: boolean;
}) {
  const reduced = useReducedMotion();
  const [openId, setOpenId] = useState('');

  if (volumes.length === 0) {
    return (
      <div className="zk-entries zk-scroll">
        <EmptyState title="暂无卷宗" hint="剧情尚未归档：读过或正在读的章节会在这里逐卷出现。" />
      </div>
    );
  }

  const spring = { type: 'spring' as const, stiffness: 320, damping: 32 };

  return (
    <div className="zk-entries zk-scroll" aria-label="剧情卷宗与章节目录">
      <div className="zk-volumes">
        {volumes.map((volume) => {
          const locked = Boolean(volume.locked);
          const open = openId === volume.id;
          const readCount = volume.chapters.filter((c) => c.status === 'read' || c.status === 'current').length;
          const progress = volume.chapters.length ? readCount / volume.chapters.length : 0;
          return (
            <section key={volume.id} className="zk-volume">
              <button
                type="button"
                className="zk-volume__head"
                disabled={locked}
                aria-expanded={open}
                aria-label={locked ? `${volume.title}，尚未解锁` : `打开卷宗：${volume.title}`}
                onClick={() => {
                  const opening = !open;
                  setOpenId(opening ? volume.id : '');
                  if (!opening || !autoSelectOnOpen) return;
                  const next = getInitialChapter(volume);
                  if (next) onSelectChapter(next);
                }}
              >
                <span style={{ color: open ? 'rgb(var(--zk-gold))' : 'rgb(var(--zk-faint))', flex: 'none' }}>
                  {locked ? <Lock size={13} strokeWidth={1.6} aria-hidden="true" /> : <FileText size={13} strokeWidth={1.6} aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="zk-volume__title">{locked ? '未解锁卷宗' : volume.title}</span>
                  <span className="zk-volume__sub">
                    {locked ? '档案尚未开放' : `${volume.chapters.length} 章 · ${Math.round(progress * 100)}%`}
                  </span>
                  <span className="zk-cat__bar" style={{ marginTop: 6 }}>
                    <motion.i
                      initial={false}
                      animate={{ scaleX: Math.max(progress, 0.004) }}
                      transition={reduced ? { duration: 0 } : spring}
                    />
                  </span>
                </span>
                {!locked && (
                  <motion.span
                    aria-hidden="true"
                    animate={{ rotate: open ? 180 : 0 }}
                    transition={reduced ? { duration: 0 } : spring}
                    style={{ color: 'rgb(var(--zk-faint))', flex: 'none', display: 'inline-flex' }}
                  >
                    <ChevronDown size={13} strokeWidth={1.6} />
                  </motion.span>
                )}
              </button>

              <AnimatePresence initial={false}>
                {open && !locked && (
                  <motion.div
                    key="chapters"
                    initial={reduced ? false : { height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={reduced ? undefined : { height: 0, opacity: 0 }}
                    transition={reduced ? { duration: 0 } : spring}
                    style={{ overflow: 'hidden' }}
                  >
                    <ol className="zk-chapters" aria-label={`${volume.title}章节`}>
                      {volume.chapters.map((chapter) => {
                        const status = CHAPTER_STATUS[chapter.status];
                        const active = chapter.id === activeChapterId;
                        const chapterLocked = chapter.status === 'locked';
                        return (
                          <li key={chapter.id}>
                            <button
                              type="button"
                              className="zk-chapter"
                              data-status={chapter.status}
                              data-active={active ? 'true' : 'false'}
                              disabled={chapterLocked}
                              aria-pressed={active}
                              aria-label={chapterLocked ? `${chapter.number}，尚未解锁` : `阅读${chapter.number}：${chapter.title}`}
                              onClick={() => onSelectChapter(chapter)}
                            >
                              <span className="zk-chapter__mark" aria-hidden="true">{status.glyph}</span>
                              <span className="zk-chapter__title">
                                {chapterLocked ? '未解锁章节' : formatChapterTitle(chapter)}
                              </span>
                              <span className="zk-chapter__mark">{status.label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function ChapterReader({
  volumes,
  fontSize,
  selectedChapterId,
  onSelectChapter,
  onBack,
}: {
  volumes: ZhikuArchiveVolume[];
  fontSize: number;
  selectedChapterId: string;
  onSelectChapter: (chapter: ZhikuArchiveChapter) => void;
  onBack: () => void;
}) {
  const reduced = useReducedMotion();
  const selectedVolume = volumes.find((volume) => volume.chapters.some((c) => c.id === selectedChapterId))
    ?? volumes.find((volume) => !volume.locked && getInitialChapter(volume))
    ?? volumes[0];
  const selectedChapter = selectedVolume?.chapters.find((c) => c.id === selectedChapterId && c.status !== 'locked')
    ?? (selectedVolume ? getInitialChapter(selectedVolume) : undefined);
  const index = selectedChapter && selectedVolume
    ? selectedVolume.chapters.findIndex((c) => c.id === selectedChapter.id)
    : -1;
  const previous = selectedVolume ? getAvailableSibling(selectedVolume.chapters, index, -1) : undefined;
  const next = selectedVolume ? getAvailableSibling(selectedVolume.chapters, index, 1) : undefined;
  const hasChapters = volumes.some((volume) => volume.chapters.length > 0);

  if (!hasChapters) {
    return (
      <section className="zk-reader" aria-live="polite" data-archive-state="empty">
        <EmptyState
          title="剧情还没有归档"
          hint="随剧情推进，读过与正在读的章节会逐卷收进这里。现在还没有可读的卷宗。"
        />
      </section>
    );
  }

  if (!selectedChapter || !selectedVolume) {
    return (
      <section className="zk-reader" aria-live="polite">
        <EmptyState title="暂无可阅读章节" hint="从左侧展开一卷，选择要读的章节。" />
      </section>
    );
  }

  return (
    <section className="zk-reader" aria-live="polite">
      <header className="zk-reader__head">
        <nav className="zk-crumb" aria-label="位置">
          <button type="button" className="zk-crumb__link" onClick={onBack}>总览</button>
          <ChevronRight size={11} strokeWidth={1.8} aria-hidden="true" className="zk-crumb__sep" />
          <span className="zk-crumb__here">剧情档案</span>
        </nav>
        <div className="zk-reader__kicker">STORY // {selectedVolume.number}</div>
        <div className="zk-reader__titlerow">
          <StaggerTitle key={selectedVolume.id} text={selectedVolume.title} className="zk-reader__title" />
        </div>
        <div className="zk-reader__meta">
          <span>{selectedChapter.number}</span>
          {selectedChapter.category && <span>{selectedChapter.category}</span>}
          {selectedChapter.location && <span>地点 {selectedChapter.location}</span>}
          {selectedChapter.timeLabel && <span>时间 {selectedChapter.timeLabel}</span>}
        </div>
      </header>

      <div className="zk-reader__body zk-scroll" style={{ fontSize: `${fontSize}px` }}>
        <div className="zk-swap">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={selectedChapter.id}
            className="zk-swap__pane"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduced ? undefined : { opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' }}
          >
            <Prose
              source={selectedChapter.body}
              footer={
                <nav className="zk-nav" aria-label="章节切换">
                  <button
                    type="button"
                    disabled={!previous}
                    onClick={() => previous && onSelectChapter(previous)}
                    aria-label={previous ? `上一章：${previous.title}` : '已经是第一章'}
                  >
                    <ChevronLeft size={15} strokeWidth={1.6} aria-hidden="true" />
                    <span className="min-w-0">
                      <small>上一章</small>
                      <strong>{previous?.title ?? '故事起点'}</strong>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={!next}
                    onClick={() => next && onSelectChapter(next)}
                    aria-label={next ? `下一章：${next.title}` : '已经是最后一章'}
                  >
                    <span className="min-w-0">
                      <small>下一章</small>
                      <strong>{next?.title ?? '未完待续'}</strong>
                    </span>
                    <ChevronRight size={15} strokeWidth={1.6} aria-hidden="true" />
                  </button>
                </nav>
              }
            />
          </motion.div>
        </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
