/**
 * host/compact-cmd —— `/compact` 手动压缩命令面（07 §4.1 ZCode TUI 对标批
 * B组 B2 批 2；服务面 = compaction compactNow 五值出口——B2 批 1 落码）。
 *
 * session-export.ts 体例镜像：用法常量 + 纯逻辑命令腿（handler 逻辑全在本
 * 件、装配位只薄接线）+ 回执文本单源。两消费位同一函数：TUI `/compact`
 * 通道命令（assembly 宿主级直注册）与排队兑现告知（conversation-stack
 * onManualQueuedSettled 接线——文案构造同源）。完成尾强制重画（07 B2
 * 定形注挂账销账——B2R）也在两消费位同位触发：'compacted' 档投影已变
 * （user 消息已替换为摘要+CCR 标记、压缩分隔行进投影），命令腿经 deps.
 * repaint 注入位触发、排队兑现腿经 channels.refresh 直调——聚焦者清屏
 * 重画使分隔行即时呈现，缺席注入不调（既有测试零改）。
 *
 * 回执五档（07 B2 定形注一字不差）：成功（数字源 = compaction/end 载荷
 * 同笔 occludedMessages）/ 薄会话 / 失败三段式（原因一句自 end 载荷 error
 * 补读——通道缺席形无 end 事件，防御性兜底原因）/ busy 排队 / 防重入。
 * busy 判据 = 命令 handler 层读驱动 running 位随参传入（05 §2.2 第 2 条
 * 「服务层无驱动边」——本件是 handler 域执法位）。
 */
import type { SessionEvent } from '../contracts/index.js';
import { BaseError } from '../contracts/index.js';
import type { ManualCompactOptions, ManualOutcome } from '../compaction/index.js';
import type { SessionLog } from '../session/index.js';

/** /compact 用法（assembly 通道命令注册 description 位——SESSION_EXPORT_USAGE 同族） */
export const COMPACT_USAGE =
  '用法：/compact [指引] —— 手动压缩早期对话为摘要（指引 = 对本次摘要的额外要求，可省略；回复进行中会自动排队）';

/**
 * 回执事实件（数字/原因的补读面——compactNow 立即形只返枚举，数字与原因
 * 从 compaction/end 载荷同笔补读；排队兑现形数字随事件载荷携带、failed
 * 档原因仍经日志补读）
 */
export interface CompactReceiptFacts {
  /** 已压缩消息条数（'compacted' 档回执数字源；缺席 = 防御性无数字形） */
  readonly occludedMessages?: number;
  /** 失败原因句原文（'failed' 档三段式中段；缺席 = 兜底原因） */
  readonly error?: string;
}

/** 失败原因句折叠帽（可见字符——多行错误折叠单句 + 超帽截断保头） */
const FAILURE_CAUSE_CAP = 160;

/**
 * 失败原因一句整形：剥 ANSI 逃逸序列（三形整段——错误串可携网关应答原文）
 * + 空白折单行 + 帽 160 可见字符截断。「原因一句」的呈现纪律——多行噪声
 * 折一句、超长保头（错误码族恒在头部）。
 */
function failureCauseLine(raw: string): string {
  const flat = raw
    .replace(/\x1b(?:\[[\x20-\x3f]*[\x40-\x7e]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[\x20-\x2f]*[\x30-\x7e])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > FAILURE_CAUSE_CAP ? `${flat.slice(0, FAILURE_CAUSE_CAP)}…` : flat;
}

/**
 * 回执五档文本（07 B2 定形注单源——命令腿与排队兑现腿共用；程序常量非
 * AI 生成文本，测试逐字锁）：
 *  - compacted：`✓ 已压缩：N 条早期对话已整理为摘要`（N 缺席 = 防御性
 *    无数字形——end 载荷坏形时回执仍成立）；
 *  - nothing：薄会话（planSegment 无合法段——非错误）；
 *  - failed：三段式（原因句缺席 = 通道不可用兜底句）；
 *  - queued：busy 排队档（run 终态自动兑现）；
 *  - pending：防重入档（在飞/排队已占）。
 */
export function compactOutcomeText(outcome: ManualOutcome, facts?: CompactReceiptFacts): string {
  switch (outcome) {
    case 'compacted':
      return facts?.occludedMessages !== undefined
        ? `✓ 已压缩：${facts.occludedMessages} 条早期对话已整理为摘要`
        : '✓ 已压缩：早期对话已整理为摘要';
    case 'nothing':
      return '本会话还很短，无需压缩——继续对话即可';
    case 'failed': {
      // 原因句缺席/折空（通道缺席形无 end 事件、error 坏形）= 兜底句
      const folded = facts?.error !== undefined ? failureCauseLine(facts.error) : '';
      const cause = folded !== '' ? folded : '摘要通道不可用';
      return `压缩失败：${cause}。稍后可重试 /compact`;
    }
    case 'queued':
      return '已排队：当前回复结束后自动压缩';
    case 'pending':
      return '已有压缩在进行或排队中';
  }
}

/**
 * 末条 compaction/end 载荷 → 回执事实件（数字/原因补读单源）：倒扫取末条
 * end，按 reason 分档采数——completed 采数字位、failed 采原因位、其余
 * （vetoed 等他路终态）不采。**陈化护栏**：载荷与当次出口同笔才可用（
 * compactNow 立即形返枚举后本函数同刻读账——全局串行链 + 立即形只在会话
 * 空闲时执行，结构上无更新 end 插入；防御位仍按 reason 对齐过滤——通道
 * 缺席形 failed 无 end 事件，倒扫命中旧 completed 位也不会被 failed 档
 * 误采为原因）。无 end 事件返回 undefined。
 */
export function lastCompactionEndFactsOf(events: readonly SessionEvent[]): CompactReceiptFacts | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type !== 'compaction/end') continue;
    const data = event.data as { reason?: unknown; error?: unknown; occludedMessages?: unknown };
    if (data.reason === 'completed') {
      return typeof data.occludedMessages === 'number' ? { occludedMessages: data.occludedMessages } : {};
    }
    if (data.reason === 'failed') {
      return typeof data.error === 'string' ? { error: data.error } : {};
    }
    return undefined; // vetoed 等他路终态——非本路事实不采
  }
  return undefined;
}

/** 命令腿结果（/export 同形——ok=false 携人读失败文本，命令面是用户面不是异常面） */
export interface CompactCommandOutcome {
  readonly ok: boolean;
  readonly text: string;
}

/** /compact 命令腿依赖（assembly 装配位注入——seam 与 /export 命令同形） */
export interface CompactCommandDeps {
  /** 会话日志取值器（驱动活体真源；undefined = 会话不在场） */
  readonly logOf: (sessionId: string) => SessionLog | undefined;
  /** busy 位取值器（命令 handler 层执法判据——驱动 running 位现读） */
  readonly busyOf: (sessionId: string) => boolean;
  /** 焦点会话现取（无参形真源——TUI 装配位注入） */
  readonly focusedId: () => string | null;
  /** compactNow 服务面（装配位注入真身；测试注入替身） */
  readonly compactNow: (log: SessionLog, options?: ManualCompactOptions) => Promise<ManualOutcome>;
  /**
   * 命令完成尾强制重画位（07 B2 定形注挂账销账——B2R）：'compacted' 档
   * 尾触发（投影已变——压缩分隔行/摘要即时呈现）。可选注入——缺席不调
   * （装配位真身 = channels.refresh；守卫归核：非聚焦/焦点空悬 no-op）。
   */
  readonly repaint?: (sessionId: string) => void;
}

/**
 * /compact 命令腿（argv + 命令锚会话 → 回执）：指引 = 尾参全文 join 复原
 * （argv 引号感知分词后 join——含空格指引经引号形无损；恰零参合法），trim
 * 后空白视为缺席（05 §2.2 第 7 条）。会话解析序与 /export 同：显式无（本
 * 命令无 id 参位——argv 全是指引）> 命令锚会话 > focusedId 现取。busy =
 * 驱动 running 位（随参传入服务面）。回执 = 五档单源 compactOutcomeText。
 */
export async function runCompactCommand(
  argv: readonly string[],
  anchorSessionId: string | undefined,
  deps: CompactCommandDeps,
): Promise<CompactCommandOutcome> {
  const sessionId = anchorSessionId ?? deps.focusedId();
  if (sessionId === undefined || sessionId === null) {
    return {
      ok: false,
      text: `无焦点会话可压缩（无参形 = 焦点会话——当前焦点空悬且无命令锚会话）。\n${COMPACT_USAGE}`,
    };
  }
  const log = deps.logOf(sessionId);
  if (log === undefined) {
    // fail-loud 回执（/export 同律——既有错误码族直呈）
    const err = new BaseError(
      'SESSION_NOT_FOUND',
      `会话不存在（${sessionId}）——用 /sessions 查现有 id；新会话发出首条消息后才会保存`,
    );
    return { ok: false, text: `${err.code}：${err.message}` };
  }
  // 指引参：尾参全文 join 复原 + trim 后空白视为缺席（空白串不透传——
  // buildSummaryPrompt 同判，此处前置归一使缺席形确定）
  const joined = argv.join(' ').trim();
  const options: ManualCompactOptions = {
    busy: deps.busyOf(sessionId),
    ...(joined !== '' ? { instructions: joined } : {}),
  };
  const outcome = await deps.compactNow(log, options);
  // 完成尾强制重画（07 B2 定形注挂账销账）：仅 'compacted' 档投影已变
  // （nothing/failed 投影未变；queued 的兑现腿在 onManualQueuedSettled 位
  // 另行触发；pending 同未变）——缺席注入不调
  if (outcome === 'compacted') deps.repaint?.(sessionId);
  // 数字/原因补读（立即形返枚举——end 载荷同笔；见 lastCompactionEndFactsOf
  // 陈化护栏注）
  const facts = outcome === 'compacted' || outcome === 'failed' ? lastCompactionEndFactsOf(log.events()) : undefined;
  return { ok: outcome !== 'failed', text: compactOutcomeText(outcome, facts) };
}
