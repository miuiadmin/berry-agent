#!/usr/bin/env node
/**
 * host/main — bin 入口装配位（package.json bin = berry-agent → dist/host/main.js）。
 *
 * 薄壳三件事：装崩溃编舞（前置窗口直写 crash.log——运行时组装后切
 * runtime.writeCrashLog）→ 装信号编舞（SIGINT②→130 / SIGTERM 优雅序——
 * 04 §1）→ parseCli + dispatchCli 分派 + process.exit。
 *
 * 本批（12c）执行器族全空——除 help/version 外一切命令诚实退 1「执行面
 * 尚未装配」（错误路径及时非零退出铁律）；12d（装载器）/conversation
 * 装配批/12e（TUI）逐席充实 handlers 并在组装运行时后挂 attachRuntime
 * （信号/崩溃编舞切运行时本体）。
 *
 * 自动执行卫兵：仅作为主模块直跑时执行（import.meta.url 对 argv[1]）——
 * 被 import（测试/程序化装配）不触发副作用。tsc 直出保留首行 shebang，
 * bin 执行位由 npm pack 装配。
 */
import { readFileSync, realpathSync } from 'node:fs';
import { argv, exit as processExit, stderr, stdin, stdout } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveDataDir } from '../persist/index.js';

import { parseCli } from './cli.js';
import { dispatchCli } from './dispatch.js';
import type { CommandHandlers } from './dispatch.js';
import { appendCrashLog } from './runtime.js';
import type { HostRuntime } from './runtime.js';
import { installCrashChoreography, installSignalChoreography } from './signals.js';
import { DAEMON_CHILD_ENV, runDaemonServe, runServeStatus, runServeStop, spawnDaemonServe } from './serve-daemon.js';
import { runServeEntry } from './serve-entry.js';
import { runMcpEntry } from './mcp-entry.js';
import { runTuiEntry } from './tui-entry.js';
import { runRunEntry } from './run-entry.js';
import { runDumpConfigEntry } from './dump-config.js';
import { runPluginsEntry } from './plugins-cmd.js';
import { runSessionsEntry } from './sessions-cmd.js';
import { runCredentialsEntry } from './credentials-cmd.js';
import { runDoorsEntry } from './doors-cmd.js';

/** 在飞运行时柄（组装后挂入——信号/崩溃编舞切运行时本体；前置窗口 null） */
let activeRuntime: HostRuntime | null = null;

/** 装配序挂入运行时（12d/12e 与 conversation 装配批的执行器在组装后调用） */
export function attachRuntime(runtime: HostRuntime): void {
  activeRuntime = runtime;
}

/** 读包版本（裸 semver——bin 与包根两级上溯；src 与 dist 同相对深度） */
function readVersion(): string {
  const pkgUrl = new URL('../../package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0-unknown';
}

/** serve 分派三态：daemon child（env 标记）→ spawner（--daemon）→ stdio 前台 */
function dispatchServe(flags: Parameters<NonNullable<CommandHandlers['serve']>>[0]): Promise<number> {
  if (process.env[DAEMON_CHILD_ENV] === '1') {
    // child 形态：HTTP 面常驻主体（spawner 已 detached + stderr 重定向 log）
    return runDaemonServe({ flags, version: readVersion(), onRuntime: attachRuntime });
  }
  if (flags.daemon) {
    // spawner 形态：spawn 自镜像后即退（起活确认窗内报结果；child 独立生命周期）
    return spawnDaemonServe({ flags });
  }
  return runServeEntry({ flags, version: readVersion(), onRuntime: attachRuntime });
}

/** 执行器族（12c 空起——逐批充实；12e TUI / 13c serve stdio / 13e-3 daemon 编舞 + status/stop / 13f mcp 包装 / 12f-3 dump-config + plugins / 20b run / 20d sessions / g-2 doors 已接线，upgrade 诚实退 1） */
const handlers: CommandHandlers = {
  tui: (flags) =>
    runTuiEntry({
      flags,
      version: readVersion(), // OSC title 基线真值（批 12 挂账兑现）
      onRuntime: attachRuntime, // 信号/崩溃编舞切运行时本体
    }),
  serve: (flags) => dispatchServe(flags),
  // run 单次执行（20b 接线——07 §5 run 旗标族全量消费位；tick 形 message 为
  // 空串占位——提示词在 jobs 行内，由 run-entry 经行读取）
  run: (message, flags) =>
    runRunEntry({
      message,
      flags,
      version: readVersion(),
      onRuntime: attachRuntime, // 信号/崩溃编舞切运行时本体
    }),
  serveStatus: () => runServeStatus({ dataDir: resolveDataDir() }),
  serveStop: () => runServeStop({ dataDir: resolveDataDir() }),
  // MCP server 包装形态（13f 接线——零旗标面；serverInfo 版本真值同 tui 路径）
  mcp: () =>
    runMcpEntry({
      version: readVersion(),
      onRuntime: attachRuntime, // 信号/崩溃编舞切运行时本体
    }),
  // dump-config :memory: 同构诊断（12f-3——07 §5 禁侧门纪律，assembly 公共段）
  dumpConfig: (flags) =>
    runDumpConfigEntry({
      flags,
      version: readVersion(),
      onRuntime: attachRuntime,
    }),
  // plugins 子命令族 CLI 面（12f-3——list 同构装配 / check 纯只读骨架 / 写侧六动词诚实退 1）
  plugins: (sub) =>
    runPluginsEntry(sub, {
      version: readVersion(),
      onRuntime: attachRuntime,
    }),
  // sessions 子命令族 CLI 面（20d——list/search/reindex 读腿零装配、resume 进
  // TUI〔resumeSessionId 载体〕、fork 全装配同 run --fork 机；07 §5 定名）
  sessions: (sub) =>
    runSessionsEntry(sub, {
      version: readVersion(),
      onRuntime: attachRuntime, // fork/resume 装配路径——信号/崩溃编舞切运行时本体
    }),
  // credentials 子命令族 CLI 面（c-5——03 §10.9 人面命令：零装配直开库，
  // 动词语义单源 credentials/commands 与 TUI /credentials 同底座）
  credentials: (sub) => runCredentialsEntry(sub, {}),
  // doors 子命令族 CLI 面（g-2——03 §4.6 / 07 §5 定名：list 只读零装配零库
  // 纯文件读；open/close 合法解析形、执行层语义拒退 1——写动词 TUI /doors 专属）
  doors: (sub) => runDoorsEntry(sub, {}),
};

/** 主序：编舞装配 → 分派 → 终局 */
async function main(): Promise<number> {
  installCrashChoreography({
    // 前置窗口（运行时未组装）直写缺省数据目录；组装后走运行时本体（memory 形跳过语义在其内）
    writeCrashLog: (error) => {
      if (activeRuntime !== null) activeRuntime.writeCrashLog(error);
      else appendCrashLog(resolveDataDir(), error);
    },
  });
  installSignalChoreography({
    onGraceful: async () => {
      await activeRuntime?.shutdown(); // 未组装 = 无优雅序可走，直退 0
      return 0;
    },
  });

  return dispatchCli(parseCli(argv.slice(2)), handlers, {
    stdinIsTTY: stdin.isTTY === true,
    stdoutIsTTY: stdout.isTTY === true,
    writeOut: (text) => stdout.write(`${text}\n`),
    writeErr: (text) => stderr.write(`${text}\n`),
    version: readVersion(),
  });
}

// 自动执行卫兵：仅主模块直跑（进程入口）才走主序——被 import 零副作用。
// argv[1] 先 realpath 归一：入口模块 node 侧恒走真实路径解析，而 argv[1] 是
// 调用面字面量——npm bin 符号链接或路径含符号链接环节（/tmp → /private/tmp、
// nvm/volta shim 目录）两侧错配即静默 no-op 退 0（2026-09-08 发布面收口批
// 安装冒烟逮到——真实装机路径含符号链接即坏，发布阻塞件）
/**
 * 主模块判定（bin 直跑卫兵）——argv[1] realpath 归一后对模块 URL 全等比对。
 * @param argv1 进程 argv[1]（调用面字面量——可能是符号链接或含链接环节的路径）
 * @param moduleUrl 本模块 import.meta.url（node 入口解析恒为真实路径）
 */
export function isMainModule(argv1: string | undefined, moduleUrl: string): boolean {
  if (argv1 === undefined) return false;
  try {
    return pathToFileURL(realpathSync(argv1)).href === moduleUrl;
  } catch {
    return false; // argv[1] 已不可解析（极端竞态）——按非主模块退
  }
}
const isMain = isMainModule(argv[1], import.meta.url);
if (isMain) {
  void main()
    .then((code) => processExit(code))
    .catch((err: unknown) => {
      // 主序自身抛错（编舞装配前的窄窗）——stderr 一行 + 执行失败档退
      stderr.write(`启动失败：${err instanceof Error ? err.message : String(err)}\n`);
      processExit(1);
    });
}
