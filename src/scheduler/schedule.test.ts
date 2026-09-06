/**
 * schedule 串词法/校验/推刻测试（04 §12 调度条——schedule 四形五写）。
 *
 * 回归锁条款：daily@09:30 词法（初版组内交替优先级 bug——`([01]\d|2[0-3]:[0-5]\d)`
 * 组内 `[01]\d` 单独满足后 `:` 失配，合法串永不匹配；修复=时间整组捕获+TIME_RE
 * 复验——本锁修复前必红）；错过不重放（next 严格晚于 now）；once 语义三态。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import {
  formatSchedule,
  MIN_INTERVAL_SECONDS,
  nextFireAt,
  parseSchedule,
  resolveRelativeOnce,
  type Schedule,
} from './schedule.js';

/** 固定时刻锚（2026-09-07T08:00:00Z 周一——本地时区断言统一在此基上推） */
const NOW = new Date('2026-09-07T08:00:00.000Z');

/** 断言坏串抛 SCHEDULER_SCHEDULE_INVALID */
function expectBad(text: string): void {
  try {
    parseSchedule(text);
    expect.unreachable(`「${text}」应判坏串`);
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe('SCHEDULER_SCHEDULE_INVALID');
  }
}

describe('四形五写解析', () => {
  it('every 三单位', () => {
    expect(parseSchedule('every:5s')).toEqual({ kind: 'every', seconds: 5 });
    expect(parseSchedule('every:10m')).toEqual({ kind: 'every', seconds: 600 });
    expect(parseSchedule('every:2h')).toEqual({ kind: 'every', seconds: 7200 });
  });

  it('every 下限 5s——低于拒', () => {
    expect(parseSchedule('every:5s')).toEqual({ kind: 'every', seconds: 5 });
    expectBad('every:4s');
    expectBad('every:0s');
  });

  it('once 相对形：parse 只验词法、at 存 +<秒>', () => {
    expect(parseSchedule('once@+30s')).toEqual({ kind: 'once', at: '+30' });
    expect(parseSchedule('once@+2h')).toEqual({ kind: 'once', at: '+7200' });
  });

  it('once 绝对形：ISO 化', () => {
    expect(parseSchedule('once@2026-12-25T00:00:00Z')).toEqual({
      kind: 'once',
      at: '2026-12-25T00:00:00.000Z',
    });
    expectBad('once@not-a-date');
  });

  it('daily@HH:MM 词法（回归锁：合法时分钟不因正则交替优先级失配）', () => {
    // 修复前必红：初版正则组内交替令 "daily@09:30" 永不匹配、坠落兜底坏串
    expect(parseSchedule('daily@09:30')).toEqual({ kind: 'daily', time: '09:30' });
    expect(parseSchedule('daily@23:59')).toEqual({ kind: 'daily', time: '23:59' });
    expect(parseSchedule('daily@00:00')).toEqual({ kind: 'daily', time: '00:00' });
    expectBad('daily@24:00');
    expectBad('daily@9:30');
    expectBad('daily@09:3');
  });

  it('weekly 星期段三写/全写/去重升序', () => {
    expect(parseSchedule('weekly@mon,fri@09:30')).toEqual({
      kind: 'weekly',
      days: [1, 5],
      time: '09:30',
    });
    expect(parseSchedule('weekly@sunday@00:00')).toEqual({ kind: 'weekly', days: [0], time: '00:00' });
    expect(parseSchedule('weekly@mon,mon,tue@08:00')).toEqual({
      kind: 'weekly',
      days: [1, 2],
      time: '08:00',
    });
    expectBad('weekly@monday-x@08:00');
    expectBad('weekly@ someday @08:00');
  });

  it('兜底：非四形坏串', () => {
    expectBad('');
    expectBad('every:5');
    expectBad('every:5x');
    expectBad('daily');
  });

  it('MIN_INTERVAL_SECONDS 暴露为常量', () => {
    expect(MIN_INTERVAL_SECONDS).toBe(5);
  });
});

describe('formatSchedule 往返', () => {
  it('parse(format(x)) 恒等（四形）', () => {
    const cases: Schedule[] = [
      { kind: 'every', seconds: 5 },
      { kind: 'every', seconds: 3600 },
      { kind: 'once', at: '2026-12-25T00:00:00.000Z' },
      { kind: 'daily', time: '09:30' },
      { kind: 'weekly', days: [0, 6], time: '10:00' },
    ];
    for (const s of cases) {
      expect(parseSchedule(formatSchedule(s))).toEqual(s);
    }
  });

  it('时长段紧凑形（h→m→s 取最大整除单位）', () => {
    expect(formatSchedule({ kind: 'every', seconds: 3600 })).toBe('every:1h');
    expect(formatSchedule({ kind: 'every', seconds: 600 })).toBe('every:10m');
    expect(formatSchedule({ kind: 'every', seconds: 5 })).toBe('every:5s');
  });
});

describe('resolveRelativeOnce 锚定', () => {
  it('+秒 → base+秒 绝对 ISO；非相对形原样返回', () => {
    expect(resolveRelativeOnce({ kind: 'once', at: '+90' }, NOW)).toEqual({
      kind: 'once',
      at: '2026-09-07T08:01:30.000Z',
    });
    const abs: Schedule = { kind: 'once', at: '2026-12-25T00:00:00.000Z' };
    expect(resolveRelativeOnce(abs, NOW)).toBe(abs);
    expect(resolveRelativeOnce({ kind: 'daily', time: '09:30' }, NOW)).toEqual({
      kind: 'daily',
      time: '09:30',
    });
  });
});

describe('nextFireAt 语义三钉', () => {
  it('every：next 一律严格晚于 now（错过不重放）', () => {
    // 建行锚在 1h 前、now 已过锚+间隔——取 now+间隔（不回放锚+间隔）
    const anchor = new Date(NOW.getTime() - 60 * 60_000);
    const next = nextFireAt({ kind: 'every', seconds: 600 }, NOW, anchor);
    expect(next).toBe(new Date(NOW.getTime() + 600_000).toISOString());
  });

  it('every：锚在未来（超前锚）按锚起算', () => {
    const anchor = new Date(NOW.getTime() + 1200_000);
    const next = nextFireAt({ kind: 'every', seconds: 600 }, NOW, anchor);
    expect(next).toBe(new Date(NOW.getTime() + 1800_000).toISOString());
  });

  it('once：未过返回刻值、已过 null、相对未锚定 null', () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    const past = new Date(NOW.getTime() - 60_000).toISOString();
    expect(nextFireAt({ kind: 'once', at: future }, NOW)).toBe(future);
    expect(nextFireAt({ kind: 'once', at: past }, NOW)).toBeNull();
    expect(nextFireAt({ kind: 'once', at: '+60' }, NOW)).toBeNull();
  });

  it('daily：本地时区今日未过取今日、已过取明日（严格未来）', () => {
    // 锚定本地 00:30（相对 UTC 08:00 的本地日界——跨时区一致断言用本地构造）
    const today = new Date(NOW);
    today.setHours(23, 30, 0, 0);
    const next = nextFireAt({ kind: 'daily', time: '23:30' }, NOW);
    expect(next).toBe(today.toISOString());
    expect(Date.parse(next ?? '')).toBeGreaterThan(NOW.getTime());
  });

  it('weekly：候选日全算取最早严格未来；当日时刻已过落下周同日', () => {
    // NOW 本地星期由运行环境定——用 NOW 本身的星期构造「今日已过时刻」锁下周跳
    const [h, m] = [String(NOW.getHours()).padStart(2, '0'), String(NOW.getMinutes()).padStart(2, '0')];
    const todayDow = NOW.getDay();
    const next = nextFireAt({ kind: 'weekly', days: [todayDow], time: `${h}:${m}` }, NOW);
    // 今日此刻（秒位 00）不严格晚于 NOW → 落下周（+7 日同分）
    const expect7d = new Date(NOW);
    expect7d.setSeconds(0, 0);
    expect7d.setDate(expect7d.getDate() + 7);
    expect(next).toBe(expect7d.toISOString());
  });

  it('weekly：多日候选取最早（昨日型日子落下周、明日型日子取明日）', () => {
    const tomorrowDow = (NOW.getDay() + 1) % 7;
    const yesterdayDow = (NOW.getDay() + 6) % 7;
    const next = nextFireAt({ kind: 'weekly', days: [yesterdayDow, tomorrowDow], time: '00:00' }, NOW);
    // 明日型候选必早于下周型候选——next 落明日 00:00
    const expectTomorrow = new Date(NOW);
    expectTomorrow.setHours(0, 0, 0, 0);
    expectTomorrow.setDate(expectTomorrow.getDate() + 1);
    expect(next).toBe(expectTomorrow.toISOString());
  });
});
