/**
 * host/subagent-factory — in-process 真工厂（批 19c-1 装载态兑现）。
 *
 * 每子代理独立装配全套（04 §10：自己的 loop/scope/工具面/凭证——运行期无
 * 「我是谁派来的」识别）：经 ConversationStack 的 SessionManager 新开会话
 * （origin 'delegation'），per-session 装配覆盖四通道全用上——
 *  - shapeTools：派生工具面整形（工厂侧执法——bash 恒弃、fs 四名恒留
 *    〔子自建结构性〕、白名单滤余；service 已算 effectiveTools 交集，此处
 *    以其为白名单重放）；
 *  - askApproval：审批型升权路由（委派边界①——子会话 ask 落父会话审批面
 *    channels 队列；background 形先发 notifyApproval 挂起通知）；
 *  - systemPrompt/model：def 直传纯内存覆盖。
 *
 * 黑盒收口：submit 起跑 → RunResult→SubagentResult 映射（completed→stop/
 * aborted→aborted/failed→error+diagnostic）→ finally dismantle（终态停摆——
 * 子会话 durable 面不受影响，log 仍可查；活体登记回收挂账）。
 */
import type {
  AgentTool,
  ApprovalAskRequest,
  SubagentProvider,
  SubagentRequest,
  SubagentResult,
} from '../contracts/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { EXCLUDED_FROM_DERIVED_SURFACE, IN_PROCESS_CAPABILITIES } from '../subagent/index.js';

import type { ConversationStack } from './conversation-stack.js';

/** 派生面结构性恒留名（fs 四名——子自建结构性；bash 恒弃另列） */
const STRUCTURALLY_KEPT = new Set(EXCLUDED_FROM_DERIVED_SURFACE.filter((name) => name !== 'bash'));

/**
 * 委派会话登记表（boot 全局层工具的执行时语境真源）：childSessionId →
 * 委派深度。根会话缺席（depthOf → undefined → 工具侧兜底 1）。run 终态
 * release（防进程级 Map 无界增长——子会话活体登记回收另挂账）。
 */
export interface DelegationSessionTracker {
  record(sessionId: string, depth: number): void;
  depthOf(sessionId: string): number | undefined;
  release(sessionId: string): void;
}

/** 委派会话登记表工厂（装配根自持单例） */
export function createDelegationSessionTracker(): DelegationSessionTracker {
  const depths = new Map<string, number>();
  return {
    record(sessionId, depth) {
      depths.set(sessionId, depth);
    },
    depthOf(sessionId) {
      return depths.get(sessionId);
    },
    release(sessionId) {
      depths.delete(sessionId);
    },
  };
}

/**
 * 派生面整形器（工厂侧执法律）：bash 恒弃（永不升格总则特例——子管道无
 * 人在场应答 def 内部升权）；fs 四名恒留（子自建结构性——白名单不含亦在，
 * 与 deriveToolSurface 剔除语义互补：那层剔父名集、这层整子实面）；其余
 * 按白名单滤（白名单缺省 = 全留——service 交集已在 availableTools 在场
 * 时算过，缺席透传形此处亦透传）。
 */
export function shapeDerivedTools(
  whitelist: readonly string[] | undefined,
): (tools: readonly AgentTool[]) => readonly AgentTool[] {
  const allow = whitelist !== undefined ? new Set(whitelist) : undefined;
  return (tools) =>
    tools.filter((tool) => {
      if (tool.name === 'bash') return false;
      if (STRUCTURALLY_KEPT.has(tool.name)) return true;
      return allow === undefined || allow.has(tool.name);
    });
}

/**
 * 尾扫末条 assistant 消息文本（黑盒输出面——子会话事件流的最后一条
 * assistant/message 的 text 块拼接；缺席 = 空串诚实回执）。
 */
function lastAssistantText(events: readonly { type: string; data?: unknown }[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event === undefined || event.type !== 'assistant/message') continue;
    const blocks = (event.data as { content?: readonly { type: string; text?: string }[] } | undefined)?.content;
    if (!Array.isArray(blocks)) return '';
    return blocks
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
  return '';
}

/** RunResult 终态 → SubagentStopReason 映射（completed→stop/aborted→aborted/failed→error） */
function stopReasonOf(status: string): SubagentResult['stopReason'] {
  if (status === 'completed') return 'stop';
  if (status === 'failed') return 'error';
  return 'aborted';
}

/** in-process 工厂构造面 */
export interface InProcessSubagentProviderOptions {
  readonly stack: ConversationStack;
  /** 委派深度登记表（sessionContext 解析真源——装配根自持） */
  readonly tracker: DelegationSessionTracker;
  readonly warn: (message: string) => void;
  /**
   * 总预算 reserve 线越线判定（04 §5——非交互子代理 90% 线强停，留余量给
   * 主循环写终态：子代理先耗尽则父终态写不出，实证失败模式）：真身 = 装配根
   * 闭包 llm.backgroundUsage().ratio ≥ SUBAGENT_RESERVE_THRESHOLD；执法位 =
   * 起跑前（已越线不起跑直接回执）+ 在飞期轮询（越线协作中止）。缺省 =
   * 不执法（测试替身/lib 形——预警软着陆层另走 driver 注入位与本腿分立）。
   */
  readonly reserveBreached?: () => boolean;
}

/**
 * in-process 子代理 provider（真工厂——SubagentProvider 契约的本体实装）。
 * capabilities 五布尔恒真（IN_PROCESS_CAPABILITIES 单源）。
 */
export function createInProcessSubagentProvider(options: InProcessSubagentProviderOptions): SubagentProvider {
  const { stack, tracker, warn } = options;
  return {
    capabilities: IN_PROCESS_CAPABILITIES,
    async run(request: SubagentRequest): Promise<SubagentResult> {
      // reserve 线起跑前执法（04 §5——总预算 90% 已越线则不起跑）：诚实回执
      // aborted + diagnostic，不建会话不耗预算——余量留给主循环写终态
      if (options.reserveBreached?.() === true) {
        return {
          output: '',
          stopReason: 'aborted',
          diagnostic: '后台预算已达 90% reserve 线——子代理不起跑，余量留给主循环写终态（04 §5）',
        };
      }
      // service 已在 request.tools 位算好 effectiveTools（availableTools 在场
      // = 派生面∩白名单交集；缺席 = 透传白名单）——整形器以之为准
      const whitelist = request.tools;
      // 委派边界①：审批型升权路由——子会话 ask 落父会话审批面（ownership
      // 织入注释的执法位：恰一键 {sessionId: 父}——子代理在父会话内发起的
      // 审批落回父会话呈现面）。background 形先发挂起通知（恰一条幂等由
      // 父 driver dedupeKey 面执法；one-shot 不发——挂着等待即知情）。
      const parentSessionId = request.parentSessionId;
      const askApproval =
        parentSessionId !== undefined
          ? async (req: ApprovalAskRequest, opts?: { signal?: AbortSignal }) => {
              if (request.background === true && request.notifyApproval !== undefined && req.approvalId !== undefined) {
                try {
                  await request.notifyApproval({
                    approvalId: req.approvalId,
                    toolName: req.toolName ?? request.name ?? '未知工具',
                    ...(req.reason !== undefined ? { reason: req.reason } : {}),
                  });
                } catch (err) {
                  warn(`审批挂起通知失败（不阻断 ask 本体）：${err instanceof Error ? err.message : String(err)}`);
                }
              }
              return stack.channels.askApproval(parentSessionId, req, opts);
            }
          : undefined;
      // 子会话装配（真工厂核心）：origin 'delegation' durable 归因；model/
      // systemPrompt def 直传；shapeTools 派生面整形；askApproval 升父面。
      const child = stack.manager.create({
        origin: 'delegation',
        workspaceRoot: canonicalWorkspaceRoot(),
        ...(request.name !== undefined ? { title: request.name } : {}),
        ...(request.model !== undefined ? { model: request.model } : {}),
        ...(request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {}),
        shapeTools: shapeDerivedTools(whitelist),
        ...(askApproval !== undefined ? { askApproval } : {}),
      });
      const driver = child.driver;
      tracker.record(child.sessionId, request.depth ?? 1);
      // 协作停止桥（只 background 形注入——one-shot 父同步等无停止位）：
      // JobHandle 置 stopping → 轮询观察 → abort 子 run；reserve 线观察
      // （04 §5——非交互子代理 90% 线强停）同轮合流：越线 → abort + 记因
      //（回执 diagnostic 归因预算而非泛 aborted）
      let reserveStopped = false;
      const observeStop = request.stopRequested;
      const observeReserve = options.reserveBreached;
      let timer: ReturnType<typeof setInterval> | undefined;
      if (observeStop !== undefined || observeReserve !== undefined) {
        timer = setInterval(() => {
          if (observeStop !== undefined && observeStop()) {
            driver.abort();
            return;
          }
          if (observeReserve !== undefined && observeReserve()) {
            reserveStopped = true;
            driver.abort();
          }
        }, 500);
        timer.unref();
      }
      try {
        // 子 prompt 提交：source 缺省 'user'（父即子的用户；origin
        // 'delegation' 在会话行是 durable 归因——EventSource 闭集无该词）
        const outcome = await driver.submit(request.prompt);
        const output = lastAssistantText(driver.session.events());
        if (outcome.status === 'injected' || outcome.status === 'wake-refused') {
          // 理论不达防御位（新会话无停摆/无唤醒件）——诚实回执不伪装完成
          return {
            output,
            stopReason: 'aborted',
            diagnostic: `子会话提交未起跑（${outcome.status}）`,
          };
        }
        return {
          output,
          stopReason: stopReasonOf(outcome.status),
          ...(reserveStopped && outcome.status === 'aborted'
            ? { diagnostic: '后台预算达 90% reserve 线——子代理强停，余量留给主循环写终态（04 §5）' }
            : {}),
          ...(outcome.status === 'failed' && outcome.errorMessage !== undefined
            ? { diagnostic: outcome.errorMessage }
            : {}),
        };
      } finally {
        if (timer !== undefined) clearInterval(timer);
        tracker.release(child.sessionId);
        driver.dismantle(); // 终态停摆（后续投递转 inject——durable 面不受影响）
      }
    },
  };
}
