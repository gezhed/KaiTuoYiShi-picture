import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ZhikuArchiveItem } from '@/services/zhikuArchive';
import { Prose } from './Prose';
import { StaggerTitle } from './StaggerTitle';
import { Avatar } from './Avatar';
import { EmptyState } from './fields';

type ReadingPane = 'archive' | 'injection';

interface ReaderPaneProps {
  item?: ZhikuArchiveItem;
  categoryLabel: string;
  fontSize: number;
  onBack: () => void;
  /** 关键词超过这个数量时收进一个可滚动区，避免把注入内容顶出屏幕。 */
  keywordScrollThreshold?: number;
}

export function ReaderPane({ item, categoryLabel, fontSize, onBack, keywordScrollThreshold = 40 }: ReaderPaneProps) {
  const [pane, setPane] = useState<ReadingPane>('archive');
  const [variantId, setVariantId] = useState('');
  const reduced = useReducedMotion();

  /* 不用 useMemo：`?? []` 每次都给出新数组，包起来也只是每次重算。 */
  const variants = item?.variants ?? [];
  const variant = variants.find((candidate) => candidate.id === variantId) ?? variants.at(0);
  const keywords = variant?.keywords ?? item?.keywords ?? [];
  const injection = (variant?.injectionPreview ?? item?.injectionPreview ?? '').trim();
  const body = variant?.body || item?.body || '';

  const spring = { type: 'spring' as const, stiffness: 380, damping: 34 };

  if (!item) {
    return (
      <section className="zk-reader" aria-live="polite">
        <EmptyState
          title="左侧选一条资料"
          hint="从未亮起的条目会在剧情里解锁；解锁后它们会以同样的形式出现在这里。"
        />
      </section>
    );
  }

  return (
    <LayoutGroup id="zk-reader">
      <section className="zk-reader" aria-live="polite">
        <header className="zk-reader__head">
          {/* 面包屑：总览是可点的，返回不需要靠猜。 */}
          <nav className="zk-crumb" aria-label="位置">
            <button type="button" className="zk-crumb__link" onClick={onBack}>总览</button>
            <ChevronRight size={11} strokeWidth={1.8} aria-hidden="true" className="zk-crumb__sep" />
            <span className="zk-crumb__here">{categoryLabel}</span>
          </nav>

          <div className="zk-reader__titlerow">
            {/* 没有头像就不画这个盒子。为不存在的图留一个占位再让它淡下去，
                只是多了一层要维护的动画，并没有多出任何信息。 */}
            {item.avatarSrc && (
              <Avatar
                key={item.id}
                className="zk-reader__ava"
                src={item.avatarSrc}
                alt={item.avatarAlt ?? `${item.title}头像`}
              />
            )}
            <div style={{ minWidth: 0 }}>
              {/* key 让换条目时逐字动画重放；不用共享元素，layout 缩放会把中文字形糊掉。 */}
              <StaggerTitle key={item.id} text={item.title} className="zk-reader__title" />
              <div className="zk-reader__meta">
                <span>{item.builtin ? '内置资料' : '自制资料'}</span>
                {item.meta && <span>{item.meta}</span>}
                <span>{keywords.length} 个关键词</span>
                {variants.length > 1 && <span>{variants.length} 个形态</span>}
              </div>
            </div>
          </div>

          <div className="zk-tabs" role="tablist" aria-label="档案内容视图">
            {(['archive', 'injection'] as const).map((key) => {
              const selected = pane === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  className="zk-tab"
                  aria-selected={selected}
                  onClick={() => setPane(key)}
                >
                  {key === 'archive' ? '档案预览' : '注入内容'}
                  {selected && <motion.span layoutId="zk-tab-rule" className="zk-tab__rule" transition={spring} />}
                </button>
              );
            })}
          </div>
        </header>

        {/* 形态条会在版面上占一行高度。若只淡入淡出，正文会被瞬间顶下去 43px——
            这里连高度一起动，空间变化是滑出来的，不是跳出来的。 */}
        <AnimatePresence initial={false}>
          {variants.length > 1 && (
            <motion.div
              key="variants"
              initial={reduced ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={reduced ? undefined : { height: 0, opacity: 0 }}
              transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 32 }}
              style={{ overflow: 'hidden', flex: 'none' }}
            >
              <div className="zk-variants" role="tablist" aria-label="选择档案形态">
                {variants.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    role="tab"
                    className="zk-variant"
                    aria-selected={candidate.id === variant?.id}
                    onClick={() => setVariantId(candidate.id)}
                  >
                    {candidate.label}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="zk-reader__body zk-scroll" style={{ fontSize: `${fontSize}px` }}>
          <div className="zk-swap">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={`${pane}:${variant?.id ?? ''}`}
              className="zk-swap__pane"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduced ? undefined : { opacity: 0 }}
              transition={reduced ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' }}
            >
              {pane === 'archive' ? (
                <Prose source={body} />
              ) : (
                <>
                  {keywords.length > 0 && (
                    <div
                      className="zk-keywords"
                      data-many={keywords.length > keywordScrollThreshold ? 'true' : 'false'}
                    >
                      {keywords.map((keyword, index) => (
                        <span key={`${keyword}-${index}`} className="zk-keyword">{keyword}</span>
                      ))}
                    </div>
                  )}
                  {injection ? (
                    <pre className="zk-injection zk-scroll">{injection}</pre>
                  ) : (
                    <p className="zk-note">暂无可注入内容：该条目还没有结构化注入，因此不会参与召回。</p>
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>
          </div>
        </div>
      </section>
    </LayoutGroup>
  );
}
