/**
 * 评审 findings 结构化呈现 durable 面（35 池件 9 残余价值面——05 §1.1
 * `session/review` 行兑现）。
 *
 * 池定谳：**不迁 prose 嵌入语法**——宿主有工具调用/事件通道，机器数据
 * 不过 prose；只做结构化契约呈现（durable 事件载体 + 呈现面卡片化）。
 *
 * 两面（session-notice 同构纪律——53 轮件 C 先例；与 notice 单写者律
 * 分立：评审数据天然多源，调用方 = 渠道/插件侧，本面是对外宿主契约
 * ——写点不接线，模型 prompt 约定面不做〔log-only 永不进模型历史〕）：
 *  - **append 面** appendSessionReview：载荷校验 fail-loud（findings 数组
 *    + 元素六员 title·file·start·end·priority·body 全列 + 行号 1 起正整数
 *    start<=end + priority 三档闭集）才 append durable 事件
 *    `session/review {findings}`；返回落位 seq（尾锚——append 即数组尾推）；
 *  - **collect 读面** collectSessionReviews：全序列 [{seq, findings}] 升序
 *    （transcript review 块重建腿数据形——seq 归位锚）；**坏形防御两级
 *    跳过**（呈现面 fail-open——事件级 findings 非数组跳整条、条目级坏形
 *    跳单条：呈现面收到干净子集不炸渲染，fail-loud 归 append 面；遮蔽
 *    事件跳过——压缩窗口内评审卡随消息遮蔽消失，notice 同语义）。
 *
 * priority 三档定谳（info/warn/error 闭集——不承袭 notice 四档）：finding
 * 是问题陈述非成事回执，success 档无义——借四档会引入死值；呈现档借键
 * （info→secondary、warn·error→error——主题无 warn 键，notice level 借键
 * 同律）在 transcript 渲染面消化，本模块只持语义闭集。
 */
import { BaseError } from '../contracts/index.js';
import type { SessionEvent } from '../contracts/index.js';
import type { SessionLog } from '../session/index.js';
import { occludedSeqs } from '../session/index.js';

/**
 * priority 三档闭集判据源（运行时校验单源）：info=可改进提示、
 * warn=应修问题、error=必须修的缺陷——问题陈述档位谱，无成事档。
 */
export const REVIEW_PRIORITIES = ['info', 'warn', 'error'] as const;
export type ReviewPriority = (typeof REVIEW_PRIORITIES)[number];
const REVIEW_PRIORITY_SET: ReadonlySet<string> = new Set(REVIEW_PRIORITIES);

/** 单条评审 finding 载荷形（六员全列——缺一即坏形拒不入账） */
export interface ReviewFindingData {
  /** 条目标题（一行短句——呈现面消毒+一行化，但契约面收原文） */
  readonly title: string;
  /** 相对工作区根路径（呈现面剥 `./` 前缀显示——契约面收原形） */
  readonly file: string;
  /** 起始行号（1 起——start==end 呈现收单行形） */
  readonly start: number;
  /** 结束行号（1 起——含端点；start>end 拒） */
  readonly end: number;
  /** 档位（三档闭集） */
  readonly priority: ReviewPriority;
  /** 正文（多行自由文本——呈现面逐行消毒+缩进+按宽 wrap） */
  readonly body: string;
}

/** `session/review` 事件载荷形（append 面 collect 面共用） */
export interface SessionReviewEventData {
  readonly findings: readonly ReviewFindingData[];
}

/**
 * 评审卡记录（collect 产物——transcript 重建腿归位锚）：seq = durable 事件
 * 位（loadProjection 逐消息前 flush 队首 seq < 消息 seq——NoticeEntry 同
 * 实现形）。
 */
export interface ReviewEntry {
  /** 归位锚（session/review 事件 durable seq——其后首条消息之前呈现） */
  readonly seq: number;
  readonly findings: readonly ReviewFindingData[];
}

/** 单条 finding 形校验（append 面与 collect 条目级防御共用单源） */
function isValidFinding(value: unknown): value is ReviewFindingData {
  if (typeof value !== 'object' || value === null) return false;
  const finding = value as Partial<ReviewFindingData>;
  // 六员全列：title/file/priority 字符串、start/end 整数（行号 1 起——
  // Number.isInteger 收 0/负/小数三形全拒）
  if (typeof finding.title !== 'string') return false;
  if (typeof finding.file !== 'string' || finding.file.length === 0) return false;
  if (!Number.isInteger(finding.start) || (finding.start as number) < 1) return false;
  if (!Number.isInteger(finding.end) || (finding.end as number) < 1) return false;
  if ((finding.start as number) > (finding.end as number)) return false;
  if (typeof finding.priority !== 'string' || !REVIEW_PRIORITY_SET.has(finding.priority)) return false;
  if (typeof finding.body !== 'string') return false;
  return true;
}

/**
 * 扫全部 session/review 评审卡（升序）：坏形防御两级跳过（事件级
 * findings 非数组跳整条、条目级坏形跳单条——呈现面 fail-open 收干净子集
 * 不炸渲染，fail-loud 归 append 面）；遮蔽事件跳过（occludedSeqs 单源
 * ——压缩窗口内评审卡随消息遮蔽同语义消失）。
 */
export function collectSessionReviews(events: readonly SessionEvent[]): readonly ReviewEntry[] {
  const occluded = occludedSeqs(events);
  const out: ReviewEntry[] = [];
  for (let seq = 0; seq < events.length; seq += 1) {
    if (occluded.has(seq)) continue;
    const event = events[seq]!;
    if (event.type !== 'session/review') continue;
    // 事件级防御：findings 非数组跳整条（异型载荷同形归零）
    const data = event.data as Partial<SessionReviewEventData> | null;
    const findings = typeof data === 'object' && data !== null ? data.findings : undefined;
    if (!Array.isArray(findings)) continue;
    // 条目级防御：单条坏形跳单条——好条目照常呈现（不连坐）
    const good = findings.filter(isValidFinding).map((f) => ({ ...f }));
    out.push({ seq, findings: good });
  }
  return out;
}

/**
 * 评审 append 面（对外宿主契约——渠道/插件侧多源调用；与 notice 单写者
 * 律分立：评审数据天然多源，词身份仍核心词拒装载面伪造）。载荷校验
 * fail-loud 在 append **之前**——坏形不入账（findings 非数组/元素六员缺一
 * /行号非 1 起整数或 start>end/priority 出闭集——编程错非用户错）。返回
 * 落位 seq（尾锚——appendSessionNotice 先例同源）。
 */
export function appendSessionReview(session: SessionLog, findings: readonly ReviewFindingData[]): number {
  if (!Array.isArray(findings)) {
    throw new BaseError(
      'SESSION_REVIEW_PAYLOAD_INVALID',
      `session/review 事件的 findings 载荷无效：非数组（${JSON.stringify(findings)}）`,
    );
  }
  for (let i = 0; i < findings.length; i += 1) {
    const finding: unknown = findings[i];
    if (!isValidFinding(finding)) {
      throw new BaseError(
        'SESSION_REVIEW_PAYLOAD_INVALID',
        `session/review 事件的 findings[${i}] 载荷无效（六员 title·file·start·end·priority·body须全列、行号 1 起整数且 start<=end、priority 闭集 info/warn/error）：${JSON.stringify(finding)}`,
      );
    }
  }
  session.append('session/review', { findings: findings.map((f) => ({ ...f })) } satisfies SessionReviewEventData);
  return session.events().length - 1; // 尾锚（append 即数组尾推）
}
