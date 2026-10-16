/**
 * 会话级宿主通知 durable 面（挖掘 53 轮件 C——05 §1.1 `session/notice` 行
 * 兑现；升级提示首例）。
 *
 * 三面（collectModelChanges 同构纪律——52 轮件 B 先例）：
 *  - **append 面** appendSessionNotice：载荷校验 fail-loud（level 四档闭集
 *    + text 字符串——契约面在调用侧闭包已定，坏形是编程错非用户错）才
 *    append durable 事件 `session/notice {level, text}`（词汇闸只查注册
 *    不查 owner 域——事件词已在册 contracts/events.ts owner=host）；返回
 *    落位 seq（尾锚——append 即数组尾推，调用侧次序倒置律消费〔append
 *    成功后才 recordNotifiedVersion，07:347〕）；
 *  - **collect 读面** collectSessionNotices：全序列 [{seq, level, text}]
 *    升序（transcript notice 块重建腿数据形——seq 归位锚）；**坏形防御
 *    跳过**（呈现面 fail-open——collectModelChanges 同律：重建面收到干净
 *    子集不炸渲染，fail-loud 归 append 面；遮蔽事件跳过——压缩窗口内通知
 *    随消息遮蔽消失，collectTodoSnapshots 同语义）。
 *
 * 单写者律（05 §1.1）：owner=host——写点 = tui-entry 升级腿（装配位通知
 * 腿），本面不注册 ctx.get 服务面——插件结构性不可达。呈现双路：装配位
 * 直调（appendNotice 直播腿）+ collect 重建（loadProjection notices 参）。
 */
import { BaseError, type NotifyLevel } from '../contracts/index.js';
import type { SessionEvent } from '../contracts/index.js';
import type { SessionLog } from '../session/index.js';
import { occludedSeqs } from '../session/index.js';

/** level 四档闭集判据源（contracts NotifyLevel 同源——运行时校验单源） */
const NOTICE_LEVELS: ReadonlySet<string> = new Set(['info', 'success', 'warn', 'error']);

/** `session/notice` 事件载荷形（append 面 collect 面共用） */
export interface SessionNoticeEventData {
  readonly level: NotifyLevel;
  readonly text: string;
}

/**
 * 通知记录（collect 产物——transcript 重建腿归位锚）：seq = durable 事件位
 * （loadProjection 逐消息前 flush 队首 seq < 消息 seq——ModelChangeEntry 同
 * 实现形）。
 */
export interface NoticeEntry {
  /** 归位锚（session/notice 事件 durable seq——其后首条消息之前呈现） */
  readonly seq: number;
  readonly level: NotifyLevel;
  readonly text: string;
}

/**
 * 扫全部 session/notice 通知（升序）：坏形防御跳过（level 出闭集/text 非串
 * /异型载荷——呈现面 fail-open 不炸渲染，fail-loud 归 append 面）；遮蔽
 * 事件跳过（occludedSeqs 单源——压缩窗口内通知随消息遮蔽同语义消失）。
 */
export function collectSessionNotices(events: readonly SessionEvent[]): readonly NoticeEntry[] {
  const occluded = occludedSeqs(events);
  const out: NoticeEntry[] = [];
  for (let seq = 0; seq < events.length; seq += 1) {
    if (occluded.has(seq)) continue;
    const event = events[seq]!;
    if (event.type !== 'session/notice') continue;
    const data = event.data as Partial<SessionNoticeEventData> | null;
    const level = typeof data === 'object' && data !== null ? data.level : undefined;
    const text = typeof data === 'object' && data !== null ? data.text : undefined;
    // 坏形防御跳过（collectModelChanges 同律——重建面收到干净子集）
    if (typeof level !== 'string' || !NOTICE_LEVELS.has(level)) continue;
    if (typeof text !== 'string') continue;
    out.push({ seq, level: level as NotifyLevel, text });
  }
  return out;
}

/**
 * 通知 append 面（单写者律：宿主装配独占——tui-entry 升级腿闭包消费；不
 * 注册 ctx.get 服务面，插件结构性不可达）。载荷校验 fail-loud 在 append
 * **之前**——坏形不入账（level 出闭集/text 非串——编程错非用户错，调用侧
 * 闭包词面恒良形）。返回落位 seq（尾锚——次序倒置律〔append 成功后才
 * recordNotifiedVersion〕的调用侧消费位）。
 */
export function appendSessionNotice(session: SessionLog, level: NotifyLevel, text: string): number {
  if (typeof level !== 'string' || !NOTICE_LEVELS.has(level)) {
    throw new BaseError(
      'SESSION_NOTICE_PAYLOAD_INVALID',
      `session/notice 事件的 level 载荷无效：${JSON.stringify(level)}`,
    );
  }
  if (typeof text !== 'string') {
    throw new BaseError(
      'SESSION_NOTICE_PAYLOAD_INVALID',
      `session/notice 事件的 text 载荷无效：${JSON.stringify(text)}`,
    );
  }
  session.append('session/notice', { level, text } satisfies SessionNoticeEventData);
  return session.events().length - 1; // 尾锚（append 即数组尾推——appendModelChangeLine 先例同源）
}
