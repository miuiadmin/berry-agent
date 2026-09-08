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
 * recordTurn 记账帽 warn）+ provider unconfigured 产品级文案（07 §5）+
 * 退出码三态。
 *
 * 断言只对行为与结构位（禁断言 AI 生成文本——'ok'/'例行巡检' 等均为测试
 * 自造常量经 faux 脚本原样透传）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import type { AgentEvent, SessionEvent } from '../contracts/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { fauxProvider } from '../llm/index.js';

import { assembleHostStack } from './assembly.js';
import type { RunFlags } from './cli.js';
import type { GoalFace, SchedulerFace } from './core-plugins.js';
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
    env: {},
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
  createSession: (workspaceRoot: string) => string;
  submit: (sessionId: string, text: string) => Promise<unknown>;
  shutdown: () => Promise<void>;
}> {
  const faux = fauxProvider({ provider: 'faux-seed', models: [{ id: 'm1' }] });
  faux.setResponses((opts.responses ?? [messageOf()]).map((msg) => () => msg));
  const assembly = await assembleHostStack({
    runtime: { dataDir },
    noPlugins: false,
    debug: false,
    version: 'test',
    providers: [faux.provider],
    model: 'faux-seed/m1',
    env: {},
  });
  if (!assembly.ok) throw new Error(`种子装配失败：${assembly.message}`);
  const scheduler = assembly.scope.tryGet<SchedulerFace>('scheduler');
  if (scheduler === undefined) throw new Error('种子装配：scheduler 件未装载');
  return {
    scheduler,
    goal: assembly.scope.tryGet<GoalFace>('goal'),
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
  if (seed.goal === undefined) throw new Error('种子装配：goal 件未装载');
  const goal = await seed.goal.service.activate({
    sessionId,
    objective: '写周报',
    schedule: 'daily@09:00',
    ...(opts.cap !== undefined ? { budgetMessagesCap: opts.cap } : {}),
  });
  if (opts.abandon) await seed.goal.service.abandon(goal.id, '测试即弃');
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

describe('runRunEntry --background 记账（04 §5 后台道）', () => {
  it('settle 后落 llm/usage 底账（callId run:<sid>:<seq> + priority background）', async () => {
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

describe('runRunEntry --tick goal 挂钟行', () => {
  it('wake 不落（终态 goal）：诚实零跑退 0 + stderr 说明', async () => {
    const dataDir = tmpDir('run-data-');
    const goal = await seedGoal(dataDir, { abandon: true }); // 激活即弃 → inactive
    const run = await rigRun({ message: '', flags: { tick: `goal-${goal.id}` }, dataDir });
    await expect(run.entry).resolves.toBe(0); // 零跑零账——诚实零跑
    expect(run.err.text).toContain('未唤醒');
    expect(run.out.lines).toEqual([]); // text 档零产物（无 assistant 输出）
  });

  it('wake 落地：续接 goal 绑定会话 + recordTurn 记账帽 warn（cap=1 首 run 即刹停）', async () => {
    const dataDir = tmpDir('run-data-');
    const goal = await seedGoal(dataDir, { cap: 1 });
    const run = await rigRun({
      message: '',
      flags: { tick: `goal-${goal.id}`, outputFormat: 'json' },
      dataDir,
    });
    await expect(run.entry).resolves.toBe(0);
    expect(summaryOf(run.out)['sessionId']).toBe(goal.sessionId); // goal 会话由裁决选取
    expect(run.err.text).toContain('记账帽'); // used 1/1 → braked warn 如实呈报
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
