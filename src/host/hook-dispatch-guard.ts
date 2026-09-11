/**
 * host/hook-dispatch-guard — 钩子派发段深度计数 guard（03 §3.4 执法形定形注；
 * cache 经济批 ca-3）。
 *
 * 语义：包裹**插件钩子派发**前后自增自减——await 跨度天然覆盖 handler 全执行
 * 段，派发收口即闭窗（「起异步任务不等结果合法、await 耦合违法」的条款语义
 * 精确对齐：fire-and-forget 尾链在派发收口后窗外合法跑）；**只包钩子派发不包
 * 工具执行体**（03 §3.4 只禁钩子段——工具执行期模型调用不受限）。
 *
 * 旗标住 host 装配根（全局单实例——全部插件 ctx 共享同一深度计数，跨插件
 * 嵌套钩子叠加正确）；只读面经装配注入 llm 双入口（complete 单发 + StreamFn）
 * 前置查——命中拒发 `LLM_CALL_IN_HOOK`（02 §4.1 llm 无 host 逆边——窗态必经
 * 装配注入，llm 侧收结构窄面 { inHookDispatch() }，llm 域自持本类型副本）。
 */

/** 只读窄面（llm 双入口前置查消费——结构类型，llm 域持同形副本免 DAG 边） */
export interface HookDispatchGuardFace {
  /** true = 当前调用栈在钩子派发段内（深度 > 0——嵌套钩子取「在段内」语义） */
  readonly inHookDispatch: () => boolean;
}

/** guard 本体（宿主装配根持有；enter/exit 供钩子派发包裹位成对调用） */
export interface HookDispatchGuard extends HookDispatchGuardFace {
  /** 钩子派发段开窗（与回调窗同步开——try 始、finally 终成对收口） */
  readonly enter: () => void;
  /** 钩子派发段闭窗（异常路径同经 finally 收口——深度不减穿零） */
  readonly exit: () => void;
}

/** 深度计数 guard 工厂（单实例随装配根创建——多实例各计各深度即漏跨插件嵌套） */
export function createHookDispatchGuard(): HookDispatchGuard {
  let depth = 0;
  return {
    enter: () => {
      depth += 1;
    },
    exit: () => {
      depth -= 1;
    },
    inHookDispatch: () => depth > 0,
  };
}
