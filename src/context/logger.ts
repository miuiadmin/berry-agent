/**
 * 自写轻量 logger（07 §6 日志级别策略——约百行，不引入日志库）。
 *
 * 细则逐条：
 *  - 级别四档 error/warn/info/debug + silent 全静默；缺省 info（发布物即生产）；
 *  - 结构化 JSON 行（time/level/module/msg + 上下文字段）写 stderr；
 *  - 模块前缀分级：BERRY_AGENT_LOG_LEVEL 逗号分隔 per-module 条目
 *    （`info,session:debug`）；条目按 lastIndexOf(':') 切分（模块名含冒号可表达
 *    ——`core:memory` 里的冒号不是分隔符）；前缀匹配（`session` 命中 `session`
 *    与 `session:*` 全体）；
 *  - 共享阈值盒：同盒树的 logger 持同一盒引用，setLevel 改盒值全树即时生效；
 *    child logger 不入登记表（防慢性泄漏）；
 *  - 无效条目 stderr 警告后跳过（视同未设——静默失效比无反馈更糟）；
 *  - 纪律红线（消费方义务）：只在 debug 出现的分支，其行为必须同时是 durable
 *    事件或运行时断言——进程日志职责收窄为「启动/崩溃/守门/恢复」诊断。
 */

/** 级别权重（数值越大越啰嗦——debug 3 最详；silent 独立档不入权重表） */
const LEVEL_WEIGHTS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
export type LogLevel = keyof typeof LEVEL_WEIGHTS | 'silent';

/** 日志输出面（缺省 process.stderr；测试注入内存 sink） */
export type LogSink = (line: string) => void;

/**
 * 阈值盒（共享状态）：全局级 + per-module 前缀覆盖表。
 * createLogger 树全体持同一盒引用——setGlobalLevel/setModuleLevel 改盒即全树
 * 即时生效；盒本身即解析态，logger 对象不入任何登记表。
 */
export class LogLevelState {
  /** 全局阈值（缺省 info——发布物即生产） */
  private global: LogLevel = 'info';
  /** per-module 前缀覆盖（前缀 → 级别；匹配取最长前缀） */
  private readonly modules = new Map<string, LogLevel>();

  /** 从 env 串建盒（无效条目 stderr 警告后跳过——视同未设） */
  static fromEnv(env: string | undefined, warn: (msg: string) => void = defaultEnvWarn): LogLevelState {
    const state = new LogLevelState();
    if (!env) return state;
    for (const rawEntry of env.split(',')) {
      const entry = rawEntry.trim();
      if (!entry) continue;
      // lastIndexOf(':') 切分：模块名含冒号（core:memory）可表达——
      // 最右一个冒号才是「模块:级别」分隔符
      const sep = entry.lastIndexOf(':');
      const levelText = sep >= 0 ? entry.slice(sep + 1) : entry;
      const moduleText = sep >= 0 ? entry.slice(0, sep) : '';
      const level = parseLevel(levelText);
      if (!level) {
        warn(
          `BERRY_AGENT_LOG_LEVEL 无效条目 "${entry}"（级别 "${levelText}" 不在闭集 error|warn|info|debug|silent）——已跳过`,
        );
        continue;
      }
      if (sep >= 0 && moduleText) state.modules.set(moduleText, level);
      else state.setGlobalLevel(level);
    }
    return state;
  }

  /** 改全局阈值（全树即时生效——运行期提降级面） */
  setGlobalLevel(level: LogLevel): void {
    this.global = level;
  }

  /** 设/覆盖某模块前缀阈值（前缀匹配：`session` 命中 `session` 与 `session:*` 全体） */
  setModuleLevel(prefix: string, level: LogLevel): void {
    this.modules.set(prefix, level);
  }

  /** 解析模块生效级：最长匹配前缀条目 ?? 全局（silent 压倒一切——显式全静默） */
  resolve(module: string): LogLevel {
    if (this.global === 'silent') return 'silent';
    let best: { prefix: string; level: LogLevel } | undefined;
    for (const [prefix, level] of this.modules) {
      // 前缀匹配：模块名等于前缀、或以前缀+':' 开头（域分段符）
      const matches = module === prefix || module.startsWith(`${prefix}:`);
      if (!matches) continue;
      if (!best || prefix.length > best.prefix.length) best = { prefix, level };
    }
    const resolved = best?.level ?? this.global;
    return resolved === 'silent' ? 'silent' : resolved;
  }
}

/** 单条级别字面量解析（大小写不敏感；无效返回 null） */
function parseLevel(text: string): LogLevel | null {
  const lower = text.toLowerCase();
  if (lower === 'silent') return 'silent';
  if (lower in LEVEL_WEIGHTS) return lower as keyof typeof LEVEL_WEIGHTS;
  return null;
}

/** env 无效值警告的缺省面（bootstrapping 阶段 stderr 一行） */
function defaultEnvWarn(msg: string): void {
  process.stderr.write(`[logger] ${msg}\n`);
}

/** logger 实例形态（模块名绑定的四方法输出器——纯值对象，不入登记表） */
export interface Logger {
  readonly module: string;
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * logger → 内部三件（盒/sink/clock）弱关联：childLogger 派生的唯一缝。
 * WeakMap 不阻回收（logger 亡即条目亡——「不入登记表防慢性泄漏」的兑现形态：
 * 强引用登记表不存在，弱关联只为派生期取参）。
 */
const loggerInternals = new WeakMap<Logger, { state: LogLevelState; sink: LogSink; clock: () => number }>();

/**
 * 建模块 logger（child 面共享 state 盒——树内全树同盒即时生效）。
 * @param module 模块名（域分段用 ':'——如 `session`、`core:memory`）
 * @param state 共享阈值盒（缺省独立盒 info——测试/独立小面用；ctx 装配时传同一盒）
 * @param sink 输出面（缺省 process.stderr；测试注入内存）
 * @param clock 时间源（缺省 Date.now——测试可注入定值）
 */
export function createLogger(
  module: string,
  state: LogLevelState = new LogLevelState(),
  sink: LogSink = (line) => process.stderr.write(`${line}\n`),
  clock: () => number = Date.now,
): Logger {
  const write = (level: keyof typeof LEVEL_WEIGHTS, msg: string, fields?: Record<string, unknown>): void => {
    const resolved = state.resolve(module);
    if (resolved === 'silent') return;
    if (LEVEL_WEIGHTS[level] > LEVEL_WEIGHTS[resolved]) return;
    // 结构化 JSON 行：time/level/module/msg + 上下文字段平铺
    sink(JSON.stringify({ time: clock(), level, module, msg, ...fields }));
  };
  const logger: Logger = {
    module,
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
  loggerInternals.set(logger, { state, sink, clock });
  return logger;
}

/**
 * 派生 child logger（`session` → `session:sqlite` 式域细分）：同盒同 sink 同
 * clock——setLevel 改盒全树（含 child）即时生效。仅接受 createLogger 产物。
 */
export function childLogger(parent: Logger, subModule: string): Logger {
  const internals = loggerInternals.get(parent);
  if (!internals) {
    throw new Error('childLogger 仅接受 createLogger 产物（缺内部面——勿手工构造 Logger 对象）');
  }
  return createLogger(`${parent.module}:${subModule}`, internals.state, internals.sink, internals.clock);
}
