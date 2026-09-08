/**
 * 'sessions' 服务面（03 §4.4/§4.5 + 06 §318 appendEvent 最小面——批 19 销账笔）。
 *
 * 宿主装配根 provide 的活引用面：appendEventFor(sessionId) 按会话解析**当下**
 * 活体驱动（/new 热切换安全 = 调用时点解析非装配期冻结）；无活体驱动 =
 * undefined 降级（服务照常 provide——诚实缺席律：消费方〔core:memory 差分
 * 落账腿〕捕获后自行降级，mirror 不锁步）。
 *
 * 二道闸（06 §318 定稿条款——闭环在闭包内非依赖 SessionLog 下游）：
 *  ①核心事件词伪造拒写——核心词写入权属宿主（核心事件族 = 驱动单源）；
 *  ②未注册词汇拒写——与 SessionLog.append 下游 SESSION_UNKNOWN_EVENT_TYPE
 *    同判据（前置在此 = 错误信息可携带服务面上下文；下游仍兜底）。
 *
 * 完整 ctx.sessions 面（只读四件 + 受理制写两腿 + 三闸）归后续批——本件只落
 * appendEvent 最小面（memory/diff 唯一 durable 出口的承载位）。
 */
import { BaseError, CORE_EVENT_TYPE_NAMES, isKnownEventType } from '../contracts/index.js';
import type { SessionLog } from '../session/index.js';

/**
 * 驱动取值器（活引用——调用时点解析）。结构 typing 而非 import
 * ConversationDriver：本件只消费 session 附件（SessionLog），驱动面窄化由
 * 装配根的 stack.driverOf 天然满足。
 */
export type SessionsDriverOf = (sessionId: string) => { readonly session: SessionLog } | undefined;

/**
 * sessions 服务最小面（appendEvent 单动词——03 §4.4 受理制写的最小切面）。
 * 词面独立律：memory 席消费本形（结构兼容即编译期验），host 边不反向进 memory。
 */
export interface SessionsFace {
  /**
   * 按会话取 appendEvent 活引用：过二道闸后委派 SessionLog.append（同步
   * 落账）。无活体驱动 → undefined（消费方降级）；返回闭包同样**调用时点**
   * 执法（取引用与调用的两时点间驱动可能已闭——闸与 append 都在调用拍执行）。
   */
  appendEventFor(sessionId: string): ((type: string, data: unknown) => unknown) | undefined;
}

/** 建 sessions 服务面（装配根：`scope.provide('sessions', createSessionsFace({ driverOf }))`） */
export function createSessionsFace(options: { readonly driverOf: SessionsDriverOf }): SessionsFace {
  return {
    appendEventFor(sessionId) {
      const log = options.driverOf(sessionId)?.session;
      if (log === undefined) return undefined; // 无活体驱动——诚实缺席（不造回库替身）
      return (type, data) => {
        // 闸一：核心事件词伪造拒写（核心词写入权属宿主——双入口纪律的受理侧）
        if (CORE_EVENT_TYPE_NAMES.includes(type)) {
          throw new BaseError(
            'SESSION_CORE_TYPE_FORBIDDEN',
            `核心事件词 ${type} 拒经 sessions.appendEventFor 写入（核心事件族写入权属宿主驱动单源——06 §6 二道闸①）`,
          );
        }
        // 闸二：未注册词汇拒写（词汇注册表单源；判据与 SessionLog.append 下游同源）
        if (!isKnownEventType(type)) {
          throw new BaseError(
            'SESSION_UNKNOWN_EVENT_TYPE',
            `事件词 ${type} 未在词汇注册表（sessions.appendEventFor 前置闸——下游 SessionLog.append 同判据兜底）`,
          );
        }
        return log.append(type, data);
      };
    },
  };
}
