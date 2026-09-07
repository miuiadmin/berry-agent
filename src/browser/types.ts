/**
 * core:browser 类型面（03 §10.3——CDP 手写最小桥 + 引擎发现序 + 十工具；
 * 批 17b-2 传输层腿）。
 *
 * 词面独立律（02 §4.1 席 19 deps = contracts + web + persist）：spawn 与
 * 工具注册全经**窄面注入**消费（mcp/lsp 先例同律——本件与 exec/tools 零 DAG
 * 边）：
 * - `BrowserSpawnFace` 与 exec SpawnPipeline.spawnInteractive 结构兼容（组合
 *   根直接传管道真身；兼容性互证测试在 compat.test.ts）；
 * - `BrowserRegisterToolsFace` 与 tools ToolRegistry.register 子面结构兼容
 *   （返回注销器 = 撤工具面）；
 * - `BrowserScopeFace` 与 context Scope 的 effect/isDisposed 子面结构兼容
 *   （ctx.effect 回卷 + 续段 scope 活查）；
 * - logger 窄面（本件无 context 边——createLogger 不可 import，装配根传真
 *   身、缺省 no-op 测试静默）。
 *
 * web 席边为真消费（卫生单源复用——navigate 入口 URL 经 WebFetchService
 * 同一 execute 跑五卫生件 + 同一在飞门实例，「两消费面同一 execute 同一限
 * 流」的第三消费位）。persist 席边留白（v1 账本/截图走数据目录文件面——
 * 页面态永不跨进程恢复，durable 只落工具事件不落页面态）。
 */
import { BaseError } from '../contracts/index.js';
import type { ToolContext } from '../contracts/index.js';
import type { WebFetchService } from '../web/index.js';

/* ---------------- 常量（缺省值单源——03 §10.3 生命周期与回收条款） ---------------- */

/** 引擎启动预算 ms（spawn → DevTools 侦听行 → ws 建立 → Browser.getVersion 同罩） */
export const BROWSER_STARTUP_TIMEOUT_MS = 20_000;

/** 单条 CDP 命令缺省钟 ms（命令级超时——连接级失败分账 BROWSER_CONNECT_FAILED） */
export const BROWSER_CDP_COMMAND_TIMEOUT_MS = 15_000;

/** 两级闲置回收缺省（03 §10.3：context 级与引擎级各 300s） */
export const BROWSER_IDLE_MS = 300_000;

/** 闲置扫掠间隔 ms（自续 setTimeout 链——unref 不阻进程退出） */
export const BROWSER_SWEEP_INTERVAL_MS = 5_000;

/** 引擎协议化关停宽限 ms（Browser.close → 宽限等退 → kill 兜底） */
export const BROWSER_CLOSE_GRACE_MS = 3_000;

/** stderr DevTools 侦听行解析（Chrome 系引擎 --remote-debugging-port=0 唯一出口） */
export const DEVTOOLS_LISTENING_RE = /DevTools listening on (ws:\/\/\S+)/;

/** 导航预算 ms（Page.navigate 发出 → loadEventFired 等待同罩——慢页面不误杀） */
export const BROWSER_NAV_TIMEOUT_MS = 30_000;

/** console 环形缓冲帽（Runtime.consoleAPICalled/exceptionThrown 累积——超帽弃最旧） */
export const BROWSER_CONSOLE_RING_CAP = 200;

/** 截图滚动清理保留数（落数据目录可取阅位——超量弃最旧，图像字节永不进 durable） */
export const BROWSER_SCREENSHOT_KEEP = 20;

/** 截图子目录名（`${dataDir}/browser/` 下——与 engine/profile 同级） */
export const BROWSER_SCREENSHOT_DIRNAME = 'screenshots';

/** 引擎 spawn 归属名（登记簿同册——三桥同律） */
export const BROWSER_ENGINE_OWNER = 'browser:engine';

/**
 * 引擎最小 env 白名单（deny-by-default 同律 exec）：Chrome headless 实测
 * 需 HOME（用户数据目录解析）与 PATH（ crashpad 报告器自寻）；TMPDIR/locale
 * 为崩溃报告与字体定位保底。零继承宿主其余变量（凭证面封死）。
 */
export const BROWSER_ENGINE_ENV_ALLOW: readonly string[] = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL'];

/* ---------------- 配置面（core:browser 行 config——用户可配域） ---------------- */

/** 全行配置（config.browser 整值） */
export interface BrowserConfig {
  /** 显式引擎路径（引擎发现序第①步） */
  readonly executablePath?: string;
  /** 云端 provider 占位（v1 执行面零接——在场即 boot 通知「引擎恒本地」） */
  readonly providers?: readonly unknown[];
}

/**
 * 归一 config.browser（坏形响亮拒 BROWSER_CONFIG_INVALID）。
 * undefined/null → 空配置（缺省行惰性无害零 spawn——零工具调用 = 零进程零连接）。
 */
export function normalizeBrowserConfig(raw: unknown): BrowserConfig {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BaseError('BROWSER_CONFIG_INVALID', 'config.browser 须为对象');
  }
  const v = raw as Record<string, unknown>;
  let executablePath: string | undefined;
  if (v.executablePath !== undefined) {
    if (typeof v.executablePath !== 'string' || v.executablePath === '') {
      throw new BaseError(
        'BROWSER_CONFIG_INVALID',
        `browser.executablePath 须为非空字符串（引擎可执行绝对路径）：${JSON.stringify(v.executablePath)}`,
      );
    }
    executablePath = v.executablePath;
  }
  let providers: readonly unknown[] | undefined;
  if (v.providers !== undefined) {
    if (!Array.isArray(v.providers)) {
      throw new BaseError('BROWSER_CONFIG_INVALID', 'browser.providers 须为数组（云端占位——v1 执行面零接）');
    }
    providers = v.providers;
  }
  return {
    ...(executablePath !== undefined ? { executablePath } : {}),
    ...(providers !== undefined ? { providers } : {}),
  };
}

/* ---------------- 注入窄面（词面独立律——结构兼容真身，compat.test 互证） ---------------- */

/** 引擎子进程窄面（结构兼容 exec InteractiveChild 子集——stderr 侦听 + 退出 + 树杀） */
export interface BrowserChildFace {
  /** DevTools 侦听行来源（Chrome 系引擎在 stderr 报 DevTools listening on ws://…） */
  readonly stderr: { on(event: 'data', listener: (chunk: Buffer) => void): unknown };
  /** 退出回调（一次性事件；已退出时注册即回调——迟到订阅不丢事件） */
  onExit(callback: (info: { code: number | null; spawnError?: Error }) => void): void;
  /** 进程组树杀兜底（已退出 no-op——幂等） */
  kill(): void;
}

/** spawn 窄面（结构兼容 exec SpawnPipeline.spawnInteractive——组合根传真身） */
export interface BrowserSpawnFace {
  spawnInteractive(request: {
    readonly argv: readonly string[];
    readonly env?: {
      readonly allow?: readonly string[];
    };
    readonly owner: string;
  }): BrowserChildFace;
}

/**
 * WebSocket 连接窄面（Node ≥22 原生 WebSocket 的最小子集——03 §10.3 形态
 * 条款「零新增依赖」；生产用全局 WebSocket，测试走脚本化桩）。
 */
export interface BrowserWsConnection {
  /** 文本帧写出（CDP JSON 文本帧——桥侧独占写） */
  send(text: string): void;
  /** 主动关（幂等） */
  close(): void;
  /** 文本帧读入挂线 */
  onMessage(listener: (text: string) => void): void;
  /** 关闭挂线（进程死/网络断——引擎降级归因源） */
  onClose(listener: () => void): void;
  /** 建立完成；建立期失败 reject（BROWSER_CONNECT_FAILED 归因在引擎层） */
  readonly opened: Promise<void>;
}

/** ws 工厂窄面（生产 = 全局 WebSocket 包装；测试注入桩） */
export interface BrowserWsFace {
  connect(url: string): BrowserWsConnection;
}

/** 文件面窄面（结构兼容 node:fs/promises 子集——发现/账本/截图位共用） */
export interface BrowserFsFace {
  /** 存在性探针（ENOENT reject） */
  access(path: string): Promise<void>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readdir(path: string): Promise<readonly string[]>;
  stat(path: string): Promise<{ isFile(): boolean }>;
  unlink(path: string): Promise<void>;
  /** 属位改写（install 件可执行位——窄面可选，生产适配传入） */
  chmod?(path: string, mode: number): Promise<void>;
}

/** 工具注册窄面（结构兼容 tools ToolRegistry.register 子面——撤工具经注销器） */
export interface BrowserRegisterToolsFace {
  register(def: {
    name: string;
    description: string;
    parameters: object;
    timeoutMs?: number;
    effect?: 'read' | 'write';
    execute: (args: Record<string, unknown>, toolCtx: ToolContext) => Promise<unknown>;
  }): () => void;
}

/** 作用域窄面（结构兼容 context Scope 的 effect/isDisposed 子面——回卷与活查） */
export interface BrowserScopeFace {
  /** 登记可逆副作用（disposer 进 LIFO 回卷序） */
  effect(register: () => () => void): unknown;
  /** 作用域已回卷旗（续段 scope 活查源） */
  readonly isDisposed: boolean;
}

/** logger 窄面（本件无 context 边——装配根传真身；缺省 no-op 测试静默） */
export interface BrowserLoggerFace {
  debug?(message: string): void;
  info?(message: string): void;
  warn(message: string): void;
}

/** env 读取窄面（缺省 process.env——BERRY_AGENT_BROWSER_PATH 覆盖位） */
export type BrowserEnvFace = (name: string) => string | undefined;

/** web 服务窄面（真消费——三消费位同一 execute 同一在飞门，卫生件不旁路） */
export type BrowserWebFace = Pick<WebFetchService, 'fetch'>;
