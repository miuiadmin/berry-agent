/**
 * AgentEvent 活体事件族契约（04 篇 §2 机制真源——内存直推、不落日志）。
 *
 * 归位注记（2026-09-08 U3 落码批）：本族类型原住 agent 件（src/agent/events.ts），
 * 为插件侧 UI 后端类型可达（03 §2.2 registerUiBackend 定形注记——虚拟主键
 * `berry-agent` 面只达 contracts）随 U3-1 归位本件；类型闭包全 contracts 侧
 * （AgentMessage/StopReason/AgentToolResult 既在本域），机制真源仍 04 §2、
 * agent 件经 re-export 维持公开面与件内消费路径不变（批 11b ApprovalAsk
 * 归位同款先例）。
 *
 * 词汇面（04 §2 E-0 扩型注——2026-09-30 UX 五问题批）：闭集翻档为**开放
 * 词汇表**（E-1 起按需扩型；词法锁随落码批钉联合成员名）。顺序铁律按形
 * 分档：**族形**（run/turn/message/tool 四族）严格 `start → update* → end`，
 * 流式 delta 与工具进度经 update 携带；**窗口事件**（retry_wait_start/
 * retry_wait_end 配对）与**非族单发事件**不受族序律约束（窗口开闭指示退避
 * 等待期可见性，不参与 run 结算）。活体流单向消费、不可逆写 durable
 * （05 篇 §7 分层不变式）——「活体呈现」与「durable 真相」两条线永不合流。
 *
 * 重试窗口两型（E-1 首批落码）：窗口开 = `retry_wait_start`（attempt 本轮
 * 将续入的序号 / maxAttempts 名额帽 / nextAt 退避结束绝对时刻——04 §2
 * 绝对时刻律：周期性信息传绝对时刻不传 tick，倒计时由消费端本地钟渲染）；
 * 窗口关 = `retry_wait_end`（resumed = 续入即新 agent_start/message 流——
 * 退避窗关发射位之外另有**孤儿第三发射形**：overflow compacted 续入腿
 * enterRun 前发〔04 §3.4 尾注——第七轮深扫批；无配对 start（该腿无退避
 * 窗）、裸形不带 attempt/maxAttempts，消费端置 retryContinuation 防续入
 * agent_start 走 fresh-run 分诊清 run 级账〕；aborted = 退避窗内被打断；
 * exhausted = 重试链燃尽/不可重试首败的终态揭示——可无配对 start，消费端
 * 据此把 agent_end(failed) 的 ⚠ 持有档翻终态红 ✗）。durable 零新词红线：
 * llm/retry 三相 log-only 维持不升格，本两型纯活体（呈现想要 ≠ 顺手落
 * durable）。
 *
 * agent_end 载荷扩（E-0 非新型）：可选 `durationMs/usage/cost` run 累计值
 * ——driver 结算账供源（A-3），可选带出形零迁移；消费端在场必用（收尾行
 * 耗时段唯一真源），缺席回退本地观察账。
 *
 * context_usage 单发型（E-4 批——V-4 底栏供数链落码批，07 §4.1 注⑪⑥b）：
 * turn 收口随发 `{usedTokens?, maxTokens?}`——usedTokens = loop 终值 usage
 * 账在窗口径（四桶全和 input+cacheRead+cacheWrite+output——与 pi-ai
 * totalTokens 同向，07 注⑪⑥(b) 勘正；归一化后 input 不含 cache 桶）；
 * maxTokens = 模型目录
 * contextWindow 经 AgentLoopConfig 注入闭包供源（agent 不 import llm
 * 铁律——宿主装配侧注入）。两字段各自可选，缺席 = 未知不显示（codex
 * 语义）；非族单发事件，族序律不涉；纯活体型不落 durable（E-1 同红线）。
 */

import type { StopReason, Usage } from './llm.js';
import type { AgentMessage } from './messages.js';
import type { AgentToolResult } from './tools.js';

/** run 终态恰三值（04 篇 §2：终态是结算边界——Job 结算、审批对收口、预算记账截断都以它为锚） */
export type RunStatus = 'completed' | 'aborted' | 'failed';

/**
 * 三通道词表（04 篇 §4）：steer = busy 注入合批 / followUp = idle 起跑 /
 * inject = dismantled 停摆后注入。发送方只声明 backgroundWake、三通道判定是
 * 驱动侧单源（conversation）——本词表只承载判定结果（活体事件字段，用户能
 * 看到消息进了哪条道）。
 */
export type DeliverChannel = 'steer' | 'followUp' | 'inject';

/**
 * AgentEvent 联合（04 §2——开放词汇表，E-1 起 12 型基线、E-4 批 13 型）。message_start/
 * message_end 携带 channel（可观测性：消息经哪条通道入列——04 §4；channel
 * 缺省 = 用户直发种子消息）。
 */
export type AgentEvent =
  | { type: 'agent_start' }
  | {
      type: 'agent_end';
      status: RunStatus;
      stopReason?: StopReason;
      errorMessage?: string;
      /** run 累计时长（毫秒——driver 结算账供源，A-3 唯一真源；缺席回退消费端本地观察账） */
      durationMs?: number;
      /** run 累计用量（driver 结算账——可选带出形零迁移） */
      usage?: Usage;
      /** run 累计货币额（driver 结算账——可选带出形零迁移） */
      cost?: { total: number; currency?: string };
    }
  | { type: 'turn_start'; turn: number }
  | { type: 'turn_end'; turn: number; stopReason: StopReason }
  | { type: 'message_start'; role: string; channel?: DeliverChannel }
  | { type: 'message_update'; role: string; partial: AgentMessage }
  | { type: 'message_end'; message: AgentMessage; channel?: DeliverChannel }
  | { type: 'tool_execution_start'; toolCallId: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_execution_update'; toolCallId: string; update: unknown }
  | { type: 'tool_execution_end'; toolCallId: string; result: AgentToolResult }
  | {
      /** 重试退避窗开（04 §2 E-1——纯活体型，durable 零新词红线） */
      type: 'retry_wait_start';
      /** 将续入的尝试序号（1 起——probe.attempt 同源） */
      attempt: number;
      /** 重试名额帽（probe.maxAttempts 同源） */
      maxAttempts: number;
      /** 退避结束绝对时刻（Unix 毫秒——04 §2 绝对时刻律，倒计时消费端本地钟渲染） */
      nextAt: number;
    }
  | {
      /**
       * 重试退避窗关（resumed=续入——退避窗关位或 overflow compacted 续入腿
       * 孤儿形〔04 §3.4 尾注，无配对 start〕/ aborted=窗内被打断 /
       * exhausted=燃尽或不可重试终态揭示——可无配对 start）
       */
      type: 'retry_wait_end';
      outcome: 'resumed' | 'aborted' | 'exhausted';
    }
  | {
      /** 上下文占用快照（04 §2 E-4 批——V-4 底栏供数链；turn 收口随发的非族单发型，纯活体不落 durable） */
      type: 'context_usage';
      /** 本 turn 收口在窗 token（loop 终值 usage 四桶全和 input+cacheRead+cacheWrite+output 在窗口径；缺席 = 未知） */
      usedTokens?: number;
      /** 模型上下文窗口（模型目录 contextWindow 经注入闭包供源；缺席 = 未知——兜底在供源侧装配闭包〔contextWindowOf——目录缺席兜底 200k〕，呈现侧零兜底直呈） */
      maxTokens?: number;
    };

/** 事件汇（消费面：TUI/SPA 活体呈现、金样录制器等；void/Promise 双形兼容） */
export type AgentEventSink = (event: AgentEvent) => void | Promise<void>;
