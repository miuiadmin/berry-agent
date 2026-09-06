/**
 * web 件公开类型（02 §4.1 席 18：ctx.fetch + fetch 工具 + SSRF 五卫生件——
 * 两消费面同一 execute）。
 *
 * 件身份：core: 官方插件 15 之 #6（07 §1.1 core:web 行）——fetch 工具（模型
 * 消费面）/ ctx.fetch 服务（插件消费面）/ browser 导航（第三消费位，03 §10.3
 * 安全卫生条）三面共用同一 execute 路径与同一在飞门实例。装载态集成（apply
 * 注册工具 + provide 服务）归批 12 后装载面；本批纯逻辑腿。
 */

/** 消费面标注（归因落账的 consumer 字段——三消费位同一路径可区分） */
export type WebConsumer = 'tool' | 'service' | 'navigate';

/** 五卫生件数值帽（07 §1.1 core:web 行：私网拒绝/重定向上限/字节上限/限流/归因落账） */
export interface WebFetchLimits {
  /** 重定向跟随跳数帽（触帽 WEB_REDIRECT_LIMIT） */
  maxRedirects: number;
  /** 响应体字节帽（触帽截断并置 truncated——不拒，超量内容进不了上下文） */
  maxBytes: number;
  /** 在飞并发帽（在飞门实例容量；触帽 WEB_RATE_LIMITED） */
  maxConcurrent: number;
}

/** fetch 服务调用入参（ctx.fetch 服务面与 fetch 工具共用的请求形） */
export interface WebFetchInit {
  /** HTTP 方法（缺省 GET；工具面 schema 另有词表收紧，服务面不收紧） */
  method?: string;
  /** 请求头（普通字符串表） */
  headers?: Record<string, string>;
  /** 请求体（字符串形；303/浏览器兼容改写时丢弃） */
  body?: string;
  /** 中止信号（调用方协作面——超时归调用方/管道预算，服务内不自带时钟） */
  signal?: AbortSignal;
  /** 消费面标注（归因落账用；缺省 'service'） */
  consumer?: WebConsumer;
}

/** fetch 服务应答（两消费面同形——工具面据此拼模型可见文本） */
export interface WebFetchResponse {
  /** 请求入口 URL（归因锚——重写前的原值） */
  url: string;
  /** 重定向终点 URL（无跳转时与 url 同值） */
  finalUrl: string;
  /** 终点 HTTP 状态码 */
  status: number;
  /** 终点 Content-Type（缺席空串） */
  contentType: string;
  /** 响应体文本（UTF-8 严格解码；字节帽截断时截到帽） */
  body: string;
  /** 字节帽触顶记（截断非拒绝——调用方自行决定够不够用） */
  truncated: boolean;
  /** 实收字节数（≤ maxBytes） */
  bytes: number;
  /** 实际跟随的重定向跳数 */
  redirects: number;
}

/** 归因落账记录（07 §1.1 core:web 行「归因落账」卫生件——谁在何时取了什么） */
export interface WebAttributionRecord {
  /** 消费面（工具/服务/浏览器导航） */
  consumer: WebConsumer;
  /** HTTP 方法 */
  method: string;
  /** 请求入口 URL */
  url: string;
  /** 重定向终点 URL（blocked 早拒时可能缺席） */
  finalUrl?: string;
  /** 终点状态码（blocked 早拒时缺席） */
  status?: number;
  /** 实收字节数 */
  bytes: number;
  /** 实际跟随跳数 */
  redirects: number;
  /** 结局：ok = 取到响应（非 2xx 也算 ok——HTTP 语义完整）；blocked = 卫生件拦截（携 WEB_ 码）；error = 普通失败（DNS/网络/解码/中止——非卫生拦截） */
  outcome: 'ok' | 'blocked' | 'error';
  /** 拦截码（outcome=blocked 时在场的 WEB_ 码） */
  errorCode?: string;
  /** 落账时点（epoch ms——注入时钟可测） */
  at: number;
}

/** 归因落账 sink（装配根接 durable 落账面——本件不依赖 session/persist，边表 web→contracts 单边） */
export type WebAttributionSink = (record: WebAttributionRecord) => void;

/** DNS 解析器（卫生件注入面——生产走 node:dns/promises lookup {all:true}，测试走桩） */
export type DnsResolver = (hostname: string) => Promise<string[]>;

/** fetch 实现注入面（结构满足全局 fetch 的最小形——测试走桩，生产用全局 fetch） */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: 'manual';
    signal?: AbortSignal;
  },
) => Promise<Response>;

/** 服务构造依赖（全可选——生产全缺省，测试逐项注入） */
export interface WebFetchDeps {
  /** fetch 实现（缺省全局 fetch） */
  fetchImpl?: FetchLike;
  /** DNS 解析器（缺省 node:dns/promises lookup all） */
  resolveDns?: DnsResolver;
  /** 时钟（缺省 Date.now——归因落账 at 位） */
  now?: () => number;
  /** 归因落账 sink（缺省无操作） */
  sink?: WebAttributionSink;
  /** 在飞门（缺省按 limits.maxConcurrent 新建；browser 第三消费位由装配根注入同一实例） */
  gate?: InFlightGate;
  /** 数值帽（缺省 DEFAULT_WEB_LIMITS） */
  limits?: Partial<WebFetchLimits>;
}

/**
 * ctx.fetch 服务面（02 §4.1 席 18「ctx.fetch」）：单一 fetch 方法 = 三消费
 * 面共用的唯一 execute 路径（fetch 工具/browser 导航皆经此，卫生件不旁路）。
 */
export interface WebFetchService {
  fetch(rawUrl: string, init?: WebFetchInit): Promise<WebFetchResponse>;
}

/**
 * 在飞门（限流卫生件）形：并发计数 + 满拒。构造面 createInFlightGate——
 * browser 件（批 17b）按 03 §10.3「导航限流与 fetch 共享同一在飞门实例」
 * 由装配根传入同一实例。
 */
export interface InFlightGate {
  /** 在飞数（观测面） */
  readonly inFlight: number;
  /** 容量（构造定死） */
  readonly capacity: number;
  /** 占门（满即抛 WEB_RATE_LIMITED——fail-fast 不排队） */
  acquire(): void;
  /** 放门（finally 面——配对义务归 run 或调用方） */
  release(): void;
  /** 占门-执行-放门包装（异常也放门） */
  run<T>(task: () => Promise<T>): Promise<T>;
}
