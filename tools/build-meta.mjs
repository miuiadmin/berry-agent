#!/usr/bin/env node
/**
 * 构建溯源戳生成器（07 篇 §8.3 契约 3——`dist/.build-meta.json` 随包位，
 * 2026-09-08 发布面收口批落位）。
 *
 * build 链尾步（emit-api-decls 之后）：向 dist/ 写构建溯源戳——
 * version / commit / builtAt / node 四元组。发布物验收律必在此件；
 * 运行时不读（安装侧排障的人工对账物——先看此戳定位构建代）。
 *
 * commit 取值容错：git 不可用（快照源码树 / 无 .git 环境）记 null 不炸构建
 * ——溯源戳缺 commit 可诊断，构建因缺 git 而红不可接受；发布机器路径 git
 * 恒在场（契约 1 工作树净空检查先于此步兜底）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根（脚本位置上一级） */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** git 短 commit 容错取值——失败记 null（见头注：构建不因缺 git 而红） */
function readCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
const meta = {
  version: pkg.version,
  commit: readCommit(),
  builtAt: new Date().toISOString(),
  node: process.versions.node,
};
writeFileSync(join(REPO_ROOT, 'dist', '.build-meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(`[build-meta] dist/.build-meta.json ← v${meta.version} @ ${meta.commit ?? 'no-git'} node ${meta.node}`);
