/**
 * 危险工具闸测试（04 §13 四要素全谱——真文件系统 tmp 目录，零网络）：
 * - canonicalJson 规范化（键字典序/无空白/undefined 跳过/数组保序）；
 * - normalizeDangerMandate 缺省填充与坏形拒（空帽即坏形律）；
 * - targets 保序即身份（同集异序 = 漂移即死——哈希面承载）；
 * - 闸序 0-6 各拒径：链 tamper 三形（改行/坏 JSON/删行）、HALT 三形（在场/
 *   内容损坏/stat 不可达）+ latch 首笔保持、consent 缺席/过期/漂移/坏文件、
 *   值域（action 闭集 + target 精确与 glob）、日帽（allow-failed 不计 +
 *   UTC 翻日 now 注入）；
 * - verdict 三值记账 + seq/prevHash/recordHash 链形手工重算；
 * - 并发互斥（maxPerDay=1 双 deliver 恰一过——串行段回归锁）；
 * - approve 三律（缺省 30 天/坏 ttlDays 拒/他 consumer 保留）；
 * - status 各态（链坏 cap.used=null、HALT 删后 latch 痕迹独立呈现）；
 * - dangerTargetMatches vs repoMatchesGlob 对拍矩阵（词面独立律漂移锁——
 *   webui/security 对拍同款先例）。
 */
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { repoMatchesGlob } from '../issue/index.js';
import {
  canonicalJson,
  createDangerGate,
  dangerTargetMatches,
  DANGER_CONSENT_FILE,
  DANGER_GENESIS_HASH,
  DANGER_HALT_FILE,
  DANGER_HALT_LATCH_FILE,
  DANGER_LEDGER_FILE,
  normalizeDangerMandate,
  type DangerGate,
  type DangerLedgerRecord,
} from './danger.js';

/** 可注入挂钟（翻日/过期测试的时基面） */
function makeClock(startMs = Date.UTC(2026, 8, 9, 12, 0, 0)): { now: () => number; advance: (ms: number) => void } {
  let t = startMs;
  return { now: () => t, advance: (ms) => (t += ms) };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-danger-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 组闸（缺省 targets ['o/r'] 帽 10——逐测试覆写） */
function makeGate(opts?: {
  targets?: string[];
  actions?: readonly string[];
  maxPerDay?: number;
  now?: () => number;
  warn?: (m: string) => void;
}): DangerGate {
  return createDangerGate({
    consumerId: 'test:consumer',
    mandate: {
      actions: opts?.actions ?? ['push', 'create-pr'],
      targets: opts?.targets ?? ['o/r'],
      maxPerDay: opts?.maxPerDay ?? 10,
    },
    dataDir: dir,
    now: opts?.now,
    warn: opts?.warn ?? (() => undefined),
  });
}

/** 读账本文件全行（解析形） */
async function readLedger(): Promise<DangerLedgerRecord[]> {
  const text = await readFile(join(dir, DANGER_LEDGER_FILE), 'utf8');
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as DangerLedgerRecord);
}

/** 期拒码（BaseError 携 DANGER_ 族码上抛断言） */
async function expectDeny(p: Promise<unknown>, code: string): Promise<BaseError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    const e = err as BaseError;
    expect(e.code).toBe(code);
    return e;
  }
  throw new Error(`期望拒 ${code}——实际放行`);
}

describe('canonicalJson（规范化哈希底座）', () => {
  it('键递归字典序 + 无空白', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it('undefined 键跳过（缺席即不在身份里）', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson(undefined)).toBe('null');
  });
  it('数组保序（元素序是值的一部分）', () => {
    expect(canonicalJson(['x', 'y'])).not.toBe(canonicalJson(['y', 'x']));
    expect(canonicalJson(['x', 'y'])).toBe('["x","y"]');
  });
  it('标量经 JSON.stringify', () => {
    expect(canonicalJson('s')).toBe('"s"');
    expect(canonicalJson(3)).toBe('3');
    expect(canonicalJson(null)).toBe('null');
  });
});

describe('normalizeDangerMandate（缺省填充 + 坏形拒）', () => {
  it('缺省填充：actions v1 闭集 + maxPerDay 10；targets 保序不重排', () => {
    const r = normalizeDangerMandate({ targets: ['b/y', 'a/x'] });
    expect(r).toEqual({
      ok: true,
      mandate: { actions: ['push', 'create-pr'], targets: ['b/y', 'a/x'], maxPerDay: 10 },
    });
  });
  it('actions 坏形三则：非数组/空数组/越闭集', () => {
    expect(normalizeDangerMandate({ targets: ['o/r'], actions: 'push' }).ok).toBe(false);
    expect(normalizeDangerMandate({ targets: ['o/r'], actions: [] }).ok).toBe(false);
    expect(normalizeDangerMandate({ targets: ['o/r'], actions: ['deploy'] }).ok).toBe(false);
  });
  it('targets 坏形三则：缺席/空数组/空串元素', () => {
    expect(normalizeDangerMandate({}).ok).toBe(false);
    expect(normalizeDangerMandate({ targets: [] }).ok).toBe(false);
    expect(normalizeDangerMandate({ targets: [''] }).ok).toBe(false);
  });
  it('maxPerDay 空帽即坏形（0 拒——彻底关停走 HALT 或撤 consent）', () => {
    const r = normalizeDangerMandate({ targets: ['o/r'], maxPerDay: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('HALT');
  });
  it('maxPerDay 值域界：1 与 100000 过、100001 拒、小数拒', () => {
    expect(normalizeDangerMandate({ targets: ['o/r'], maxPerDay: 1 }).ok).toBe(true);
    expect(normalizeDangerMandate({ targets: ['o/r'], maxPerDay: 100_000 }).ok).toBe(true);
    expect(normalizeDangerMandate({ targets: ['o/r'], maxPerDay: 100_001 }).ok).toBe(false);
    expect(normalizeDangerMandate({ targets: ['o/r'], maxPerDay: 1.5 }).ok).toBe(false);
  });
});

describe('targets 保序即身份（同集异序 = 漂移即死）', () => {
  it('序不同 → mandateHash 不同', () => {
    const a = makeGate({ targets: ['o/r', 'p/q'] });
    const b = makeGate({ targets: ['p/q', 'o/r'] });
    expect(a.mandateHash).not.toBe(b.mandateHash);
  });
  it('序不同 → approve 后互换即漂移拒（DANGER_CONSENT_INVALID）', async () => {
    const a = makeGate({ targets: ['o/r', 'p/q'] });
    const b = makeGate({ targets: ['p/q', 'o/r'] });
    await a.approve();
    await expectDeny(
      b.runGuarded({ action: 'push', target: 'o/r' }, async () => 'x'),
      'DANGER_CONSENT_INVALID',
    );
  });
});

describe('闸序 3：consent 三查', () => {
  it('缺席 = fail-closed 缺省（闸落地零配置零行为变化）——零外联', async () => {
    const gate = makeGate();
    let executed = 0;
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => (executed += 1)),
      'DANGER_CONSENT_ABSENT',
    );
    expect(executed).toBe(0); // 先查后执行——拒径 execute 不被调用
    const ledger = await readLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ verdict: 'deny', code: 'DANGER_CONSENT_ABSENT', action: 'push', target: 'o/r' });
  });

  it('approve 后放行 + allow-succeeded 记账', async () => {
    const gate = makeGate();
    await gate.approve();
    const out = await gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 'done');
    expect(out).toBe('done');
    const ledger = await readLedger();
    expect(ledger.at(-1)).toMatchObject({ verdict: 'allow-succeeded', seq: 1 }); // 首笔即 allow（approve 先行——无拒前史）
  });

  it('过期即死（不自动续、不静默宽限——now 注入推进）', async () => {
    const clock = makeClock();
    const gate = makeGate({ now: clock.now });
    await gate.approve(1); // 1 天
    clock.advance(2 * 86_400_000);
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 'x'),
      'DANGER_CONSENT_INVALID',
    );
    const s = await gate.status();
    expect(s.consent.state).toBe('expired');
  });

  it('consent 文件坏 JSON / 本条目坏形 → 按缺席（fail-closed 向 + warn）', async () => {
    const warns: string[] = [];
    const gate = makeGate({ warn: (m) => warns.push(m) });
    await gate.approve();
    await writeFile(join(dir, DANGER_CONSENT_FILE), '{oops', 'utf8');
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 'x'),
      'DANGER_CONSENT_ABSENT',
    );
    expect(warns.length).toBeGreaterThan(0);
    // 条目坏形路（approvedAt 串形）：好 JSON 坏条目
    await writeFile(
      join(dir, DANGER_CONSENT_FILE),
      JSON.stringify({ consumers: { 'test:consumer': { mandateHash: 'h', approvedAt: 'x', expiresAt: 1 } } }),
      'utf8',
    );
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 'x'),
      'DANGER_CONSENT_ABSENT',
    );
  });
});

describe('闸序 1：HALT 哨兵（kill switch 最优先呈报）', () => {
  it('在场即全拒 + latch 落盘首笔保持（不自动删）', async () => {
    const clock = makeClock();
    const gate = makeGate({ now: clock.now });
    await gate.approve();
    await writeFile(join(dir, DANGER_HALT_FILE), '', 'utf8');
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 'x'),
      'DANGER_HALTED',
    );
    const latch1 = JSON.parse(await readFile(join(dir, DANGER_HALT_LATCH_FILE), 'utf8')) as { firstFiredAt: string };
    // 二次拒不重写首笔（观测位语义）——时钟推进后再拒，firstFiredAt 不动
    clock.advance(3_600_000);
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 'x'),
      'DANGER_HALTED',
    );
    const latch2 = JSON.parse(await readFile(join(dir, DANGER_HALT_LATCH_FILE), 'utf8')) as { firstFiredAt: string };
    expect(latch2.firstFiredAt).toBe(latch1.firstFiredAt);
    // 删 HALT 即恢复；latch 痕迹独立呈现（status 仍见「曾拦过」）
    await rm(join(dir, DANGER_HALT_FILE));
    const out = await gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 'ok');
    expect(out).toBe('ok');
    const s = await gate.status();
    expect(s.halt.tripped).toBe(false);
    expect(s.halt.firstFiredAt).toBe(latch1.firstFiredAt);
  });

  it('内容损坏仍 tripped（存在性判、内容不解析）', async () => {
    const gate = makeGate();
    await gate.approve();
    await writeFile(join(dir, DANGER_HALT_FILE), '不是 JSON 也不影响', 'utf8');
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 'x'),
      'DANGER_HALTED',
    );
  });

  it('stat 不可达按在场（halt 路径 symlink 入不可读目录——EACCES 非 ENOENT）', async () => {
    const hidden = join(dir, 'hidden');
    await mkdir(hidden);
    await writeFile(join(hidden, 'f'), '', 'utf8');
    await chmod(hidden, 0o000);
    await symlink(join(hidden, 'f'), join(dir, DANGER_HALT_FILE));
    const gate = makeGate();
    await gate.approve();
    try {
      await expectDeny(
        gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 'x'),
        'DANGER_HALTED',
      );
    } finally {
      await chmod(hidden, 0o755); // 还权——afterEach rm 可清
    }
  });
});

describe('闸序 0：账本链健康（前置不变式）', () => {
  it('改历史行 → 哈希传播破坏 → DANGER_LEDGER_CORRUPT 拒续写', async () => {
    const gate = makeGate();
    await gate.approve();
    await gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 1);
    await gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 2);
    // 篡改第 2 行的 target 位
    const text = await readFile(join(dir, DANGER_LEDGER_FILE), 'utf8');
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    const row = JSON.parse(lines[1]!) as DangerLedgerRecord;
    lines[1] = JSON.stringify({ ...row, target: 'evil/r' }); // readonly 经副本绕（测试改写位）
    await writeFile(join(dir, DANGER_LEDGER_FILE), `${lines.join('\n')}\n`, 'utf8');
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 3),
      'DANGER_LEDGER_CORRUPT',
    );
    // status 诚实呈现：链坏 + cap 不可派生
    const s = await gate.status();
    expect(s.ledger.healthy).toBe(false);
    expect(s.cap.used).toBeNull();
  });

  it('坏 JSON 行 / 删历史行 两形同拒', async () => {
    const gate = makeGate();
    await gate.approve();
    await gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 1);
    await gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 2); // 两笔在链（删行腿的前提）
    // 坏 JSON：截断尾行
    const text = await readFile(join(dir, DANGER_LEDGER_FILE), 'utf8');
    await writeFile(join(dir, DANGER_LEDGER_FILE), `${text.slice(0, -5)}`, 'utf8');
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 3),
      'DANGER_LEDGER_CORRUPT',
    );
    // 删行：还原后删首笔（余行 seq=2 与期望 seq=1 错位——seq/prevHash 双红）
    await writeFile(join(dir, DANGER_LEDGER_FILE), `${text}`, 'utf8'); // 还原
    const lines = (await readFile(join(dir, DANGER_LEDGER_FILE), 'utf8')).split('\n').filter((l) => l.trim() !== '');
    await writeFile(join(dir, DANGER_LEDGER_FILE), `${lines.slice(1).join('\n')}\n`, 'utf8');
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 4),
      'DANGER_LEDGER_CORRUPT',
    );
  });
});

describe('闸序 4：值域（action 闭集 + target 匹配）', () => {
  it('action 越闭集拒（DANGER_TARGET_DENIED）', async () => {
    const gate = makeGate();
    await gate.approve();
    await expectDeny(
      gate.runGuarded({ action: 'comment', target: 'o/r' }, async () => 'x'),
      'DANGER_TARGET_DENIED',
    );
  });
  it('actions 子集授权（只授 push——create-pr 拒）', async () => {
    const gate = makeGate({ actions: ['push'] });
    await gate.approve();
    await gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 1);
    await expectDeny(
      gate.runGuarded({ action: 'create-pr', target: 'o/r' }, async () => 2),
      'DANGER_TARGET_DENIED',
    );
  });
  it('target 精确不匹配拒 / glob 段级通配命中', async () => {
    const gate = makeGate({ targets: ['o/*', 'p/q'] });
    await gate.approve();
    await gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 1); // glob 命中
    await gate.runGuarded({ action: 'push', target: 'p/q' }, async () => 2); // 精确命中
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'x/r' }, async () => 3),
      'DANGER_TARGET_DENIED',
    );
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'o/a/b' }, async () => 4),
      'DANGER_TARGET_DENIED',
    ); // * 不越段
  });
});

describe('闸序 5：日帽（账本派生无第二状态）', () => {
  it('满帽拒（used >= maxPerDay——DANGER_CAP_EXCEEDED）', async () => {
    const gate = makeGate({ maxPerDay: 1 });
    await gate.approve();
    await gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 1);
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 2),
      'DANGER_CAP_EXCEEDED',
    );
    const s = await gate.status();
    expect(s.cap).toMatchObject({ used: 1, max: 1 });
  });

  it('execute 抛 = allow-failed 记账 + 原错误直传 + 失败不计帽（防烧帽与虚计数两向失真）', async () => {
    const gate = makeGate({ maxPerDay: 1 });
    await gate.approve();
    await expect(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => {
        throw new Error('git push 失败');
      }),
    ).rejects.toThrow('git push 失败');
    const ledger = await readLedger();
    expect(ledger.at(-1)).toMatchObject({ verdict: 'allow-failed' });
    // 失败不计帽：次日（同日）再试成功仍可过
    const out = await gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 'recovered');
    expect(out).toBe('recovered');
  });

  it('UTC 翻日恢复（now 注入跨 UTC 日界）', async () => {
    const clock = makeClock(Date.UTC(2026, 8, 9, 23, 59, 0));
    const gate = makeGate({ maxPerDay: 1, now: clock.now });
    await gate.approve();
    await gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 1);
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 2),
      'DANGER_CAP_EXCEEDED',
    );
    clock.advance(2 * 60_000); // 跨 UTC 日界（23:59 → 次日 00:01）
    await gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 3); // 次日新帽
    const s = await gate.status();
    expect(s.cap.used).toBe(1);
    expect(s.cap.day).toBe('2026-09-10');
  });
});

describe('verdict 三值与链形（手工重算 recordHash）', () => {
  it('deny/allow-failed/allow-succeeded 三值全记 + seq/prevHash/recordHash 全链', async () => {
    const clock = makeClock();
    const gate = makeGate({ maxPerDay: 5, now: clock.now });
    // deny（consent 缺席）
    await expectDeny(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => 'x'),
      'DANGER_CONSENT_ABSENT',
    );
    await gate.approve();
    // allow-failed
    await expect(
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // allow-succeeded
    await gate.runGuarded({ action: 'push', target: 'o/r', detail: 'branch=issue-7' }, async () => 'v');
    const records = await readLedger();
    expect(records.map((r) => r.verdict)).toEqual(['deny', 'allow-failed', 'allow-succeeded']);
    expect(records.map((r) => r.code)).toEqual(['DANGER_CONSENT_ABSENT', undefined, undefined]);
    // 链形手工重算：recordHash = SHA-256(`${seq}|${prevHash}|${canonicalJson(payload)}`)
    let prev = DANGER_GENESIS_HASH;
    records.forEach((r, i) => {
      expect(r.seq).toBe(i + 1);
      expect(r.prevHash).toBe(prev);
      const payload = {
        at: r.at,
        consumer: r.consumer,
        action: r.action,
        target: r.target,
        verdict: r.verdict,
        ...(r.code !== undefined ? { code: r.code } : {}),
        ...(r.detail !== undefined ? { detail: r.detail } : {}),
      };
      const expectHash = createHash('sha256')
        .update(`${r.seq}|${prev}|${canonicalJson(payload)}`, 'utf8')
        .digest('hex');
      expect(r.recordHash).toBe(expectHash);
      expect(r.consumer).toBe('test:consumer');
      prev = r.recordHash;
    });
  });
});

describe('并发互斥（串行段回归锁——防并发双过步 5）', () => {
  it('maxPerDay=1 双并发 deliver：恰一过一拒（DANGER_CAP_EXCEEDED）', async () => {
    const gate = makeGate({ maxPerDay: 1 });
    await gate.approve();
    let executed = 0;
    const results = await Promise.allSettled([
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => (executed += 1)),
      gate.runGuarded({ action: 'push', target: 'o/r' }, async () => (executed += 1) * 10),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BaseError);
    expect(((rejected[0] as PromiseRejectedResult).reason as BaseError).code).toBe('DANGER_CAP_EXCEEDED');
    // 拒的一腿零外联
    expect(executed).toBe(1);
  });
});

describe('approve 三律（人面唯写）', () => {
  it('缺省 30 天（expiresAt - approvedAt = 30 * 86400000）', async () => {
    const gate = makeGate();
    const r = await gate.approve();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expiresAt - r.approvedAt).toBe(30 * 86_400_000);
  });
  it('坏 ttlDays 拒（0/负/小数/越 3650 上界）', async () => {
    const gate = makeGate();
    for (const bad of [0, -1, 1.5, 3651]) {
      const r = await gate.approve(bad);
      expect(r.ok).toBe(false);
    }
    const ok = await gate.approve(3650);
    expect(ok.ok).toBe(true); // 上界含
  });
  it('他 consumer 条目保留（map 形——签发只覆写本条目）', async () => {
    const gate = makeGate();
    await writeFile(
      join(dir, DANGER_CONSENT_FILE),
      JSON.stringify({ consumers: { 'other:x': { mandateHash: 'h0', approvedAt: 1, expiresAt: 2 } } }),
      'utf8',
    );
    await gate.approve(7);
    const file = JSON.parse(await readFile(join(dir, DANGER_CONSENT_FILE), 'utf8')) as {
      consumers: Record<string, { mandateHash: string }>;
    };
    expect(file.consumers['other:x']).toMatchObject({ mandateHash: 'h0' }); // 保留
    expect(file.consumers['test:consumer']).toMatchObject({ mandateHash: gate.mandateHash }); // 本条目绑活体哈希
  });
});

describe('status 五呈各态', () => {
  it('新闸：consent absent / HALT 不在场 / 帽 0 / 链健康 0 笔', async () => {
    const s = await makeGate().status();
    expect(s).toMatchObject({
      consumer: 'test:consumer',
      consent: { state: 'absent' },
      halt: { tripped: false },
      cap: { used: 0, max: 10 },
      ledger: { healthy: true, total: 0 },
    });
    expect(s.mandate).toEqual({ actions: ['push', 'create-pr'], targets: ['o/r'], maxPerDay: 10 });
    expect(s.mandateHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('approve 后 valid（ISO 双呈）', async () => {
    const gate = makeGate();
    await gate.approve();
    const s = await gate.status();
    expect(s.consent.state).toBe('valid');
    expect(s.consent.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(s.consent.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('对拍：dangerTargetMatches vs repoMatchesGlob（词面独立律漂移锁）', () => {
  it('矩阵同值（精确/glob 段级/正则元字符/多段全形）', () => {
    const pairs: readonly [string, string][] = [
      ['o/r', 'o/r'],
      ['o/r', 'p/q'],
      ['o/*', 'o/r'],
      ['o/*', 'o/a'],
      ['o/*', 'x/r'],
      ['o/*', 'o/a/b'], // * 不越段
      ['*/r', 'o/r'],
      ['*/*', 'o/r'],
      ['*/*', 'anything/goes'],
      ['o/.r', 'o/.r'], // 点字面（正则元字符须转义）
      ['o/.r', 'o/Xr'],
      ['o/a+b', 'o/a+b'], // 加号字面
      ['o/r', 'o/r2'],
    ];
    for (const [pattern, target] of pairs) {
      expect(dangerTargetMatches(target, pattern)).toBe(repoMatchesGlob(pattern, target));
    }
  });
});
