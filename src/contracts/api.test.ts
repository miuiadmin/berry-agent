/**
 * contracts/api 门检裁决器测试（批 U2 开门机器——03 §4.6 用户主权开门制）。
 *
 * 锁三面：①高危面名单单源派生不变式（目录标注 ↔ 派生面零漂移）；②门检
 * 裁决三分支（开门/默认关/非门面）；③v1 首批两枚在册定名（换装界面后端 +
 * 注册网页路由——定名回执锁，改名即红）。
 */
import { describe, expect, it } from 'vitest';

import { CAPABILITIES, USER_GRANTABLE_CAPABILITIES, adjudicateCapabilityDoor } from './api.js';

describe('USER_GRANTABLE_CAPABILITIES 单源派生', () => {
  it('派生面 = 目录 userGrantable 标注位精确投影（零漂移不变式）', () => {
    expect(USER_GRANTABLE_CAPABILITIES).toEqual(
      CAPABILITIES.filter((c) => c.userGrantable === true).map((c) => c.name),
    );
  });

  it('v1 首批三枚在册（channels.ui-backend + sdk.register-route + triggers.start-run——定名回执锁）', () => {
    expect(USER_GRANTABLE_CAPABILITIES).toContain('channels.ui-backend');
    expect(USER_GRANTABLE_CAPABILITIES).toContain('sdk.register-route');
    // 触发器面 C 批补第三枚（03 §4.6 两枚→三枚落码兑现）——承载方 host 装配根形
    expect(USER_GRANTABLE_CAPABILITIES).toContain('triggers.start-run');
    // 凭证代管件 c 批补第四枚（跨域读凭证——core:credentials 件 judged 面）
    expect(USER_GRANTABLE_CAPABILITIES).toContain('credentials.read-cross');
    // 环境感知件 e-2 观测腿补第五枚（跨树观测——host 装配根形同第三枚）
    expect(USER_GRANTABLE_CAPABILITIES).toContain('sessions.observe-cross');
  });

  it('目录条目名与提供方同域（core:/席位形件域前缀 = providedBy 件域；host 装配根形豁免）', () => {
    for (const entry of CAPABILITIES) {
      // host 装配根承载的宿主侧能力面：件域名系能力面域非模块席
      // （triggers.start-run 由 host 承载——03 §8.2 C 批落码定形第三形）
      if (entry.providedBy === 'host') continue;
      const domain = entry.providedBy.startsWith('core:') ? entry.providedBy.slice('core:'.length) : entry.providedBy;
      expect(entry.name.startsWith(`${domain}.`)).toBe(true);
    }
  });
});

describe('adjudicateCapabilityDoor 门检裁决', () => {
  it('开门在授予集内即过', () => {
    const opened = new Set(['channels.ui-backend']);
    expect(adjudicateCapabilityDoor(opened, 'channels.ui-backend')).toEqual({ ok: true });
  });

  it('高危面未授予 = door-closed（默认关正当拒绝——message 指路 opens 写法）', () => {
    const verdict = adjudicateCapabilityDoor(new Set(['sdk.register-route']), 'channels.ui-backend');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.kind).toBe('door-closed');
      expect(verdict.message).toContain('opens');
      expect(verdict.message).toContain('channels.ui-backend');
    }
  });

  it('授予集空（无 opens 行）= 一切高危面 door-closed', () => {
    for (const name of USER_GRANTABLE_CAPABILITIES) {
      const verdict = adjudicateCapabilityDoor(new Set(), name);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.kind).toBe('door-closed');
    }
  });

  it('非高危面能力名 = not-a-door（装配缺陷面——常规能力位不走开门制）', () => {
    const verdict = adjudicateCapabilityDoor(new Set(['channels.ui-backend']), 'channels.render');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.kind).toBe('not-a-door');
      expect(verdict.message).toContain('channels.render');
    }
  });

  it('完全未知名同落 not-a-door（名单在裁决核单源判）', () => {
    const verdict = adjudicateCapabilityDoor(new Set(), 'no-such-door');
    expect(verdict).toMatchObject({ ok: false, kind: 'not-a-door' });
  });
});
