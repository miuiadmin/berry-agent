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
 *
 * **含图扩形（2026-10-08 剪贴板附件批——03 §10.4 ①）**：比对基准由裸串升
 * canonical 形（admitContentKey）——无图消息零漂移（原文串即基准，旧账全量
 * 兼容），有图消息 images 逐件等比（解码字节内容寻址 ref 与归一 mimeType
 * 逐件全等且同序才算重复，任一异即新消息）。
 */
import { createHash } from 'node:crypto';

/** admit 判定三档（conflict 档携错误码——调用方直接落结构化错误帧） */
export type AdmitVerdict =
  { status: 'fresh' } | { status: 'duplicate' } | { status: 'conflict'; code: 'SDK_MESSAGE_CONFLICT' };

/** prompt 携图成员（剪贴板附件批 03 §10.4 ①——受理侧账的 canonical 形位；
 * 形与 SdkPromptImage/WebuiSubmitImage 同形，此处本地重述 admit 纯函数
 * 无通道依赖） */
export interface AdmitPromptImage {
  /** 图片原文 base64 */
  readonly data: string;
  /** 声明 MIME */
  readonly mimeType: string;
}

/**
 * admit 幂等内容基准（canonical 形——03 §10.4 ①「admit 含 images 逐件等比」
 * 的存储实现位）：无图（缺席/空数组）= 原文串（既有 durable 账零漂移——旧账
 * 全量兼容）；有图 = canonical JSON `{content, images:[{ref, mimeType}...]}`
 * （字段序 content 先 images 后、逐件 ref 先 mimeType 后钉死——逐件有序全等
 * ⟺ canonical 串全等，序列化无歧义）。
 *
 * **ref 形 canonical（serve 线收口拍板）**：逐件图降内容寻址引用
 * `sha256:<64 位小写 hex>`（sha256(解码字节)——与受理链附件库落盘同式）+
 * mimeType 归一（trim + 小写——与受理链核验归一同式）。理由：原始 base64
 * 按设计不落 durable（投影恒引用形），跨重启重建键唯有 ref 形可同源——
 * raw-data 形键在 durable 侧无对应物，重发必误判 conflict。
 *
 * @param content 消息文本
 * @param images 粘贴图族（缺席 = 纯文本档）
 */
export function admitContentKey(content: string, images?: readonly AdmitPromptImage[]): string {
  // 无图档：空数组与缺席同档（受理链早退零副作用——账面不造 `{content,images:[]}` 噪音形）
  if (images === undefined || images.length === 0) return content;
  return JSON.stringify({
    content,
    images: images.map((img) => ({
      ref: refOfBase64(img.data),
      mimeType: img.mimeType.trim().toLowerCase(),
    })),
  });
}

/**
 * durable 内容 → admit 键重建（serve 线收口——03 §10.4 ① ref 形 canonical
 * 的对偶读面）：durable user/message 的 data.content（串或块数组）重建 admit
 * 键，与 admitContentKey 同源恒等（跨重启查重键不漂移——原始 base64 按设计
 * 不落 durable，重建唯有 ref 形可同源）。
 *
 * 三档：纯文本串原样（无图档零漂移）；块数组拼 text 块文本 + 收 image-ref
 * 引用块（有引用块 = canonical JSON 形、无 = 拼接文本的无图档）；非串非数组
 * 兜底空串（serve 线未知形态不炸——空串与真实键不误撞）。
 */
export function admitKeyFromStored(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let text = '';
  const refs: Array<{ ref: string; mimeType: string }> = [];
  for (const block of content) {
    const b = block as { type?: unknown; text?: unknown; ref?: unknown; mimeType?: unknown };
    // text 块拼接（与受理位组装形对偶：文本半边 = 逐块串接）
    if (b.type === 'text' && typeof b.text === 'string') {
      text += b.text;
      continue;
    }
    // image-ref 引用块收容（ref 与 mimeType 均在场才算——坏形块跳过不炸）
    if (b.type === 'image-ref' && typeof b.ref === 'string' && typeof b.mimeType === 'string') {
      refs.push({ ref: b.ref, mimeType: b.mimeType });
    }
  }
  // 无引用块 = 无图档（拼接文本即键——不造 {content,images:[]} 噪音形）
  if (refs.length === 0) return text;
  return JSON.stringify({ content: text, images: refs });
}

/** base64 → 内容寻址 ref（受理链附件库同式：sha256(解码字节) 小写 hex） */
function refOfBase64(data: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex')}`;
}

/**
 * 判定一条 prompt 的受理档。
 *
 * @param known 既存 dedupeKey → 内容映射（受理侧维护；跨重启语义由 durable
 *   落账兑现——本函数纯逻辑不触存储。**值域 = admitContentKey 产物**：无图
 *   消息即原文串、有图消息为 canonical JSON）
 * @param messageId 调用方自选幂等键（受理时即落账为 data.dedupeKey——两词一字段两面）
 * @param content 消息内容（比对基准的文本半边——无归一化）
 * @param images 粘贴图族（03 §10.4 ①——缺席 = 纯文本档；data 与 mimeType
 *   逐件全等且同序才算重复，任一异即新消息）
 */
export function admitMessage(
  known: ReadonlyMap<string, string>,
  messageId: string,
  content: string,
  images?: readonly AdmitPromptImage[],
): AdmitVerdict {
  const existing = known.get(messageId);
  if (existing === undefined) return { status: 'fresh' };
  // 同键：canonical 基准全等分档——异内容即冲突（fail-loud 不静默覆盖）
  return existing === admitContentKey(content, images)
    ? { status: 'duplicate' }
    : { status: 'conflict', code: 'SDK_MESSAGE_CONFLICT' };
}
