/**
 * checkpoint 守门监听器（05 §5.3 批 15d——pre-mutation 捕获触发位）。
 *
 * 触发判据（插件钩子正门 03 §2.4——tools_pre_execute waterfall 监听者，
 * 不私开管道接缝）：
 *   1. effect === 'write'（契约既有字段——零名单新面）；
 *   2. 载荷带 sessionId 且会话语境可解（无会话 = 非本件域，静默放行）；
 *   3. 会话无 workspaceRoot 锚 = 放行 + warn（配置缺口非仓故障两分——
 *      特性不适用位不放行会拦掉全部无锚会话的写工具）；
 *   4. **per-run 一 manifest**：会话末闭合边界（lastClosedBoundary）较上次
 *      捕获推进才拍——同 run 段边界不动不重拍；turn 闭合后新 run 首变异
 *      触发新拍。判据以 durable 日志为真源（SessionContextFace），无装配
 *      遗忘风险。
 *
 * 失败语义（fail-closed）：捕获抛错 = 置 outcome block（reason 首缀
 * CHECKPOINT_CAPTURE_FAILED）不调 next 短路——拍不了就放行变异 = 伪承诺。
 * 监听器自身不抛（抛 = TOOL_GATE_FAILED 会混淆码面——本件有专属码）。
 *
 * 装配位：safety 守门行占首位，本行挂其后（safety block 在先 = 不触发幻拍；
 * 下游 block 后已拍的快照无害——状态未变仍有效）。host 装配根接线：
 * dispatch.onWaterfall(TOOL_PRE_EXECUTE_EVENT, createCheckpointGate(deps))。
 */
import type { GateInput } from '../contracts/index.js';
import type { CaptureFn } from './capture.js';
import type { CheckpointGateDeps } from './types.js';

/** 守门监听器形态（与 EventDispatch.onWaterfall 载荷形结构同构——不 import context，纯结构面） */
export type CheckpointGateListener = (
  input: GateInput,
  next: (value: GateInput) => Promise<GateInput>,
) => Promise<GateInput>;

/**
 * 组装守门监听器（工厂——监听器闭包内持 per-session 边界游标 Map，跨调用
 * 存活；同一 dispatch 生命周期内复用一个实例，重复挂载 = 各自独立游标）。
 */
export function createCheckpointGate(deps: CheckpointGateDeps): CheckpointGateListener {
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  // per-session 上次捕获边界（per-run 判据的游标——turn 在飞边界不动即同 run）
  const lastCapturedBoundary = new Map<string, number>();

  return async (input, next) => {
    // 判据 1：只管写意图（read 工具不触发快照——03 §2.3 effect 面）
    if (input.tool.effect !== 'write') return next(input);
    // 判据 2：无会话键 = 非本件域（测试/系统调用形态——静默放行）
    const sessionId = input.sessionId;
    if (sessionId === undefined) return next(input);
    // 判据 2b：会话语境不可解（contextOf undefined）同上放行——不 warn
    // （会话未知是装配面事实，非配置缺口；两分见判据 3）
    const ctx = deps.session.contextOf(sessionId);
    if (ctx === undefined) return next(input);
    // 判据 3：无 workspaceRoot 锚 = 配置缺口——放行 + warn（非仓故障）
    if (ctx.workspaceRoot === '') {
      warn(
        `[checkpoint] 会话 ${sessionId} 无工作区锚——快照不适用，写工具放行（配置缺口：会话建时未带 workspaceRoot）。`,
      );
      return next(input);
    }
    // 判据 4：边界未推进 = 同 run 段——不重拍（per-run 一 manifest）
    const boundary = ctx.lastClosedBoundary;
    const last = lastCapturedBoundary.get(sessionId);
    if (last !== undefined && boundary <= last) return next(input);

    // 捕获（mutation 拍）：失败折 fail-closed block——reason 首缀专属码
    try {
      await deps.capture({ sessionId, boundarySeq: boundary, workspaceRoot: ctx.workspaceRoot, trigger: 'mutation' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      input.outcome = {
        action: 'block',
        reason: `[CHECKPOINT_CAPTURE_FAILED] pre-mutation 快照失败，fail-closed 拒变异（快照是回退承诺的前提）：${message}`,
      };
      return input; // 不调 next：短路整链（守门段 block 语义）
    }
    // 成功：推进游标（后续同 run 写工具不再重拍）+ 放行交棒
    lastCapturedBoundary.set(sessionId, boundary);
    return next(input);
  };
}

/** 依赖注入面重导出（CaptureFn 即 capture.ts 产物型——装配根单点见型） */
export type { CaptureFn };
export type { CheckpointGateDeps };
