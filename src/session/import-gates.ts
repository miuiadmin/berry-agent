/**
 * 导入四闸（05 篇 §5.1——金样导入/外部会话导入的统一门）。
 *
 * 身份闸（自描述格式）→ 词汇闸（逐事件过注册表）→ 配对闸（离线 closer 预检）
 * → 洪水闸（会话增生限流）。四闸全过才允许建会话；洪水闸是进程态限速器，
 * 其余三闸是文件内容的纯校验。
 */
import { BaseError, isKnownEventType, type SessionEvent } from '../contracts/index.js';

/** 导入文件自描述头（JSONL 首行 _meta——格式身份与版本） */
export interface ImportMeta {
  /** 格式身份（本实现认识的闭集：'berry-agent/session'） */
  readonly format: string;
  /** 格式版本（整数递增；高于本实现支持版 = 降级运行拒开） */
  readonly version: number;
  readonly exportedAt?: number;
}

/** 本实现认识的格式身份与支持版本（身份闸判据单源） */
const KNOWN_FORMAT = 'berry-agent/session';
const SUPPORTED_VERSION = 1;

/** 解析出的导入物（meta + 事件体——供后续闸与建会话面消费） */
export interface ParsedImport {
  readonly meta: ImportMeta;
  readonly events: readonly SessionEvent[];
}

/**
 * 身份闸 + 解析：导入文件文本（JSONL——首行 _meta，其后每行一条 SessionEvent）。
 * 不认识的自描述拒载（SESSION_IMPORT_BAD_FORMAT，fail-loud 宁拒勿吞）；
 * 行级 JSON 解析失败同码（撕裂导出文件不可静默截半）。
 */
export function parseImportFile(text: string): ParsedImport {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new BaseError('SESSION_IMPORT_BAD_FORMAT', '导入文件为空（缺 _meta 自描述首行）');
  }
  let meta: unknown;
  try {
    meta = JSON.parse(lines[0]!);
  } catch (err) {
    throw new BaseError('SESSION_IMPORT_BAD_FORMAT', `_meta 首行非 JSON：${String(err)}`);
  }
  const header = meta as { format?: unknown; version?: unknown } | null;
  if (!header || typeof header !== 'object' || header.format !== KNOWN_FORMAT || header.version !== SUPPORTED_VERSION) {
    throw new BaseError(
      'SESSION_IMPORT_BAD_FORMAT',
      `导入文件自描述不认识：format=${String(header?.format)} version=${String(header?.version)}（本实现认识 ${KNOWN_FORMAT} v${SUPPORTED_VERSION}）`,
    );
  }
  const events: SessionEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]!);
    } catch (err) {
      throw new BaseError('SESSION_IMPORT_BAD_FORMAT', `第 ${i + 1} 行非 JSON（撕裂文件）：${String(err)}`);
    }
    const event = parsed as SessionEvent | null;
    if (!event || typeof event !== 'object' || typeof event.type !== 'string' || typeof event.seq !== 'number') {
      throw new BaseError('SESSION_IMPORT_BAD_FORMAT', `第 ${i + 1} 行非 SessionEvent 信封（缺 type/seq）`);
    }
    events.push(event);
  }
  return {
    meta: { format: KNOWN_FORMAT, version: SUPPORTED_VERSION },
    events,
  };
}

/**
 * 词汇闸：逐事件类型过词汇注册表——未知类型且未标 ignorable 的拒整批
 * （宁拒勿吞；ignorable 事件向前兼容放行）。
 */
export function vocabularyGate(events: readonly SessionEvent[]): void {
  for (const event of events) {
    if (isKnownEventType(event.type)) continue;
    if (event.ignorable === true) continue;
    throw new BaseError(
      'SESSION_UNKNOWN_EVENT_TYPE',
      `导入事件 seq#${event.seq} 类型 ${event.type} 未注册且未标 ignorable（拒整批）`,
    );
  }
}

/**
 * 配对闸：turn/tool 配对完整性预检——导入前离线跑 closer 语义的反面：
 * 「缺闭合」可合成收形（recoverClosers 能处置）；「多余闭合」（end 无 start /
 * result 无 call / seq 断号）无法合成——拒载。seq 连续性同检（firstSeqBreak）。
 */
export function pairingGate(events: readonly SessionEvent[]): void {
  const breakAt = (() => {
    for (let i = 0; i < events.length; i++) {
      if (events[i]!.seq !== i) return i;
    }
    return null;
  })();
  if (breakAt !== null) {
    throw new BaseError(
      'SESSION_IMPORT_BAD_FORMAT',
      `导入事件 seq 不连续：位置 ${breakAt} 期望 seq ${breakAt} 实得 ${events[breakAt]!.seq}`,
    );
  }
  let turnDepth = 0;
  const seenCalls = new Set<string>();
  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        turnDepth += 1;
        break;
      case 'turn/end':
        turnDepth -= 1;
        if (turnDepth < 0) {
          throw new BaseError(
            'SESSION_IMPORT_BAD_FORMAT',
            `导入事件 seq#${event.seq} turn/end 无对应 start（多余闭合不可合成）`,
          );
        }
        break;
      case 'tool/call': {
        const id = (event.data as { toolCallId?: unknown } | null)?.toolCallId;
        if (typeof id === 'string') seenCalls.add(id);
        break;
      }
      case 'tool/result': {
        const id = (event.data as { toolCallId?: unknown } | null)?.toolCallId;
        if (typeof id === 'string' && !seenCalls.has(id)) {
          throw new BaseError(
            'SESSION_IMPORT_BAD_FORMAT',
            `导入事件 seq#${event.seq} tool/result 无前置 call（${id}——多余闭合不可合成）`,
          );
        }
        break;
      }
      default:
        break;
    }
  }
}

/**
 * 洪水闸（会话增生限流）：单进程滑动时间窗内导入/fork 新建会话数限速——防
 * 失控脚本（插件 bug 或用户脚本）以 fork 洪水填库。首版 100/分钟（05 §5.1）。
 * 超限抛 SESSION_SPAWN_RATE_LIMIT。时钟注入（测试假钟）；窗口态纯内存。
 */
export class SessionSpawnLimiter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly clock: () => number;
  /** 窗口内新建时间戳（滑动窗账本） */
  private readonly stamps: number[] = [];

  constructor(options?: { windowMs?: number; max?: number; clock?: () => number }) {
    this.windowMs = options?.windowMs ?? 60_000;
    this.max = options?.max ?? 100;
    this.clock = options?.clock ?? (() => Date.now());
  }

  /** 尝试占一个名额（超限抛；成功即记账） */
  acquire(): void {
    const now = this.clock();
    // 清窗：只留窗口内时间戳
    while (this.stamps.length > 0 && now - this.stamps[0]! >= this.windowMs) {
      this.stamps.shift();
    }
    if (this.stamps.length >= this.max) {
      throw new BaseError(
        'SESSION_SPAWN_RATE_LIMIT',
        `会话增生限流：窗口 ${this.windowMs}ms 内新建已达 ${this.max}（防 fork 洪水填库）`,
      );
    }
    this.stamps.push(now);
  }
}

/** 便捷面：导入文件全闸校验（身份 → 词汇 → 配对；洪水闸由调用方在建会话位点执法） */
export function runImportGates(text: string): ParsedImport {
  const parsed = parseImportFile(text);
  vocabularyGate(parsed.events);
  pairingGate(parsed.events);
  return parsed;
}
