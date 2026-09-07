/**
 * LSP 实例（03 §10.2 生命周期——惰性 per-(server, rootUri) 单实例的承载腿）。
 *
 * connect 编舞：spawn（exec 管道窄面，owner = `lsp:<server>`）→ stderr 转
 * logger debug → initialize 握手（startup_timeout_sec 钟只罩 spawn+握手）→
 * initialized 通知。连接期失败抛 LSP_CONNECT_FAILED（子进程收场不留孤儿）。
 *
 * 文档同步（Full 全文同步——盘真相）：`syncDocument` 首触 didOpen（携
 * languageId）、后续 didChange（Full 全文 + 递增 version）——不维护影子文
 * 本，文件即事实源；`closeDocument` 唯一触发点 = edit 的 delete 路径。
 *
 * 诊断 version 对齐：waiter 解锁 = 收到的诊断 version ≥ 本次发送 version
 * （服务器不带 version 视为最新）——连续双写同文件不被过期诊断误唤醒。
 *
 * close（协议化关停）：`shutdown` 请求 → 响应后发 `exit` 通知 → 宽限 →
 * killTree 兜底；幂等（二次 close 复用同一结算）。
 *
 * crash：onExit close 事件 → failAll + onDown 一次送达（迟到订阅即回调）
 * ——「一次进程事故恰计一败」的幂等闸在本层（markDown 一次结算）。
 */
import { BaseError } from '../contracts/index.js';
import { createLogger } from '../context/index.js';
import type { Logger } from '../context/index.js';
import { LspWire } from './connection.js';
import { LSP_CLOSE_GRACE_MS, LSP_STARTUP_TIMEOUT_SEC_DEFAULT, languageIdForPath } from './types.js';
import type { LspChildFace, LspServerConfig, LspSpawnFace } from './types.js';

/** 实例构造依赖（全可注入——测试零真进程依赖） */
export interface LspInstanceDeps {
  readonly spawn: LspSpawnFace;
  readonly logger?: Logger;
  /** 关停宽限 ms（缺省 3000） */
  readonly closeGraceMs?: number;
}

/** 诊断条目（publishDiagnostics 单条投影——severity 1=Error 2=Warning 3=Info 4=Hint） */
export interface LspDiagnosticItem {
  readonly severity: number;
  readonly message: string;
  readonly line: number;
  readonly character: number;
  readonly source?: string;
}

/** 单实例公开面（service 编排消费） */
export interface LspInstance {
  readonly server: string;
  readonly rootUri: string;
  /** 单请求（request_timeout_sec 钟由调用方传入——两钟接力不互截） */
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  /** 全文同步（返发送 version——waiter 对齐用）；closeDocument 后首触重开 */
  syncDocument(uri: string, text: string, path: string): number;
  /** 关文档（didClose——edit 的 delete 路径唯一触发点） */
  closeDocument(uri: string): void;
  /**
   * 等诊断回流（version 对齐：收到的 version ≥ minVersion 或服务器不带
   * version）。超钟返 null（诚实降级——调用方逐路径点名）；连接死返 null。
   */
  waitDiagnostics(uri: string, minVersion: number, timeoutMs: number): Promise<readonly LspDiagnosticItem[] | null>;
  /** 最近一帧诊断快照（已满足 version 对齐即直取——零等待快路径） */
  latestDiagnostics(uri: string, minVersion: number): readonly LspDiagnosticItem[] | undefined;
  /** crash/载体级失败通知（服务面撤实例 + 计熔断）——一次事件，迟到订阅即回调 */
  onDown(callback: (reason: string) => void): void;
  /** 协议化关停（shutdown → exit → 宽限 → killTree；幂等） */
  close(): Promise<void>;
}

/** 连接单实例（握手全程）。连接期失败抛 LSP_CONNECT_FAILED，子进程先收场。 */
export async function connectLspInstance(
  server: string,
  config: LspServerConfig,
  rootUri: string,
  deps: LspInstanceDeps,
): Promise<LspInstance> {
  const logger = deps.logger ?? createLogger('lsp');
  const graceMs = deps.closeGraceMs ?? LSP_CLOSE_GRACE_MS;
  const startupMs = (config.startup_timeout_sec ?? LSP_STARTUP_TIMEOUT_SEC_DEFAULT) * 1_000;

  // ── spawn（登记簿同册：owner = lsp:<server>——「谁开的」审计面） ──
  let child: LspChildFace;
  try {
    child = deps.spawn.spawnInteractive({
      argv: [config.command, ...(config.args ?? [])],
      env: config.env !== undefined ? { set: config.env } : undefined,
      owner: `lsp:${server}`,
    });
  } catch (err) {
    throw new BaseError('LSP_CONNECT_FAILED', `spawn 失败（${server}）：${errText(err)}`, { cause: asError(err) });
  }

  // ── 载体状态机（crash 检测 = close 事件；帧 fatal = 封读+同步树杀） ──
  let downReason: string | undefined;
  const downCallbacks: ((reason: string) => void)[] = [];
  let exitInfo: { code: number | null; spawnError?: Error } | undefined;
  const exitWaiters: (() => void)[] = [];
  let closePromise: Promise<void> | undefined;

  let wire: LspWire | undefined;
  const markDown = (reason: string): void => {
    if (downReason !== undefined) return; // 幂等闸：一次进程事故恰计一败
    downReason = reason;
    for (const cb of [...downCallbacks]) cb(reason);
    for (const w of [...exitWaiters]) w();
    exitWaiters.length = 0;
  };

  child.onExit((info) => {
    exitInfo = info;
    wire?.failAll(
      new BaseError(
        'LSP_CONNECT_FAILED',
        info.spawnError !== undefined
          ? `spawn 失败（${server}）：${info.spawnError.message}`
          : `LSP 服务器退出（${server}，code=${info.code}）`,
      ),
    );
    markDown(
      info.spawnError !== undefined ? `spawn 失败：${info.spawnError.message}` : `服务器退出（code=${info.code}）`,
    );
  });

  // ── 文档同步账（per-URI version——盘真相全文同步） ──
  const docs = new Map<string, { version: number }>();
  /** 诊断账：uri → 最近一帧（version 对齐判据用） */
  const latestDiag = new Map<string, { version: number | undefined; items: LspDiagnosticItem[] }>();
  const diagWaiters: Array<{
    uri: string;
    minVersion: number;
    resolve: (items: readonly LspDiagnosticItem[] | null) => void;
    timer: NodeJS.Timeout;
  }> = [];

  wire = new LspWire({
    send: (frame) => child.stdin.write(frame),
    warn: (message) => logger.warn(message),
    onFatal: () => {
      // 载体级失败收场：封读 + 同步树杀（不杀即永久孤儿）
      child.stdout.destroy();
      child.kill();
    },
  });
  child.stdout.on('data', (chunk) => wire?.feed(chunk));
  child.stderr.on('data', (chunk) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim() !== '') logger.debug(`[lsp:${server}] ${line}`);
    }
  });

  // publishDiagnostics 唯一真消费面：记账 + 唤醒满足 version 对齐的 waiter
  wire.onNotification('textDocument/publishDiagnostics', (n) => {
    const p = (n.params ?? {}) as { uri?: unknown; version?: unknown; diagnostics?: unknown };
    if (typeof p.uri !== 'string') return;
    const items = normalizeDiagnostics(p.diagnostics);
    const version = typeof p.version === 'number' ? p.version : undefined;
    latestDiag.set(p.uri, { version, items });
    for (let i = diagWaiters.length - 1; i >= 0; i--) {
      const w = diagWaiters[i]!;
      if (w.uri !== p.uri) continue;
      // version 对齐：不带 version 视为最新；带则须 ≥ 本次发送 version
      if (version === undefined || version >= w.minVersion) {
        clearTimeout(w.timer);
        diagWaiters.splice(i, 1);
        w.resolve(items);
      }
    }
  });

  try {
    // ── initialize 握手（startup 钟只罩 spawn+握手；rootUri 钉工作区物理根） ──
    await wire.request('initialize', { processId: null, rootUri, capabilities: {} }, startupMs);
    wire.notify('initialized', {});
    if (downReason !== undefined) {
      throw new BaseError('LSP_CONNECT_FAILED', `LSP 服务器退出（${server}）：${downReason}`);
    }
  } catch (err) {
    // 连接期失败收场：结清 pending + 树杀（不留孤儿）→ 分类抛出
    wire.failAll(
      err instanceof BaseError ? err : new BaseError('LSP_CONNECT_FAILED', `握手失败（${server}）：${errText(err)}`),
    );
    child.kill();
    if (err instanceof BaseError && err.code === 'LSP_CONNECT_FAILED') throw err;
    if (err instanceof Error && err.message.includes('超时')) {
      throw new BaseError('LSP_CONNECT_FAILED', `initialize 握手超时（${server}，预算 ${startupMs}ms）`, {
        cause: err,
      });
    }
    throw new BaseError('LSP_CONNECT_FAILED', `握手失败（${server}）：${errText(err)}`, { cause: asError(err) });
  }

  return {
    server,
    rootUri,
    request: (method, params, timeoutMs) => {
      if (downReason !== undefined) {
        return Promise.reject(new BaseError('LSP_CONNECT_FAILED', `实例已死（${server}）：${downReason}`));
      }
      return wire!.request(method, params, timeoutMs);
    },
    syncDocument(uri, text, path) {
      const doc = docs.get(uri);
      if (doc === undefined) {
        // 首触：didOpen 携 languageId（version 从 1 起）
        docs.set(uri, { version: 1 });
        wire!.notify('textDocument/didOpen', {
          textDocument: { uri, languageId: languageIdForPath(path), version: 1, text },
        });
        return 1;
      }
      doc.version += 1;
      wire!.notify('textDocument/didChange', {
        textDocument: { uri, version: doc.version },
        contentChanges: [{ text }], // Full 全文同步——增量算法不进 v1
      });
      return doc.version;
    },
    closeDocument(uri) {
      if (!docs.has(uri)) return; // 未开不关（幂等）
      docs.delete(uri);
      wire!.notify('textDocument/didClose', { textDocument: { uri } });
    },
    latestDiagnostics(uri, minVersion) {
      const latest = latestDiag.get(uri);
      if (latest === undefined) return undefined;
      if (latest.version !== undefined && latest.version < minVersion) return undefined; // 过期帧不算
      return latest.items;
    },
    waitDiagnostics(uri, minVersion, timeoutMs) {
      // 快路径：已满足 version 对齐的最近帧直取（零等待）
      const latest = latestDiag.get(uri);
      if (latest !== undefined && (latest.version === undefined || latest.version >= minVersion)) {
        return Promise.resolve(latest.items);
      }
      return new Promise<readonly LspDiagnosticItem[] | null>((resolve) => {
        const entry = {
          uri,
          minVersion,
          resolve: (items: readonly LspDiagnosticItem[] | null) => {
            // 连接死等价超钟——null 诚实降级（调用方逐路径点名）
            resolve(items);
          },
          timer: setTimeout(() => {
            const idx = diagWaiters.indexOf(entry);
            if (idx >= 0) diagWaiters.splice(idx, 1);
            resolve(null);
          }, timeoutMs),
        };
        diagWaiters.push(entry);
      });
    },
    onDown(callback) {
      if (downReason !== undefined)
        callback(downReason); // 迟到订阅即回调
      else downCallbacks.push(callback);
    },
    close: () => {
      if (closePromise === undefined) {
        closePromise = closeChild(
          wire!,
          child,
          graceMs,
          () => exitInfo,
          (waiter) => exitWaiters.push(waiter),
          logger,
          server,
        );
      }
      return closePromise; // 幂等——二次 close 复用首次结算
    },
  };
}

/** publishDiagnostics.diagnostics 归一（坏条目跳过——range/severity/message 容错） */
function normalizeDiagnostics(raw: unknown): LspDiagnosticItem[] {
  if (!Array.isArray(raw)) return [];
  const items: LspDiagnosticItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const d = entry as {
      severity?: unknown;
      message?: unknown;
      range?: { start?: { line?: unknown; character?: unknown } };
      source?: unknown;
    };
    if (typeof d.message !== 'string') continue;
    items.push({
      severity: typeof d.severity === 'number' ? d.severity : 1,
      message: d.message,
      line: typeof d.range?.start?.line === 'number' ? d.range.start.line : 0,
      character: typeof d.range?.start?.character === 'number' ? d.range.start.character : 0,
      ...(typeof d.source === 'string' ? { source: d.source } : {}),
    });
  }
  return items;
}

/**
 * 协议化关停编舞：shutdown 请求 → 响应后发 exit 通知 → 宽限 → killTree
 * 兜底。shutdown 无响应（挂死/已死）不等满——请求钟与宽限同帽，钟尽即发
 * exit 进入宽限段（关停不因坏服务器悬挂）。
 */
function closeChild(
  wire: LspWire,
  child: LspChildFace,
  graceMs: number,
  exitOf: () => { code: number | null; spawnError?: Error } | undefined,
  addWaiter: (waiter: () => void) => void,
  logger: Logger,
  server: string,
): Promise<void> {
  return (async () => {
    // shutdown 请求（响应与否都进 exit 段——宽限钟即本段总帽）
    await wire.request('shutdown', undefined, graceMs).catch(() => undefined);
    try {
      wire.notify('exit');
    } catch {
      // 已死载体——宽限/树杀照走
    }
    const exited = new Promise<void>((resolve) => {
      if (exitOf() !== undefined) resolve();
      else addWaiter(resolve);
    });
    const raced = await Promise.race([exited.then(() => true), delay(graceMs).then(() => false)]);
    if (!raced) {
      logger.warn(`LSP 实例宽限尽未退（${server}）——树杀兜底`);
      child.kill();
    }
  })();
}

/** 延时助手（宽限钟） */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
