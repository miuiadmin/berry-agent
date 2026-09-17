/**
 * engine — 多路复用器（screen / tmux）真环境包裹行为锁（测试条件 D5）。
 *
 * 背景：env 判据矩阵（detectColorDepth：TERM/COLORTERM 组合 → 色域档）有纯函数
 * 测（tui/theme/theme.test.ts 用 screen-256color / tmux-256color 字面量），但
 * 真实多路复用器包裹下的行为零验证。本件补三面真链：
 * - **kitty 键盘协议降级**：引擎进屏写 kitty 推送（`CSI > 1 u`）+ 探测
 *   （`CSI ? u`）+ DA1 哨兵（`CSI c`）——多路复用器不透传 kitty 两串、DA1 由
 *   其自答（VT100 形），解码器/引擎应落定 legacy（探测应答不认 = 降级）；
 * - **OSC 11 吞没**：主题探测发的背景色查询（`OSC 11 ; ? BEL`——tui-backend
 *   OSC11_QUERY 同形）在多路复用器内层无应答到达——backend 探测超时降 dark
 *   的真实前提（真 InputDecoder 的 onOsc 观察面）；
 * - **SGR 透传**：色序在多路复用器内层非字节无损（screen 4.00.03 实测：256
 *   色重编码 `31m`+`91m`、真彩 `38;2;r;g;b` 被误析为 `2m`+`30m`）——文本与
 *   色信息以重编码形存活。
 *
 * 为什么必须真多路复用器：三面行为全是包裹层（screen/tmux 自身终端仿真与序列
 * 解析）的产物，注入/内存复现不了。链形 = python3 pty 中继（engine-restore.
 * pty.test.ts 同款基建）→ 多路复用器 attached 形 → tsx 起真引擎/真解码器。
 *
 * 真机实验定锚（2026-09-16 macOS /usr/bin/screen 4.00.03，tsx 探针预验证法）：
 * - TERM 被改写为 `screen.xterm-256color`（外层 xterm-256color），STY=`pid.会话名`
 *   在场；COLORTERM **透传不吞**（外层 truecolor → 内层照见——env 传播与 TERM
 *   改写是两机制）。本件外层剥 COLORTERM 以锁确定性 256 档判据链；
 * - kitty 推送/探测两串在外层流零出现（screen 吞没不转发）；
 * - DA1 由 screen 自答 `ESC[?1;2c`（app raw 模式下到达——**canonical 行缓冲
 *   会把无换行应答扣死在行缓冲区**，实验三的空应答假象即此；真引擎 start 即
 *   设 raw，天然免疫）；引擎 keyboardProtocol 事件与 getter 双落 legacy；
 * - OSC 11 查询（BEL / ST 双终形都试）零应答；
 * - SGR 非字节无损（上表）。
 *
 * tmux 腿：本地缺席 it.skipIf——装有 tmux 的机器 / CI 自动真跑（覆盖增强件）。
 * 断言锚取跨版本稳的核心（TMUX env 在场 / TERM=tmux-256color〔配置显式钉〕/
 * 协议降级 legacy〔tmux 缺省 extended-keys off 不应答 kitty 探测〕/ OSC 11
 * 零应答或 `11;rgb:` 可解析形〔tmux ≥3.2 自答、旧版吞没——两形皆合法〕/ 256
 * 色索引保真）。本机不可验——注释标注版本漂移面。
 * 值断言经 marker 读端剥 CSI 全族（stripCsi）：CI ubuntu 实红根——tmux 在客户端
 * 首绘时机注入 CSI Home（\x1b[H）粘 TERM 值尾，环境注入的转义序列不该打断值
 * 断言（单元级注入复现回归锁见「CSI 剥除纯逻辑回归锁」节）。
 *
 * SSH 腿：真 SSH 服务器在本环境不可得，不写假测（mock 违纪）——留真机件。
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { detectColorDepth, parseOsc11Reply } from '../tui/theme/index.js';

/* ---------------- pty 基建（engine-restore.pty.test.ts 同款——零新增 npm 依赖） ---------------- */

/** 仓内 tsx CLI（src/channels/engine → 上三级 = 仓根——子进程以 tsx 转译真源码形态起跑） */
const TSX_CLI = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url));
/** 引擎 / 解码器源路径（子脚本经 cfg 注入 import——脚本自身在临时目录无相对链） */
const ENGINE_TS = fileURLToPath(new URL('./engine.ts', import.meta.url));
const INPUT_TS = fileURLToPath(new URL('./input.ts', import.meta.url));

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

/** pty 中继脚本（python3 标准库 pty——真 TTY 从端挂子进程，字节全量中继） */
const PTY_RELAY_PY = `import os, pty, select, struct, fcntl, termios, subprocess, sys
argv = sys.argv[1:]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
child = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
out = sys.stdout.buffer
while True:
    if child.poll() is not None:
        break
    try:
        ready, _, _ = select.select([master], [], [], 0.2)
    except OSError:
        break
    if ready:
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if data:
            out.write(data)
            out.flush()
while True:
    try:
        data = os.read(master, 65536)
    except OSError:
        break
    if not data:
        break
    out.write(data)
# 收尾必须显式收尸（engine-restore 同律——未收尸 fail-loud 折非零不冒充成功）
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

/** screen 可用性探针（缺席即跳过——本机在场 /usr/bin/screen）。
 *  勿以退出码判：macOS 老版 4.00.03 `--version` 打印版本但退出码 1（实踩）——
 *  以「无 ENOENT 且 stdout 有版本字样」判在场。 */
let screenAvailable: boolean | undefined;
function hasScreen(): boolean {
  if (screenAvailable === undefined) {
    const r = spawnSync('screen', ['--version'], { stdio: 'pipe' });
    screenAvailable = r.error === undefined && /screen/i.test(r.stdout?.toString() ?? '');
  }
  return screenAvailable;
}

/** tmux 可用性探针（本地缺席——skipIf 形：装有 tmux 的机器 / CI 自动真跑） */
let tmuxAvailable: boolean | undefined;
function hasTmux(): boolean {
  if (tmuxAvailable === undefined) {
    tmuxAvailable = spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status === 0;
  }
  return tmuxAvailable;
}

/**
 * 多路复用器内层探针子脚本（tsx 起真源码）：
 * - 相 A：真 InputDecoder（onOsc/onProtocol 观察）+ 手写 DA1 / OSC 11 查询——
 *   OSC 应答的唯一真消费路径是 backend 装在解码器上的 onOsc（引擎自持解码器
 *   不出 OSC 面），故相 A 用真解码器独立观察；
 * - 相 B：真 Engine 进屏（inline + io 不注入 = 真 ProcessTerminalIO）——kitty
 *   推送 / 探测 / DA1 哨兵全由引擎自写，keyboardProtocol 事件 + getter 双报。
 * raw 模式在相 A 即设：canonical 行缓冲会扣死无换行的终端应答（实验三实证
 * 的假空应答根因）；引擎 start 再设为幂等。
 */
const CHILD_SCRIPT_MTS = `// cfg 经末位 argv 注入（JSON 串）：源路径 + 计时参数
const cfg = JSON.parse(process.argv[process.argv.length - 1]);
const { Engine } = await import(cfg.enginePath);
const { InputDecoder } = await import(cfg.inputPath);
const say = (k: string, v: string) => process.stdout.write(\`\${k}=\${v}\\r\\n\`);
say('CHILD_TERM', process.env.TERM ?? 'unset');
say('CHILD_STY', process.env.STY ?? 'unset');
say('CHILD_TMUX', process.env.TMUX ?? 'unset');
say('CHILD_COLORTERM', process.env.COLORTERM ?? 'unset');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 等多路复用器显示层初始化收尾——初始化窗内的早期写入有被丢竞态风险
await sleep(cfg.warmupMs);

// —— 相 A：真解码器独立观察（DA1 自答形 + OSC 11 应答形）——
process.stdin.setRawMode(true);
let aProto = 'none';
const oscSeen: string[] = [];
const decoder = new InputDecoder({
  onProtocol: (p) => { aProto = p; },
  onOsc: (data) => { oscSeen.push(data); },
});
process.stdin.setEncoding('utf8');
// 注意：与相 B 引擎的 stdin 监听是并存不互抢（Node 流多监听者各得全量副本）
process.stdin.on('data', (chunk: string) => decoder.feed(chunk));
process.stdin.resume();
process.stdout.write('\\x1b[c');        // DA1 查询（多路复用器自答——解码器协议落定的应答源）
process.stdout.write('\\x1b]11;?\\x07'); // OSC 11 背景色查询（BEL 终结——tui-backend OSC11_QUERY 同形）
await sleep(cfg.probeWaitMs);
say('A_PROTO', aProto);
say('A_OSC', JSON.stringify(oscSeen));
// —— SGR 透传探针：256 色 + 真彩两形（文本标记跟色序走——外层收存活形）——
process.stdout.write('\\x1b[38;5;196mSGR256MARK\\x1b[0m\\r\\n');
process.stdout.write('\\x1b[38;2;10;20;30mSGRTCMARK\\x1b[0m\\r\\n');
await sleep(300);

// —— 相 B：真引擎进屏（kitty 推送/探测/DA1 全由引擎 ENTER_COMMON 自写）——
let bEvent = 'none';
const engine = new Engine({}); // io 不注入 = 真 ProcessTerminalIO（多路复用器窗口 pty 从端）
engine.on('keyboardProtocol', (p) => { bEvent = p; });
engine.start({ measure: () => 1, render() {} }); // 最小渲染树根——本锁不验渲染内容
await sleep(cfg.probeWaitMs);
say('B_PROTO_EVENT', bEvent);
say('B_PROTO_GETTER', engine.keyboardProtocol);
engine.dispose();
await sleep(200);
process.exit(0);
`;

/** screenrc（确定性配置）：无启动横幅（防交互阻塞）+ autodetach off（pty 挂断即死不留 detached 会话） */
const SCREENRC = ['startup_message off', 'autodetach off', 'hardstatus off', 'msgminwait 0'].join('\n');

/** tmux conf（确定性配置）：无状态行 + 会话尾窗清空（命令退出即整会话退）+ TERM 钉 tmux-256color */
const TMUX_CONF = ['set -g status off', 'set -g exit-empty on', 'set -g default-terminal "tmux-256color"'].join('\n');

/** 会话名 / socket 名序号（每次运行唯一——并行 worker 不撞名） */
let runSeq = 0;

/**
 * 起一条多路复用器链：python3 pty 中继 → screen/tmux（attached 形，跑探针子
 * 脚本）→ 输出全收。screen 走 `-S 唯一名 -c 独立配置`；tmux 走 `-L 独立
 * socket`（server daemonize 后 detached 会话可存活——独立 socket 让收尾
 * kill-server 能精确点名，不污染全局）。
 */
function spawnWrapped(mux: 'screen' | 'tmux'): {
  output: () => string;
  exited: Promise<number | null>;
  session: string;
} {
  const scriptDir = makeTmpDir(`mux-${mux}-`);
  const scriptPath = join(scriptDir, 'child.mts');
  const relayPath = join(scriptDir, 'pty-relay.py');
  const muxConfPath = join(scriptDir, mux === 'screen' ? 'screenrc' : 'tmux.conf');
  writeFileSync(scriptPath, CHILD_SCRIPT_MTS);
  writeFileSync(relayPath, PTY_RELAY_PY);
  writeFileSync(muxConfPath, mux === 'screen' ? SCREENRC : TMUX_CONF);
  const session = `d5-${process.pid}-${runSeq++}`;
  const cfg = JSON.stringify({
    enginePath: ENGINE_TS,
    inputPath: INPUT_TS,
    warmupMs: 600,
    probeWaitMs: 1200,
  });
  // 外层环境：TERM 钉 xterm-256color（外层色能力基线）；剥 COLORTERM（锁
  // 「内层 TERM 尾判 → 256 档」确定性判据链——COLORTERM 透传不吞是真行为但
  // 会让真彩档短路本链）；剥 STY/TMUX（测试进程自身在多路复用器内的嵌套残迹）
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    BERRY_AGENT_LOG_LEVEL: 'silent',
    COLORTERM: undefined,
    STY: undefined,
    TMUX: undefined,
  };
  const muxArgv =
    mux === 'screen'
      ? ['screen', '-c', muxConfPath, '-S', session, process.execPath, TSX_CLI, scriptPath, cfg]
      : [
          'tmux',
          '-u',
          '-f',
          muxConfPath,
          '-L',
          session,
          'new-session',
          '-x',
          '80',
          '-y',
          '24',
          '-s',
          session,
          process.execPath,
          TSX_CLI,
          scriptPath,
          cfg,
        ];
  const child = spawn('python3', [relayPath, ...muxArgv], {
    env,
    cwd: scriptDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  children.push(child);
  const chunks: string[] = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => chunks.push(chunk));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => chunks.push(chunk)); // tsx 报错混收——诊断现场
  return { output: () => chunks.join(''), exited: waitExit(child), session };
}

/**
 * CSI 转义序列全族正则：ESC + `[` + 参数域（数字/分号/`?`）+ 字母终结字节。
 * 覆盖多路复用器向输出流注入的同族序列——客户端首绘的 CSI Home（`\x1b[H`）、
 * DA1 自答（`\x1b[?6c` / `\x1b[?1;2c`）等；全族剥除，非仅 `\x1b[H` 特判。
 */
const CSI_SEQ = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * 标记值读端剥 CSI 序列（纯函数——CI-only 红根的单元级回归锁靶）。
 *
 * 根因（CI ubuntu run 35170605787/35182004390/35182142621 实红）：tmux 在
 * 客户端首绘时机注入 CSI Home（`\x1b[H`），粘在子脚本标记值尾——裸提取得
 * `'tmux-256color\x1b[H'`，`expect(term).toBe('tmux-256color')` 红；本机
 * macOS 时序不同恒绿（真环境测的观察盲区，以纯逻辑注入用例补锁）。环境注入
 * 的转义序列本就不该打断值断言——文件头注已声明断言锚取跨版本稳的核心。
 */
function stripCsi(value: string): string {
  return value.replace(CSI_SEQ, '');
}

/** 标记提取（子脚本 `KEY=VALUE\r\n` 形——多路复用器重渲染保文本连续性，本机实证）。
 *  值经 stripCsi 剥 CSI 全族——多路复用器注入的转义序列（首绘 Home / DA1 自答
 *  同族）不进断言面；缺席语义（null）不受剥除影响。 */
function marker(out: string, key: string): string | null {
  const m = new RegExp(`${key}=([^\\r\\n]*)`).exec(out);
  return m === null ? null : stripCsi(m[1]!);
}

/** 终端序列计数（字节级判据） */
const count = (out: string, seq: string): number => out.split(seq).length - 1;

/** 共享一次多路复用器运行（beforeAll 起链等退——各 it 从同一捕获断言不同面） */
async function runWrappedOnce(mux: 'screen' | 'tmux'): Promise<string> {
  const run = spawnWrapped(mux);
  try {
    // 等末位标记（相 B 完成）再等退——链完整收束的判据
    await waitFor(
      `${mux} 探针收束（B_PROTO_GETTER）`,
      60_000,
      () => run.output().includes('B_PROTO_GETTER='),
      run.output,
    );
    const code = await exitWithTimeout(run.exited, 30_000, run.output);
    expect(code).toBe(0); // 探针子脚本 + 多路复用器全链干净退出
    return run.output();
  } finally {
    // 收尾兜底层：登记簿 SIGKILL 杀中继 → pty master 关 → screen autodetach
    // off 即死；tmux server detached 可存活——kill-server 独立 socket 精确点名
    if (mux === 'tmux') spawnSync('tmux', ['-L', run.session, 'kill-server'], { stdio: 'ignore' });
    else spawnSync('screen', ['-S', run.session, '-X', 'quit'], { stdio: 'ignore' });
  }
}

/* ---------------- CSI 剥除纯逻辑回归锁（CI-only 红根单元级复现——零环境依赖全机真跑） ---------------- */

describe('marker 读端 CSI 剥除：CI-only 红根回归锁（单元级注入复现）', () => {
  it('CI 实红形：tmux 首绘注入 CSI Home 粘值尾——提取值恰 tmux-256color', () => {
    // run 35170605787/35182004390 断言红实形：expected 'tmux-256color[H'
    // to be 'tmux-256color'——注入形在值尾、行终符前（本机 macOS 时序不现，
    // 纯逻辑注入形补锁）
    const out = 'CHILD_TMUX=/tmp/mux\r\nCHILD_TERM=tmux-256color\x1b[H\r\n';
    expect(marker(out, 'CHILD_TERM')).toBe('tmux-256color');
  });

  it('同族注入形：DA1 自答 \\x1b[?6c / \\x1b[?1;2c 粘值尾——同样剥净（全族非特判）', () => {
    expect(marker('CHILD_TERM=tmux-256color\x1b[?6c\r\n', 'CHILD_TERM')).toBe('tmux-256color');
    expect(marker('CHILD_TERM=tmux-256color\x1b[?1;2c\r\n', 'CHILD_TERM')).toBe('tmux-256color');
  });

  it('注入落在值中段（首绘重绘劈线形）——剥后拼回原值', () => {
    expect(marker('CHILD_TERM=tmux-256\x1b[Hcolor\r\n', 'CHILD_TERM')).toBe('tmux-256color');
  });

  it('无注入裸值原样提取（剥除不扰动净流）', () => {
    expect(marker('CHILD_TERM=tmux-256color\r\n', 'CHILD_TERM')).toBe('tmux-256color');
    expect(marker('CHILD_STY=12345.d5-0\r\n', 'CHILD_STY')).toBe('12345.d5-0');
  });

  it('标记缺席仍 null（剥除不改变缺席语义）', () => {
    expect(marker('OTHER=x\r\n', 'CHILD_TERM')).toBeNull();
  });
});

/* ---------------- screen 腿（本机真跑——4.00.03 实测定锚） ---------------- */

describe('多路复用器真环境包裹行为锁：screen 腿（本机真跑）', () => {
  let out = '';
  beforeAll(async () => {
    out = await runWrappedOnce('screen');
  }, 120_000);

  it.skipIf(!hasPtyRelay() || !hasScreen())(
    'env 真值：TERM 被改写为 screen.* 族 + STY 在场 + 真值直喂 detectColorDepth 落矩阵尾判',
    () => {
      const term = marker(out, 'CHILD_TERM');
      const sty = marker(out, 'CHILD_STY');
      // STY = <pid>.<会话名> 形在场——真在 screen 会话内的环境铁证
      expect(sty).toMatch(/^\d+\.\S+/);
      // screen 改写 TERM（本机实测 xterm-256color → screen.xterm-256color；
      // 版本/配置形差异收窄为 screen 前缀——screen-256color / screen.xterm-256color 皆中）
      expect(term).toMatch(/^screen[.\-]/);
      // 判据链前提自证：外层 COLORTERM 已剥——内层不得见（真彩档短路防）
      expect(marker(out, 'CHILD_COLORTERM')).toBe('unset');
      // 真值直喂纯函数矩阵：真实 TERM 形（本机 screen.xterm-256color）在
      // includes('256color') 尾判支上兑现（矩阵单测用 screen-256color 字面量，
      // 真机给的是 screen. 前缀变体——同落 256 档）
      const depth = detectColorDepth({ TERM: term! });
      expect(depth).toBe(term!.includes('256color') ? '256' : '16');
    },
  );

  it.skipIf(!hasPtyRelay() || !hasScreen())(
    'kitty 降级（解码器腿）：DA1 由 screen 自答 → 真解码器 onProtocol 落定 legacy + kitty 两串被吞不透传',
    () => {
      // 相 A 手发 DA1 → screen 自答 VT100 形（本机实测 ESC[?1;2c）→ 真解码器
      // 裁定 legacy（kitty 应答从未到）
      expect(marker(out, 'A_PROTO')).toBe('legacy');
      // 吞没外证：引擎的 kitty 推送（CSI > 1 u）与探测（CSI ? u）在外层流零
      // 出现——screen 不透传未知 CSI 给真终端（降级的另一半：外层真 kitty 终
      // 端也接不到探测，无应答可回）
      expect(count(out, '\x1b[>1u')).toBe(0);
      expect(count(out, '\x1b[?u')).toBe(0);
    },
  );

  it.skipIf(!hasPtyRelay() || !hasScreen())(
    'kitty 降级（引擎腿）：真 Engine 进屏——keyboardProtocol 事件与 getter 双落 legacy',
    () => {
      // 引擎 ENTER_COMMON 自写 kitty 推送/探测/DA1 哨兵 → screen 自答 DA1 →
      // 引擎自持解码器落定 legacy 并上抛事件（本机实验二/五双证）
      expect(marker(out, 'B_PROTO_EVENT')).toBe('legacy');
      expect(marker(out, 'B_PROTO_GETTER')).toBe('legacy');
    },
  );

  it.skipIf(!hasPtyRelay() || !hasScreen())(
    'OSC 11 吞没：背景色查询在内层零应答（backend 探测超时降 dark 的真实前提）',
    () => {
      // 相 A 以真解码器 onOsc 观察（BEL 终结查询——tui-backend OSC11_QUERY 同
      // 形；本机实测 BEL/ST 双终形都吞、raw 读窗内零到达）。先锚标记在场——
      // 缺标记即空数组假绿（免红口径：断言必须绑真内容）
      expect(marker(out, 'A_OSC')).not.toBeNull();
      const seen: unknown = JSON.parse(marker(out, 'A_OSC')!);
      expect(Array.isArray(seen)).toBe(true);
      const osc11 = (seen as string[]).filter((data) => data.startsWith('11;'));
      expect(osc11).toEqual([]);
    },
  );

  it.skipIf(!hasPtyRelay() || !hasScreen())('SGR 透传：文本标记双存活 + 256 色信息以重编码形存活（非字节无损）', () => {
    // 文本经 screen 终端仿真重渲染存活（两形标记都在场）
    expect(out).toContain('SGR256MARK');
    expect(out).toContain('SGRTCMARK');
    // 256 色信息存活但不保字节形：本机 4.00.03 把 38;5;196 重编码为
    // `31m`+`91m`（16 色亮红族）；新版 screen（外层 TERM=xterm-256color）
    // 可原样保 38;5;196——两形都算色信息存活。真彩 `38;2;r;g;b` 在 4.00.03
    // 被误析为 `2m`+`30m`（2006 年版早于真彩出生）——字节形随版本漂移，
    // 只锁文本与 256 色信息，不锁真彩字节形
    const colorSurvived = out.includes('38;5;196') || out.includes('91m') || out.includes('31m');
    expect(colorSurvived).toBe(true);
  });
});

/* ---------------- tmux 腿（本地缺席 skipIf——装有 tmux 的机器 / CI 自动真跑） ---------------- */

describe('多路复用器真环境包裹行为锁：tmux 腿（skipIf 增强件）', () => {
  let out = '';
  beforeAll(async () => {
    out = await runWrappedOnce('tmux');
  }, 120_000);

  it.skipIf(!hasPtyRelay() || !hasTmux())(
    'env 真值：TMUX env 在场 + TERM 钉 tmux-256color + 真值直喂 detectColorDepth 落矩阵尾判',
    () => {
      const term = marker(out, 'CHILD_TERM');
      // TMUX 环境变量（socket 路径形）在场——真在 tmux 会话内的环境铁证
      expect(marker(out, 'CHILD_TMUX')).toMatch(/^\S+/);
      // 配置显式 default-terminal=tmux-256color——内层 TERM 确定性（跨版本
      // 钉死，不赌发行版缺省值漂移）
      expect(term).toBe('tmux-256color');
      const depth = detectColorDepth({ TERM: term! });
      expect(depth).toBe(term!.includes('256color') ? '256' : '16');
    },
  );

  it.skipIf(!hasPtyRelay() || !hasTmux())(
    'kitty 降级：真 Engine 进屏——协议落定 legacy（tmux 缺省 extended-keys off 不应答 kitty 探测）',
    () => {
      // tmux 恒自答 DA1（应用侧 DA1 由其应答）→ 引擎落定 legacy。注意版本
      // 漂移面：若机器显式开 extended-keys on，tmux 3.3+ 可应答 kitty 探测
      // ——红即有效情报（该形下引擎走 kitty 轨是协议正确行为，非缺陷）
      expect(marker(out, 'B_PROTO_EVENT')).toBe('legacy');
      expect(marker(out, 'B_PROTO_GETTER')).toBe('legacy');
    },
  );

  it.skipIf(!hasPtyRelay() || !hasTmux())(
    'OSC 11：零应答（旧版吞没）或 11;rgb: 可解析形（tmux ≥3.2 自答）——两形皆合法',
    () => {
      // 版本分叉：tmux <3.2 吞 OSC 11 查询零应答；≥3.2 以自身缺省背景自答
      // `11;rgb:RRRR/GGGG/BBBB` 形。两形都落在探测消费面的合法输入域——
      // 零应答走超时降 dark，rgb 形走 parseOsc11Reply 明暗裁定。断言锚：
      // 凡有应答必可解析（不得有乱形应答挂死或误判探测面）。标记先锚在场
      // ——缺标记即空数组假绿
      expect(marker(out, 'A_OSC')).not.toBeNull();
      const seen: unknown = JSON.parse(marker(out, 'A_OSC')!);
      expect(Array.isArray(seen)).toBe(true);
      const osc11 = (seen as string[]).filter((data) => data.startsWith('11;'));
      for (const reply of osc11) {
        expect(parseOsc11Reply(reply)).not.toBeNull();
      }
    },
  );

  it.skipIf(!hasPtyRelay() || !hasTmux())(
    'SGR 透传：文本标记双存活 + 256 色索引保真（tmux 以外层 xterm-256color 再编码）',
    () => {
      expect(out).toContain('SGR256MARK');
      expect(out).toContain('SGRTCMARK');
      // tmux 侧 256 色索引保真再发（外层 TERM=xterm-256color 下以 38;5;196
      // 形到达——与 screen 的 16 色族重编码形成对照）
      expect(out).toContain('38;5;196');
    },
  );
});
