/**
 * 幂等 admit 判定纯函数（03 篇 §10.6 线协议七原则④ + 05 篇 §3.5 第二腿——
 * durable 承载条）。
 *
 * **两词一字段两面**（05 §3.5）：线面 `messageId`（03 §10.6 请求面动词族条）
 * 受理时即落账为 durable `data.dedupeKey`——单键直写、无映射表、无变换。
 * 本函数以 messageId 为键直查既存表（键域同一），语义真源在规范、查重实现
 * （日志扫描 / 投影侧索引）随受理实装（批 13b）定形。
 *
 * 语义三档：fresh（无同键——受理新跑）/ duplicate（同键同内容——幂等重收执，
 * 回执即既存事件本身、经 after 重放可取、不重跑）/ conflict（同键异内容——
 * `SDK_MESSAGE_CONFLICT`，误判超时重发零副作用的反面执法位）。跨重启幂等
 * 天然成立（durable 即真相——无第二套 admit 存储表）。
 */

/** admit 判定三档（conflict 档携错误码——调用方直接落结构化错误帧） */
export type AdmitVerdict =
  { status: 'fresh' } | { status: 'duplicate' } | { status: 'conflict'; code: 'SDK_MESSAGE_CONFLICT' };

/**
 * 判定一条 prompt 的受理档。
 *
 * @param known 既存 dedupeKey → 内容 映射（受理侧维护；跨重启语义由 durable
 *   落账兑现——本函数纯逻辑不触存储）
 * @param messageId 调用方自选幂等键（受理时即落账为 data.dedupeKey——两词一字段两面）
 * @param content 消息内容（同键异内容的比对基准——字符串全等，无归一化）
 */
export function admitMessage(known: ReadonlyMap<string, string>, messageId: string, content: string): AdmitVerdict {
  const existing = known.get(messageId);
  if (existing === undefined) return { status: 'fresh' };
  // 同键：内容全等分档——异内容即冲突（fail-loud 不静默覆盖）
  return existing === content ? { status: 'duplicate' } : { status: 'conflict', code: 'SDK_MESSAGE_CONFLICT' };
}
