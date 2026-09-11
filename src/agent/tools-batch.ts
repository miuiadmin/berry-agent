/**
 * agent 件 — 工具批执行器（loop 骨架的工具腿；04 §2 批语义的执法位）。
 *
 * 本件是 loop 零 try/catch 形态铁律的配套执法位：插件工具 execute 可抛错，
 * 包装在此（错误 → isError 结果数据面），loop 骨架只见结果不见异常。
 * 批语义六条：①单响应护栏两闸（04 §2——消费序前插 limiter，零改 loop
 * 骨架）：call_id 幂等（同 id 重放不重执行——批内/跨轮/重试续入三域同律，
 * 账本挂 context）+ 批调用数上限（超帽丢尾配对 isError + 计数暴露）；
 * ②读写批调度（03 §2.3 尾注——effect 一位两用）：read（含缺省）段内并发、
 * write 批边界串行（写前清空在飞只读——段序天然执法：write 前的 read 段已
 * Promise.all 排干、write 后的 read 段待其结算才起跑）；③beforeToolCall
 * block → immediate isError 结果；④terminate 批内一致裁决（批内全
 * terminate 才 terminate——单件否决不放大；回执腿/中止配对腿/丢尾腿非执行
 * 腿不否决——空真通过与批内任何真实执行腿的 false 一票即续跑，纯非执行
 * 批恒 terminate 停跑——重放循环卡死的兜底）；⑤abort 余量配对（落批中
 * 间时未执行 calls 逐个配对 isError toolResult，防下一轮孤儿 toolUse）。
 */

import { BaseError, redactSensitiveText } from '../contracts/index.js';
import type { TextContent, ToolResultMessage } from '../contracts/index.js';
import type { AgentTool, AgentToolCall, AgentToolResult, ToolUpdateCallback } from '../contracts/index.js';
import type { AgentContext, AgentLoopConfig, EmitFn } from './types.js';

/** 单响应工具批调用数上限缺省值（04 §2 闸②——帽常量可配置：AgentLoopConfig.maxToolCallsPerResponse） */
export const DEFAULT_MAX_TOOL_CALLS_PER_RESPONSE = 32;

/** 批执行结算：结果消息（与 calls 恒配对——含 block/isError/中止配对/回执/丢尾腿）+ 批内一致 terminate */
export interface ToolBatchOutcome {
  results: ToolResultMessage[];
  /** 批内全 terminate 才 true（04 §2 批内一致裁决；非执行腿〔回执/中止配对/丢尾〕不否决——空真通过：纯非执行批恒 true 停跑〔重放循环兜底〕、批内任一真实执行腿 false 即续跑） */
  terminate: boolean;
  /** 闸②丢尾计数（04 §2——被超帽丢弃的条数，非静默暴露；被丢 legs 已在 results 内逐条 isError 配对） */
  droppedCount: number;
}

/**
 * 组装一条工具结果消息（block/错误/中止配对/正常四腿共用的组装面）。
 *
 * 出口治理③ 定形③（04 §7）：错误/拒绝腿文本在此单一扼点同过模式消毒
 * （正常腿由管道链尾消毒——本位幂等不重复）。agent 侧无活值 provider
 * （值基腿只在管道），纯模式腿覆盖具名形。
 *
 * @param call 配对的 toolCall 块 @param content 文本腿 @param isError 错误标记
 * @param details 结构化明细（可选）
 */
function buildResult(call: AgentToolCall, content: string, isError: boolean, details?: unknown): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: 'text', text: redactSensitiveText(content) } satisfies TextContent],
    isError,
    timestamp: Date.now(),
    ...(details !== undefined ? { details } : {}),
  };
}

/**
 * 执行单条工具调用（含 beforeToolCall 守门、执行体替换、迟到进度丢弃、
 * execute 抛错包装、afterToolCall 字段级整体替换）。
 */
async function executeOne(
  config: AgentLoopConfig,
  context: AgentContext,
  tool: AgentTool | undefined,
  call: AgentToolCall,
  emit: EmitFn,
): Promise<{ message: ToolResultMessage; terminate: boolean }> {
  emit({ type: 'tool_execution_start', toolCallId: call.id, name: call.name, arguments: call.arguments });
  // 工具不在场：结果数据面直接回错（工具清单在 run 内静态——不可达名即配置漂移）
  if (!tool) {
    const message = buildResult(call, `工具 ${call.name} 不在本 run 工具集（配置漂移——清单与调用不同源）`, true);
    emit({ type: 'tool_execution_end', toolCallId: call.id, result: { content: message.content, isError: true } });
    return { message, terminate: false };
  }
  // 守门行安装点：block 拒因 → immediate isError 结果（不执行）
  const decision = (await config.beforeToolCall?.(call, context)) ?? {};
  if (decision.block !== undefined) {
    const message = buildResult(call, decision.block, true);
    emit({ type: 'tool_execution_end', toolCallId: call.id, result: { content: message.content, isError: true } });
    return { message, terminate: decision.terminate === true };
  }
  // 参数预处理（执行前最后一改参数的机会）
  const args = tool.prepareArguments ? await tool.prepareArguments(call.arguments) : call.arguments;
  // 迟到进度丢弃：promise 结算后 onUpdate 静默（accepting 旗——终值已落，迟到腿不重放）
  let accepting = true;
  const onUpdate: ToolUpdateCallback = (update) => {
    if (accepting) emit({ type: 'tool_execution_update', toolCallId: call.id, update });
  };
  let result: AgentToolResult;
  try {
    // 执行体替换点（测试注金样 seam）；缺省走 tool.execute（signal 协作面透传）
    result = config.toolExecution
      ? await config.toolExecution(tool, call.id, args, config.signal, onUpdate)
      : await tool.execute(call.id, args, config.signal, onUpdate);
  } catch (err) {
    // 插件工具抛错包装位（loop 零 try/catch 的配套——错误转数据面）；错误
    // 文本可能携出工具内部秘密（stderr env dump / 含 token 的 URL 报错）——
    // 同过模式消毒（出口治理③ 定形③：与 buildResult 同一出口语义）
    const text = err instanceof BaseError ? `${err.code}: ${err.message}` : String(err);
    result = {
      content: [{ type: 'text', text: redactSensitiveText(`工具 ${call.name} 执行异常：${text}`) }],
      isError: true,
    };
  } finally {
    accepting = false;
  }
  // 结果组装（一次到位：正常腿与错误腿同形——错误是数据契约之一）
  let message: ToolResultMessage = {
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: result.content,
    isError: result.isError === true,
    timestamp: Date.now(),
    ...(result.details !== undefined ? { details: result.details } : {}),
    ...(result.usage !== undefined ? { usage: result.usage } : {}),
    ...(result.addedToolNames !== undefined ? { addedToolNames: result.addedToolNames } : {}),
  };
  // 后置钩子：字段级整体替换（返回新消息替换默认组装形）
  const replaced = await config.afterToolCall?.(call, result, message, context);
  if (replaced !== undefined && replaced !== null) message = replaced as ToolResultMessage;
  emit({ type: 'tool_execution_end', toolCallId: call.id, result });
  return { message, terminate: result.terminate === true };
}

/**
 * 执行一批工具调用（单响应护栏两闸 + 读写批调度 + abort 余量配对 + 批内一致 terminate）。
 *
 * 护栏两闸（04 §2，消费序前插——零改 loop 骨架）：闸②批调用数上限——超帽
 * 丢尾（被丢 calls 逐个 isError 配对 + 计数暴露；丢尾腿不进账本——未执行
 * 条目无「既有结果」，模型重发该 id 时按新调用执行）；闸①call_id 幂等——
 * 账本（context.toolResultLedger，driver 终身单实例）与批内首现双命中均走
 * 回执腿（直接回既有结果，不重执行、不发执行活体事件、不参与 terminate
 * 表决——strix wait→check 轮询防回归锁）。
 *
 * 调度（03 §2.3 尾注——effect 一位两用的消费执法）：按原序切段——连续 read
 * 调用成一段（段内并发 Promise.all）、write 调用独立成段（单件串行屏障：
 * 写前清空在飞只读、写后 read 待其结算）。工具不在场（lookup 失败）视同
 * read 入段——executeOne 自会回配置漂移 isError，不影响调度归类。
 *
 * @param config loop 配置 @param context 运行上下文 @param calls assistant 批内全部调用
 * @param emit 活体事件发射器
 */
export async function executeToolBatch(
  config: AgentLoopConfig,
  context: AgentContext,
  calls: AgentToolCall[],
  emit: EmitFn,
): Promise<ToolBatchOutcome> {
  // 闸②批调用数上限：单响应批超帽丢尾（缺省 32；负值归 0——0 即拒全批）
  const cap = Math.max(0, config.maxToolCallsPerResponse ?? DEFAULT_MAX_TOOL_CALLS_PER_RESPONSE);
  const droppedCount = Math.max(0, calls.length - cap);
  const outcome: ToolBatchOutcome = { results: [], terminate: false, droppedCount };
  // 三分类预演（保序——结果按 calls 原序落位）：dropped = 超帽丢尾（不进调度
  // 不进账本）；replay = 账本命中或批内首现之后的同 id 重现（回执腿）；
  // dispatch = 首达执行腿
  const ledger = (context.toolResultLedger ??= new Map<string, ToolResultMessage>()); // 闸①首达建账
  const seenInBatch = new Set<string>();
  const kinds: Array<'dropped' | 'replay' | 'dispatch'> = calls.map((call, i) => {
    if (i >= cap) return 'dropped';
    if (ledger.has(call.id) || seenInBatch.has(call.id)) return 'replay';
    seenInBatch.add(call.id);
    return 'dispatch';
  });
  let allTerminate = true;
  let index = 0;
  while (index < calls.length) {
    // 段前中止检查：已中止 → 余量全部配对 isError 收口（无孤儿 toolUse；配对腿不参与 terminate 表决——与旧串行路径同律）
    if (config.signal?.aborted) {
      for (const call of calls.slice(index)) {
        outcome.results.push(buildResult(call, '工具批已被打断（run 中止——余量配对收口）', true));
      }
      outcome.terminate = calls.length > 0 && allTerminate;
      return outcome;
    }
    // 非执行腿排干（保序内联，切段）：回执腿 = 账本既有结果直接回执（拷贝重铸
    // 配对键——同 id 多块 toolUse 各得一条）；丢尾腿 = 超帽 isError 配对
    while (index < calls.length && kinds[index] !== 'dispatch') {
      const call = calls[index]!;
      if (kinds[index] === 'replay') {
        outcome.results.push(replayOf(call, ledger.get(call.id)!));
      } else {
        outcome.results.push(
          buildResult(call, `单响应工具批超上限 ${cap} 条——丢尾收口（本条未执行；请减少单次响应内的工具调用量）`, true),
        );
      }
      index++;
    }
    if (index >= calls.length) break; // 排干到尾（余量全是非执行腿——收尾）
    // 连续 read 段（effect=read 并行档——2026-09-11 审批分档批三值扩后唯一
    // 并行档；write|exec 均串行屏障。工具不在场腿留在本段〔执行期报不在场
    // 错——缺席非声明，与「在场未声明 = exec 最危」的注册面归一分立〕；
    // 非执行腿切段）
    const segment: AgentToolCall[] = [];
    while (index < calls.length && kinds[index] === 'dispatch') {
      const found = lookup(context, calls[index]!);
      // 并行仅限显式 read：write/exec（及在场未声明的最危归一形）一律出局走屏障腿
      if (found !== undefined && found.effect !== 'read') break;
      segment.push(calls[index]!);
      index++;
    }
    if (segment.length > 0) {
      // read 段内并发（03 §2.3「批内可并行调度」）；结果按 calls 原序落位（Promise.all 保序）
      const settled = await Promise.all(
        segment.map((call) => executeOne(config, context, lookup(context, call), call, emit)),
      );
      for (let i = 0; i < settled.length; i++) {
        const item = settled[i]!;
        outcome.results.push(item.message);
        ledger.set(segment[i]!.id, item.message); // 执行后入账（后续重放回执；段内 id 已去重）
        allTerminate = allTerminate && item.terminate;
      }
      continue;
    }
    // write/exec 屏障腿：单件串行（写前清空在飞只读——前 read 段已排干；
    // 屏障后 read 段待本腿结算。03 §2.3 尾注读写调度语义：write|exec 批边界
    // 串行——审批分档批三值扩同律）
    const writeCall = calls[index]!;
    index++;
    const settled = await executeOne(config, context, lookup(context, writeCall), writeCall, emit);
    outcome.results.push(settled.message);
    ledger.set(writeCall.id, settled.message); // 执行后入账（后续重放回执）
    allTerminate = allTerminate && settled.terminate;
  }
  // 空批不终止；回执腿/丢尾腿不否决（空真通过与中止配对腿同律）——纯非执行
  // 批（全回执/全丢尾）恒 terminate：停跑正是重放循环卡死的兜底（strix 病理
  // 下继续跑 = 模型每轮空转重放烧 token；批内只要有一条真实执行腿投 false
  // 即续跑）
  outcome.terminate = calls.length > 0 && allTerminate;
  return outcome;
}

/**
 * 回执腿组装（04 §2 闸①）：既有结果的回执拷贝——内容/错误位与原结果一致，
 * 配对键与工具名重铸为本次 call（回执也是配对——防孤儿 toolUse 同律）。
 * @param call 本次重放的调用块 @param cached 账本内既有结果消息
 */
function replayOf(call: AgentToolCall, cached: ToolResultMessage): ToolResultMessage {
  return { ...cached, toolCallId: call.id, toolName: call.name, timestamp: Date.now() };
}

/** 按名查工具（批内 lookup 单源） */
function lookup(context: AgentContext, call: AgentToolCall): AgentTool | undefined {
  return context.tools?.find((t) => t.name === call.name);
}
