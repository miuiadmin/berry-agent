/**
 * 会话事件预算刀（05 篇 §1.2 append 流水线步 4——60KiB 预算刀）。
 *
 * 写侧截断是护栏矛盾的宿主单点解：工具输出/文件读取上限可以远超会话预算，
 * 若不在落账前截断，超帽内容会把 append 变成丢整个事件（甚至炸整个 run）。
 * 「可观测降级优于静默丢弃」——截断后的事件照常入日志，每次截断 warn 落账
 * （带 SESSION_EVENT_OVER_BUDGET 码名义——该码是预算刀的身份标识，裁腿不抛）。
 *
 * 度量单位 = JSON 转义后体积（与 jsonBytes 同一把尺）：护栏量的是
 * JSON.stringify 后体积，预算刀若量原文字节即两把尺子不同单位——引号/换行
 * 每字符转义 2x、控制字符 6x，转义密集文本会穿透预算刀后撑破护栏。
 */
import type { ContentBlock } from './event-data.js';

/** 内容腿预算（字节）：60KiB——05 §1.2 步 4 单级设计（berry-agent 规范再设计，非 berry 两级） */
export const EVENT_BUDGET_BYTES = 60 * 1024;

/** errorMessage 腿小帽（字节）：与 content 腿各自独立计帽——防同源双载叠加击穿（05 §1.1 assistant/message 表注） */
export const ERROR_MESSAGE_BUDGET_BYTES = 2 * 1024;

/** 字符串的护栏同尺体积（与 jsonBytes 同式：JSON.stringify 的转义后字节——两把尺同单位） */
export function escapedBytes(text: string): number {
  return Buffer.byteLength(JSON.stringify(text), 'utf8');
}

/**
 * 字符串按「护栏同尺」字节预算截断（超预算加尾标记；不超原样返回）。
 * 尾标记形态 = `…[truncated N chars]`（N = 截掉字符数——05 §1.2 步 4 字面）。
 */
export function budgetString(text: string, budget: number = EVENT_BUDGET_BYTES): string {
  if (escapedBytes(text) <= budget) return text;
  // 转义只增不减：原文截到 budget 字节是安全上界（转义后 ≤ 原文 × 截点）。
  // subarray 可能切在多字节字符中间，toString 对坏尾替换 U+FFFD——可接受
  // 且不影响收敛（截段只会更短）
  const initial = Buffer.from(text, 'utf8').subarray(0, budget).toString('utf8');
  /** 截段前 len 字符 + 尾标记是否进预算（同尺判定——含标记自身转义体积） */
  const fits = (len: number): boolean => {
    const sliced = initial.slice(0, len);
    return escapedBytes(sliced) + escapedBytes(marker(text.length - sliced.length)) <= budget;
  };
  if (!fits(0)) {
    // 空段 + 尾标记仍超帽（预算小于标记体积的极端形）：照旧整段弃返回尾
    // 标记（可观测降级不静默丢——与旧逐字符形边界一致）
    return marker(text.length);
  }
  if (fits(initial.length)) {
    // 全段即进预算（编码期折损形：原文含孤立代理子时 UTF-8 编码逐个折
    // U+FFFD，截段转义体积可反低于原文——转义膨胀超帽但截段不超）：整段
    // 直过（旧逐字符形同此边界——首判即过零收缩）
    return initial + marker(text.length - initial.length);
  }
  // 安全截位点（代理对不切断）：截段以孤立高代理子收尾的位点（恰切在代理
  // 对中间）会破坏单调性——完整对的 JSON 原样 4 字节、切断后孤立代理子
  // 转义 \udXXX 反升 2 字节，进预算长度集不再向下封闭（朴素二分会跳过更
  // 大可行界——对拍锁实测抓获形）。最大可行界必在安全位：切断位体积恒高
  // 于其 +1 邻位（补全对子净降），可行则邻位更可行且更大，矛盾。
  const safeCuts: number[] = [0];
  for (let i = 1; i <= initial.length; i++) {
    const prev = initial.charCodeAt(i - 1);
    if (prev < 0xd800 || prev > 0xdbff) safeCuts.push(i); // 前一字符非高代理子 = 不切对
  }
  // 几何收敛（对齐本函数历来宣称）：安全位上体积和随截段长度单调不增——
  // 每短一字符截段转义体积至少减 1 字节（跨对子短两位减 ≥4 字节）、尾标记
  // N 位数对数缓增——二分找最大进预算安全位。O(log n) 次探测替代旧逐字符
  // O(n²) 收缩（60KiB 帽 × 控制字符 6x 形曾在超帽 append 热路径数百毫秒级空转）
  let loIdx = 0; // 已知进预算（0 位——上方已验）
  let hiIdx = safeCuts.length - 1; // 已知超预算（全段位——上方已验）
  while (hiIdx - loIdx > 1) {
    const midIdx = (loIdx + hiIdx) >> 1;
    if (fits(safeCuts[midIdx]!)) loIdx = midIdx;
    else hiIdx = midIdx;
  }
  const sliced = initial.slice(0, safeCuts[loIdx]!);
  return sliced + marker(text.length - sliced.length);
}

/** 截断尾标记（N = 截掉的 UTF-16 码点数） */
function marker(truncatedChars: number): string {
  return `…[truncated ${truncatedChars} chars]`;
}

/** 单块体积（截断预算的计量单位；image 按 base64 字符串长度近似——base64 字母表无转义字符，转义前后等长；
 * image-ref 引用块整体序列化体积——百字节级恒过刀（05 §1.2 条 4 注：引用形
 * 非内联 base64，base64 超帽占位规则只辖内联 image 块路径）。 */
function blockBytes(block: ContentBlock): number {
  if (block.type === 'image-ref') {
    return Buffer.byteLength(JSON.stringify(block), 'utf8');
  }
  switch (block.type) {
    case 'text':
      return escapedBytes(block.text);
    case 'thinking':
      return escapedBytes(block.thinking);
    case 'image':
      return block.data.length;
  }
}

/**
 * 内容腿截断（块数组形态：逐块累加判断——多腿同源叠加击穿的防线；text/thinking
 * 块按剩余预算截字节加尾标记，image 块放不下剩余预算时落 image-blob-dropped
 * 占位——base64 动辄超帽，保留语义不保像素，05 §1.2 步 4）。
 * 纯字符串形态（user 消息）：整串按字节截。
 */
export function truncateContent(
  content: string | readonly ContentBlock[],
  budget: number = EVENT_BUDGET_BYTES,
): string | readonly ContentBlock[] {
  if (typeof content === 'string') {
    return budgetString(content, budget);
  }
  // 快路径：总字节在预算内直接通过（绝大多数消息零开销）
  let total = 0;
  for (const block of content) {
    total += blockBytes(block);
  }
  if (total <= budget) return content;

  const out: ContentBlock[] = [];
  let remaining = budget;
  for (const block of content) {
    if (block.type === 'image') {
      if (block.data.length <= remaining) {
        // 预算容得下：保留像素（快路径外的少数小图）
        out.push(block);
        remaining -= block.data.length;
        continue;
      }
      // 放不下 → 占位（事件日志是审计面非媒体库）
      out.push({ type: 'text', text: '[image-blob-dropped: durable budget]' });
      remaining = 0;
      continue;
    }
    if (block.type === 'image-ref') {
      // 引用块百字节级恒过刀（05 §1.2 条 4 注）：邻块耗尽预算的罕见形下
      // 也不落 image-blob-dropped 占位——引用形本身即预算友好承载，保引用
      const size = blockBytes(block);
      if (size <= remaining) {
        out.push(block);
        remaining -= size;
        continue;
      }
      // 极端形（剩余预算 < 引用块体积）：整块丢弃同 text/thinking 耗尽律
      // ——尾标记语义由截断事实承载，不造第二占位词
      remaining = 0;
      continue;
    }
    // text / thinking：按剩余预算截字节（度量与判定同尺——转义后体积）
    const text = block.type === 'text' ? block.text : block.thinking;
    const size = escapedBytes(text);
    if (size <= remaining) {
      out.push(block);
      remaining -= size;
      continue;
    }
    if (remaining > 0) {
      const marked = budgetString(text, remaining);
      out.push(block.type === 'text' ? { type: 'text', text: marked } : { type: 'thinking', thinking: marked });
      remaining = 0;
    }
    // 预算耗尽后的剩余 text/thinking 块整块丢弃（尾标记已声明截断事实）
  }
  return out;
}

/** 预算刀结果：截断后 data + 截断事实（append 侧 warn 落账依据） */
export interface BudgetResult {
  /** 截断（或原样）后的 data——原 data 未动（纯函数） */
  readonly data: unknown;
  /** true = 发生了截断降级（warn 落账带 SESSION_EVENT_OVER_BUDGET 码名义） */
  readonly truncated: boolean;
}

/**
 * append 流水线步 4 入口：按事件类型分派裁腿（单遍、只查不改原值）。
 * 分派表（05 §1.2 步 4）：
 *  - user/message / assistant/message：截 content（块数组逐块累加）；
 *  - assistant/message 的 errorMessage 腿独立 2KiB 小帽；
 *  - tool/call：截 arguments（原始字符串）；
 *  - tool/result：截 content；
 *  - 其余类型超帽：data 整体截断加尾标记（序列化为带尾标记的字符串——最后
 *    手段的可观测降级，优先保可读）。
 */
export function applyEventBudget(type: string, data: unknown): BudgetResult {
  if (data === null || typeof data !== 'object') {
    // 原始值形态（含空对象快照类）：整体体积由护栏语义覆盖，无腿可裁——原样过
    return { data, truncated: false };
  }
  const record = data as Record<string, unknown>;
  switch (type) {
    case 'user/message':
    case 'tool/result': {
      const content = record.content;
      if (typeof content === 'string' || Array.isArray(content)) {
        const clipped = truncateContent(content as string | readonly ContentBlock[]);
        return clipped === content
          ? { data, truncated: false }
          : { data: { ...record, content: clipped }, truncated: true };
      }
      return { data, truncated: false };
    }
    case 'assistant/message': {
      let changed = false;
      const next: Record<string, unknown> = { ...record };
      if (typeof record.content === 'string' || Array.isArray(record.content)) {
        const clipped = truncateContent(record.content as string | readonly ContentBlock[]);
        if (clipped !== record.content) {
          next.content = clipped;
          changed = true;
        }
      }
      // errorMessage 腿独立小帽（与 content 各自计帽——同源双载防线）
      if (typeof record.errorMessage === 'string') {
        const clipped = budgetString(record.errorMessage, ERROR_MESSAGE_BUDGET_BYTES);
        if (clipped !== record.errorMessage) {
          next.errorMessage = clipped;
          changed = true;
        }
      }
      return { data: changed ? next : data, truncated: changed };
    }
    case 'tool/call': {
      const args = record.arguments;
      if (typeof args === 'string') {
        const clipped = budgetString(args);
        return clipped === args
          ? { data, truncated: false }
          : { data: { ...record, arguments: clipped }, truncated: true };
      }
      return { data, truncated: false };
    }
    default: {
      // 其余类型：data 整体截断（序列化字符串 + 尾标记——保留前段可读）
      const serialized = JSON.stringify(data);
      if (serialized === undefined || escapedBytes(serialized) <= EVENT_BUDGET_BYTES) {
        return { data, truncated: false };
      }
      return { data: budgetString(serialized), truncated: true };
    }
  }
}
