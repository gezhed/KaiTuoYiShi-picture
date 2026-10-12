import { motion, useReducedMotion } from 'motion/react';
import { ZHIKU_BUNDLED_ENTRY_COUNT } from '@/data/zhikuPreset';
import type { ZhikuArchiveItem, ZhikuArchiveVolume } from '@/services/zhikuArchive';
import { Avatar } from './Avatar';
import { rankCategories, RollingNumber, type CategoryRow, type LoreCategory } from './IndexColumn';
import { StaggerTitle } from './StaggerTitle';

const AVATAR_CAP = 18;
const NAME_CAP = 8;

interface OverviewProps {
  categories: CategoryRow[];
  itemsByCategory: Record<string, ZhikuArchiveItem[]>;
  volumes: ZhikuArchiveVolume[];
  onSelectCategory: (id: LoreCategory) => void;
}

/** 智库总览：纯 CSS 栅格仪板，杜绝 JS 动态测算导致的宽高比坍塌与重叠穿透。 */
export function Overview({ categories, itemsByCategory, volumes, onSelectCategory }: OverviewProps) {
  const reduced = useReducedMotion();

  const ranked = rankCategories(categories);
  /* 收录进度只算条目：卷宗是章节，不混进条目分母。 */
  const loreTotal = categories.reduce((sum, row) => sum + (row.id === 'story' ? 0 : row.count), 0);

  const hover = reduced
    ? undefined
    : { scale: 1.018, y: -2, transition: { type: 'spring' as const, stiffness: 420, damping: 24 } };
  const tap = reduced ? undefined : { scale: 0.985 };

  return (
    <div className="zk-overview">
      <header className="zk-overview__head">
        <div className="zk-overview__title-wrap">
          <StaggerTitle as="h1" text="智库" className="zk-overview__title" />
          <span className="zk-overview__subtitle">ARCHIVE DATABASE</span>
        </div>
        <p className="zk-overview__stat">
          已收录 {loreTotal} / {ZHIKU_BUNDLED_ENTRY_COUNT}
          {volumes.length > 0 ? ` · ${volumes.length} 卷剧情` : ''}
        </p>
      </header>

      <div className="zk-bento">
        {ranked.map((row, rank) => {
          const isCharacter = row.id === 'character';
          const cap = isCharacter ? AVATAR_CAP : NAME_CAP;

          const previews = row.id === 'story'
            ? volumes.slice(0, cap).map((volume) => ({
                id: volume.id,
                title: volume.locked ? `卷 ${volume.number}` : volume.title,
                sealed: Boolean(volume.locked),
                avatarSrc: undefined as string | undefined,
                avatarAlt: undefined as string | undefined,
              }))
            : (itemsByCategory[row.id] ?? []).slice(0, cap).map((item) => ({
                id: item.id,
                title: item.title,
                sealed: false,
                avatarSrc: item.avatarSrc,
                avatarAlt: item.avatarAlt,
              }));

          return (
            <motion.button
              key={row.id}
              type="button"
              whileHover={hover}
              whileTap={tap}
              className="zk-cell"
              data-rank={rank}
              aria-label={`展开${row.label}，${row.countLabel}`}
              onClick={() => onSelectCategory(row.id)}
            >
              <span className="zk-cell__top">
                <span className="zk-cell__label">{row.label}</span>
                <RollingNumber className="zk-cell__n" value={row.count} />
              </span>

              <span className="zk-cell__preview">
                {isCharacter && previews.length > 0
                  ? previews.map((item) => (
                    <Avatar
                      key={item.id}
                      className="zk-cell__ava"
                      src={item.avatarSrc}
                      alt={item.avatarAlt ?? `${item.title}头像`}
                      fallback={item.title.slice(0, 1)}
                    />
                  ))
                  : previews.map((item) => (
                    <span key={item.id} className="zk-cell__name" data-sealed={item.sealed ? 'true' : 'false'}>
                      {item.title}
                    </span>
                  ))}
              </span>

              {row.id === 'story' && (
                <span className="zk-cell__foot">
                  <span className="zk-cell__unit">{row.countLabel}</span>
                  <span className="zk-cell__go">查看卷宗 →</span>
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
