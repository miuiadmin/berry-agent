/**
 * core:lsp 类型面（03 §10.2——帧层 + 惰性实例 + 诊断回流；批 17a-3）。
 *
 * 词面独立律（02 §4.1 席 deps = contracts + context）：本件与 exec/tools 零
 * DAG 边——spawn / 工具注册 / 事件挂线 / 盘读全经**窄面注入**消费（mcp 件
 * McpSpawnFace 先例同律）：
 * - `LspSpawnFace` 与 exec SpawnPipeline.spawnInteractive 结构兼容（组合根
 *   直接传管道真身；兼容性互证测试在 compat.test.ts）；
 * - `LspRegisterToolsFace` 与 tools ToolRegistry.register 子面结构兼容；
 * - `LspScopeFace` 与 context Scope 的 effect/isDisposed 子面结构兼容；
 * - `LspEventsFace` 与 context EventDispatch.onWaterfall 子面结构兼容
 *   （tools_post_execute 挂线面）；
 * - `LspFsFace` 与 node:fs/promises 子面结构兼容（readFile/realpath——盘
 *   真相源同步用）。
 *
 * context 席边为真消费（createLogger——装载态 ui.notify 接线随装配批）。
 *
 * 配置面边界：03 §10.2 未立 config 校验码（mcp 件 MCP_CONFIG_INVALID 先例
 * 系 mcp 章节明需 /reload 响亮拒位；lsp 章节无此条款）——本件类型即契约，
 * 路由对合法配置全域全覆盖，坏行经类型面在装配根拦截。
 */
import type { AgentToolResult } from '../contracts/index.js';
import type { ToolDefinition } from '../contracts/index.js';

/* ---------------- 常量（缺省值单源——03 §10.2 字段落码定形注） ---------------- */

/** 攒头态字节帽（无 \r\n\r\n 分隔符的持续流不无界攒积——超帽走坏帧路径） */
export const LSP_HEADER_LIMIT_BYTES = 16 * 1024;

/** 攒正文态字节帽（Content-Length 声明值即缓冲吸收上界——超帽走坏帧路径） */
export const LSP_BODY_LIMIT_BYTES = 16 * 1024 * 1024;

/** initialize 握手预算缺省秒数（只罩 spawn+握手；与请求钟分账不互截） */
export const LSP_STARTUP_TIMEOUT_SEC_DEFAULT = 30;

/** 单请求预算缺省秒数（只计单请求——与握手钟分账，两钟接力） */
export const LSP_REQUEST_TIMEOUT_SEC_DEFAULT = 15;

/** 同 server 连败熔断阈值（实例级旗标、复位走 /reload） */
export const LSP_CIRCUIT_FAILURE_LIMIT = 3;

/** 协议化关停宽限缺省（shutdown → exit 通知 → 宽限等退 → killTree 兜底） */
export const LSP_CLOSE_GRACE_MS = 3_000;

/** 诊断回流竞速钟缺省（工具面与 post 注入同源） */
export const LSP_DIAGNOSTICS_TIMEOUT_MS_DEFAULT = 3_500;

/** 诊断回流竞速钟硬帽（04 §11 同数——min(配置, 硬帽) 执法位） */
export const LSP_DIAGNOSTICS_TIMEOUT_MS_CAP = 3_500;

/** 诊断段条目上限（单次注入合计——超限截断注记） */
export const LSP_DIAGNOSTICS_MAX_ITEMS = 50;

/** 诊断段总字节上限（追加进 result.content 的段尺寸帽） */
export const LSP_DIAGNOSTICS_SEGMENT_LIMIT_BYTES = 4 * 1024;

/* ---------------- 配置面（core:lsp 行 config——用户可配域） ---------------- */

/** 单服务器配置（config.servers 键的值形） */
export interface LspServerConfig {
  /** 可执行（v1 只收绝对路径——与 mcp 件同口径） */
  readonly command: string;
  /** 命令行参数 */
  readonly args?: readonly string[];
  /** 显式注入 env（EnvPolicy.set 面） */
  readonly env?: Readonly<Record<string, string>>;
  /** 扩展名路由表（lowercase 归一匹配——'.ts' 与 'ts' 同形；多服务器命中取键声明序首） */
  readonly languages: readonly string[];
  /** 握手预算秒（缺省 30——只罩 spawn+initialize） */
  readonly startup_timeout_sec?: number;
  /** 单请求预算秒（缺省 15——只计单请求） */
  readonly request_timeout_sec?: number;
}

/** servers 整值（键声明序 = 路由裁决序——Object.entries 保插入序） */
export type LspConfig = Readonly<Record<string, LspServerConfig>>;

/** 全行配置（servers + 件级诊断钟；用户行覆盖 = 整值替换非合并） */
export interface LspSettings {
  readonly servers: LspConfig;
  /** 诊断回流竞速钟 ms（缺省 3500；实效 = min(此值, 3500 硬帽)） */
  readonly diagnostics_timeout_ms?: number;
}

/* ---------------- 窄面（结构兼容真身——组合根直接传真身） ---------------- */

/** 子进程窄面（结构兼容 exec InteractiveChild 子面——测试注假件零真进程） */
export interface LspChildFace {
  readonly stdin: { write(data: Buffer): void; end(): void };
  readonly stdout: { on(event: 'data', listener: (chunk: Buffer) => void): void; destroy(): void };
  readonly stderr: { on(event: 'data', listener: (chunk: Buffer) => void): void };
  onExit(callback: (info: { code: number | null; spawnError?: Error }) => void): void;
  kill(): void;
}

/** spawn 窄面（结构兼容 exec SpawnPipeline——compat.test 互证） */
export interface LspSpawnFace {
  spawnInteractive(request: {
    readonly argv: readonly string[];
    readonly cwd?: string;
    readonly env?: { readonly set?: Readonly<Record<string, string>> };
    readonly owner: string;
  }): LspChildFace;
}

/** 工具注册窄面（结构兼容 tools ToolRegistry.register 子面——返回注销器） */
export interface LspRegisterToolsFace {
  register(def: ToolDefinition): () => void;
}

/** 作用域窄面（结构兼容 context Scope 子面——effect 回卷 + isDisposed 活查） */
export interface LspScopeFace {
  effect(register: () => () => void): unknown;
  readonly isDisposed: boolean;
}

/** 事件挂线窄面（结构兼容 context EventDispatch.onWaterfall 子面） */
export interface LspEventsFace {
  onWaterfall<T>(name: string, listener: (value: T, next: (value: T) => Promise<T>) => Promise<T> | T): () => void;
}

/** 盘读窄面（结构兼容 node:fs/promises 子面——盘真相源同步用） */
export interface LspFsFace {
  readFile(path: string): Promise<Buffer>;
  realpath(path: string): Promise<string>;
}

/* ---------------- 路由（扩展名路由表——全件唯一裁决序） ---------------- */

/** 扩展名归一（剥前导点 + lowercase） */
export function normalizeExtension(ext: string): string {
  return ext.replace(/^\.+/, '').toLowerCase();
}

/** 路径扩展名提取（末点后段，lowercase；无点返空串） */
export function extensionOf(path: string): string {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/**
 * 扩展名路由：config 键声明序扫描，首命中即返（多服务器同扩展名 = 声明序
 * 首裁决——四工具与诊断注入同表同序，路由规则全件唯一）。无命中返 null。
 */
export function routeServer(config: LspConfig, path: string): string | null {
  const ext = extensionOf(path);
  if (ext === '') return null;
  for (const [name, entry] of Object.entries(config)) {
    if (entry.languages.some((l) => normalizeExtension(l) === ext)) return name;
  }
  return null;
}

/** didOpen languageId 派生表（常见扩展名；缺席回退扩展名本身） */
const LANGUAGE_IDS: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascriptreact',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  scss: 'scss',
  html: 'html',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sh: 'shellscript',
  zsh: 'shellscript',
  sql: 'sql',
};

/** languageId 派生（扩展名 → languageId；未收录回退扩展名——诚实不猜语义） */
export function languageIdForPath(path: string): string {
  const ext = extensionOf(path);
  return LANGUAGE_IDS[ext] ?? (ext !== '' ? ext : 'plaintext');
}

/** 工具结果文本项便捷构造（测试与工具面共用） */
export function textResult(text: string, isError?: boolean): AgentToolResult {
  return { content: [{ type: 'text', text }], ...(isError === true ? { isError: true } : {}) };
}
