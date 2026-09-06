/**
 * ctx.agent 服务面（02 §2.3「ctx.agent provide」/ 03 §2.2 能力面表）——
 * conversation 件经 scope.provide('agent', …) 供给的服务词汇。
 *
 * 两动词（03 篇能力面表在册——本面只登记不重复语义）：
 *  - registerMessageRole：自定义消息角色注册（contracts 注册表的单入口委托
 *    ——域名前缀两段式强制/撞名拒绝式执法全在 contracts 单源）；
 *  - onRunSettled：run 终态订阅（**非总线词汇**——触发契约锚 = run 终态
 *    三值 04 §2；compaction 触发〔05 §2〕消费）。会话内每次 runTurns
 *    结算由 ConversationDriver 在终态边界回调（04 §3——与审批收口同界）。
 *
 * 服务面是进程级单例：多会话共用一枚，订阅回调携 {sessionId} 信封区分
 * 来源会话（多会话并存下活体载荷携带 sessionId 的同律）。
 */
import { registerMessageRole } from '../contracts/index.js';
import type { MessageRoleDefinition } from '../contracts/index.js';
import type { RunResult } from '../agent/index.js';
import type { Disposer, Scope } from '../context/index.js';

/** run 终态订阅回调载荷（result + 来源会话信封） */
export interface RunSettledEvent {
  /** run 终态三值（completed / failed / aborted——04 §2） */
  readonly result: RunResult;
  /** 来源会话（多会话并存下的信封位） */
  readonly sessionId: string;
}

/** ctx.agent 服务词汇面（03 §2.2 消费形——插件经 ctx.get('agent') 取用） */
export interface AgentService {
  /** 自定义消息角色注册（contracts 单入口委托；返回 disposer） */
  registerMessageRole(role: string, definition: MessageRoleDefinition): Disposer;
  /** run 终态订阅（非总线词汇——驱动结算边界回调；返回 disposer） */
  onRunSettled(handler: (event: RunSettledEvent) => void): Disposer;
}

/** scope 服务名（02 §2.3 ctx.agent provide——服务词汇单源定值） */
export const AGENT_SERVICE_NAME = 'agent';

/** 订阅表登记（服务实例 → 终态回调集——驱动回调面的受控读口，WeakMap 随服务回收） */
const settleTables = new WeakMap<AgentService, Set<(event: RunSettledEvent) => void>>();

/**
 * 组装 ctx.agent 服务并 provide 到装载运行时 scope（host 装配根调用一次，
 * 先于一切驱动起跑——驱动在 runTurns 终态经 scope.tryGet 回调订阅面）。
 */
export function provideAgentService(scope: Scope): AgentService {
  /** run 终态订阅表（注册序回调；dispose 即摘） */
  const settleHandlers = new Set<(event: RunSettledEvent) => void>();
  const service: AgentService = {
    // 委托 contracts 注册表：域名纪律/撞名执法单源在彼，此处零再立法
    registerMessageRole: (role, definition) => registerMessageRole(role, definition),
    onRunSettled: (handler) => {
      settleHandlers.add(handler);
      return () => {
        settleHandlers.delete(handler);
      };
    },
  };
  settleTables.set(service, settleHandlers);
  scope.provide(AGENT_SERVICE_NAME, service);
  return service;
}

/**
 * 驱动侧终态回调（runTurns finally 消费点——04 §3 终态=结算边界，与审批
 * 收口同界）。scope 未 provide（纯对话测试形态/装配序缺口）= 零回调静默
 * 跳过；订阅者异常隔离（emit 族同律——单订阅者故障不反噬 run 结算路径）。
 */
export function notifyRunSettled(scope: Scope, event: RunSettledEvent): void {
  const service = scope.tryGet<AgentService>(AGENT_SERVICE_NAME);
  if (service === undefined) return;
  const handlers = settleTables.get(service);
  if (handlers === undefined) return;
  for (const handler of [...handlers]) {
    try {
      handler(event);
    } catch {
      // 观察者异常隔离——继续其余订阅者，结算路径不受影响
    }
  }
}
