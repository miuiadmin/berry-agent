/**
 * 会话锚 ALS 件（07 §4.3 消费腿条款档位 2——交互动词族批 ix-2 落码）。
 *
 * 命令执行窗自动锚的实现载体：AsyncLocalStorage 语境继承语义——命令派生
 * 的 fire-and-forget 尾链（Job 完成回调、定时器尾链等）保留锚，后台尾链
 * 问「原会话」零自觉正确；**两处语境遮蔽**（装载器 apply 包裹位 + 钩子派发
 * 包裹位）经 withoutSessionAnchor 显式清空——装载期（含命令触发的装载流
 * 嵌套，如 /reload）与钩子语境结构性无自动锚（规范条款的执法位）。
 *
 * 注入侧 = tui-entry dispatchCommand 闭包（命令派发时锚聚焦会话）；消费
 * 侧 = plugin-context ctx.ui 面（阻塞三件/setStatus/setWidget 的锚解析）；
 * 遮蔽侧 = loader invokeApply + plugin-context withCallbackWindow。三侧同
 * 模块（host），零拓扑新边。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** 单例存储——store 形即锚本体（sessionId 只读） */
const anchorStorage = new AsyncLocalStorage<{ readonly sessionId: string }>();

/**
 * 读 ambient 会话锚（无锚语境 = undefined——装载期/钩子期经遮蔽后恒此值）。
 * ctx.ui 锚解析的缺省源：显式 opts.sessionId 优先、缺席回落本值。
 */
export function readSessionAnchor(): string | undefined {
  return anchorStorage.getStore()?.sessionId;
}

/**
 * 以会话锚执行 fn（命令派发包裹位——tui-entry dispatchCommand 闭包）。
 * fn 同步返回值直通；async 语境跟随（fn 派生的整个异步链均见锚——
 * 「锚随异步链继承」的机制本体）。
 */
export function runWithSessionAnchor<R>(sessionId: string, fn: () => R): R {
  return anchorStorage.run({ sessionId }, fn);
}

/**
 * 清空 ambient 锚执行 fn（两处语境遮蔽——07 §4.3 档位 2 规范条款执法位）。
 * ALS.exit 语义：fn 执行段（含 async 续体）结构性无锚；fn 返回后外层
 * 语境原样恢复（fire-and-forget 尾链自起时 ambient 锚自然回来——「锚判
 * 随后自理」的边界即此）。
 */
export function withoutSessionAnchor<R>(fn: () => R): R {
  return anchorStorage.exit(fn);
}
