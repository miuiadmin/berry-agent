/**
 * host/serve-daemon — daemon 编舞与管理动词（批 13e-3；07 §5 serve 旗标块
 * daemon/status/stop 三动词 + 02 数据域表 serve/ 行三足迹）。
 *
 * 三动词分职：
 * - **spawner**（`berry-agent serve --daemon`）：spawn 自镜像 detached 子进程
 *   （POSIX setsid 族 = Node `detached: true`；stdio stdin/stdout ignore——
 *   daemon 与 stdio 传输互斥〔07 §5〕、stderr 追加重定向 daemon.log）后即退；
 *   起活确认窗内轮询 pid 登记（child 写 pid 才算起活）——child 秒死（撞
 *   HOST_DATA_DIR_BUSY 等）则转发其退出码并转述 daemon.log 尾行。child 身份
 *   经 env `BERRY_AGENT_SERVE_DAEMON_CHILD=1` 标记（不入 CLI 词面——env 双
 *   载体先例 BERRY_AGENT_SDK_TOKEN 同族），防 spawn 递归。
 * - **daemon child**（`runDaemonServe`）：组装 runtime + conversation 栈 +
 *   serve 装配桥 → core:sdk 件 kit createFace（批 19e 装载晚绑——件禁用
 *   ⇒ kit 缺席 ⇒ 拒启退 2，07 §5；sock = 数据目录 serve/daemon.sock
 *   缺省接入点；TCP 侧 --sdk-port/--sdk-host 可选 SDK 面 + `--port` 人面
 *   〔18a-3' 三入口咬合——TCP 侧多监听并存，webui 路由经 core:webui 件 kit
 *   挂进本面（件禁用 = warn 不挂——/api/* 404 面仍在），daemon 人面 =
 *   serve HTTP 面 TCP 侧〕）→ 写 pid 登记 → token
 *   披露一行进 stderr（= daemon.log——自动生成档唯一披露位）→ 常驻至优雅停
 *   （SIGTERM → main 信号编舞 → runtime 六步退出序 → 本件 closer：face.stop
 *   + 清 pid 登记）。崩溃恢复语义与前台同一条（durable 投影——04 §1 P4），
 *   本件零第二套恢复路径。
 * - **status/stop**（只读豁免面——05 §6.6）：status 只读 pid 登记文件不动库
 *   （退出码 0 = 在跑 / 1 = 未跑或登记损坏 / 2 = 用法错）；stop = SIGTERM →
 *   待退出（10s 窗〔07 §5 落码定名批定值〕后升格 SIGKILL）→ 清 pid/sock
 *   登记——增量只有发信号/待退出/清登记三动作，未运行幂等退 0。
 *
 * 双登记分职注记：`active.json`（single-instance 件）= 单活跃机执法标记
 * （runtime 组装自持）；`serve/daemon.pid` = daemon 编舞足迹（status/stop
 * 消费——02 数据域表 serve/ 行明列）。两文件两职责并存，记录同形
 * `{pid, startedAt}`（uptime = now - startedAt 的报告源）。
 *
 * 裁量钉位（规范未明文、本笔定形）：起活确认窗 10s（child 含运行时组装
 * 秒级；与 stop 升格窗同值族）；status 活跃会话数经 sock 面 GET /v1/sessions
 * 计数——仅在 env 配得 BERRY_AGENT_SDK_TOKEN（显式 token 形态）时可查，
 * 自动生成档无凭证打 `n/a`（05 §6.6 豁免面 = 不动库，sock 面是唯一不动库
 * 的会话读径）。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stderr as defaultStderr } from 'node:process';

import { resolveDataDir } from '../persist/index.js';
import {
  createSdkHttpFace,
  judgeListenConfig,
  type SdkHttpFaceHandle,
  type SdkHttpListenConfig,
  type SdkListenInfo,
  type SdkTcpListenSpec,
} from '../sdk/index.js';
import type { Provider } from '../llm/index.js';
import type { SandboxMode } from '../safety/index.js';
import { WEBUI_DEFAULT_HOST } from '../webui/index.js';

import { createServeBridge } from './serve-entry.js';
import { assembleHostStack } from './assembly.js';
import type { AssemblySuccess } from './assembly.js';
import type { CorePluginReference } from './loader.js';
import type { HostRuntime } from './runtime.js';
import type { WebuiMountKit } from './webui-bridge.js';

/**
 * sdk 面 kit 形（core:sdk 件 provide 'sdk-http-face' 的结构——批 19e
 * 装载晚绑：daemon 经 scope.tryGet 消费件在场性，apply 期只 provide 不触面）。
 */
interface SdkFaceKit {
  readonly createFace: typeof createSdkHttpFace;
}

/**
 * issue webhook 挂载 kit 形（core:issue 件 provide 'issue-webhook-mount'
 * 的结构——mount = 路由挂进面；dispose = 摘路由幂等）。
 */
interface IssueWebhookMountKit {
  mount(face: SdkHttpFaceHandle): { dispose(): void };
}

/* ---------------- 足迹词面（02 数据域表 serve/ 行） ---------------- */

/** daemon 三足迹所在子目录名（数据目录下） */
export const SERVE_DIR_BASENAME = 'serve';
/** pid 登记文件名（status/stop 消费——uptime 报告源） */
export const DAEMON_PID_BASENAME = 'daemon.pid';
/** Unix-domain socket 监听位文件名（HTTP 面缺省接入点） */
export const DAEMON_SOCK_BASENAME = 'daemon.sock';
/** stderr 重定向日志文件名（token 披露位/崩溃取证面） */
export const DAEMON_LOG_BASENAME = 'daemon.log';

/** child 身份 env 标记（不入 CLI 词面——防 spawn 递归） */
export const DAEMON_CHILD_ENV = 'BERRY_AGENT_SERVE_DAEMON_CHILD';

/** stop 升格 SIGKILL 窗（07 §5 落码定名批定值 10s） */
export const STOP_SIGKILL_GRACE_MS = 10_000;

/** spawner 起活确认窗（裁量钉位——child 写 pid 登记才算起活） */
export const SPAWN_CONFIRM_TIMEOUT_MS = 10_000;

/** pid 登记记录形（与 active.json 同形异职——见件头分职注记） */
export interface DaemonPidRecord {
  readonly pid: number;
  readonly startedAt: number;
}

/** daemon 三足迹路径族 */
export interface DaemonPaths {
  readonly dir: string;
  readonly pidPath: string;
  readonly sockPath: string;
  readonly logPath: string;
}

/** 三足迹路径推导（数据目录 → serve/ 三件） */
export function daemonPaths(dataDir: string): DaemonPaths {
  const dir = join(dataDir, SERVE_DIR_BASENAME);
  return {
    dir,
    pidPath: join(dir, DAEMON_PID_BASENAME),
    sockPath: join(dir, DAEMON_SOCK_BASENAME),
    logPath: join(dir, DAEMON_LOG_BASENAME),
  };
}

/* ---------------- pid 登记原语（全注入可测） ---------------- */

/** pid/日志文件系统动作注入面（测试注假 fs——产码缺省真 fs；通用名：pid 与日志同走 readFile） */
export interface DaemonFs {
  readonly ensureDir?: (dir: string) => void;
  readonly writeFile?: (path: string, text: string) => void;
  readonly readFile?: (path: string) => string;
  readonly tryUnlink?: (path: string) => void;
}

const DEFAULT_FS: Required<DaemonFs> = {
  ensureDir: (dir) => mkdirSync(dir, { recursive: true }),
  writeFile: (path, text) => writeFileSync(path, text),
  readFile: (path) => readFileSync(path, 'utf8'),
  tryUnlink: (path) => {
    try {
      unlinkSync(path);
    } catch {
      // ENOENT 幂等；其余错上抛（数据目录病态 fail-loud）
    }
  },
};

/** 进程探活缺省实现（信号 0——与 single-instance 同式） */
function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 写 pid 登记（child 起活序——face 监听成功后写） */
export function writeDaemonPid(paths: DaemonPaths, record: DaemonPidRecord, fs: DaemonFs = {}): void {
  const f = { ...DEFAULT_FS, ...fs };
  f.ensureDir(paths.dir);
  f.writeFile(paths.pidPath, `${JSON.stringify(record)}\n`);
}

/**
 * 读 pid 登记探活：返回 running 与登记原文。
 * 登记缺席/坏 JSON/pid 字段坏 = 未跑（status 同码 1 的「登记损坏罕见路径
 * 同码 1、接受并注记」语义——probe 不区分未跑与坏登记，报告面打注记）。
 */
export function probeDaemon(
  paths: DaemonPaths,
  isAlive: (pid: number) => boolean = defaultIsAlive,
  fs: DaemonFs = {},
): { running: boolean; record?: DaemonPidRecord; malformed: boolean } {
  const f = { ...DEFAULT_FS, ...fs };
  let text: string;
  try {
    text = f.readFile(paths.pidPath);
  } catch {
    return { running: false, malformed: false }; // 登记缺席 = 未跑（常态）
  }
  try {
    const parsed = JSON.parse(text) as Partial<DaemonPidRecord>;
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return { running: false, malformed: true };
    }
    const record: DaemonPidRecord = {
      pid: parsed.pid,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
    };
    return { running: isAlive(record.pid), record, malformed: false };
  } catch {
    return { running: false, malformed: true };
  }
}

/** 清 pid/sock 登记（stop 收尾 + 未跑残留清扫——幂等） */
export function clearDaemonFootprints(paths: DaemonPaths, fs: DaemonFs = {}): void {
  const f = { ...DEFAULT_FS, ...fs };
  f.tryUnlink(paths.pidPath);
  f.tryUnlink(paths.sockPath);
}

/* ---------------- serve status（只读探活——05 §6.6 豁免面） ---------------- */

/** status 选项（注入面：fs/时钟/探活/sock 会话查询/env） */
export interface ServeStatusOptions {
  readonly dataDir: string;
  readonly env?: Record<string, string | undefined>;
  readonly now?: () => number;
  readonly isAlive?: (pid: number) => boolean;
  readonly fs?: DaemonFs;
  /** 输出面（缺省 process.stderr 之外的报告行走 stdout——注入收行） */
  readonly write?: (line: string) => void;
  /** 经 sock 面 GET /v1/sessions 计数（缺省真 HTTP；注入收假） */
  readonly fetchSessionCount?: (sockPath: string, token: string) => Promise<number | undefined>;
}

/**
 * serve status：探活与报告（运行态/pid/uptime/活跃会话数）。
 * 退出码 0 = 在跑 / 1 = 未跑（含登记损坏罕见路径——接受并注记）。
 * 活跃会话数：env 配得 token 才经 sock 面查（自动生成档无凭证打 n/a）。
 */
export async function runServeStatus(options: ServeStatusOptions): Promise<number> {
  const paths = daemonPaths(options.dataDir);
  const write = options.write ?? ((line) => process.stdout.write(`${line}\n`));
  const probe = probeDaemon(paths, options.isAlive ?? defaultIsAlive, options.fs);
  if (!probe.running) {
    write(probe.malformed ? '未运行（pid 登记损坏——serve stop 可清残留登记）' : '未运行');
    return 1;
  }
  const now = options.now ?? (() => Date.now());
  const uptimeSec = Math.max(0, Math.round((now() - (probe.record?.startedAt ?? 0)) / 1000));
  // 活跃会话数：显式 token 形态经 sock 面查（豁免面不动库——sock 是唯一读径）
  const env = options.env ?? process.env;
  const token = env.BERRY_AGENT_SDK_TOKEN;
  let sessionsText = 'n/a（自动 token 形态无查询凭证——配 BERRY_AGENT_SDK_TOKEN 可查）';
  if (token !== undefined && token !== '') {
    const count = await options.fetchSessionCount?.(paths.sockPath, token);
    sessionsText = count === undefined ? 'n/a（sock 面不可达）' : String(count);
  }
  write(`运行中（pid ${probe.record?.pid}，uptime ${uptimeSec}s，活跃会话 ${sessionsText}）`);
  return 0;
}

/* ---------------- serve stop（SIGTERM → 待退出 → 清登记） ---------------- */

/** stop 选项（注入面：信号/探活/时钟/等待——编舞全注入可测） */
export interface ServeStopOptions {
  readonly dataDir: string;
  readonly isAlive?: (pid: number) => boolean;
  readonly fs?: DaemonFs;
  /** 发信号面（缺省 process.kill；测试收账） */
  readonly signal?: (pid: number, signal: NodeJS.Signals) => void;
  /** 逐等待步（缺省 100ms setTimeout；测试注立即 resolve 提速） */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly write?: (line: string) => void;
}

/**
 * serve stop：优雅停编舞（04 §1 信号退出序为真源——SIGTERM 走 SIGINT① 同款
 * 优雅序）。增量只有发信号/待退出/清登记三动作：SIGTERM → 轮询探活至 10s 窗
 * （STOP_SIGKILL_GRACE_MS）→ 仍活升格 SIGKILL → 清 pid/sock 登记。
 * 未运行（登记缺/坏/pid 死）= 清残留登记后幂等退 0（自动化脚本可裸调）。
 */
export async function runServeStop(options: ServeStopOptions): Promise<number> {
  const paths = daemonPaths(options.dataDir);
  const write = options.write ?? ((line) => process.stdout.write(`${line}\n`));
  const isAlive = options.isAlive ?? defaultIsAlive;
  const signal = options.signal ?? ((pid, sig) => process.kill(pid, sig));
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());

  const probe = probeDaemon(paths, isAlive, options.fs);
  if (!probe.running || probe.record === undefined) {
    clearDaemonFootprints(paths, options.fs); // 幂等清残留（含坏登记清扫）
    write('未运行（登记已清）');
    return 0;
  }
  const pid = probe.record.pid;
  write(`发 SIGTERM（pid ${pid}）——优雅停编舞`);
  signal(pid, 'SIGTERM');
  const deadline = now() + STOP_SIGKILL_GRACE_MS;
  while (isAlive(pid) && now() < deadline) {
    await sleep(100);
  }
  if (isAlive(pid)) {
    write(`优雅窗（10s）尽仍未退——升格 SIGKILL（pid ${pid}）`);
    signal(pid, 'SIGKILL');
    // SIGKILL 后短轮询收尸（内核异步收——不假设立即死）
    const killDeadline = now() + 2_000;
    while (isAlive(pid) && now() < killDeadline) {
      await sleep(50);
    }
  }
  clearDaemonFootprints(paths, options.fs);
  write('已停（pid/sock 登记已清）');
  return 0;
}

/* ---------------- daemon child 主体 ---------------- */

/** daemon 旗标面（child 与 spawner 共用形——`--port` 人面 + SDK 面两族独立可选） */
export interface DaemonServeFlags {
  /** 统一 HTTP 面 TCP 人面端口（18a-3'——恒回环绑定） */
  readonly port?: number;
  readonly sdkPort?: number;
  readonly sdkHost?: string;
  readonly noDelta: boolean;
}

/** daemon child 选项（main 分派接线 + 测试注入面——承 ServeEntryOptions 同族） */
export interface DaemonServeOptions {
  readonly flags: DaemonServeFlags;
  readonly dataDir?: string;
  readonly env?: Record<string, string | undefined>;
  readonly cwd?: string;
  readonly providers?: readonly Provider[];
  readonly model?: string;
  readonly sandboxMode?: () => SandboxMode;
  /** 版本串（HostFace 物化位——批 19a-3 与 TUI 同源；缺席 = 裸 0.0.0-unknown） */
  readonly version?: string;
  readonly heartbeatIntervalMs?: number;
  /** 运行时组装后回调（main attachRuntime——信号编舞切运行时本体） */
  readonly onRuntime?: (runtime: HostRuntime) => void;
  /** face 工厂注入位（测试换假 face——产码缺省 core:sdk 件 kit 的 createFace） */
  readonly faceFactory?: typeof createSdkHttpFace;
  /** core: 官方件注册表注入位（批 19e——测试禁件拒启例用；透传 assembly 单源） */
  readonly corePlugins?: readonly CorePluginReference[];
  /** stderr 披露面（缺省 process.stderr；测试收行） */
  readonly writeErr?: (line: string) => void;
}

/**
 * daemon 开面配置（child 实配与 spawner 预拦同参真源——judgeListenConfig
 * 双侧执法）。TCP 侧多监听并存（18a-3'）：人面 spec 恒推首位（`--port` 恒
 * 回环绑定——远程暴露走 --sdk-host 显式载体；SDK 面独立可选）。归一前提：
 * 判定与实配都按「数组首位 = 人面」约定消费 info.tcp[0]。
 */
function daemonListenConfig(
  paths: DaemonPaths,
  flags: DaemonServeFlags,
  env: Record<string, string | undefined>,
): SdkHttpListenConfig {
  const tcpSpecs: SdkTcpListenSpec[] = [];
  if (flags.port !== undefined) tcpSpecs.push({ host: WEBUI_DEFAULT_HOST, port: flags.port });
  if (flags.sdkPort !== undefined || flags.sdkHost !== undefined) {
    tcpSpecs.push({ host: flags.sdkHost ?? '127.0.0.1', port: flags.sdkPort ?? 0 });
  }
  return {
    socketPath: paths.sockPath,
    ...(tcpSpecs.length > 0 ? { tcp: tcpSpecs } : {}),
    ...(env.BERRY_AGENT_SDK_TOKEN !== undefined ? { token: env.BERRY_AGENT_SDK_TOKEN } : {}),
  };
}

/**
 * daemon child 主体：HTTP 面常驻（stdio 环零装配——daemon 与 stdio 传输互斥）。
 *
 * 装配序：开面判定（judgeListenConfig——非回环 × 无 token 退 2，fail-closed
 * 不豁免）→ 装配公共段（批 19a-3 迁 assembly 件：运行时〔单活跃机占标记在先
 * ——撞在场 daemon 即 HOST_DATA_DIR_BUSY〕→ 共享根 → 栈 → **插件装载**〔core
 * 注册表 + enabled.yaml 真跑——无人值守主通道装载面与 TUI 同构〕）→ face
 * （sock 缺省 + TCP 可选）→ 写 pid 登记 → token 披露（自动生成档唯一披露位 =
 * stderr → daemon.log）→ 常驻 await。
 * 退出序：runtime closer（face.stop + 清 pid）——SIGTERM 经 main 信号编舞
 * → runtime.shutdown 六步触发（closer drain 序 = 注册序——webui-server 先
 * 注册先摘挂，再停面）；测试直调注入 runtime.shutdown 同径。
 */
export async function runDaemonServe(options: DaemonServeOptions): Promise<number> {
  const env = options.env ?? process.env;
  const writeErr = options.writeErr ?? ((line) => defaultStderr.write(`${line}\n`));
  const dataDir = options.dataDir ?? resolveDataDir();
  const paths = daemonPaths(dataDir);

  // —— 开面判定（三防线①——非回环绑定必配凭证，违例 daemon 形退 2）——
  const config = daemonListenConfig(paths, options.flags, env);
  const judged = judgeListenConfig(config);
  if (!judged.ok) {
    writeErr(`拒启：${judged.reason}`);
    return 2;
  }

  // —— 装配公共段（与 TUI 同一合成代码路径——装载面随批 19a 活化）——
  const assembly = await assembleHostStack({
    runtime: { dataDir },
    noPlugins: false,
    debug: false, // 零旗标面：daemon 日志级只走 env（BERRY_AGENT_LOG_LEVEL）
    version: options.version ?? '0.0.0-unknown',
    ...(options.providers !== undefined ? { providers: options.providers } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.sandboxMode !== undefined ? { sandboxMode: options.sandboxMode } : {}),
    ...(options.onRuntime !== undefined ? { onRuntime: options.onRuntime } : {}),
    ...(options.corePlugins !== undefined ? { corePlugins: options.corePlugins } : {}),
  });
  if (!assembly.ok) {
    writeErr(`${assembly.crashed ? `daemon 运行失败：${assembly.message}` : assembly.message}`);
    return assembly.exitCode;
  }
  const { runtime, stack, scope }: AssemblySuccess = assembly;

  // —— sdk 件在场性执法（批 19e——07 §5 daemon 拒启律）：daemon 接入面本体
  // = sdk HTTP 面，core:sdk 件禁用/零装载 ⇒ kit 缺席 ⇒ 拒启退 2（与开面
  // 判定拒启同码族——配置档干净退出不写 crash.log，enabled.yaml 可修）——
  const sdkKit = scope.tryGet<SdkFaceKit>('sdk-http-face');
  if (sdkKit === undefined) {
    writeErr('拒启：core:sdk 件未装载（daemon 接入面本体缺席——enabled.yaml 禁用即拒启，07 §5）');
    await runtime.shutdown().catch(() => {});
    return 2;
  }
  const faceFactory = options.faceFactory ?? sdkKit.createFace;
  const bridge = createServeBridge(stack, runtime, { cwd: options.cwd ?? process.cwd() });
  // sock 目录先建（三足迹目录 serve/——face 监听与 pid 登记共同前置；
  // 修前 face.start 先跑而目录由 writeDaemonPid 后建——listen 对缺目录
  // EACCES/ENOENT，回归锁 = 全环集成例「face 起 → pid 登记」序）
  mkdirSync(paths.dir, { recursive: true });
  const face: SdkHttpFaceHandle = faceFactory({
    config,
    bridge,
    coreOptions: {
      ...(options.heartbeatIntervalMs !== undefined ? { heartbeatIntervalMs: options.heartbeatIntervalMs } : {}),
      // --no-delta 宿主立场缺省（07 §5——与 stdio 形 serve-entry 同款传位）
      initialConnectionNoDelta: options.flags.noDelta,
    },
  });

  let info: SdkListenInfo;
  try {
    info = await face.start();
  } catch (err) {
    writeErr(`HTTP 面启动失败：${err instanceof Error ? err.message : String(err)}`);
    await runtime.shutdown().catch(() => {});
    return 1;
  }

  // 起活三足：pid 登记（spawner 确认源）+ token 披露 + 信封回流
  writeDaemonPid(paths, { pid: process.pid, startedAt: Date.now() });
  stack.channels.addBackend(face.backend); // 信封回流自动馈送（conversation-stack onEvent → emit）
  // —— --port 人面挂载（18a-3' 三入口咬合；04 §1 daemon 人面 = serve HTTP
  // 面 TCP 侧）：webui 路由族经 core:webui 件 kit 挂进本面（批 19e 装载晚
  // 绑——件 apply 期只 provide，开面后 mountOnFace；面归 daemon 单源零第
  // 二套映射）；kit 缺席 = 件禁用语义族——warn 一行不挂（/api/* 404 面
  // 仍在，/v1/* 程序调用族不受累）——
  let webuiMount: { detach(): void } | undefined;
  if (options.flags.port !== undefined) {
    const webuiKit = scope.tryGet<WebuiMountKit>('webui-face-mount');
    if (webuiKit !== undefined) {
      webuiMount = webuiKit.mountOnFace(face);
    } else {
      writeErr('warn：core:webui 件未装载——人面 Web 界面与 /api/* 缺席（/v1/* 仍在场）');
    }
  }
  // —— issue webhook 挂载（批 19e——core:issue 件 kit 晚绑）：件装载且
  // 装配面在场时 mount 将 webhook 路由族挂进本面；kit 缺席 = 件零装载
  // （主闸链缺席静默——daemon 形同律，不 warn）——
  const issueMountKit = scope.tryGet<IssueWebhookMountKit>('issue-webhook-mount');
  const issueWebhook = issueMountKit !== undefined ? issueMountKit.mount(face) : undefined;
  // 披露行（18a-1' 多监听扩形适配：TCP 侧数组 join——多监听并存全披露；sock 恒在场，缺席位 'off' 兜底）
  const tcpPart = info.tcp.length > 0 ? ` tcp=${info.tcp.map((spec) => `${spec.host}:${spec.port}`).join(',')}` : '';
  writeErr(`daemon 就绪：sock=${info.socketPath ?? 'off'}${tcpPart}（SDK 协议版本头 x-sdk-protocol: 1）`);
  if (env.BERRY_AGENT_SDK_TOKEN === undefined) {
    writeErr(`daemon token（自动生成——本地调用方接入凭证，已进本日志不再复现）：Bearer ${face.token}`);
  }
  // 人面披露两行（18a-3' 差异面⑤——daemon 披露通道 = daemon.log 即 stderr
  // 重定向；人面监听位 = tcp 数组首位〔构建序人面先推——port 0 内核指派后
  // 实口见 info〕）；同面单 token——面 token 覆盖 /v1 与 webui 人面，不再复述值；
  // 分档（批 19e）：kit 缺席形诚实报 SDK 面形不虚报 Web 界面
  if (webuiMount !== undefined) {
    const face0 = info.tcp[0]!;
    writeErr(`Web 界面已开面：http://${face0.host}:${face0.port}/`);
    writeErr('访问令牌即 daemon token（同面单 token——见 daemon token 披露行）');
  } else if (options.flags.port !== undefined) {
    const face0 = info.tcp[0]!;
    writeErr(
      `HTTP 人面已开面（webui 件未装载）：http://${face0.host}:${face0.port}/（/v1/* 程序调用面在场，/api/* 404）`,
    );
  }

  // 常驻至优雅停：closer（face.stop + 清 pid）挂 runtime 六步退出序——drain
  // 序 = 注册序：webui-server 先注册（先摘 backend/路由/流，再停面——避免停面
  // 后信封扇出仍写入已关流）
  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  let settled = false;
  runtime.registerCloser({
    label: 'webui-server',
    fn: () => webuiMount?.detach(), // 幂等（未挂载形 = no-op）
  });
  if (issueWebhook !== undefined) {
    runtime.registerCloser({
      // webhook 路由摘除先于面停（注册序）——面 stop 后路由已无消费面
      label: 'issue-webhook',
      fn: () => issueWebhook.dispose(),
    });
  }
  runtime.registerCloser({
    label: 'sdk-http-face',
    fn: async () => {
      if (settled) return;
      settled = true;
      await face.stop();
      clearDaemonFootprints(paths); // 优雅停自清（猝死残留归 stop 幂等清扫）
      resolveExit(0);
    },
  });
  return exited;
}

/* ---------------- spawner（serve --daemon 拉起者） ---------------- */

/** spawner 选项（注入面：spawn/探活/时钟/等待/平台） */
export interface SpawnDaemonOptions {
  /** daemon 恒真（分派层保证——类型放宽 boolean 便 ServeFlags 直传） */
  readonly flags: DaemonServeFlags & {
    readonly daemon: boolean;
    readonly debug: boolean;
  };
  readonly dataDir?: string;
  readonly env?: Record<string, string | undefined>;
  /** 自镜像入口（缺省 [process.execPath, process.argv[1]]——测试注入假 spawn） */
  readonly self?: { readonly execPath: string; readonly mainPath: string };
  /** spawn 面注入（测试收 argv/env/stdio 账——返回假 child 句柄） */
  readonly spawnFn?: (cmd: string, args: readonly string[], opts: SpawnDaemonSpawnOptions) => DaemonChildHandle;
  readonly isAlive?: (pid: number) => boolean;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly fs?: DaemonFs;
  readonly platform?: NodeJS.Platform;
  readonly writeErr?: (line: string) => void;
}

/** spawn 选项形（detached + stderr 追加日志路径 + env） */
export interface SpawnDaemonSpawnOptions {
  readonly detached: true;
  readonly logPath: string;
  readonly env: Record<string, string | undefined>;
}

/** 假 child 句柄（测试注入面——产码真 child 兼容子集） */
export interface DaemonChildHandle {
  readonly pid?: number;
  readonly exitCode: number | null;
  once(event: 'exit', listener: (code: number | null) => void): void;
  unref(): void;
}

/**
 * spawner：spawn 自镜像 daemon child 后即退（脱离控制终端——POSIX setsid 族）。
 *
 * 编舞：win32 诚实拒（07 §5——随 TUI 支持矩阵 v1 不背书同裁）→ 开面判定
 * 预拦（非回环 × 无 token 退 2——免无谓 spawn）→ stderr 追加重定向 daemon.log
 * → spawn detached child（env 注 CHILD 标记防递归；argv 原样传 serve 旗标）
 * → 起活确认窗（SPAWN_CONFIRM_TIMEOUT_MS）轮询 pid 登记：pid 现 = 起活成功
 * 退 0；child 先退 = 转发其退出码 + 转述 daemon.log 尾行；窗尽未现 = 退 1
 * 报确认超窗（罕见——组装超 10s）。
 */
export async function spawnDaemonServe(options: SpawnDaemonOptions): Promise<number> {
  const writeErr = options.writeErr ?? ((line) => defaultStderr.write(`${line}\n`));
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    writeErr('daemon 形态暂不背书 win32（07 §5——随 TUI 支持矩阵 v1 同裁）');
    return 1;
  }

  const dataDir = options.dataDir ?? resolveDataDir();
  const paths = daemonPaths(dataDir);
  const env = options.env ?? process.env;

  // 开面判定预拦（child 侧 judgeListenConfig 同参兜底——fail-closed 双侧；
  // daemonListenConfig 真源共用——人面 + SDK 面多监听同参）
  const judged = judgeListenConfig(daemonListenConfig(paths, options.flags, env));
  if (!judged.ok) {
    writeErr(`拒启：${judged.reason}`);
    return 2;
  }

  const self = options.self ?? { execPath: process.execPath, mainPath: process.argv[1] ?? 'dist/host/main.js' };
  const args = [
    self.mainPath,
    'serve',
    '--daemon',
    ...(options.flags.port !== undefined ? ['--port', String(options.flags.port)] : []),
    ...(options.flags.sdkPort !== undefined ? ['--sdk-port', String(options.flags.sdkPort)] : []),
    ...(options.flags.sdkHost !== undefined ? ['--sdk-host', options.flags.sdkHost] : []),
    ...(options.flags.noDelta ? ['--no-delta'] : []),
    ...(options.flags.debug ? ['--debug'] : []),
  ];
  // spawn 面注入：logFd 的开落在缺省实现内（测试注假 spawn 不触真 fs——
  // serve/ 目录建与日志开同属产码缺省路径）
  const spawnFn =
    options.spawnFn ??
    ((cmd, argv, opts) => {
      mkdirSync(paths.dir, { recursive: true }); // 三足迹先备其二——pid 由 child 写
      const logFd = openSync(opts.logPath, 'a'); // stderr 追加重定向（07 §5）
      return spawn(cmd, argv as string[], {
        detached: opts.detached,
        stdio: ['ignore', 'ignore', logFd], // stdin/stdout ignore——daemon 与 stdio 互斥
        env: opts.env as NodeJS.ProcessEnv,
      });
    });
  const child: DaemonChildHandle = spawnFn(self.execPath, args, {
    detached: true,
    logPath: paths.logPath,
    env: { ...env, [DAEMON_CHILD_ENV]: '1' },
  });
  child.unref(); // spawner 即退——child 生命周期独立（setsid 脱离会话）

  // 起活确认窗：pid 登记现 + 探活 = 成功；child 先退 = 转发退码 + log 尾行
  const isAlive = options.isAlive ?? defaultIsAlive;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let childExit: number | null | undefined; // undefined = 未退
  if (child.pid !== undefined) {
    child.once('exit', (code) => {
      childExit = code;
    });
  } else {
    childExit = child.exitCode; // spawn 即败（ENOENT 等）——假句柄测试形态
  }
  const deadline = now() + SPAWN_CONFIRM_TIMEOUT_MS;
  for (;;) {
    const probe = probeDaemon(paths, isAlive, options.fs);
    if (probe.running) {
      writeErr(`daemon 已起（pid ${probe.record?.pid}）——pid/sock 登记 ${paths.dir}；日志 ${paths.logPath}`);
      return 0;
    }
    if (childExit !== undefined) {
      // child 秒死——转述 log 尾行（BUSY 等失败信息在 child stderr → log）
      writeErr(`daemon 启动即退（码 ${childExit}）——daemon.log 尾行：`);
      writeErr(tailLines(paths.logPath, options.fs));
      return childExit ?? 1;
    }
    if (now() >= deadline) {
      writeErr(`daemon 起活确认超窗（${SPAWN_CONFIRM_TIMEOUT_MS}ms 内 pid 登记未现）——查 ${paths.logPath}`);
      return 1;
    }
    await sleep(100);
  }
}

/** 读日志尾行（child 秒死转述——最多 3 行诊断面） */
function tailLines(logPath: string, fs?: DaemonFs): string {
  const f = { ...DEFAULT_FS, ...fs };
  try {
    const text = f.readFile(logPath);
    const lines = text.trimEnd().split('\n');
    return lines.slice(-3).join(' | ');
  } catch {
    return '（日志不可读）';
  }
}
