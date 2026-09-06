/**
 * schedule 串的词法、校验与下次到点计算（04 §12 调度条——schedule 形落码面；
 * 词面承 pi-tick 三形 interval/daily/weekly + pilotdeck once/delay 补形）。
 *
 * 串形五写四形（once 有绝对/相对两写）：
 *   every:<n>[s|m|h]        间隔重复（n 正整数；总秒数下限 5s）
 *   once@+<n>[s|m|h]        一次性相对延迟（自建行时刻起）
 *   once@<ISO>              一次性绝对时刻
 *   daily@HH:MM             每日（本地时区 24h 制）
 *   weekly@<days>@HH:MM     每周（days = 逗号分隔 mon/tue/.../sun 全写或三写）
 *
 * 判据全纯函数：解析/校验/推 next-fire 三段零 IO 零时钟——时钟由调用方注入
 * （Date 形），测试确定性。语义钉死三条：
 *   ① once 触发后不再到点（next = null——行留表、list 可见、不再 due）；
 *   ② 错过不重放：next-fire 一律取「严格晚于 now 的下一刻」（宿主停机期的
 *      错过到点重启后直接跳下一刻——pi-tick/launchd/cron 同律）；
 *   ③ daily/weekly 按本地时区解释（用户面语义），存储/比较一律 ISO UTC。
 */
import { BaseError } from '../contracts/index.js';

/** schedule 四形判别联合（行内 canonical 存储形——JSON 序列化入 jobs 表） */
export type Schedule =
  | { kind: 'every'; seconds: number }
  | { kind: 'once'; at: string }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; days: number[]; time: string };

/** 间隔下限（秒）——进程内挂钟最小粒度（pi-tick macOS 后端同值 5s） */
export const MIN_INTERVAL_SECONDS = 5;

/** 周 day 数值（0=周日……6=周六——Date.getDay 同系，跨端无歧义） */
const DAY_NAMES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

/** HH:MM 24h 制词法（pi-tick TIME_REGEX 同形） */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** 时长因子：s=1 / m=60 / h=3600 */
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600 };

/** 相对时长段解析：`<n>[s|m|h]` → 秒数（违例返回 null——不猜不夹取） */
function parseDuration(text: string): number | null {
  const m = text.match(/^(\d+)([smh])$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = UNIT_SECONDS[m[2] ?? ''] ?? 0;
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n * unit;
}

/**
 * schedule 串 → canonical 形（词法/语义全验——坏串抛 SCHEDULER_SCHEDULE_INVALID，
 * message 载原因；GoalJobsFace register 的「响亮拒不炸装配」消费此 message）。
 */
export function parseSchedule(text: string): Schedule {
  const raw = text.trim();
  const every = raw.match(/^every:(\d+[smh])$/);
  if (every) {
    const seconds = parseDuration(every[1] ?? '');
    if (seconds === null) throw badSchedule(raw, 'every 时长段坏形');
    if (seconds < MIN_INTERVAL_SECONDS) {
      throw badSchedule(raw, `间隔下限 ${MIN_INTERVAL_SECONDS}s（得 ${seconds}s）`);
    }
    return { kind: 'every', seconds };
  }
  const onceRel = raw.match(/^once@\+(\d+[smh])$/);
  if (onceRel) {
    // 相对延迟的锚定时刻由建行方落 at（parse 只验词法——纯函数不触时钟）
    const seconds = parseDuration(onceRel[1] ?? '');
    if (seconds === null) throw badSchedule(raw, 'once 相对时长段坏形');
    return { kind: 'once', at: `+${seconds}` };
  }
  const onceAbs = raw.match(/^once@(.+)$/);
  if (onceAbs) {
    const at = onceAbs[1] ?? '';
    const t = Date.parse(at);
    if (Number.isNaN(t)) throw badSchedule(raw, 'once 绝对时刻非合法 ISO');
    return { kind: 'once', at: new Date(t).toISOString() };
  }
  const daily = raw.match(/^daily@(\d{2}:\d{2})$/);
  if (daily && TIME_RE.test(daily[1] ?? '')) {
    return { kind: 'daily', time: daily[1] ?? '' };
  }
  const weekly = raw.match(/^weekly@([a-z,]+)@(\d{2}:\d{2})$/);
  if (weekly && TIME_RE.test(weekly[2] ?? '')) {
    const days = parseDays(weekly[1] ?? '');
    if (!days) throw badSchedule(raw, 'weekly 星期段坏形');
    return { kind: 'weekly', days, time: weekly[2] ?? '' };
  }
  throw badSchedule(raw, '须为 every:<n>[smh] / once@+<n>[smh] / once@<ISO> / daily@HH:MM / weekly@<days>@HH:MM 之一');
}

/** 星期段解析：逗号分隔名 → 去重升序 day 数组（坏名返回 null） */
function parseDays(text: string): number[] | null {
  if (!/^[a-z,]+$/.test(text)) return null;
  const days = new Set<number>();
  for (const token of text.split(',')) {
    const d = DAY_NAMES[token ?? ''];
    if (d === undefined) return null;
    days.add(d);
  }
  return [...days].sort((a, b) => a - b);
}

/** 坏串抛手（message 前缀统一——含原串便于诊断） */
function badSchedule(raw: string, reason: string): BaseError {
  return new BaseError('SCHEDULER_SCHEDULE_INVALID', `schedule 串「${raw}」坏形：${reason}`);
}

/** canonical 形 → 人读串（/tick list 渲染与日志面；往返 parse(format(x)) 恒等） */
export function formatSchedule(s: Schedule): string {
  switch (s.kind) {
    case 'every':
      return `every:${formatSeconds(s.seconds)}`;
    case 'once':
      return `once@${s.at}`;
    case 'daily':
      return `daily@${s.time}`;
    case 'weekly':
      return `weekly@${s.days.map((d) => DAY_SHORT[d] ?? String(d)).join(',')}@${s.time}`;
  }
}

/** day 数值 → 三写名（formatSchedule weekly 段用） */
const DAY_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** 秒数 → 紧凑时长段（86400 内取最大单位整除形；不合整除回落秒形） */
function formatSeconds(total: number): string {
  if (total % 3600 === 0) return `${total / 3600}h`;
  if (total % 60 === 0) return `${total / 60}m`;
  return `${total}s`;
}

/** once 相对延迟形（at 以 '+' 开头）的锚定落值：base + 秒数 */
export function resolveRelativeOnce(s: Schedule, base: Date): Schedule {
  if (s.kind !== 'once' || !s.at.startsWith('+')) return s;
  const seconds = Number(s.at.slice(1));
  return { kind: 'once', at: new Date(base.getTime() + seconds * 1000).toISOString() };
}

/**
 * 下次到点（严格晚于 now 的下一刻；once 已过或相对未锚定 → null）。
 *
 * `anchor` 仅 every 形消费：上次触发时刻缺省（建行/重启补推进场景）时以
 * now 起算——「错过不重放」语义的落点（past 的 next 直接跳下一刻）。
 */
export function nextFireAt(s: Schedule, now: Date, anchor?: Date): string | null {
  switch (s.kind) {
    case 'every': {
      const base = anchor && anchor.getTime() < now.getTime() ? now : (anchor ?? now);
      return new Date(base.getTime() + s.seconds * 1000).toISOString();
    }
    case 'once': {
      if (s.at.startsWith('+')) return null; // 相对未锚定——建行方先过 resolveRelativeOnce
      const t = Date.parse(s.at);
      return t > now.getTime() ? new Date(t).toISOString() : null;
    }
    case 'daily':
      return nextDailyAt(now, s.time);
    case 'weekly':
      return nextWeeklyAt(now, s.days, s.time);
  }
}

/** 每日下一刻（本地时区；今日时刻已过取明日） */
function nextDailyAt(now: Date, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const cand = new Date(now);
  cand.setHours(h ?? 0, m ?? 0, 0, 0);
  if (cand.getTime() <= now.getTime()) cand.setDate(cand.getDate() + 1);
  return cand.toISOString();
}

/** 每周下一刻（候选日全算取最早严格未来；跨周自动落到下周同日） */
function nextWeeklyAt(now: Date, days: readonly number[], hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  let best: Date | null = null;
  for (const d of days) {
    const cand = new Date(now);
    cand.setHours(h ?? 0, m ?? 0, 0, 0);
    cand.setDate(cand.getDate() + ((d - now.getDay() + 7) % 7));
    if (cand.getTime() <= now.getTime()) cand.setDate(cand.getDate() + 7);
    if (best === null || cand.getTime() < best.getTime()) best = cand;
  }
  return best ? best.toISOString() : new Date(now).toISOString();
}
