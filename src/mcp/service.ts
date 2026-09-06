/**
 * MCP 服务面（03 §10.1 连接语义的编排核心——装配后异步发现零阻塞）。
 *
 * apply(config)：同步返回零等待——每服务器后台发现（fire-and-forget 必带
 * .catch 失败收口：MCP_CONNECT_FAILED 降 warn + ui.notify，单服务器失败不阻
 * 同行其余、不阻宿主启动）；续段每步查 scope 活（/reload/卸行竞速护栏——
 * 死即协议化关停且不计失败）。发现完成 → 桥入活表 → 工具面重铺（全局合计
 * 定形态：≤20 原生注册 / >20 目录降级——每桥落地/撤销均重铺，阈值随活集
 * 自然收敛）。
 *
 * crash：撤该服务器工具（重铺减源）+ ui.notify warn + 不自动重连（复位走
 * /reload）。作用域回卷：ctx.effect LIFO——各桥 close()（stdin.end 协议化
 * 告别 → 宽限 → killTree 树杀）异步起跑不阻塞回卷序。
 */
import { createLogger } from '../context/index.js';
import type { Logger } from '../context/index.js';
import { connectMcpServer } from './bridge.js';
import type { McpBridge } from './bridge.js';
import { buildMcpToolDefs } from './tools.js';
import type { McpToolSource } from './tools.js';
import type { McpConfig, McpRegisterToolsFace, McpScopeFace, McpServerConfig, McpSpawnFace } from './types.js';
import { filterServerTools } from './tools.js';

/** 服务装配依赖（全窄面注入——词面独立律） */
export interface McpServiceDeps {
  readonly spawn: McpSpawnFace;
  readonly registry: McpRegisterToolsFace;
  readonly scope: McpScopeFace;
  /** ui.notify warn 窄面（缺省 no-op——测试静默） */
  readonly notify?: (message: string) => void;
  readonly logger?: Logger;
  readonly now?: () => number;
  /** 关停宽限 ms（透传桥；缺省 3000） */
  readonly closeGraceMs?: number;
  /** clientInfo.version 披露（装配批对齐 package.json） */
  readonly clientVersion?: string;
}

/** 活服务器快照行（诊断面） */
export interface McpLiveServer {
  readonly server: string;
  readonly toolCount: number;
}

/** MCP 服务公开面（apply 单口 + 活集快照） */
export interface McpService {
  /** 全量应用配置（零阻塞——发现后台跑；重复 apply 先撤旧桥再发现） */
  apply(config: McpConfig): void;
  /** 活服务器快照（发现完成且未 crash 的桥） */
  liveServers(): readonly McpLiveServer[];
}

/** 组 MCP 服务 */
export function createMcpService(deps: McpServiceDeps): McpService {
  const logger = deps.logger ?? createLogger('mcp');
  const notify = deps.notify ?? (() => undefined);
  /** 活桥表（server → { bridge, config }——config 供过滤与重铺） */
  const bridges = new Map<string, { bridge: McpBridge; config: McpServerConfig }>();
  /** 当前注册面注销器（重铺先全撤） */
  let surfaceDisposers: (() => void)[] = [];

  const isAlive = (): boolean => !deps.scope.isDisposed;

  /** 撤当前注册面（重铺/回卷共用——幂等） */
  function disposeSurface(): void {
    for (const dispose of surfaceDisposers) {
      try {
        dispose();
      } catch (err) {
        logger.warn(`MCP 工具注销失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    surfaceDisposers = [];
  }

  /** 拼活源清单（enabled/disabled 过滤落此——复合名/目录面只见过滤后集） */
  function liveSources(): McpToolSource[] {
    const sources: McpToolSource[] = [];
    for (const { bridge, config } of bridges.values()) {
      sources.push({
        server: bridge.server,
        tools: filterServerTools(bridge.tools, config),
        toolTimeoutMs: bridge.toolTimeoutMs,
        call: (tool, args) => bridge.call(tool, args),
      });
    }
    return sources;
  }

  /** 重铺工具面（全撤重建——形态随活集合计裁决；scope 死即不铺） */
  function resurface(): void {
    if (!isAlive()) return;
    disposeSurface();
    const { defs } = buildMcpToolDefs(liveSources(), (message) => logger.warn(message));
    for (const def of defs) {
      try {
        surfaceDisposers.push(deps.registry.register(def));
      } catch (err) {
        // per-def 容错：撞名（TOOL_NAME_CONFLICT）/令牌桶（TOOL_CHANGE_RATE_LIMITED）
        // 等注册面拒——单件降级 warn 不炸全行
        logger.warn(`MCP 工具注册失败（${def.name}）：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** 单服务器后台发现（fire-and-forget 调用方必带 .catch） */
  async function discover(server: string, config: McpServerConfig): Promise<void> {
    const bridge = await connectMcpServer(server, config, {
      spawn: deps.spawn,
      logger,
      closeGraceMs: deps.closeGraceMs,
      clientVersion: deps.clientVersion,
    });
    // 续段 scope 活查（异步边界护栏——/reload/卸行竞速）：死即协议化关停，
    // 不入活表不计失败（安静退场非降级语义）
    if (!isAlive()) {
      await bridge.close();
      return;
    }
    bridges.set(server, { bridge, config });
    bridge.onDown((reason) => {
      // 运行期 crash：撤工具 + ui.notify warn + 不自动重连（复位走 /reload）
      if (bridges.get(server)?.bridge !== bridge) return; // 旧桥迟到事件（重 apply 后）
      bridges.delete(server);
      notify(`MCP 服务器 ${server} 已断开（${reason}）——其工具已撤，复位走 /reload`);
      resurface();
    });
    resurface();
  }

  /** 撤全部桥（重复 apply / 回卷共用——LIFO 关停异步起跑） */
  function shutdownAll(): void {
    const entries = [...bridges.values()].reverse(); // LIFO——后连先关
    bridges.clear();
    disposeSurface();
    for (const { bridge } of entries) void bridge.close();
  }

  // 作用域回卷登记（LIFO 尾位——回卷即全撤：stdin.end → 宽限 → killTree）
  deps.scope.effect(() => () => shutdownAll());

  const service: McpService = {
    apply(config) {
      shutdownAll(); // config 整值替换语义——旧桥全撤再发现（§5.3）
      for (const [server, serverConfig] of Object.entries(config)) {
        void discover(server, serverConfig).catch((err: unknown) => {
          // 失败收口必带（fire-and-forget 纪律）：降 warn + ui.notify 不炸装配
          const detail = err instanceof Error ? err.message : String(err);
          logger.warn(`MCP 服务器连接失败（${server}）：${detail}`);
          notify(`MCP 服务器 ${server} 连接失败：${detail}`);
        });
      }
    },

    liveServers() {
      return [...bridges.entries()].map(([server, { bridge, config }]) => ({
        server,
        toolCount: filterServerTools(bridge.tools, config).length,
      }));
    },
  };
  return service;
}
