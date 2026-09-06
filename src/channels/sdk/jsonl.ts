/**
 * SDK 线协议 NDJSON 编解码（03 篇 §10.6 线协议七原则⑦ 背压与写出纪律——NDJSON
 * 行安全条款；stdio JSONL 传输的帧法真源，HTTP/SSE 腿复用同编解码语义）。
 *
 * 行安全：JSON 串内裸 U+2028（LINE SEPARATOR）/ U+2029（PARAGRAPH SEPARATOR）
 * 在 JSON 合法但按 JS 行终止符语义会被下游 NDJSON 消费方的分行逻辑撕行（Claude
 * gh-28405 实锤）——本编码器序列化后统一转义为 \u2028/\u2029 转义形（结构字符不
 * 可能是这两位，全串替换零误伤）；解码侧 JSON.parse 原生还原，无需特判。
 *
 * 校验深度（契约面纪律）：本层做判别字段 + 必填标量的结构性校验（fail-loud
 * 宁拒勿吞）；逐动词深校验（typebox schema 面——03 §10.6 请求面动词族条
 * 「每动词 typebox schema 校验后消费——webui 微路由同纪律」）在 ./schema.ts
 * 单源、decodeWireLine 尾段接入（批 13e 兑现 13a 挂账）——HTTP 体校验位
 * （core:sdk 件）经 channels 公开面同源消费，零第二套。
 */
import type { SdkRequest, SdkWireFrame } from './protocol.js';
import { SDK_FRAME_KINDS, SDK_REQUEST_VERBS } from './protocol.js';
import { validateSdkRequest } from './schema.js';

/** 行终止符两位（编码转义对象——显式转义写法防字面量在编辑/传输中丢失） */
const LS = '\u2028';
const PS = '\u2029';

/** 判别字段的受控名（请求 `verb` / 线帧 `kind`） */
const FRAME_KIND_SET: ReadonlySet<string> = new Set(SDK_FRAME_KINDS);
const REQUEST_VERB_SET: ReadonlySet<string> = new Set(SDK_REQUEST_VERBS);

/** decide.answer 四值闭集（contracts ApprovalAskAnswer 同集——结构性校验面） */
const APPROVAL_ANSWERS: ReadonlySet<unknown> = new Set(['approve', 'reject', 'cancel', 'always']);

/** decide-result.outcome 闭集（跨入口竞速回执两档） */
const DECIDE_OUTCOMES: ReadonlySet<unknown> = new Set(['applied', 'superseded']);

/** 解码失败（fail-loud——坏行不产半帧；线面应答形〔错误帧映射〕归宿主 serve 装配批） */
export class SdkDecodeError extends Error {
  constructor(
    message: string,
    /** 原始行文本（审计面——截断到 200 字符防日志洪水） */
    readonly rawLine: string,
  ) {
    super(`SDK 线解码失败：${message}`);
    this.name = 'SdkDecodeError';
  }
}

/**
 * 编码单帧为一行（含行尾 `\n`）。出站纪律：序列化 + U+2028/U+2029 转义——
 * 返回值保证恰一个 `\n` 且在末尾（行安全锁，测试在册）。
 */
export function encodeWireLine(frame: SdkWireFrame | SdkRequest): string {
  const json = JSON.stringify(frame).replaceAll(LS, '\\u2028').replaceAll(PS, '\\u2029');
  return `${json}\n`;
}

/** 值判别：请求（verb 判别字段在闭集内）——非抛型窄卫（消费面路由用） */
export function isSdkRequest(value: unknown): value is SdkRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'verb' in value &&
    typeof (value as { verb: unknown }).verb === 'string' &&
    REQUEST_VERB_SET.has((value as { verb: string }).verb)
  );
}

/** 值判别：线帧（kind 判别字段在闭集内）——非抛型窄卫 */
export function isSdkFrame(value: unknown): value is SdkWireFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof (value as { kind: unknown }).kind === 'string' &&
    FRAME_KIND_SET.has((value as { kind: string }).kind)
  );
}

/** 结构校验：非对象 / 判别字段缺席 / 判别值不在闭集 —— 各自独立报因 */
function classify(value: unknown, rawLine: string): 'request' | 'frame' {
  if (typeof value !== 'object' || value === null) {
    throw new SdkDecodeError('非 JSON 对象', rawLine);
  }
  const v = value as Record<string, unknown>;
  if (typeof v.verb === 'string' && REQUEST_VERB_SET.has(v.verb)) return 'request';
  if (typeof v.kind === 'string' && FRAME_KIND_SET.has(v.kind)) return 'frame';
  if (v.verb !== undefined || v.kind !== undefined) {
    throw new SdkDecodeError(`判别值不识别（verb=${String(v.verb)} kind=${String(v.kind)}——闭集外）`, rawLine);
  }
  throw new SdkDecodeError('判别字段缺席（verb/kind 均无）', rawLine);
}

/** 标量必填断言（结构性校验——深校验挂账见文件头） */
function requireString(shape: Record<string, unknown>, key: string, rawLine: string): string {
  const v = shape[key];
  if (typeof v !== 'string') throw new SdkDecodeError(`${key} 必填且须为 string`, rawLine);
  return v;
}
function requireNumber(shape: Record<string, unknown>, key: string, rawLine: string): number {
  const v = shape[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new SdkDecodeError(`${key} 必填且须为有限数`, rawLine);
  }
  return v;
}

/** 逐请求动词的结构性必填校验（六动词族——03 §10.6 收窄律闭集） */
function validateRequest(shape: Record<string, unknown>, verb: string, rawLine: string): void {
  switch (verb) {
    case 'hello':
      requireNumber(shape, 'protocolVersion', rawLine);
      break;
    case 'prompt':
      requireString(shape, 'messageId', rawLine);
      requireString(shape, 'content', rawLine);
      break;
    case 'interrupt':
      requireString(shape, 'sessionId', rawLine);
      break;
    case 'getEntries':
      requireString(shape, 'sessionId', rawLine);
      requireNumber(shape, 'since', rawLine);
      break;
    case 'decide':
      requireString(shape, 'approvalId', rawLine);
      if (!APPROVAL_ANSWERS.has(shape.answer as unknown)) {
        throw new SdkDecodeError('answer 必填且须为 approve/reject/cancel/always 四值闭集', rawLine);
      }
      break;
    case 'sessions':
      break;
  }
}

/** 逐线帧 kind 的结构性必填校验 */
function validateFrame(shape: Record<string, unknown>, kind: string, rawLine: string): void {
  switch (kind) {
    case 'event':
      requireNumber(shape, 'seq', rawLine);
      requireString(shape, 'sessionId', rawLine);
      if (
        typeof shape.event !== 'object' ||
        shape.event === null ||
        typeof (shape.event as { type?: unknown }).type !== 'string'
      ) {
        throw new SdkDecodeError('event 必填且须携 string type（04 §2 十型判别）', rawLine);
      }
      break;
    case 'hello':
      requireString(shape, 'sessionId', rawLine);
      requireNumber(shape, 'protocolVersion', rawLine);
      requireNumber(shape, 'highWaterSeq', rawLine);
      break;
    case 'heartbeat':
      requireString(shape, 'sessionId', rawLine);
      if (shape.runState !== 'idle' && shape.runState !== 'running') {
        throw new SdkDecodeError('runState 必填且须为 idle/running 两值闭集', rawLine);
      }
      requireNumber(shape, 'elapsedMs', rawLine);
      break;
    case 'ack':
      requireString(shape, 'sessionId', rawLine);
      requireString(shape, 'messageId', rawLine);
      if (typeof shape.duplicate !== 'boolean') {
        throw new SdkDecodeError('duplicate 必填且须为 boolean', rawLine);
      }
      requireNumber(shape, 'highWaterSeq', rawLine);
      break;
    case 'replay-end':
      requireString(shape, 'sessionId', rawLine);
      requireNumber(shape, 'lastReplayedSeq', rawLine);
      break;
    case 'entries':
      requireString(shape, 'sessionId', rawLine);
      break;
    case 'decide-result':
      requireString(shape, 'approvalId', rawLine);
      if (!DECIDE_OUTCOMES.has(shape.outcome)) {
        throw new SdkDecodeError('outcome 必填且须为 applied/superseded 两值闭集', rawLine);
      }
      break;
    case 'ask':
      // 审批外推帧恰三必填标量（reason/toolName/suggestedEntry 可选呈现位不校验）
      requireString(shape, 'sessionId', rawLine);
      requireString(shape, 'approvalId', rawLine);
      requireString(shape, 'summary', rawLine);
      break;
    case 'sessions':
      break;
    case 'error':
      requireString(shape, 'code', rawLine);
      requireString(shape, 'message', rawLine);
      break;
  }
}

/**
 * 解码单行为请求或线帧（fail-loud：非 JSON / 判别缺席 / 必填缺失各自报因，
 * 坏行不产半帧）。行尾 `\r` 容忍（CRLF 传输面统一 LF——与 TUI 输入解码同律）。
 */
export function decodeWireLine(line: string): SdkWireFrame | SdkRequest {
  const rawLine = line;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new SdkDecodeError('非合法 JSON', rawLine);
  }
  const which = classify(parsed, rawLine);
  const shape = parsed as Record<string, unknown>;
  if (which === 'request') {
    validateRequest(shape, shape.verb as string, rawLine);
    // 深校验（批 13e 接入——./schema.ts 单源）：结构层过后逐字段 typebox 校验
    //（未知字段拒收/选填语义——HTTP 体校验位同源同件）
    const deep = validateSdkRequest(parsed);
    if (!deep.ok) throw new SdkDecodeError(deep.reason, rawLine);
    return deep.value;
  }
  validateFrame(shape, shape.kind as string, rawLine);
  return parsed as SdkWireFrame;
}

/** 分帧结果：完整行列表 + 跨 chunk 残留（无 `\n` 尾的半行，续入下次调用） */
export interface WireSplit {
  lines: string[];
  remainder: string;
}

/**
 * 流式分帧（stdio 管道跨 chunk 边界的安全分帧）：按 `\n` 切行、行尾 `\r` 剥离
 * （CRLF 统一 LF）、空行跳过（心跳间隙的空拍不产帧）。入参 chunk 与上次
 * remainder 拼接后切分；无完整行的 chunk 只进 remainder（零字节丢失、零半帧）。
 */
export function splitWireLines(chunk: string, remainder = ''): WireSplit {
  const joined = remainder + chunk;
  const lastNewline = joined.lastIndexOf('\n');
  if (lastNewline === -1) return { lines: [], remainder: joined };
  const lines = joined
    .slice(0, lastNewline)
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line.length > 0);
  return { lines, remainder: joined.slice(lastNewline + 1) };
}
