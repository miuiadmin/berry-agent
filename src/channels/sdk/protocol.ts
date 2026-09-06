/**
 * SDK 线协议词汇与信封（03 篇 §10.6 线协议七原则 + 线事件词汇条——批 13a 契约先行笔）。
 *
 * 架构位（03 §10.6 件身份条）：协议核心（事件外推/请求受理/admit/seq 游标）代码位与
 * channels 通道核同体——SDK 通道后端 = UiBackend 第三后端，本件目录即其协议面；
 * stdio JSONL 传输归宿主 serve 子命令（07 §5）；HTTP+SSE 传输与 MCP server 包装归
 * core:sdk 件（src/sdk/ 随批 13e 起域）——三传输同律吃本件词汇，零第二套。
 *
 * 信封定形（03 §10.6 线事件词汇条「信封词面（`{seq, sessionId, event}` 形）随落码
 * 批定形」——本批即定形批）：活体事件帧 kind:'event' 恰携三载荷字段 {seq, sessionId,
 * event}；线控帧族与请求应答帧平铺自持各自载荷（hello/ack 必携 sessionId——03 §10.6
 * 请求面动词族条·会话生命周期段）。全部帧以顶层 `kind` 判别、全部请求以顶层 `verb`
 * 判别（NDJSON 行一级判别，编解码见 ./jsonl.ts）。
 */
import type { AgentEvent } from '../../agent/index.js';
import type { ApprovalAskAnswer, RetryProbe } from '../../contracts/index.js';

/** 线协议版本（③/⑤ 版本握手第一天就有：连接即 hello 双方携 protocolVersion 比对） */
export const SDK_PROTOCOL_VERSION = 1;

/**
 * 高水位约定（全件单源——05 §3.5 崩溃重连对账条）：**highWaterSeq = 会话日志当前
 * 长度**（= 下一将分配 seq；既存末条 seq = highWaterSeq − 1；空会话 = 0）。在此
 * 约定下两执法句自洽：调用方已收末 seq ≥ 高水位 ⇒ 尾被截（seq 复用/幻影）；
 * `after=N` ≥ 高水位 ⇒ 游标非法（声称已收不存在的事件）。
 */

/** 心跳阶段三形（② 心跳是协议义务——载荷「thinking / tool:<名>+<耗时> / retry <attempt>/<next>」定形为判别联合） */
export type SdkHeartbeatStage =
  | { type: 'thinking' }
  /** 工具执行中：工具名 + 该阶段已耗时毫秒 */
  | { type: 'tool'; name: string; stageElapsedMs: number }
  /**
   * 驱动重试续入中：probe = contracts RetryProbe（驱动 retryState 只读小面直载
   * ——attempt/nextAt/maxAttempts 单形单源）。重试进度状态源 = 驱动重试循环对
   * 通道核的只读小面（暴露 attempt/nextAt，非事件型、不进 durable——04 §2
   * 「重试续入零新事件型」），心跳载荷是该 seam 的唯一线面出口。
   */
  | { type: 'retry'; probe: RetryProbe };

// ---------------------------------------------------------------------------
// 服务端 → 调用方：线帧族（全部经 NDJSON 单帧一行外推）
// ---------------------------------------------------------------------------

/**
 * 活体事件帧（信封形 `{seq, sessionId, event}` 恰三载荷字段——03 §10.6 线事件
 * 词汇条定形）。event = 04 §2 活体十型直出（拍板③单源律——不设第二套粗粒度
 * 词汇）；message_update 线形剥累积快照只留 delta（① delta 缺省开，改造位在
 * 通道核外推腿、不改活体层事件形状——05 §3.5 第三腿），`--no-delta` 退订降
 * 流量档（07 §5）。
 *
 * **双轨律（批 13b 落码定形——立题批可抄清单 #2「delta 仅直播、Ended 可重放」
 * 同源）**：直播段 = 本帧族（AgentEvent 直出/改造形）；重放段 = durable 平铺
 * 投影（{@link SdkDurableEntry}，queryEntries 同源读面）——两段词汇按构造零
 * 重叠（durable 词 ≠ 活体十型），衔接 = 先重放（至订阅时高水位）后全量吐直播
 * 缓冲，无跨段去重面。掉帧语义：纯活体帧（message_update delta/工具进度）
 * 丢失无害——重放兜底在 durable 面（05 §3.5「累积错无立足点」）。
 */
export interface SdkEventFrame {
  kind: 'event';
  /**
   * per-session 单调 seq——**durable 水位语义**（批 13b 落码定形）：值 = 外推
   * 时刻会话内存日志长度（05 §1.1 seq = 写入时 log.length；含未落库在飞事件
   * 的内存序）。弱单调（纯活体帧间可同号）；durable 锚定帧（message_end 等——
   * durable 落账腿先于外部汇腿同步分发）恒 > 订阅重放尾。崩溃对账消费位：
   * 调用方记已收最大 seq，重连携 after 比对高水位（05 §3.5 尾截断侦测）。
   */
  seq: number;
  sessionId: string;
  event: AgentEvent;
}

/** hello 应答帧（连接受理 + 版本握手结果 + 会话高水位——崩溃对账锚） */
export interface SdkHelloFrame {
  kind: 'hello';
  /** 服务端线协议版本（与请求侧比对，不符即 SDK_PROTOCOL_MISMATCH 拒连） */
  protocolVersion: number;
  /** 订阅会话 id（请求侧未携会话订阅时 = 连接级握手缺省会话，随首个 ack 落定） */
  sessionId: string;
  /** 会话当前 seq 高水位（约定见文件头——空会话 = 0） */
  highWaterSeq: number;
}

/** 心跳帧（②——idle 超阈值即发；间隔值随落码批实测定，13b 接装配定时） */
export interface SdkHeartbeatFrame {
  kind: 'heartbeat';
  sessionId: string;
  /** run 态两值闭集（审批挂起属 run 内等待，经 ask 外推事件可观察——不发明第三态） */
  runState: 'idle' | 'running';
  /** 当前阶段（idle 态为 null） */
  stage: SdkHeartbeatStage | null;
  /** 当前 run 从启动起累计毫秒（idle 态 = 上一 run 尾值或 0） */
  elapsedMs: number;
}

/**
 * admit 回执帧（④ 幂等 admit——线控事件族四件之一）。同 messageId 同内容重发
 * = 幂等重收执（回执即既存事件本身，经 after 重放可取——不重跑）。
 */
export interface SdkAckFrame {
  kind: 'ack';
  sessionId: string;
  /** 回执所归属的调用方 messageId（受理时即落账为 data.dedupeKey——两词一字段两面） */
  messageId: string;
  /** true = 同键同内容既存重收执（幂等档）；false = 新受理 */
  duplicate: boolean;
  /**
   * 路由结果观察字段（驱动侧单源路由进 steer/followUp——04 §4 硬律：三通道判定
   * 是驱动侧单源、发送方不指定通道；观察非控制）。缺席 = 新开轮（受理时无在飞 run）。
   */
  routedChannel?: 'steer' | 'followUp';
  /** 受理时会话高水位（崩溃对账锚） */
  highWaterSeq: number;
}

/**
 * 重放游标标记帧（线控事件族四件之四——重放段与直播段的衔接界标）。
 * 直播起播 = 后续 event 帧 seq > lastReplayedSeq 首条（含未落库在飞——05 §3.5
 * 衔接序第 ③ 步；重放尾与直播首无缝衔接 = 落码回归锁位，见 ./cursor.ts）。
 */
export interface SdkReplayEndFrame {
  kind: 'replay-end';
  sessionId: string;
  /** 重放段末条 seq（空重放 = after 原值或 −1） */
  lastReplayedSeq: number;
  /**
   * 重放被分页截断时的续读游标（05 §3.4 nextCursor——帽 10000；重放腿必须跟尽，
   * 跟尽义务在调用方：单页即止 = 截断不报错，系调用方违约协议不补发）。
   * 缺席 = 重放已跟尽。
   */
  nextCursor?: string;
}

/**
 * 结构化错误帧（⑥ 结构化错误单源：code 直出 contracts 错误码注册表一一对应，
 * 不发明第二套）。willRetry 系**错误事件载荷位**非新事件型；retryAfterMs 系
 * `SDK_OVERLOADED` 专属载荷（⑦ 背压——codex -32001 形）。
 */
export interface SdkErrorFrame {
  kind: 'error';
  /** 关联会话（连接级错误缺席——版本握手拒连等） */
  sessionId?: string;
  code: string;
  message: string;
  /** 可重试位（错误事件载荷位——重试期不打断事件流，进度并入心跳载荷） */
  willRetry?: boolean;
  /** SDK_OVERLOADED 携带：建议重试等待毫秒 */
  retryAfterMs?: number;
}

/**
 * durable 事件线面平铺投影形（重放/getEntries 载荷——批 13b 落码定形）。
 * 05 §1.1 durable 事件信封的线面投影：{type, seq, time, data} 平铺直出
 * （queryEntries 同源读面——05 §3.5 第一腿「服务端实现即 queryEvents 同源
 * 读面，无第二查询机制」）；type 词汇 = durable 十五型（线面透传不二校验——
 * 词汇注册表单源在 session 侧）。双轨律见 {@link SdkEventFrame} 文注——
 * 本形只走重放/对账段，永不走直播段。
 */
export interface SdkDurableEntry {
  /** durable 事件类型（05 §1.1 词汇——`user/message` 式） */
  type: string;
  /** per-session 单调 seq（= 写入时 log.length——重放游标/对账锚） */
  seq: number;
  /** Unix 毫秒时间戳 */
  time: number;
  /** 事件载荷（frozen 投影——预算刀裁后形） */
  data: unknown;
}

/** getEntries 应答帧——断线对账读面（服务端实现即 queryEvents 同源读面，05 §3.5 第一腿） */
export interface SdkEntriesFrame {
  kind: 'entries';
  sessionId: string;
  /** (since, 高水位] 窗口内 durable 事件（重放源 = 会话内存日志——含未落库在飞，装配桥接） */
  entries: SdkDurableEntry[];
  /** 分页续读游标（05 §3.4——缺席 = 已跟尽） */
  nextCursor?: string;
}

/** sessions 应答帧——会话清单（与 webui §10.4 会话族端点同读面，词面本批定形） */
export interface SdkSessionsFrame {
  kind: 'sessions';
  sessions: SdkSessionSummary[];
}

/** 会话清单条目（id/标题/末活动时间——03 §10.6 请求面动词族条 sessions 词面定形） */
export interface SdkSessionSummary {
  id: string;
  /** 无标题会话为 null（不造占位串） */
  title: string | null;
  /** 末活动时间 epoch 毫秒 */
  lastActivityAt: number;
}

/** decide 应答帧——跨入口审批竞速回执（03 §10.6 审批外推第三腿） */
export interface SdkDecideResultFrame {
  kind: 'decide-result';
  /** 所应答审批标识（与 ask 外推事件载荷同词同源——contracts ApprovalAskRequest.approvalId） */
  approvalId: string;
  /** applied = 本应答先 settle 胜出；superseded = 已被他入口应答（幂等回执——TUI/web/SDK 三入口同漏斗） */
  outcome: 'applied' | 'superseded';
}

/**
 * 审批 ask 外推帧（03 §10.6 审批外推第三腿：「serve/SDK 面审批 = ask 外推
 * （线事件）+ decide 请求应答——汇入 10.4 跨入口审批同一 pending Promise
 * 竞速」）。审批是挂起态非活体流——独立帧族（不入 SDK_FRAME_KINDS 的 event
 * 位、不占 seq、不进 durable）；重连补推：hello 订阅受理后未决 ask 全量重推
 * （decide 的应答面才不断线）。approvalId 由 SDK 后端指派（contracts
 * ApprovalAskRequest.approvalId 缺席时补一——挂起身份短形，多连接防串答）。
 */
export interface SdkAskFrame {
  kind: 'ask';
  sessionId: string;
  /** 挂起审批身份（decide 请求以此应答——同词同源） */
  approvalId: string;
  /** 目标动作摘要（人可读一行） */
  summary: string;
  /** 请求方/理由（可选呈现） */
  reason?: string;
  /** 发起审批的工具名（可选呈现） */
  toolName?: string;
  /** 「始终允许」草案条目（always 应答的 allowlist 回写目标——缺席 = always 视同 approve） */
  suggestedEntry?: string;
}

/** 服务端 → 调用方线帧全族（判别字段 `kind`；闭集见 {@link SDK_FRAME_KINDS}） */
export type SdkWireFrame =
  | SdkEventFrame
  | SdkHelloFrame
  | SdkHeartbeatFrame
  | SdkAckFrame
  | SdkReplayEndFrame
  | SdkErrorFrame
  | SdkEntriesFrame
  | SdkSessionsFrame
  | SdkDecideResultFrame
  | SdkAskFrame;

/**
 * 线帧 kind 闭集（十：活体事件帧 + 线控四件〔hello/heartbeat/ack/replay-end〕+
 * 请求应答三件〔entries/sessions/decide-result〕+ 错误帧 + ask 审批外推帧——
 * ask 独立于 event 位，审批挂起态非活体流，见 {@link SdkAskFrame} 文注）。
 */
export const SDK_FRAME_KINDS = [
  'event',
  'hello',
  'heartbeat',
  'ack',
  'replay-end',
  'error',
  'entries',
  'sessions',
  'decide-result',
  'ask',
] as const;

// ---------------------------------------------------------------------------
// 调用方 → 服务端：请求面六动词族（收窄律——v1 六动词，三通道词不出现在请求面）
// ---------------------------------------------------------------------------

/**
 * hello 请求（握手动词）。sessionId 携带 = 续接并订阅该会话事件流（携 after 先
 * 重放后直播）；缺席 = 连接级握手（后续 prompt 按各自 sessionId 路由——stdio 单
 * 连接内复用 N 会话，07 §5 serve 细则④）。after 缺席 = 只直播不重放。
 */
export interface SdkHelloRequest {
  verb: 'hello';
  protocolVersion: number;
  sessionId?: string;
  /** 订阅游标：重放窗口 = (after, 订阅时高水位]；合法性见 ./cursor.ts */
  after?: number;
  /**
   * 退订 message_update delta（`--no-delta` 线面承载位——07 §5 serve 细则：
   * 降流量档；durable 定稿事件不受影响——只剥直播 delta 流）。受理后本连接
   * 不再外推 message_update 帧（Ended 帧/重放面照常）。
   */
  noDelta?: boolean;
}

/**
 * prompt 请求（新发——携 messageId 幂等键）。**prompt 单入口、调用方不选通道**：
 * 会话内在飞 run 时的并发 prompt 由驱动侧单源路由进 steer/followUp（04 §4 硬律），
 * 路由结果随 ack 观察字段回示；三通道词 steer/followUp/inject 不出现在请求面。
 * sessionId 缺席即新建会话（ack 与事件信封必携 sessionId——调用方以首应答获
 * 会话句柄）；显式携带即续接；命中已闭会话回结构化错误（对齐 webui 已闭 404 语义）。
 */
export interface SdkPromptRequest {
  verb: 'prompt';
  /** 调用方自选幂等键——受理时即落账为 data.dedupeKey（05 §3.5 两词一字段两面） */
  messageId: string;
  content: string;
  sessionId?: string;
}

/** interrupt 请求（受理经事件流可观察：turn/end reason='interrupted'；心跳转 idle） */
export interface SdkInterruptRequest {
  verb: 'interrupt';
  sessionId: string;
}

/**
 * decide 请求（审批应答——汇入 10.4 跨入口审批同一 pending Promise 竞速：先
 * settle 者胜、后到 superseded 幂等回执）。answer 值域 = contracts
 * ApprovalAskAnswer 四值闭集（approve/reject/cancel/always——与 TUI/web 入口
 * 同一 settle 值域，跨入口竞速语义才闭合）；approvalId 与 ask 外推事件载荷
 * 同词同源（contracts ApprovalAskRequest.approvalId）。
 */
export interface SdkDecideRequest {
  verb: 'decide';
  approvalId: string;
  answer: ApprovalAskAnswer;
  /** 应答附注（进审批审计面，可选） */
  note?: string;
}

/** getEntries 请求（断线对账——since 语义同 hello.after：窗口 (since, 高水位]） */
export interface SdkGetEntriesRequest {
  verb: 'getEntries';
  sessionId: string;
  since: number;
  /** 分页续读游标（首轮缺席；跟尽义务在调用方） */
  cursor?: string;
}

/** sessions 请求（会话清单——id/标题/末活动时间） */
export interface SdkSessionsRequest {
  verb: 'sessions';
}

/** 调用方请求全族（判别字段 `verb`；闭集见 {@link SDK_REQUEST_VERBS}） */
export type SdkRequest =
  | SdkHelloRequest
  | SdkPromptRequest
  | SdkInterruptRequest
  | SdkDecideRequest
  | SdkGetEntriesRequest
  | SdkSessionsRequest;

/**
 * 请求动词六件闭集（03 §10.6 请求面动词族条——v1 收窄律；steer/followUp/inject
 * 三通道词**不在场**是执法位：驱动侧单源律的结构锁，测试断言在册）。
 */
export const SDK_REQUEST_VERBS = ['hello', 'prompt', 'interrupt', 'decide', 'getEntries', 'sessions'] as const;
