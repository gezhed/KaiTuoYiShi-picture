# noted_issues — 已退役（2026-09-18）

本文档原为 `ideal_design.md` §1 现状画像的数据底稿（2026-08-12 全库扫描，逐条文件:行号）。

退役原因：经 `docs/unification-audit.md` §1 核实，本文档引用的
`services/dbService.ts`、`services/ai/chatCompletionClient.ts` 等文件已被拆分，
多数行号与结论与当前代码不符，继续保留会误导后续扫描。

- 历史内容见 git：`git log --follow -- noted_issues.md`。
- 审计结论见 `docs/unification-audit.md` §1。
- 新的扫描以实时测量为准，不再维护静态行号清单。
