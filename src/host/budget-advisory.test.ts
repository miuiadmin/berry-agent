import { describe, expect, it } from 'vitest';
import { budgetAdvisoryMessage } from './budget-advisory.js';
import type { BackgroundBudgetUsage } from '../llm/index.js';

/* ---------------- 预算预警文案铸造（04 §5 软着陆层——遗漏审计批 H + 2026-09-13 修复批 run 级后台性） ---------------- */

/** 投影工厂（spent/limit 定值——ratio 派生自实参形） */
const usageOf = (spent: number, limit: number): BackgroundBudgetUsage => ({
  spent,
  limit,
  ratio: spent / limit,
});

describe('budgetAdvisoryMessage（root/subagent 分族 + 预算帽下活判据）', () => {
  it('root 族（origin trigger——headless 主循环）：三档递进收敛文案', () => {
    const notice = budgetAdvisoryMessage(usageOf(700, 1000), 'trigger', false);
    expect(notice).toContain('[预算提示 NOTICE]');
    expect(notice).toContain('70%');
    expect(notice).toContain('700/1000 tokens');
    expect(notice).toContain('收敛探索面');
    const urgent = budgetAdvisoryMessage(usageOf(850, 1000), 'trigger', false);
    expect(urgent).toContain('[预算预警 URGENT]');
    expect(urgent).toContain('停止开启新的工作腿');
    const critical = budgetAdvisoryMessage(usageOf(950, 1000), 'trigger', false);
    expect(critical).toContain('[预算临界 CRITICAL]');
    // CRITICAL 档指令「收尾：陈述当前结论与未竟项」而非续开新腿（04 §5 原文）
    expect(critical).toContain('请立即收尾：陈述当前结论与未竟项');
  });

  it('subagent 族（origin delegation——委派子代理）：三档任务面收敛 + CRITICAL 汇报归路', () => {
    const notice = budgetAdvisoryMessage(usageOf(700, 1000), 'delegation', false);
    expect(notice).toContain('[预算提示 NOTICE]');
    expect(notice).toContain('收敛本任务范围');
    const critical = budgetAdvisoryMessage(usageOf(950, 1000), 'delegation', false);
    expect(critical).toContain('[预算临界 CRITICAL]');
    // subagent 档 wrap-up 面向单任务执行者：汇报归路（父会话据此结算）
    expect(critical).toContain('汇报当前结论与未竟项');
    expect(critical).toContain('父会话将据此结算');
  });

  it('未达 notice 线零注入（< 70% null）——档位判定单源在 llm 件', () => {
    expect(budgetAdvisoryMessage(usageOf(0, 1000), 'trigger', false)).toBeNull();
    expect(budgetAdvisoryMessage(usageOf(699, 1000), 'delegation', false)).toBeNull();
  });

  it('前台 origin 恒 null（无池可警）：conversation/import/fork + 不在册（undefined）', () => {
    for (const origin of ['conversation', 'import', 'fork'] as const) {
      expect(budgetAdvisoryMessage(usageOf(950, 1000), origin, false)).toBeNull();
    }
    // 不在册会话（retire 后 listActive 无行）同零注入
    expect(budgetAdvisoryMessage(usageOf(950, 1000), undefined, false)).toBeNull();
  });

  it('run 级后台性判据（2026-09-13 修复批——修前红）：backgroundLane true → root 族；前台声明位缺省 false 恒 null', () => {
    // conversation 会话的后台道无头 run（tick 用户行/goal 挂钟行共用
    // runSession、run --background 入口）：声明位 true → root 族三档
    //（修复前 origin 判据恒 null——正文「后台道 run〔无头〕」族全漏）
    const notice = budgetAdvisoryMessage(usageOf(700, 1000), 'conversation', true);
    expect(notice).toContain('[预算提示 NOTICE]');
    expect(notice).toContain('收敛探索面'); // root 族文案（非 subagent）
    const critical = budgetAdvisoryMessage(usageOf(950, 1000), 'conversation', true);
    expect(critical).toContain('请立即收尾：陈述当前结论与未竟项');
    // goal 预算 run 经同声明位（conversation origin + 声明位——goal 前台轮
    // 不带声明位走下行 null 分支）
    expect(budgetAdvisoryMessage(usageOf(850, 1000), 'conversation', true)).toContain('[预算预警 URGENT]');
    // 声明位 false = 前台 run 恒 null（含 goal 前台轮——记 goal 件内预算
    // 非后台日池，无池可警）
    expect(budgetAdvisoryMessage(usageOf(950, 1000), 'conversation', false)).toBeNull();
    expect(budgetAdvisoryMessage(usageOf(950, 1000), undefined, true)).not.toBeNull(); // 不在册 + 声明位 → root（防御形：retire 后迟到请求）
  });

  it('百分比渲染四舍五入（文案显示位非账面值）', () => {
    // 712/1000 = 71.2% → 71；666/940 ≈ 70.85% → 71（notice 档内取整显示）
    expect(budgetAdvisoryMessage(usageOf(712, 1000), 'trigger', false)).toContain('71%');
    expect(budgetAdvisoryMessage(usageOf(666, 940), 'trigger', false)).toContain('71%');
  });
});
