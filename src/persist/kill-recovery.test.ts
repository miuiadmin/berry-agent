/**
 * persist — kill -9 进程级恢复实证测试（W4 异常矩阵三缺口之一）。
 *
 * 现状背景：恢复不变式（撕裂尾自愈/宁拒勿删/seq 连续性）此前只有进程内
 * 逻辑注入形（store.test.ts :225-258 期望族——SQL UPDATE 造坏行）；真
 * SIGKILL 下「已确认提交的事件不丢、库可开、恢复后续写不撞」零进程级
 * 实证（评估实测：kill -9 进程级恢复全为零）。
 *
 * 本文件补真子进程例（镜像 run-issue-verify.test.ts / engine-restore.pty
 * .test.ts 的 tsx 真子进程模式）：子进程以生产装配面（Persistence.open +
 * BERRY_AGENT_DATA_DIR env 梯子——env 指临时目录即独立数据目录）开真库
 * 循环写事件，**每笔 flush 落定后**向 stdout 打 ACK 进度行；父进程读到
 * 第 K 笔 ACK 即对该 pid 发 SIGKILL（确定性击杀点——进度行驱动，非 sleep
 * 赌时序），随后以同一恢复路径（Persistence.open → loadSession）重开库，
 * 断言进程级恢复不变式：
 *  - 重开不抛（WAL 残卷自愈——SIGKILL 后 -wal/-shm 残留是常态，SQLite
 *    帧校验和自动恢复，openStore 门禁序直通）；
 *  - 已 ACK 的前 K 笔全在（synchronous=FULL：flush 返回 = 已持久——宁不丢）；
 *  - 恢复前缀 seq 连续（0..N-1 无洞——原子性：击杀点在途事务要么全在
 *    要么全无，无半行）；
 *  - 首前缀内容逐笔保真（payload-i 精确往返）；
 *  - 恢复后续写不撞（loadSession 种子重建后 append + flush 直写 seq=N，
 *    不触发 PERSIST_DATA_CORRUPT 写序违约）。
 *
 * 击杀目标勘误（本测试踩出的谱）：spawn 的直子是 tsx 包装进程，**目标脚本
 * 由 tsx 以孙进程形态起跑**（实证：child.pid ≠ 脚本自身 pid）——杀直子只会
 * 孤儿化脚本进程（库仍在被写、读数持续上涨、续写必撞写序违约）。故击杀
 * 目标 = 子脚本自报 pid（PID 行协议），且须确认其真死（ESRCH 探活）后才
 * 允许重开——孤儿在场时重开读到的「恢复前缀」是与活写者竞态的快照，一切
 * 断言皆失义。
 *
 * 期望族对齐注：store.test.ts 的撕裂尾 heal（末行坏 JSON 截断）与宁拒勿删
 * （中段损坏拒读）是**逻辑层防御纵深**——SIGKILL 物理上造不出 SQL 行级
 * 撕裂（SQLite 事务原子性 + WAL 帧校验和是第一道防线），进程级实证钉的
 * 正是这道第一防线：击杀后落到 loadEvents 的事件恒为干净前缀。Windows
 * 不虑（v1 显式不支持——信号面 Unix 唯一）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { Persistence } from './persistence.js';

/* ---------------- tsx 真子进程基建（engine-restore.pty.test.ts 同族） ---------------- */

/** 仓内 tsx CLI（src/persist → 上两级 = 仓根——子进程以 tsx 转译真源码形态起跑） */
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
 * 写入子进程脚本（真生产装配面）：env 梯子（BERRY_AGENT_DATA_DIR）指独立
 * 临时目录开真库 → createSession → 循环「append → flush → ACK 行」。
 * 大载荷（2KiB/笔）让每笔事务有真 fsync 工作量——击杀点落在写盘活动期
 * 的概率最大化（对空闲间隙击杀的弱化形说不）。
 */
const CHILD_SCRIPT = `// cfg 经末位 argv 注入（JSON 串）：总笔数 + 每笔载荷字节数
const cfg = JSON.parse(process.argv[process.argv.length - 1]);
// 自报 pid（首行协议）——tsx 以孙进程形态跑本脚本，父进程直杀 child.pid
// 只能杀到 tsx 包装层，击杀目标必须是这里自报的真身
process.stdout.write('PID:' + process.pid + '\\n');
const { Persistence } = await import(process.env.KILL_RECOVERY_PERSISTENCE_PATH);
const persistence = Persistence.open(); // env 梯子 → BERRY_AGENT_DATA_DIR 下 sessions.db（生产恢复同路径）
const log = persistence.createSession({ origin: 'conversation', workspaceRoot: '/kill-recovery' });
process.stdout.write('SID:' + log.sessionId + '\\n');
for (let i = 0; i < cfg.total; i++) {
  // 2KiB 级载荷：内容带笔号（父进程逐笔对拍保真用）
  const pad = 'x'.repeat(cfg.payloadBytes);
  log.append('user/message', { content: 'payload-' + i + '-' + pad, source: 'user' });
  await persistence.flush(); // 写队列排空 = 已提交（synchronous=FULL：flush 返回 = 已持久）
  process.stdout.write('ACK:' + i + '\\n');
}
process.stdout.write('DONE\\n');
await persistence.close(); // 干净退出 checkpoint（本测试恒在 DONE 前被杀——DONE 在场 = 击杀点失效）
`;

/* ---------------- 进度行驱动的确定性击杀 ---------------- */

/** 击杀编排产物：行流 + 退出信号 */
interface KillRun {
  /** 累计 stdout/stderr（诊断现场） */
  output: () => string;
  /** tsx 包装进程退出（真身死后由兜杀收口） */
  exited: Promise<{ code: number | null; signal: string | null }>;
  /** 已见行（实时追加——击杀判据读这里） */
  lines: () => string[];
}

/** 探活（ESRCH = 真死——SIGKILL 后必须确认真身已死才可重开库） */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = 进程不存在（已死）；EPERM 等其它错按存活论（保守）
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * 起子进程写到第 killAt 笔 ACK 即对**脚本真身 pid** 发 SIGKILL（确定性击杀点
 * ——读到 ACK:K 才杀，K 笔已提交落定；不 sleep 不赌时序）。击杀目标取 PID
 * 行自报值：tsx 包装进程与目标脚本是两个 pid（孙进程形态），直杀 child.pid
 * 会孤儿化脚本、库仍被写——一切断言随之失义。
 */
function spawnAndKillAtAck(scriptPath: string, dataDir: string, total: number, killAt: number): KillRun {
  const cfg = JSON.stringify({ total, payloadBytes: 2048 });
  const child = spawn(process.execPath, [TSX_CLI, scriptPath, cfg], {
    env: {
      ...process.env,
      // 独立临时数据目录（env 梯子第 1 级——子进程生产开库路径全由此定向）；
      // 库文件级覆盖（梯子第 2 级）显式清空——外部环境残值不得劫持子库定位
      BERRY_AGENT_DATA_DIR: dataDir,
      BERRY_AGENT_DB_PATH: '',
      // 子脚本经 env 拿 persistence 模块真源路径（脚本自身在临时目录无相对链）
      KILL_RECOVERY_PERSISTENCE_PATH: fileURLToPath(new URL('./persistence.ts', import.meta.url)),
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
  let killed = false;
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
    // 脚本真身 pid 首见即登记（兜杀点名 + 击杀目标）
    const pidLine = seenLines.find((line) => line.startsWith('PID:'));
    if (pidLine !== undefined && scriptPid === undefined) {
      scriptPid = Number.parseInt(pidLine.slice('PID:'.length), 10);
      if (Number.isInteger(scriptPid)) scriptPids.push(scriptPid);
      else scriptPid = undefined;
    }
    // 确定性击杀点：第 K 笔 ACK 在场即杀真身（ACK 由 flush 后打印——K 笔已提交）
    if (!killed && scriptPid !== undefined && seenLines.some((line) => line === `ACK:${killAt}`)) {
      killed = true;
      try {
        process.kill(scriptPid, 'SIGKILL');
      } catch {
        // 真身已先死（罕见竞态）——DONE 断言会把这种退化形抓出来
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

/* ---------------- 进程级恢复不变式断言族 ---------------- */

describe('kill -9 进程级恢复（真子进程 + 生产恢复路径重开）', () => {
  it('ACK:K 击杀 → 重开不抛、前 K 笔全在、seq 连续、内容保真、续写不撞', async () => {
    const scriptDir = makeTmpDir('kill-recovery-script-');
    const scriptPath = join(scriptDir, 'child.mts');
    writeFileSync(scriptPath, CHILD_SCRIPT);
    const dataDir = makeTmpDir('kill-recovery-data-');

    // 确定性击杀点：第 8 笔 ACK（K=8）；总笔数 400 ≫ K——击杀恒落在写盘活动中段
    const KILL_AT = 8;
    const TOTAL = 400;
    const run = spawnAndKillAtAck(scriptPath, dataDir, TOTAL, KILL_AT);

    // 读到脚本真身 pid（tsx 孙进程自报——击杀目标）
    await waitFor('子进程真身 pid（PID 行）', 45_000, () => run.lines().some((l) => l.startsWith('PID:')), run.output);
    const scriptPid = Number.parseInt(
      run
        .lines()
        .find((l) => l.startsWith('PID:'))!
        .slice('PID:'.length),
      10,
    );
    expect(Number.isInteger(scriptPid)).toBe(true);

    // 读到会话 id（子进程开库成功 + 会话已建）
    await waitFor('子进程开库（SID 行）', 45_000, () => run.lines().some((l) => l.startsWith('SID:')), run.output);
    const sessionId = run
      .lines()
      .find((l) => l.startsWith('SID:'))!
      .slice('SID:'.length);

    // 确定性击杀点到达（ACK:8 在场 = 8 笔已提交落定）
    await waitFor(
      `击杀点（ACK:${KILL_AT}）`,
      30_000,
      () => run.lines().some((l) => l === `ACK:${KILL_AT}`),
      run.output,
    );
    // 真身确认死透（ESRCH）才允许重开——孤儿在场时重开读到的是与活写者竞态的快照
    await waitFor('脚本真身死亡（ESRCH）', 30_000, () => !isProcessAlive(scriptPid), run.output);
    // tsx 包装层收口（真身死后包装层自然退场；有限时兜底——悬挂由 afterAll 兜杀收）
    await Promise.race([run.exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);

    // 击杀三锚：真身已死 / 击杀点生效（DONE 不在场 = 死在写盘中段）/ ACK 前缀在场
    expect(isProcessAlive(scriptPid)).toBe(false);
    expect(run.lines()).not.toContain('DONE');
    expect(run.lines()).toContain(`ACK:${KILL_AT}`);

    // ── 恢复路径重开：父进程以同一生产面（env 梯子 → Persistence.open → loadSession）──
    // 测试进程 env 短暂改道到子数据目录（open 后恢复原值——vitest-setup 钉扎面不受扰；
    // 库文件级覆盖同刻清空——外部环境残值不得劫持恢复重开定位）
    const savedDataDir = process.env.BERRY_AGENT_DATA_DIR;
    const savedDbPath = process.env.BERRY_AGENT_DB_PATH;
    process.env.BERRY_AGENT_DATA_DIR = dataDir;
    delete process.env.BERRY_AGENT_DB_PATH;
    let persistence: Persistence | undefined;
    try {
      // ① 重开不抛（WAL 残卷自愈——SIGKILL 后 -wal/-shm 残留由 openStore 门禁序自动恢复）
      persistence = Persistence.open();
      expect(persistence.hasSession(sessionId)).toBe(true);

      // ②③④ loadSession 恢复重放（loadEvents heal 语义随行）：前缀干净、seq 连续、内容保真。
      // 快照即拍即拷：events() 回的是活体数组引用（追加区直通）——不拷贝则
      // 续写后 recovered.length 跟着长，断言基准漂移
      const loaded = persistence.loadSession(sessionId);
      const recovered = [...loaded.log.events()];
      // 已 ACK 的 K 笔全在（宁不丢——flush 返回 = 已持久的进程级实证）
      expect(recovered.length).toBeGreaterThanOrEqual(KILL_AT + 1);
      // 原子性上界：恢复量不超总笔数（击杀点在途事务要么全在要么全无）
      expect(recovered.length).toBeLessThanOrEqual(TOTAL);
      // seq 连续无洞（0..N-1 逐位相等——撕裂/半行在进程级被 SQLite 原子性挡在门外）
      expect(recovered.map((e) => e.seq)).toEqual(recovered.map((_, i) => i));
      // 首前缀内容逐笔保真（每笔载荷带笔号——精确对拍）
      for (let i = 0; i <= KILL_AT; i++) {
        const content = (recovered[i]!.data as { content: string }).content;
        expect(content.startsWith(`payload-${i}-`)).toBe(true);
        expect(content).toHaveLength(`payload-${i}-`.length + 2048);
      }

      // ⑤ 恢复后续写不撞：种子重建后 append 落 seq=N + flush 落定 + 读回对拍
      loaded.log.append('user/message', { content: 'after-recovery', source: 'user' });
      await persistence.flush();
      const after = persistence.store.loadEvents(sessionId);
      expect(after).toHaveLength(recovered.length + 1);
      expect((after[after.length - 1]!.data as { content: string }).content).toBe('after-recovery');
      expect(after[after.length - 1]!.seq).toBe(recovered.length);
    } finally {
      // 恢复路径收口：关库（退出 checkpoint）+ env 复原（finally 保证异常路径不泄漏）
      await persistence?.close();
      if (savedDataDir === undefined) delete process.env.BERRY_AGENT_DATA_DIR;
      else process.env.BERRY_AGENT_DATA_DIR = savedDataDir;
      if (savedDbPath === undefined) delete process.env.BERRY_AGENT_DB_PATH;
      else process.env.BERRY_AGENT_DB_PATH = savedDbPath;
    }
  }, 90_000);
});
