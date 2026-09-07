/**
 * polluted 会话资格件测试（批 18c-5——06 §4.1 落码定形注：判据通配机制 +
 * 状态机单向转移幂等 + 起草值表语义）。
 */
import { describe, expect, it } from 'vitest';
import { createPollutionTracker, isPollutingToolName, matchesToolPattern } from './pollution.js';
import { MEMORY_POLLUTION_DEFAULT_PATTERNS } from './types.js';

describe('判据通配匹配', () => {
  it("无 '*' = 精确名；'*__*' = 含 '__' 子串全族（MCP 复合键——服务器键无下划线）", () => {
    expect(matchesToolPattern('fetch', 'fetch')).toBe(true);
    expect(matchesToolPattern('fetch_page', 'fetch')).toBe(false);
    expect(matchesToolPattern('github__list_prs', '*__*')).toBe(true);
    expect(matchesToolPattern('notion__search', '*__*')).toBe(true);
    expect(matchesToolPattern('exec', '*__*')).toBe(false);
    expect(matchesToolPattern('read_file', '*__*')).toBe(false); // 单下划线非复合键
  });

  it("前缀/中缀/多星通配全形；'*' 旁正则元字符按字面量", () => {
    expect(matchesToolPattern('browser_navigate', 'browser_*')).toBe(true);
    expect(matchesToolPattern('other_navigate', 'browser_*')).toBe(false);
    expect(matchesToolPattern('memory_search', '*search*')).toBe(true);
    expect(matchesToolPattern('memory.remember', 'memory.remember')).toBe(true); // '.' 字面量不吞任意字符
    expect(matchesToolPattern('memoryXremember', 'memory.remember')).toBe(false);
  });

  it('起草值表：fetch/mcp 精确 + *__* 全族；exec/read 等内部工具不命中', () => {
    expect(MEMORY_POLLUTION_DEFAULT_PATTERNS).toEqual(['fetch', 'mcp', '*__*']);
    expect(isPollutingToolName('fetch')).toBe(true);
    expect(isPollutingToolName('mcp')).toBe(true);
    expect(isPollutingToolName('linear__create_issue')).toBe(true);
    expect(isPollutingToolName('exec')).toBe(false);
    expect(isPollutingToolName('memory_write')).toBe(false); // 单下划线
    expect(isPollutingToolName('read')).toBe(false);
  });

  it('patterns 注入覆盖起草表（判据演进不改机制）', () => {
    expect(isPollutingToolName('fetch', ['exec'])).toBe(false);
    expect(isPollutingToolName('exec', ['exec'])).toBe(true);
  });
});

describe('会话资格追踪器', () => {
  it('未知会话缺省 eligible；单向转移幂等；无回退路径', () => {
    const t = createPollutionTracker();
    expect(t.classify('s1')).toBe('eligible');
    expect(t.isPolluted('s1')).toBe(false);

    expect(t.markIfPolluted('s1', 'fetch')).toBe(true); // 本调用完成转移
    expect(t.classify('s1')).toBe('polluted');
    expect(t.markIfPolluted('s1', 'mcp')).toBe(false); // 已污染幂等零动作
    expect(t.markIfPolluted('s1', 'exec')).toBe(false); // 非污染名零动作
    // 无回退 API——polluted 是单向终态（会话粒度）
    expect(t.isPolluted('s1')).toBe(true);

    // 会话隔离：s1 污染不连坐 s2
    expect(t.isPolluted('s2')).toBe(false);
    expect(t.markIfPolluted('s2', 'read')).toBe(false);
    expect(t.isPolluted('s2')).toBe(false);
  });

  it('pollutedSessions 快照（consolidation 圈候选消费面）', () => {
    const t = createPollutionTracker();
    expect(t.pollutedSessions()).toEqual([]);
    t.markIfPolluted('sa', 'fetch');
    t.markIfPolluted('sb', 'github__list_prs');
    expect([...t.pollutedSessions()].sort()).toEqual(['sa', 'sb']);
  });

  it('patterns 注入（判据表装配面覆盖）', () => {
    const t = createPollutionTracker({ patterns: ['exec'] });
    expect(t.markIfPolluted('s1', 'fetch')).toBe(false);
    expect(t.markIfPolluted('s1', 'exec')).toBe(true);
  });
});
