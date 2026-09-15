/**
 * fuzzy 过滤单测（07 §4.1 R6 批 10j）：子序列判据 + 前缀置顶排序律纯函数直锁。
 */
import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatchKind, isSubsequence } from './fuzzy.js';

describe('isSubsequence 子序列判据', () => {
  it('按序出现即命中（大小写不敏感）', () => {
    expect(isSubsequence('plugins', 'plg')).toBe(true);
    expect(isSubsequence('Plugins', 'plg')).toBe(true); // 大小写不敏感
    expect(isSubsequence('approval', 'avl')).toBe(true);
    expect(isSubsequence('berry-agent', 'ba')).toBe(true);
  });

  it('序错不中 / 缺字不中 / 空查询恒真', () => {
    expect(isSubsequence('plugins', 'glp')).toBe(false); // 序错
    expect(isSubsequence('plugins', 'px')).toBe(false); // 缺字
    expect(isSubsequence('anything', '')).toBe(true); // 空查询全量
  });
});

describe('fuzzyMatchKind 档位', () => {
  it('前缀 / 子序列 / 不中三档', () => {
    expect(fuzzyMatchKind('plugins', 'pl')).toBe('prefix');
    expect(fuzzyMatchKind('Plugins', 'PL')).toBe('prefix'); // 大小写不敏感
    expect(fuzzyMatchKind('plugins', 'pgs')).toBe('subseq');
    expect(fuzzyMatchKind('plugins', 'xyz')).toBeNull();
    expect(fuzzyMatchKind('any', '')).toBe('prefix'); // 空查询归前缀组
  });
});

describe('fuzzyFilter 双组排序律', () => {
  const names = ['plugins', 'approval', 'doors', 'help'];
  const keyOf = (s: string): string => s;

  it('前缀命中排 fuzzy 命中前——各组内保源序', () => {
    // 'p' 前缀中 plugins；子序列中 approval（a-**p**-**p**-r…）、help（尾 **p**）；doors 无 p 不中
    expect(fuzzyFilter(names, keyOf, 'p')).toEqual(['plugins', 'approval', 'help']);
    // 'pl' 前缀 plugins + 子序列 approval（**p**-p-r-o-v-a-**l**）
    expect(fuzzyFilter(names, keyOf, 'pl')).toEqual(['plugins', 'approval']);
    // 空查询全量前缀组（源序不动）
    expect(fuzzyFilter(names, keyOf, '')).toEqual(names);
    // 全不中 = 空集
    expect(fuzzyFilter(names, keyOf, 'zq')).toEqual([]);
  });

  it('对象条目经 keyOf 提键（消费面形）', () => {
    const specs = [
      { name: 'plugins', detail: '插件' },
      { name: 'memory', detail: '记忆' },
      { name: 'sessions', detail: '会话' },
    ];
    // 's' 前缀 sessions + 子序列 plugins? p-l-u-g-i-n-s 含 s（尾）→ subseq；memory 无 s
    const out = fuzzyFilter(specs, (s) => s.name, 's');
    expect(out.map((s) => s.name)).toEqual(['sessions', 'plugins']);
  });
});
