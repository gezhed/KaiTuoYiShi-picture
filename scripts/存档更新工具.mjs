#!/usr/bin/env node
/**
 * 存档更新工具
 *
 * 把「旧规则」的存档目录转换为「新规则」，用于防止玩家存档过大导致 IndexedDB 无法正常读取。
 *
 * 新规则做三件事：
 *   ① 剧情编织只保留「持久化投影」（canon 原著正文从内置预设水合，不再逐条复制进每条存档）；
 *   ② 聊天消息只留正文（剥掉 调试 / 思维链 / 计费 等字段）；
 *   ③ 自动档收敛为「最新 N 个节点 + 根节点」，其余更早的自动存档点整段删除。
 *
 * 用法：
 *   node 存档更新工具.mjs                              # 预演：只报告将做什么，不写盘（默认）
 *   node 存档更新工具.mjs --执行                        # 真正执行
 *   node 存档更新工具.mjs "D:\某处\save" --执行          # 指定存档目录
 *
 * 重要：执行前请先【关闭游戏】，并自行【备份 save 目录】。本工具会删除旧节点，不可逆。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const 本文件 = fileURLToPath(import.meta.url);
const 本目录 = path.dirname(本文件);
const 参数 = process.argv.slice(2);
const 执行 = 参数.includes('--执行') || 参数.includes('--yes') || 参数.includes('-y');
const 指定目录 = 参数.find((值) => !值.startsWith('--'));
const 存档目录 = path.resolve(指定目录 || path.join(本目录, '..', 'save'));
const 保留节点数 = 6;

const 读JSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const 写JSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o));
const 大小 = (n) => (n / 1048576).toFixed(1) + 'MB';
const 存储目录 = (名) => path.join(存档目录, 'store', 名);

function 投影剧情编织(sw) {
  if (!sw || typeof sw !== 'object') return sw;
  return {
    persistenceVersion: 3,
    系列列表: (sw.系列列表 ?? []).map((系列) => {
      if (系列.来源类型 !== 'canon') return 系列;
      return {
        ...系列,
        来源智库条目ID: [],
        原始文本: undefined,
        章节列表: [],
        分段列表: (系列.分段列表 ?? []).map((段) => {
          const 拷贝 = { ...段 };
          delete 拷贝.原文内容;
          return 拷贝;
        }),
      };
    }),
    当前系列ID: sw.当前系列ID,
    当前进度: sw.当前进度,
  };
}

function 剥消息(m) {
  return {
    ...m,
    debugContext: undefined,
    inputTokens: undefined,
    outputTokens: undefined,
    tokenUsage: undefined,
    responseDurationSec: undefined,
    parsedResponse: m.parsedResponse
      ? {
          ...m.parsedResponse,
          rawText: '',
          thinking: '',
          memory: '',
          commands: {},
          worldEvents: [],
          actionOptions: [],
          variableDraft: '',
          storyPlan: '',
        }
      : m.parsedResponse,
  };
}

function 结束(文字) {
  console.log(文字);
  process.exit(1);
}

// ── 检查目录 ───────────────────────────────────────────────
if (!fs.existsSync(存档目录)) 结束(`找不到存档目录：${存档目录}`);
if (!fs.existsSync(存储目录('saves'))) 结束(`这不像一个存档目录（缺少 store/saves）：${存档目录}`);

const saves目录 = 存储目录('saves');
const summaries目录 = 存储目录('saveSummaries');
const deltas目录 = 存储目录('saveNodeDeltas');

const 全部saves文件 = fs.readdirSync(saves目录).filter((f) => f.endsWith('.json'));
const 前总大小 = 全部saves文件.reduce((和, f) => 和 + fs.statSync(path.join(saves目录, f)).size, 0);

// ── 用 summaries（小）建 nodeId 索引 + 回溯自动链 ────────────
const byNodeId = new Map();
if (fs.existsSync(summaries目录)) {
  for (const f of fs.readdirSync(summaries目录).filter((f) => f.endsWith('.json'))) {
    const 行 = 读JSON(path.join(summaries目录, f));
    const nodeId = 行.saveTree?.nodeId;
    if (nodeId) byNodeId.set(nodeId, { id: 行.id, file: `${行.id}.json`, nodeId, parentNodeId: 行.saveTree?.parentNodeId ?? null });
  }
}

let 链 = [];
const newest路径 = path.join(存储目录('newestStory'), 'newest.json');
if (fs.existsSync(newest路径) && byNodeId.size) {
  let 游标 = 读JSON(newest路径).headNodeId;
  const 已见 = new Set();
  while (游标 && byNodeId.has(游标) && !已见.has(游标)) {
    已见.add(游标);
    const 项 = byNodeId.get(游标);
    链.push(项);
    游标 = 项.parentNodeId;
  }
}
const 根节点 = 链[链.length - 1];
const 链上保留 = new Set(链.slice(0, 保留节点数).map((项) => 项.id));
if (根节点) 链上保留.add(根节点.id);
// 只删「自动链上、被窗口挤出去的旧节点」；不在链上的（手动存档 / 其它分支）一律保留。
const 丢弃 = 链.slice(保留节点数, 根节点 ? Math.max(保留节点数, 链.length - 1) : 链.length);

// ── 报告 ──────────────────────────────────────────────────
console.log('');
console.log('  存档更新工具');
console.log(`  存档目录：${存档目录}`);
console.log(`  saves 文件：${全部saves文件.length} 个，合计 ${大小(前总大小)}`);
console.log(`  自动链长度：${链.length}（保留最新 ${保留节点数} + 根节点 = ${链上保留.size}，将删除链上旧节点 ${丢弃.length}；不在链上的节点保留）`);
if (链.length === 0) console.log('  （未找到自动链——可能存档结构已很新，或 newestStory 缺失；仍会按新规则重写保留行）');
console.log('');
if (!执行) {
  console.log('  这是【预演】。确认无误后加 --执行 真正写入：');
  console.log('    node 存档更新工具.mjs --执行');
  console.log('');
  process.exit(0);
}

// ── 执行 ──────────────────────────────────────────────────
console.log('  开始执行…');

// 1) 重写【所有】saves 行：① 剧情编织投影 + ② 只留正文（delta-only 行无这些字段，不受影响）
let 重写数 = 0;
for (const 项 of byNodeId.values()) {
  const 完整路径 = path.join(saves目录, 项.file);
  if (!fs.existsSync(完整路径)) continue;
  const 行 = 读JSON(完整路径);
  行['剧情编织'] = 投影剧情编织(行['剧情编织']);
  if (Array.isArray(行.chatHistory)) 行.chatHistory = 行.chatHistory.map(剥消息);
  写JSON(完整路径, 行);
  重写数 += 1;
}

// 2) 重接：保留链最老的新节点 → 根节点
const 保留最老 = 链[Math.min(保留节点数, 链.length) - 1];
if (保留最老 && 根节点 && 保留最老.id !== 根节点.id) {
  for (const 目标 of [path.join(saves目录, 保留最老.file), path.join(summaries目录, 保留最老.file)]) {
    if (!fs.existsSync(目标)) continue;
    const 行 = 读JSON(目标);
    if (行.saveTree) {
      行.saveTree.parentNodeId = 根节点.nodeId;
      写JSON(目标, 行);
    }
  }
}

// 3) 删除被丢弃的节点
let 删除数 = 0;
for (const 项 of 丢弃) {
  fs.rmSync(path.join(saves目录, 项.file), { force: true });
  fs.rmSync(path.join(summaries目录, 项.file), { force: true });
  fs.rmSync(path.join(deltas目录, encodeURIComponent(String(项.nodeId)) + '.json'), { force: true });
  删除数 += 1;
}

// 4) 更新 manifest（让下次启动判定“磁盘已前进”从而回灌新数据）
const manifest路径 = path.join(存档目录, 'manifest.json');
const manifest = fs.existsSync(manifest路径)
  ? 读JSON(manifest路径)
  : { app: 'kaituoyishi', version: 1, dbVersion: 10, updatedAt: 0 };
manifest.updatedAt = Date.now();
写JSON(manifest路径, manifest);

const 后文件 = fs.readdirSync(saves目录).filter((f) => f.endsWith('.json'));
const 后总大小 = 后文件.reduce((和, f) => 和 + fs.statSync(path.join(saves目录, f)).size, 0);

console.log('');
console.log(`  完成：重写 ${重写数} 条，删除 ${删除数} 个旧节点`);
console.log(`  saves：${全部saves文件.length} 个 ${大小(前总大小)} → ${后文件.length} 个 ${大小(后总大小)}`);
console.log('');
