/**
 * 工具实时进度面板（07 §4.1 呈现面件 5）——状态行上方的瞬时活动面板。
 *
 * - 行生命周期：`tool_execution_start` 建档（toolCallId→名——**不建行**，
 *   首个 `tool_execution_update` 才建行）/ 后续 update 原位换行 /
 *   `tool_execution_end` 即摘行 / `clear()` 清板（agent_start·end·repaint
 *   三时点——瞬时面律：不入正文、不跨 repaint 保存）；
 * - 宽容解码（update 载荷契约面 `unknown`——03 §2.3 自由载荷，呈现侧零
 *   契约收紧）：string 直显 / AgentToolResult 形〔content 块数组〕取文本块
 *   倒扫末条非空行 / 其余视为文本缺席退化为 ` ▸ 名 …`；
 * - 帽 4 行 + 溢出行「+ N 更多」；
 * - 与件 3 分职互补：状态行示「执行哪个工具」、本件行示「输出到哪了」。
 */
import { truncateToWidth, type CellBuffer, type Region, type Renderable } from '../../engine/index.js';

/** 帽内行数（溢出行另计——spec 定形） */
const MAX_ROWS = 4;

/**
 * update 载荷宽容解码 → 末行输出文本（null = 文本缺席）。
 * 网格行是单行物理面——string 形内部换行折叠空格（直显语义的物理收口）。
 */
export function decodeUpdateText(update: unknown): string | null {
  if (typeof update === 'string') {
    const collapsed = update.replaceAll('\n', ' ');
    return collapsed.trim() === '' ? null : collapsed;
  }
  // AgentToolResult 形：content 块数组——取文本块的行序列倒扫末条非空行
  if (typeof update === 'object' && update !== null && Array.isArray((update as { content?: unknown }).content)) {
    const lines: string[] = [];
    for (const block of (update as { content: readonly unknown[] }).content) {
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        lines.push(...(block as { text: string }).text.split('\n'));
      }
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (line !== '') return line;
    }
  }
  return null; // 数字/布尔/无文本块对象——文本缺席
}

/** 面板行（text null = 缺席退化形） */
interface ProgressRow {
  readonly toolCallId: string;
  readonly name: string;
  text: string | null;
}

/** 工具进度面板：正在流 partial 的工具各占一行（清板即零行） */
export class ToolProgressPanel implements Renderable {
  /** 建档表（toolCallId→名——start 建档反查；end/clear 同摘） */
  private readonly names = new Map<string, string>();
  private rows: ProgressRow[] = [];

  /** 建档不建行（工具名供 update 反查——无档退 toolCallId 防御路径） */
  begin(toolCallId: string, name: string): void {
    this.names.set(toolCallId, name);
  }

  /** update 消费：已有行原位换文本；无行建行（首 update 建行条款） */
  applyUpdate(toolCallId: string, update: unknown): void {
    const text = decodeUpdateText(update);
    const existing = this.rows.find((row) => row.toolCallId === toolCallId);
    if (existing !== undefined) {
      existing.text = text;
      return;
    }
    this.rows.push({ toolCallId, name: this.names.get(toolCallId) ?? toolCallId, text });
  }

  /** end 即摘行（建档同摘——迟到 update 无档退 id 名） */
  end(toolCallId: string): void {
    this.rows = this.rows.filter((row) => row.toolCallId !== toolCallId);
    this.names.delete(toolCallId);
  }

  /** 清板（行与建档同清——agent_start·end·repaint 瞬时面律） */
  clear(): void {
    this.rows = [];
    this.names.clear();
  }

  /** 量高：清板 0；帽内行数 + 溢出行 */
  measure(width: number): number {
    void width; // 行单行制——宽度不敏感（截断吸收）
    if (this.rows.length === 0) return 0;
    return Math.min(this.rows.length, MAX_ROWS) + (this.rows.length > MAX_ROWS ? 1 : 0);
  }

  /** 落位：每工具一行 ` ▸ 名 · 末行`（缺席 ` ▸ 名 …`）；溢出行收尾 */
  render(buffer: CellBuffer, region: Region): void {
    const visible = this.rows.slice(0, MAX_ROWS);
    visible.forEach((row, i) => {
      const tail = row.text !== null ? ` · ${row.text}` : ' …';
      buffer.writeText(region.row + i, region.col, truncateToWidth(` ▸ ${row.name}${tail}`, region.width));
    });
    const overflow = this.rows.length - MAX_ROWS;
    if (overflow > 0) {
      buffer.writeText(region.row + MAX_ROWS, region.col, `+ ${overflow} 更多`, { dim: true });
    }
  }
}
