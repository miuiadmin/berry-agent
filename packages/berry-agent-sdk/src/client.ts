/**
 * berry-agent-sdk/client — 类型化客户端（批 13f-3）。
 *
 * 薄层：动词方法面 → 传输 request/send/openLive 三档；错误帧在本层投形
 * {@link SdkError}（transport 原样返回、client 抛——投形单点）。请求构造
 * 全部走线协议词面（verb 判别 + 缺省填充——messageId 计数器形/since -1 哨兵），
 * 零第二套载荷形。
 */
import type { ApprovalAskAnswer } from '../../../src/contracts/approval.js';
import type { SdkErrorFrame, SdkWireFrame } from '../../../src/channels/sdk/protocol.js';

import { SdkError } from './types.js';
import type {
  SdkAckFrame,
  SdkClient,
  SdkEntriesFrame,
  SdkEntriesInput,
  SdkLiveHandle,
  SdkLiveParams,
  SdkFrameListener,
  SdkPromptInput,
  SdkSessionSummary,
  SdkTransport,
} from './types.js';

/** 错误帧投形位（error 帧抛 SdkError；其余 kind 原样透传——窄卫由调用位断言承接） */
function ensureNotError(frame: SdkWireFrame): void {
  if (frame.kind !== 'error') return;
  const err = frame as SdkErrorFrame;
  throw new SdkError(err.code, err.message, err.sessionId);
}

/**
 * 建客户端。messageId 缺省计数器形（每客户端实例独立 `sdk-N` 自增——
 * 幂等语义未申请即不虚构；跨实例幂等由调用方自选键）。
 */
export function createSdkClient(transport: SdkTransport): SdkClient {
  let unkeyedSeq = 0;

  return {
    prompt: async (input: SdkPromptInput) => {
      const messageId = input.messageId ?? `sdk-${++unkeyedSeq}`;
      const frame = await transport.request({
        verb: 'prompt',
        messageId,
        content: input.content,
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      });
      ensureNotError(frame);
      return frame as SdkAckFrame; // 应答闭集 {ack, error}——error 已投形
    },

    getEntries: async (input: SdkEntriesInput) => {
      const frame = await transport.request({
        verb: 'getEntries',
        sessionId: input.sessionId,
        since: input.since ?? -1,
      });
      ensureNotError(frame);
      return frame as SdkEntriesFrame; // 应答闭集 {entries, error}
    },

    sessions: async () => {
      const frame = await transport.request({ verb: 'sessions' });
      ensureNotError(frame);
      return (frame as { sessions: SdkSessionSummary[] }).sessions; // 应答闭集 {sessions, error}
    },

    // 无应答档（interrupt 受理经事件流可观察——写后即决；missing 会话错误帧走订阅帧面）
    interrupt: (sessionId: string) => transport.send({ verb: 'interrupt', sessionId }),

    decide: async (approvalId: string, answer: ApprovalAskAnswer, note?: string) => {
      const frame = await transport.request({
        verb: 'decide',
        approvalId,
        answer,
        ...(note !== undefined ? { note } : {}),
      });
      ensureNotError(frame);
      return (frame as { outcome: 'applied' | 'superseded' }).outcome; // 应答闭集 {decide-result, error}
    },

    subscribe: (params: SdkLiveParams, onFrame: SdkFrameListener): Promise<SdkLiveHandle> =>
      transport.openLive(params, onFrame),

    close: () => transport.close(),
  };
}
