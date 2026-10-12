# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**The player.** Someone mid-run in 开拓轶事, or browsing the app's home route with no game running. They arrive at the Zhiku for one of two reasons, confirmed by the user:

- **Browsing for pleasure** — the dominant mode on the home route. No target in mind; they want to wander accumulated lore, re-read a character profile, flip through unlocked story volumes. Success is a collection that feels like it *grew*, and a visit that was worth the time on its own.
- **Retrieval mid-scene** — in-game, in the middle of a story beat. Something was named (「星核猎手」「雅利洛-VI」), they want to recall it, and they want to be back in the story in seconds.

**The author.** In-game only. Writing 自制 entries, checking what built-in coverage already exists, verifying injection content before a run. Job: a composing workbench, not a reading surface.

The user has stated these must live on **one consistent surface**. The incumbent's `surface: 'home' | 'ingame'` fork, which renders "ZHIKU // STUDIO" vs "ZHIKU // ARCHIVE" over an identical UI, is retired: capabilities may differ by context, the surface's identity may not.

## Product Purpose

The Zhiku (智库) is the game's lore archive. It holds every fact the narrative is allowed to lean on: 162 built-in entries drawn from bundled JSON presets across 人物 / 地点 / 派系 / 事件 / 专有名词, 27 story-weaving volumes of archived chapters, plus entries the player writes themselves. Success means the archive is both a place worth visiting and a retrieval substrate the model can be held to.

## Positioning

**The archive is not a codex — it is the retrieval substrate.** Every entry carries 关键词 and 结构化注入内容 that are injected into the model's prompt at generation time (see `services/zhikuRetrieval.ts`, `hooks/useGame/stage10_storyZhiku.ts`). What the player reads and what the model is told are the same record, maintained in one place. A neighboring lore-viewer could copy the reading experience and still not be this: the archive is the game's memory, and the codex screen is its face.

## Operating Context

- React 19 + TypeScript + Vite. Data persists to IndexedDB; model calls go to a user-configured API endpoint.
- The Zhiku is mounted twice: from the home/landing route, and in-game as a panel alongside the app's other game systems (剧情 / 忆庭 / 记忆 / 相册 / 战技 / 物品 / 新闻 / 同行 / 命途).
- Entries are **locked until unlocked through play** (`运行时解锁状态`); locked entries are hidden from the archive. Story volumes and chapters unlock with reading progress. A fresh save sees an empty archive — the empty and partially-unlocked states are the *first* states most players meet, not edge cases.
- Built-in entries are stored as a stripped projection (摘要/原文/关键词 removed) in the save; the archive rehydrates from bundled presets at read time.
- 自制 (player-authored) entries are a first-class source alongside built-ins and are badged as such in the archive.

## Capabilities and Constraints

**Confirmed functionality to preserve:** category browsing across the five lore categories; a story-archive reader with per-volume chapter lists, read/current/unread/locked chapter states, and per-volume progress; per-entry archive body + injection-content reading panes with a variant selector for characters with multiple forms (e.g. 丹恒常态 / 饮月 / 腾荒); a custom-entry workspace with create/edit/delete; reader font-size controls; bundled-catalog refresh; Escape-to-back, Escape-to-close.

**Confirmed constraints:** the `--tn-*` design system in `styles/tn.css` is Zhiku-only and is being retired with the implementation. The app's global token system (`--tj-*` in `styles/root-theme.css`) is the surrounding authority. The user has directed a clean-slate rebuild: all incumbent `components/features/ZhikuNext/*` code is to be deleted rather than referenced. `motion` (motion.dev) is approved as a new dependency.

**Terminology:** 智库 (the archive), 条目 (entry), 卷宗 / 章节 (volume / chapter), 档案预览 vs 注入内容 (the two reading panes), 自制 (player-authored), 内置 (bundled).

**Undecided:** whether the rebuilt surface keeps the per-entry variant selector in its current form; whether search is in scope for this round.

## Brand Commitments

The app's global identity is binding and predates this work: **开拓金 `#f5d97a` on near-black, with cool cyan (科技色) as the signal color.** It comes from `styles/root-theme.css` and is carried by every other surface in the app. A Zhiku that abandoned it would read as a foreign object embedded in 开拓轶事. This binds the palette's *role*, not its rendition — the replacement world may use the gold at any scale or saturation the direction calls for, but it may not leave the building.

The subject is a fan work set in Honkai: Star Rail's universe; in-universe terminology, faction names, and iconography are load-bearing and may not be invented or renamed.

## Evidence on Hand

**Real content, already in the repo:**
- 162 built-in Zhiku entries across 5 categories, under `public/zhiku-presets/*.json` (23 preset files).
- 27 story-weaving volumes of archived chapters under `public/data/story-weaving-canon/`.
- Character avatar assets wired through `data/zhikuCanonicalCharacters.ts` → `ResilientImage`. The archive lobby currently renders **none** of them.
- Entry bodies are long-form Chinese prose; injection content is structured/technical.

**Absences that future work must not fabricate:** no testimonials, customers, benchmarks, or usage statistics exist; none may be invented. Do not claim player counts, reading times, or accuracy figures.

## Product Principles

1. **The archive is the game's memory, not a gallery about it.** Every screen should make the reader feel they are inside the record, not browsing a museum placard describing it.
2. **The first state is the empty state.** Most players meet the Zhiku before it has anything in it. An empty archive must be as deliberately designed as a full one — it is the invitation, not the failure.
3. **One surface, many depths.** Browsing, retrieval, and authoring are the same place at different depths. Never fork the identity to fork the capability.
4. **Reveal is the reward.** Locked content is the product's progression currency; what is unlocked is shown beautifully, and what is not is felt as absence, not as a grey placeholder.
5. **Nothing decorative without a job.** A visual element that cannot name what it tells the reader does not ship.

## Accessibility & Inclusion

No product-specific standard has been established. Inherit the app's existing behavior: `prefers-reduced-motion` is honored in the incumbent system and must remain honored, keyboard access to every category/chapter/entry is required (the incumbent is fully keyboard-navigable and this must not regress), and the reader's font-size control must keep working.
