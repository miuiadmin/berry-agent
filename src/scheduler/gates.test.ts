/**
 * DiscoveryGates 序定闸评估测试（04 §12——first-failing-wins；缺席事实=放行）。
 */
import { describe, expect, it } from 'vitest';
import { evaluateGates, GATE_ORDER, JOB_COOLDOWN_MS, USER_QUIET_WINDOW_MS, type GateFacts } from './gates.js';

const NOW = '2026-09-07T08:00:00.000Z';
const NOW_MS = Date.parse(NOW);

describe('序与放行', () => {
  it('GATE_ORDER 五门序定（job_disabled 最先、daily_budget 殿后）', () => {
    expect([...GATE_ORDER]).toEqual(['job_disabled', 'agent_busy', 'recent_user_msg', 'cooldown', 'daily_budget']);
  });

  it('空事实全门放行（缺席=放行——fail-open 属实）', () => {
    expect(evaluateGates({}, { now: NOW })).toBeNull();
  });

  it('正面事实全过也放行（canAfford 真/无近期消息/无近期触发）', () => {
    const facts: GateFacts = {
      enabled: true,
      agentBusy: false,
      lastUserMessageAt: new Date(NOW_MS - USER_QUIET_WINDOW_MS - 1).toISOString(),
      lastFireAt: new Date(NOW_MS - JOB_COOLDOWN_MS - 1).toISOString(),
      canAfford: true,
    };
    expect(evaluateGates(facts, { now: NOW })).toBeNull();
  });
});

describe('五门各自拦截', () => {
  it('job_disabled：行关即拦（首位）', () => {
    const block = evaluateGates({ enabled: false, agentBusy: true }, { now: NOW });
    expect(block?.gate).toBe('job_disabled'); // 先拦先报——不报 agent_busy
  });

  it('agent_busy：前台在飞拦', () => {
    const block = evaluateGates(
      { agentBusy: true, lastUserMessageAt: new Date(NOW_MS - 1000).toISOString() },
      { now: NOW },
    );
    expect(block?.gate).toBe('agent_busy');
  });

  it('recent_user_msg：静默窗内用户消息拦；窗外放行', () => {
    const facts: GateFacts = { lastUserMessageAt: new Date(NOW_MS - 60_000).toISOString() };
    expect(evaluateGates(facts, { now: NOW })?.gate).toBe('recent_user_msg');
    const outside: GateFacts = {
      lastUserMessageAt: new Date(NOW_MS - USER_QUIET_WINDOW_MS - 1).toISOString(),
    };
    expect(evaluateGates(outside, { now: NOW })).toBeNull();
  });

  it('cooldown：同任务冷却窗内拦', () => {
    const block = evaluateGates({ lastFireAt: new Date(NOW_MS - JOB_COOLDOWN_MS + 1000).toISOString() }, { now: NOW });
    expect(block?.gate).toBe('cooldown');
  });

  it('daily_budget：canAfford 假拦（殿后）', () => {
    const block = evaluateGates(
      {
        lastUserMessageAt: new Date(NOW_MS - USER_QUIET_WINDOW_MS - 1).toISOString(),
        lastFireAt: new Date(NOW_MS - JOB_COOLDOWN_MS - 1).toISOString(),
        canAfford: false,
      },
      { now: NOW },
    );
    expect(block?.gate).toBe('daily_budget');
  });

  it('拦截块载人读 reason', () => {
    const block = evaluateGates({ enabled: false }, { now: NOW });
    expect(block?.reason).toContain('停用');
  });
});
