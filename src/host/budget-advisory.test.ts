import { describe, expect, it } from 'vitest';
import { budgetAdvisoryMessage } from './budget-advisory.js';
import type { BackgroundBudgetUsage } from '../llm/index.js';

/* ---------------- 预算预警文案铸造（04 §5 软着陆层——遗漏审计批 H） ---------------- */

/** 投影工厂（spent/limit 定值——ratio 派生自实参形） */
const usageOf = (spent: number, limit: number): BackgroundBudgetUsage => ({
  spent,
  limit,
  ratio: spent / limit,
});

describe('budgetAdvisoryMessage（root/subagent 分族 + 预算帽下活判据）', () => {
  it('root 族（origin trigger——headless 主循环）：三档递进收敛文案', () => {
    const notice = budgetAdvisoryMessage(usageOf(700, 1000), 'trigger');
    expect(notice).toContain('[预算提示 NOTICE]');
    expect(notice).toContain('70%');
    expect(notice).toContain('700/1000 tokens');
    expect(notice).toContain('收敛探索面');
    const urgent = budgetAdvisoryMessage(usageOf(850, 1000), 'trigger');
    expect(urgent).toContain('[预算预警 URGENT]');
    expect(urgent).toContain('停止开启新的工作腿');
    const critical = budgetAdvisoryMessage(usageOf(950, 1000), 'trigger');
    expect(critical).toContain('[预算临界 CRITICAL]');
    // CRITICAL 档指令「收尾：陈述当前结论与未竟项」而非续开新腿（04 §5 原文）
    expect(critical).toContain('请立即收尾：陈述当前结论与未竟项');
  });

  it('subagent 族（origin delegation——委派子代理）：三档任务面收敛 + CRITICAL 汇报归路', () => {
    const notice = budgetAdvisoryMessage(usageOf(700, 1000), 'delegation');
    expect(notice).toContain('[预算提示 NOTICE]');
    expect(notice).toContain('收敛本任务范围');
    const critical = budgetAdvisoryMessage(usageOf(950, 1000), 'delegation');
    expect(critical).toContain('[预算临界 CRITICAL]');
    // subagent 档 wrap-up 面向单任务执行者：汇报归路（父会话据此结算）
    expect(critical).toContain('汇报当前结论与未竟项');
    expect(critical).toContain('父会话将据此结算');
  });

  it('未达 notice 线零注入（< 70% null）——档位判定单源在 llm 件', () => {
    expect(budgetAdvisoryMessage(usageOf(0, 1000), 'trigger')).toBeNull();
    expect(budgetAdvisoryMessage(usageOf(699, 1000), 'delegation')).toBeNull();
  });

  it('前台 origin 恒 null（无池可警）：conversation/import/fork + 不在册（undefined）', () => {
    for (const origin of ['conversation', 'import', 'fork'] as const) {
      expect(budgetAdvisoryMessage(usageOf(950, 1000), origin)).toBeNull();
    }
    // 不在册会话（dismantle 后 listActive 无行）同零注入
    expect(budgetAdvisoryMessage(usageOf(950, 1000), undefined)).toBeNull();
  });

  it('百分比渲染四舍五入（文案显示位非账面值）', () => {
    // 712/1000 = 71.2% → 71；666/940 ≈ 70.85% → 71（notice 档内取整显示）
    expect(budgetAdvisoryMessage(usageOf(712, 1000), 'trigger')).toContain('71%');
    expect(budgetAdvisoryMessage(usageOf(666, 940), 'trigger')).toContain('71%');
  });
});
