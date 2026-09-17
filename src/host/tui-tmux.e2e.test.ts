/**
 * host — TUI 真环境验收套件（tmux 内层 e2e——2026-09-17 TUI 余量收官批①）。
 *
 * 规范依据：07 §4.1「v1 验证面 = POSIX 终端族——xterm 兼容族 / kitty /
 * tmux（内层）/ wezTerm / iTerm2 / Terminal.app」——tmux 是矩阵明列项，本件
 * 即该条款的可跑闭环：**真终端模拟器在环**（tmux 自持 pty + 屏幕网格模型 +
 * 键盘编码面），判据法 = 终端态可见行（capture-pane 收屏）而非字节流——
 * oracle 快照矩阵的 CI 可跑近似形（GitHub Actions ubuntu 预装 tmux）。
 *
 * 与既有两层验证的分职：MemoryTerminalIO 注入面复现不了「真终端模拟器如何
 * 解释我方写出的序列」（tmux 网格即第二真相源）；E16 python3-pty 进程级
 * 三面（非 TTY 卫兵 / ProcessTerminalIO 真身 / 退出复原字节）驱动的是字节
 * 流——本件改 tmux 形后驱动面 = send-keys 键入（经 tmux 键盘编码→pty→
 * 我方 InputDecoder 全链）、断言面 = 收屏可见行（经我方渲染→pty→tmux 网格
 * 解析全链），两端都在真终端语义里闭环。
 *
 * 基建（循 tui-entry.pty.test.ts E16 律，python3 中继换成 tmux 会话）：
 * - tmux -f /dev/null（免用户 tmux.conf 干扰）+ -L 隔离 socket（独立服务端
 *   实例——不触碰用户既有 tmux 服务）起 detached 会话 100x30；会话命令 =
 *   cd 临时工作区 && env 隔离键 + tsx 起 bin 入口真身 src/host/main.ts
 *   （零参 = TUI 主入口）；退出码经壳层 `printf %s "$?"` 落临时文件（会话
 *   消亡后唯一可读的真退出码载体）；
 * - 驱动：tmux send-keys（-l 字面形驱动中文与命令词——零 IME 组字、
 *   纯 UTF-8 字节；具名键 Enter/Escape 走 tmux 键编码面）；
 * - 断言：tmux capture-pane -p 收可见行轮询（辅以失败现场尾段——诊断面）；
 * - 收口：afterEach 逐会话 kill-session + afterAll kill-server（会话进程
 *   属 tmux 服务端——服务端级兜杀即 E16「无孤儿进程残留」律的本件形）；
 * - 测间会话名唯一（pid + 计数器后缀防串）；tmux 二进制缺席或服务端起不来
 *   （沙箱拦 unix socket 形）describe.skipIf 诚实跳过——不硬闯。
 *
 * 模型凭证无关性（E16 注记同律）：纯 TUI 起跑不发请求（模型标识只是
 * 字符串，resolveModel fail-loud 推迟到 LLM 调用边界）——本锁零凭证可跑。
 *
 * 验收九面（终端态可见行判据）：
 * 1. 起跑进屏：footer 三段（cwd 短名 · 模型名 · 会话短 id）与编辑器边框在场；
 * 2. 中文输入：字面中文 send-keys 后编辑器行回显在场（零模型依赖——不提交）；
 * 3. /help 副屏：命令册标题行呈现 → q 收屏回主屏（收屏后 footer 复在场）；
 * 4. /themes 副屏：主题条目行呈现 + esc 收屏；
 * 5. /marketplace 选装副屏（03 §9.6 mp-5）：本地市场源经 CLI 真身入册后
 *    头行（条目/源计数）与条目行（寻址形 name@market）呈现 → q 收屏；
 * 6. resize：resize-window 100→120 后 repaint 完整（边框行宽随几何更新 +
 *    footer 仍在场 + 边框行唯一无残行）；
 * 7. /exit：干净退出（会话消亡 + 壳层落盘退出码 0——send-keys /exit Enter 形）；
 * 8. /thinking 副屏（会话档位切换面批 F1）：头行（◆ 思考档位 · 七档计数）
 *    与尾档条目行呈现 → end+enter 选定 max → footer 行右段回执
 *    「思考档位：max（下一 run 起生效…）」+ 副屏收屏回主屏（首跑曾抓
 *    end 键 tmux 内层死键真缺陷——TILDE_KEYS 补 4: 'end' 已修，end 消费在环）；
 * 9. /sandbox 副屏（会话档位切换面批 F2 同构）：头行（◆ 沙箱档位 · 三档
 *    计数）与 danger 档条目行呈现 → end+enter 选定 danger → footer 行右段
 *    回执「沙箱档位：danger（即刻生效…）」+ 副屏收屏回主屏。
 *
 * 本件属**新验收面**：首跑绿 = 锁在；首跑红 = 抓到真缺陷（停手报告不擅修）。
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

/* ---------------- tmux 基建（件内自持——立项档①「tmux 命令封装辅助函数件内自持」） ---------------- */

/** 仓内 tsx CLI（src/host → 上两级 = 仓根——会话内以 tsx 转译真源码形态起跑，E16 同源） */
const TSX_CLI = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));
/** bin 入口真身（零参 = TUI 主入口——parseCli → 非 TTY 卫兵 → runTuiEntry 全链，E16 同源） */
const MAIN_TS = fileURLToPath(new URL('./main.ts', import.meta.url));

/**
 * 隔离 socket 名（每测试进程一枚独立 tmux 服务端——不触碰用户既有服务；
 * afterAll kill-server 兜杀即「无孤儿进程」律的服务端级收口）。
 */
const SOCK = `berry-e2e-${process.pid}`;

/** 起跑几何（验收面 5 将 100 宽 resize 到 120——宽度可观察地驱动 repaint） */
const GEOM_W = 100;
const GEOM_H = 30;

/** footer 模型段锚（BERRY_AGENT_MODEL 注入确定值——provider/model 形取 model 段短名） */
const MODEL_ID = 'dummy/tui-tmux-e2e';
const MODEL_SHORT = 'tui-tmux-e2e';

/** tmux 调用统一前参（-f /dev/null 只在服务端首起生效——重复传无害） */
function tmuxArgs(args: readonly string[]): string[] {
  return ['-L', SOCK, '-f', '/dev/null', ...args];
}

/** 单次 tmux 客户端调用（同步短命令——15s 帽防挂；utf8 编码面窄化返回型） */
function tmux(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync('tmux', tmuxArgs(args), { encoding: 'utf8', timeout: 15_000 });
}

/** tmux 二进制在场探针（缺席 = 非 POSIX tmux 环境，诚实跳过） */
function hasTmuxBinary(): boolean {
  return spawnSync('tmux', ['-V'], { stdio: 'ignore', timeout: 10_000 }).status === 0;
}

/** tmux 服务端可起探针（沙箱拦 unix socket 形在此现形——一次探测全程缓存） */
let tmuxUsable: boolean | undefined;
function hasUsableTmux(): boolean {
  if (tmuxUsable === undefined) {
    tmuxUsable =
      hasTmuxBinary() && tmux(['new-session', '-d', '-x', '20', '-y', '5', '-s', `${SOCK}-probe`, 'true']).status === 0;
    // 探针会话命令 `true` 即退——kill 失败（会话已亡）无害；服务端随末会话消亡自灭
    tmux(['kill-session', '-t', `${SOCK}-probe`]);
  }
  return tmuxUsable;
}

/** 临时目录（realpath 防 macOS /var 符号链——E16 同律） */
function makeTmpDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
}

/** 定睡（轮询间隔） */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 起跑就绪轮询帽（tsx 转译 + 全栈 boot——E16 用 60s，本件独立会话同量级放宽） */
const STARTUP_TIMEOUT_MS = 45_000;
/** 副屏开/收等屏面跃迁轮询帽 */
const STEP_TIMEOUT_MS = 10_000;
/**
 * esc 腿收屏等待专用宽帽（按需调宽——不动 STEP_TIMEOUT_MS 全局值）。
 *
 * 归因史（两 run 同一引擎根，前笔「CI 慢机 CPU 饿死窗」系误诊已勘正）：
 * run 35182004390（test ubuntu）10s 帽红、调宽至 25s 后 run 35206555674
 * （release-drill）同用例仍红且面板稳态未收——帽打满证明非时间问题。真根
 * = lone-ESC 挂起窗内 tmux 迟到的 DA1 应答（`\x1b[?1;2;4c`——副屏进屏
 * ENTER_COMMON 探测哨兵的回声，恒 ESC 起头）与用户 ESC 撞窗：旧「ESC ESC
 * = alt+Escape」配对把退出键吞成带修饰形（面板 isPlainKey 键面永不匹配
 * ——任何帽都红），应答残段 `[?1;2;4c` 走 text 渲染进屏（CI 失败 dump
 * 实见该字面量）。同基底 dependabot run 35182142621 绿 = 负载时序未撞窗。
 * 修法 = input.ts 迟答防御律（07 §4 件 4 规范先行批——修前红五例在
 * input.test.ts「迟答防御律」节〔含本用例同序 CI 实红形〕+ engine.test.ts
 * 引擎级孤儿形锁）。25s 帽保留作防御余量：引擎修后永久停滞形消灭，帽只
 * 兜真实 CI 慢跃迁（esc 腿含 settle 判定窗回合、仍是最重跃迁）；真回归
 * 在任何帽下都红——不遮蔽。STEP_TIMEOUT_MS 其余消费点实测离帽远
 * （resize 2238ms / exit 2440ms 量级）且无红史，维持 10s 不动。
 * 最坏叠加（startup 45s + 进屏 10s + 收屏 25s = 80.3s）仍在用例级 90s 帽内。
 */
const ESC_DISMISS_TIMEOUT_MS = 25_000;
/** 退出收口轮询帽（优雅退出序含排空/复原——E16 同值 30s） */
const EXIT_TIMEOUT_MS = 30_000;

/** 会话句柄（退出码文件 = 壳层落盘——会话消亡后唯一可读的退出码载体） */
interface TmuxSession {
  readonly name: string;
  readonly dataDir: string;
  readonly wsDir: string;
  readonly exitFile: string;
}

/** 活体会话登记簿（afterEach 逐名兜杀——失败路径不留活会话挂服务端） */
const liveSessions: string[] = [];
afterEach(() => {
  for (const name of liveSessions.splice(0)) {
    tmux(['kill-session', '-t', name]); // 会话亡/服务端亡形失败皆无害
  }
});
afterAll(() => {
  tmux(['kill-server']); // 服务端级兜杀：pane 内 TUI 进程随服务端终结（无孤儿律）
});

/** 测间会话名唯一计数器（pid + 计数后缀防串——立项档①条款） */
let sessionCounter = 0;

/**
 * 起 TUI 真身 tmux 会话：cd 临时工作区 + env 隔离键（数据目录/日志静默/
 * 确定模型标识/TERM 色域档钉定）+ tsx 起 bin 入口；壳层在其退出后把真退出码
 * printf 落临时文件（不用 exec 替换壳——替换后无壳可落码）。
 *
 * env 隔离四键（E16 同族 + 模型确定值）：
 * - BERRY_AGENT_DATA_DIR → 新临时数据目录（防污染真数据 + 单活跃机锁免撞）；
 * - BERRY_AGENT_LOG_LEVEL=silent（日志不入 pane——日志行会污染收屏判据面）；
 * - BERRY_AGENT_MODEL → footer 模型段确定锚（凭证无关——纯字符串标识）；
 * - TERM=xterm-256color + 解除 COLORTERM（色域档裁定确定性——不赌宿主环境）。
 */
function startTuiSession(): TmuxSession {
  const name = `${SOCK}-s${++sessionCounter}`;
  const dataDir = makeTmpDir('tui-tmux-data-');
  const wsDir = makeTmpDir('tui-tmux-ws-');
  const exitFile = join(makeTmpDir('tui-tmux-meta-'), 'exit-code');
  // 壳层编舞：cd 工作区 → 起真身 → 落退出码。$? 即真身退出码（env 命令的
  // 子进程退出码透传——cd 失败形 $? 为 cd 的 1，同样非 0 可判）。
  const command =
    `cd '${wsDir}' && env -u COLORTERM BERRY_AGENT_DATA_DIR='${dataDir}' ` +
    `BERRY_AGENT_LOG_LEVEL=silent BERRY_AGENT_MODEL='${MODEL_ID}' TERM=xterm-256color ` +
    `'${process.execPath}' '${TSX_CLI}' '${MAIN_TS}'; printf %s "$?" > '${exitFile}'`;
  const created = tmux(['new-session', '-d', '-x', String(GEOM_W), '-y', String(GEOM_H), '-s', name, command]);
  if (created.status !== 0) {
    throw new Error(`tmux new-session 失败（status=${created.status}）：${created.stderr ?? ''}`);
  }
  liveSessions.push(name);
  return { name, dataDir, wsDir, exitFile };
}

/** 收屏（capture-pane -p 可见行——会话亡/瞬时不可得形返回空串，调用方按缺席判） */
function capture(session: string): string {
  const cap = tmux(['capture-pane', '-p', '-t', session]);
  return cap.status === 0 ? (cap.stdout ?? '') : '';
}

/** 收屏行集（判据面 = 终端态可见行非字节流） */
function captureLines(session: string): string[] {
  return capture(session).split('\n');
}

/** 通用收屏轮询：判词转真或超时抛错（含现场可见屏尾段——诊断面） */
async function waitForScreen(
  what: string,
  timeoutMs: number,
  session: string,
  pred: (lines: string[]) => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (pred(captureLines(session))) return;
    if (Date.now() > deadline) {
      throw new Error(`等待超时（${what}，${timeoutMs}ms）——当前可见屏尾段：\n${capture(session).slice(-1500)}`);
    }
    await sleep(200);
  }
}

/** 字面键入（-l 形：中文与命令词按 UTF-8 字节直送——零 IME 组字零 tmux 键名解释） */
function sendLiteral(session: string, text: string): void {
  const sent = tmux(['send-keys', '-t', session, '-l', '--', text]);
  expect(sent.status, `send-keys -l 失败：${sent.stderr ?? ''}`).toBe(0);
}

/** 具名键（Enter/Escape/q 等——经 tmux 键编码面 → pty → 我方 InputDecoder） */
function sendKey(session: string, key: string): void {
  const sent = tmux(['send-keys', '-t', session, key]);
  expect(sent.status, `send-keys ${key} 失败：${sent.stderr ?? ''}`).toBe(0);
}

/* ---------------- 判据锚（呈现形单源：锚字符串与实装呈现同文） ---------------- */

/** footer 常驻行锚：cwd 短名（临时工作区目录名前缀）+ ` · ` 分隔 + 模型短名——一行内齐三段 */
function isFooterLine(line: string): boolean {
  return line.includes('tui-tmux-ws-') && line.includes(' · ') && line.includes(MODEL_SHORT);
}

/** 编辑器边框行（顶/底——`┌─…─┐` / `└─…─┘` 整行形；随几何满宽） */
const isBorderTop = (line: string): boolean => /^┌─+┐$/.test(line);
const isBorderBottom = (line: string): boolean => /^└─+┘$/.test(line);

/** 起跑就绪判据：footer 三段在场 + 编辑器边框（顶底）在场 */
function isStartupScreen(lines: string[]): boolean {
  return lines.some(isFooterLine) && lines.some(isBorderTop) && lines.some(isBorderBottom);
}

/** 起跑就绪等待（六面共用的就绪门——就绪后键盘管线已挂接 raw 态） */
async function waitForStartup(session: string): Promise<void> {
  await waitForScreen('TUI 起跑进屏（footer + 编辑器边框）', STARTUP_TIMEOUT_MS, session, isStartupScreen);
  // 输入稳定窗：就绪判据以收屏为准，但 send-keys 与首帧渲染有毫秒级竞窗——
  // 留 300ms 让固定区差分落定（E16 输入稳定窗同律）
  await sleep(300);
}

/** 会话消亡轮询（has-session 非零 = 会话已亡——remain-on-exit 缺省形态） */
async function waitForSessionGone(session: string): Promise<void> {
  const deadline = Date.now() + EXIT_TIMEOUT_MS;
  for (;;) {
    if (tmux(['has-session', '-t', session]).status !== 0) return;
    if (Date.now() > deadline) {
      throw new Error(`会话 ${EXIT_TIMEOUT_MS}ms 未消亡——当前可见屏尾段：\n${capture(session).slice(-1500)}`);
    }
    await sleep(200);
  }
}

/** 壳层退出码落盘轮询 + 读取（会话消亡与文件落盘有毫秒级先后——短帽轮询等文件） */
async function readExitCode(session: TmuxSession): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(session.exitFile)) {
    if (Date.now() > deadline) throw new Error(`退出码文件 5s 未落盘：${session.exitFile}`);
    await sleep(100);
  }
  return readFileSync(session.exitFile, 'utf8');
}

/* ---------------- 验收九面 ---------------- */

describe('TUI 真环境验收（tmux 内层 e2e——07 §4.1 v1 验证面矩阵条款闭环）', () => {
  it.skipIf(!hasUsableTmux())(
    '起跑进屏：footer 三段（cwd · 模型 · 会话短 id）与编辑器边框在场',
    async () => {
      const session = startTuiSession();
      await waitForStartup(session.name);
      // footer 三段已在就绪判据内——此处再钉「会话短 id 段」：footer 行须含
      // 第三段（短 id = 8 位十六进制前缀；行内三段以 ` · ` 分隔）
      const footer = captureLines(session.name).find(isFooterLine);
      expect(footer).toBeDefined();
      // 三段形 = 段间恰两枚 ` · ` 分隔符（cwd · model · shortId）
      expect((footer ?? '').split(' · ').length).toBe(3);
      // 第三段 = 会话短 id（hex 短 id——与 cwd/model 段不同值的 8 位段）
      const third = (footer ?? '').split(' · ')[2] ?? '';
      expect(third).toMatch(/^[0-9a-f]{8}$/);
    },
    90_000,
  );

  it.skipIf(!hasUsableTmux())(
    '中文输入：字面中文 send-keys 后编辑器行回显在场（零模型依赖）',
    async () => {
      const session = startTuiSession();
      await waitForStartup(session.name);
      // 中文整段字面送达（tmux 按 UTF-8 编码直写 pty——我方 text 事件粒度
      // 「同 chunk 连续可打印游程合并」承接，编辑器内整段回显）
      const text = '你好，世界——中文回显锚';
      sendLiteral(session.name, text);
      // 不提交（零模型依赖——纯编辑器回显验收；IME 组字面不在场：字面形无预编辑）
      await waitForScreen('中文回显进屏', STEP_TIMEOUT_MS, session.name, (lines) =>
        lines.some((line) => line.includes(text)),
      );
      // 边框仍在场（回显不改布局——编辑器内容区行在边框内）
      expect(captureLines(session.name).some(isBorderTop)).toBe(true);
    },
    90_000,
  );

  it.skipIf(!hasUsableTmux())(
    '/help 副屏：命令册标题行呈现 → q 收屏回主屏（footer 复在场）',
    async () => {
      const session = startTuiSession();
      await waitForStartup(session.name);
      sendLiteral(session.name, '/help');
      sendKey(session.name, 'Enter');
      // 副屏（1049 备屏）进屏：命令册标题行 + 命令段头行（开屏锚顶——首段在头）
      await waitForScreen(
        '/help 副屏进屏',
        STEP_TIMEOUT_MS,
        session.name,
        (lines) =>
          lines.some((line) => line.includes('命令与键位帮助')) && lines.some((line) => line.includes('── 命令 ──')),
      );
      // q 收屏（副屏退出键面）→ 回主屏：帮助标题行消失 + footer 复在场
      // （主屏 inline 形态——1049l 归位后固定区复显）
      sendKey(session.name, 'q');
      await waitForScreen(
        '/help 收屏回主屏（标题消失 + footer 复在场）',
        STEP_TIMEOUT_MS,
        session.name,
        (lines) => !lines.some((line) => line.includes('命令与键位帮助')) && lines.some(isFooterLine),
      );
    },
    90_000,
  );

  it.skipIf(!hasUsableTmux())(
    '/themes 副屏：主题条目行呈现 + esc 收屏',
    async () => {
      const session = startTuiSession();
      await waitForStartup(session.name);
      sendLiteral(session.name, '/themes');
      sendKey(session.name, 'Enter');
      // 副屏进屏：主题切换标题行 + 内置 auto 档条目行（新临时数据目录无自定义
      // 主题文件——恰内置三档，无 ⚠ 坏文件标注）
      await waitForScreen(
        '/themes 副屏进屏',
        STEP_TIMEOUT_MS,
        session.name,
        (lines) => lines.some((line) => line.includes('主题切换')) && lines.some((line) => line.includes('auto')),
      );
      // esc 收屏（q/esc 两退出键面的 esc 腿——legacy 轨 lone-ESC 判定窗路径）；
      // 帽取 esc 腿专用宽值（CI 慢机饿死窗实证——常量注释处）
      sendKey(session.name, 'Escape');
      await waitForScreen(
        '/themes 收屏回主屏（标题消失 + footer 复在场）',
        ESC_DISMISS_TIMEOUT_MS,
        session.name,
        (lines) => !lines.some((line) => line.includes('主题切换')) && lines.some(isFooterLine),
      );
    },
    90_000,
  );

  it.skipIf(!hasUsableTmux())(
    '/marketplace 选装副屏（mp-5）：本地市场源 CLI 真身入册后头行与条目行呈现 → q 收屏',
    async () => {
      const session = startTuiSession();
      // 本地市场仓 fixture（marketplace-tui-face.test.ts 同构·单条目形）：catalog
      // 市场名 alpha + hello-plugin 本地源声明载荷（berryAgent.skills 在场 =
      // declared-payload——catalog 描述只需可呈现，消毒锁已在单测层锁死）
      const repo = makeTmpDir('tui-tmux-market-');
      mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
      writeFileSync(
        join(repo, '.claude-plugin', 'marketplace.json'),
        JSON.stringify({
          name: 'alpha',
          owner: { name: 'o' },
          plugins: [{ name: 'hello-plugin', source: './plugins/hello', description: '问好插件' }],
        }),
      );
      mkdirSync(join(repo, 'plugins', 'hello'), { recursive: true });
      writeFileSync(
        join(repo, 'plugins', 'hello', 'package.json'),
        `${JSON.stringify({ name: 'hello-plugin', version: '1.0.0', berryAgent: { id: 'hello-plugin', skills: ['greet'] } }, null, 2)}\n`,
      );
      // CLI 真身入册（tsx 起 bin 入口；与会话同一 dataDir + env 隔离键）：local
      // 源零网络；add 只写源册与缓存目录不动主库——与在场 TUI 进程并存安全
      // （这正是「TUI 开着、另一终端 add 源」的生产形态）
      const added = spawnSync(process.execPath, [TSX_CLI, MAIN_TS, 'marketplace', 'add', repo], {
        encoding: 'utf8',
        env: {
          ...process.env,
          BERRY_AGENT_DATA_DIR: session.dataDir,
          BERRY_AGENT_LOG_LEVEL: 'silent',
          BERRY_AGENT_MODEL: MODEL_ID,
        },
      });
      expect(added.status, `marketplace add 失败：${added.stderr ?? ''}`).toBe(0);
      await waitForStartup(session.name);
      sendLiteral(session.name, '/marketplace');
      sendKey(session.name, 'Enter');
      // 副屏进屏判据两锚：头行（◆ 插件市场 · 条目/源计数）+ 首条目行（寻址形
      // name@market——开屏行集快照零网络，缓存即真相；local 源 add 即已落缓存）
      await waitForScreen(
        '/marketplace 副屏进屏',
        STEP_TIMEOUT_MS,
        session.name,
        (lines) =>
          lines.some((line) => line.includes('插件市场 · 1 条目（1 源）')) &&
          lines.some((line) => line.includes('hello-plugin@alpha')),
      );
      // q 收屏回主屏：面板头行消失 + footer 复在场（1049l 归位后固定区复显）
      sendKey(session.name, 'q');
      await waitForScreen(
        '/marketplace 收屏回主屏（头行消失 + footer 复在场）',
        STEP_TIMEOUT_MS,
        session.name,
        (lines) => !lines.some((line) => line.includes('插件市场 ·')) && lines.some(isFooterLine),
      );
    },
    90_000,
  );

  it.skipIf(!hasUsableTmux())(
    '/thinking 副屏（F1）：七档头行与尾档条目呈现 → down+enter 选定 max → 回执 + 收屏回主屏',
    async () => {
      const session = startTuiSession();
      await waitForStartup(session.name);
      sendLiteral(session.name, '/thinking');
      sendKey(session.name, 'Enter');
      // 副屏进屏判据两锚：头行（◆ 思考档位 · 7 档——七档词表单源 THINKING_LEVELS）
      // + 尾档条目行 xhigh（面板独有词——主屏/回执均不含，避免跨屏误锚）
      await waitForScreen(
        '/thinking 副屏进屏',
        STEP_TIMEOUT_MS,
        session.name,
        (lines) =>
          lines.some((line) => line.includes('思考档位 · 7 档')) && lines.some((line) => line.includes('xhigh')),
      );
      // end 一步跳尾档（tmux send-keys End 发 ESC[4~——xterm legacy 双形，已由
      // input-keys.ts TILDE_KEYS `4: 'end'` 收录；本面首跑曾抓该形死键真缺陷，
      // 修位 input-keys.ts + input.test.ts 首尾键双形回归锁）→ enter 选定：
      // 选定先收副屏再回调（件族同序律）——append durable 事件 + setStatus
      // 回执归装配闭包。回执判据 = footer 行右段「思考档位：max（下一 run
      // 起生效…）」（tui-entry selectThinking 回执文案形，StatusLine 分栏右
      // 对齐）；与头行锚「思考档位 · 7 档」用全角冒号/计数段分形，两谓词互不
      // 误匹配。回执落在 max（≠光标零位 off）即证 end 键真被引擎消费——
      // ESC[4~ 解码链在环。
      sendKey(session.name, 'End');
      sendKey(session.name, 'Enter');
      await waitForScreen(
        '/thinking 选定收屏回主屏（头行消失 + footer 行回执在场）',
        STEP_TIMEOUT_MS,
        session.name,
        (lines) =>
          !lines.some((line) => line.includes('思考档位 · 7 档')) &&
          lines.some((line) => line.includes('思考档位：max（下一 run 起生效')),
      );
    },
    90_000,
  );

  it.skipIf(!hasUsableTmux())(
    '/sandbox 副屏（F2 同构）：三档头行与 danger 档条目呈现 → down+enter 选定 danger → 回执 + 收屏回主屏',
    async () => {
      const session = startTuiSession();
      await waitForStartup(session.name);
      sendLiteral(session.name, '/sandbox');
      sendKey(session.name, 'Enter');
      // 副屏进屏判据两锚：头行（◆ 沙箱档位 · 3 档——三档词表单源 SANDBOX_MODES）
      // + danger 档条目行（面板独有词——警示语行右段另锚，此处只锚档名）
      await waitForScreen(
        '/sandbox 副屏进屏',
        STEP_TIMEOUT_MS,
        session.name,
        (lines) =>
          lines.some((line) => line.includes('沙箱档位 · 3 档')) && lines.some((line) => line.includes('danger')),
      );
      // end 一步跳尾档 danger → enter 选定（即刻生效语义——回执文案与 thinking
      // 「下一 run 起生效」分拆两形的 F2 形）；选档只 append 会话事件 +
      // setStatus 回执，无工具调用触发——临时会话零副作用。ESC[4~ 解码链
      // 同 /thinking 面（end 死键缺陷已修，end 键消费在环）
      sendKey(session.name, 'End');
      sendKey(session.name, 'Enter');
      await waitForScreen(
        '/sandbox 选定收屏回主屏（头行消失 + footer 行回执在场）',
        STEP_TIMEOUT_MS,
        session.name,
        (lines) =>
          !lines.some((line) => line.includes('沙箱档位 · 3 档')) &&
          lines.some((line) => line.includes('沙箱档位：danger（即刻生效')),
      );
    },
    90_000,
  );

  it.skipIf(!hasUsableTmux())(
    'resize：resize-window 100→120 后 repaint 完整（footer/编辑器仍在场无残行）',
    async () => {
      const session = startTuiSession();
      await waitForStartup(session.name);
      // resize 编舞：窗口几何 100→120（SIGWINCH 链——pane tty 尺寸变更 →
      // ProcessTerminalIO resize 订阅 → 弃旧换新清屏全量重绘兜底）
      const resized = tmux(['resize-window', '-t', session.name, '-x', '120', '-y', String(GEOM_H)]);
      expect(resized.status, `resize-window 失败：${resized.stderr ?? ''}`).toBe(0);
      // repaint 完整判据①：编辑器边框行满宽随几何更新（100 宽旧边框 → 120 宽
      // 新边框——若 repaint 缺席则旧宽边框残留，本判据超时红）
      await waitForScreen('resize 后重绘（120 宽边框 + footer）', STEP_TIMEOUT_MS, session.name, (lines) => {
        const top = lines.find(isBorderTop);
        return top !== undefined && top.length === 120 && lines.some(isFooterLine);
      });
      // repaint 完整判据②：无残行——固定区边框行各恰一枚（顶/底），旧几何
      // 残留会现出第二枚边框行；footer 行恰一枚
      const lines = captureLines(session.name);
      expect(lines.filter(isBorderTop).length).toBe(1);
      expect(lines.filter(isBorderBottom).length).toBe(1);
      expect(lines.filter(isFooterLine).length).toBe(1);
    },
    90_000,
  );

  it.skipIf(!hasUsableTmux())(
    '/exit：干净退出（会话消亡 + 壳层落盘退出码 0）',
    async () => {
      const session = startTuiSession();
      await waitForStartup(session.name);
      // 退出词本地拦截（恰零参命中 /exit → 与 Ctrl+D 空框同一优雅退出路——
      // 07 §4.1 /exit 批；经真 InputDecoder 进编辑器再提交，非通道命令分发）
      sendLiteral(session.name, '/exit');
      sendKey(session.name, 'Enter');
      // 干净退出双判据：会话消亡（pane 进程退出→会话终结）+ 真退出码 0
      // （壳层 printf 落盘——优雅退出序走完非 kill 形）
      await waitForSessionGone(session.name);
      expect(await readExitCode(session)).toBe('0');
    },
    90_000,
  );
});
