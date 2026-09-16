/**
 * host — SIGTERM 优雅退出进程级 e2e（B6）。
 *
 * 现状背景：信号编舞（installSignalChoreography）的优雅序此前只有进程内
 * 注入形（signals.test.ts 收调用序——register/exit 均假面）；「真 SIGTERM
 * 打到真进程 → 优雅序跑完（flush + checkpoint 关库）→ 干净退 0 → 落库
 * 数据完好」零进程级实证。serve stop 的进程外管理动词（runServeStop）走
 * 的正是 TERM——本链是无人值守停机编舞的行为底座。
 *
 * 本文件补真子进程例（镜像 persist/kill-recovery.test.ts 的 tsx 真子进程
 * 基建——TSX_CLI + PID 行协议 + ACK 进度行 + ESRCH 探活）：子进程以生产
 * 装配面（installSignalChoreography 真注册 + Persistence.open 真库 + env
 * 梯子 BERRY_AGENT_DATA_DIR 指临时目录）循环写事件，每笔 flush 落定后打
 * ACK 进度行；父进程读到第 K 笔 ACK 即对**脚本自报 pid** 发 SIGTERM（确定
 * 性击打点——进度行驱动非 sleep 赌时序），随后断言三面：
 *  - (a) 优雅退 0：子进程在 ~10s 窗内以码 0 退场（非信号杀形〔signal
 *    null〕、非 SIGINT② 的 130）+ CLOSED 行在场（优雅序完成的心跳行）+
 *    写循环被优雅窗打断（末笔 ACK 远未达 TOTAL——防「先自然跑完再退 0」
 *    的假绿形：TOTAL 笔全 ACK 在场 = SIGTERM 从未生效）；
 *  - (b) 落库完好（flush 屏障）：重开库后已 ACK 的前 K 笔全在（synchronous
 *    =FULL：flush 返回 = 已持久）+ seq 连续无洞（0..N-1）+ 首前缀内容
 *    逐笔保真（payload-i 精确往返）；
 *  - (c) checkpoint 干净（弱断言——非实现绑定）：-wal 缺席或零字节
 *    （close = wal_checkpoint(TRUNCATE) 的旁证；实现换代只须落库完好
 *    〔(b)〕即合格，本面缺席不判红）。
 *
 * 击杀目标勘误（承 kill-recovery 踩出的谱）：spawn 直子是 tsx 包装进程，
 * 目标脚本以孙进程形态起跑（child.pid ≠ 脚本 pid）——TERM 必须发给脚本
 * 自报 pid（PID 行协议），且须 ESRCH 确认真死后才允许重开库断言。
 *
 * 优雅窗竞态处置（设计注）：SIGTERM 到达时写循环可能在途（当前
 * append/flush 进行中）——优雅序的 close() 与写循环同进程交错属预期：
 * 写循环以 closing 位让位 + 整环 try/catch 兜底（close 后续 flush 抛
 * 「已关闭」静默吞——退出码归编舞单源，不让竞态升级为 unhandled 染红
 * 退码）。Windows 不虑（v1 显式不支持——信号面 Unix 唯一）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { Persistence } from '../persist/persistence.js';

/* ---------------- tsx 真子进程基建（kill-recovery.test.ts 同族） ---------------- */

/** 仓内 tsx CLI（src/host → 上两级 = 仓根——子进程以 tsx 转译真源码形态起跑） */
const TSX_CLI = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));

/** 临时目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 新临时目录（realpath 防 macOS /var 符号链） */
function makeTmpDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
  dirs.push(dir);
  return dir;
}

/** 子进程登记簿（兜杀——失败路径不留孤儿；脚本 pid 见 scriptPids 注） */
const children: ChildProcess[] = [];
/** 子脚本自报 pid 登记（tsx 孙进程——杀直子杀不到它，兜杀必须点名真身） */
const scriptPids: number[] = [];
afterAll(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  for (const pid of scriptPids.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 已死（ESRCH）——兜杀幂等
    }
  }
});

/**
 * 写入子进程脚本（生产装配面）：installSignalChoreography 真注册（缺省
 * register/exit = process.on/process.exit——与 main 装配位同形）+ env 梯子
 * 开真库 → 循环「append → flush → ACK 行」。SIGTERM → onGraceful 承载
 * `await persistence.close()`（flush → wal_checkpoint(TRUNCATE) → 关库）
 * → 退 0——即 daemon/run 实装里 `runtime.shutdown` 优雅序的持久层缩形。
 */
const CHILD_SCRIPT = `// cfg 经末位 argv 注入（JSON 串）：总笔数 + 每笔载荷字节数
const cfg = JSON.parse(process.argv[process.argv.length - 1]);
// 自报 pid（首行协议）——tsx 以孙进程形态跑本脚本，父进程直杀 child.pid
// 只能杀到 tsx 包装层，TERM 目标必须是这里自报的真身
process.stdout.write('PID:' + process.pid + '\\n');
const { Persistence } = await import(process.env.SIGTERM_E2E_PERSISTENCE_PATH);
const { installSignalChoreography } = await import(process.env.SIGTERM_E2E_SIGNALS_PATH);
const persistence = Persistence.open(); // env 梯子 → BERRY_AGENT_DATA_DIR 下 sessions.db
const log = persistence.createSession({ origin: 'conversation', workspaceRoot: '/sigterm-e2e' });
process.stdout.write('SID:' + log.sessionId + '\\n');
// 优雅窗让位位：SIGTERM 后写循环静默停（竞态兜底见整环 try/catch）
let closing = false;
// 生产形信号编舞：SIGTERM → draining → onGraceful（flush+checkpoint 关库）
// → 退码 0（finish(code ?? 0)——优雅序缺省档）；register/exit 全走缺省
// 真面（process.on / process.exit——与 main.ts 装配位同形，零注入）
installSignalChoreography({
  onGraceful: async () => {
    closing = true;
    await persistence.close(); // 优雅序持久面：flush → wal_checkpoint(TRUNCATE) → 关库
    // 心跳行（回执 flush 后再退——防 process.exit 截断 pipe 缓冲丢行）
    await new Promise((resolve) => process.stdout.write('CLOSED\\n', () => resolve()));
    return 0; // 优雅序缺省退码档（04 §1）
  },
});
try {
  for (let i = 0; i < cfg.total; i++) {
    if (closing) break; // 优雅窗竞态：让位（close 与写循环同进程交错属预期）
    const pad = 'x'.repeat(cfg.payloadBytes); // 2KiB 级载荷——每笔有真 fsync 工作量
    log.append('user/message', { content: 'payload-' + i + '-' + pad, source: 'user' });
    await persistence.flush(); // 写队列排空 = 已提交（synchronous=FULL：flush 返回 = 已持久）
    process.stdout.write('ACK:' + i + '\\n');
    // 2ms/笔节拍：快盘上 400 笔 fsync 可 <300ms 跑完（TERM 追不上自然完笔
    // ——击打点退化为「循环后休止态」）；节拍把全程拉到 ≥800ms，TERM 恒落
    // 写盘中段（进度行驱动 + 节拍双保险——不赌盘速）
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
} catch {
  // 优雅窗内 close 与写循环竞态：close 后的 append/flush 抛「已关闭」属
  // 预期内竞态——静默让位（退出码归编舞单源，不升格 unhandled 染红退码）
}
`;

/** tsx 包装进程退出信号 */
interface TermRun {
  /** 累计 stdout/stderr（诊断现场） */
  output: () => string;
  /** tsx 包装进程退出（脚本真身退场后随之收口——退码透传） */
  exited: Promise<{ code: number | null; signal: string | null }>;
  /** 已见行（实时追加——击打判据读这里） */
  lines: () => string[];
}

/** 探活（ESRCH = 真死——TERM 优雅退场后确认真身已退才可重开库断言） */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = 进程不存在（已退）；EPERM 等其它错按存活论（保守）
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * 起子进程写到第 termAt 笔 ACK 即对**脚本真身 pid** 发 SIGTERM（确定性击
 * 打点——读到 ACK:K 才发，K 笔已提交落定；不 sleep 不赌时序）。TERM 目标
 * 取 PID 行自报值（tsx 包装与目标脚本两 pid——孙进程形态）。
 */
function spawnAndTermAtAck(scriptPath: string, dataDir: string, total: number, termAt: number): TermRun {
  const cfg = JSON.stringify({ total, payloadBytes: 2048 });
  const child = spawn(process.execPath, [TSX_CLI, scriptPath, cfg], {
    env: {
      ...process.env,
      // 独立临时数据目录（env 梯子第 1 级——子进程生产开库路径全由此定向）；
      // 库文件级覆盖（梯子第 2 级）显式清空——外部环境残值不得劫持子库定位
      BERRY_AGENT_DATA_DIR: dataDir,
      BERRY_AGENT_DB_PATH: '',
      // 子脚本经 env 拿两模块真源路径（脚本自身在临时目录无相对链）
      SIGTERM_E2E_PERSISTENCE_PATH: fileURLToPath(new URL('../persist/persistence.ts', import.meta.url)),
      SIGTERM_E2E_SIGNALS_PATH: fileURLToPath(new URL('./signals.ts', import.meta.url)),
      BERRY_AGENT_LOG_LEVEL: 'silent',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  // stdout 独占行解析（stderr 混流会撕裂 ACK 行——诊断输出另攒）
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const seenLines: string[] = [];
  let scriptPid: number | undefined;
  let termed = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    outChunks.push(chunk);
    // 行切分（不完整尾行留 buffer——ACK 判据只认完整行）
    const whole = outChunks.join('');
    const lastBreak = whole.lastIndexOf('\n');
    if (lastBreak !== -1) {
      for (const line of whole.slice(0, lastBreak).split('\n')) {
        if (line !== '') seenLines.push(line);
      }
      outChunks.length = 0;
      outChunks.push(whole.slice(lastBreak + 1));
    }
    // 脚本真身 pid 首见即登记（兜杀点名 + TERM 目标）
    const pidLine = seenLines.find((line) => line.startsWith('PID:'));
    if (pidLine !== undefined && scriptPid === undefined) {
      scriptPid = Number.parseInt(pidLine.slice('PID:'.length), 10);
      if (Number.isInteger(scriptPid)) scriptPids.push(scriptPid);
      else scriptPid = undefined;
    }
    // 确定性击打点：第 K 笔 ACK 在场即对真身发 TERM（ACK 由 flush 后打印
    // ——K 笔已提交；TERM 送达时写循环仍在写盘活动中段——优雅序真跑形）
    if (!termed && scriptPid !== undefined && seenLines.some((line) => line === `ACK:${termAt}`)) {
      termed = true;
      try {
        process.kill(scriptPid, 'SIGTERM');
      } catch {
        // 真身已先退（罕见竞态）——CLOSED/退码断言会把退化形抓出来
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => errChunks.push(chunk)); // tsx 报错混收——诊断现场
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  return { output: () => outChunks.concat(errChunks).join(''), exited, lines: () => seenLines };
}

/** 等判词转真（超时抛错带现场——防子进程悬死挂测试） */
async function waitFor(what: string, timeoutMs: number, pred: () => boolean, output: () => string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (pred()) return;
    if (Date.now() > deadline) {
      throw new Error(`等待超时（${what}，${timeoutMs}ms）——当前输出尾段：\n${output().slice(-1500)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/* ---------------- SIGTERM 优雅退出三面断言 ---------------- */

describe('SIGTERM 优雅退出（真子进程 + 生产信号编舞 + 真库重开）', () => {
  it('ACK:K 发 TERM → 优雅退 0 + 已 ACK 事件全在 seq 连续 + checkpoint 干净', async () => {
    const scriptDir = makeTmpDir('sigterm-e2e-script-');
    const scriptPath = join(scriptDir, 'child.mts');
    writeFileSync(scriptPath, CHILD_SCRIPT);
    const dataDir = makeTmpDir('sigterm-e2e-data-');

    // 确定性击打点：第 8 笔 ACK（K=8 → 已提交 9 笔）；总笔数 400 ≫ K——
    // TERM 恒落在写盘活动中段（优雅窗竞态真形非空转形）
    const TERM_AT = 8;
    const TOTAL = 400;
    const run = spawnAndTermAtAck(scriptPath, dataDir, TOTAL, TERM_AT);

    // 读到脚本真身 pid（tsx 孙进程自报——TERM 目标）与会话 id（开库成功）
    await waitFor('子进程真身 pid（PID 行）', 45_000, () => run.lines().some((l) => l.startsWith('PID:')), run.output);
    const scriptPid = Number.parseInt(
      run
        .lines()
        .find((l) => l.startsWith('PID:'))!
        .slice('PID:'.length),
      10,
    );
    expect(Number.isInteger(scriptPid)).toBe(true);
    await waitFor('子进程开库（SID 行）', 45_000, () => run.lines().some((l) => l.startsWith('SID:')), run.output);
    const sessionId = run
      .lines()
      .find((l) => l.startsWith('SID:'))!
      .slice('SID:'.length);

    // ── (a) 优雅退 0：CLOSED 心跳行在 10s 窗内达（优雅序完成）──
    await waitFor('优雅序完成（CLOSED 行，10s 窗）', 10_000, () => run.lines().includes('CLOSED'), run.output);
    // 包装进程随之退场（10s 窗 race——悬挂由 afterAll 兜杀收）
    const settle = await Promise.race([
      run.exited,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('包装进程 10s 未退')), 10_000)),
    ]);
    expect(settle.code).toBe(0); // 优雅序缺省退码档（onGraceful 返回 0）
    expect(settle.signal).toBe(null); // 非信号杀形（TERM 被编舞吸收非默认致死）
    // 真身确认退场（ESRCH）——旁证退出非「包装层独退、脚本悬死」
    expect(isProcessAlive(scriptPid)).toBe(false);
    // 写循环被优雅窗打断：末笔 ACK 远未达 TOTAL（TOTAL 笔全 ACK 在场 =
    // SIGTERM 从未生效的假绿形——自然跑完也退 0，本断言把它挡在门外）
    expect(run.lines()).not.toContain(`ACK:${TOTAL - 1}`);
    expect(run.lines()).toContain(`ACK:${TERM_AT}`); // 击打点前置自证（K 笔确已提交）

    // ── (b) 落库完好（flush 屏障）：生产恢复路径重开（env 梯子同上）──
    // 测试进程 env 短暂改道到子数据目录（open 后恢复原值——vitest-setup
    // 钉扎面不受扰；库文件级覆盖同刻清空——外部残值不得劫持重开定位）
    const savedDataDir = process.env.BERRY_AGENT_DATA_DIR;
    const savedDbPath = process.env.BERRY_AGENT_DB_PATH;
    process.env.BERRY_AGENT_DATA_DIR = dataDir;
    delete process.env.BERRY_AGENT_DB_PATH;
    let persistence: Persistence | undefined;
    try {
      persistence = Persistence.open(); // 优雅关库后重开——干净库（无 WAL 残卷自愈负担）
      expect(persistence.hasSession(sessionId)).toBe(true);

      // 快照即拍即拷：events() 回的是活体数组引用——不拷贝则断言基准漂移
      const loaded = persistence.loadSession(sessionId);
      const recovered = [...loaded.log.events()];
      // 已 ACK 的 K 笔全在（宁不丢——flush 返回 = 已持久的进程级实证）
      expect(recovered.length).toBeGreaterThanOrEqual(TERM_AT + 1);
      // 上界：优雅窗打断后不再追加（closed 让位 + close 关库——追加窗闭合）
      expect(recovered.length).toBeLessThanOrEqual(TOTAL);
      // seq 连续无洞（0..N-1 逐位相等——优雅序与写循环竞态不落半行）
      expect(recovered.map((e) => e.seq)).toEqual(recovered.map((_, i) => i));
      // 首前缀内容逐笔保真（每笔载荷带笔号——精确对拍）
      for (let i = 0; i <= TERM_AT; i++) {
        const content = (recovered[i]!.data as { content: string }).content;
        expect(content.startsWith(`payload-${i}-`)).toBe(true);
        expect(content).toHaveLength(`payload-${i}-`.length + 2048);
      }

      // ── (c) checkpoint 干净（弱断言——非实现绑定）：-wal 缺席或零字节 ──
      const walPath = join(dataDir, 'sessions.db-wal');
      const walOk = !existsSync(walPath) || statSync(walPath).size === 0;
      expect(walOk).toBe(true); // close = wal_checkpoint(TRUNCATE) 旁证
    } finally {
      // 恢复路径收口：关库 + env 复原（finally 保证异常路径不泄漏）
      await persistence?.close();
      if (savedDataDir === undefined) delete process.env.BERRY_AGENT_DATA_DIR;
      else process.env.BERRY_AGENT_DATA_DIR = savedDataDir;
      if (savedDbPath === undefined) delete process.env.BERRY_AGENT_DB_PATH;
      else process.env.BERRY_AGENT_DB_PATH = savedDbPath;
    }
  }, 90_000);
});
