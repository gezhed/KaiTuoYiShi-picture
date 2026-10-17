#!/usr/bin/env node
/**
 * 通过 GitHub REST API 提交（本机到 github.com:443 的 git 传输被阻断时用它）。
 *
 *   node scripts/push-via-api.mjs --repo OWNER/NAME --branch main \
 *     --files 清单.txt --message-file 提交说明.txt [--base-tree] [--base-branch 已有分支]
 *
 * --base-tree   以目标分支当前 HEAD 的树为底，只覆盖清单里的文件（局部提交）。
 *   缺省        不设 base_tree：新树**完全等于**清单里的文件集合（整份替换）。
 * --base-branch 目标分支还不存在时，用它当 base（默认同 --branch）。
 *
 * 踩坑记录：
 *   ① 局部提交必须带 base_tree，否则新树会顶掉仓库其余文件；
 *   ② 大文件的 base64 不要走命令行参数，一律放请求体；
 *   ③ 本命令只改 GitHub 上的内容，不碰工作区。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const API = 'https://api.github.com';
const CONCURRENCY = 8;

function parseArgs(argv) {
  const opt = { baseTree: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-tree') {
      opt.baseTree = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      opt.help = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    opt[key] = argv[i + 1];
    i += 1;
  }
  return opt;
}

const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();

async function api(method, path, body) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'kty-push-via-api',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const error = new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 600)}`);
    error.status = res.status;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

async function headOf(repo, branch) {
  const data = await api('GET', `/repos/${repo}/commits/${branch}`);
  return { sha: data.sha, tree: data.commit.tree.sha };
}

async function uploadBlob(repo, file) {
  const raw = readFileSync(file);
  const blob = await api('POST', `/repos/${repo}/git/blobs`, {
    encoding: 'base64',
    content: raw.toString('base64'),
  });
  return { path: file.replaceAll('\\', '/'), sha: blob.sha, bytes: raw.length };
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help || !opt.repo || !opt.branch || !opt.files || !opt.messageFile) {
    console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 15).join('\n'));
    process.exit(opt.help ? 0 : 1);
  }

  const paths = readFileSync(opt.files, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (paths.length === 0) throw new Error('清单是空的');
  const message = readFileSync(opt.messageFile, 'utf8');

  const base = await headOf(opt.repo, opt.baseBranch ?? opt.branch);
  console.log(`base ${base.sha.slice(0, 8)} · tree ${base.tree.slice(0, 8)} · ${paths.length} 个文件`);

  const entries = [];
  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const chunk = paths.slice(i, i + CONCURRENCY);
    entries.push(...(await Promise.all(chunk.map((file) => uploadBlob(opt.repo, file)))));
    console.log(`  blob ${Math.min(i + CONCURRENCY, paths.length)}/${paths.length}`);
  }

  const treeBody = {
    tree: entries.map((entry) => ({ path: entry.path, mode: '100644', type: 'blob', sha: entry.sha })),
  };
  if (opt.baseTree) treeBody.base_tree = base.tree;
  const tree = await api('POST', `/repos/${opt.repo}/git/trees`, treeBody);

  // POST /git/trees 的响应**只回新增/修改的那几条**（大树上还会 truncated），
  // 想校验「文件真的进去了」必须回读整棵树。
  const full = await api('GET', `/repos/${opt.repo}/git/trees/${tree.sha}?recursive=1`);
  const blobPaths = new Set(full.tree.filter((item) => item.type === 'blob').map((item) => item.path));
  const uploaded = new Set(entries.map((entry) => entry.path));
  const missing = [...uploaded].filter((path) => !blobPaths.has(path));
  if (missing.length > 0) throw new Error(`新树上缺文件：\n  ${missing.slice(0, 10).join('\n  ')}`);
  console.log(`tree ${tree.sha.slice(0, 8)}（${blobPaths.size} 个文件，校验通过）`);

  const commit = await api('POST', `/repos/${opt.repo}/git/commits`, {
    message,
    tree: tree.sha,
    parents: [base.sha],
  });
  console.log(`commit ${commit.sha}`);

  try {
    await api('PATCH', `/repos/${opt.repo}/git/refs/heads/${opt.branch}`, { sha: commit.sha, force: false });
  } catch (error) {
    if (error.status !== 404 && error.status !== 422) throw error;
    await api('POST', `/repos/${opt.repo}/git/refs`, { ref: `refs/heads/${opt.branch}`, sha: commit.sha });
  }
  console.log(`${opt.branch} -> ${commit.sha}`);
  console.log(`https://github.com/${opt.repo}/commit/${commit.sha}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
