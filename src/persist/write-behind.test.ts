/**
 * write-behind 测试——批落链编舞（05 篇 §6.3）。
 *
 * 注入缝：WriteTarget 假目标（记录调用序列 + 可编程失败面）+ sleep 记录器
 * + 假钟。断言的是编舞（批帽/合批/退避/熔断/毒丸分类/切断/屏障），不是
 * SQLite 行为（那是 store.test.ts 的真库职责）——中间层 mock 合法位。
 */
import { describe, expect, it } from 'vitest';
import { BaseError, type SessionEvent } from '../contracts/index.js';
import { SessionLog } from '../session/index.js';
import type { EventWrite, IncidentEntry, SessionRegistration, WriteTarget } from './store.js';
import { WriteBehind, type WriteBehindOptions } from './write-behind.js';

const REG: SessionRegistration = {
  origin: 'conversation',
  parentId: undefined,
  seedLength: 0,
  workspaceRoot: undefined,
  title: undefined,
};

/** 造真事件（信封形状由 SessionLog 结构保证——测试只改故事不改形状） */
function makeEvents(sessionId: string, ...specs: string[]): readonly SessionEvent[] {
  const log = new SessionLog({ sessionId });
  for (const text of specs) {
    log.append('turn/start', {});
    log.append('user/message', { content: text, source: 'user' });
  }
  return log.events();
}

/** SQLite 约束违例形（结构化判别的稳定契约 = code 字符串前缀） */
function constraintError(): Error {
  const err = new Error('UNIQUE constraint failed: events.session_id, events.seq');
  (err as Error & { code: string }).code = 'SQLITE_CONSTRAINT_PRIMARYKEY';
  return err;
}

/** 瞬态错形（非约束——走退避重试路） */
function transientError(): Error {
  const err = new Error('database is locked');
  (err as Error & { code: string }).code = 'SQLITE_BUSY';
  return err;
}

/** 假写入目标：记录调用序列 + 可编程失败面（按测试意图覆写两个 impl） */
class FakeTarget implements WriteTarget {
  /** 调用序列（op + 批尺寸/条目 seq——编舞断言的主证据） */
  readonly calls: {
    op: 'batch' | 'single' | 'dropped' | 'incident';
    sessionId?: string;
    seq?: number;
    size?: number;
  }[] = [];
  /** 成功写入的条目（按落库序） */
  readonly written: EventWrite[] = [];
  /** 毒丸记账面 */
  readonly dropped: { sessionId: string; seq: number }[] = [];
  /** durable 标记面 */
  readonly incidents: IncidentEntry[] = [];
  /** 批写失败编程面（每调用取一个脚本项：Error = 抛、undefined = 成功） */
  batchScript: (Error | undefined)[] = [];
  /** 行写失败编程面（同上——按条目 seq 索引判定也可在外部覆写整体） */
  singleFailsOn: (write: EventWrite) => Error | undefined = () => undefined;

  writeEvents(writes: readonly EventWrite[]): void {
    this.calls.push({ op: 'batch', size: writes.length });
    const scripted = this.batchScript.shift();
    if (scripted) throw scripted;
    this.written.push(...writes);
  }

  writeEventSingle(write: EventWrite): void {
    this.calls.push({ op: 'single', sessionId: write.sessionId, seq: write.event.seq });
    const fail = this.singleFailsOn(write);
    if (fail) throw fail;
    this.written.push(write);
  }

  accountDropped(sessionId: string, seq: number): void {
    this.calls.push({ op: 'dropped', sessionId, seq });
    this.dropped.push({ sessionId, seq });
  }

  recordIncident(entry: IncidentEntry): void {
    this.calls.push({ op: 'incident', sessionId: entry.sessionId, seq: entry.seq });
    this.incidents.push(entry);
  }
}

/** 断言抛指定码 */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable('未拒绝');
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
  }
}

/** 造 WriteBehind（缺省即时 sleep——不真等墙钟） */
function makeChain(target: WriteTarget, options: Partial<WriteBehindOptions> = {}) {
  const sleeps: number[] = [];
  const warns: string[] = [];
  const fatals: BaseError[] = [];
  const chain = new WriteBehind({
    target,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    warn: (m) => warns.push(m),
    clock: () => 42,
    onFatal: (err) => fatals.push(err),
    ...options,
  });
  return { chain, sleeps, warns, fatals };
}

function writesFor(sessionId: string, events: readonly SessionEvent[]): EventWrite[] {
  return events.map((event) => ({ sessionId, event, registration: REG }));
}

describe('批编舞（微任务节流 + 批帽）', () => {
  it('同 tick 连续 enqueue 合一批——append 热路径零 I/O（enqueue 返回时未写）', async () => {
    const target = new FakeTarget();
    const { chain } = makeChain(target);
    for (const write of writesFor('s1', makeEvents('s1', 'a', 'b', 'c'))) chain.enqueue(write);
    // enqueue 返回点：无任何写调用（微任务未点火——热路径零 I/O）
    expect(target.calls).toHaveLength(0);
    expect(chain.pending).toBe(6);
    await chain.flush();
    // 一批收尽（同 tick 六条合批——不是六次单条事务）
    expect(target.calls).toEqual([{ op: 'batch', size: 6 }]);
    expect(target.written).toHaveLength(6);
    expect(chain.pending).toBe(0);
  });

  it('批帽：单批不超 maxBatchSize（10 条帽 4 → 4+4+2）', async () => {
    const target = new FakeTarget();
    const { chain } = makeChain(target, { maxBatchSize: 4 });
    for (const write of writesFor('s1', makeEvents('s1', 'a', 'b', 'c', 'd', 'e'))) chain.enqueue(write);
    await chain.flush();
    expect(target.calls.map((c) => (c.op === 'batch' ? c.size : -1))).toEqual([4, 4, 2]);
  });

  it('跨 tick 的 enqueue 各自成批（节流单位 = tick）', async () => {
    const target = new FakeTarget();
    const { chain } = makeChain(target);
    const events = makeEvents('s1', 'a', 'b');
    for (const write of writesFor('s1', events.slice(0, 2))) chain.enqueue(write);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    for (const write of writesFor('s1', events.slice(2))) chain.enqueue(write);
    await chain.flush();
    expect(target.calls).toEqual([
      { op: 'batch', size: 2 },
      { op: 'batch', size: 2 },
    ]);
  });
});

describe('批级失败退避与熔断', () => {
  it('瞬态错退避重试（指数退避 50→100）成功后全量落库，计数清零', async () => {
    const target = new FakeTarget();
    target.batchScript = [transientError(), transientError()];
    const { chain, sleeps } = makeChain(target);
    const writes = writesFor('s1', makeEvents('s1', 'a'));
    for (const write of writes) chain.enqueue(write);
    await chain.flush();
    expect(sleeps).toEqual([50, 100]);
    expect(target.written).toHaveLength(writes.length);
    // 再写一批（连续失败计数已清零——不累祸）
    target.batchScript = [];
    for (const write of writesFor('s1', makeEvents('s1', 'b'))) chain.enqueue(write);
    await chain.flush();
    expect(target.written).toHaveLength(writes.length + 2);
    expect(sleeps).toEqual([50, 100]);
  });

  it('重试耗尽 3 次 → onFatal(PERSIST_WRITE_EXHAUSTED) + 熔断拒写 + flush 拒屏障', async () => {
    const target = new FakeTarget();
    const always = [transientError(), transientError(), transientError(), transientError(), transientError()];
    target.batchScript = [...always];
    const { chain, fatals } = makeChain(target);
    chain.enqueue(...(writesFor('s1', makeEvents('s1', 'a')) as [EventWrite]));
    await chain.flush().catch(() => undefined); // 屏障失败吸收（下面单独断言）
    expect(fatals).toHaveLength(1);
    expect(fatals[0]!.code).toBe('PERSIST_WRITE_EXHAUSTED');
    // 熔断后 enqueue 诚实拒写 / flush 拒屏障
    expectCode(() => chain.enqueue(writesFor('s1', makeEvents('s1', 'x'))[0]!), 'PERSIST_WRITE_EXHAUSTED');
    await expect(chain.flush()).rejects.toMatchObject({ code: 'PERSIST_WRITE_EXHAUSTED' });
  });
});

describe('毒丸分类（约束违例 = 确定性失败）', () => {
  it('批内毒丸：翻行模式逐行定位——毒条隔离不重试、余条照常落库', async () => {
    const target = new FakeTarget();
    const events = makeEvents('s1', 'a', 'b'); // seq 0..3
    const writes = writesFor('s1', events);
    // 批写遇约束（批里有毒）→ 行模式下毒条 = seq 2
    target.batchScript = [constraintError()];
    target.singleFailsOn = (write) => (write.event.seq === 2 ? constraintError() : undefined);
    const { chain, warns } = makeChain(target);
    for (const write of writes) chain.enqueue(write);
    await chain.flush(); // 毒丸不视为屏障失败
    // 编舞：先批（整批回滚）→ 逐行 0,1,2(毒)；seq 3 同会话已被切断——静默丢（无行写调用）
    expect(target.calls[0]).toEqual({ op: 'batch', size: 4 });
    const singles = target.calls.slice(1).filter((c) => c.op === 'single');
    expect(singles.map((c) => c.seq)).toEqual([0, 1, 2]);
    // 落库 = 0,1（毒条 2 隔离 + 洞后 3 一并停写——seq 连续律推论）
    expect(target.written.map((w) => w.event.seq)).toEqual([0, 1]);
    // 毒条终态三件：accountDropped + recordIncident + severed
    expect(target.dropped).toEqual([{ sessionId: 's1', seq: 2 }]);
    expect(target.incidents).toHaveLength(1);
    expect(target.incidents[0]!.reason).toContain('毒丸');
    expect(target.incidents[0]!.sessionId).toBe('s1');
    expect(chain.severedSessions).toEqual(['s1']);
    expect(warns.join('\n')).toContain('毒丸隔离');
  });

  it('切断会话：后续事件静默丢弃（一笔 incident 概括，不逐条刷账）', async () => {
    const target = new FakeTarget();
    const events = makeEvents('s1', 'a'); // seq 0,1
    target.batchScript = [constraintError()];
    target.singleFailsOn = (write) => (write.event.seq === 1 ? constraintError() : undefined);
    const { chain } = makeChain(target);
    for (const write of writesFor('s1', events)) chain.enqueue(write);
    await chain.flush();
    expect(chain.severedSessions).toEqual(['s1']);
    // 切断后再 enqueue：同会话静默丢（flush 后无落库无新账），他session 照常
    const later = [
      ...writesFor('s1', [{ ...events[0]!, seq: 5, time: 50, data: { content: 'post-sever', source: 'user' } }]),
      ...writesFor('s2', [{ ...events[0]!, time: 51 }]),
    ];
    for (const write of later) chain.enqueue(write);
    await chain.flush();
    expect(target.written.filter((w) => w.sessionId === 's1')).toHaveLength(1); // 只有毒丸前的 seq 0
    expect(target.written.filter((w) => w.sessionId === 's2')).toHaveLength(1);
    expect(target.incidents).toHaveLength(1); // 不逐条刷账
  });

  it('行模式复位：队列清空后恢复批模式', async () => {
    const target = new FakeTarget();
    const events = makeEvents('s1', 'a');
    target.batchScript = [constraintError()];
    target.singleFailsOn = (write) => (write.event.seq === 1 ? constraintError() : undefined);
    const { chain } = makeChain(target);
    for (const write of writesFor('s1', events)) chain.enqueue(write);
    await chain.flush();
    // 第二轮：全新一批（另一会话）——应走批模式而非延续行模式
    target.batchScript = [];
    target.singleFailsOn = () => undefined;
    for (const write of writesFor('s2', makeEvents('s2', 'x', 'y'))) chain.enqueue(write);
    await chain.flush();
    const after = target.calls.slice(target.calls.findIndex((c) => c.op === 'incident') + 1);
    expect(after).toEqual([{ op: 'batch', size: 4 }]);
  });

  it('行模式下的瞬态错：条目回队首退避，不误判毒丸', async () => {
    const target = new FakeTarget();
    const events = makeEvents('s1', 'a'); // seq 0,1
    target.batchScript = [constraintError()];
    let transientFired = false;
    target.singleFailsOn = (write) => {
      if (write.event.seq === 1 && !transientFired) {
        transientFired = true;
        return transientError(); // 毒位本身先报瞬态错——应退避重试而非隔离
      }
      return undefined;
    };
    const { chain, sleeps } = makeChain(target);
    for (const write of writesFor('s1', events)) chain.enqueue(write);
    await chain.flush();
    expect(sleeps).toEqual([50]);
    expect(target.written.map((w) => w.event.seq)).toEqual([0, 1]);
    expect(chain.severedSessions).toEqual([]);
    expect(target.incidents).toHaveLength(0);
  });
});

describe('flush 屏障', () => {
  it('退避等待中的 flush：屏障等重试成功后才返回（屏障后崩溃 = 已落库）', async () => {
    const target = new FakeTarget();
    target.batchScript = [transientError()];
    const { chain } = makeChain(target);
    for (const write of writesFor('s1', makeEvents('s1', 'a'))) chain.enqueue(write);
    await chain.flush();
    expect(target.written).toHaveLength(2);
  });

  it('空队列 flush 即返（无在飞任务不点火空批）', async () => {
    const target = new FakeTarget();
    const { chain } = makeChain(target);
    await chain.flush();
    expect(target.calls).toHaveLength(0);
  });

  it('enqueue 竞速 drain 收尾（finally 补射）无漏项', async () => {
    const target = new FakeTarget();
    const { chain } = makeChain(target);
    const events = makeEvents('s1', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');
    const writes = writesFor('s1', events);
    // 微任务点火前的批量入队 + 点火后（在飞间隙）再补——补射覆盖
    for (const write of writes.slice(0, 4)) chain.enqueue(write);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    for (const write of writes.slice(4)) chain.enqueue(write);
    await chain.flush();
    expect(target.written).toHaveLength(writes.length);
  });
});
