/**
 * host/run-entry 组合根测试——`run` 单次执行全环（真盘真库 + faux provider +
 * PassThrough 出站对——mock 只停在模型层；批 20b）。
 *
 * 钉死面：输出三档（text 末条 assistant / json 终值单对象 / stream NDJSON
 * AgentEvent 直出）+ --no-delta 线面退订 + --ephemeral memory 形 + --max-turns
 * 到帽 truncated（turn_start 门控 interrupt——faux 对已中止 signal 确定性
 * aborted）+ 会话选取四形（--session missing 退 1 / --continue 同 cwd 续接 /
 * --fork 边界分叉 / 缺省新建）+ --output-last-message 原子写 + --background
 * llm/usage 落账（callId `run:<sid>:<seq>` 幂等身份 + priority background）+
 * tick 双形态（用户行 prompt/cwd/source='schedule' 落账；行缺席退 2；件缺席
 * 退 2；goal 挂钟行 wake 不落诚实零跑退 0、wake 落地续接 goal 会话 +
 * recordTurn 记账 durable 读回〔批 #99 上移驱动 settled 链〕）+ provider
 * unconfigured 产品级文案（07 §5）+ 退出码三态。
 *
 * 断言只对行为与结构位（禁断言 AI 生成文本——'ok'/'例行巡检' 等均为测试
 * 自造常量经 faux 脚本原样透传）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';
import Database from 'better-sqlite3';

import type { AgentEvent, SessionEvent } from '../contracts/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { fauxProvider } from '../llm/index.js';

import { assembleHostStack } from './assembly.js';
import type { RunFlags } from './cli.js';
import type { GoalFace, SchedulerFace } from './core-plugins.js';
import type { GoalService } from '../goal/index.js';
import { runRunEntry } from './run-entry.js';

/* ---------------- 测试基建 ---------------- */

/** 零用量 */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** 组装指定终态的 assistant 消息（faux 响应脚本用——pi-ai 面形状） */
function messageOf(stopReason: 'stop' | 'error' | 'aborted' = 'stop'): PiAssistantMessage {
  return {
    role: 'assistant',
    content: stopReason === 'stop' ? [{ type: 'text', text: 'ok' }] : [],
    usage: NO_USAGE,
    stopReason,
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 工具调用 assistant 消息（faux 响应脚本用——driver 同构收口） */
function toolCallOf(id: string, name: string, args: Record<string, unknown>): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: args }],
    usage: NO_USAGE,
    stopReason: 'toolUse',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 出站行账（PassThrough 聚帧成行——stdout/stderr 三档输出断言通道） */
class LineRig {
  readonly stream = new PassThrough();
  readonly lines: string[] = [];
  private pending = '';

  constructor() {
    this.stream.on('data', (chunk: Buffer) => {
      this.pending += chunk.toString('utf8');
      const parts = this.pending.split('\n');
      this.pending = parts.pop() ?? '';
      for (const line of parts) if (line.length > 0) this.lines.push(line);
    });
  }

  /** 全文（行拼接——contains 断言用） */
  get text(): string {
    return this.lines.join('\n');
  }
}

/** RunFlags 组装（缺省最小安全形——逐用例覆写） */
function runFlags(partial: Partial<RunFlags> = {}): RunFlags {
  return {
    noPlugins: false,
    debug: false,
    readOnly: false,
    background: false,
    noDelta: false,
    ephemeral: false,
    continueLatest: false,
    ...partial,
  };
}

/** 临时目录族（数据目录 × 工作区统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** 造临时目录（统一入清账） */
function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 单 run 测试装配（faux provider + 新鲜 dataDir/ws + 行账出站对） */
async function rigRun(opts: {
  message?: string;
  flags?: Partial<RunFlags>;
  cwd?: string;
  dataDir?: string;
  responses?: readonly PiAssistantMessage[];
  model?: string;
  /** env 面（缺省 {} 隔离——预算旋钮等 BERRY_AGENT_* 测试注入位） */
  env?: Record<string, string | undefined>;
}) {
  const faux = fauxProvider({ provider: 'faux-run', models: [{ id: 'm1' }] });
  faux.setResponses((opts.responses ?? [messageOf()]).map((msg) => () => msg));
  const out = new LineRig();
  const err = new LineRig();
  const dataDir = opts.dataDir ?? tmpDir('run-data-');
  const cwd = opts.cwd ?? tmpDir('run-ws-');
  const entry = runRunEntry({
    message: opts.message ?? '跑一下',
    flags: runFlags(opts.flags),
    cwd,
    ...(opts.flags?.ephemeral ? {} : { dataDir }), // ephemeral 形零落盘——不建数据目录
    providers: [faux.provider],
    model: opts.model ?? 'faux-run/m1',
    env: opts.env ?? {},
    stdout: out.stream,
    stderr: err.stream,
  });
  return { entry, out, err, dataDir, cwd, faux };
}

/** json 档终值解析（单行 NDJSON → 对象） */
function summaryOf(rig: LineRig): Record<string, unknown> {
  expect(rig.lines).toHaveLength(1);
  return JSON.parse(rig.lines[0]!) as Record<string, unknown>;
}

/** 种子装配（jobs/goal 等的落库通道——shutdown 即锁释放与 flush 屏障） */
async function seedAssembly(
  dataDir: string,
  opts: { responses?: readonly PiAssistantMessage[] } = {},
): Promise<{
  scheduler: SchedulerFace;
  goal: GoalFace | undefined;
  goalService: GoalService;
  createSession: (workspaceRoot: string) => string;
  submit: (sessionId: string, text: string) => Promise<unknown>;
  shutdown: () => Promise<void>;
}> {
  const faux = fauxProvider({ provider: 'faux-seed', models: [{ id: 'm1' }] });
  faux.setResponses((opts.responses ?? [messageOf()]).map((msg) => () => msg));
  // 全环服务捕获格（s 批——投影律下 write 动词测试通道；生产恒缺席）
  let goalServiceRef: GoalService | undefined;
  const assembly = await assembleHostStack({
    runtime: { dataDir },
    noPlugins: false,
    debug: false,
    version: 'test',
    providers: [faux.provider],
    model: 'faux-seed/m1',
    env: {},
    goalServiceSink: (service) => {
      goalServiceRef = service;
    },
  });
  if (!assembly.ok) throw new Error(`种子装配失败：${assembly.message}`);
  const scheduler = assembly.scope.tryGet<SchedulerFace>('scheduler');
  if (scheduler === undefined) throw new Error('种子装配：scheduler 件未装载');
  if (goalServiceRef === undefined) throw new Error('种子装配：goal 件未装载（全环服务未捕获）');
  return {
    scheduler,
    goal: assembly.scope.tryGet<GoalFace>('goal'),
    goalService: goalServiceRef,
    createSession: (workspaceRoot) => assembly.stack.manager.create({ workspaceRoot }).sessionId,
    submit: (sessionId, text) => {
      const promise = assembly.stack.submitText(sessionId, text);
      if (promise === undefined) throw new Error('种子提交无回执');
      return promise;
    },
    shutdown: () => assembly.runtime.shutdown(),
  };
}

/** goal 种子：建 durable 会话（首事件落行）→ 激活 goal（可选即弃） */
async function seedGoal(
  dataDir: string,
  opts: { cap?: number; abandon?: boolean } = {},
): Promise<{ readonly id: string; readonly sessionId: string }> {
  const ws = tmpDir('run-ws-');
  const seed = await seedAssembly(dataDir);
  const sessionId = seed.createSession(canonicalWorkspaceRoot(ws));
  await seed.submit(sessionId, '起个头'); // 首事件落行屏障——goal 绑定会话可回读
  const goal = await seed.goalService.activate({
    sessionId,
    objective: '写周报',
    schedule: 'daily@09:00',
    ...(opts.cap !== undefined ? { budgetMessagesCap: opts.cap } : {}),
  });
  if (opts.abandon) await seed.goalService.abandon(goal.id, '测试即弃');
  await seed.shutdown();
  return { id: goal.id, sessionId: goal.sessionId };
}

/** 落库读（run 收场后的 durable 断言通道——第三装配只读即拆） */
async function readDurable(
  dataDir: string,
  sessionId: string,
): Promise<{ events: SessionEvent[]; workspaceRoot: string | undefined }> {
  const assembly = await assembleHostStack({
    runtime: { dataDir },
    noPlugins: true, // 只读诊断形——零插件装载提速
    debug: false,
    version: 'test',
  });
  if (!assembly.ok) throw new Error(`读装配失败：${assembly.message}`);
  try {
    const loaded = assembly.runtime.persistence.loadSession(sessionId);
    return { events: [...loaded.log.events()], workspaceRoot: loaded.row.workspaceRoot };
  } finally {
    await assembly.runtime.shutdown();
  }
}

/* ---------------- 输出三档与旗标面 ---------------- */

describe('runRunEntry 输出三档（07 §5）', () => {
  it('text 档：stdout 只出末条 assistant 文本，退出 0', async () => {
    const { entry, out } = await rigRun({});
    await expect(entry).resolves.toBe(0);
    expect(out.lines).toEqual(['ok']); // stdout 纯净律——仅产物一行
  });

  it('json 档：终值单对象（sessionId/status/turns/usage/lastMessage）', async () => {
    const { entry, out } = await rigRun({ flags: { outputFormat: 'json' } });
    await expect(entry).resolves.toBe(0);
    const summary = summaryOf(out);
    expect(summary['status']).toBe('completed');
    expect(summary['turns']).toBe(1);
    expect(summary['lastMessage']).toBe('ok');
    expect(summary['usage']).toMatchObject({ input: expect.any(Number), output: expect.any(Number) }); // 计量汇总位在场（faux 实算 token 非零）
    expect(typeof summary['sessionId']).toBe('string'); // 识别位
  });

  it('stream 档：AgentEvent NDJSON 直出（agent_start…agent_end 全序收口）', async () => {
    const { entry, out, err } = await rigRun({ flags: { outputFormat: 'stream' } });
    await expect(entry).resolves.toBe(0);
    const events = out.lines.map((line) => JSON.parse(line) as AgentEvent);
    const types = events.map((event) => event.type);
    expect(types).toContain('agent_start');
    expect(types).toContain('message_end');
    expect(types).toContain('turn_end');
    expect(types[types.length - 1]).toBe('agent_end'); // 事件流以 agent_end 收口
    // stream 档不设 keepalive——心跳即事件流一员
    expect(err.text).not.toContain('run 进行中');
  });

  it('--no-delta：stream 档滤 message_update（整消息事件不受影响）', async () => {
    const { entry, out } = await rigRun({ flags: { outputFormat: 'stream', noDelta: true } });
    await expect(entry).resolves.toBe(0);
    const types = out.lines.map((line) => JSON.parse(line) as AgentEvent).map((event) => event.type);
    expect(types).not.toContain('message_update');
    expect(types).toContain('message_end'); // 整消息事件仍在
  });

  it('--ephemeral：memory 形零落盘收口退 0', async () => {
    const { entry, out } = await rigRun({ flags: { ephemeral: true } });
    await expect(entry).resolves.toBe(0);
    expect(out.lines).toEqual(['ok']);
  });
});

/* ---------------- --max-turns 到帽收场 ---------------- */

describe('runRunEntry --max-turns', () => {
  it('到帽收场：truncated 如实标注 + 退 1（turn_start 门控 interrupt——确定性无竞态）', async () => {
    const ws = tmpDir('run-ws-');
    const { entry, out, err } = await rigRun({
      message: '多轮任务',
      flags: { maxTurns: 1, outputFormat: 'json' },
      cwd: ws,
      responses: [
        toolCallOf('t-mt', 'read', { path: join(ws, '缺席.txt') }), // toolUse → 必开第 2 轮
        messageOf(), // 竞速兜底位（interrupt 在模型调用前落位——正常不消费）
      ],
    });
    await expect(entry).resolves.toBe(1);
    const summary = summaryOf(out);
    expect(summary['status']).toBe('truncated'); // CLI 级收场语义位
    expect(err.text).toContain('--max-turns');
  });
});

/* ---------------- 会话选取四形 ---------------- */

describe('runRunEntry 会话选取（07 §5）', () => {
  it('--session 不存在：退 1 stderr 指路', async () => {
    const { entry, err } = await rigRun({ flags: { session: 's-不存在' } });
    await expect(entry).resolves.toBe(1);
    expect(err.text).toContain('会话不存在');
  });

  it('--continue：同 cwd 续接最新会话（与缺省新建分立）', async () => {
    const first = await rigRun({ flags: { outputFormat: 'json' } });
    await expect(first.entry).resolves.toBe(0);
    const firstSid = summaryOf(first.out)['sessionId'];

    // 同 dataDir 同 cwd 再跑 --continue → 续接同一会话
    const second = await rigRun({
      flags: { outputFormat: 'json', continueLatest: true },
      dataDir: first.dataDir,
      cwd: first.cwd,
    });
    await expect(second.entry).resolves.toBe(0);
    expect(summaryOf(second.out)['sessionId']).toBe(firstSid);

    // 缺省形（不带 --continue）→ 新建会话
    const third = await rigRun({ flags: { outputFormat: 'json' }, dataDir: first.dataDir, cwd: first.cwd });
    await expect(third.entry).resolves.toBe(0);
    expect(summaryOf(third.out)['sessionId']).not.toBe(firstSid);
  });

  it('--fork 无 id：取 cwd 最新分叉（新 sessionId）', async () => {
    const first = await rigRun({ flags: { outputFormat: 'json' } });
    await expect(first.entry).resolves.toBe(0);
    const firstSid = summaryOf(first.out)['sessionId'];

    const second = await rigRun({
      flags: { outputFormat: 'json', fork: {} }, // 不带值——cwd 最新
      dataDir: first.dataDir,
      cwd: first.cwd,
    });
    await expect(second.entry).resolves.toBe(0);
    const secondSid = summaryOf(second.out)['sessionId'];
    expect(secondSid).not.toBe(firstSid); // 边界快照分叉——新会话

    // 分叉血缘续接：durable 会话行可见（fork 落行成功）
    const durable = await readDurable(first.dataDir, secondSid as string);
    expect(durable.events.length).toBeGreaterThan(0);
  });
});

/* ---------------- --output-last-message 原子写 ---------------- */

describe('runRunEntry --output-last-message', () => {
  it('末条 assistant 文本原子写（内容零尾随换行）', async () => {
    const target = join(tmpDir('run-out-'), 'last.txt');
    const { entry } = await rigRun({ flags: { outputLastMessage: target } });
    await expect(entry).resolves.toBe(0);
    expect(readFileSync(target, 'utf8')).toBe('ok'); // 字节确定性——无尾随换行
    expect(existsSync(`${target}.tmp-${process.pid}`)).toBe(false); // tmp 已 rename 不在场
  });
});

/* ---------------- --background 记账 ---------------- */

describe('runRunEntry run 路记账（04 §5——2026-09-13 复盘修复 #41/#44 桥接单点化）', () => {
  it('--background：settle 后落 llm/usage 底账（callId run:<sid>:<seq> + priority background）', async () => {
    const run = await rigRun({ flags: { background: true, outputFormat: 'json' } });
    await expect(run.entry).resolves.toBe(0);
    const sid = summaryOf(run.out)['sessionId'] as string;

    const { events } = await readDurable(run.dataDir, sid);
    const usageEvents = events.filter((event) => event.type === 'llm/usage');
    expect(usageEvents.length).toBeGreaterThanOrEqual(1); // 至少一笔（本 run 一轮）
    const first = usageEvents[0]!.data as Record<string, unknown>;
    // callId 幂等身份：<run>:<会话>:<assistant 消息 seq>
    const match = /^run:(.+):(\d+)$/.exec(String(first['callId']));
    expect(match?.[1]).toBe(sid);
    const seq = Number(match?.[2]);
    const anchor = events.find((event) => event.type === 'assistant/message' && event.seq === seq);
    expect(anchor).toBeDefined(); // seq 锚定的确是本 run 的 assistant 消息
    expect(first['priority']).toBe('background'); // 聚合只计后台道
    expect(first['model']).toBe('faux-run/m1'); // 记账 model = 栈内解析真值
  });

  it('前台 run 照入账（priority foreground——修前红：前台入口此前零落账）', async () => {
    // 组合根桥接单点（04 §5 定形注①）：五入口统一——前台 CLI 与 TUI/webui/
    // issue/SDK 同经 driver settled 桥接；priority 随回执 backgroundLane（缺省前台）
    const run = await rigRun({ flags: { outputFormat: 'json' } });
    await expect(run.entry).resolves.toBe(0);
    const sid = summaryOf(run.out)['sessionId'] as string;

    const { events } = await readDurable(run.dataDir, sid);
    const usageEvents = events.filter((event) => event.type === 'llm/usage');
    expect(usageEvents.length).toBeGreaterThanOrEqual(1); // 修前红锚——旧代码前台零落账
    for (const event of usageEvents) {
      expect((event.data as Record<string, unknown>)['priority']).toBe('foreground');
    }
  });
});

/* ---------------- --tick settle 落账（04 §12 律 3 乙案侧——2026-09-13 修复批） ---------------- */

/**
 * 模型调用窗直读 jobs 行单列（WAL 并读——claim 已落/settle 未至的确定性
 * 中点观察：claim 严格先于 submit→模型调用，settle 严格后于模型收场）。
 * 测试面直开库（fts.test 同例——src 侧 better-sqlite3 只准 persist 的纪律
 * 不辖测试诊断读）。
 */
function probeJobColumn(
  dataDir: string,
  name: string,
  column: 'active_pid' | 'last_outcome' | 'next_fire_at',
): unknown {
  const db = new Database(join(dataDir, 'sessions.db'));
  try {
    const row = db.prepare(`SELECT ${column} AS v FROM jobs WHERE name = ?`).get(name) as { v: unknown } | undefined;
    return row?.v;
  } finally {
    db.close();
  }
}

describe('runRunEntry --tick settle 落账（律 3 乙案侧：claim-then-advance 的 CLI 腿）', () => {
  it('用户行真跑（修前红）：run 期占用面 = 本 CLI pid + 终态四笔——lastOutcome 镜像/last_fire_at 落账/next 推进/占用清', async () => {
    const dataDir = tmpDir('run-data-');
    const jobWs = tmpDir('run-ws-');
    const seed = await seedAssembly(dataDir);
    seed.scheduler.service.addJob({
      name: 'settle-job',
      prompt: '例行巡检',
      cwd: jobWs,
      schedule: 'every:30m',
      enabled: true, // 启用行（cron 注册态真实形态——addJob 缺省建停用行）
    });
    const nextBefore = seed.scheduler.service.getJob('settle-job')?.nextFireAt;
    await seed.shutdown();

    // 模型调用回调窗内直读行（替换响应队——rigRun 未及消费前覆写安全：
    // 模型调用严格后于装配完成，而装配是首个 await 边界）
    let midRunActivePid: unknown;
    const run = await rigRun({ message: '', flags: { tick: 'settle-job' }, dataDir, cwd: jobWs });
    run.faux.setResponses([
      () => {
        midRunActivePid = probeJobColumn(dataDir, 'settle-job', 'active_pid');
        return messageOf();
      },
    ]);
    await expect(run.entry).resolves.toBe(0);

    // claim 中点可见（律 3 乙案侧——此前单向：只读他人占用不自记）
    expect(midRunActivePid).toBe(process.pid);
    // 终态四笔（audit 读回——第二装配在收场后开）
    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob('settle-job');
      expect(row?.lastOutcome?.reason).toBe('exit_code'); // 终态镜像落账
      expect(row?.lastOutcome?.exitCode).toBe(0);
      expect(row?.lastOutcome?.finalTextPreview).toBe('ok'); // 末条 assistant 文本（faux 常量透传）
      expect(row?.lastFireAt).not.toBeNull(); // 真跑落 last_fire_at（此前永不推进）
      expect(row?.activePid).toBeNull(); // settle 清占用（claim 对偶）
      // next 推进：结算时刻锚 every:30m 下一刻 > 种入时的 now+30m
      expect(Date.parse(row?.nextFireAt ?? '')).toBeGreaterThan(Date.parse(nextBefore ?? ''));
    } finally {
      await audit.shutdown();
    }
  });

  it('goal wake 未落地（修前红）：gated 结局照记 + 不动 last_fire_at（此前零 settle 行永 due）', async () => {
    const dataDir = tmpDir('run-data-');
    const goal = await seedGoal(dataDir, { abandon: true }); // 激活即弃 → inactive
    const run = await rigRun({ message: '', flags: { tick: `goal-${goal.id}` }, dataDir });
    await expect(run.entry).resolves.toBe(0); // 零跑零账退 0
    expect(run.err.text).toContain('未唤醒');

    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob(`goal-${goal.id}`);
      expect(row?.lastOutcome?.reason).toBe('gated'); // gated 结局照记（引擎 spawnGoalRow 同律）
      expect(row?.lastOutcome?.error).toContain('未唤醒');
      expect(row?.lastFireAt).toBeNull(); // 非真跑不动 last_fire_at
      expect(row?.nextFireAt).not.toBeNull(); // next 照推进（行不再永 due）
      expect(row?.activePid).toBeNull(); // 零 claim 零占用
    } finally {
      await audit.shutdown();
    }
  });

  it('claim 后早退（--session 幽灵）：spawn 形落账——fire 已起跑面 last_fire_at 推进 + 占用清', async () => {
    const dataDir = tmpDir('run-data-');
    const jobWs = tmpDir('run-ws-');
    const seed = await seedAssembly(dataDir);
    seed.scheduler.service.addJob({
      name: 'ghost-session-job',
      prompt: '例行巡检',
      cwd: jobWs,
      schedule: 'every:30m',
      enabled: true,
    });
    const nextBefore = seed.scheduler.service.getJob('ghost-session-job')?.nextFireAt;
    await seed.shutdown();

    // claim（① 尾）已落账后 --session 幽灵（③ open fail-loud）→ abortTick spawn 形
    const run = await rigRun({
      message: '',
      flags: { tick: 'ghost-session-job', session: 'no-such-session' },
      dataDir,
      cwd: jobWs,
    });
    await expect(run.entry).resolves.toBe(1);
    expect(run.err.text).toContain('--session 会话不存在');

    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob('ghost-session-job');
      expect(row?.lastOutcome?.reason).toBe('spawn'); // 没起来诚实记 spawn（非静默吞）
      expect(row?.lastOutcome?.error).toContain('--session 会话不存在');
      expect(row?.lastFireAt).not.toBeNull(); // claim 后早退走 settleFire——fire 面照推进
      expect(row?.activePid).toBeNull(); // claim 清账对偶
      expect(Date.parse(row?.nextFireAt ?? '')).toBeGreaterThan(Date.parse(nextBefore ?? '')); // next 推进
    } finally {
      await audit.shutdown();
    }
  });

  it('claim 后预检拒（--background 预算尽）：gated 落账——last_fire_at 不动 + gate=daily_budget + 占用清', async () => {
    const dataDir = tmpDir('run-data-');
    const jobWs = tmpDir('run-ws-');
    const seed = await seedAssembly(dataDir);
    seed.scheduler.service.addJob({
      name: 'budget-job',
      prompt: '例行巡检',
      cwd: jobWs,
      schedule: 'every:30m',
      enabled: true,
    });
    const nextBefore = seed.scheduler.service.getJob('budget-job')?.nextFireAt;
    await seed.shutdown();

    // env 旋钮显式关池（'0' = canAfford('background') 恒假）——无需真耗 4M 缺省池
    const run = await rigRun({
      message: '',
      flags: { tick: 'budget-job', background: true },
      dataDir,
      cwd: jobWs,
      env: { BERRY_AGENT_BACKGROUND_BUDGET_TOKENS: '0' },
    });
    await expect(run.entry).resolves.toBe(1);
    expect(run.err.text).toContain('当日后台道预算已尽');

    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob('budget-job');
      expect(row?.lastOutcome?.reason).toBe('gated');
      expect((row?.lastOutcome as { gate?: string } | undefined)?.gate).toBe('daily_budget');
      expect(row?.lastFireAt).toBeNull(); // 非真跑不动 last_fire_at（与真跑 spawn 形分野）
      expect(row?.activePid).toBeNull(); // claim（② 前已落）→ settle 清账对偶
      expect(Date.parse(row?.nextFireAt ?? '')).toBeGreaterThan(Date.parse(nextBefore ?? '')); // next 照推进
    } finally {
      await audit.shutdown();
    }
  });

  it('settle 单笔幂等（守卫面）：gated 早退后残余路径不得二次结算——ghost --session 潜在覆盖者被吞', async () => {
    // 组合形：tick + --background（预算尽）+ ghost --session 同场。② gated settle
    // 后 return 1——③ 的 abortTick('spawn') 不可达；即便 return 回归丢失，settleTick
    // 的 tickJob=undefined 守卫也吞掉二次结算。锁定：结局恰一笔终值 gated、
    // spawn 文案不可达（双防线任一回归即红：结局翻 spawn 或 err 多出会话句）
    const dataDir = tmpDir('run-data-');
    const jobWs = tmpDir('run-ws-');
    const seed = await seedAssembly(dataDir);
    seed.scheduler.service.addJob({
      name: 'idem-job',
      prompt: '例行巡检',
      cwd: jobWs,
      schedule: 'every:30m',
      enabled: true,
    });
    await seed.shutdown();

    const run = await rigRun({
      message: '',
      flags: { tick: 'idem-job', background: true, session: 'no-such-session' },
      dataDir,
      cwd: jobWs,
      env: { BERRY_AGENT_BACKGROUND_BUDGET_TOKENS: '0' },
    });
    await expect(run.entry).resolves.toBe(1);
    expect(run.err.text).toContain('当日后台道预算已尽');
    expect(run.err.text).not.toContain('--session 会话不存在'); // ③ 不可达（return 早退）

    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob('idem-job');
      expect(row?.lastOutcome?.reason).toBe('gated'); // 终值不被后续覆盖（幂等守卫面）
      expect((row?.lastOutcome as { gate?: string } | undefined)?.gate).toBe('daily_budget');
      expect(row?.lastOutcome?.error).not.toContain('--session'); // 非 spawn 覆盖形
      expect(row?.lastFireAt).toBeNull();
      expect(row?.activePid).toBeNull();
    } finally {
      await audit.shutdown();
    }
  });
});

/* ---------------- --tick 双形态 ---------------- */

describe('runRunEntry --tick 用户任务行', () => {
  it('行内 prompt/cwd/source=schedule 全链（会话工作区锚 = 行内 cwd）', async () => {
    const dataDir = tmpDir('run-data-');
    const jobWs = tmpDir('run-ws-');
    const seed = await seedAssembly(dataDir);
    seed.scheduler.service.addJob({ name: 'demo-job', prompt: '例行巡检', cwd: jobWs, schedule: 'every:30m' });
    await seed.shutdown();

    // 宿主 cwd 故意异于行内 cwd——行内工作区语义应胜出
    const run = await rigRun({
      message: '',
      flags: { tick: 'demo-job', outputFormat: 'json' },
      dataDir,
      cwd: tmpDir('run-ws-'),
    });
    await expect(run.entry).resolves.toBe(0);
    const sid = summaryOf(run.out)['sessionId'] as string;

    const { events, workspaceRoot } = await readDurable(dataDir, sid);
    expect(workspaceRoot).toBe(canonicalWorkspaceRoot(jobWs)); // 行内 cwd 锚
    const userMsg = events.find((event) => event.type === 'user/message');
    expect(userMsg).toBeDefined();
    const data = userMsg!.data as Record<string, unknown>;
    expect(data['source']).toBe('schedule'); // 归因：挂钟调度触发
    expect(JSON.stringify(data['content'])).toContain('例行巡检'); // 行内提示词
  });

  it('行缺席：配置漂移档退 2（jobs 表无此行）', async () => {
    const { entry, err } = await rigRun({ message: '', flags: { tick: 'ghost-job' } });
    await expect(entry).resolves.toBe(2);
    expect(err.text).toContain('行缺席');
  });

  it('件缺席形：--no-plugins 下 --tick 退 2（core:scheduler 不在场）', async () => {
    const { entry, err } = await rigRun({ message: '', flags: { tick: 'any-job', noPlugins: true } });
    await expect(entry).resolves.toBe(2);
    expect(err.text).toContain('core:scheduler');
  });
});

describe('runRunEntry --tick 让位律（u-2 定形注③乙案子进程侧腿）', () => {
  it('activePid 活体未超钟（ppid 占用）：yielded 让位退 0 + 结局照记 + next 原样', async () => {
    const dataDir = tmpDir('run-data-');
    const jobWs = tmpDir('run-ws-');
    const seed = await seedAssembly(dataDir);
    seed.scheduler.service.addJob({ name: 'yield-job', prompt: '例行巡检', cwd: jobWs, schedule: 'every:30m' });
    // 预置他实例占用：ppid = vitest 主进程（活体且必 ≠ 本 worker pid——
    // realIsPidAlive 真身零 mock，探活面同生产）
    const t0 = new Date().toISOString();
    seed.scheduler.dao.setActive('yield-job', process.ppid, t0, t0);
    const nextBefore = seed.scheduler.service.getJob('yield-job')?.nextFireAt;
    await seed.shutdown();

    const run = await rigRun({ message: '', flags: { tick: 'yield-job' }, dataDir, cwd: jobWs });
    await expect(run.entry).resolves.toBe(0); // 让位非失败
    expect(run.err.text).toContain('让位退出');
    expect(run.out.lines).toEqual([]); // 零跑零产物

    // durable 断言：yielded 结局照记 + next 原样（不推进不重排）+ 占用面不动
    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob('yield-job');
      expect(row?.lastOutcome?.reason).toBe('yielded');
      expect(row?.lastOutcome?.error).toContain(String(process.ppid));
      expect(row?.lastFireAt).toBeNull(); // 非真跑不动 last_fire_at
      expect(row?.nextFireAt).toBe(nextBefore); // 原样（无新信息不猜下一刻）
      expect(row?.activePid).toBe(process.ppid); // 让位不越权清他人占用
    } finally {
      await audit.shutdown();
    }
  });

  it('activePid 超钟残账（活+超墙钟）：清占用照跑——run 正常收场', async () => {
    const dataDir = tmpDir('run-data-');
    const jobWs = tmpDir('run-ws-');
    const seed = await seedAssembly(dataDir);
    seed.scheduler.service.addJob({ name: 'stale-job', prompt: '例行巡检', cwd: jobWs, schedule: 'every:30m' });
    // 活体（ppid）但起跑时刻 = 40min 前（超 FIRE_WALL_TIMEOUT_MS 30min）——
    // pid 复用误判险形不 yield，残账清后照跑
    const stale = new Date(Date.now() - 40 * 60_000).toISOString();
    seed.scheduler.dao.setActive('stale-job', process.ppid, stale, stale);
    await seed.shutdown();

    const run = await rigRun({ message: '', flags: { tick: 'stale-job' }, dataDir, cwd: jobWs });
    await expect(run.entry).resolves.toBe(0); // 照跑收场（faux 单响应 'ok'）
    expect(run.out.lines).toEqual(['ok']);
    expect(run.err.text).not.toContain('让位'); // 未让位

    // durable 断言：残账占用已清（activePid null——照跑腿自清他人死账）
    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob('stale-job');
      expect(row?.activePid).toBeNull();
    } finally {
      await audit.shutdown();
    }
  });
});

describe('runRunEntry --tick goal 挂钟行', () => {
  it('wake 不落（终态 goal）：诚实零跑退 0 + stderr 说明', async () => {
    const dataDir = tmpDir('run-data-');
    const goal = await seedGoal(dataDir, { abandon: true }); // 激活即弃 → inactive
    const run = await rigRun({ message: '', flags: { tick: `goal-${goal.id}` }, dataDir });
    await expect(run.entry).resolves.toBe(0); // 零跑零账——诚实零跑
    expect(run.err.text).toContain('未唤醒');
    expect(run.out.lines).toEqual([]); // text 档零产物（无 assistant 输出）
  });

  it('wake 落地：续接 goal 绑定会话 + recordTurn 记账落行（cap=1 首 run 即刹停——驱动 onRunSettled 回执）', async () => {
    const dataDir = tmpDir('run-data-');
    const goal = await seedGoal(dataDir, { cap: 1 });
    const run = await rigRun({
      message: '',
      flags: { tick: `goal-${goal.id}`, outputFormat: 'json' },
      dataDir,
      // 双响应：沉淀摘要单发（goalSummarizer 适配器——批 #99 轮间沉淀）与
      // 真模型请求各烧一条（同 provider 队列，消耗序确定）
      responses: [messageOf(), messageOf()],
    });
    await expect(run.entry).resolves.toBe(0);
    // 记账面（批 #99 三入口统一——挂点已上移驱动 settled 链）：warn 文本不再
    // 走 CLI stderr，改 durable 读回——used 1/1 落行即证回执窗扫计数腿真跑
    const audit = await seedAssembly(dataDir);
    try {
      expect(audit.goalService.get(goal.id)?.budgetMessagesUsed).toBe(1);
    } finally {
      await audit.shutdown();
    }
  });
});

/* ---------------- --port 咬合与 provider 失败文案 ---------------- */

describe('runRunEntry --port 咬合 / provider 失败面', () => {
  it('--port × --no-plugins：sdk 件缺席 = warn 不开面，run 本体不受累', async () => {
    const { entry, out, err } = await rigRun({ flags: { port: 7860, noPlugins: true } });
    await expect(entry).resolves.toBe(0); // run 本体收口
    expect(out.lines).toEqual(['ok']);
    expect(err.text).toContain('core:sdk 件未装载'); // warn 披露（件禁用语义族）
  });

  it('provider unconfigured：产品级文案点名模型 + 配置途径（07 §5）退 1', async () => {
    // providers 只有 faux-run 而点名缺席模型 → LLM_MODEL_NOT_FOUND → run failed
    const { entry, err } = await rigRun({ model: 'faux-x/m1' });
    await expect(entry).resolves.toBe(1);
    expect(err.text).toContain('模型不可用'); // 产品级文案（非裸报文）
    expect(err.text).toContain('faux-x/m1'); // 点名模型标识
    expect(err.text).toContain('BERRY_AGENT_MODEL'); // 配置途径指路
  });
});

/* ---------------- --output-schema 收场校验（07 §5 落码定形注——2026-09-15 批） ---------------- */

/** 指定文本的 assistant 消息（--output-schema 校验靶直给——text 块单块形） */
function textMessageOf(text: string): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    usage: NO_USAGE,
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 仅 thinking 块的 assistant 消息（零 text 块收场形——thinking 模型实录） */
function thinkingOnlyMessageOf(): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'thinking', thinking: '内省……' }],
    usage: NO_USAGE,
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

describe('runRunEntry --output-schema（收场校验退 1 / 文件级坏形退 2——07 §5 落码定形注）', () => {
  /** 测试共用对象形 schema（required 单字段——mismatch 例确定性失配） */
  const OBJECT_SCHEMA = JSON.stringify({
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
  });

  /** 写临时 schema 文件（tmpDir 统一清账） */
  function schemaFile(text: string): string {
    const path = join(tmpDir('run-schema-'), 'schema.json');
    writeFileSync(path, text);
    return path;
  }

  it('合格：末条文本单一 JSON 且过 schema → 退 0（json 档无 errorCode）', async () => {
    const run = await rigRun({
      flags: { outputSchema: schemaFile(OBJECT_SCHEMA), outputFormat: 'json' },
      responses: [textMessageOf('{"answer":"四十二"}')],
    });
    await expect(run.entry).resolves.toBe(0);
    const summary = summaryOf(run.out);
    expect(summary['status']).toBe('completed');
    expect(summary['errorCode']).toBeUndefined();
  });

  it('非 JSON（修前红）：STRUCTURED_OUTPUT_PARSE_FAILED 退 1 + json 档 errorCode 载码', async () => {
    const run = await rigRun({
      flags: { outputSchema: schemaFile(OBJECT_SCHEMA), outputFormat: 'json' },
      responses: [textMessageOf('答案是四十二——不是 JSON 文档')],
    });
    await expect(run.entry).resolves.toBe(1);
    expect(run.err.text).toContain('STRUCTURED_OUTPUT_PARSE_FAILED');
    const summary = summaryOf(run.out);
    // loop 真态仍 completed（07 §5 定形注——退出码叠加而档不改写）
    expect(summary['status']).toBe('completed');
    expect(summary['errorCode']).toBe('STRUCTURED_OUTPUT_PARSE_FAILED');
  });

  it('合法 JSON 不合 schema：STRUCTURED_OUTPUT_SCHEMA_MISMATCH 退 1 + stderr 首错定位', async () => {
    const run = await rigRun({
      flags: { outputSchema: schemaFile(OBJECT_SCHEMA), outputFormat: 'json' },
      responses: [textMessageOf('{"wrong":1}')], // required answer 缺席——确定性失配
    });
    await expect(run.entry).resolves.toBe(1);
    expect(run.err.text).toContain('STRUCTURED_OUTPUT_SCHEMA_MISMATCH');
    expect(run.err.text).toContain('answer'); // typebox 首错定位（required 路径点名）
    const summary = summaryOf(run.out);
    expect(summary['errorCode']).toBe('STRUCTURED_OUTPUT_SCHEMA_MISMATCH');
  });

  it('文件不可读（修前红）：用法错退 2——执行前拦（零会话零提交）', async () => {
    const run = await rigRun({ flags: { outputSchema: '/nonexistent-摘/schema.json' } });
    await expect(run.entry).resolves.toBe(2);
    expect(run.err.text).toContain('--output-schema 文件不可读');
  });

  it('根非带 type 字段对象：合法 JSON 亦用法错退 2（v1 根形收窄——07 §5 定形注⑦）', async () => {
    const arrayRoot = await rigRun({ flags: { outputSchema: schemaFile('[1,2]') } });
    await expect(arrayRoot.entry).resolves.toBe(2);
    expect(arrayRoot.err.text).toContain('type 字段');

    const noTypeField = await rigRun({ flags: { outputSchema: schemaFile('{"noType":true}') } });
    await expect(noTypeField.entry).resolves.toBe(2);
  });

  it('根 type 值域外（手误形）：用法错退 2（修前红——07 §5 定形注⑥值域笔）', async () => {
    // 未知 type 值使 typebox Check 对任意输出恒真——校验空转零告警（同批修：
    // 值域执法补口，域外退 2 提示 typo 可能）
    const typoRoot = await rigRun({ flags: { outputSchema: schemaFile('{"type":"objekt"}') } });
    await expect(typoRoot.entry).resolves.toBe(2);
    expect(typoRoot.err.text).toContain('type 值');

    // 值域七值内的合法形照放行（object 无 required——空对象合格对照锁）
    const okRoot = await rigRun({
      flags: { outputSchema: schemaFile('{"type":"object"}') },
      responses: [textMessageOf('{}')],
    });
    await expect(okRoot.entry).resolves.not.toBe(2);
  });

  it('零 text 块收场（thinking-only）：校验靶不存在同档退 0（修前红——07 §5 定形注④）', async () => {
    // thinking 模型以仅 thinking 块的 assistant 消息收场：text 过滤产物为空串
    // （非 undefined）——修前门槛只认 undefined 形，空串误走 PARSE_FAILED 退 1
    const run = await rigRun({
      flags: { outputSchema: schemaFile(OBJECT_SCHEMA), outputFormat: 'json' },
      responses: [thinkingOnlyMessageOf()],
    });
    await expect(run.entry).resolves.toBe(0);
    expect(run.err.text).not.toContain('STRUCTURED_OUTPUT_');
    const summary = summaryOf(run.out);
    expect(summary['status']).toBe('completed');
    expect(summary['errorCode']).toBeUndefined();
  });

  it('truncated 不叠加：--max-turns 到帽收场（run 本体已非成功态）无校验码', async () => {
    const ws = tmpDir('run-ws-');
    const run = await rigRun({
      flags: { outputSchema: schemaFile(OBJECT_SCHEMA), maxTurns: 1, outputFormat: 'json' },
      cwd: ws,
      responses: [
        toolCallOf('t-os', 'read', { path: join(ws, '缺席.txt') }), // toolUse → 必开第 2 轮 → 到帽截断
        messageOf(), // 竞速兜底位（interrupt 先于模型调用——正常不消费）
      ],
    });
    await expect(run.entry).resolves.toBe(1); // truncated 档本身的退出码
    expect(run.err.text).not.toContain('STRUCTURED_OUTPUT_'); // 不叠加（07 §5 定形注④）
    const summary = summaryOf(run.out);
    expect(summary['status']).toBe('truncated');
    expect(summary['errorCode']).toBeUndefined();
  });

  it('tick+schema 回归：completed 而 schema 失败 → settleFire exitCode 1 + outcome.error 载码', async () => {
    // 冷读① 锁：tick settle completed 档此前硬编码 exitCode:0——schema 失败须
    // 落计算后变量 + error 载码（账实分离修复的回归面）
    const dataDir = tmpDir('run-data-');
    const jobWs = tmpDir('run-ws-');
    const seed = await seedAssembly(dataDir);
    seed.scheduler.service.addJob({
      name: 'schema-job',
      prompt: '例行巡检',
      cwd: jobWs,
      schedule: 'every:30m',
      enabled: true,
    });
    await seed.shutdown();

    const run = await rigRun({
      message: '',
      flags: { tick: 'schema-job', outputSchema: schemaFile(OBJECT_SCHEMA) },
      dataDir,
      cwd: jobWs,
      responses: [textMessageOf('不是 JSON 的巡检汇报')],
    });
    await expect(run.entry).resolves.toBe(1);

    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob('schema-job');
      expect(row?.lastOutcome?.reason).toBe('exit_code');
      expect(row?.lastOutcome?.exitCode).toBe(1); // 计算后变量（修前硬编码 0）
      expect(row?.lastOutcome?.error).toContain('STRUCTURED_OUTPUT_PARSE_FAILED'); // 载码
      expect(row?.activePid).toBeNull();
    } finally {
      await audit.shutdown();
    }
  });
});
