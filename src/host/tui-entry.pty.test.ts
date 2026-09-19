/**
 * host — TUI 入口无真终端进程级 e2e（测试条件 E16）。
 *
 * 现状背景：TUI 入口级（真起进程 → 真终端 → 干净退出）此前零进程级实证
 * ——既有入口测试（tui-entry.test.ts）全走 FakeTerminalIO 注入，终端设备态
 * （TTY 卫兵、raw mode、模式转义序列、退出复原）只有引擎级 pty 锁
 * （engine-restore.pty.test.ts）。注入面复现不了三件事：
 * ① parseCli/dispatch 的非 TTY 卫兵（07 §5——stdin/stdout 非真 TTY 即退 2，
 *   只有真 pty 才能证明卫兵放行的是「真交互环境」）；
 * ② ProcessTerminalIO 真身（process.stdin/stdout 直连——raw mode 是设备态，
 *   FakeTerminalIO 的 setRawMode 只记布尔位）；
 * ③ 全链退出序复原字节（closer 'tui-backend' → backend.stop → LEAVE_MAIN
 *   出屏 + OSC 复原——经真 pty 字节流才可数）。
 *
 * 形态（复用 engine-restore.pty.test.ts 全套基建——python3 pty 标准库中继
 * 零 npm 依赖 + tsx 真源码起跑 + children 登记簿 + 字节计数判据法；本件
 * 扩一键盘中继腿：中继 stdin → pty master，测试侧可写真输入字节）：子进程
 * 以 tsx 起 **bin 入口真身** src/host/main.ts（零参 = TUI 主入口——比合成
 * 脚本更短的真链不存在），挂真 pty；起跑就绪（OSC title 首写）后立即驱动
 * 退出，断言三面：
 * - (a) 有限时内干净退出：退出码 0（中继透传真子退出码——非 kill 形）；
 * - (b) 终端态复原：进屏字节在场为前提（粘贴开 + kitty 探测——防「从未
 *   进屏」假绿），出屏复原字节在场（kitty 弹栈 + 粘贴关——LEAVE_MAIN 单源
 *   对称反序）+ OSC 9;4 进度清零（stop 的 osc.restore 无条件写）；
 * - (c) 主屏 inline 形态恒不碰 1049 备屏（与 engine-restore inline 腿同律
 *   ——结构性义务，非行为巧合）。
 *
 * 两条退出路各锁一腿（入口真支持的两形）：ctrl+d 空框（0x04 单字节——全局
 * 退出键）/ `/exit` 回车（退出词本地拦截——07 §4.1 /exit 批）。
 *
 * 模型凭证无关性：纯 TUI 起跑不发请求（模型标识只是字符串，resolveModel
 * fail-loud 推迟到 LLM 调用边界）——本锁零凭证可跑。
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/* ---------------- pty 基建（engine-restore.pty.test.ts 同族——零新增 npm 依赖） ---------------- */

/** 仓内 tsx CLI（src/host → 上两级 = 仓根——子进程以 tsx 转译真源码形态起跑） */
const TSX_CLI = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));
/** bin 入口真身（零参 = TUI 主入口——parseCli → 非 TTY 卫兵 → runTuiEntry 全链） */
const MAIN_TS = fileURLToPath(new URL('./main.ts', import.meta.url));

/** 临时目录（realpath 防 macOS /var 符号链） */
function makeTmpDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
}

/** 子进程登记簿（afterEach 兜杀——测试失败路径不留孤儿进程） */
const children: ChildProcessWithoutNullStreams[] = [];
afterEach(() => {
  for (const child of children.splice(0)) {
    child.kill('SIGKILL');
  }
});

/** 子进程退出码（resolve 型——exit 监听 spawn 后立即挂，事件只发一次） */
function waitExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
  });
}

/** 退出码限时等待（超时抛错带现场输出——防子进程悬死挂测试） */
async function exitWithTimeout(
  exited: Promise<number | null>,
  timeoutMs: number,
  output: () => string,
): Promise<number | null> {
  const timer = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`子进程 ${timeoutMs}ms 未退出——输出尾段：\n${output().slice(-1500)}`)),
      timeoutMs,
    );
  });
  return Promise.race([exited, timer]);
}

/** 通用轮询等待：判词转真或超时抛错（含现场输出） */
async function waitFor(what: string, timeoutMs: number, pred: () => boolean, output: () => string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (pred()) return;
    if (Date.now() > deadline) {
      throw new Error(`等待超时（${what}，${timeoutMs}ms）——当前输出尾段：\n${output().slice(-1500)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** 定睡（起跑就绪后的输入稳定窗——title 首写与输入管线挂接同在 start() 同步段，
 * 但字节经 pty/管道回到测试侧有时差，留窗防「输入先于 raw mode 落进 cooked 态」） */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * pty 中继脚本（python3 标准库 pty——真 TTY 从端挂子进程）。与 engine-restore
 * 的单向中继相比扩一腿：本中继的 stdin（测试侧管道）→ pty master，测试可向
 * 真终端写真输入字节（ctrl+d / `/exit` 回车的驱动通道）。stdin EOF 后停止
 * 监听该源（测试侧不关管道——EOF 只在异常路径出现，防忙转）。
 */
const PTY_RELAY_PY = `import os, pty, select, struct, fcntl, termios, subprocess, sys
argv = sys.argv[1:]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
child = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
out = sys.stdout.buffer
watch_stdin = True
while True:
    if child.poll() is not None:
        break
    sources = [master] + ([sys.stdin] if watch_stdin else [])
    try:
        ready, _, _ = select.select(sources, [], [], 0.2)
    except OSError:
        break
    if master in ready:
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if data:
            out.write(data)
            out.flush()
    if watch_stdin and sys.stdin in ready:
        data = sys.stdin.buffer.read1(65536)
        if data:
            os.write(master, data)
        else:
            watch_stdin = False
while True:
    try:
        data = os.read(master, 65536)
    except OSError:
        break
    if not data:
        break
    out.write(data)
# 收尾必须显式收尸：排空循环 break 时 child 可能尚未被 reap（Linux 上 child 关
# stdio 后 master 读即 EIO——relay 先于子进程真退收尸），returncode=None 被
# or-0 折成 0 吞掉真退出码（承 engine-restore CI 实测谱——CI run 34604785581）。
# 未收尸 fail-loud 折非零，不冒充成功。
try:
    child.wait(timeout=30)
except subprocess.TimeoutExpired:
    child.kill()
    child.wait()
sys.exit(child.returncode if child.returncode is not None else 1)
`;

/** python3 + pty 模块可用性探针（缺席即跳过——非 unix / 精简环境不失信） */
let ptyRelayAvailable: boolean | undefined;
function hasPtyRelay(): boolean {
  if (ptyRelayAvailable === undefined) {
    ptyRelayAvailable =
      process.platform !== 'win32' && spawnSync('python3', ['-c', 'import pty'], { stdio: 'ignore' }).status === 0;
  }
  return ptyRelayAvailable;
}

/**
 * 起入口级锁子进程：python3 pty 中继 → tsx 起 bin 入口真身（零参 TUI 形态，
 * 真 TTY stdio + 真输入通道），输出全收。
 *
 * env 隔离三键：
 * - BERRY_AGENT_DATA_DIR → 新临时数据目录（防污染真数据 + 单活跃机锁免撞）；
 * - BERRY_AGENT_LOG_LEVEL=silent（日志不入终端字节流，判据面干净）；
 * - TERM=xterm-256color（色域档裁定确定性——不赌宿主环境 TERM 在场）。
 * cwd = 新临时工作区（启动会话锚点不落真目录）。
 */
function spawnTuiEntry(): {
  output: () => string;
  exited: Promise<number | null>;
  send: (bytes: string) => void;
} {
  const dataDir = makeTmpDir('tui-pty-data-');
  const wsDir = makeTmpDir('tui-pty-ws-');
  const scriptDir = makeTmpDir('tui-pty-relay-');
  const relayPath = join(scriptDir, 'pty-relay.py');
  writeFileSync(relayPath, PTY_RELAY_PY);
  const child = spawn('python3', [relayPath, process.execPath, TSX_CLI, MAIN_TS], {
    env: {
      ...process.env,
      BERRY_AGENT_DATA_DIR: dataDir,
      BERRY_AGENT_LOG_LEVEL: 'silent',
      // 启动版本检查关断（07 §8.5 第 6 条——pty 真身测试零网络律）
      BERRY_AGENT_SKIP_UPDATE_CHECK: '1',
      TERM: 'xterm-256color',
    },
    cwd: wsDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  children.push(child);
  const chunks: string[] = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => chunks.push(chunk));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => chunks.push(chunk)); // tsx 报错混收——诊断现场
  return {
    output: () => chunks.join(''),
    exited: waitExit(child),
    // 输入字节经中继 stdin → pty master → 子进程（raw 态下按字面送达）
    send: (bytes: string) => {
      child.stdin.write(bytes);
    },
  };
}

/** 终端序列计数（字节级判据） */
const count = (out: string, seq: string): number => out.split(seq).length - 1;

/** 共享断言面：干净退 0 + 复原字节三族（(a)(b)(c) 三面——两退出路同律） */
async function assertCleanExitRestored(lock: ReturnType<typeof spawnTuiEntry>): Promise<void> {
  const code = await exitWithTimeout(lock.exited, 30_000, lock.output);
  expect(code).toBe(0); // (a) 中继透传真子退出码——0 = TUI 自身干净退场（非 kill/信号形）
  const out = lock.output();
  // (b) 判据前提：主屏确实武装了终端（数的是「出屏」不是「从未进屏」）
  expect(count(out, '\x1b[?2004h')).toBeGreaterThanOrEqual(1); // bracketed paste 开（ENTER_MAIN）
  expect(count(out, '\x1b[?u')).toBeGreaterThanOrEqual(1); // kitty 探测（ENTER_MAIN）
  // (b) 出屏复原字节在场（LEAVE_MAIN 与进屏严格对称反序——单源常量）
  expect(count(out, '\x1b[<u')).toBeGreaterThanOrEqual(1); // kitty 键盘协议弹栈（恢复宿主栈态）
  expect(count(out, '\x1b[?2004l')).toBeGreaterThanOrEqual(1); // 粘贴关
  // (b) 外显复原：OSC 9;4 进度清零（stop 的 osc.restore 无条件写——终态收口）
  expect(count(out, '\x1b]9;4;0\x07')).toBeGreaterThanOrEqual(1);
  // (c) 主屏 inline 形态恒不碰备屏（1049 零进出——结构性义务非行为巧合）
  expect(count(out, '\x1b[?1049h')).toBe(0);
  expect(count(out, '\x1b[?1049l')).toBe(0);
}

describe('TUI 入口真终端进程级 e2e（E16——bin 入口 → 真 pty → 驱动退出 → 复原字节）', () => {
  it.skipIf(!hasPtyRelay())(
    'ctrl+d 空框退出：起跑就绪后单字节 0x04 → 干净退 0 + 终端态复原（kitty 弹栈/粘贴关/进度清零）',
    async () => {
      const lock = spawnTuiEntry();
      // 起跑就绪门：OSC title 首写（backend.start 段——装配序全过的活证：
      // 非 TTY 卫兵放行 = 真 TTY；组装失败形在此窗内以非零退场，waitFor/exit 路径均 fail-loud）
      await waitFor('TUI 起屏（OSC title 首写）', 60_000, () => count(lock.output(), '\x1b]0;') >= 1, lock.output);
      await sleep(300); // 输入稳定窗（raw mode + 输入管线挂接的字节回程时差）
      lock.send('\x04'); // ctrl+d 空框——全局退出键（raw 态单字节按字面送达）
      await assertCleanExitRestored(lock);
    },
    120_000,
  );

  it.skipIf(!hasPtyRelay())(
    '/exit 退出词拦截：键入 /exit 回车 → 本地拦截同路优雅退 0 + 终端态复原',
    async () => {
      const lock = spawnTuiEntry();
      await waitFor('TUI 起屏（OSC title 首写）', 60_000, () => count(lock.output(), '\x1b]0;') >= 1, lock.output);
      await sleep(300);
      lock.send('/exit\r'); // 退出词 + 回车——经真 InputDecoder 进编辑器，提交段本地拦截（零参恰命中）
      await assertCleanExitRestored(lock);
    },
    120_000,
  );
});
