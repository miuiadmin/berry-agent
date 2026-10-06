/**
 * host/compact-cmd 纯逻辑测试（B2 批 2——回执五档逐字锁 + 指引参归一 +
 * 会话解析序 + busy 执法 + 事实件补读；B2R——完成尾强制重画腿；程序常量
 * 非 AI 文本，逐字断言即锁）。
 */
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../contracts/index.js';
import type { ManualOutcome } from '../compaction/index.js';
import type { SessionLog } from '../session/index.js';
import {
  COMPACT_USAGE,
  compactOutcomeText,
  lastCompactionEndFactsOf,
  runCompactCommand,
  type CompactCommandDeps,
} from './compact-cmd.js';

/** 事件速构（seq 单调——只测载荷采数不涉骨架） */
const endEvent = (seq: number, data: Record<string, unknown>): SessionEvent =>
  ({ type: 'compaction/end', seq, data }) as unknown as SessionEvent;

/* ---------------- 回执五档（07 定形注一字不差） ---------------- */

describe('compactOutcomeText 回执五档', () => {
  it('compacted：N 数字位（facts.occludedMessages）', () => {
    expect(compactOutcomeText('compacted', { occludedMessages: 12 })).toBe('✓ 已压缩：12 条早期对话已整理为摘要');
  });

  it('compacted 数字缺席防御形：无数字句仍成立', () => {
    expect(compactOutcomeText('compacted')).toBe('✓ 已压缩：早期对话已整理为摘要');
    expect(compactOutcomeText('compacted', {})).toBe('✓ 已压缩：早期对话已整理为摘要');
  });

  it('nothing 薄会话档', () => {
    expect(compactOutcomeText('nothing')).toBe('本会话还很短，无需压缩——继续对话即可');
  });

  it('failed 三段式：原因句中段 + 尾句重试指路', () => {
    expect(compactOutcomeText('failed', { error: '模型通道超时' })).toBe('压缩失败：模型通道超时。稍后可重试 /compact');
  });

  it('failed 原因缺席兜底句（通道缺席形无 end 事件）', () => {
    expect(compactOutcomeText('failed')).toBe('压缩失败：摘要通道不可用。稍后可重试 /compact');
  });

  it('failed 原因整形：多行折叠单句 + ANSI 剥除 + 超帽截断', () => {
    expect(compactOutcomeText('failed', { error: '第一行\n\t第二行  有空白' })).toBe(
      '压缩失败：第一行 第二行 有空白。稍后可重试 /compact',
    );
    expect(compactOutcomeText('failed', { error: `\x1b[31m红文本\x1b[0m` })).toBe(
      '压缩失败：红文本。稍后可重试 /compact',
    );
    // 超帽截断保头（错误码族恒在头部）
    const long = compactOutcomeText('failed', { error: 'x'.repeat(200) });
    expect(long).toBe(`压缩失败：${'x'.repeat(160)}…。稍后可重试 /compact`);
  });

  it('queued busy 排队档 / pending 防重入档', () => {
    expect(compactOutcomeText('queued')).toBe('已排队：当前回复结束后自动压缩');
    expect(compactOutcomeText('pending')).toBe('已有压缩在进行或排队中');
  });
});

/* ---------------- 事实件补读 lastCompactionEndFactsOf ---------------- */

describe('lastCompactionEndFactsOf 末条 end 载荷采数', () => {
  it('倒扫取末条：completed 采数字位', () => {
    const events = [
      endEvent(3, { reason: 'completed', occludedMessages: 4, occludedChars: 287 }),
      endEvent(9, { reason: 'completed', occludedMessages: 8, occludedChars: 590 }),
    ];
    expect(lastCompactionEndFactsOf(events)).toEqual({ occludedMessages: 8 });
  });

  it('failed 采原因位', () => {
    expect(lastCompactionEndFactsOf([endEvent(5, { reason: 'failed', error: '上游 503' })])).toEqual({
      error: '上游 503',
    });
  });

  it('陈化护栏：末条 completed 位不被 failed 档误采为原因（通道缺席形 failed 无新 end）', () => {
    // 通道缺席 → compactNow 返 failed 且无 end 写入；倒扫命中旧 completed 位
    // → 只出数字位，failed 档消费 facts.error 缺席 → 兜底句（不误呈旧数字）
    const facts = lastCompactionEndFactsOf([endEvent(5, { reason: 'completed', occludedMessages: 4 })]);
    expect(facts).toEqual({ occludedMessages: 4 });
    expect(compactOutcomeText('failed', facts)).toBe('压缩失败：摘要通道不可用。稍后可重试 /compact');
  });

  it('vetoed 他路终态不采 + 无 end 事件 undefined + 坏形防御', () => {
    expect(lastCompactionEndFactsOf([endEvent(5, { reason: 'vetoed' })])).toBeUndefined();
    expect(lastCompactionEndFactsOf([])).toBeUndefined();
    // reason 对而载荷型坏：防御性空事实件（不抛）
    expect(lastCompactionEndFactsOf([endEvent(5, { reason: 'completed', occludedMessages: 'x' })])).toEqual({});
  });
});

/* ---------------- 命令腿 runCompactCommand ---------------- */

/** 装配速构（compactNow 替身捕获入参——busy/instructions 执法断言面） */
function rigDeps(over: {
  /** null = 会话不在场（logOf 返 undefined）；缺省 = 替身日志 */
  readonly log?: SessionLog | null;
  readonly busy?: boolean;
  /** null = 焦点空悬；缺省 = 固定焦点会话 */
  readonly focused?: string | null;
  readonly outcome?: ManualOutcome;
  /** true = 注入 repaint 探针（完成尾强制重画腿断言面；缺省不注入——兼测缺席形） */
  readonly repaint?: boolean;
}): { deps: CompactCommandDeps; calls: Array<{ instructions?: string; busy?: boolean }>; repainted: string[] } {
  const calls: Array<{ instructions?: string; busy?: boolean }> = [];
  const repainted: string[] = [];
  // 缺省替身日志：空事件面（compacted/failed 档补读走防御缺席形——数字位
  // 缺席回执仍成立，正锁防御腿）
  const defaultLog = { events: () => [] as readonly SessionEvent[] } as unknown as SessionLog;
  const deps: CompactCommandDeps = {
    logOf: () => (over.log === null ? undefined : (over.log ?? defaultLog)),
    busyOf: () => over.busy ?? false,
    focusedId: () => (over.focused === null ? null : (over.focused ?? 'sess-aaaaaaaaaa')),
    compactNow: async (_log, options) => {
      calls.push({ ...options });
      return over.outcome ?? 'compacted';
    },
    ...(over.repaint ? { repaint: (sessionId: string) => void repainted.push(sessionId) } : {}),
  };
  return { deps, calls, repainted };
}

describe('runCompactCommand 命令腿', () => {
  it('无焦点（锚缺席 + focusedId null）：诚实拒 + 用法行', async () => {
    const { deps } = rigDeps({ focused: null });
    const out = await runCompactCommand([], undefined, deps);
    expect(out.ok).toBe(false);
    expect(out.text).toBe(`无焦点会话可压缩（无参形 = 焦点会话——当前焦点空悬且无命令锚会话）。\n${COMPACT_USAGE}`);
  });

  it('会话不在场：SESSION_NOT_FOUND fail-loud 回执', async () => {
    const { deps } = rigDeps({ log: null });
    const out = await runCompactCommand([], 'sess-not-there', deps);
    expect(out.ok).toBe(false);
    expect(out.text).toContain('SESSION_NOT_FOUND');
  });

  it('恰零参合法：instructions 缺席形透传 + busy 位随参', async () => {
    const { deps, calls } = rigDeps({ busy: false, outcome: 'nothing' });
    const out = await runCompactCommand([], 'sess-aaaaaaaaaa', deps);
    expect(out).toEqual({ ok: true, text: '本会话还很短，无需压缩——继续对话即可' });
    expect(calls).toEqual([{ busy: false }]); // 无 instructions 键——缺席非空串
  });

  it('compacted 补读防御腿：替身日志无 end 事件 → 无数字形回执仍成立', async () => {
    const { deps } = rigDeps({ outcome: 'compacted' });
    const out = await runCompactCommand([], 'sess-aaaaaaaaaa', deps);
    expect(out).toEqual({ ok: true, text: '✓ 已压缩：早期对话已整理为摘要' });
  });

  it('指引尾参全文 join 复原（引号形空格无损）+ busy=true 排队形', async () => {
    const { deps, calls } = rigDeps({ busy: true, outcome: 'queued' });
    const out = await runCompactCommand(['侧重', '文件路径与', '错误码'], 'sess-aaaaaaaaaa', deps);
    expect(out).toEqual({ ok: true, text: '已排队：当前回复结束后自动压缩' });
    expect(calls).toEqual([{ busy: true, instructions: '侧重 文件路径与 错误码' }]);
  });

  it('trim 后空白指引视为缺席（空白串不透传）', async () => {
    const { deps, calls } = rigDeps({ outcome: 'pending' });
    const out = await runCompactCommand(['   ', '\t'], 'sess-aaaaaaaaaa', deps);
    expect(out).toEqual({ ok: true, text: '已有压缩在进行或排队中' });
    expect(calls).toEqual([{ busy: false }]);
  });

  it('锚会话优先于 focusedId（命令锚 = dispatch 注入位）', async () => {
    const seen: string[] = [];
    const deps: CompactCommandDeps = {
      logOf: (id) => {
        seen.push(id);
        return { events: () => [] } as unknown as SessionLog;
      },
      busyOf: () => false,
      focusedId: () => 'sess-focusedxxxxx',
      compactNow: async () => 'compacted',
    };
    await runCompactCommand([], 'sess-anchoredxxxx', deps);
    expect(seen).toEqual(['sess-anchoredxxxx']);
  });
});

/* ---------------- 完成尾强制重画（07 B2 定形注挂账销账——B2R） ---------------- */

describe('runCompactCommand 完成尾强制重画腿', () => {
  it('成功档触发：compacted 尾调 repaint（sessionId = 已解析的本会话变量——无锚走 focusedId）', async () => {
    const { deps, repainted } = rigDeps({ outcome: 'compacted', repaint: true });
    const out = await runCompactCommand([], undefined, deps);
    expect(out.ok).toBe(true);
    expect(repainted).toEqual(['sess-aaaaaaaaaa']);
  });

  it('他档不触发：queued/pending/nothing/failed 投影未变或兑现腿另行', async () => {
    for (const outcome of ['queued', 'pending', 'nothing', 'failed'] as const) {
      const { deps, repainted } = rigDeps({ outcome, repaint: true });
      await runCompactCommand([], 'sess-aaaaaaaaaa', deps);
      expect(repainted).toEqual([]);
    }
  });

  it('repaint 缺席不炸（可选注入——装配缺席形保既有消费零改）', async () => {
    const { deps } = rigDeps({ outcome: 'compacted' }); // 未注入 repaint
    const out = await runCompactCommand([], 'sess-aaaaaaaaaa', deps);
    expect(out).toEqual({ ok: true, text: '✓ 已压缩：早期对话已整理为摘要' });
  });
});
