/**
 * berry-agent-sdk —— 类型化 SDK 客户端公共面（批 13f-3）。
 *
 * 两传输同面：spawn serve stdio（子进程托管形）与直连 HTTP（daemon sock /
 * 前台 TCP 形）；client 方法面传输无关。类型面自仓单源策展 re-export——
 * 进什么出什么逐项过目（见 ./types.ts）。
 *
 * 用法骨架：
 * ```ts
 * import { createSdkClient, spawnServeTransport } from 'berry-agent-sdk';
 * const transport = spawnServeTransport({ args: ['<主包>/dist/host/main.js', 'serve'] });
 * const client = createSdkClient(transport);
 * const ack = await client.prompt({ content: '你好' });
 * const handle = await client.subscribe({ sessionId: ack.sessionId }, (frame) => { … });
 * await client.close();
 * ```
 */
export { SdkError, SDK_PROTOCOL_VERSION } from './types.js';
export type {
  SdkFrameListener,
  SdkLiveHandle,
  SdkLiveParams,
  SdkTransport,
  SdkClient,
  SdkPromptInput,
  SdkEntriesInput,
} from './types.js';
// 线协议/契约类型面单源策展 re-export（发布面稳定 API——逐项过目）
export type {
  AgentEvent,
  ApprovalAskAnswer,
  SdkRequest,
  SdkWireFrame,
  SdkAckFrame,
  SdkEntriesFrame,
  SdkSessionSummary,
  SdkDurableEntry,
  SdkEventFrame,
  SdkHelloFrame,
  SdkErrorFrame,
} from './types.js';

export { createSdkClient } from './client.js';
export { spawnServeTransport } from './stdio.js';
export type { SpawnServeOptions, SdkStdioTransport } from './stdio.js';
export { httpSdkTransport } from './http.js';
export type { HttpSdkOptions } from './http.js';
