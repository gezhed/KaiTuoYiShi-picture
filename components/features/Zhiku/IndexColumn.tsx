import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { ZhikuArchiveCategoryId, ZhikuArchiveItem } from '@/services/zhikuArchive';
import { Avatar } from './Avatar';
import { EmptyState } from './fields';

/** 档案面陈列的分类：除「自制」外的全部。注意它不是 services 的 ZhikuArchiveLoreCategoryId——那个还排除了 story。 */
export type LoreCategory = Exclude<ZhikuArchiveCategoryId, 'custom'>;

export interface CategoryRow {
  id: LoreCategory;
  label: string;
  description: string;
  count: number;
  countLabel: string;
}

/** 总览与缩小的总览共用同一套排序：大格子和小格子的位置一一对应，读的人才能认出自己在哪一格。 */
export function rankCategories(categories: CategoryRow[]): CategoryRow[] {
  return [...categories].sort((a, b) => b.count - a.count);
}

/** 读数是个会滚的仪表：值变化时弹到位，而不是瞬切。初值即终值，首帧就是正确数字。 */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const spring = useSpring(value, { stiffness: 110, damping: 18, mass: 0.7 });
  const rounded = useTransform(spring, (v) => Math.round(v));
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  if (reduced) return <span className={className}>{value}</span>;
  return <motion.span className={className}>{rounded}</motion.span>;
}

const SOFT_SPRING = { type: 'spring' as const, stiffness: 210, damping: 26 };

interface IndexColumnProps {
  categories: CategoryRow[];
  activeCategory: LoreCategory | 'all';
  onSelectCategory: (id: LoreCategory) => void;
  onSelectAll: () => void;
  itemCount: number;
  chapterCount: number;
  children: ReactNode;
}

export function IndexColumn({
  categories,
  activeCategory,
  onSelectCategory,
  onSelectAll,
  itemCount,
  chapterCount,
  children,
}: IndexColumnProps) {
  const reduced = useReducedMotion();
  const active = categories.find((category) => category.id === activeCategory);
  const share = active ? active.count / Math.max(1, itemCount + chapterCount) : 1;
  const ranked = rankCategories(categories);
  const soft = reduced ? { duration: 0 } : SOFT_SPRING;

  return (
    <aside className="zk-index" aria-label="智库分类索引">
      <div className="zk-gauge">
        <button
          type="button"
          className="zk-gauge__back"
          onClick={onSelectAll}
          aria-label="返回总览"
          title="返回总览"
        >
          <ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <div className="zk-gauge__body">
          <span className="zk-gauge__label">{active ? active.label : '全部资料'}</span>
          <RollingNumber className="zk-gauge__value" value={active?.count ?? itemCount} />
          <span className="zk-gauge__denom">
            / {itemCount} 条{chapterCount > 0 ? ` · ${chapterCount} 章` : ''}
          </span>
          <span className="zk-bar">
            <motion.i
              className="zk-bar__fill"
              initial={false}
              animate={{ scaleX: Math.max(share, 0.004) }}
              transition={soft}
            />
          </span>
        </div>
      </div>

      {/* 缩小的总览常驻：无论读到多深，都能看见自己在整座档案库的哪一格。 */}
      <nav className="zk-mini" aria-label="智库分类">
            {ranked.map((category) => {
              const isActive = category.id === activeCategory;
              return (
                <button
                  key={category.id}
                  type="button"
                  className="zk-mini__cell"
                  data-active={isActive ? 'true' : 'false'}
                  aria-pressed={isActive}
                  /* 当前分类再点一次就收回总览——返回不需要额外按钮，它就是「把展开的合上」。 */
                  aria-label={isActive ? `收起${category.label}，返回总览` : `展开${category.label}，${category.countLabel}`}
                  title={isActive ? '再次点击收起，返回总览' : category.label}
                  onClick={() => (isActive ? onSelectAll() : onSelectCategory(category.id))}
                >
                  <span className="zk-mini__name">{category.label}</span>
                  <RollingNumber className="zk-mini__n" value={category.count} />
                </button>
              );
            })}
      </nav>

      {children}
    </aside>
  );
}

const formatSequence = (index: number): string => String(index + 1).padStart(2, '0');

interface EntryListProps {
  items: ZhikuArchiveItem[];
  activeItemId: string;
  onSelectItem: (id: string) => void;
}

export function EntryList({ items, activeItemId, onSelectItem }: EntryListProps) {
  if (items.length === 0) {
    return (
      <div className="zk-entries zk-scroll">
        <EmptyState title="暂无档案" hint="当前分类还没有玩家可见资料。" />
      </div>
    );
  }

  /* 行本身不做动画：整表替换时让 99 行各自淡入位移既吵又贵。
     换分类的动效交给外层容器一次性完成。 */
  return (
    <div className="zk-entries zk-scroll" role="list">
      {items.map((item, index) => {
        const isActive = item.id === activeItemId;
        return (
          <button
            key={item.id}
            type="button"
            role="listitem"
            className="zk-entry"
            data-active={isActive ? 'true' : 'false'}
            aria-pressed={isActive}
            aria-label={`阅读${item.title}`}
            onClick={() => onSelectItem(item.id)}
          >
            {item.avatarSrc ? (
              <Avatar
                className="zk-entry__ava"
                src={item.avatarSrc}
                alt={item.avatarAlt ?? `${item.title}头像`}
                fallback={item.title.slice(0, 1)}
              />
            ) : (
              <span className="zk-entry__seq">{formatSequence(index)}</span>
            )}
            <span className="zk-entry__copy">
              <span className="zk-entry__title">{item.title}</span>
              <span className="zk-entry__meta">{item.subtitle ?? item.meta ?? ''}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
