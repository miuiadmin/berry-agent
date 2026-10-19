/**
 * obs/db——rollup 自管库开库版本编舞测试（75 轮件5①：bootstrap 两段形）。
 *
 * 竞窗真身（03 §10.8 / 07 §5 件5 批注）：openRollupDatabase 修前无互斥——
 * 两进程并发首开全新库双双锁外读到 user_version=0 → 各自建链 → 后提交者
 * DDL 撞「table already exists」折 OBS_DB_OPEN_FAILED（装载面假故障降级）。
 * better-sqlite3 同步 API 决定同进程串行无竞窗——真身只在跨进程，故本锁
 * 用 tsx 真子进程（sigterm-e2e 同族基建）构造确定性交错：
 *
 * 1. 父进程 openAuxDatabase 先立 WAL + BEGIN IMMEDIATE 持写锁（子进程锁外
 *    首读 user_version 不受写锁影响——WAL 读者见最后已提交面恒 0）；
 * 2. 两子进程各自 READY 后轮询 GO 哨文件（事件循环让路——READY 行必先冲刷
 *    到父进程）再调 openRollupDatabase → 双双阻塞在写锁获取位（busy_timeout
 *    5000ms 由 openAuxDatabase→prepareWal 拍①恒在场）；
 * 3. 父进程建 GO 哨 + 释放写锁 → 两子串行化：先入者锁内复读 0 建链、后入者
 *    复读 1 跳建链直通（两段形）——双双开库成功。
 *
 * 修前形：两子阻塞在建链 DDL 的写锁升级位 → 释放后后提交者裸撞已提交 DDL
 * 「table already exists」退 1——「双双退 0」断言必红。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { openAuxDatabase } from '../../src/persist/index.js';
import { OBS_SCHEMA_VERSION, openRollupDatabase } from './db.js';

/** 仓内 tsx CLI（plugins/obs → 上两级 = 仓根——子进程以 tsx 转译真源码形态起跑） */
const TSX_CLI = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));

/** obs/db 真源（子脚本经 env 注入动态 import——tsx 转译 .ts） */
const OBS_DB_MODULE_PATH = fileURLToPath(new URL('./db.ts', import.meta.url));

/** 临时目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 子进程登记簿（兜杀——失败路径不留孤儿） */
const children: ChildProcess[] = [];
afterAll(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

/**
 * 子脚本（真开库腿——READY 行后轮询 GO 哨再开库）：开库成功 OPENED 退 0；
 * 失败 FAILED:<message> 退 1。argv 末位 = 库文件路径。
 */
const CHILD_SCRIPT = `const dbPath = process.argv[process.argv.length - 1];
const goFile = process.argv[process.argv.length - 2];
const { existsSync } = await import('node:fs');
const { openRollupDatabase } = await import(process.env.OBS_DB_MODULE_PATH);
process.stdout.write('READY\\n');
while (!existsSync(goFile)) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
try {
  const db = openRollupDatabase(dbPath, () => undefined);
  db.close();
  process.stdout.write('OPENED\\n');
  process.exit(0);
} catch (err) {
  process.stdout.write('FAILED:' + (err instanceof Error ? err.message : String(err)) + '\\n');
  process.exit(1);
}
`;

/** 子进程运行柄（行账实时追加 + 退场回执） */
interface ChildRun {
  readonly lines: () => string[];
  readonly output: () => string;
  readonly exited: Promise<{ code: number | null; signal: string | null }>;
}

/** 起一个子进程（行账收口 + 兜杀登记） */
function spawnChild(scriptPath: string, dbPath: string, goFile: string): ChildRun {
  const child = spawn(process.execPath, [TSX_CLI, scriptPath, goFile, dbPath], {
    env: { ...process.env, OBS_DB_MODULE_PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const lines: string[] = [];
  const chunks: string[] = [];
  let pending = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    chunks.push(chunk);
    pending += chunk;
    const parts = pending.split('\n');
    pending = parts.pop() ?? '';
    for (const line of parts) if (line !== '') lines.push(line);
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => chunks.push(chunk));
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  return { lines: () => lines, output: () => chunks.join(''), exited };
}

/** 等判词转真（超时抛错带现场——防子进程悬死挂测试） */
async function waitFor(what: string, timeoutMs: number, pred: () => boolean, output: () => string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (pred()) return;
    if (Date.now() > deadline) {
      throw new Error(`等待超时（${what}，${timeoutMs}ms）——当前输出尾段：\n${output().slice(-1200)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('openRollupDatabase bootstrap 两段形（75 轮件5①——跨进程竞窗收口）', () => {
  it('顺序双开（结构锁）：全新库建链 v1 + 二开 fast-path 直通', () => {
    const dir = mkdtempSync(join(tmpdir(), 'obs-db-seq-'));
    dirs.push(dir);
    const dbPath = join(dir, 'rollup.db');
    const first = openRollupDatabase(dbPath, () => undefined);
    expect(first.pragma('user_version', { simple: true })).toBe(OBS_SCHEMA_VERSION);
    first.close();
    // 二开 fast-path：已建链库直通（锁外首读即 head——不再进写锁段）
    const second = openRollupDatabase(dbPath, () => undefined);
    expect(second.pragma('user_version', { simple: true })).toBe(OBS_SCHEMA_VERSION);
    second.close();
  });

  it('跨进程并发首开全新库（真竞窗锁）：写锁守门下双双开库成功（修前后提交者撞 already exists 必红）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'obs-db-race-'));
    dirs.push(dir);
    const dbPath = join(dir, 'rollup.db');
    const goFile = join(dir, 'GO');

    // 父进程先立 WAL 形 + 持写锁（子进程开库期 journal_mode 已 WAL——pragma
    // no-op 不抢锁；两子只能阻塞在写锁获取位，读侧恒见 version=0）
    const holder = openAuxDatabase(dbPath, { warn: () => undefined });
    holder.exec('BEGIN IMMEDIATE');

    const scriptPath = join(dir, 'child.mts');
    writeFileSync(scriptPath, CHILD_SCRIPT);
    const a = spawnChild(scriptPath, dbPath, goFile);
    const b = spawnChild(scriptPath, dbPath, goFile);

    // 双 READY = 两子已完成 import 且未开库（GO 哨缺席）——再让 300ms 确保
    // 双双完成锁外首读并阻塞在写锁位
    await waitFor('子 A READY', 45_000, () => a.lines().some((l) => l === 'READY'), a.output);
    await waitFor('子 B READY', 45_000, () => b.lines().some((l) => l === 'READY'), b.output);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 放行 + 释放写锁：两子串行化——两段形下先入者建链、后入者锁内复读 v1
    // 跳建链直通（修前：后提交者 DDL 撞已提交表退 1）
    writeFileSync(goFile, '');
    holder.exec('ROLLBACK');
    holder.close();

    const [exitA, exitB] = await Promise.all([a.exited, b.exited]);
    expect(exitA.code).toBe(0);
    expect(exitB.code).toBe(0);
    const output = a.output() + b.output();
    expect(output).toContain('OPENED');
    expect(output).not.toContain('already exists'); // 修前病灶签名零容忍
    // 终态健康：父进程三开 fast-path 直通 v1
    const third = openRollupDatabase(dbPath, () => undefined);
    expect(third.pragma('user_version', { simple: true })).toBe(OBS_SCHEMA_VERSION);
    third.close();
    expect(readFileSync(goFile, 'utf8')).toBe(''); // 哨文件原样（诊断现场自证）
  }, 60_000);
});
