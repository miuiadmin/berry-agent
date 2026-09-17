/**
 * 环境披露段第六件（沙箱行）测试（2026-09-17 会话档位切换面批 F2——
 * 立项档测试计划 6 sandbox 半边；04 §11 披露段六件化笔）。
 *
 * 锁的机制：DisclosureInputs 增沙箱源（第六件）+ renderEnvironmentDisclosure
 * 增 `- 沙箱: <mode>` 行；组装位 host/runtime.ts 请求尾派生。沙箱源
 * createSandboxDisclosureSource = fold 复用 conversation foldSessionSandboxMode
 * （内部即 safety resolveEffectiveMode——零新 fold 实现）；坏词 fold 抛在
 * 披露位 **warn 降级**（省略沙箱行、不炸请求）——与工具位 fail-closed 拒
 * 执行分位分职（同一坏词两处置面）。
 *
 * 纪律：SessionLog 真实现产事件（组合根口径）；warn 注入位记调用（桩只停
 * 日志注入位）。
 */
import { describe, expect, it } from 'vitest';
import { SessionLog } from '../session/index.js';
import type { SessionEvent } from '../contracts/index.js';
import { createSandboxDisclosureSource, renderEnvironmentDisclosure } from './disclosure.js';

/* ---------------- 渲染面：第六件行 ---------------- */

describe('环境披露 · 沙箱行渲染（第六件）', () => {
  it('sandbox 在场 → `- 沙箱: <mode>` 行入段（六件全形）', () => {
    const text = renderEnvironmentDisclosure({
      platform: 'darwin 27.0.0',
      cwd: '/tmp/ws',
      date: '2026-09-17',
      gitSummary: 'main (脏)',
      plugins: { total: 3, enabled: 2, failed: 1 },
      sandbox: 'read-only',
    });
    expect(text).toBe(
      [
        '<environment>',
        '- 平台: darwin 27.0.0',
        '- 工作目录: /tmp/ws',
        '- 日期: 2026-09-17',
        '- git: main (脏)',
        '- 插件: 3 个（启用 2 · 失败 1）',
        '- 沙箱: read-only',
        '</environment>',
      ].join('\n'),
    );
  });

  it('sandbox 缺席/null → 行省略（五件旧形零回归）', () => {
    const five = renderEnvironmentDisclosure({ platform: 'darwin', sandbox: undefined });
    expect(five).toBe('<environment>\n- 平台: darwin\n</environment>');
    expect(renderEnvironmentDisclosure({ platform: 'darwin', sandbox: null })).toBe(five);
  });
});

/* ---------------- 沙箱源：fold + 坏词 warn 降级 ---------------- */

describe('环境披露 · 沙箱源 createSandboxDisclosureSource', () => {
  /** 真事件日志 + eventsOf 记 sessionId（穿线断言面） */
  function makeEventsOf(): {
    log: SessionLog;
    eventsOf: (sessionId?: string) => readonly SessionEvent[];
    seen: (string | undefined)[];
  } {
    const seen: (string | undefined)[] = [];
    const log = new SessionLog({ sessionId: 's-disc' });
    const eventsOf = (sessionId?: string): readonly SessionEvent[] => {
      seen.push(sessionId);
      return log.events();
    };
    return { log, eventsOf, seen };
  }

  it('无事件 → boot 解析值（M2：恒显式 boot——非「非 danger」缺省）', () => {
    const { eventsOf } = makeEventsOf();
    const source = createSandboxDisclosureSource({ boot: 'danger', eventsOf, warn: () => {} });
    expect(source('s-disc')).toBe('danger');
  });

  it('有事件 → fold 尾值胜；sessionId 透传 eventsOf', () => {
    const { log, eventsOf, seen } = makeEventsOf();
    log.append('sandbox/mode', { mode: 'read-only' });
    log.append('sandbox/mode', { mode: 'workspace-write' });
    const source = createSandboxDisclosureSource({ boot: 'read-only', eventsOf, warn: () => {} });
    expect(source('s-disc')).toBe('workspace-write'); // 尾值胜
    expect(seen).toEqual(['s-disc']); // 会话键穿线
  });

  it('坏词 → warn 降级返 undefined（省略沙箱行、不炸请求）——与工具位 fail-closed 分位', () => {
    const { log, eventsOf } = makeEventsOf();
    log.append('sandbox/mode', { mode: 'MEGA' }); // 持久层坏行形
    const warns: string[] = [];
    const source = createSandboxDisclosureSource({
      boot: 'workspace-write',
      eventsOf,
      warn: (message) => warns.push(message),
    });
    // 披露位降级语义：不抛——请求照发，沙箱行省略（单次调用单笔 warn——
    // 每请求重算形，坏词持续在场则持续 warn，测试锁单调用语义）
    let result: string | undefined;
    expect(() => {
      result = source('s-disc');
    }).not.toThrow();
    expect(result).toBeUndefined();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('SANDBOX_MODE_INVALID');
  });
});
