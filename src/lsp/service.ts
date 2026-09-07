/**
 * LSP 服务编排（03 §10.2——惰性 per-(server, rootUri) 实例生命周期承载）。
 *
 * 结构性差异（与 MCP 件 apply 异步发现对照）：工具面**静态四件先注册**——
 * 注册不依赖服务器在线；实例首用才 spawn（diagnostics/symbols/definitions/
 * references 任一调用或诊断注入的预热）。rootUri = 工作区根 realpath 物理
 * 根（v1 单根，懒解析缓存）。
 *
 * 失败语义：连接失败/crash 计熔断一败（实例 onDown 幂等闸保「一次进程事故
 * 恰计一败」）+ ui.notify warn + 下用再试；同 server 3 连败熔断开
 * （LSP_CIRCUIT_OPEN——复位走 /reload 即重 apply，行内他服务器不受累）。
 * 作用域回卷/apply 整值替换的协议化关停**不计熔断**（非服务器故障——
 * deliberate 旗隔离）。
 *
 * 惰性握手窗跨异步边界：握手成后置活接线前查 scope 活，死即协议化关停 +
 * 登记簿对称删行（子进程真退自动出册）+ 不计熔断。
 */
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BaseError } from '../contracts/index.js';
import type { AgentToolResult } from '../contracts/index.js';
import { createLogger } from '../context/index.js';
import type { Logger } from '../context/index.js';
import { connectLspInstance } from './instance.js';
import type { LspInstance, LspDiagnosticItem } from './instance.js';
import { createDiagnosticsInjector } from './inject.js';
import { buildLspToolDefs } from './tools.js';
import { TOOL_POST_EXECUTE_EVENT } from '../contracts/index.js';
import {
  LSP_CIRCUIT_FAILURE_LIMIT,
  LSP_DIAGNOSTICS_MAX_ITEMS,
  LSP_DIAGNOSTICS_SEGMENT_LIMIT_BYTES,
  LSP_DIAGNOSTICS_TIMEOUT_MS_CAP,
  LSP_DIAGNOSTICS_TIMEOUT_MS_DEFAULT,
  LSP_REQUEST_TIMEOUT_SEC_DEFAULT,
  extensionOf,
  routeServer,
  textResult,
} from './types.js';
import type {
  LspConfig,
  LspEventsFace,
  LspFsFace,
  LspRegisterToolsFace,
  LspScopeFace,
  LspServerConfig,
  LspSettings,
  LspSpawnFace,
} from './types.js';

/** 服务构造依赖（全窄面注入——组合根传真身；测试注假件零真进程零盘） */
export interface LspServiceDeps {
  readonly spawn: LspSpawnFace;
  readonly registry: LspRegisterToolsFace;
  readonly scope: LspScopeFace;
  readonly events: LspEventsFace;
  readonly fs: LspFsFace;
  /** 工作区根（懒 realpath——rootUri 物理根单源） */
  readonly rootPath: string;
  /** ui.notify warn 面（crash/熔断/连接失败降级提示；装配接线） */
  readonly notify?: (message: string) => void;
  readonly logger?: Logger;
  readonly closeGraceMs?: number;
}

/** 实例登记项（deliberate = 协议化关停中——onDown 不计熔断） */
interface InstanceEntry {
  deliberate: boolean;
  /** starting = 握手在途；live = 置活（promise resolve 同拍置位——观测面直读） */
  state: 'starting' | 'live';
  promise: Promise<LspInstance>;
}

/** 服务公开面（装配根 + 测试消费） */
export interface LspService {
  /** 应用全行配置（整值替换：旧实例协议化关停 + 熔断复位——/reload 复位执法位） */
  apply(settings: LspSettings): void;
  /** 活实例清单（观测面——server + 状态） */
  liveServers(): Array<{ server: string; state: 'starting' | 'live' }>;
  /**
   * goal gates 诊断查询窄面（GateLspSeam 形——组合根闭包注入消费）：每文件
   * 全文同步后拉诊断；超钟/无路由折 error 级条目（gate fail-closed——诊断
   * 缺席不得伪装全绿）。
   */
  queryDiagnostics(
    files: readonly string[],
  ): Promise<Array<{ file: string; level: 'error' | 'warning' | 'info'; message: string }>>;
  /** 四工具执行面（静态注册的 execute 真身） */
  readonly tools: {
    diagnostics(path: string): Promise<AgentToolResult>;
    symbols(path: string): Promise<AgentToolResult>;
    definitions(path: string, line: number, character: number): Promise<AgentToolResult>;
    references(path: string, line: number, character: number): Promise<AgentToolResult>;
  };
  /** 诊断注入面（tools_post_execute 消费） */
  readonly inject: {
    injectDiagnostics(paths: readonly string[]): Promise<readonly string[]>;
    closeDocuments(paths: readonly string[]): void;
  };
}

/** 组服务（静态四件注册 + 注入器挂线 + scope 回卷登记） */
export function createLspService(deps: LspServiceDeps): LspService {
  const logger = deps.logger ?? createLogger('lsp');
  const instances = new Map<string, InstanceEntry>();
  const failures = new Map<string, number>();
  const circuitOpen = new Set<string>();
  /** 预热注记已落位集合（首触一次性——server 维度） */
  const warmNoted = new Set<string>();
  let config: LspConfig = {};
  let diagTimeoutMs = LSP_DIAGNOSTICS_TIMEOUT_MS_DEFAULT;
  /** 物理根（懒 realpath 缓存——rootUri 单源） */
  let realRoot: string | undefined;
  let realRootPromise: Promise<string> | undefined;
  const toolDisposers: Array<() => void> = [];

  const isAlive = (): boolean => !deps.scope.isDisposed;

  /** 物理根懒解析（缓存 promise——并发首用合一） */
  const ensureRoot = (): Promise<string> => {
    if (realRoot !== undefined) return Promise.resolve(realRoot);
    if (realRootPromise === undefined) {
      realRootPromise = deps.fs.realpath(deps.rootPath).then((p) => {
        realRoot = p;
        return p;
      });
    }
    return realRootPromise;
  };

  /** 路径归一（相对锚物理根；绝对原样） */
  const resolveAbs = async (path: string): Promise<string> => resolvePath(await ensureRoot(), path);

  /** 根内判定（含根本身；根外写入不诊断/不路由） */
  const isInsideRoot = async (abs: string): Promise<boolean> => {
    const root = await ensureRoot();
    return abs === root || abs.startsWith(`${root}/`);
  };

  const notifyWarn = (message: string): void => {
    deps.notify?.(message);
    logger.warn(message);
  };

  /** 计熔断一败（一次进程事故恰计一败——调用面幂等闸已保） */
  const countFailure = (server: string, reason: string): void => {
    const n = (failures.get(server) ?? 0) + 1;
    failures.set(server, n);
    if (n >= LSP_CIRCUIT_FAILURE_LIMIT) {
      if (!circuitOpen.has(server)) {
        circuitOpen.add(server);
        notifyWarn(`LSP 服务器 ${server} 连续 ${n} 败——熔断开（/reload 复位；其余服务器不受累）；最近原因：${reason}`);
        return;
      }
      return; // 已熔断——不重复 notify
    }
    notifyWarn(`LSP 服务器 ${server} 失败（第 ${n}/${LSP_CIRCUIT_FAILURE_LIMIT} 次，下用再试）：${reason}`);
  };

  /** 惰性取实例（熔断拒 + 在途合一 + 失败计账 + scope 活查） */
  const getInstance = (server: string): Promise<LspInstance> => {
    if (circuitOpen.has(server)) {
      return Promise.reject(
        new BaseError('LSP_CIRCUIT_OPEN', `LSP 服务器 ${server} 已熔断（3 连败）——/reload 复位后恢复`),
      );
    }
    const existing = instances.get(server);
    if (existing !== undefined) return existing.promise;
    const cfg = config[server];
    if (cfg === undefined) {
      return Promise.reject(new BaseError('LSP_CONNECT_FAILED', `LSP 服务器 ${server} 不在配置内（apply 后再试）`));
    }
    const entry: InstanceEntry = { deliberate: false, state: 'starting', promise: undefined! };
    entry.promise = (async () => {
      try {
        const rootUri = pathToFileURL(await ensureRoot()).href;
        const inst = await connectLspInstance(server, cfg, rootUri, {
          spawn: deps.spawn,
          logger,
          closeGraceMs: deps.closeGraceMs,
        });
        // 惰性握手窗跨异步边界——置活接线前查 scope 活
        if (!isAlive()) {
          entry.deliberate = true; // 作用域回卷非服务器故障——不计熔断
          void inst.close();
          instances.delete(server);
          throw new BaseError('LSP_CONNECT_FAILED', `作用域已回卷（${server}）——实例协议化关停安静退场`);
        }
        inst.onDown((reason) => {
          if (entry.deliberate) return; // 协议化关停路径不计熔断
          instances.delete(server);
          countFailure(server, `crash：${reason}`);
        });
        entry.state = 'live';
        return inst;
      } catch (err) {
        instances.delete(server);
        if (!entry.deliberate) countFailure(server, errText(err));
        throw err;
      }
    })();
    instances.set(server, entry);
    return entry.promise;
  };

  /** 协议化关停全部实例（apply 整值替换 / scope 回卷共用——不计熔断） */
  const shutdownAll = (): void => {
    for (const [server, entry] of [...instances]) {
      entry.deliberate = true; // 先立旗——close 编舞触发的退出事件不进熔断账
      void entry.promise.then((inst) => inst.close()).catch(() => undefined);
      instances.delete(server);
    }
  };

  /* ---------------- 四工具执行面 ---------------- */

  /** 单请求预算 ms（配置单源） */
  const requestMsOf = (server: string): number =>
    ((config[server] as LspServerConfig | undefined)?.request_timeout_sec ?? LSP_REQUEST_TIMEOUT_SEC_DEFAULT) * 1_000;

  /** 诊断竞速钟（min(配置, 硬帽) 执法位） */
  const diagClock = (): number => Math.min(diagTimeoutMs, LSP_DIAGNOSTICS_TIMEOUT_MS_CAP);

  /** 读盘 + 全文同步（盘真相——触达 URI 即读盘取全文发 didOpen/didChange） */
  const syncFile = async (
    path: string,
  ): Promise<{ inst: LspInstance; uri: string; version: number } | { error: AgentToolResult }> => {
    const abs = await resolveAbs(path);
    const server = routeServer(config, abs);
    if (server === null) {
      return {
        error: errResult(
          `无语言服务器路由（扩展名 .${extensionOf(abs) || '?'} 未配置——core:lsp 行 config servers.languages）`,
        ),
      };
    }
    let inst: LspInstance;
    try {
      inst = await getInstance(server);
    } catch (err) {
      return { error: errResult(errText(err)) };
    }
    let text: string;
    try {
      text = (await deps.fs.readFile(abs)).toString('utf8');
    } catch (err) {
      return { error: errResult(`读盘失败（${abs}）：${errText(err)}`) };
    }
    const uri = pathToFileURL(abs).href;
    const version = inst.syncDocument(uri, text, abs);
    return { inst, uri, version };
  };

  const tools = {
    async diagnostics(path: string): Promise<AgentToolResult> {
      const synced = await syncFile(path);
      if ('error' in synced) return synced.error;
      const items = await synced.inst.waitDiagnostics(synced.uri, synced.version, diagClock());
      if (items === null) {
        // 超钟诚实降级（工具面）：非 isError——数据未及回流是事实回执非工具失败
        return textResult(`诊断未在 ${diagClock()}ms 内回流（服务器忙/不支持推送）——稍后重试或直接读服务器输出`);
      }
      return textResult(
        formatDiagnosticsSegment(synced.uri, items, {
          itemsCap: LSP_DIAGNOSTICS_MAX_ITEMS,
          bytesCap: LSP_DIAGNOSTICS_SEGMENT_LIMIT_BYTES,
        }).text,
      );
    },
    async symbols(path: string): Promise<AgentToolResult> {
      const synced = await syncFile(path);
      if ('error' in synced) return synced.error;
      try {
        const raw = await synced.inst.request(
          'textDocument/documentSymbol',
          { textDocument: { uri: synced.uri } },
          requestMsOf(routeOf(synced.uri)!),
        );
        return textResult(formatSymbols(raw));
      } catch (err) {
        return errResult(`documentSymbol 失败：${errText(err)}`);
      }
    },
    async definitions(path: string, line: number, character: number): Promise<AgentToolResult> {
      const synced = await syncFile(path);
      if ('error' in synced) return synced.error;
      try {
        const raw = await synced.inst.request(
          'textDocument/definition',
          { textDocument: { uri: synced.uri }, position: { line, character } },
          requestMsOf(routeOf(synced.uri)!),
        );
        return textResult(formatLocations(raw, '定义'));
      } catch (err) {
        return errResult(`definition 失败：${errText(err)}`);
      }
    },
    async references(path: string, line: number, character: number): Promise<AgentToolResult> {
      const synced = await syncFile(path);
      if ('error' in synced) return synced.error;
      try {
        const raw = await synced.inst.request(
          'textDocument/references',
          { textDocument: { uri: synced.uri }, position: { line, character }, context: { includeDeclaration: true } },
          requestMsOf(routeOf(synced.uri)!),
        );
        return textResult(formatLocations(raw, '引用'));
      } catch (err) {
        return errResult(`references 失败：${errText(err)}`);
      }
    },
  };

  /** uri → server 名（syncFile 已判路由——此为预算取值便捷面） */
  function routeOf(uri: string): string | null {
    const p = fileURLToPathSafe(uri);
    return p === null ? null : routeServer(config, p);
  }

  /* ---------------- 诊断注入面（tools_post_execute 消费） ---------------- */

  const inject = {
    async injectDiagnostics(paths: readonly string[]): Promise<readonly string[]> {
      const segments: string[] = [];
      let itemBudget = LSP_DIAGNOSTICS_MAX_ITEMS; // 条目上限：单次注入合计
      let bytesBudget = LSP_DIAGNOSTICS_SEGMENT_LIMIT_BYTES; // 总段 ≤4KiB 合计
      for (const path of paths) {
        const abs = await resolveAbs(path);
        if (!(await isInsideRoot(abs))) continue; // 根外写入不诊断
        const server = routeServer(config, abs);
        if (server === null) continue; // 无路由跳过（工具面才响亮——注入面静默增益）
        /** 首触一次性「预热中」注记（server 维度） */
        const noteWarm = (): void => {
          if (warmNoted.has(server)) return;
          warmNoted.add(server);
          segments.push(`[lsp] 语言服务器 ${server} 预热中——本批写入暂不注入诊断（后续写入自动注入）`);
        };
        const entry = instances.get(server);
        if (entry === undefined) {
          // 未活：fire-and-forget 后台预热（失败计数归 getInstance——此处吞）
          void getInstance(server).catch(() => undefined);
          noteWarm();
          continue;
        }
        if (entry.state === 'starting') {
          // 预热在途：跳过注入（不 await 握手——竞速钟预算不留给等待）
          noteWarm();
          continue;
        }
        let inst: LspInstance;
        try {
          inst = await entry.promise; // live——已 resolve 零等待
        } catch {
          continue; // 结算竞速兜底（正常不可达——live 态 promise 已 resolve）
        }
        let text: string;
        try {
          text = (await deps.fs.readFile(abs)).toString('utf8');
        } catch {
          continue; // 读盘失败（写后即删等）——跳过
        }
        const uri = pathToFileURL(abs).href;
        const version = inst.syncDocument(uri, text, abs);
        const items = await inst.waitDiagnostics(uri, version, diagClock());
        if (items === null) {
          // 超钟诚实降级：逐路径点名「未及回流」——不得并成全清宣称
          segments.push(`[lsp] ${path}：诊断未及回流（${diagClock()}ms 竞速钟尽）`);
          continue;
        }
        if (items.length === 0) continue; // 全清零噪音——不注入
        const segment = formatDiagnosticsSegment(uri, items, { itemsCap: itemBudget, bytesCap: bytesBudget });
        if (segment.usedItems === 0) continue; // 预算尽（一条未放）——不再注段
        itemBudget -= segment.usedItems;
        bytesBudget -= Buffer.byteLength(segment.text, 'utf8');
        segments.push(segment.text);
      }
      return segments;
    },
    closeDocuments(paths: readonly string[]): void {
      for (const path of paths) {
        const abs = resolvePathSyncSafe(path);
        if (abs === null) continue;
        const server = routeServer(config, abs);
        if (server === null) continue;
        const entry = instances.get(server);
        if (entry === undefined) continue;
        void entry.promise.then((inst) => inst.closeDocument(pathToFileURL(abs).href)).catch(() => undefined);
      }
    },
  };

  /** resolveAbs 同步形（closeDocuments 同步面——根已缓存时直取） */
  function resolvePathSyncSafe(path: string): string | null {
    if (realRoot === undefined) return null;
    return resolvePath(realRoot, path);
  }

  /* ---------------- 静态注册 + 挂线 + 回卷 ---------------- */

  for (const def of buildLspToolDefs(tools)) {
    toolDisposers.push(deps.registry.register(def));
  }
  const offInjector = deps.events.onWaterfall(
    TOOL_POST_EXECUTE_EVENT,
    createDiagnosticsInjector({ face: inject, warn: (m) => logger.warn(m) }),
  );
  deps.scope.effect(() => () => {
    // 回卷序：摘注入器 → 撤工具 → 协议化关停实例（LIFO 语义）
    offInjector();
    for (const dispose of toolDisposers) dispose();
    shutdownAll();
  });

  return {
    apply(settings: LspSettings): void {
      shutdownAll(); // 旧实例协议化关停（不计熔断）
      failures.clear();
      circuitOpen.clear();
      warmNoted.clear();
      config = settings.servers;
      diagTimeoutMs = settings.diagnostics_timeout_ms ?? LSP_DIAGNOSTICS_TIMEOUT_MS_DEFAULT;
    },
    liveServers(): Array<{ server: string; state: 'starting' | 'live' }> {
      const out: Array<{ server: string; state: 'starting' | 'live' }> = [];
      for (const [server, entry] of instances) {
        out.push({ server, state: entry.state });
      }
      return out;
    },
    async queryDiagnostics(files: readonly string[]) {
      const out: Array<{ file: string; level: 'error' | 'warning' | 'info'; message: string }> = [];
      for (const file of files) {
        const synced = await syncFile(file);
        if ('error' in synced) {
          // 无路由/连接失败/读盘失败：折 error 级条目——gate fail-closed（诊断
          // 缺席不得伪装全绿放行）
          const first = synced.error.content[0];
          out.push({
            file,
            level: 'error',
            message: first !== undefined && first.type === 'text' ? first.text : '诊断不可用',
          });
          continue;
        }
        const items = await synced.inst.waitDiagnostics(synced.uri, synced.version, diagClock());
        if (items === null) {
          out.push({ file, level: 'error', message: `诊断超时未回流（${diagClock()}ms）——fail-closed 不放行` });
          continue;
        }
        for (const item of items) {
          out.push({
            file,
            level: item.severity === 1 ? 'error' : item.severity === 2 ? 'warning' : 'info',
            message: `L${item.line + 1}:${item.character + 1} ${item.message}`,
          });
        }
      }
      return out;
    },
    tools,
    inject,
  };
}

/* ---------------- 格式化助手（工具面与注入面共用） ---------------- */

/** isError 文本结果便捷构造（textResult 单源在 types——本件只做 isError 折叠） */
function errResult(message: string): AgentToolResult {
  return textResult(message, true);
}

/** severity → 标签（1=Error 2=Warning 3=Info 4=Hint——标签即 counts 键域） */
function severityLabel(severity: number): 'error' | 'warning' | 'info' | 'hint' {
  if (severity === 1) return 'error';
  if (severity === 2) return 'warning';
  if (severity === 3) return 'info';
  return 'hint';
}

/**
 * 诊断段格式化（uri 面显示转 path 尾段；条目/字节双预算——预算尽截断注记，
 * 预算尽返空段）。返回段文本与实际消耗条目数（预算扣减用）。
 */
function formatDiagnosticsSegment(
  uri: string,
  items: readonly LspDiagnosticItem[],
  budget: { itemsCap: number; bytesCap: number },
): { text: string; usedItems: number } {
  const label = uri.replace(/^file:\/\//, '');
  const counts = { error: 0, warning: 0, info: 0, hint: 0 };
  for (const item of items) counts[severityLabel(item.severity)] += 1;
  const header = `[lsp 诊断] ${label}：error ×${counts.error}、warning ×${counts.warning}、info ×${counts.info}、hint ×${counts.hint}`;
  const lines: string[] = [header];
  let bytes = Buffer.byteLength(header, 'utf8');
  let used = 0;
  let truncated = false;
  for (const item of items) {
    if (used >= budget.itemsCap) {
      truncated = true;
      break;
    }
    const line = `  [${severityLabel(item.severity)}] L${item.line + 1}:${item.character + 1} ${item.message}${item.source !== undefined ? `（${item.source}）` : ''}`;
    if (bytes + Buffer.byteLength(line, 'utf8') > budget.bytesCap) {
      truncated = true;
      break;
    }
    lines.push(line);
    bytes += Buffer.byteLength(line, 'utf8');
    used += 1;
  }
  if (truncated) lines.push(`  …（条目上限 ${budget.itemsCap}/段字节帽——截断）`);
  return { text: lines.join('\n'), usedItems: used };
}

/** documentSymbol 结果格式化（层级形/平铺形两容） */
function formatSymbols(raw: unknown): string {
  const lines: string[] = [];
  const walk = (entries: readonly unknown[], depth: number): void => {
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue;
      const s = entry as {
        name?: unknown;
        kind?: unknown;
        range?: { start?: { line?: unknown } };
        location?: { range?: { start?: { line?: unknown } } };
        children?: unknown;
      };
      if (typeof s.name !== 'string') continue;
      const line =
        typeof s.range?.start?.line === 'number'
          ? s.range.start.line
          : typeof s.location?.range?.start?.line === 'number'
            ? s.location.range.start.line
            : 0;
      lines.push(
        `${'  '.repeat(depth)}${s.name}（${symbolKindName(typeof s.kind === 'number' ? s.kind : 0)}）L${line + 1}`,
      );
      if (Array.isArray(s.children)) walk(s.children, depth + 1);
    }
  };
  if (Array.isArray(raw)) walk(raw, 0);
  return lines.length > 0 ? lines.join('\n') : '（无符号）';
}

/** SymbolKind 名（1-26；未知返 unknown） */
function symbolKindName(kind: number): string {
  const names = [
    '',
    'File',
    'Module',
    'Namespace',
    'Package',
    'Class',
    'Method',
    'Property',
    'Field',
    'Constructor',
    'Enum',
    'Interface',
    'Function',
    'Variable',
    'Constant',
    'String',
    'Number',
    'Boolean',
    'Array',
    'Object',
    'Key',
    'Null',
    'EnumMember',
    'Struct',
    'Event',
    'Operator',
    'TypeParameter',
  ];
  return names[kind] ?? 'unknown';
}

/** definition/references 位置清单格式化（Location/LocationLink 两容） */
function formatLocations(raw: unknown, label: string): string {
  const list = Array.isArray(raw) ? raw : [raw];
  const lines: string[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const l = entry as {
      uri?: unknown;
      targetUri?: unknown;
      range?: { start?: { line?: unknown; character?: unknown } };
      targetRange?: { start?: { line?: unknown; character?: unknown } };
    };
    const uri = typeof l.uri === 'string' ? l.uri : typeof l.targetUri === 'string' ? l.targetUri : undefined;
    if (uri === undefined) continue;
    const start = l.range?.start ?? l.targetRange?.start;
    const line = typeof start?.line === 'number' ? start.line : 0;
    const ch = typeof start?.character === 'number' ? start.character : 0;
    lines.push(`${uri.replace(/^file:\/\//, '')}：${line + 1}:${ch + 1}`);
  }
  return lines.length > 0 ? `${label} ${lines.length} 处：\n${lines.join('\n')}` : `（无${label}）`;
}

/** file:// → path（失败返 null） */
function fileURLToPathSafe(uri: string): string | null {
  try {
    return fileURLToPathImpl(uri);
  } catch {
    return null;
  }
}

/** fileURLToPath 实装位（node:url 延迟绑定——测试可覆盖面留给装配批） */
function fileURLToPathImpl(uri: string): string {
  // node:url 的 fileURLToPath 形——模块顶已 import pathToFileURL，此处同源
  // 直接用 decodeURI 手写最小形（pathToFileURL 的逆；% 编码解码）
  const prefix = 'file://';
  if (!uri.startsWith(prefix)) return uri;
  let rest = uri.slice(prefix.length);
  // macOS/Linux 绝对形：/path；盘符形不进 v1（平台面随装配批）
  try {
    return decodeURI(rest);
  } catch {
    return rest;
  }
}

function errText(err: unknown): string {
  if (err instanceof BaseError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
