/**
 * host/cli — CLI 解析面契约与手写 argv 解析器（07 篇 §5 命令族定名）。
 *
 * 契约先行笔（批 12a）：解析是纯函数（argv → 命令形 tagged union），分派与
 * 进程退出编舞归后续实装笔。**手写解析不引 commander**（07 §5 极简姿态——
 * 命令族小，解析器自有 ~50 行精神）。执法律五条全执法：
 * ① 未识别 `--` 词全入口用法错退 2（防旗标语义静默并进消息正文送模型）；
 * ② 裸 `--` 终结符之后的 argv 全字面（正当以 `--` 起头的消息内容保真送达）；
 * ③ 取值旗标空串占位或值域外即退 2；
 * ④ `--help`/`--version` 出现在子命令位之后不再落位置参数——解析层记录首个
 *    越位词、返回 help/version 命令形由分派层统一短路（退 0）；执法位在
 *    未识别旗标闸**之后**（本笔裁量：解析错误〔未识别/值域/互斥/位置参数〕
 *    一律先于 help/version 短路——拼错旗标时错误信息比帮助更有用）；
 * ⑤ 旗标互斥组违例退 2（组员以旗标注记为准）。
 *
 * 裁量注记（规范未明文、本笔钉位）：取值旗标的值以 `--` 起头视为占位缺失
 * （防 `--output-last-message --foo` 把旗标当文件名静默收下）；run 位置参数
 * 恰一个（多余位置参数不 join——静默拼接是另一种「语义并进正文」）；无参
 * TUI 入口不收位置参数；`--port` 值域 = 正整数 ≤ 65535（端口物理域）。
 */
/* ---------------- 命令形（tagged union——分派层的消费契约） ---------------- */

/** 全局收的三旗标（--port/--no-plugins 按入口分见各命令 flags；--debug 全入口收） */
export interface TuiFlags {
  /** core:webui 一次性开面（TUI 入口收） */
  readonly port?: number;
  /** 安全模式：core: 与用户插件装载全跳过（boot 拒启自救位） */
  readonly noPlugins: boolean;
  /** 日志提级 */
  readonly debug: boolean;
}

/** run 旗标族（07 §5「run 旗标族扩展」全量——批 13 SDK 通道消费） */
export interface RunFlags {
  readonly port?: number;
  readonly noPlugins: boolean;
  readonly debug: boolean;
  /** --read-only：sandboxMode read-only 单发 */
  readonly readOnly: boolean;
  /** --tick：系统 cron 到点触发载体 */
  readonly tick: boolean;
  /** --background：后台道预算记账入口 */
  readonly background: boolean;
  /** --output-format：流式三档（text 缺省） */
  readonly outputFormat?: 'text' | 'json' | 'stream';
  /** --no-delta：线面退订 message_update 增量（run/serve 共收） */
  readonly noDelta: boolean;
  /** --output-last-message：末条 assistant 文本原子写文件 */
  readonly outputLastMessage?: string;
  /** --ephemeral：零落盘单发（与续接族/--tick/--background 互斥） */
  readonly ephemeral: boolean;
  /** --max-turns：turn 数帽（到帽收场如实标 truncated） */
  readonly maxTurns?: number;
  /** --session <id>：按 id 续接（与 --continue/--fork 互斥） */
  readonly session?: string;
  /** --continue：取当前 cwd 最新会话续接（与 --session/--fork 互斥） */
  readonly continueLatest: boolean;
  /** --fork [<id>]：边界快照分叉（不带值取 cwd 最新；与 --session/--continue 互斥） */
  readonly fork?: { readonly id?: string };
}

/** serve 旗标（--no-plugins 不透传——自动化入口；--no-delta run/serve 共收） */
export interface ServeFlags {
  readonly port?: number;
  readonly debug: boolean;
  /** 脱离控制终端后台守护（必开 HTTP 面——core:sdk 件承载） */
  readonly daemon: boolean;
  readonly noDelta: boolean;
  /** daemon 形 sdk HTTP 面 TCP 侧可选端口（缺省不开——Unix sock 即缺省接入点） */
  readonly sdkPort?: number;
  /** daemon 形 sdk HTTP 面 TCP 侧可选绑定地址（非回环值必配 BERRY_AGENT_SDK_TOKEN） */
  readonly sdkHost?: string;
}

/** dump-config 旗标（--port 收下不起监听——:memory: 同构纪律在装配层） */
export interface DumpConfigFlags {
  readonly port?: number;
  readonly noPlugins: boolean;
  readonly debug: boolean;
}

/** plugins 子命令族（03 §5.8 三面同源动词族；参数面最小钉位——config 传面随装载器批） */
export type PluginsCommand =
  | { readonly sub: 'list' }
  | { readonly sub: 'install'; readonly source: 'npm' | 'git' | 'local'; readonly ref: string }
  | {
      readonly sub: 'uninstall';
      readonly id: string;
      readonly confirm: boolean;
      readonly dataAction?: 'keep' | 'purge';
    }
  | { readonly sub: 'mount'; readonly id: string }
  | { readonly sub: 'unmount'; readonly id: string }
  | { readonly sub: 'toggle'; readonly id: string }
  | { readonly sub: 'update'; readonly id: string }
  | { readonly sub: 'check' };

/** sessions 子命令族（07 §5——CLI 对等律射界：列表/续接/分叉/检索/重建） */
export type SessionsCommand =
  | { readonly sub: 'list' }
  | { readonly sub: 'resume'; readonly id: string }
  | { readonly sub: 'fork'; readonly id: string }
  | { readonly sub: 'search'; readonly query: string }
  | { readonly sub: 'reindex' };

/** 命令 tagged union（07 §5 命令族全量） */
export type CliCommand =
  | { readonly kind: 'tui'; readonly flags: TuiFlags }
  | { readonly kind: 'run'; readonly message: string; readonly flags: RunFlags }
  | { readonly kind: 'serve'; readonly flags: ServeFlags }
  | { readonly kind: 'serve-status' }
  | { readonly kind: 'serve-stop' }
  | { readonly kind: 'mcp' }
  | { readonly kind: 'dump-config'; readonly flags: DumpConfigFlags }
  | { readonly kind: 'plugins'; readonly sub: PluginsCommand }
  | { readonly kind: 'sessions'; readonly sub: SessionsCommand }
  | { readonly kind: 'upgrade' }
  /** --help 短路（overreach = 首个越位词原文——分派层打帮助退 0） */
  | { readonly kind: 'help'; readonly overreach?: string }
  /** --version 短路（同上） */
  | { readonly kind: 'version'; readonly overreach?: string };

/** 解析结果：用法错统一 exitCode 2（07 §5 退出码三态契约之「用法错」档） */
export type CliParseResult =
  | { readonly ok: true; readonly command: CliCommand }
  | { readonly ok: false; readonly exitCode: 2; readonly message: string };

/* ---------------- 低层旗标扫描件 ---------------- */

/** 旗标规格（表驱动） */
interface FlagSchema {
  readonly name: string;
  readonly kind: 'boolean' | 'value' | 'optional-value';
  /** 值域枚举（值域外退 2——执法律③） */
  readonly values?: readonly string[];
  /** 正整数域（1 起；上界由 upTo 给） */
  readonly positiveInt?: { readonly upTo: number };
}

/** 一次扫描的产物 */
interface ScanOutcome {
  readonly booleans: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, string>;
  readonly literals: readonly string[];
  readonly overreach?: string;
  readonly error?: string;
}

/**
 * 扫描一段 argv：旗标消费 + 裸 `--` 终结符 + 位置参数收集 + help/version 越位记录。
 *
 * - 未识别 `--` 词 → error（执法①）；
 * - 取值旗标值缺席 / 空串 / 以 `--` 起头（占位缺失裁量）/ 值域外 / 非正整数 → error（执法③）；
 * - optional-value 仅当下一词存在且不以 `--` 起头时消费（--fork 形专用）。
 */
function scanFlags(argv: readonly string[], schemas: readonly FlagSchema[]): ScanOutcome {
  const booleans = new Set<string>();
  const values = new Map<string, string>();
  const literals: string[] = [];
  let overreach: string | undefined;
  const byName = new Map(schemas.map((s) => [s.name, s]));
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i] as string;
    if (tok === '--') {
      // 裸终结符：余下全字面（执法②——正当以 -- 起头的消息内容保真送达）
      literals.push(...argv.slice(i + 1));
      break;
    }
    if (tok.startsWith('--')) {
      const name = tok.slice(2);
      if (name === 'help' || name === 'version') {
        overreach ??= tok; // 记录首个越位词（执法④）
        continue;
      }
      const schema = byName.get(name);
      if (!schema) {
        return { booleans, values, literals, overreach, error: `未识别旗标 --${name}（全部旗标见 --help）` };
      }
      if (schema.kind === 'boolean') {
        booleans.add(name);
        continue;
      }
      if (schema.kind === 'optional-value') {
        // 可选值形（--fork 专用）：下一词存在且不以 `--` 起头才消费为值；否则记空串哨兵 = 在场无值
        const next = argv[i + 1];
        if (next !== undefined && next !== '' && !next.startsWith('--')) {
          values.set(name, next);
          i++;
        } else {
          values.set(name, '');
        }
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next === '' || next.startsWith('--')) {
        return { booleans, values, literals, overreach, error: `--${name} 须带值（空串占位或缺失即用法错）` };
      }
      if (schema.values && !schema.values.includes(next)) {
        return {
          booleans,
          values,
          literals,
          overreach,
          error: `--${name} 值域外：${next}（合法值：${schema.values.join('|')}）`,
        };
      }
      if (schema.positiveInt) {
        const n = Number(next);
        if (!Number.isInteger(n) || n < 1 || n > schema.positiveInt.upTo) {
          return {
            booleans,
            values,
            literals,
            overreach,
            error: `--${name} 须为 1–${schema.positiveInt.upTo} 的整数（收到：${next}）`,
          };
        }
      }
      values.set(name, next);
      i++;
      continue;
    }
    literals.push(tok);
  }
  return { booleans, values, literals, overreach };
}

/** 用法错速记（fail 形单独成型——供 expectArity 联合收窄） */
type UsageFail = { readonly ok: false; readonly exitCode: 2; readonly message: string };

function usageFail(message: string): UsageFail {
  return { ok: false, exitCode: 2, message };
}

/** 位置参数计数执法（不足/超出即退 2——usage 形描述期望） */
function expectArity(literals: readonly string[], min: number, max: number, usage: string): string[] | UsageFail {
  if (literals.length < min || literals.length > max) {
    return usageFail(
      `位置参数数目不符（期望 ${min === max ? `恰 ${min}` : `${min}–${max}`}，收到 ${literals.length}）——用法：${usage}`,
    );
  }
  return literals as string[];
}

/* ---------------- 各入口旗标表（07 §5 旗标块收面逐条钉位） ---------------- */

/** 通用三旗标（--port/--no-plugins/--debug）——按入口拼装（自动化入口不透传 --no-plugins） */
const PORT_FLAG: FlagSchema = { name: 'port', kind: 'value', positiveInt: { upTo: 65535 } };
const NO_PLUGINS_FLAG: FlagSchema = { name: 'no-plugins', kind: 'boolean' };
const DEBUG_FLAG: FlagSchema = { name: 'debug', kind: 'boolean' };

const TUI_SCHEMAS: readonly FlagSchema[] = [PORT_FLAG, NO_PLUGINS_FLAG, DEBUG_FLAG];

const RUN_SCHEMAS: readonly FlagSchema[] = [
  PORT_FLAG,
  NO_PLUGINS_FLAG,
  DEBUG_FLAG,
  { name: 'read-only', kind: 'boolean' },
  { name: 'tick', kind: 'boolean' },
  { name: 'background', kind: 'boolean' },
  { name: 'output-format', kind: 'value', values: ['text', 'json', 'stream'] },
  { name: 'no-delta', kind: 'boolean' },
  { name: 'output-last-message', kind: 'value' },
  { name: 'ephemeral', kind: 'boolean' },
  { name: 'max-turns', kind: 'value', positiveInt: { upTo: 1000 } },
  { name: 'session', kind: 'value' },
  { name: 'continue', kind: 'boolean' },
  { name: 'fork', kind: 'optional-value' },
  // --output-schema 未实现：显式传入即用法错退 2 不静默忽略（07 §5——实现随批 13 落地翻转）
  { name: 'output-schema', kind: 'boolean' },
];

const SERVE_SCHEMAS: readonly FlagSchema[] = [
  PORT_FLAG,
  DEBUG_FLAG,
  { name: 'daemon', kind: 'boolean' },
  { name: 'no-delta', kind: 'boolean' },
  // daemon 形专属（07 §5 落码定名批）：TCP 侧可选两旗标——前台 stdio 形无
  // HTTP 面，传入即用法错（parseServe 互斥执法——防「收下不起」静默吞）
  { name: 'sdk-port', kind: 'value', positiveInt: { upTo: 65535 } },
  { name: 'sdk-host', kind: 'value' },
];

const DUMP_SCHEMAS: readonly FlagSchema[] = [PORT_FLAG, NO_PLUGINS_FLAG, DEBUG_FLAG];

const UNINSTALL_SCHEMAS: readonly FlagSchema[] = [
  { name: 'confirm', kind: 'boolean' },
  { name: 'data', kind: 'value', values: ['keep', 'purge'] },
];

/* ---------------- 命令解析器 ---------------- */

/** 解析 run 命令段（子命令位已消费） */
function parseRun(rest: readonly string[]): CliParseResult {
  const scan = scanFlags(rest, RUN_SCHEMAS);
  if (scan.error) return usageFail(scan.error);
  // --output-schema 显式传入即退 2（未实现——不静默忽略）
  if (scan.booleans.has('output-schema')) {
    return usageFail('--output-schema 尚未实现——显式传入即用法错（不静默忽略；实现随 SDK 通道批落地后翻转本闸）');
  }
  const msg = expectArity(scan.literals, 1, 1, 'berry-agent run "<message>"');
  if ('exitCode' in msg) return msg;
  const has = (b: string) => scan.booleans.has(b);
  // 互斥组执法（执法⑤）：--ephemeral × 续接族 + --tick/--background（续接族里 --session/--fork 是取值旗标——判在场看 values）
  if (has('ephemeral')) {
    const clash =
      scan.values.has('session') || has('continue') || scan.values.has('fork') || has('tick') || has('background');
    if (clash) {
      return usageFail(
        '--ephemeral 与 --session/--continue/--fork/--tick/--background 互斥（零落盘会话不进续接/定时/后台复用）',
      );
    }
  }
  // 续接族三者互斥
  const resumePicks =
    (scan.values.has('session') ? 1 : 0) + (has('continue') ? 1 : 0) + (scan.values.has('fork') ? 1 : 0);
  if (resumePicks > 1) {
    return usageFail('--session / --continue / --fork 三者互斥（续接显式 opt-in 单选）');
  }
  const port = scan.values.get('port');
  const maxTurns = scan.values.get('max-turns');
  const flags: RunFlags = {
    port: port === undefined ? undefined : Number(port),
    noPlugins: has('no-plugins'),
    debug: has('debug'),
    readOnly: has('read-only'),
    tick: has('tick'),
    background: has('background'),
    outputFormat: scan.values.get('output-format') as RunFlags['outputFormat'],
    noDelta: has('no-delta'),
    outputLastMessage: scan.values.get('output-last-message'),
    ephemeral: has('ephemeral'),
    maxTurns: maxTurns === undefined ? undefined : Number(maxTurns),
    session: scan.values.get('session'),
    continueLatest: has('continue'),
    fork: scan.values.has('fork') ? { id: scan.values.get('fork') || undefined } : undefined,
  };
  const command: CliCommand = { kind: 'run', message: msg[0] as string, flags };
  return finish(scan, command);
}

/** 解析 serve 命令段（serve status/serve stop 已在首层分派——此处仅 serve 本体） */
function parseServe(rest: readonly string[]): CliParseResult {
  const scan = scanFlags(rest, SERVE_SCHEMAS);
  if (scan.error) return usageFail(scan.error);
  const arity = expectArity(
    scan.literals,
    0,
    0,
    'berry-agent serve [--daemon] [--port <n>] [--sdk-port <n>] [--sdk-host <host>]',
  );
  if ('exitCode' in arity) return arity;
  // daemon 形专属旗标互斥执法（执法⑤同族）：--sdk-port/--sdk-host 是 daemon 形
  // sdk HTTP 面 TCP 侧可选（07 §5 落码定名批）——前台 stdio 形传入即用法错
  if (!scan.booleans.has('daemon') && (scan.values.has('sdk-port') || scan.values.has('sdk-host'))) {
    return usageFail('--sdk-port/--sdk-host 为 --daemon 形态专属（前台 stdio 形无 HTTP 面）');
  }
  const port = scan.values.get('port');
  const sdkPort = scan.values.get('sdk-port');
  const command: CliCommand = {
    kind: 'serve',
    flags: {
      port: port === undefined ? undefined : Number(port),
      debug: scan.booleans.has('debug'),
      daemon: scan.booleans.has('daemon'),
      noDelta: scan.booleans.has('no-delta'),
      sdkPort: sdkPort === undefined ? undefined : Number(sdkPort),
      sdkHost: scan.values.get('sdk-host'),
    },
  };
  return finish(scan, command);
}

/** 解析 plugins 子命令段 */
function parsePlugins(rest: readonly string[]): CliParseResult {
  const [head, ...tail] = rest as string[];
  if (head === undefined || head.startsWith('--')) {
    return usageFail('plugins 须带子命令（list/install/uninstall/mount/unmount/toggle/update/check）');
  }
  switch (head) {
    case 'list':
    case 'check': {
      const scan = scanFlags(tail, []);
      if (scan.error) return usageFail(scan.error);
      const arity = expectArity(scan.literals, 0, 0, `berry-agent plugins ${head}`);
      if ('exitCode' in arity) return arity;
      return finish(scan, { kind: 'plugins', sub: { sub: head } });
    }
    case 'install': {
      const scan = scanFlags(tail, []);
      if (scan.error) return usageFail(scan.error);
      const args = expectArity(scan.literals, 2, 2, 'berry-agent plugins install <npm|git|local> <ref>');
      if ('exitCode' in args) return args;
      const source = args[0] as string;
      if (source !== 'npm' && source !== 'git' && source !== 'local') {
        return usageFail(`install 源值域外：${source}（合法值：npm|git|local）`);
      }
      return finish(scan, { kind: 'plugins', sub: { sub: 'install', source, ref: args[1] as string } });
    }
    case 'uninstall': {
      const scan = scanFlags(tail, UNINSTALL_SCHEMAS);
      if (scan.error) return usageFail(scan.error);
      const args = expectArity(
        scan.literals,
        1,
        1,
        'berry-agent plugins uninstall <id> [--confirm] [--data keep|purge]',
      );
      if ('exitCode' in args) return args;
      const dataRaw = scan.values.get('data');
      return finish(scan, {
        kind: 'plugins',
        sub: {
          sub: 'uninstall',
          id: args[0] as string,
          confirm: scan.booleans.has('confirm'),
          dataAction: dataRaw === undefined ? undefined : (dataRaw as 'keep' | 'purge'),
        },
      });
    }
    case 'mount':
    case 'unmount':
    case 'toggle':
    case 'update': {
      const scan = scanFlags(tail, []);
      if (scan.error) return usageFail(scan.error);
      const args = expectArity(scan.literals, 1, 1, `berry-agent plugins ${head} <id>`);
      if ('exitCode' in args) return args;
      return finish(scan, { kind: 'plugins', sub: { sub: head, id: args[0] as string } });
    }
    default:
      return usageFail(
        `未知 plugins 子命令：${head}（合法：list/install/uninstall/mount/unmount/toggle/update/check）`,
      );
  }
}

/** 解析 sessions 子命令段 */
function parseSessions(rest: readonly string[]): CliParseResult {
  const [head, ...tail] = rest as string[];
  if (head === undefined || head.startsWith('--')) {
    return usageFail('sessions 须带子命令（list/resume/fork/search/reindex）');
  }
  const zeroArg = head === 'list' || head === 'reindex';
  const oneArg = head === 'resume' || head === 'fork' || head === 'search';
  if (!zeroArg && !oneArg) {
    return usageFail(`未知 sessions 子命令：${head}（合法：list/resume/fork/search/reindex）`);
  }
  const scan = scanFlags(tail, []);
  if (scan.error) return usageFail(scan.error);
  const usage = zeroArg
    ? `berry-agent sessions ${head}`
    : `berry-agent sessions ${head} <${head === 'search' ? 'query' : 'id'}>`;
  const args = expectArity(scan.literals, zeroArg ? 0 : 1, zeroArg ? 0 : 1, usage);
  if ('exitCode' in args) return args;
  if (zeroArg) return finish(scan, { kind: 'sessions', sub: { sub: head as 'list' | 'reindex' } });
  return finish(scan, {
    kind: 'sessions',
    sub:
      head === 'search'
        ? { sub: 'search', query: args[0] as string }
        : { sub: head as 'resume' | 'fork', id: args[0] as string },
  });
}

/** 收尾统一口：help/version 越位短路（执法④——在一切解析错误之后） */
function finish(scan: ScanOutcome, command: CliCommand): CliParseResult {
  if (scan.overreach === '--help') return { ok: true, command: { kind: 'help', overreach: scan.overreach } };
  if (scan.overreach === '--version') return { ok: true, command: { kind: 'version', overreach: scan.overreach } };
  return { ok: true, command };
}

/* ---------------- 主入口 ---------------- */

/**
 * 解析进程 argv（不含 argv[0]/argv[1]——调用方传 process.argv.slice(2)）。
 *
 * 分派序：首词 ∈ 子命令集 → 各命令解析器；首词以 `--` 起头或空 → TUI 入口
 * （位置参数非空即退 2——无参 TUI 不收位置参数）；其余非旗标首词 → 未知子命令
 * 退 2。
 */
export function parseCli(argv: readonly string[]): CliParseResult {
  const [head, ...rest] = argv as string[];
  if (head === undefined || head.startsWith('--')) {
    const leading: string[] = head === undefined ? [] : [head];
    const scan = scanFlags([...leading, ...rest], TUI_SCHEMAS);
    if (scan.error) return usageFail(scan.error);
    const arity = expectArity(scan.literals, 0, 0, 'berry-agent（无参 = TUI 主入口；脚本化用 run/serve）');
    if ('exitCode' in arity) return arity;
    const port = scan.values.get('port');
    const command: CliCommand = {
      kind: 'tui',
      flags: {
        port: port === undefined ? undefined : Number(port),
        noPlugins: scan.booleans.has('no-plugins'),
        debug: scan.booleans.has('debug'),
      },
    };
    return finish(scan, command);
  }
  switch (head) {
    case 'run':
      return parseRun(rest);
    case 'serve': {
      // serve status / serve stop 管理动词（零旗标面——单活跃机只读豁免）
      const [sub, ...tail] = rest as string[];
      if (sub === 'status' || sub === 'stop') {
        const scan = scanFlags(tail, []);
        if (scan.error) return usageFail(scan.error);
        const arity = expectArity(scan.literals, 0, 0, `berry-agent serve ${sub}`);
        if ('exitCode' in arity) return arity;
        return finish(scan, { kind: sub === 'status' ? 'serve-status' : 'serve-stop' });
      }
      return parseServe(rest);
    }
    case 'mcp': {
      const scan = scanFlags(rest, []);
      if (scan.error) return usageFail(scan.error);
      const arity = expectArity(scan.literals, 0, 0, 'berry-agent mcp');
      if ('exitCode' in arity) return arity;
      return finish(scan, { kind: 'mcp' });
    }
    case 'dump-config': {
      const scan = scanFlags(rest, DUMP_SCHEMAS);
      if (scan.error) return usageFail(scan.error);
      const arity = expectArity(scan.literals, 0, 0, 'berry-agent dump-config');
      if ('exitCode' in arity) return arity;
      const port = scan.values.get('port');
      const command: CliCommand = {
        kind: 'dump-config',
        flags: {
          port: port === undefined ? undefined : Number(port),
          noPlugins: scan.booleans.has('no-plugins'),
          debug: scan.booleans.has('debug'),
        },
      };
      return finish(scan, command);
    }
    case 'plugins':
      return parsePlugins(rest);
    case 'sessions':
      return parseSessions(rest);
    case 'upgrade': {
      const scan = scanFlags(rest, [DEBUG_FLAG]);
      if (scan.error) return usageFail(scan.error);
      const arity = expectArity(scan.literals, 0, 0, 'berry-agent upgrade');
      if ('exitCode' in arity) return arity;
      return finish(scan, { kind: 'upgrade' });
    }
    default:
      return usageFail(
        `未知子命令：${head}（合法：run/serve/mcp/dump-config/plugins/sessions/upgrade；无参 = TUI 主入口）`,
      );
  }
}
