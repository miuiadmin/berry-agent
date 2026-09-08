/**
 * host/sessions-cmd — `sessions` 子命令族 CLI 入口（07 §5 会话管理命令族；
 * CLI 对等律射界 02 §2.3 多会话面；批 20d）。
 *
 * 五子动词分账（开库形态两分）：
 *  - **读腿（list/search）+ 维护动词（reindex）——零装配直开库**：不开运行
 *    时、不占单活跃机标记、不装载插件（同 serve status 只读豁免族——短命
 *    查询/维护动词不是第二宿主实例）。开库走 Persistence 直开 + 宿主迁移链
 *    尾单源（HOST_MIGRATION_TAIL——开库门禁按链 head 校验 user_version，
 *    短链开真库会被同库拒降级运行，链必须与运行时全同）。reindex 是派生物
 *    重建（05 §9「派生物不修不补——重建即修复」），写面只 session_fts 表。
 *  - **fork——全装配**：与 run --fork / TUI fork 同机（assembly 公共段：
 *    单活跃机占标记 + 插件装载——session_before_fork 钩子保真〔checkpoint
 *    waterfall gate 等在场〕；05 §5.0 边界快照机制单源在 SessionManager.fork）。
 *  - **resume <id>——进 TUI**：直托 runTuiEntry（resumeSessionId 载体——
 *    「指定 id 续接」的 CLI 半边，与无参 TUI 的按 cwd 取最新互补〔07 §5〕）；
 *    非 TTY 卫兵同 TUI 主入口律（管道/CI 退 2 指引改 run --session）。
 *
 * 退出码：0 成功（含空清单/零命中——诚实空非失败）/ 1 执行失败（会话不
 * 存在、fork 否决、装配失败）/ 2 环境态误用（resume 非 TTY——07 §5 三态）。
 */
import { stdin as processStdin, stdout as processStdout, stderr as processStderr } from 'node:process';

import { Persistence } from '../persist/index.js';
import type { Provider } from '../llm/index.js';
import type { SandboxMode } from '../safety/index.js';

import type { SessionsCommand, TuiFlags } from './cli.js';
import { assembleHostStack } from './assembly.js';
import { HOST_MIGRATION_TAIL } from './runtime.js';
import type { HostRuntime } from './runtime.js';
import { runTuiEntry } from './tui-entry.js';
import type { TerminalIO } from '../channels/index.js';

/** 入口选项（main 分派接线 + 测试注入面） */
export interface SessionsEntryOptions {
  /** 宿主版本（fork 全装配路径消费） */
  readonly version: string;
  /** 数据目录（缺省 resolveDataDir()——secret.key 归属地；fork·resume 装配透传） */
  readonly dataDir?: string;
  /** 库文件路径（缺省 resolveDatabasePath() 三级梯子——与一切入口同源；
   * 注意 dataDir 不重定位库文件〔路径梯子律 05 §6.6〕；测试隔离注入位） */
  readonly dbPath?: string;
  /** env 面（缺省 process.env——装配路径透传） */
  readonly env?: Record<string, string | undefined>;
  /** 运行时组装后回调（main.ts attachRuntime——信号/崩溃编舞切运行时本体） */
  readonly onRuntime?: (runtime: HostRuntime) => void;
  /** 新会话工作区锚点（缺省 process.cwd()——resume 透传 TUI） */
  readonly cwd?: string;
  /** resume 非 TTY 卫兵谓词（缺省 process 直判——测试注入位） */
  readonly stdinIsTTY?: boolean;
  readonly stdoutIsTTY?: boolean;
  /** 初始 provider 集（fork/resume 测试注入 faux provider） */
  readonly providers?: readonly Provider[];
  /** 模型标识（fork/resume 透传组合根） */
  readonly model?: string;
  /** 沙箱档位取值器（fork/resume 透传组合根） */
  readonly sandboxMode?: () => SandboxMode;
  /** 终端适配器（resume → TUI 透传；缺省 ProcessTerminalIO——测试注入） */
  readonly io?: TerminalIO;
  /** 输出面（缺省 process.stdout——测试注入） */
  readonly writeOut?: (text: string) => void;
  /** 错误面（缺省 process.stderr——测试注入） */
  readonly writeErr?: (text: string) => void;
}

/** sessions 子命令族主入口。返回进程退出码（0/1/2；用法错归解析层） */
export async function runSessionsEntry(sub: SessionsCommand, options: SessionsEntryOptions): Promise<number> {
  switch (sub.sub) {
    case 'list':
      return runList(options);
    case 'search':
      return runSearch(options, sub.query);
    case 'reindex':
      return runReindex(options);
    case 'resume':
      return runResume(options, sub.id);
    case 'fork':
      return runFork(options, sub.id);
  }
}

/* ---------------- 读腿基建（零装配直开库） ---------------- */

/**
 * 读腿/维护动词开库（宿主迁移链尾单源；库文件路径走三级梯子缺省——与一切
 * 入口同库同律；warn 走错误面——毒丸/撕裂尾告警直达人面）。
 */
function openReadSide(options: SessionsEntryOptions, err: (text: string) => void): Persistence {
  return Persistence.open({
    ...(options.dbPath !== undefined ? { dbPath: options.dbPath } : {}),
    ...(options.dataDir !== undefined ? { dataDir: options.dataDir } : {}),
    migrations: HOST_MIGRATION_TAIL,
    warn: (message) => err(`warn：${message}`),
  });
}

/** ISO 时间形态（ms epoch → 确定性串——测试可断言） */
function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/** 血缘形（origin + 父链箭头——统一式不逐 origin 造文案） */
function lineageOf(origin: string, parentId: string | undefined): string {
  return parentId === undefined ? origin : `${origin}←${parentId}`;
}

/* ---------------- list ---------------- */

/** list：会话清单（id/标题/时间/血缘；updated 倒序） */
async function runList(options: SessionsEntryOptions): Promise<number> {
  const out = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const err = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const persistence = openReadSide(options, err);
  try {
    const rows = persistence.store.listSessions({ limit: 100 });
    if (rows.length === 0) {
      out('无会话（数据目录尚无在册会话——首跑 run/TUI 即建）');
      return 0;
    }
    const lines: string[] = [`共 ${rows.length} 个会话（updated 倒序，帽 100）：`];
    for (const row of rows) {
      lines.push(
        `  ${row.id}  ${row.title ?? '（无标题）'}  创建 ${isoOf(row.createdAt)}  更新 ${isoOf(row.updatedAt)}  ${lineageOf(row.origin, row.parentId)}`,
      );
    }
    out(lines.join('\n'));
    return 0;
  } finally {
    await persistence.close();
  }
}

/* ---------------- search ---------------- */

/** 命中行 snippet 切窗（首现位 ±30 字符；空白折叠单行——body 为索引投影原文，消费侧自切〔05 §9〕） */
function snippetOf(body: string, query: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return flat.length > 64 ? `${flat.slice(0, 64)}…` : flat; // trigram 归一后首现位缺席——退头窗
  const start = Math.max(0, at - 30);
  const end = Math.min(flat.length, at + query.length + 30);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/** search：跨会话 FTS 全文检索（bm25 序；输出 id/标题/命中行） */
async function runSearch(options: SessionsEntryOptions, query: string): Promise<number> {
  const out = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const err = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const persistence = openReadSide(options, err);
  try {
    const hits = persistence.store.searchFtsGlobal(query, 50);
    if (hits.length === 0) {
      out(`无命中（${query}）`);
      return 0;
    }
    // 标题面一次读齐（命中行带 session 归属——行面反查人读标题）
    const titles = new Map<string, { title: string | undefined; origin: string; parentId: string | undefined }>();
    for (const row of persistence.store.listSessions({ limit: 1000 })) {
      titles.set(row.id, { title: row.title, origin: row.origin, parentId: row.parentId });
    }
    const lines: string[] = [`命中 ${hits.length} 处（bm25 序，帽 50）：`];
    for (const hit of hits) {
      const meta = titles.get(hit.sessionId);
      const head = `${hit.sessionId}  ${meta?.title ?? '（无标题）'}`;
      lines.push(`  ${head}  #${hit.seq}  ${snippetOf(hit.body, query)}`);
    }
    out(lines.join('\n'));
    return 0;
  } finally {
    await persistence.close();
  }
}

/* ---------------- reindex ---------------- */

/** reindex：FTS 全量重建（05 §9 托付的手动重建命令——诊断索引漂移后的一键复位；派生物不修不补） */
async function runReindex(options: SessionsEntryOptions): Promise<number> {
  const out = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const err = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const persistence = openReadSide(options, err);
  try {
    const result = persistence.store.rebuildFts();
    out(`FTS 重建完成：${result.sessions} 会话 / ${result.events} 事件入索引（派生物重建即修复）`);
    return 0;
  } finally {
    await persistence.close();
  }
}

/* ---------------- resume（进 TUI） ---------------- */

/** resume：按 id 续接后进 TUI（runTuiEntry resumeSessionId 载体；非 TTY 卫兵同 TUI 主入口律） */
async function runResume(options: SessionsEntryOptions, id: string): Promise<number> {
  const err = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const stdinIsTTY = options.stdinIsTTY ?? processStdin.isTTY === true;
  const stdoutIsTTY = options.stdoutIsTTY ?? processStdout.isTTY === true;
  if (!stdinIsTTY || !stdoutIsTTY) {
    err(
      '非交互环境（stdin/stdout 非 TTY）——sessions resume 进 TUI 不适用于管道/CI；单发续接改用 `berry-agent run --session <id> "<message>"`。',
    );
    return 2;
  }
  // 直托 TUI 主入口（装配序单源）：resumeSessionId 在场即按 id 续接，缺席
  // 语义面归 tui-entry；id 打错的干净退 1 由其内呈报
  const flags: TuiFlags = { noPlugins: false, debug: false };
  return runTuiEntry({
    flags,
    version: options.version,
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.dataDir !== undefined ? { dataDir: options.dataDir } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.providers !== undefined ? { providers: options.providers } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.sandboxMode !== undefined ? { sandboxMode: options.sandboxMode } : {}),
    ...(options.io !== undefined ? { io: options.io } : {}),
    ...(options.onRuntime !== undefined ? { onRuntime: options.onRuntime } : {}),
    resumeSessionId: id,
  });
}

/* ---------------- fork（全装配） ---------------- */

/** fork：边界快照分叉（05 §5.0 机制单源在 SessionManager.fork；与 run --fork / TUI fork 同机——钩子保真 + 单活跃机占标记） */
async function runFork(options: SessionsEntryOptions, id: string): Promise<number> {
  const out = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const err = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const assembly = await assembleHostStack({
    runtime: {
      ...(options.dataDir !== undefined ? { dataDir: options.dataDir } : {}),
    },
    noPlugins: false, // fork 与 TUI 同构装载面——session_before_fork 钩子（checkpoint gate 等）保真
    debug: false,
    version: options.version,
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.providers !== undefined ? { providers: options.providers } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.sandboxMode !== undefined ? { sandboxMode: options.sandboxMode } : {}),
    ...(options.onRuntime !== undefined ? { onRuntime: options.onRuntime } : {}),
  });
  if (!assembly.ok) {
    err(assembly.message); // 单活跃机/开库/启用清单损坏——干净退出档（不写 crash.log）
    return assembly.exitCode;
  }
  try {
    // 源存在性预检：manager.fork 的缺席 throw 是调用序 bug 面（PERSIST_DATA_
    // CORRUPT）——CLI 人面把打错 id 呈报为干净失败档
    const row = assembly.runtime.persistence.store.getSessionRow(id);
    if (row === undefined) {
      err(`会话不存在：${id}——用 sessions list 查在册 id`);
      return 1;
    }
    let forked: Awaited<ReturnType<typeof assembly.stack.manager.fork>>;
    try {
      forked = await assembly.stack.manager.fork(id);
    } catch (error) {
      err(`fork 失败：${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    if (forked.status === 'vetoed') {
      // session_before_fork 钩子否决——非错误路径但 fork 无法进行（退 1 执行失败档）
      err(`fork 被钩子否决：${forked.reason}`);
      return 1;
    }
    out(`已分叉：${forked.sessionId}`);
    out(`  源会话 ${id}（种子 ${forked.lineage.seedLength} 事件）`);
    out(`  续接：berry-agent sessions resume ${forked.sessionId}`);
    return 0;
  } finally {
    await assembly.runtime.shutdown();
  }
}
