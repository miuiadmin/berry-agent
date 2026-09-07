/**
 * L2 tools — 工具注册表两层（04 §7：全局层 + 驱动层；03 §2.2 ctx.tools.register 落形）。
 *
 * 两层（2026-09-04 立项改造裁决：承 berry 三层删应用域分片——插件工具进
 * 全局层，无第三层）：
 * - 全局层：进程单例 Map（宿主固定件工具 + 插件注册的工具——全部会话可见）；
 * - 驱动层：sessionId → Map（会话态工具面——存在理由是会话态状态〔fs 观察
 *   态 per-driver / bash 升权闭包〕，不是域隔离）。
 * - 工具面按会话解析：listFor(sessionId) = 全局层 ∪ 驱动层[sessionId]。
 *
 * 查重碰撞域（「任何单一组合面内不得双名」）：全局层注册查「全局 ∪ 全部
 * 驱动层」（全局工具进一切面——与任何驱动层条目在任何面都共现）；驱动层[s]
 * 注册查「全局 ∪ 驱动层[s]」；跨驱动层同名合法（永不同面——fs 四名每会话
 * 一套即靠此）。03 §2.7「无论哪层哪来源双向对称」按此碰撞域执法。
 *
 * 注册面防线四道（任何来源同一执法——官方件同受管，防线在树上不在审查上）：
 * ①描述注入模式扫描（03 §2.8）→ TOOL_DESCRIPTION_REJECTED；
 * ②parameters 根 object 断言 → TOOL_SCHEMA_INVALID；
 * ③timeoutMs <= 0 拒（正数过小钳至下限——微小预算 = 变相自杀钟，钳而非拒）；
 * ④双帽（03 §3.4）：两层合计 10^3 总量帽 TOOL_REGISTRY_CAPACITY +
 * register/unregister 令牌桶（容量 240、回填 600/分钟，全局键）
 * TOOL_CHANGE_RATE_LIMITED——可用性防线非安全边界。
 *
 * tools_change 事件（03 §2.4 主表 emit 面）：每次注册/注销发射
 * {kind: 'register'|'unregister', name, driver?}——loop 工具快照活数组原位
 * 替换的接线源（04 §4 装配接线义务，消费在装配根）。
 */
import { BaseError } from '../contracts/index.js';
import { TOOLS_CHANGE_EVENT } from '../contracts/index.js';
import type { AgentTool, ToolDefinition, ToolPipelineExecutor } from '../contracts/index.js';
import type { Disposer, EventDispatch } from '../context/index.js';

/** 注册表两层合计件数帽（03 §3.4 总量帽——良性行为距阈值两个数量级，超限 = 失控或泄漏） */
const REGISTRY_TOTAL_LIMIT = 1_000;

/**
 * register/unregister 变更频率桶参数（03 §3.4）：容量 240 吃下 boot + 两连
 * 重载的合法重注册序列；回填 600/分钟 = 10 op/s 持续供给，热迭代不触顶、
 * 武器化持续注册耗尽容量即拦。全局键——registry 无 scope 概念。
 */
const REGISTRY_RATE: Readonly<{ capacity: number; perMinute: number }> = { capacity: 240, perMinute: 600 };

/** timeoutMs 下限（正数过小钳至此——500ms 类微小预算 = 变相自杀钟，钳而非拒） */
export const TOOL_TIMEOUT_FLOOR_MS = 100;

/**
 * v1 注入模式最小词表（03 §2.8 描述扫描）。描述是进模型上下文的文本：
 * `curl … | sh` 形态 = 让模型照描述执行任意下载，是描述面执行漏洞。词表随
 * 真实生态扩充——规范只钉「注册面扫描」这个位置，不在此堆正则。
 */
const DESCRIPTION_INJECTION_PATTERNS: readonly RegExp[] = [/\b(curl|wget)\b[^\n|]*\|[^\n]*\b(ba|z|da)?sh\b/i];

/**
 * 扫描工具描述是否命中注入模式（注册面统一防线——任何来源的工具同一执法）。
 * @returns 命中的模式串（错误归因用）；干净描述返回 undefined
 */
export function scanToolDescription(description: string): string | undefined {
  for (const pattern of DESCRIPTION_INJECTION_PATTERNS) {
    if (pattern.test(description)) return pattern.source;
  }
  return undefined;
}

/**
 * 变更频率令牌桶（03 §3.4 双帽之二）：容量 240、每分钟回填 600——按流逝
 * 时间连续回填（600/60000 per ms），take 不足即拒。桶状态进程内单份（全
 * 局键），随注册表实例生命周期。
 */
class RateLimiter {
  /** 当前令牌数（初始满桶——boot 期的合法批量注册不受阻） */
  private tokens: number;
  /** 上次回填时间戳（ms——按流逝时间折算回填量） */
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly perMinute: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /** 取一枚令牌：充足即取、不足即拒（false——调用方抛 TOOL_CHANGE_RATE_LIMITED） */
  take(): boolean {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + (elapsed * this.perMinute) / 60_000);
      this.lastRefill = now;
    }
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** 注册表选项（装配根注入） */
export interface ToolRegistryOptions {
  /** 三段管道执行器（toAgentTool 的执行真身；缺省缺席 = agentToolsFor 响亮失败） */
  pipeline?: ToolPipelineExecutor;
  /** 总量帽（缺省 10^3；测试面可注小值） */
  registryTotalLimit?: number;
  /** 变更频率桶参数（缺省 {capacity: 240, perMinute: 600}；测试面可注小值） */
  changeRate?: { capacity: number; perMinute: number };
}

/** 工具注册表服务面（ctx.get('tools') 消费形；装配根 createToolRegistry 一次构造） */
export interface ToolRegistry {
  /** 三段管道执行器（随服务携带——装配诊断面；缺省 undefined） */
  readonly executor: ToolPipelineExecutor | undefined;
  /**
   * 注册工具（03 §2.2 ctx.tools.register 落形）。
   * @param def 工具定义（03 §2.3 defineTool 形）
   * @param opts.driver 在场 = 驱动层注册（键 = sessionId——会话态工具面）
   * @returns disposer（注销本条目；幂等——重复调用零次侧效应）
   */
  register(def: ToolDefinition, opts?: { driver?: string }): Disposer;
  /** 按会话解析工具面：全局层 ∪ 驱动层[sessionId]（保注册序） */
  listFor(sessionId: string): ToolDefinition[];
  /** 全局层定义快照（只读副本——装载工具消费腿重放位；批 19a） */
  definitions(): readonly ToolDefinition[];
  /** loop 直消费面：listFor 包装成 AgentTool（execute 接三段管道；无管道响亮失败） */
  agentToolsFor(sessionId: string): AgentTool[];
  /** 两层合计件数（诊断/帽执法读数） */
  readonly size: number;
}

/**
 * 把 ToolDefinition 适配成 loop 面的 AgentTool（execute = 三段管道——管道是
 * 唯一执行路径的结构保证位）。驱动层条目绑 sessionId（管道内 ToolContext
 * 路由 per-session 状态的语境键）。
 */
export function toAgentTool(def: ToolDefinition, executor: ToolPipelineExecutor, sessionId?: string): AgentTool {
  return {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    // 调度语义位透传（一位两用——批消费序按 effect 分段：read 段并发、write 屏障）
    effect: def.effect,
    execute: (toolCallId, args, signal, onUpdate) => executor(def, toolCallId, args, signal, onUpdate, sessionId),
  };
}

/**
 * 组装工具注册表（装配根调用一次；tools_change 经注入的 dispatch 发射）。
 * 注册面归一：effect 缺省 'read'、repeatable 缺省 true（03 §2.3 契约缺省）；
 * timeoutMs 正数过小钳至下限（存归一副本——对调用方原对象零改动）。
 */
export function createToolRegistry(dispatch: EventDispatch, opts: ToolRegistryOptions = {}): ToolRegistry {
  const executor = opts.pipeline;
  const totalLimit = opts.registryTotalLimit ?? REGISTRY_TOTAL_LIMIT;
  const rate = opts.changeRate ?? REGISTRY_RATE;
  /** 全局层：name → 定义（Map 保注册序） */
  const globalLayer = new Map<string, ToolDefinition>();
  /** 驱动层：sessionId → (name → 定义)（Map 保注册序） */
  const driverLayers = new Map<string, Map<string, ToolDefinition>>();
  /** 变更频率桶（register 侧 fail-loud 先于变更；unregister 侧在注销器内） */
  const changeRate = new RateLimiter(rate.capacity, rate.perMinute);

  /** 撞名查重（碰撞域见文件头注）——命中返回既有来源描述（错误信息归因用） */
  const findConflict = (name: string, driver: string | undefined): string | undefined => {
    const global = globalLayer.get(name);
    if (global !== undefined) return `全局层 ${global.name}`;
    if (driver !== undefined) {
      const inDriver = driverLayers.get(driver)?.get(name);
      if (inDriver !== undefined) return `驱动层[${driver}] ${inDriver.name}`;
      return undefined;
    }
    // 全局层注册与全部驱动层查撞（全局进一切面）
    for (const [sessionId, layer] of driverLayers) {
      const hit = layer.get(name);
      if (hit !== undefined) return `驱动层[${sessionId}] ${hit.name}`;
    }
    return undefined;
  };

  /** 两层合计件数（总量帽读数） */
  const totalSize = (): number => {
    let n = globalLayer.size;
    for (const layer of driverLayers.values()) n += layer.size;
    return n;
  };

  /** tools_change 发射（emit 模式——观察面；发射失败不阻注册〔emit 已隔离〕） */
  const announce = (kind: 'register' | 'unregister', name: string, driver?: string): void => {
    void dispatch.emit(TOOLS_CHANGE_EVENT, { kind, name, ...(driver !== undefined ? { driver } : {}) });
  };

  /** 注销器（幂等——disposer 重复调用零次侧效应；频率桶同扣〔unregister 也算变更〕） */
  const makeDisposer = (name: string, driver: string | undefined, normalized: ToolDefinition): Disposer => {
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const layer = driver === undefined ? globalLayer : driverLayers.get(driver);
      // 身份护栏：仅当仍是本定义时移除（防误摘后来胜出者——03 §2.7 与 disposer 释放对齐三律②）
      if (layer === undefined || layer.get(name) !== normalized) return;
      if (!changeRate.take()) {
        throw new BaseError(
          'TOOL_CHANGE_RATE_LIMITED',
          `工具变更频率桶空（容量 ${rate.capacity}、回填 ${rate.perMinute}/分钟）——注销被拦：${name}`,
        );
      }
      layer.delete(name);
      if (driver !== undefined && layer.size === 0) driverLayers.delete(driver);
      announce('unregister', name, driver);
    };
  };

  const registry: ToolRegistry = {
    executor,
    definitions() {
      // 全局层只读副本（快照与注册表解耦——后续注册不进旧快照）
      return [...globalLayer.values()];
    },
    register(def, registerOpts) {
      // ① 描述注入扫描（03 §2.8——任何来源同一防线，官方件同受管）
      const injectionHit = scanToolDescription(def.description);
      if (injectionHit !== undefined) {
        throw new BaseError(
          'TOOL_DESCRIPTION_REJECTED',
          `工具描述命中注入模式（/${injectionHit}/）：${def.name}——描述是进模型上下文的文本，拒绝注册`,
        );
      }
      // ② parameters 根 object 断言：顶层 union（无 type 字段）会被宽容网关剥
      //    成空声明面（模型以空参数调用、宿主 root 级拒绝）——注册即炸前移到装配期
      const schemaRoot = def.parameters as { type?: string } | undefined;
      if (schemaRoot !== undefined && schemaRoot.type !== 'object') {
        throw new BaseError(
          'TOOL_SCHEMA_INVALID',
          `工具 ${def.name} parameters 根节点非 object（${schemaRoot.type ?? '（无 type 字段——顶层 union 形）'}）——` +
            `声明契约只认根 object；互斥多形工具请用扁平 object（判别字段可选 + 字段级 enum）`,
        );
      }
      // ③ timeoutMs 正数校验（<= 0 拒——拒绝式而非钳 0：钳制会静默改变行为）
      if (def.timeoutMs !== undefined && def.timeoutMs <= 0) {
        throw new BaseError(
          'TOOL_INVALID_ARGS',
          `工具 ${def.name} timeoutMs <= 0（${def.timeoutMs}）——不设预算请省略该字段（走管道缺省 60s）`,
        );
      }
      const driver = registerOpts?.driver;
      // ④ 双帽：变更频率桶先扣（fail-loud 先于变更）→ 撞名 → 总量帽
      if (!changeRate.take()) {
        throw new BaseError(
          'TOOL_CHANGE_RATE_LIMITED',
          `工具变更频率桶空（容量 ${rate.capacity}、回填 ${rate.perMinute}/分钟）——注册被拦：${def.name}`,
        );
      }
      const conflict = findConflict(def.name, driver);
      if (conflict !== undefined) {
        throw new BaseError(
          'TOOL_NAME_CONFLICT',
          `工具名 ${def.name} 已被占用（${conflict}）——碰撞域内双向对称拒绝（03 §2.7）`,
        );
      }
      if (totalSize() >= totalLimit) {
        throw new BaseError(
          'TOOL_REGISTRY_CAPACITY',
          `注册表两层合计达总量帽 ${totalLimit}（当前 ${totalSize()}）——超限拒新注册：${def.name}`,
        );
      }
      // 归一副本：effect 缺省 read、repeatable 缺省 true（03 §2.3 契约缺省）；timeoutMs 钳下限
      const normalized: ToolDefinition = {
        ...def,
        effect: def.effect ?? 'read',
        repeatable: def.repeatable ?? true,
        ...(def.timeoutMs !== undefined ? { timeoutMs: Math.max(def.timeoutMs, TOOL_TIMEOUT_FLOOR_MS) } : {}),
      };
      if (driver === undefined) {
        globalLayer.set(normalized.name, normalized);
      } else {
        const existing = driverLayers.get(driver);
        if (existing !== undefined) {
          existing.set(normalized.name, normalized);
        } else {
          const layer = new Map<string, ToolDefinition>();
          layer.set(normalized.name, normalized);
          driverLayers.set(driver, layer);
        }
      }
      announce('register', normalized.name, driver);
      return makeDisposer(normalized.name, driver, normalized);
    },
    listFor(sessionId) {
      const driverLayer = driverLayers.get(sessionId);
      if (driverLayer === undefined) return [...globalLayer.values()];
      // 驱动层条目在后（同面重名不可能——碰撞域已拒，序 = 全局先驱动后）
      return [...globalLayer.values(), ...driverLayer.values()];
    },
    agentToolsFor(sessionId) {
      if (executor === undefined) {
        throw new BaseError(
          'CONTEXT_SERVICE_MISSING',
          `工具注册表未接三段管道（pipeline 缺席）——agentToolsFor 不可用（装配缺陷）`,
        );
      }
      return registry.listFor(sessionId).map((def) => toAgentTool(def, executor, sessionId));
    },
    get size() {
      return totalSize();
    },
  };
  return registry;
}
