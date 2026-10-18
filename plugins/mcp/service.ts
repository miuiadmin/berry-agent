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
 * attachServer(server, config, spawn?)（03 §10.1 R2 装载位受理口）：server
 * 形插件装载序单服务器受理——名字占用账响亮拒撞名；spawn 在场 = 插件位
 * 专属 spawn 面（grants 交集维 confine），缺席 = 装配态缺省面（档位维）；
 * 连接/发现/降级全复用 apply 同管道。
 *
 * crash：撤该服务器工具（重铺减源）+ ui.notify warn + 不自动重连（复位走
 * /reload）。作用域回卷：ctx.effect LIFO——各桥 close()（stdin.end 协议化
 * 告别 → 宽限 → killTree 树杀）异步起跑不阻塞回卷序。
 *
 * 受理位保留键拒（65 轮件G）：apply/attachServer 拒键 `agent`（复合工具名
 * agent__* 正中宿主 agent_ 前缀保留闸——fail-loud 在配置装载面、错族指路
 * 改名，不在注册面事后拒）；tools/list 跟尽页帽在桥侧（bridge.ts——超帽
 * 走本文件 discover 既有失败收口）。
 */
import { createLogger } from '../../src/context/index.js';
import type { Logger } from '../../src/context/index.js';
import { BaseError } from '../../src/contracts/index.js';
import { connectMcpServer } from './bridge.js';
import type { McpBridge } from './bridge.js';
import { buildMcpToolDefs } from './tools.js';
import type { McpToolSource } from './tools.js';
import type { McpConfig, McpRegisterToolsFace, McpScopeFace, McpServerConfig, McpSpawnFace } from './types.js';
import { filterServerTools } from './tools.js';

/**
 * MCP 服务器保留键（65 轮件G——03 §10.1 键词法批注：保留前缀撞形补拒）。
 *
 * 键 `agent` 使复合工具名 `agent__<tool>` 正中宿主工具名保留前缀闸
 * （AGENT_TOOL_PREFIX 'agent_'——防代理自造工具冒名 agent_ 族的注册面执
 * 法），该服务器全体工具注册被拒且用户只见工具消失不见配置错——故在
 * 配置装载校验位 fail-loud 拒（错族指路改名，不在注册面事后拒）。
 */
export const MCP_RESERVED_SERVER_NAME = 'agent';

/** 保留键拒载（apply/attachServer 两受理位共用——精确匹配，邻近键不连坐） */
function assertServerNameNotReserved(server: string): void {
  if (server === MCP_RESERVED_SERVER_NAME) {
    throw new BaseError(
      'MCP_CONFIG_INVALID',
      `MCP 服务器键「${MCP_RESERVED_SERVER_NAME}」为保留名——复合工具名 agent__<tool> 正中宿主 agent_ 前缀保留闸（该服务器全体工具会被注册面拒、工具静默消失），请改名（任意非 agent 的 [A-Za-z0-9-]+ 键）`,
    );
  }
}

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

/**
 * 单服务器受理窄面（03 §10.1 R2 装载位消费形——host 装载器只认本子面）。
 *
 * server 形插件装载 = 声明块铸为服务器描述符交本面受理：spawn/连接/发现/
 * 注册/降级全复用 §10.1 既有管道（装载器零 spawn 路径）；`spawn` 缺席 = 走
 * 装配态缺省 spawn 面（core:mcp 装配时的 confine 档位维），在场 = 插件位
 * 专属面（grants 交集维——装载序按插件逐个注入）。
 */
export interface McpServerAttachFace {
  /** 受理单服务器（名字撞已受理/config 键 → MCP_CONFIG_INVALID 响亮拒） */
  attachServer(server: string, config: McpServerConfig, spawn?: McpSpawnFace): void;
}

/** MCP 服务公开面（apply 单口 + 活集快照 + 单服务器受理位） */
export interface McpService extends McpServerAttachFace {
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
  /**
   * 名字占用账（config 键 ∪ 已受理 server 形插件名——受理位撞名执法面）：
   * apply 整值替换时重置为 config 键集；attachServer 逐名登记。防 config 键
   * 与插件位声明名互蔽（后写静默顶掉先写桥的活表遮蔽——响亮拒优于静默丢）。
   */
  const claimedNames = new Set<string>();
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

  /** 单服务器后台发现（fire-and-forget 调用方必带 .catch）；spawnOverride = 插件位专属 spawn 面（缺席走装配缺省） */
  async function discover(server: string, config: McpServerConfig, spawnOverride?: McpSpawnFace): Promise<void> {
    const bridge = await connectMcpServer(server, config, {
      spawn: spawnOverride ?? deps.spawn,
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
      // 保留键前置拒（65 轮件G——先校验后动作：坏配置整单拒，旧桥不拆）。
      // 抛 MCP_CONFIG_INVALID → 装配侧行级装载失败收口（与 normalizeMcpConfig
      // 坏形同语义——/reload 时刻可修）
      for (const server of Object.keys(config)) assertServerNameNotReserved(server);
      shutdownAll(); // config 整值替换语义——旧桥全撤再发现（§5.3）
      // 占用账重置为 config 键集（整值替换同律）：受理位从零起算——已受理
      // 的 server 形插件服务器随旧桥全撤不复活（v1 无运行期重 apply 路径；
      // boot 内序 = core:mcp 装配 apply 先行、server 行装载受理后至——结构
      // 性不撞本重置）
      claimedNames.clear();
      for (const [server, serverConfig] of Object.entries(config)) {
        claimedNames.add(server);
        void discover(server, serverConfig).catch((err: unknown) => {
          // 失败收口必带（fire-and-forget 纪律）：降 warn + ui.notify 不炸装配
          const detail = err instanceof Error ? err.message : String(err);
          logger.warn(`MCP 服务器连接失败（${server}）：${detail}`);
          notify(`MCP 服务器 ${server} 连接失败：${detail}`);
        });
      }
    },

    attachServer(server, config, spawn) {
      // 保留键前置拒（65 轮件G——词法保留位结构性不可用，先于占用账判）；
      // 抛 MCP_CONFIG_INVALID → 装载序行级隔离收口（该插件行装载失败）
      assertServerNameNotReserved(server);
      // 撞名响亮拒（config 键 ∪ 已受理名——防互蔽静默顶活表；装载序行级
      // 隔离由调用方收口为该插件行装载失败）
      if (claimedNames.has(server)) {
        throw new BaseError(
          'MCP_CONFIG_INVALID',
          `MCP 服务器名已被占用（${server}）——config servers 键与 server 形插件声明名不得重名`,
        );
      }
      claimedNames.add(server);
      // 受理即装载账收讫：spawn/连接/发现全后台（连接失败不阻装载账——
      // 03 §10.1 降级语义复用；plugin/server-loaded 审计词不受此路影响）
      void discover(server, config, spawn).catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : String(err);
        logger.warn(`MCP 服务器连接失败（${server}）：${detail}`);
        notify(`MCP 服务器 ${server} 连接失败：${detail}`);
      });
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
