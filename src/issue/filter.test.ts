/**
 * issue 配置归一 schedule 前缀粗校验回归锁（第四役 F2——真语法对齐）。
 *
 * 真语法真源 = src/scheduler/schedule.ts parseSchedule 词法：every:<n>[smh]
 * （**冒号形**）/ once@+<n>[smh] / once@<ISO> / daily@HH:MM /
 * weekly@<days>@HH:MM（**@ 形**）。修前 SCHEDULE_PREFIX_RE =
 * /^(every:|daily:|weekly:|once:)/ 与报错文案教错路——仿现文案写
 * daily:09:00 → 粗校过 → service.start() 的 registerPollJob 精校抛
 * SCHEDULER_SCHEDULE_INVALID → catch 只 warn → 轮询行零登记静默死
 * （fail-loud 破口）；反向 once@/daily@/weekly@ 三真形反被粗校拒。
 * 修后：伪形在粗校位即拒（mount 配置期响亮拒——不流到精校 catch 吞位）。
 */
import { describe, expect, it } from 'vitest';

import { normalizeIssueConfig } from './filter.js';

describe('schedule 前缀粗校验（真语法对齐——every 冒号形 / once·daily·weekly @ 形）', () => {
  it('四真形装载绿：粗校放行透传（精校归 scheduler parseSchedule 守卫）', () => {
    const reals = ['every:120s', 'once@+30m', 'once@2026-09-15T09:00:00Z', 'daily@09:00', 'weekly@mon,fri@09:00'];
    for (const schedule of reals) {
      const r = normalizeIssueConfig({ repos: ['o/r'], schedule });
      expect(r.ok, `真形被拒：${schedule}`).toBe(true);
      if (r.ok) expect(r.config.schedule).toBe(schedule);
    }
  });

  it('伪形（冒号形 daily:/weekly:/once: 与 @ 形 every@）装载红——粗校位即拒不静默', () => {
    const pseudos = ['daily:09:00', 'weekly:mon@09:00', 'once:+30m', 'every@120s'];
    for (const schedule of pseudos) {
      const r = normalizeIssueConfig({ repos: ['o/r'], schedule });
      expect(r.ok === false, `伪形被放行：${schedule}`).toBe(true);
      if (!r.ok) expect(r.message).toContain('schedule 坏形');
    }
  });

  it('报错文案指对路：教 daily@HH:MM 等 @ 形，不再教 daily: 冒号形', () => {
    const r = normalizeIssueConfig({ repos: ['o/r'], schedule: 'daily:09:00' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // 对路 = 真语法全形列举（与 schedule.ts parseSchedule 报错文案同源）
      expect(r.message).toContain('every:');
      expect(r.message).toContain('once@');
      expect(r.message).toContain('daily@HH:MM');
      expect(r.message).toContain('weekly@');
      // 修前文案「every:/daily:/weekly:/once: 前缀四形」教冒号形——不得复现
      expect(r.message).not.toMatch(/daily:\//);
    }
  });
});
