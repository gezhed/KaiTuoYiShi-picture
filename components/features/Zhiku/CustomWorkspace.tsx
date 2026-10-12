import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ArrowLeft, Copy, Plus, Trash2 } from 'lucide-react';
import type { 智库系统, 智库分类, 智库条目 } from '@/models/zhiku';
import {
  ZHIKU_CATEGORY_LABELS,
  创建智库条目,
  创建空智库注入内容,
  归一化智库系统,
  搜索智库条目,
  智库分类计数,
  获取智库注入内容缺失字段,
  智库条目注入内容完整,
} from '@/models/zhiku';
import { isZhikuArchiveEntryVisible } from '@/services/zhikuArchive';
import { SectionLabel, ToggleRow, EmptyState, Field, PerformanceTextarea } from './fields';
import { StructuredCharacterFields } from './structuredFields';
import { InjectionContentFields } from './injectionContent';
import { ZHIKU_CREATE_CATEGORIES, zhikuUnlockStatuses } from './constants';
import { 创建空草稿, type Draft } from './draft';
import { useCompactSurface } from './useCompactSurface';

interface CustomWorkspaceProps {
  zhikuSystem: 智库系统;
  onZhikuSystemChange: Dispatch<SetStateAction<智库系统>>;
  onSaveZhikuSystem: (system: 智库系统) => Promise<void>;
  compact?: boolean;
}

type Bucket = 'custom' | 'builtin';
type WorkspaceMode = 'entry' | 'draft';

/**
 * 自制条目的编辑区。整个面板只读一个 entry——调用方已经把「缓冲条目优先，否则用选中条目」
 * 合并好了，这里不再逐字段二次兜底，也就不会有半个面板读缓冲、半个面板读存档的错版。
 */
function CustomEntryEditor({
  entry,
  onUpdate,
}: {
  entry: 智库条目;
  onUpdate: (patch: Partial<智库条目>) => void;
}) {
  return (
    <>
      {entry.分类 === 'character' ? (
        <StructuredCharacterFields entry={entry} editable onUpdate={onUpdate} />
      ) : (
        <section className="zk-section">
          <SectionLabel>资料字段</SectionLabel>
          <div className="zk-grid">
            <Field label="分类">
              <select
                value={entry.分类}
                onChange={(e) => onUpdate({ 分类: e.target.value as 智库分类 })}
                className="zk-input"
              >
                {ZHIKU_CREATE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {ZHIKU_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="重要度">
              <input
                type="number"
                min={1}
                max={5}
                value={entry.重要度}
                onChange={(e) => onUpdate({ 重要度: Number(e.target.value) || 3 })}
                className="zk-input"
              />
            </Field>
            <Field label="来源">
              <input
                value={entry.来源 ?? ''}
                onChange={(e) => onUpdate({ 来源: e.target.value })}
                className="zk-input"
              />
            </Field>
            <Field label="关键词">
              <input
                value={entry.关键词.join('、')}
                onChange={(e) =>
                  onUpdate({
                    关键词: e.target.value
                      .split(/[,，、\n]/)
                      .map((k) => k.trim())
                      .filter(Boolean),
                  })
                }
                className="zk-input"
              />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <ToggleRow
              label="允许剧情 / 周报联动检索"
              checked={entry.可用于联动}
              onChange={(checked) => onUpdate({ 可用于联动: checked })}
            />
          </div>
        </section>
      )}

      {entry.分类 !== 'story' && (
        <>
          {!智库条目注入内容完整(entry) && (
            <div className="zk-alert" data-kind="warn" role="status" style={{ marginTop: 20 }}>
              注入内容不完整，该条目不会参与主剧情召回；补齐后立即生效。
            </div>
          )}
          <InjectionContentFields
            category={entry.分类}
            value={entry.注入内容}
            editable
            onChange={(注入内容) => onUpdate({ 注入内容 })}
          />
        </>
      )}

      <section className="zk-section" style={{ paddingBottom: 40 }}>
        <SectionLabel>档案正文</SectionLabel>
        <div className="zk-grid">
          <PerformanceTextarea
            label="摘要"
            value={entry.摘要}
            editable
            rows={4}
            onChange={(value) => onUpdate({ 摘要: value })}
          />
          <PerformanceTextarea
            label="原文"
            value={entry.原文}
            editable
            rows={10}
            onChange={(value) => onUpdate({ 原文: value })}
          />
        </div>
      </section>
    </>
  );
}

export function CustomWorkspace({
  zhikuSystem,
  onZhikuSystemChange,
  onSaveZhikuSystem,
  compact: propCompact,
}: CustomWorkspaceProps) {
  const isCompactSurface = useCompactSurface();
  const compact = propCompact ?? isCompactSurface;

  const normalized = useMemo(() => 归一化智库系统(zhikuSystem), [zhikuSystem]);
  const visibleEntries = useMemo(
    () => normalized.条目.filter((entry) => isZhikuArchiveEntryVisible(entry)),
    [normalized],
  );
  const builtinEntries = useMemo(
    () => visibleEntries.filter((entry) => entry.builtin),
    [visibleEntries],
  );
  const customEntries = useMemo(
    () => visibleEntries.filter((entry) => !entry.builtin),
    [visibleEntries],
  );

  const [bucket, setBucket] = useState<Bucket>(() => (customEntries.length === 0 ? 'builtin' : 'custom'));
  const [activeCategory, setActiveCategory] = useState<智库分类 | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* 当没有自制条目时，默认进入草稿创建模式；已有自制条目时展示选中的条目。 */
  const [mode, setMode] = useState<WorkspaceMode>(() => (customEntries.length === 0 ? 'draft' : 'entry'));
  const [mobilePane, setMobilePane] = useState<'list' | 'detail'>(() =>
    customEntries.length === 0 ? 'detail' : 'list',
  );

  const [draft, setDraft] = useState<Draft>(() => 创建空草稿());
  const [composerError, setComposerError] = useState('');
  const [saveFlash, setSaveFlash] = useState(false);

  const pool = bucket === 'builtin' ? builtinEntries : customEntries;
  /* 召回要逐条扫原文，162 条下去就是每敲一个字几 MB 的打分。延后一帧再算，
     输入框仍然跟着手指走，只有列表晚一拍。 */
  const deferredQuery = useDeferredValue(query);
  const activeEntries = useMemo(() => {
    let result = pool;
    const hasQuery = !!deferredQuery.trim();
    if (hasQuery) {
      result = 搜索智库条目({ 条目: result }, deferredQuery, 200);
    }
    if (activeCategory !== 'all') {
      result = result.filter((entry) => entry.分类 === activeCategory);
    }
    return hasQuery ? result : [...result].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [activeCategory, deferredQuery, pool]);

  const counts = useMemo(() => 智库分类计数({ 条目: pool }), [pool]);
  const selected: 智库条目 | null =
    activeEntries.find((entry) => entry.id === selectedId) ?? activeEntries.at(0) ?? null;

  /* 本地编辑缓冲条目：用于 60fps 顺滑输入，防抖后写盘，杜绝打字卡顿与 I/O 轰炸。 */
  const [bufferedEntry, setBufferedEntry] = useState<智库条目 | null>(selected);
  const saveDebounceTimerRef = useRef<number | null>(null);
  const saveFlashTimerRef = useRef<number | null>(null);

  /* 两支护栏都必须在卸载时熄火：否则关掉工作台后定时器仍会回来 setState。 */
  useEffect(() => () => {
    for (const timer of [saveDebounceTimerRef.current, saveFlashTimerRef.current]) {
      if (timer !== null) window.clearTimeout(timer);
    }
  }, []);

  const persistSystem = useCallback(
    async (nextEntries: 智库条目[]) => {
      /* 必须带上原系统的目录标识：只传条目会让 目录版本/目录修订 归一化成空，
         而它们会被内置目录的合并与校验读到。 */
      const next = 归一化智库系统({ ...zhikuSystem, 条目: nextEntries });
      onZhikuSystemChange(next);
      await onSaveZhikuSystem(next);
      setSaveFlash(true);
      if (saveFlashTimerRef.current !== null) window.clearTimeout(saveFlashTimerRef.current);
      saveFlashTimerRef.current = window.setTimeout(() => {
        saveFlashTimerRef.current = null;
        setSaveFlash(false);
      }, 1200);
    },
    [onSaveZhikuSystem, onZhikuSystemChange, zhikuSystem],
  );

  const flushSave = useCallback(
    async (updatedEntry: 智库条目) => {
      if (saveDebounceTimerRef.current !== null) {
        window.clearTimeout(saveDebounceTimerRef.current);
        saveDebounceTimerRef.current = null;
      }
      const nextEntries = normalized.条目.map((entry) =>
        entry.id === updatedEntry.id ? { ...updatedEntry, updatedAt: Date.now() } : entry,
      );
      await persistSystem(nextEntries);
    },
    [normalized.条目, persistSystem],
  );

  const handleUpdateEntry = (patch: Partial<智库条目>) => {
    if (!selected) return;
    const updated = { ...selected, ...patch, updatedAt: Date.now() };
    setBufferedEntry(updated);

    if (saveDebounceTimerRef.current !== null) {
      window.clearTimeout(saveDebounceTimerRef.current);
    }
    /* 200ms 防抖持久化：既保证测试中的 waitFor 迅速通过，又避免高频敲击磁盘写。 */
    saveDebounceTimerRef.current = window.setTimeout(() => {
      saveDebounceTimerRef.current = null;
      void flushSave(updated);
    }, 200);
  };

  const handleCreateCustom = async () => {
    const entry = 创建智库条目({
      标题: draft.标题,
      分类: draft.分类,
      来源: draft.来源,
      关键词: draft.关键词.split(/[,，、\n]/),
      资料类型: draft.资料类型,
      关联角色ID: draft.关联角色ID,
      关联形态ID: draft.关联形态ID,
      解锁状态: draft.解锁状态,
      剧透等级: draft.剧透等级,
      使用范围: draft.使用范围,
      外貌锚点: draft.外貌锚点,
      性格锚点: draft.性格锚点,
      说话方式: draft.说话方式,
      行为习惯: draft.行为习惯,
      关系边界: draft.关系边界,
      禁止误写: draft.禁止误写,
      注入内容: draft.注入内容,
      摘要: draft.摘要 || draft.原文.slice(0, 220),
      原文: draft.原文,
      角色故事摘要: draft.角色故事摘要,
      重要度: draft.重要度,
      可用于联动: draft.可用于联动,
      builtin: false,
    });

    if (!entry.原文.trim()) {
      setComposerError('自制资料必须填写档案原文。');
      return;
    }
    const missingInjectionFields = 获取智库注入内容缺失字段(entry);
    if (missingInjectionFields.length) {
      setComposerError(
        `缺少注入内容：${missingInjectionFields.join('、')}。结构化注入不完整的条目不会参与召回。`,
      );
      return;
    }

    setComposerError('');
    const nextEntries = [entry, ...normalized.条目];
    await persistSystem(nextEntries);
    setSelectedId(entry.id);
    setBucket('custom');
    setActiveCategory('all');
    setMode('entry');
    setDraft(创建空草稿(draft.分类));
    if (compact) setMobilePane('detail');
  };

  const deleteSelected = async () => {
    if (!selected || selected.builtin) return;
    const nextEntries = normalized.条目.filter((entry) => entry.id !== selected.id);
    await persistSystem(nextEntries);
    setSelectedId(nextEntries[0]?.id ?? null);
    if (nextEntries.filter((e) => !e.builtin).length === 0) {
      setMode('draft');
    }
    if (compact) setMobilePane('list');
  };

  const cloneBuiltinToCustom = () => {
    if (!selected) return;
    setDraft({
      ...创建空草稿(selected.分类),
      标题: `${selected.标题} (自制副本)`,
      分类: selected.分类,
      来源: selected.来源 || '原著参考',
      关键词: selected.关键词.join('、'),
      注入内容: selected.注入内容 ? { ...selected.注入内容 } : 创建空智库注入内容(selected.分类),
      摘要: selected.摘要,
      原文: selected.原文,
      重要度: selected.重要度,
      关联角色ID: selected.关联角色ID ?? '',
      关联形态ID: selected.关联形态ID ?? '',
    });
    setMode('draft');
    if (compact) setMobilePane('detail');
  };

  const startNewDraft = () => {
    setDraft(创建空草稿(selected?.分类 ?? 'character'));
    setComposerError('');
    setMode('draft');
    if (compact) setMobilePane('detail');
  };

  /* 只在 id 对得上时采用缓冲：换条目就当场回落，不必等 effect 跑完再纠正，
     否则点开 B 会先渲一帧 A 的标题与正文。 */
  const activeOrBuffered = bufferedEntry && bufferedEntry.id === selected?.id ? bufferedEntry : selected;

  return (
    <div className="zk-work">
      <div className="zk-work__split">
        {/* 左侧导轨：在紧凑端按栈展示，在桌面端常驻左侧 */}
        {(!compact || mobilePane === 'list') && (
          <aside className="zk-work__aside" aria-label="条目列表">
            <div className="zk-index" style={{ flex: 1, width: '100%' }}>
              <div style={{ padding: 12, flex: 'none', borderBottom: '1px solid var(--zk-hair)' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div className="zk-segmented">
                    <button
                      type="button"
                      className="zk-segmented__btn"
                      data-active={bucket === 'custom' ? 'true' : 'false'}
                      onClick={() => {
                        setBucket('custom');
                        if (customEntries.length > 0) {
                          setSelectedId((prev) => (customEntries.some((e) => e.id === prev) ? prev : customEntries[0].id));
                          setMode('entry');
                        } else {
                          setMode('draft');
                        }
                      }}
                    >
                      自制 {customEntries.length}
                    </button>
                    <button
                      type="button"
                      className="zk-segmented__btn"
                      data-active={bucket === 'builtin' ? 'true' : 'false'}
                      onClick={() => {
                        setBucket('builtin');
                        if (builtinEntries.length > 0) {
                          setSelectedId((prev) => (builtinEntries.some((e) => e.id === prev) ? prev : builtinEntries[0].id));
                          setMode('entry');
                        }
                      }}
                    >
                      内置 {builtinEntries.length}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="zk-btn zk-btn--primary"
                    style={{ marginLeft: 'auto', gap: 4 }}
                    onClick={startNewDraft}
                  >
                    <Plus size={13} strokeWidth={2} />
                    新建
                  </button>
                </div>

                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索条目…"
                  className="zk-input"
                  style={{ marginTop: 10 }}
                  aria-label="搜索条目"
                />

                <div className="zk-work-filters">
                  <button
                    type="button"
                    className="zk-chip"
                    data-active={activeCategory === 'all' ? 'true' : 'false'}
                    onClick={() => setActiveCategory('all')}
                  >
                    全部
                  </button>
                  {ZHIKU_CREATE_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className="zk-chip"
                      data-active={activeCategory === cat ? 'true' : 'false'}
                      onClick={() => setActiveCategory(cat)}
                    >
                      {ZHIKU_CATEGORY_LABELS[cat]} <span className="zk-chip__n">{counts[cat]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="zk-entries zk-scroll" role="list">
                {activeEntries.length === 0 ? (
                  <EmptyState title="没有匹配条目" hint="可在上方新建自制条目，或切到「内置」查看已有资料。" />
                ) : (
                  activeEntries.map((entry) => {
                    const isSelected = mode === 'entry' && entry.id === selected?.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        role="listitem"
                        className="zk-entry zk-entry--plain"
                        data-active={isSelected ? 'true' : 'false'}
                        aria-pressed={isSelected}
                        onClick={() => {
                          setSelectedId(entry.id);
                          setMode('entry');
                          if (compact) setMobilePane('detail');
                        }}
                      >
                        <span className="zk-entry__copy">
                          <span className="zk-entry__title">{entry.标题 || '未命名条目'}</span>
                          <span className="zk-entry__meta">
                            {ZHIKU_CATEGORY_LABELS[entry.分类]}
                            {entry.关联角色ID?.trim() ? ` · ${entry.关联角色ID}` : ''}
                          </span>
                        </span>
                        {saveFlash && isSelected && <span className="zk-entry__flag">SAVED</span>}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </aside>
        )}

        {/* 右侧主工作区：在紧凑端按栈展示，在桌面端常驻右侧 */}
        {(!compact || mobilePane === 'detail') && (
          <section
            className="zk-reader zk-editor zk-scroll"
            aria-label="条目编辑器"
            data-side={mode === 'draft' ? 'composer' : undefined}
          >
            {/* 手机端全屏时的顶部返回按钮 */}
            {compact && (
              <div style={{ marginBottom: 14 }}>
                <button
                  type="button"
                  className="zk-btn zk-btn--back"
                  onClick={() => setMobilePane('list')}
                >
                  <ArrowLeft size={14} strokeWidth={2} />
                  返回条目列表
                </button>
              </div>
            )}

            {mode === 'draft' ? (
              /* ── 专注创作草稿模式 ── */
              <div style={{ maxWidth: 900 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div>
                    <div className="zk-reader__kicker">NEW CUSTOM ENTRY</div>
                    <h2 style={{ margin: 0, fontSize: 22, color: 'var(--zk-text)' }}>新建自制条目</h2>
                  </div>
                  {customEntries.length > 0 && (
                    <button type="button" className="zk-btn" onClick={() => setMode('entry')}>
                      取消
                    </button>
                  )}
                </div>

                <div className="zk-grid">
                  <Field label="标题">
                    <input
                      value={draft.标题}
                      onChange={(e) => setDraft({ ...draft, 标题: e.target.value })}
                      placeholder="输入条目标题..."
                      className="zk-input"
                    />
                  </Field>
                  <Field label="分类">
                    <select
                      value={draft.分类}
                      onChange={(e) => {
                        const next = e.target.value as 智库分类;
                        setDraft({ ...draft, 分类: next, 注入内容: 创建空智库注入内容(next) });
                      }}
                      className="zk-input"
                    >
                      {ZHIKU_CREATE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {ZHIKU_CATEGORY_LABELS[cat]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="重要度">
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={draft.重要度}
                      onChange={(e) => setDraft({ ...draft, 重要度: Number(e.target.value) || 3 })}
                      className="zk-input"
                    />
                  </Field>
                  <Field label="来源">
                    <input
                      value={draft.来源}
                      onChange={(e) => setDraft({ ...draft, 来源: e.target.value })}
                      placeholder="例如：原著考据 / 玩家自设"
                      className="zk-input"
                    />
                  </Field>
                  <Field label="关键词">
                    <input
                      value={draft.关键词}
                      onChange={(e) => setDraft({ ...draft, 关键词: e.target.value })}
                      placeholder="用逗号、顿号或空格分隔"
                      className="zk-input"
                    />
                  </Field>
                </div>

                {draft.分类 === 'character' && (
                  <div style={{ marginTop: 14 }}>
                    <SectionLabel>角色设定锚点</SectionLabel>
                    <div className="zk-grid">
                      <Field label="关联角色">
                        <input
                          value={draft.关联角色ID}
                          onChange={(e) => setDraft({ ...draft, 关联角色ID: e.target.value })}
                          placeholder="星 / 三月七 / 丹恒"
                          className="zk-input"
                        />
                      </Field>
                      <Field label="关联形态">
                        <input
                          value={draft.关联形态ID}
                          onChange={(e) => setDraft({ ...draft, 关联形态ID: e.target.value })}
                          placeholder="基础形态 / 饮月 / 巡猎"
                          className="zk-input"
                        />
                      </Field>
                    </div>
                    <div className="zk-grid" style={{ marginTop: 8 }}>
                      <PerformanceTextarea
                        label="外貌锚点"
                        value={draft.外貌锚点}
                        editable
                        onChange={(value) => setDraft({ ...draft, 外貌锚点: value })}
                      />
                      <PerformanceTextarea
                        label="性格锚点"
                        value={draft.性格锚点}
                        editable
                        onChange={(value) => setDraft({ ...draft, 性格锚点: value })}
                      />
                      <PerformanceTextarea
                        label="说话方式"
                        value={draft.说话方式}
                        editable
                        onChange={(value) => setDraft({ ...draft, 说话方式: value })}
                      />
                      <PerformanceTextarea
                        label="行为习惯"
                        value={draft.行为习惯}
                        editable
                        onChange={(value) => setDraft({ ...draft, 行为习惯: value })}
                      />
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 16 }}>
                  <ToggleRow
                    label="允许剧情 / 周报联动检索"
                    checked={draft.可用于联动}
                    onChange={(checked) => setDraft({ ...draft, 可用于联动: checked })}
                  />
                </div>

                {draft.分类 !== 'story' && (
                  <div style={{ marginTop: 16 }}>
                    <InjectionContentFields
                      category={draft.分类}
                      value={draft.注入内容}
                      editable
                      onChange={(注入内容) => setDraft({ ...draft, 注入内容 })}
                    />
                  </div>
                )}

                <div className="zk-grid" style={{ marginTop: 16 }}>
                  <PerformanceTextarea
                    label="摘要"
                    value={draft.摘要}
                    editable
                    rows={4}
                    placeholder="建议写成可检索的短摘要，留空会自动截取正文前 220 字。"
                    onChange={(value) => setDraft({ ...draft, 摘要: value })}
                  />
                  <PerformanceTextarea
                    label="角色故事摘要"
                    value={draft.角色故事摘要}
                    editable
                    rows={4}
                    placeholder="只压缩角色故事层 / 历史故事层；语料、表现锚点和常驻事实仍从原文结构正常注入。"
                    onChange={(value) => setDraft({ ...draft, 角色故事摘要: value })}
                  />
                  <PerformanceTextarea
                    label="原文"
                    value={draft.原文}
                    editable
                    rows={8}
                    placeholder="把原文或整理好的设定正文贴进来。"
                    onChange={(value) => setDraft({ ...draft, 原文: value })}
                  />
                </div>

                {composerError && (
                  <div className="zk-alert" data-kind="error" role="alert" style={{ marginTop: 16 }}>
                    {composerError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 24, paddingBottom: 40 }}>
                  <button
                    type="button"
                    onClick={() => void handleCreateCustom()}
                    disabled={!draft.标题.trim() && !draft.原文.trim()}
                    className="zk-btn zk-btn--primary"
                    style={{ flex: 1, padding: '10px 20px', fontSize: 14 }}
                  >
                    写入档案
                  </button>
                  {customEntries.length > 0 && (
                    <button type="button" className="zk-btn" onClick={() => setMode('entry')}>
                      放弃草稿
                    </button>
                  )}
                </div>
              </div>
            ) : selected ? (
              /* ── 条目查看 / 编辑模式 ── */
              <>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="zk-reader__kicker">
                      {selected.builtin ? 'BUILTIN DATA' : 'CUSTOM DATA'}
                    </div>
                    <input
                      value={activeOrBuffered?.标题 ?? ''}
                      onChange={(e) => handleUpdateEntry({ 标题: e.target.value })}
                      readOnly={selected.builtin}
                      aria-label="条目标题"
                      className="zk-editor__title"
                    />
                    <p className="zk-note" style={{ marginTop: 4 }}>
                      {selected.builtin
                        ? '内置条目来自预设原著资料；只读保护，可切换运行时手动门禁。'
                        : '自制条目编辑区，修改即时缓冲并自动同步至本地智库。'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                    {saveFlash && !selected.builtin && (
                      <span className="zk-entry__flag" style={{ animation: 'none' }}>
                        已保存
                      </span>
                    )}
                    {!selected.builtin ? (
                      <>
                        <button
                          type="button"
                          className="zk-btn zk-btn--danger"
                          onClick={() => void deleteSelected()}
                          title="删除此自制条目"
                        >
                          <Trash2 size={13} strokeWidth={1.8} />
                          删除
                        </button>
                        <button
                          type="button"
                          className="zk-btn zk-btn--primary"
                          onClick={startNewDraft}
                        >
                          <Plus size={13} strokeWidth={1.8} />
                          新建
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="zk-btn"
                        onClick={cloneBuiltinToCustom}
                        title="复制为可编辑的自制条目"
                      >
                        <Copy size={13} strokeWidth={1.8} />
                        以此为模板新建
                      </button>
                    )}
                  </div>
                </div>

                {selected.builtin ? (
                  /* 内置只读条目：优雅的检查卡片展示，不再显示死板灰色的输入框 */
                  <div style={{ marginTop: 16 }}>
                    <section className="zk-section">
                      <SectionLabel>运行时解锁状态</SectionLabel>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        {zhikuUnlockStatuses.map((status) => (
                          <button
                            key={status}
                            type="button"
                            className="zk-btn"
                            data-active={selected.运行时解锁状态 === status ? 'true' : 'false'}
                            onClick={() => void flushSave({ ...selected, 运行时解锁状态: status })}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className="zk-section" style={{ marginTop: 20 }}>
                      <SectionLabel>条目元数据</SectionLabel>
                      <div className="zk-grid">
                        <div className="zk-field">
                          <span className="zk-field__label">分类</span>
                          <span className="zk-input" style={{ opacity: 0.8 }}>
                            {ZHIKU_CATEGORY_LABELS[selected.分类]}
                          </span>
                        </div>
                        <div className="zk-field">
                          <span className="zk-field__label">重要度</span>
                          <span className="zk-input" style={{ opacity: 0.8 }}>
                            {'★'.repeat(selected.重要度 || 3)}
                          </span>
                        </div>
                        <div className="zk-field">
                          <span className="zk-field__label">来源</span>
                          <span className="zk-input" style={{ opacity: 0.8 }}>
                            {selected.来源 || '原著预设'}
                          </span>
                        </div>
                        <div className="zk-field">
                          <span className="zk-field__label">关键词</span>
                          <span className="zk-input" style={{ opacity: 0.8 }}>
                            {selected.关键词.join('、') || '无'}
                          </span>
                        </div>
                      </div>
                    </section>

                    {selected.分类 !== 'story' && (
                      <div style={{ marginTop: 20 }}>
                        <InjectionContentFields
                          category={selected.分类}
                          value={selected.注入内容}
                          editable={false}
                          onChange={() => {}}
                        />
                      </div>
                    )}

                    <section className="zk-section" style={{ marginTop: 20, paddingBottom: 40 }}>
                      <SectionLabel>档案正文与摘要</SectionLabel>
                      <div className="zk-grid">
                        <PerformanceTextarea
                          label="摘要"
                          value={selected.摘要}
                          editable={false}
                          rows={4}
                          onChange={() => {}}
                        />
                        <PerformanceTextarea
                          label="原文"
                          value={selected.原文}
                          editable={false}
                          rows={10}
                          onChange={() => {}}
                        />
                      </div>
                    </section>
                  </div>
                ) : (
                  <CustomEntryEditor entry={activeOrBuffered ?? selected} onUpdate={handleUpdateEntry} />
                )}
              </>
            ) : (
              <EmptyState title="先录入或选择一条资料" hint="自制条目支持新建、编辑与删除。" />
            )}
          </section>
        )}
      </div>
    </div>
  );
}
