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
 * recordTurn 记账 durable 读回〔批 #99 上移驱动 settled 链〕）+ 乙案双收口
 * （65 轮件B：wake reject 兜错 gated 退 0——行漂移形；claim 后自杀钟
 * tickWallTimeoutMs 注入提速形驱动——缺省 FIRE_WALL_TIMEOUT_MS 同机制：
 * 到点协作中止 + settle timeout 终态）+ provider
 * unconfigured 产品级文案（07 §5）+ 退出码三态。
 *
 * 断言只对行为与结构位（禁断言 AI 生成文本——'ok'/'例行巡检' 等均为测试
 * 自造常量经 faux 脚本原样透传）。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
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
import type { GoalService } from '../../plugins/goal/index.js';
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

/**
 * 目录树快照（76 轮件1——ephemeral 写侧门控回归锁通道）：递归收相对路径
 * 清单（目录与文件都入账，路径序稳定）——跑前/跑后全等断言用；较 75 轮
 * 顶层 readdirSync 更强（子目录内部新增〔如 data/checkpoint/ 的 blob 分片
 * 目录〕也须零新增）。
 */
function walkTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      out.push(rel);
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
    }
  };
  walk(root, '');
  return out;
}

/**
 * 占位 TCP 端口（C4 开面失败形公共手法）：node:http 真监听 127.0.0.1 内核
 * 指派口并保持占用——对被测 `--port` 开面即确定性 EADDRINUSE 拒形；调用方
 * finally 内 close 释放。
 */
async function occupyTcpPort(): Promise<{ port: number; close(): Promise<void> }> {
  const server: Server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        server.close();
        reject(new Error('address 非 TCP 形（占位端口基建异常）'));
        return;
      }
      resolve({ port: addr.port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

/** 单 run 测试装配（faux provider + 新鲜 dataDir/ws + 行账出站对） */
async function rigRun(opts: {
  message?: string;
  flags?: Partial<RunFlags>;
  cwd?: string;
  dataDir?: string;
  responses?: readonly PiAssistantMessage[];
  model?: string;
  /** 自杀钟毫秒注入位（65 轮件B ②——tickWallTimeoutMs seam 透传；测试提速形） */
  wallMs?: number;
  /** env 面（缺省 {} 隔离——预算旋钮等 BERRY_AGENT_* 测试注入位） */
  env?: Record<string, string | undefined>;
}) {
  const faux = fauxProvider({ provider: 'faux-run', models: [{ id: 'm1' }] });
  faux.setResponses((opts.responses ?? [messageOf()]).map((msg) => () => msg));
  const out = new LineRig();
  const err = new LineRig();
  const dataDir = opts.dataDir ?? tmpDir('run-data-');
  const cwd = opts.cwd ?? tmpDir('run-ws-');
  // ephemeral 形 env 锚定（75 轮件2）：dataDir 缺省修真（resolveDataDir() 显式
  // 传入）后，不传 options.dataDir 的真形（main 分派同形）经 env 梯子
  // BERRY_AGENT_DATA_DIR 解析数据目录——hermetic 纪律禁触真 ~/.berry-agent，
  // 一律注入 tmp 位；entry 收口即恢复（防跨用例 env 泄漏）
  let restoreDataDirEnv: (() => void) | undefined;
  if (opts.flags?.ephemeral) {
    const prev = process.env.BERRY_AGENT_DATA_DIR;
    process.env.BERRY_AGENT_DATA_DIR = dataDir;
    restoreDataDirEnv =
      prev === undefined
        ? () => delete process.env.BERRY_AGENT_DATA_DIR
        : () => {
            process.env.BERRY_AGENT_DATA_DIR = prev;
          };
  }
  const entry = runRunEntry({
    message: opts.message ?? '跑一下',
    flags: runFlags(opts.flags),
    cwd,
    // ephemeral 形不传 options.dataDir（保 main 分派真形——数据目录经 env 梯子
    // 接通即 75 轮件2 修真路径；上方 env 已锚 tmp）
    ...(opts.flags?.ephemeral ? {} : { dataDir }),
    providers: [faux.provider],
    model: opts.model ?? 'faux-run/m1',
    env: opts.env ?? {},
    stdout: out.stream,
    stderr: err.stream,
    ...(opts.wallMs !== undefined ? { tickWallTimeoutMs: opts.wallMs } : {}),
  }).finally(() => restoreDataDirEnv?.());
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

/** goal 种子：建 durable 会话（首事件落行）→ 激活 goal（可选即弃/即完——终态
 * 分工 03 §10.5 定形注②：complete = disable 行留史〔终态 gated 唤醒路径的行
 * 在场承载〕；abandon = remove 摘钟〔行不在〕） */
async function seedGoal(
  dataDir: string,
  opts: { cap?: number; abandon?: boolean; complete?: boolean } = {},
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
  if (opts.complete) await seed.goalService.complete(goal.id, '测试完成');
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

  it('--ephemeral dataDir 缺省走 env 梯子（75 轮件2 回归锁）：env 位坏形 enabled.yaml fail-loud 启动失败退 1（修前条件展开省键 ⇒ 恒出厂假态退 0）', async () => {
    // 同病第三位（plugins list obs-c / dump-config 74 轮件4 之后）：main 分派
    // 不传 dataDir + ephemeral 置 memory ⇒ 修前 runtime memory 形 dataDir 折
    // null ⇒ enabled.yaml/settings/装机账本读侧整跳——ephemeral 单发以出厂
    // 配置执行。本锁不传 options.dataDir、只锚 env：坏形启用清单必须 fail-loud
    // （读侧真达的确定性证据）；修前 dataDir=null 整跳 ⇒ 退 0 必红
    const dir = tmpDir('run-eph-read-');
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins: [ Oops'); // yaml 坏形 fail-loud
    const { entry, err } = await rigRun({ flags: { ephemeral: true }, dataDir: dir });
    await expect(entry).resolves.toBe(1);
    expect(err.text).toContain('启动失败');
    expect(err.text).toContain('修复或删除');
  });

  it('--ephemeral 零落盘写侧门控（75 轮件2）：env 位真目录装配后文件集零新增（tool-policy/boot-failures/主库/rollup 全不落）', async () => {
    // 读侧修真后 dataDir 在场使各写位新可达——「零落盘单发——会话不落库不
    // 留痕」承诺的写侧回归锁：读侧真行（禁用行进 skipped）+ 目录文件集前后
    // 全等 + 四类落盘足迹显式缺席
    const dir = tmpDir('run-eph-zero-');
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins:\n  - id: core:credentials\n    disabled: true\n');
    const before = readdirSync(dir).sort();
    const { entry, out } = await rigRun({ flags: { ephemeral: true }, dataDir: dir });
    await expect(entry).resolves.toBe(0);
    expect(out.lines).toEqual(['ok']);
    expect(readdirSync(dir).sort()).toEqual(before); // 文件集零新增（含子目录零新建）
    expect(existsSync(join(dir, 'sessions.db'))).toBe(false); // 主库 :memory: 零落盘
    expect(existsSync(join(dir, 'tool-policy.json'))).toBe(false); // 审批回写门控
    expect(existsSync(join(dir, 'boot-failures.json'))).toBe(false); // 记账不留痕门控
    expect(existsSync(join(dir, 'data'))).toBe(false); // rollup 自管库不建（件5 同笔——obs 零装载）
  });

  it('--ephemeral 不建数据目录（75 轮件2 回归锁）：env 位目录缺席 → 装配后仍缺席（修前 openStore ensureDataDir 代建必红）', async () => {
    // 「不建数据目录」注记本意的文件面证据：ephemeral 单发不得替用户创建
    // 数据目录（读侧缺席语义 = 出厂缺省照跑）；修前持久层 :memory: 开库仍
    // 无条件 ensureDataDir（env 梯子位）——本断言必红
    const parent = tmpDir('run-eph-mkdir-');
    const absent = join(parent, 'sub-data-dir'); // 缺席目录位（env 锚点）
    const { entry, out } = await rigRun({ flags: { ephemeral: true }, dataDir: absent });
    await expect(entry).resolves.toBe(0);
    expect(out.lines).toEqual(['ok']); // 目录缺席 = 出厂缺省照跑
    expect(existsSync(absent)).toBe(false); // 不代建（修前必红——ensureDataDir 建 0700 目录）
  });

  it('--ephemeral checkpoint 写侧门控（76 轮件1）：写工具回合零 checkpoint 落盘——数据目录树前后全等', async () => {
    // 75 轮 ephemeral 修真后（memory:true + dataDir 真值）checkpoint 主闸
    // 恒通过：写工具回合（tools_pre_execute 守门——effect:'write' 即触发
    // capture）对 <dataDir>/data/checkpoint/ 落全工作区 blob+manifest，并按
    // workspaceRoot 记保留帽——ephemeral 单发与用户真会话同工作区共享帽位
    // （真回退点被挤出 + 独占 blob 被 GC），违「零落盘单发——不留痕」承诺。
    // 本锁：faux 驱动一次 effect:'write' 工具回合（skill_manage——写面动词
    // 纯 list 执行零其他写盘；checkpoint 守门行在 safety 前，审批拦否均先
    // 拍）跑完后 checkpoint 目录缺席 + 数据目录树前后全等（修前 capture 已
    // 落盘必红）
    const dir = tmpDir('run-eph-ckpt-');
    const ws = tmpDir('run-eph-ckpt-ws-');
    writeFileSync(join(ws, 'a.txt'), 'v1'); // 工作区非空——capture walk 有实文件入 blob
    const before = walkTree(dir);
    const { entry } = await rigRun({
      flags: { ephemeral: true },
      cwd: ws,
      dataDir: dir,
      responses: [
        toolCallOf('t-ckpt', 'skill_manage', { action: 'list' }), // effect:'write' → 守门拍快照
        messageOf(), // 收场
      ],
    });
    await expect(entry).resolves.toBe(0);
    expect(walkTree(dir)).toEqual(before); // 目录树零新增（修前 data/checkpoint/ blob+manifest 必红）
    expect(existsSync(join(dir, 'data', 'checkpoint'))).toBe(false); // 主断言：checkpoint 落点缺席
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
    // 终态分工（03 §10.5 定形注②）随迁：complete = disable 行留史——终态行
    // 在场的 gated 唤醒路径由此承载（abandon 摘钟后行不在，另测锁新形态）
    const goal = await seedGoal(dataDir, { complete: true }); // 激活即完 → inactive（行留史）
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
      expect(row?.activePid).toBeNull(); // 67 轮批注乙：claim 先行后未落地回卷清账（claim 对偶）
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
    expect(err.text).toContain('找不到任务');
  });

  it('件缺席形：--no-plugins 下 --tick 退 2（core:scheduler 不在场）', async () => {
    const { entry, err } = await rigRun({ message: '', flags: { tick: 'any-job', noPlugins: true } });
    await expect(entry).resolves.toBe(2);
    expect(err.text).toContain('core:scheduler');
  });
});

describe('runRunEntry --tick 行启停位（十六役补扫 N26——残留 OS cron 条目对停用行的触发）', () => {
  it('cron 载体形（--read-only）：停用行诚实 gated 跳过退 0——零跑零模型调用 + 结局照记（修前红）', async () => {
    // N26 病灶：registrar 缺席期（env 翻转/unset）disable 不摘 crontab，
    // 残留条目按 cron 节奏继续 spawn `run --read-only --tick`——停用行被
    // 复活执行。修后以 --read-only 辨 cron 载体形：gated 跳过（job_disabled）。
    const dataDir = tmpDir('run-data-');
    const jobWs = tmpDir('run-ws-');
    const seed = await seedAssembly(dataDir);
    seed.scheduler.service.addJob({ name: 'off-job', prompt: '例行巡检', cwd: jobWs, schedule: 'every:30m' }); // 缺省停用
    await seed.shutdown();

    const run = await rigRun({ message: '', flags: { tick: 'off-job', readOnly: true }, dataDir, cwd: jobWs });
    await expect(run.entry).resolves.toBe(0); // 诚实跳过非失败
    expect(run.err.text).toContain('停用');
    expect(run.err.text).toContain('/tick enable off-job'); // 恢复路径指路
    expect(run.out.lines).toEqual([]); // 零跑零产物（修前：照常跑出 'ok'）

    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob('off-job');
      expect(row?.lastOutcome?.reason).toBe('gated'); // 结局照记（每次残触可见）
      expect((row?.lastOutcome as { gate?: string } | undefined)?.gate).toBe('job_disabled');
      expect(row?.lastFireAt).toBeNull(); // 非真跑不动 last_fire_at
      // 67 轮批注乙 S3：停用跳过形不携行快照 next 回写——settle 时刻现算
      // （停用行快照常为 null/陈旧 due 值，原样回写与恢复期胜者结算竞速会
      // 回退 next；enabled=0 行 due 面不消费该列，现算无害）
      expect(row?.nextFireAt).not.toBeNull();
      expect(row?.activePid).toBeNull(); // 零 claim
    } finally {
      await audit.shutdown();
    }
  });

  it('纯手动形（无 --read-only）：停用行照跑——用户显式意图不走闸（判据锚）', async () => {
    const dataDir = tmpDir('run-data-');
    const jobWs = tmpDir('run-ws-');
    const seed = await seedAssembly(dataDir);
    seed.scheduler.service.addJob({ name: 'off-manual', prompt: '例行巡检', cwd: jobWs, schedule: 'every:30m' }); // 缺省停用
    await seed.shutdown();

    const run = await rigRun({ message: '', flags: { tick: 'off-manual' }, dataDir, cwd: jobWs });
    await expect(run.entry).resolves.toBe(0);
    expect(run.out.lines).toEqual(['ok']); // 照跑（手动道不判启停位——/tick run 同律）
  });
});

describe('runRunEntry --tick 让位律（u-2 定形注③乙案子进程侧腿）', () => {
  it('activePid 活体未超钟（ppid 占用）：yielded 让位退 0 + 结局照记 + next 现算不携陈旧快照（67 轮批注乙 S3——修前红：past-due 快照原样回写）', async () => {
    const dataDir = tmpDir('run-data-');
    const jobWs = tmpDir('run-ws-');
    const seed = await seedAssembly(dataDir);
    seed.scheduler.service.addJob({
      name: 'yield-job',
      prompt: '例行巡检',
      cwd: jobWs,
      schedule: 'every:30m',
      enabled: true,
    });
    // 预置他实例占用：ppid = vitest 主进程（活体且必 ≠ 本 worker pid——
    // realIsPidAlive 真身零 mock，探活面同生产）；起跑钟 = 当前（未超钟）。
    // 种子经 claimActive 首登条件形（expect=null——WHERE active_pid IS NULL，
    // 新建行空面必胜；71 轮批注窄面动词收窄后裸 setActive 已除名，种子同迁）
    const t0 = new Date().toISOString();
    seed.scheduler.dao.claimActive('yield-job', process.ppid, t0, t0, null);
    // 行 next 预置 past-due（已过到点值）：胜者结算竞速窗的陈旧快照形——
    // 修前让位 settleGated 携行快照 next 原样回写，会回退胜者（占用方）刚
    // 推进的新 next（67 轮批注乙 S3 病灶：next 回退 + 行立即再 due 双跑窗）
    const pastDue = new Date(Date.now() - 60_000).toISOString();
    // dao 窄面（SchedulerTickSettleFace 四动词——68 轮批注丙扩 clearActiveIf、71 轮批注除名裸 setActive）无 next 单列写——直写库列
    const seedDb = new Database(join(dataDir, 'sessions.db'));
    try {
      seedDb.prepare('UPDATE jobs SET next_fire_at = ? WHERE name = ?').run(pastDue, 'yield-job');
    } finally {
      seedDb.close();
    }
    await seed.shutdown();

    const run = await rigRun({ message: '', flags: { tick: 'yield-job' }, dataDir, cwd: jobWs });
    await expect(run.entry).resolves.toBe(0); // 让位非失败
    expect(run.err.text).toContain('本实例退出');
    expect(run.out.lines).toEqual([]); // 零跑零产物

    // durable 断言：yielded 结局照记 + next 现算（settle 时刻取下一刻——不携
    // past-due 陈旧快照回写）+ 占用面不动
    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob('yield-job');
      expect(row?.lastOutcome?.reason).toBe('yielded');
      expect(row?.lastOutcome?.error).toContain(String(process.ppid));
      expect(row?.lastFireAt).toBeNull(); // 非真跑不动 last_fire_at
      // 修后锚：next 现算为未来刻；修前红锚：原样回写 pastDue（陈旧快照）
      expect(row?.nextFireAt).not.toBe(pastDue);
      expect(Date.parse(row?.nextFireAt ?? '')).toBeGreaterThan(Date.now() - 1000);
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
    // pid 复用误判险形不 yield，残账清后照跑（种子同迁 claimActive 首登条件形）
    const stale = new Date(Date.now() - 40 * 60_000).toISOString();
    seed.scheduler.dao.claimActive('stale-job', process.ppid, stale, stale, null);
    await seed.shutdown();

    const run = await rigRun({ message: '', flags: { tick: 'stale-job' }, dataDir, cwd: jobWs });
    await expect(run.entry).resolves.toBe(0); // 照跑收场（faux 单响应 'ok'）
    expect(run.out.lines).toEqual(['ok']);
    expect(run.err.text).not.toContain('本实例退出'); // 未让位

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

/**
 * --tick 判占回卷（04 §12 律 3 67 轮批注乙 CLI 腿）：claim 先行（判定过即
 * 条件 UPDATE 原子判占）移 goal/用户分支前——判占后一切早退形（goal 件缺席/
 * 续接旗标不兼容/wake 抛错/wake 未落地）必须回卷清账 + gated 结算，否则
 * activePid 滞留成死账（他实例让位律误判让位 + 僵行清扫窗内行饿死）。
 */
describe('runRunEntry --tick 判占回卷（67 轮批注乙：claim 先行 + 早退回卷）', () => {
  it('goal 行 × 续接旗标不兼容（claim 后早退）：退 2 + 回卷清账 + gated 结局照记（修前红：claim 前早退零结算零回卷）', async () => {
    const dataDir = tmpDir('run-data-');
    const goal = await seedGoal(dataDir); // 活跃 goal + 挂钟行在场（daily@09:00）
    const run = await rigRun({ message: '', flags: { tick: `goal-${goal.id}`, session: 'sess-x' }, dataDir });
    // 配置不兼容档照旧退 2（回卷不改判档——只补清账与结算）
    await expect(run.entry).resolves.toBe(2);
    expect(run.err.text).toContain('不兼容');

    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob(`goal-${goal.id}`);
      expect(row?.lastOutcome?.reason).toBe('gated'); // 回卷 gated 结局照记（修前红锚：早退零结算）
      expect(row?.lastOutcome?.error).toContain('不兼容');
      expect(row?.lastFireAt).toBeNull(); // 非真跑不动 last_fire_at
      expect(row?.nextFireAt).not.toBeNull(); // next 照推进（行不永 due 反复过判占面）
      expect(row?.activePid).toBeNull(); // 回卷清账（claim 对偶——不滞留死账）
    } finally {
      await audit.shutdown();
    }
  });
});

/**
 * --tick 判占回卷清账对偶（04 §12 律 3 68 轮批注丙——判占者方清己账）：
 * claim 后他进程可对死/超钟残账条件判占接管落新 pid——回卷腿修前无条件
 * setActive 会抹其新 claim（被抹后该实例真在飞而行面 idle → 第三进程再
 * 判占同名双跑）。回卷清账须条件化：期望 = 本 CLI 判占 pid，易主即弃清。
 */
describe('runRunEntry --tick 判占回卷清账对偶（68 轮批注丙——判占者方清己账）', () => {
  it('红锁C：claim 后他进程接管（active_pid 易主 999）——回卷清账不抹新占用，结算照走（修前红：无条件清账抹成 null）', async () => {
    const dataDir = tmpDir('run-data-');
    const goal = await seedGoal(dataDir); // 活跃 goal + 挂钟行在场（daily@09:00）
    // 行漂移形（wake 顶面 dao.get 缺行抛 GOAL_NOT_FOUND）——claim 后必经回卷腿
    const db = new Database(join(dataDir, 'sessions.db'));
    try {
      db.prepare('DELETE FROM goals WHERE id = ?').run(goal.id);
      // 「claim 后 SQL 直改 active_pid=999」的确定性压缩形：claim→回卷之间零
      // 宏任务边界（同步块 + 微任务链——进程内测试窗内插针不可达），以
      // AFTER UPDATE 触发器把接管写在 claim 语句原子上（NEW.active_pid =
      // 本 CLI pid 即改 999——「快照→回卷窗内他进程条件判占接管」的窗内真值
      // 形；触发器子改不计外层 changes——判占胜者判定不受扰，已实测）
      db.exec(
        `CREATE TRIGGER takeover_after_claim AFTER UPDATE OF active_pid ON jobs
         WHEN NEW.active_pid = ${process.pid} AND NEW.active_pid IS NOT NULL
         BEGIN UPDATE jobs SET active_pid = 999 WHERE name = NEW.name; END`,
      );
    } finally {
      db.close();
    }

    const run = await rigRun({ message: '', flags: { tick: `goal-${goal.id}` }, dataDir });
    await expect(run.entry).resolves.toBe(0); // wake 兜错退 0 照旧（回卷不改判档）
    expect(run.err.text).toContain('唤醒判定失败');

    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob(`goal-${goal.id}`);
      expect(row?.activePid).toBe(999); // 修前红锚：无条件回卷清账抹成 null——新占用保住
      expect(row?.lastOutcome?.reason).toBe('gated'); // 回卷结算照记（settle 行为本笔不动）
      expect(row?.lastOutcome?.error).toContain('唤醒判定失败');
      expect(row?.lastFireAt).toBeNull(); // 非真跑不动 last_fire_at
      expect(row?.nextFireAt).not.toBeNull(); // next 照推进
    } finally {
      await audit.shutdown();
    }
  });
});

/**
 * --tick 收场清账/起跑覆写条件化（04 §12 律 3 69 轮补笔——清账对偶律枚举
 * 非穷尽）：一切己方清账写位（settleTick 收场清账）与自覆写写位（起跑记账
 * 覆写）同律——清账走 clearActiveIf(己 pid) 条件形（吞错律 21 轮件10 同辖：
 * 清账瞬态错不翻退出码）、覆写走 claimActive(expect=己 pid) 条件形；changes=0
 * 即占用已易主——留新占用不抹。
 */
describe('runRunEntry --tick 收场清账/起跑覆写条件化（69 轮补笔——清账对偶律枚举位）', () => {
  it('红锁C1：settleTick 收场清账条件对偶——收场窗内他进程接管（active_pid 易主 999）后弃清不抹 + stderr 让位留痕（修前红：无条件清账抹成 null）', async () => {
    const dataDir = tmpDir('run-data-');
    const jobWs = tmpDir('run-ws-');
    const seed = await seedAssembly(dataDir);
    seed.scheduler.service.addJob({
      name: 'c1-job',
      prompt: '例行巡检',
      cwd: jobWs,
      schedule: 'every:30m',
      enabled: true,
    });
    const nextBefore = seed.scheduler.service.getJob('c1-job')?.nextFireAt;
    await seed.shutdown();
    // AFTER UPDATE 触发器（红锁C 同手法）：claim 落本 CLI pid 即改 999——
    // 「claim→收场窗内他进程对死/超钟残账条件判占接管」的确定性压缩形。
    // 收场清账写 NULL 不中 WHEN 子句（NEW.active_pid 非 pid）：修前
    // setActive(null) 直接抹 null；修后 clearActiveIf(己 pid) 失配弃清——999 保住
    const db = new Database(join(dataDir, 'sessions.db'));
    try {
      db.exec(
        `CREATE TRIGGER takeover_after_claim AFTER UPDATE OF active_pid ON jobs
         WHEN NEW.active_pid = ${process.pid} AND NEW.active_pid IS NOT NULL
         BEGIN UPDATE jobs SET active_pid = 999 WHERE name = NEW.name; END`,
      );
    } finally {
      db.close();
    }

    const run = await rigRun({ message: '', flags: { tick: 'c1-job' }, dataDir, cwd: jobWs });
    await expect(run.entry).resolves.toBe(0); // run 正常跑完（清账让位不翻退出码）
    expect(run.err.text).toContain('收场清账让位'); // 修后让位留痕（修前无此句）

    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob('c1-job');
      expect(row?.activePid).toBe(999); // 修前红锚：无条件清账抹成 null
      expect(row?.lastOutcome?.reason).toBe('exit_code'); // 结算照走
      expect(row?.lastFireAt).not.toBeNull(); // last_fire_at 正常推进
      expect(Date.parse(row?.nextFireAt ?? '')).toBeGreaterThan(Date.parse(nextBefore ?? '')); // next 正常
    } finally {
      await audit.shutdown();
    }
  });

  it('红锁C3：起跑记账覆写条件自覆写——claim 后窗内接管（999）覆写失配弃抹 + 收场清账同失配双弃清（修前红：覆写写回 pid、收场又抹 null）', async () => {
    const dataDir = tmpDir('run-data-');
    const jobWs = tmpDir('run-ws-');
    const seed = await seedAssembly(dataDir);
    seed.scheduler.service.addJob({
      name: 'c3-job',
      prompt: '例行巡检',
      cwd: jobWs,
      schedule: 'every:30m',
      enabled: true,
    });
    await seed.shutdown();
    // 一次性接管触发器（计数表闸首写）：claim 首落本 CLI pid 即改 999 仅一次
    // ——「claim→起跑记账窗内他进程条件判占接管」的确定性压缩形。单发形保
    // 窗内真值：修前 :466 无条件覆写把 999 抹回 pid、收场又抹 null；修后
    // 覆写与收场清账双双失配弃清——999 保住
    const db = new Database(join(dataDir, 'sessions.db'));
    try {
      db.exec(
        `CREATE TABLE takeover_once (id INTEGER PRIMARY KEY CHECK (id = 1), done INTEGER NOT NULL DEFAULT 0);
         INSERT INTO takeover_once (id, done) VALUES (1, 0);
         CREATE TRIGGER takeover_once_after_claim AFTER UPDATE OF active_pid ON jobs
         WHEN NEW.active_pid = ${process.pid} AND NEW.active_pid IS NOT NULL
              AND (SELECT done FROM takeover_once WHERE id = 1) = 0
         BEGIN
           UPDATE jobs SET active_pid = 999 WHERE name = NEW.name;
           UPDATE takeover_once SET done = 1 WHERE id = 1;
         END`,
      );
    } finally {
      db.close();
    }

    const run = await rigRun({ message: '', flags: { tick: 'c3-job' }, dataDir, cwd: jobWs });
    await expect(run.entry).resolves.toBe(0); // 让位只影响记账面——run 语义不变照跑
    expect(run.err.text).toContain('起跑记账让位'); // 覆写失配留痕
    expect(run.err.text).toContain('收场清账让位'); // 收场清账同失配弃清

    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob('c3-job');
      expect(row?.activePid).toBe(999); // 修前红锚：覆写写回 pid、收场又抹 null——终值 null
      expect(row?.lastOutcome?.reason).toBe('exit_code'); // 结算照走
      expect(row?.lastFireAt).not.toBeNull();
      expect(row?.nextFireAt).not.toBeNull();
    } finally {
      await audit.shutdown();
    }
  });
});

describe('runRunEntry --tick 乙案双收口（65 轮件B：wake 兜错 + claim 后自杀钟）', () => {
  it('wake reject（goals 行漂移）：诚实 gated 记账 + 退 0（修前红：裸 await 抛穿崩溃档退 1 零结算——行永 due cron 每轮照炸）', async () => {
    const dataDir = tmpDir('run-data-');
    // 活跃 goal + 挂钟行在场；漂移形 = goals 行被删而挂钟行残留——wake 顶面
    // dao.get 缺行抛 GOAL_NOT_FOUND（真抛非 mock——读史失败族由件A 折
    // landed=false，行漂移形仍走 reject，CLI 腿兜错独立成立）
    const goal = await seedGoal(dataDir);
    const db = new Database(join(dataDir, 'sessions.db'));
    try {
      db.prepare('DELETE FROM goals WHERE id = ?').run(goal.id);
    } finally {
      db.close();
    }

    const run = await rigRun({ message: '', flags: { tick: `goal-${goal.id}` }, dataDir });
    // 修前红锚：wake 抛错直穿 executeRun → 外层崩溃档（run 执行失败 + 退 1 +
    // 行零结算）；修后 = 判定失败非执行失败——gated 结局照记 + 零跑退 0
    await expect(run.entry).resolves.toBe(0);
    expect(run.err.text).toContain('唤醒判定失败');
    expect(run.out.lines).toEqual([]); // 零跑零产物

    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob(`goal-${goal.id}`);
      expect(row?.lastOutcome?.reason).toBe('gated'); // 失败折 gated 结局（与不落地分支同形）
      expect(row?.lastOutcome?.error).toContain('唤醒判定失败');
      expect(row?.lastFireAt).toBeNull(); // 非真跑不动 last_fire_at
      expect(row?.nextFireAt).not.toBeNull(); // next 照推进（行不再永 due 反复过 wake 面）
      expect(row?.activePid).toBeNull(); // 67 轮批注乙：claim 先行后兜错回卷清账（claim 对偶）
    } finally {
      await audit.shutdown();
    }
  });

  it('自杀钟（修前红）：claim 同拍挂钟到点后 run 被协作中止 + settle timeout 终态', async () => {
    const dataDir = tmpDir('run-data-');
    const jobWs = tmpDir('run-ws-');
    const seed = await seedAssembly(dataDir);
    seed.scheduler.service.addJob({
      name: 'wall-job',
      prompt: '例行巡检',
      cwd: jobWs,
      schedule: 'every:30m',
      enabled: true,
    });
    const nextBefore = seed.scheduler.service.getJob('wall-job')?.nextFireAt;
    await seed.shutdown();

    // 墙钟注入提速（tickWallTimeoutMs seam——引擎 deps.wallTimeoutMs 同形）：
    // 缺省 30 分钟不可等；机制同帽源不因注入变语义（claim 同拍挂钟/到点
    // 协作中止/settle timeout 三环全同）。不用全局 fake timers 推进 30min——
    // 全栈插件世界（scheduler 引擎钟/shutdown 帽）同窗引爆，run 在钟响前即
    // 被无关环境态击落（实证：'No more faux responses queued' 噪声失败）
    const WALL_MS = 4_000;
    // 响应只认中止信号放行（生产 llm 层 signal honor 行为——真协作中止面）；
    // 入场即 aborted 形也记 hit（钟在 ⑥ 前段先响 → 迟到消费位中止 → 首调
    // 即见 aborted——两形皆协作中止真达模型层信号面）
    let abortHit = false;
    const run = await rigRun({ message: '', flags: { tick: 'wall-job' }, dataDir, cwd: jobWs, wallMs: WALL_MS });
    run.faux.setResponses([
      (_context, options) =>
        new Promise<PiAssistantMessage>((resolve) => {
          const finish = (): void => resolve(messageOf());
          const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
          if (signal === undefined) return; // 无信号形挂起——绿路径必有信号（buildPiOptions 透传）
          if (signal.aborted) {
            abortHit = true;
            finish();
            return;
          }
          signal.addEventListener(
            'abort',
            () => {
              abortHit = true;
              finish();
            },
            { once: true },
          );
        }),
    ]);
    // 真实时钟等钟响窗（claim + WALL_MS < 此处等待——钟到点必已执法）
    await new Promise((resolve) => setTimeout(resolve, WALL_MS + 2_000));
    expect(abortHit).toBe(true); // 修前红锚：钟缺席 → 中止永不上门（run 照常挂起）

    await expect(run.entry).resolves.toBe(1); // aborted → 退出码 1（failed/aborted 同档）
    expect(run.err.text).toContain('墙钟'); // stderr 诚实句

    const audit = await seedAssembly(dataDir);
    try {
      const row = audit.scheduler.service.getJob('wall-job');
      expect(row?.lastOutcome?.reason).toBe('timeout'); // 引擎 kill→settle 同源 reason 词（不另造词）
      expect(row?.lastOutcome?.error).toContain('墙钟超时'); // 动词形镜像（scheduler-tick killedReason 折叠形）
      expect(row?.lastFireAt).not.toBeNull(); // timeout 非 gated——真跑面 settleFire 推进
      expect(row?.activePid).toBeNull(); // claim 清账对偶
      expect(Date.parse(row?.nextFireAt ?? '')).toBeGreaterThan(Date.parse(nextBefore ?? '')); // next 推进
    } finally {
      await audit.shutdown();
    }
  });
});

describe('runRunEntry --tick goal 挂钟行', () => {
  it('wake 不落（终态 goal）：诚实零跑退 0 + stderr 说明', async () => {
    const dataDir = tmpDir('run-data-');
    // 终态分工（03 §10.5 定形注②）随迁：complete = disable 行留史——终态
    // gated 唤醒路径由 complete 承载（abandon 摘钟行不在，见下测新形态锁）
    const goal = await seedGoal(dataDir, { complete: true }); // 激活即完 → inactive（行留史）
    const run = await rigRun({ message: '', flags: { tick: `goal-${goal.id}` }, dataDir });
    await expect(run.entry).resolves.toBe(0); // 零跑零账——诚实零跑
    expect(run.err.text).toContain('未唤醒');
    expect(run.out.lines).toEqual([]); // text 档零产物（无 assistant 输出）
  });

  it('abandon 摘钟后行不在：--tick 找不到任务退 2（配置漂移档——03 §10.5 定形注② remove 删行新形态）', async () => {
    const dataDir = tmpDir('run-data-');
    const goal = await seedGoal(dataDir, { abandon: true }); // 激活即弃 → 挂钟行已摘
    const run = await rigRun({ message: '', flags: { tick: `goal-${goal.id}` }, dataDir });
    await expect(run.entry).resolves.toBe(2); // 行缺席档（旧形：disable 行留史 → gated 未唤醒退 0）
    expect(run.err.text).toContain('找不到任务'); // 变更证据形——勿断言整句
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
    expect(err.text).toContain('Web 界面组件未安装'); // warn 披露（件未装载语义族）
  });

  it('provider unconfigured：产品级文案点名模型 + 配置途径（07 §5）退 1', async () => {
    // providers 只有 faux-run 而点名缺席模型 → LLM_MODEL_NOT_FOUND → run failed
    const { entry, err } = await rigRun({ model: 'faux-x/m1' });
    await expect(entry).resolves.toBe(1);
    expect(err.text).toContain('模型不可用'); // 产品级文案（非裸报文）
    expect(err.text).toContain('faux-x/m1'); // 点名模型标识
    expect(err.text).toContain('BERRY_AGENT_MODEL'); // 配置途径指路
  });

  it('--port 端口占用：干净退 1 + 不写 crash.log（:438 注释承诺的回归锁）', async () => {
    // 预期内环境态（EADDRINUSE）= 干净呈报档：abortTick('--port 开面失败') +
    // stderr 一行 + 退 1——不落崩溃取证（对照 runRunEntry 外层 catch 的
    // writeCrashLog 档：此路径若误吞到外层即 crash.log 落盘，本例即红）
    const occupied = await occupyTcpPort();
    try {
      const run = await rigRun({ flags: { port: occupied.port } });
      await expect(run.entry).resolves.toBe(1);
      expect(run.err.text).toContain('--port 开启失败'); // 归一文案（固定串非 AI 文本）
      expect(existsSync(join(run.dataDir, 'crash.log'))).toBe(false); // 干净退出档零崩溃取证
    } finally {
      await occupied.close();
    }
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
