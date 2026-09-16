/**
 * schedule 串词法/校验/推刻测试（04 §12 调度条——schedule 四形五写）。
 *
 * 回归锁条款：daily@09:30 词法（初版组内交替优先级 bug——`([01]\d|2[0-3]:[0-5]\d)`
 * 组内 `[01]\d` 单独满足后 `:` 失配，合法串永不匹配；修复=时间整组捕获+TIME_RE
 * 复验——本锁修复前必红）；错过不重放（next 严格晚于 now）；once 语义三态；
 * DST 边界与回拨形（TZ seam——美东时区自证锚防假绿，落值断言一律 ISO UTC）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

/**
 * DST 边界与回拨形（TZ seam）。daily/weekly 按本地时区解释（schedule.ts 头注
 * 语义钉③），其落值形此前只有无 DST 时区（CI=UTC / 本地=Asia/Shanghai）下
 * 的前跳形——DST 切换日的「不存在本地时刻 / 双现时刻」与墙钟回拨形零覆盖。
 *
 * seam 机制：Node/V8 跟踪 process.env.TZ 变更并即时重读时区（macOS/Linux 实
 * 测生效；本 describe 用前先设 America/New_York、afterEach 精确还原原值——
 * 同文件他 describe 不受污染）。自证锚用例先行：seam 不生效（运行环境无视
 * TZ 变更）则锚先红，防后续 DST 断言在错误时区下假绿。落值断言一律 ISO UTC
 * 绝对值（语义钉③「存储/比较一律 ISO UTC」）。
 */
describe('DST 边界与回拨形（TZ seam——America/New_York）', () => {
  /** 进 describe 前的 TZ 原值（精确还原——原值缺席则删除键） */
  const prevTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'America/New_York';
  });

  afterEach(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it('自证锚：TZ seam 生效（EST=UTC-5 / EDT=UTC-4 两偏移各验一发）', () => {
    // 2026-03-08 06:00Z = 本地 01:00 EST（前拨切换 07:00Z 之前）；盛夏 04:00Z
    // = 本地 00:00 EDT——seam 失效（时区仍为运行环境原值）则两锚必红
    expect(new Date('2026-03-08T06:00:00Z').getHours()).toBe(1);
    expect(new Date('2026-07-01T04:00:00Z').getHours()).toBe(0);
  });

  it('春季前拨日 daily@02:30：本地时刻不存在——落值取切换前偏移（推进形 03:30 EDT）', () => {
    // 2026-03-08（周日）02:00 EST → 03:00 EDT——本地 02:30 不存在；now =
    // 06:00Z（本地 01:00 EST）。setHours 前拨间隙时刻按 ES 规范取切换前偏移
    // （EST=UTC-5）解释 → 07:30Z（本地呈现为 03:30 EDT——推进形非跳日）
    const next = nextFireAt({ kind: 'daily', time: '02:30' }, new Date('2026-03-08T06:00:00Z'));
    expect(next).toBe('2026-03-08T07:30:00.000Z');
  });

  it('秋季回拨日 daily@01:30：双现时刻取切换前偏移（不回跳）；双现全过后落明日 EST 形', () => {
    // 2026-11-01（周日）02:00 EDT → 01:00 EST——本地 01:30 当日出现两次
    // （01:30 EDT=05:30Z / 01:30 EST=06:30Z）。now=05:00Z（本地 01:00 EDT）：
    // 候选取 01:30 双现按切换前偏移（EDT=UTC-4）→ 05:30Z，仍严格未来取今日
    const first = nextFireAt({ kind: 'daily', time: '01:30' }, new Date('2026-11-01T05:00:00Z'));
    expect(first).toBe('2026-11-01T05:30:00.000Z');
    expect(Date.parse(first ?? '')).toBeGreaterThan(Date.parse('2026-11-01T05:00:00Z'));
    // 双现全过后（now=07:00Z = 本地 02:00 EST）：今日 01:30 已过 → 明日 01:30
    // EST（UTC-5）= 06:30Z——next 恒严格未来，不因回拨日回跳
    const second = nextFireAt({ kind: 'daily', time: '01:30' }, new Date('2026-11-01T07:00:00Z'));
    expect(second).toBe('2026-11-02T06:30:00.000Z');
    expect(Date.parse(second ?? '')).toBeGreaterThan(Date.parse('2026-11-01T07:00:00Z'));
  });

  it('weekly 跨 DST：候选日恰逢前拨周日——不存在本地时刻与 daily 同律（推进形）', () => {
    // 2026-03-01 12:00Z = 本地周日 07:00 EST；weekly@sun@02:30 今日已过 →
    // 下周日恰为 2026-03-08 前拨日——本地 02:30 不存在，落值同 daily 律
    const next = nextFireAt({ kind: 'weekly', days: [0], time: '02:30' }, new Date('2026-03-01T12:00:00Z'));
    expect(next).toBe('2026-03-08T07:30:00.000Z');
  });

  it('every 回拨形：锚在未来（回拨窗）next 恒锚起算——时钟再回拨不前移不重触', () => {
    // 锚 06:30Z、now 回拨至 06:00Z（墙钟回拨窗 = 锚超前形）：next = 锚+间隔
    const anchor = new Date('2026-03-08T06:30:00Z');
    const schedule: Schedule = { kind: 'every', seconds: 600 };
    const first = nextFireAt(schedule, new Date('2026-03-08T06:00:00Z'), anchor);
    expect(first).toBe('2026-03-08T06:40:00.000Z');
    // 时钟再回拨 10m：next 不随回拨前移（锚起算不变——已 fire 行不重触、
    // 下一刻不提前）——与「every：锚在未来（超前锚）按锚起算」例互证
    const again = nextFireAt(schedule, new Date('2026-03-08T05:50:00Z'), anchor);
    expect(again).toBe('2026-03-08T06:40:00.000Z');
  });
});
