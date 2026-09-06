/**
 * sdk/types — core:sdk HTTP 面契约（批 13e-1 契约先行）。
 *
 * 词面单源：端点路由与协议头（03 §10.6 批 13e 落码定形注①）/ 开面配置形
 * （07 §5 serve 旗标族落码定名注——sock 缺省接入点、TCP 可选位、凭证 env
 * 双载体三名）均在本件定形，传输实装（13e-2）与 daemon 装配（13e-3）只
 * 消费不复制。
 */
import type { SdkWireDeps } from '../channels/index.js';

/** HTTP 端点路由词面（03 §10.6 差异面①/批 13e 定形：程序调用面五 POST/GET + SSE 建立位） */
export const SDK_HTTP_ENDPOINTS = {
  /** POST——prompt 新发（sessionId 缺席即新建） */
  prompt: '/v1/prompt',
  /** POST——interrupt（无应答档 HTTP 形 = 204 空体） */
  interrupt: '/v1/interrupt',
  /** POST——审批应答（跨入口竞速回执） */
  decide: '/v1/decide',
  /** POST——断线对账读面（since 窗口 (since, 高水位]） */
  entries: '/v1/entries',
  /** GET——会话清单 */
  sessions: '/v1/sessions',
  /** GET SSE——事件流建立位（即 hello 动词的 HTTP 承载：sessionId/after/noDelta 入查询参） */
  events: '/v1/events',
} as const;

/** 协议版本头名（HTTP 无连接级 hello 位——每请求携版本，不符即 400 SDK_PROTOCOL_MISMATCH） */
export const SDK_PROTOCOL_HEADER = 'x-sdk-protocol';

/** 鉴权头（10.4「监听 ⇒ 鉴权」恒在场——Bearer 形携 token） */
export const SDK_AUTH_HEADER = 'authorization';

/**
 * sdk HTTP 面开面配置（07 §5 落码定名批 13e）。
 *
 * 缺省形态 = daemon 的 Unix-domain sock（本地程序调用方默认接入点，绕 TCP
 * 端口占用）；TCP 侧可选（远程 CI 场景）——非回环 host 必配凭证 fail-closed
 * 拒启（03 §10.6 差异面③「非回环 ⇒ 必配鉴权凭证」不豁免）。
 */
export interface SdkHttpListenConfig {
  /** Unix-domain socket 监听路径（daemon 形缺省接入点——02 数据域表 serve/ 行） */
  readonly socketPath: string;
  /** TCP 可选位（--sdk-port/--sdk-host 或 env 双载体；缺席 = 不开 TCP） */
  readonly tcp?: { readonly host: string; readonly port: number };
  /**
   * 预置共享密钥（BERRY_AGENT_SDK_TOKEN——差异面⑤ env 载体）。缺席 = 监听面
   * 自足生成进程内一次性 token（只存内存不落盘），经披露面出（daemon 形 =
   * daemon 日志文件 / 前台形 = stderr）。
   */
  readonly token?: string;
}

/** 13e-2 传输实装的装配注入面（宿主装配桥同形——decideApproval/onSubscribed 后端自持、sink 传输自持；件不 import 宿主） */
export type SdkHttpBridge = Omit<SdkWireDeps, 'decideApproval' | 'onSubscribed' | 'sink'>;

/** 心跳看门狗节拍（10.4 同律：SSE 注释行 ping 每 30s + 写侧 90s 判死） */
export const SDK_SSE_PING_INTERVAL_MS = 30_000;

/** SSE 写侧看门狗判死窗（ping 写失败或写超时即 reap 连接——读侧判死不可实施） */
export const SDK_SSE_WRITE_TIMEOUT_MS = 90_000;
