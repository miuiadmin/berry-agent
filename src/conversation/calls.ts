/**
 * 模型调用台账折叠（07 §4.1 B3 定形注——`/calls` 副屏数据源）：SessionEvent
 * 流 → 调用明细行（尾窗帽 50）。纯函数（foldSessionUsage 姊妹件——呈现投影
 * 归约，durable 第二读面：零新表零新词，每次从事件重放；进程内存 ring 形
 * 已否决——丢重启历史 + 丢单发路 + 需新订阅面三失在案）。
 *
 * 行两类（B3 定形注「行集两类」）：
 * - **主对话轮行**（源 = assistant/message 事件，含被遮蔽 retry 形——遮蔽是
 *   呈现层概念、token 已真实花费，口径与 /usage 同源）；重试注记 = 紧随
 *   llm/retry(phase=scheduled) 的 attempt/maxAttempts 配对——行 attempt 序号
 *   自前位 llm/retry 推继（attempt+1）、缺省 1；注记一行一消费、新轮种子
 *   （user/message）复位（防越轮污染）；
 * - **单发路行**（源 = 归因本会话的 llm/usage 事件——compaction/memory/goal/
 *   probe 等归因调用位，枚举非穷尽：complete 路 callId 为裸 UUID、probe 族
 *   `probe:` 前缀、未来调用位可携任意 `xxx:` 前缀——一律宽容入册，归因 =
 *   冒号前段透传）。
 *
 * 桥接行去重律：run 路桥接 llm/usage 条目（callId `run:` 前缀形）不入册——
 * 同一调用已有 assistant/message 行（05 §1.1「桥接投影非第二真源」），入册
 * 即双计。
 *
 * 耗时诚实缺席律：主对话路 durable 无 per-request 耗时位（agent_end.durationMs
 * 系 run 级不冒充）——主对话行 elapsedMs 不带；单发路 elapsedMs 在场必带
 * （complete 路 = 全调用耗时含重试）。
 */
import type { SessionEvent } from '../contracts/index.js';

/** 台账尾窗帽（B3 定值 50——ZCode 三档 200/100/8 取中量级折半；呈现截断披露同值） */
export const CALL_LEDGER_LIMIT = 50;

/**
 * 主对话行状态词键（= StopReason 闭集五终值原样透传——数据层零翻译，用户面
 * 词「完成/调工具/截断/失败/中止」归呈现层分档映射）。
 */
export type CallLogStatus = 'stop' | 'toolUse' | 'length' | 'error' | 'aborted';

/** 台账行（两路同型——source 判别；字段缺席 = durable 无此事实，呈现诚实缺席） */
export interface CallLogEntry {
  /** 行来源：conversation = 主对话轮行；oneshot = 单发路行 */
  readonly source: 'conversation' | 'oneshot';
  /** 时刻（信封 time 毫秒） */
  readonly time: number;
  /** 信封 seq（两路行并序锚） */
  readonly seq: number;
  /** 模型（provider+model 响应实录全形；实录缺席不带——不冒充请求标识） */
  readonly model?: string;
  /** 状态（主路 = stopReason 五终值透传；单发路 = 'stop'——llm/usage 只在成功路落账） */
  readonly status?: CallLogStatus;
  /** 失败短因（stopReason=error 携带——失败行呈现位） */
  readonly errorMessage?: string;
  /** 尝试序号（前位 llm/retry(scheduled) 推继 attempt+1；缺省 1 = 首试） */
  readonly attempt: number;
  /** 重试帽（配对 llm/retry 的 maxAttempts 在场才带） */
  readonly maxAttempts?: number;
  /** tokens（主路 = usage.totalTokens 累计口径含缓存桶；单发路 = 四桶合计——totalTokens 不入账） */
  readonly tokens?: number;
  /** 耗时毫秒（单发路在场必带；主路 durable 无 per-request 位——诚实缺席不带） */
  readonly elapsedMs?: number;
  /** 归因前缀（单发路 callId 冒号前段——probe 等调用位枚举非穷尽宽容透传；run: 桥接已去重） */
  readonly attribution?: string;
}

/** 台账折叠产物：尾窗行集 + 全量计数（截断披露位——超帽行「N 条（仅显示最近 50）」） */
export interface CallLedger {
  /** 尾窗帽 CALL_LEDGER_LIMIT 行（seq 升序——呈现层自定新旧序） */
  readonly entries: readonly CallLogEntry[];
  /** 全量行数（截断披露真源；帽内恒 = entries.length） */
  readonly total: number;
}

/** stopReason 五终值闭集（宽容解码判据——pending/deferred/未知值不虚构档） */
const KNOWN_STATUS: ReadonlySet<string> = new Set(['stop', 'toolUse', 'length', 'error', 'aborted']);

/** 载荷对象窄化（防御位——data 是 unknown，null/非对象归缺席形不炸） */
function asRecord(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
}

/** 数值字段取值（宽容解码——非 number 归 undefined） */
function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * 折叠会话事件流为调用台账（单遍扫描——两路行 seq 自然并序）。纯函数：
 * 同一事件流恒得同一台账（无时钟无随机）；每次开屏现读重放（快照档语义）。
 */
export function foldCallLedger(events: readonly SessionEvent[]): CallLedger {
  const all: CallLogEntry[] = [];
  /** 前位重试注记（llm/retry(scheduled) 待配对态——assistant 行消费即清） */
  let pending: { attempt: number; maxAttempts: number | undefined } | undefined;
  for (const event of events) {
    // 新轮种子复位：前位注记不得越轮污染（retry 配对域 = 同一调用链）
    if (event.type === 'user/message') {
      pending = undefined;
      continue;
    }
    if (event.type === 'llm/retry') {
      const data = asRecord(event.data);
      const attempt = num(data?.attempt);
      if (attempt === undefined) continue; // 坏形防御位——不立注记不炸
      if (data?.phase === 'scheduled') {
        // scheduled = 有续入（该 attempt 重试即将起跑）——下一 assistant 行的序号来源
        pending = { attempt, maxAttempts: num(data.maxAttempts) };
      } else {
        // aborted/exhausted = 收口相（无续入行可配对）——清注记防陈化
        pending = undefined;
      }
      continue;
    }
    if (event.type === 'assistant/message') {
      const data = asRecord(event.data) ?? {};
      const provider = typeof data.provider === 'string' ? data.provider : undefined;
      const model = typeof data.model === 'string' ? data.model : undefined;
      const stopReason = typeof data.stopReason === 'string' ? data.stopReason : undefined;
      const usage = asRecord(data.usage);
      all.push({
        source: 'conversation',
        time: event.time,
        seq: event.seq,
        // 实录全形：provider+model 双在场拼 'provider/model'（ledgerModelOf 同形
        // ——半形不拼）；双缺席诚实不带（请求标识不在 durable 载荷，不冒充）
        ...(provider !== undefined && model !== undefined
          ? { model: `${provider}/${model}` }
          : model !== undefined
            ? { model }
            : {}),
        ...(stopReason !== undefined && KNOWN_STATUS.has(stopReason) ? { status: stopReason as CallLogStatus } : {}),
        ...(typeof data.errorMessage === 'string' ? { errorMessage: data.errorMessage } : {}),
        // 尝试序号推继：前位 scheduled attempt N = 本行是第 N+1 试；缺省 1
        attempt: pending === undefined ? 1 : pending.attempt + 1,
        ...(pending?.maxAttempts !== undefined ? { maxAttempts: pending.maxAttempts } : {}),
        // tokens 累计口径 = usage.totalTokens（含缓存桶——message.usage 报数原样）
        ...(num(usage?.totalTokens) !== undefined ? { tokens: num(usage?.totalTokens) } : {}),
      });
      pending = undefined; // 配对一行一消费（续轮/新调用回缺省 1）
      continue;
    }
    if (event.type === 'llm/usage') {
      const data = asRecord(event.data) ?? {};
      const callId = typeof data.callId === 'string' ? data.callId : '';
      // 桥接行去重律：run: 前缀 = run 路桥接投影（同一调用已有 assistant 行）
      if (callId.startsWith('run:')) continue;
      const usage = asRecord(data.usage);
      const bucket = [num(usage?.input), num(usage?.output), num(usage?.cacheRead), num(usage?.cacheWrite)] as const;
      const tokens =
        bucket[0] !== undefined && bucket[1] !== undefined && bucket[2] !== undefined && bucket[3] !== undefined
          ? bucket[0]! + bucket[1]! + bucket[2]! + bucket[3]! // 四桶合计（totalTokens 不入账）
          : undefined;
      const model = typeof data.model === 'string' ? data.model : undefined;
      const elapsedMs = num(data.elapsedMs);
      // 归因前缀 = callId 冒号前段（probe 等调用位枚举非穷尽宽容透传；裸 UUID 无前缀不带）
      const colon = callId.indexOf(':');
      const attribution = colon > 0 ? callId.slice(0, colon) : undefined;
      all.push({
        source: 'oneshot',
        time: event.time,
        seq: event.seq,
        ...(model !== undefined ? { model } : {}),
        // llm/usage 只在成功路落账（complete 错误终态上抛不达计量 seam）——完成定档
        status: 'stop',
        attempt: 1,
        ...(tokens !== undefined ? { tokens } : {}),
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
        ...(attribution !== undefined ? { attribution } : {}),
      });
    }
  }
  // 尾窗帽：丢最旧、保最新 CALL_LEDGER_LIMIT 行；total 全量计数（截断披露真源）
  const entries = all.length > CALL_LEDGER_LIMIT ? all.slice(all.length - CALL_LEDGER_LIMIT) : all;
  return { entries, total: all.length };
}
