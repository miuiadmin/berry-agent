/**
 * host/plugin-tools — 插件生命周期模型工具族（03 §5.6——task #89 笔三；
 * §5.8 三面同源之模型面）。
 *
 * 宿主固定八件恒挂载（boot 全局层并入——与装载器产出的插件工具同位，不随
 * 换代卸除）：只读三件 model-direct（`effect: 'read'`——plugins_list /
 * events_query / plugin_uninstall_inspect）+ 写类五件（`effect: 'write'`——
 * 守门管道 write-effect 审批对自动执法，safety/gate.ts 单键触发，本件零手写
 * 审批逻辑）。
 *
 * **与 TUI/CLI 两面的分立点**（§5.2/§5.8）：
 *  1. **模型面不自动链 reload**——mount 族成功后回执指路 /reload（模型不
 *     擅自重启管线；TUI 命令面自动链、CLI 短命进程「下次启动生效」三面
 *     各自诚实）；
 *  2. **uninstall execute 不入模型面**（人面独占）——只到 inspect 为止；
 *     reload 不入工具族（TUI /reload 与 CLI 对等承担）；
 *  3. **config 变更不设独立 configure 动词**——mount 撞名拒下改配置 =
 *     unmount 后重 mount（§5.3 后写胜出）。
 *
 * **addedToolNames 诚实空**（§2.8 双通道）：装机/挂载类动作的工具结果携带
 * 新注册工具名清单——但模型面动作时点「装机零生效」（§5.4）且不自动链
 * reload，插件工具注册发生在人面 /reload 后的新代装载；故本族结果恒携带
 * `addedToolNames: []`（通道在位、值诚实空——通道真值的发射位在新代装载
 * 器侧，随 durable 装载史载体批挂账）。
 *
 * 执行件全复用三面同源真源：installPlugin/updatePlugin（plugin-install）、
 * mountRow/unmountRow/toggleRow + readLedger（plugin-store）、inspectUninstall
 * （plugin-uninstall）——本件只做模型面参数 schema + 回执文案 + 前置查。
 */
import { Type } from 'typebox';

import { BaseError, type AgentToolResult, type ToolDefinition } from '../contracts/index.js';
import type { QueryEventsFilter, QueryEventsResult, SqliteDatabase } from '../persist/index.js';

import type { LoadReport } from './loader.js';
import { checkPluginId } from './manifest.js';
import { createDefaultSpawnRunner, installPlugin, updatePlugin } from './plugin-install.js';
import type { SpawnRunner } from './plugin-install.js';
import { inspectUninstall } from './plugin-uninstall.js';
import { mountRow, readEnabledRowsForEdit, readLedger, toggleRow, unmountRow } from './plugin-store.js';
import type { LifecycleAuditSink, PluginLedgerEntry, PluginStoreFs } from './plugin-store.js';

/** 装载生效指路句（模型面回执统一尾——§5.2 模型面不自动链 reload） */
const RELOAD_HINT = '装载生效需 /reload（模型面不自动链 reload——03 §5.2；人面 / TUI 命令面可代跑）';

/** events_query data 摘要截断帽（§5.6——~300 字符归模型面） */
const DATA_SUMMARY_LIMIT = 300;

/** 工具族 deps（装配根进程级构造一次——全取值器/闭包，无 per-session 面） */
export interface PluginLifecycleToolsDeps {
  /** 数据目录（null = 纯 memory 诊断形——装机/行编辑/预检动词诚实拒） */
  readonly dataDir: string | null;
  /** 行编辑/账本文件面（plugin-store 同源——与 TUI/CLI 同一 fs 词形） */
  readonly fs: PluginStoreFs;
  /** 生命周期归因账 sink（进程内 audit face 包装位——落账失败由包装方 warn） */
  readonly auditSink: LifecycleAuditSink;
  /** 装机执行器 spawn 面（真身 = execFile promisify；测试注假件零真网络） */
  readonly spawn: SpawnRunner;
  /** env 面（min-release-age 解析源之一；缺省不传 = 走缺省窗） */
  readonly env?: Record<string, string | undefined>;
  /** 装载报告取值器（换代取值器——/reload 后即新代投影） */
  readonly report: () => LoadReport | undefined;
  /** flushFirst 数据源（events_query 恒 true——05 §4 持久层 flush 屏障） */
  readonly flush: () => Promise<void>;
  /** 跨会话 durable 查询面（events_query——同实例窄面透传） */
  readonly queryEvents: (filter: QueryEventsFilter) => QueryEventsResult;
  /** 卸载预检 db 窄面（plugin_uninstall_inspect——同实例 store.sqlite()） */
  readonly db: SqliteDatabase;
}

/** 统一异常编码（03 §2.3——BaseError 携码前置披露；obs/session-tools 同款先例） */
async function guard(run: () => Promise<AgentToolResult>): Promise<AgentToolResult> {
  try {
    return await run();
  } catch (error) {
    const code = error instanceof BaseError ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: code ? `[${code}] ${message}` : message }],
      isError: true,
      addedToolNames: [], // §2.8 通道在位——错误结果同样携带（当次无新面）
    };
  }
}

/** 纯文本成功回执速记（§2.8——addedToolNames 恒携带，值诚实空） */
function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }], addedToolNames: [] };
}

/** 纯文本错误回执（数据面错误——照常进上下文配对） */
function textError(message: string): AgentToolResult {
  return { content: [{ type: 'text', text: message }], isError: true, addedToolNames: [] };
}

/** ISO 8601 → 毫秒时间戳（坏形抛错——guard 收口 isError） */
function parseIsoMs(label: string, value: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`参数 ${label} 非法 ISO 8601 时间戳（得 "${value}"——形如 2026-09-09T12:00:00Z）`);
  }
  return ms;
}

/** data 摘要（JSON 单行化 + ~300 字符截断——§5.6 归模型面的呈现纪律） */
function summarizeData(data: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(data) ?? 'null';
  } catch {
    text = String(data); // 结构循环等病态兜底（冻结快照实际不可达——防御位）
  }
  return text.length > DATA_SUMMARY_LIMIT ? `${text.slice(0, DATA_SUMMARY_LIMIT)}…（截断）` : text;
}

/** source 徽标判（core: 前缀 → core；用户件查账本；查无 → '?' 诚实缺席） */
function badgeOf(id: string, ledgerById: ReadonlyMap<string, PluginLedgerEntry>): string {
  if (id.startsWith('core:')) return 'core';
  return ledgerById.get(id)?.source ?? '?';
}

/** plugins_list 四态渲染（装载真源 = 内存 boot 报告；装机真源 = 磁盘账本） */
function renderPluginsList(deps: PluginLifecycleToolsDeps): string {
  const lines: string[] = [];
  // 装机账本读（installed-unmounted 分区判据 + source 徽标源；坏账本诚实缺席）
  let ledgerById = new Map<string, PluginLedgerEntry>();
  let ledgerNote: string | undefined;
  if (deps.dataDir !== null) {
    const read = readLedger(deps.dataDir, deps.fs);
    if (read.ok) ledgerById = new Map(read.entries.map((entry) => [entry.id, entry]));
    else ledgerNote = read.reason;
  }
  const report = deps.report();
  if (report === undefined) {
    lines.push('装载面未装配（noPlugins 诊断形）——装载态三分区缺席，仅呈装机面。');
  } else {
    lines.push(`mounted（${report.activated.length}）：`);
    for (const item of report.activated) {
      lines.push(`  ${item.id}  [${badgeOf(item.id, ledgerById)}]`);
    }
    lines.push(`mounted-disabled（${report.skipped.length}）：`);
    for (const item of report.skipped) {
      lines.push(`  ${item.id}  [${badgeOf(item.id, ledgerById)}]  ${item.reason}`);
    }
    lines.push(`failed（${report.failed.length}）：`);
    for (const item of report.failed) {
      lines.push(`  ${item.id}  [${badgeOf(item.id, ledgerById)}]  [${item.code}] ${item.message}`);
    }
  }
  // installed-unmounted：账本 id 无启用行且不在装载报告（core: 恒不在账本——
  // 两域天然无交集；报告 id 一并排除 = 报告/磁盘漂移防御——TUI mount 后
  // 未 reload 的窗内行已在、报告未含，不误报「已装机未挂载」）
  if (deps.dataDir !== null) {
    if (ledgerNote !== undefined) {
      lines.push(`installed-unmounted：缺席（装机账本读取失败：${ledgerNote}）`);
    } else {
      const rowsRead = readEnabledRowsForEdit(deps.dataDir, deps.fs);
      if (!rowsRead.ok) {
        lines.push(`installed-unmounted：缺席（启用清单读取失败：${rowsRead.message}）`);
      } else {
        const rowIds = new Set(rowsRead.rows.map((row) => row.id));
        for (const id of report?.activated ?? []) rowIds.add(id.id);
        for (const id of report?.skipped ?? []) rowIds.add(id.id);
        for (const id of report?.failed ?? []) rowIds.add(id.id);
        const unmounted = [...ledgerById.values()].filter((entry) => !rowIds.has(entry.id));
        lines.push(`installed-unmounted（${unmounted.length}）：`);
        for (const entry of unmounted) {
          lines.push(`  ${entry.id}  [${entry.source}]`);
        }
      }
    }
  }
  return lines.join('\n');
}

/**
 * 模型面工具族工厂（装载位/测试唯一入口）——八件定义数组。写类五件
 * `effect: 'write'`（审批对由守门管道自动执法——写动作永不裸跑）；plugin_toggle
 * 额外 `repeatable: false`（翻旗标非幂等——重放即翻回，禁静默重试）。
 */
export function createPluginLifecycleTools(deps: PluginLifecycleToolsDeps): readonly ToolDefinition[] {
  // 装机/更新共用执行面（auditSink 透传——install 成功尾落 plugin/installed、
  // update 成功尾落 plugin/updated，词形归执行件单源）
  const installDeps = () =>
    deps.dataDir === null
      ? undefined
      : {
          dataDir: deps.dataDir,
          fs: deps.fs,
          spawn: deps.spawn,
          ...(deps.env !== undefined ? { env: deps.env } : {}),
          onLifecycleAudit: deps.auditSink,
        };

  return [
    /* ---------------- 只读三件（model-direct） ---------------- */
    {
      name: 'plugins_list',
      description:
        '插件装载态一览（四态：mounted 已挂载 / mounted-disabled 挂载但禁用 / ' +
        'installed-unmounted 已装机未挂载 / failed 装载失败；每项带 source 徽标 ' +
        'core|npm|git|local）。装载态分区读内存装载报告（/reload 后即新代），' +
        '装机分区读磁盘账本。装机/启用的完整动词面见 plugin_install / plugin_mount 族。',
      parameters: Type.Object({}, { additionalProperties: false }),
      effect: 'read',
      execute: async (): Promise<AgentToolResult> => guard(() => Promise.resolve(textResult(renderPluginsList(deps)))),
    },
    {
      name: 'events_query',
      description:
        '跨会话 durable 事件查询（射程 = 会话事件流：turn/llm/compaction 等核心词；' +
        'plugin/* 生命周期词落 audit 审计流**不在本流**——本工具查不到）。每次查询先 ' +
        'flush 持久层（在飞事件落盘后可见——flushFirst 恒 true）。时窗参数用 ISO 8601' +
        '（如 2026-09-09T12:00:00Z）。呈现行不带 session_id——跨会话查询如需定域请加 ' +
        'session_id 过滤。data 以 JSON 单行摘要呈现（~300 字符截断）。返回 nextCursor ' +
        '时还有更多——原样回传续页。',
      parameters: Type.Object(
        {
          session_id: Type.Optional(Type.String({ description: '会话 id 过滤维（缺省 = 跨会话全量）' })),
          types: Type.Optional(
            Type.Array(Type.String(), { description: '事件类型过滤维（如 turn/end、llm/usage——本流核心词）' }),
          ),
          since: Type.Optional(Type.String({ description: 'ISO 8601 起时窗（含）' })),
          until: Type.Optional(Type.String({ description: 'ISO 8601 止时窗（含）' })),
          limit: Type.Optional(Type.Number({ description: '页帽（缺省 1000，硬帽 10000）' })),
          cursor: Type.Optional(Type.String({ description: '分页游标（上页 nextCursor 原样回传）' })),
        },
        { additionalProperties: false },
      ),
      effect: 'read',
      execute: async (args): Promise<AgentToolResult> =>
        guard(async () => {
          // 时窗词形先行（坏形快拒——无 flush 无查询）；条件展开构形（filter
          // 键 readonly——非突变式）
          const filter: QueryEventsFilter = {
            ...(typeof args.session_id === 'string' && args.session_id !== '' ? { sessionId: args.session_id } : {}),
            ...(Array.isArray(args.types) && args.types.length > 0 ? { types: args.types } : {}),
            ...(typeof args.since === 'string' ? { sinceMs: parseIsoMs('since', args.since) } : {}),
            ...(typeof args.until === 'string' ? { untilMs: parseIsoMs('until', args.until) } : {}),
            ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
            ...(typeof args.cursor === 'string' && args.cursor !== '' ? { cursor: args.cursor } : {}),
          };
          // flushFirst 恒 true（§5.6——查询前落盘在飞事件）
          await deps.flush();
          const result = deps.queryEvents(filter);
          if (result.events.length === 0) {
            return textResult('（零事件——过滤维/时窗内无匹配；时窗用 ISO 8601、types 须事件词汇）');
          }
          const lines = result.events.map(
            (event) =>
              `${event.seq}  ${new Date(event.time).toISOString()}  ${event.type}  ${summarizeData(event.data)}`,
          );
          const header = `seq  time  type  data（${result.events.length} 条）`;
          const tail = result.nextCursor !== null ? `\nnextCursor: ${result.nextCursor}（还有更多——原样回传续页）` : '';
          return textResult([header, ...lines].join('\n') + tail);
        }),
    },
    {
      name: 'plugin_uninstall_inspect',
      description:
        '插件卸载预检（只读零副作用——§5.5 UninstallReport 全量呈报将删项：启用' +
        '行/装机物/域表/store_state 域键/数据域体量）。卸载执行（--confirm 两段式）' +
        '是人面独占动词——模型面只到 inspect 为止，执行指路 CLI：' +
        'berry-agent plugins uninstall <id> --confirm [--data purge]。',
      parameters: Type.Object(
        { id: Type.String({ description: '装机插件 id（core: 前缀非 uninstall 对象）' }) },
        { additionalProperties: false },
      ),
      effect: 'read',
      execute: async (args): Promise<AgentToolResult> =>
        guard(async () => {
          if (deps.dataDir === null) {
            return textError('纯 memory 诊断形无数据目录——卸载预检不可用');
          }
          const outcome = inspectUninstall({ dataDir: deps.dataDir, fs: deps.fs, db: deps.db }, args.id as string);
          return outcome.ok ? textResult(outcome.text) : textError(outcome.message);
        }),
    },
    /* ---------------- 写类五件（审批对自动执法） ---------------- */
    {
      name: 'plugin_install',
      description:
        '三源装机（写类——需审批）。ref 自含源前缀：npm:<pkg>[@<version>] / ' +
        'git:<url>[#<ref>] / local:<abs-path>。供应链四件套执法（钉版/禁 dev/' +
        '静置窗缺省 24h/安装期脚本禁跑）；装机零生效（词表账本收割但不装载）——' +
        '启用走 plugin_mount。uninstall 的执行面是人面独占（CLI --confirm）。',
      parameters: Type.Object(
        {
          ref: Type.String({
            description: '三源自含前缀 ref（npm:acme-widgets@1.2.0 / git:https://…#v1 / local:/abs/path）',
          }),
        },
        { additionalProperties: false },
      ),
      effect: 'write',
      timeoutMs: 600_000, // npm/git 网络腿长动作（CLI 面无帽同义——10 分钟模型面帽）
      execute: async (args): Promise<AgentToolResult> =>
        guard(async () => {
          const executorDeps = installDeps();
          if (executorDeps === undefined) {
            return textError('纯 memory 诊断形无数据目录——装机动词不可用');
          }
          const outcome = await installPlugin(executorDeps, args.ref as string);
          return outcome.ok ? textResult(outcome.text) : textError(outcome.message);
        }),
    },
    {
      name: 'plugin_mount',
      description:
        '挂载已装机插件（写类——需审批）：写启用行。已有行（含禁用行）即撞名拒' +
        '——改配置 = 先 plugin_unmount 再重 mount（§5.3 后写胜出，无独立 configure ' +
        '动词）。core: 前缀官方件天然在场免装机查；用户件须先 plugin_install。' +
        '装载生效需 /reload（模型面不自动链）。',
      parameters: Type.Object(
        {
          id: Type.String({ description: '插件 id（小写字母数字连字符；官方件 core: 前缀）' }),
          config: Type.Optional(Type.Unknown({ description: '插件配置值（JSON——行内 config 字段；装载侧深校验）' })),
        },
        { additionalProperties: false },
      ),
      effect: 'write',
      execute: async (args): Promise<AgentToolResult> =>
        guard(async () => {
          if (deps.dataDir === null) {
            return textError('纯 memory 诊断形无数据目录——行编辑动词不可用（行无落点）');
          }
          const id = args.id as string;
          // 前置两查（与 TUI/CLI 同律——03 §5.8 三面同源单源复述）
          if (!checkPluginId(id, { official: true })) {
            return textError(`插件 id 词法违例（${id}——小写字母数字连字符，官方件 core: 前缀同律）`);
          }
          if (!id.startsWith('core:')) {
            const ledgerRead = readLedger(deps.dataDir, deps.fs);
            if (!ledgerRead.ok) {
              return textError(`装机账本损坏：${ledgerRead.reason}——拒写防覆盖（03 §5.4）`);
            }
            if (!ledgerRead.entries.some((entry) => entry.id === id)) {
              return textError(`插件 ${id} 未装机——先走 plugin_install（未装机挂行会在下次启动读侧降级，03 §5.3）`);
            }
          }
          const result = mountRow(deps.dataDir, id, args.config, deps.fs, deps.auditSink);
          if (!result.ok) return textError(result.message); // 撞名/坏清单——零副作用
          return textResult(`已挂载：${id}——${RELOAD_HINT}`);
        }),
    },
    {
      name: 'plugin_unmount',
      description:
        '卸下插件（写类——需审批）：删启用行保装机（重挂走 plugin_mount）。' +
        'core: 官方件内置全启无行可删——临时停用走 plugin_toggle。' +
        '装载生效需 /reload（模型面不自动链）。',
      parameters: Type.Object({ id: Type.String({ description: '插件 id' }) }, { additionalProperties: false }),
      effect: 'write',
      execute: async (args): Promise<AgentToolResult> =>
        guard(async () => {
          if (deps.dataDir === null) {
            return textError('纯 memory 诊断形无数据目录——行编辑动词不可用（行无落点）');
          }
          const result = unmountRow(deps.dataDir, args.id as string, deps.fs, deps.auditSink);
          if (!result.ok) return textError(result.message);
          return textResult(`已卸下：${args.id as string}（装机保留）——${RELOAD_HINT}`);
        }),
    },
    {
      name: 'plugin_toggle',
      description:
        '翻转插件禁用旗标（写类——需审批；非幂等——重放翻回）。行在场翻旗标、' +
        '行不在场写禁用行（临时停用内置 core: 件的主路径）。装载生效需 /reload' +
        '（模型面不自动链）。',
      parameters: Type.Object({ id: Type.String({ description: '插件 id' }) }, { additionalProperties: false }),
      effect: 'write',
      repeatable: false, // 翻旗标非幂等——重试决策须回模型不静默重放（03 §2.3）
      execute: async (args): Promise<AgentToolResult> =>
        guard(async () => {
          if (deps.dataDir === null) {
            return textError('纯 memory 诊断形无数据目录——行编辑动词不可用（行无落点）');
          }
          const id = args.id as string;
          const result = toggleRow(deps.dataDir, id, deps.fs, deps.auditSink);
          if (!result.ok) return textError(result.message);
          // 终态回读（诚实值源——toggleRow 回执不含终态，行读单源）
          const after = readEnabledRowsForEdit(deps.dataDir, deps.fs);
          const state =
            after.ok && after.rows.some((row) => row.id === id && row.disabled === true)
              ? '禁用'
              : after.ok
                ? '启用'
                : '未知（启用清单回读失败）';
          return textResult(`已切换：${id}（禁用态 → ${state}）——${RELOAD_HINT}`);
        }),
    },
    {
      name: 'plugin_update',
      description:
        '按源分派更新已装机插件（写类——需审批）：npm 重装拉最新满足窗龄版 / ' +
        'git 按原 ref 重克隆（新 commit）/ local 直引 no-op（源目录变更下次装载' +
        '即生效）。更新后清单 id 变更拒（装机身份漂移）。运行中装载面换血同样' +
        '需 /reload（模型面不自动链）。',
      parameters: Type.Object(
        { id: Type.String({ description: '已装机插件 id（装机清单见 plugins_list）' }) },
        { additionalProperties: false },
      ),
      effect: 'write',
      timeoutMs: 600_000, // npm/git 网络腿长动作（与 plugin_install 同帽）
      execute: async (args): Promise<AgentToolResult> =>
        guard(async () => {
          const executorDeps = installDeps();
          if (executorDeps === undefined) {
            return textError('纯 memory 诊断形无数据目录——更新动词不可用');
          }
          const outcome = await updatePlugin(executorDeps, args.id as string);
          if (!outcome.ok) return textError(outcome.message);
          return textResult(`${outcome.text}\n（运行中装载面换血同样走 /reload——模型面不自动链，03 §5.2）`);
        }),
    },
  ];
}

/** 缺省 spawn 真身重导出（装配根接线位——与 CLI 面同一执行面） */
export { createDefaultSpawnRunner };
