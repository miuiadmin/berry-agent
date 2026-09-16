/**
 * host/plugin-market/fs —— MarketFs 缺省真身工厂（node:fs 包装）。
 *
 * 装配函数独立导出：生产位 createMarketFs()；测试位注内存 fs（vitest 全测
 * 零真盘——mp-2 零网络纪律的盘侧同款）。read/readdir 缺席返 null 不抛
 * （探测语义）；rm force 递归；write 自责建父目录。
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { MarketFs } from './types.js';

/** 缺省真身：node:fs 包装（缺席形返 null/false——探测语义不抛） */
export function createMarketFs(): MarketFs {
  return {
    read: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null; // 缺席（ENOENT 等）——探测语义
      }
    },
    write: (path, text) => {
      mkdirSync(dirname(path), { recursive: true }); // 自责建父目录
      writeFileSync(path, text, 'utf8');
    },
    rename: (from, to) => {
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
    },
    mkdir: (path) => {
      mkdirSync(path, { recursive: true });
    },
    rm: (path) => {
      rmSync(path, { recursive: true, force: true }); // force——缺席不抛
    },
    readdir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return null; // 缺席——探测语义
      }
    },
    isDir: (path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
  };
}
