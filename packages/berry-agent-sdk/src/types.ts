/**
 * berry-agent-sdk/types — 客户端契约面（批 13f-3 契约先行）。
 *
 * 类型面单源（03 §10.6 批 13f 落码定形）：线协议词面自 channels 协议件
 * 相对导入 re-export、事件/审批词面自 contracts 相对导入 re-export——构建
 * 时编译入包（同仓单源、零拷贝漂移，「生成」的实质即此）。策展式点名
 * re-export（非整桶）：发布物的公共面是稳定 API，进什么出什么逐项过目。
 *
 * 传输抽象（两形态同面）：请求档〔单帧应答事务、串行〕/ 无应答档
 * 〔interrupt——stdio 写后即决、HTTP 形 204〕/ 直播档〔stdio = 线内 hello、
 * HTTP = GET /v1/events SSE——重放帧与直播帧一律入 onFrame；订阅在
 * replay-end 落定后 resolve（衔接界标即建立点）〕。
 */
import type { ApprovalAskAnswer } from '../../../src/contracts/approval.js';
import type {
  SdkAckFrame,
  SdkEntriesFrame,
  SdkRequest,
  SdkSessionSummary,
  SdkWireFrame,
} from '../../../src/channels/sdk/protocol.js';

/* ---------------- 类型面单源 re-export（策展点名） ---------------- */

/** 线事件词面（04 §2 十型——live 帧载荷） */
export type { AgentEvent } from '../../../src/agent/events.js';
/** 审批应答四值闭集（decide 动词入参） */
export type { ApprovalAskAnswer } from '../../../src/contracts/approval.js';
/** 线协议请求族（六动词——手工构造进阶位；常规用法走 client 方法面） */
export type { SdkRequest } from '../../../src/channels/sdk/protocol.js';
/** 线帧全族（kind 判别联合——onFrame 消费面 pattern-match 用） */
export type { SdkWireFrame } from '../../../src/channels/sdk/protocol.js';
/** 受理回执帧（prompt 应答——sessionId/duplicate/highWaterSeq） */
export type { SdkAckFrame } from '../../../src/channels/sdk/protocol.js';
/** durable 投影页帧（getEntries 应答） */
export type { SdkEntriesFrame } from '../../../src/channels/sdk/protocol.js';
/** 会话清单行（sessions 应答元素） */
export type { SdkSessionSummary } from '../../../src/channels/sdk/protocol.js';
/** durable 平铺事件（type/seq/time/data 四字段——重放与轮询共形） */
export type { SdkDurableEntry } from '../../../src/channels/sdk/protocol.js';
/** live 事件帧（event + seq——直播段载荷） */
export type { SdkEventFrame } from '../../../src/channels/sdk/protocol.js';
/** hello 应答帧（订阅建立序首帧——highWaterSeq 快照位） */
export type { SdkHelloFrame } from '../../../src/channels/sdk/protocol.js';
/** 错误帧（code/message——线面业务错词面） */
export type { SdkErrorFrame } from '../../../src/channels/sdk/protocol.js';
/** 线协议版本（握手常量——与主包同一源） */
export { SDK_PROTOCOL_VERSION } from '../../../src/channels/sdk/protocol.js';

/* ---------------- 客户端契约 ---------------- */

/** 业务错（线面错误帧的客户端投形——code 为 SDK_ 族/SESSION_* 线词面） */
export class SdkError extends Error {
  constructor(
    /** 线面错误码（SDK_PROTOCOL_MISMATCH / SESSION_NOT_FOUND / …） */
    readonly code: string,
    message: string,
    /** 关联会话（错误帧在场时透传——缺席 undefined） */
    readonly sessionId?: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'SdkError';
  }
}

/** 直播帧监听面（重放段〔entries/replay-end〕与直播段〔event/heartbeat/ask〕一律入此） */
export type SdkFrameListener = (frame: SdkWireFrame) => void;

/** 订阅参数（= hello 动词载荷——after = 断线续读位、noDelta = 剥 delta） */
export interface SdkLiveParams {
  readonly sessionId: string;
  /** 重放起点（已收末条 seq——窗口 (after, 高水位]；缺席 -1 从头） */
  readonly after?: number;
  /** 剥 message_update delta 帧（07 §5 --no-delta 客户端立场） */
  readonly noDelta?: boolean;
}

/** 直播订阅柄（replay-end 落定后建立——close 退订〔stdio 形线内续用不受影响〕） */
export interface SdkLiveHandle {
  readonly sessionId: string;
  /** 订阅序首帧的快照高水位（衔接界标前的 durable 水位——对账起点参考） */
  readonly highWaterSeq: number;
  /** 退订（幂等）：stdio 形仅记客户端口径〔线协议无退订动词——close 整连接即退〕、HTTP 形关 SSE 流 */
  close(): Promise<void>;
}

/**
 * 传输抽象（spawn stdio / 直连 HTTP 两实装同面）。
 *
 * 事务串行纪律：request/openLive 一次一事务（前一事务应答落定才发下一笔）
 * ——线协议无请求 id，串行化使帧归属在结构上无歧义（乱序并发进阶位不采）。
 */
export interface SdkTransport {
  /** 请求档：发一动词、取应答帧（错误帧原样返回不抛——由 client 投形 SdkError） */
  request(req: SdkRequest): Promise<SdkWireFrame>;
  /** 无应答档（interrupt——受理经事件流可观察：错误帧走 onFrame 面） */
  send(req: SdkRequest): Promise<void>;
  /** 直播档建立：重放帧与直播帧入 onFrame；replay-end 后 resolve 订阅柄 */
  openLive(params: SdkLiveParams, onFrame: SdkFrameListener): Promise<SdkLiveHandle>;
  /** 整连接收口（幂等）：stdio 形收线子进程、HTTP 形关连接池面 */
  close(): Promise<void>;
}

/** prompt 入参（messageId 缺省 = 客户端计数器形 `sdk-N` 每次全新——幂等语义未申请即不虚构） */
export interface SdkPromptInput {
  /** 续接会话句柄——缺席即新建 */
  readonly sessionId?: string;
  /** 幂等键（同键同内容重发收 duplicate 收执）——缺席计数器形全新 */
  readonly messageId?: string;
  readonly content: string;
}

/** getEntries 入参（since 缺省 -1 从头全窗） */
export interface SdkEntriesInput {
  readonly sessionId: string;
  readonly since?: number;
}

/** 类型化客户端（传输无关面——两传输同方法面消费） */
export interface SdkClient {
  /** 会话发起/续接（→ ack 应答：会话句柄 + 受理回执）；错误帧 → 抛 {@link SdkError} */
  prompt(input: SdkPromptInput): Promise<SdkAckFrame>;
  /** 断线对账读面（→ entries 页帧）；跟尽义务在调用方（nextCursor 在场即续读） */
  getEntries(input: SdkEntriesInput): Promise<SdkEntriesFrame>;
  /** 会话清单 */
  sessions(): Promise<SdkSessionSummary[]>;
  /** 打断在飞 run（无应答档——写后即决；missing 会话错误帧走订阅帧面） */
  interrupt(sessionId: string): Promise<void>;
  /** 审批应答（跨入口竞速回执——applied / superseded） */
  decide(approvalId: string, answer: ApprovalAskAnswer, note?: string): Promise<'applied' | 'superseded'>;
  /** 直播订阅（= hello 动词承载位——重放→衔接→直播；帧全量入 onFrame） */
  subscribe(params: SdkLiveParams, onFrame: SdkFrameListener): Promise<SdkLiveHandle>;
  /** 整连接收口（幂等） */
  close(): Promise<void>;
}
