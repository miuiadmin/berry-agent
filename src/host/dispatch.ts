/**
 * host/dispatch — CLI 分派面（07 §5 命令族；批 12c）。
 *
 * 消费 parseCli 产物：用法错 → stderr 一行 + 退 2；help/version 统一短路
 * （stdout 帮助/裸 semver + 退 0——解析层记录的首个越位词随行注记）；TUI
 * 入口非 TTY 卫兵（stdin 或 stdout 非 TTY → stderr 指引改用 run/serve +
 * 退 2——07 §5 非 TTY 入口指引条单源）；其余命令交执行器族——缺席即
 * fail-loud 退 1（「命令面已解析、执行面随后续批装配」——错误路径必须及时
 * 非零退出铁律，不静默挂死）。
 *
 * 退出码三态（07 §5）：0 成功 / 1 执行失败（含执行器抛错）/ 2 用法错（含
 * 非 TTY 环境态误用）。裁量注记（规范未明文）：HOST_DATA_DIR_BUSY 等运行
 * 时态失败归 1 执行失败档——「环境态误用退 2」的规范例举只含非 TTY 入口，
 * 运行时条件不扩张解释。
 *
 * 本件纯核心不碰 process（writeOut/writeErr 注入、返回退出码不 exit）——
 * 进程编舞（exit/SIGINT②→130/SIGTERM/crash.log）归 main 装配位。
 */
import type {
  CliParseResult,
  CredentialsSub,
  DumpConfigFlags,
  PluginsCommand,
  RunFlags,
  ServeFlags,
  SessionsCommand,
  TuiFlags,
} from './cli.js';

/** 命令执行器族（缺省缺席 = 尚未装配退 1；12d/12e 与 conversation 装配批逐席充实） */
export interface CommandHandlers {
  /** TUI 主入口（12e 装配：起运行时 + 通道栈 + 会话选取） */
  readonly tui?: (flags: TuiFlags) => Promise<number>;
  /** 单次执行（conversation 装配批：一轮对话 → stdout） */
  readonly run?: (message: string, flags: RunFlags) => Promise<number>;
  /** 常驻宿主（SDK 批：stdio JSONL 线协议） */
  readonly serve?: (flags: ServeFlags) => Promise<number>;
  /** serve 探活报告（0 = 在跑 / 1 = 未跑） */
  readonly serveStatus?: () => Promise<number>;
  /** serve 优雅停（发 SIGTERM → 待退出 → 清登记；未运行幂等退 0） */
  readonly serveStop?: () => Promise<number>;
  /** MCP server 包装形态（core:sdk 件承载） */
  readonly mcp?: () => Promise<number>;
  /** 打印实际生效装配（:memory: 同构——12d 装载器接线后可执行） */
  readonly dumpConfig?: (flags: DumpConfigFlags) => Promise<number>;
  /** 插件生命周期命令族（12d 装载器装配批接线） */
  readonly plugins?: (sub: PluginsCommand) => Promise<number>;
  /** 会话管理命令族（conversation/持久面装配批接线） */
  readonly sessions?: (sub: SessionsCommand) => Promise<number>;
  /** 凭证人面命令族（03 §10.9——c-5 接线：零装配直开库） */
  readonly credentials?: (sub: CredentialsSub) => Promise<number>;
  /** 升级维护动词（§8.5 发布契约批接线） */
  readonly upgrade?: () => Promise<number>;
}

/** 分派环境（TTY 谓词与输出面全注入——main 装配位接 process） */
export interface DispatchEnv {
  /** stdin 是否 TTY（非 TTY 入口卫兵谓词之一——stdin 或 stdout 非 TTY 即卫兵触发） */
  readonly stdinIsTTY: boolean;
  /** stdout 是否 TTY */
  readonly stdoutIsTTY: boolean;
  /** 标准出（help/version/命令产物） */
  readonly writeOut: (text: string) => void;
  /** 标准误（用法错/指引/失败文案） */
  readonly writeErr: (text: string) => void;
  /** 版本串（裸 semver——0.x 期不带代号，07 §5 版本代号条） */
  readonly version: string;
}

/** 帮助文案（07 §5 命令族定名块单源摘编——自包含不外指） */
export const HELP_TEXT = `berry-agent — 单一可扩展的个人 Agent

用法：berry-agent [命令] [旗标]

命令：
  （无参）                TUI 主入口：直进对话
  run "<message>"         单次执行：一轮对话 → stdout 输出结果
  serve                   常驻宿主（stdio JSONL；serve status / serve stop 管理动词）
  mcp                     MCP server 包装形态
  dump-config             打印实际生效装配
  plugins <sub>           插件生命周期（list/install/uninstall/mount/unmount/toggle/update/check）
  sessions <sub>          会话管理（list/resume <id>/fork <id>/search <query>/reindex）
  credentials <sub>       凭证人面管理（add <name> <value>/list/rm <name>；--namespace <ns> 指定域）
  upgrade                 升级维护动词

常用旗标：
  --help / --version / --debug / --port <n> / --no-plugins
  run 限定：--output-format <text|json|stream>  --output-last-message <file>  --ephemeral
            --max-turns <n>  --session <id>  --continue  --fork [id]  --read-only  --tick <名>  --background
  serve 限定：--daemon  --no-delta  --sdk-port <n>  --sdk-host <host>（后两旗标 daemon 形专属）

裸 -- 之后的 argv 全字面；未识别 -- 词一律用法错退 2。`;

/**
 * 分派解析产物到执行器（返回退出码——不 exit）。
 *
 * 分派序：用法错 → help/version 短路 → TUI 非 TTY 卫兵 → 执行器派发
 * （缺席退 1 fail-loud；抛错退 1 + stderr 码与报文——BaseError 呈码身份，
 * 裸 Error 呈 message）。
 */
export async function dispatchCli(
  parsed: CliParseResult,
  handlers: CommandHandlers,
  env: DispatchEnv,
): Promise<number> {
  // 用法错（解析面执法律①③⑤同源）——stderr 一行 + 退 2
  if (!parsed.ok) {
    env.writeErr(parsed.message);
    return 2;
  }
  const { command } = parsed;

  // help/version 统一短路（执法位在未识别旗标闸之后——此处到达的必是干净解析）
  if (command.kind === 'help') {
    if (command.overreach !== undefined) {
      env.writeErr(`注记：${command.overreach} 之后的词不再落位置参数（分派层短路）`);
    }
    env.writeOut(HELP_TEXT);
    return 0;
  }
  if (command.kind === 'version') {
    env.writeOut(env.version);
    return 0;
  }

  // TUI 入口非 TTY 卫兵（07 §5 单源：stdin 或 stdout 非 TTY 即触发）
  if (command.kind === 'tui' && (!env.stdinIsTTY || !env.stdoutIsTTY)) {
    env.writeErr(
      '非交互环境（stdin/stdout 非 TTY）——无参 TUI 主入口不适用于管道/CI；改用 `berry-agent run "<message>"` 单发或 `berry-agent serve` 常驻。',
    );
    return 2;
  }

  // 执行器派发：缺席 = 尚未装配（fail-loud 退 1）；在席 = 交执（抛错退 1）
  const invoke = async (): Promise<number> => {
    switch (command.kind) {
      case 'tui':
        return requireHandler(handlers.tui, 'TUI 主入口')(command.flags);
      case 'run':
        return requireHandler(handlers.run, 'run')(command.message, command.flags);
      case 'serve':
        return requireHandler(handlers.serve, 'serve')(command.flags);
      case 'serve-status':
        return requireHandler(handlers.serveStatus, 'serve status')();
      case 'serve-stop':
        return requireHandler(handlers.serveStop, 'serve stop')();
      case 'mcp':
        return requireHandler(handlers.mcp, 'mcp')();
      case 'dump-config':
        return requireHandler(handlers.dumpConfig, 'dump-config')(command.flags);
      case 'plugins':
        return requireHandler(handlers.plugins, 'plugins')(command.sub);
      case 'sessions':
        return requireHandler(handlers.sessions, 'sessions')(command.sub);
      case 'credentials':
        return requireHandler(handlers.credentials, 'credentials')(command.sub);
      case 'upgrade':
        return requireHandler(handlers.upgrade, 'upgrade')();
    }
  };
  try {
    return await invoke();
  } catch (err) {
    // 执行失败档（退 1）——stderr 码身份 + 报文（调用方可判别）
    const line =
      err instanceof Error
        ? 'code' in err && typeof (err as { code?: unknown }).code === 'string'
          ? `${(err as { code: string }).code}: ${err.message}`
          : err.message
        : String(err);
    env.writeErr(`执行失败（退出码 1）：${line}`);
    return 1;
  }
}

/** 执行器缺席面（统一文案——「命令面已解析、执行面随后续批装配」诚实告知） */
function requireHandler<Fn extends (...args: never[]) => Promise<number>>(handler: Fn | undefined, label: string): Fn {
  if (handler === undefined) {
    throw new Error(`${label} 执行面尚未装配（随后续批次接线）——本命令解析与旗标面已就绪`);
  }
  return handler;
}
