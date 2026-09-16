/**
 * 工具实时进度面板（07 §4.1 呈现面件 5）——状态行上方的瞬时活动面板。
 *
 * - 行生命周期：`tool_execution_start` 建档（toolCallId→名+参数快照——**不建
 *   行**，首个 `tool_execution_update` 才建行）/ 后续 update 原位换行 /
 *   `tool_execution_end` 即摘行 / `clear()` 清板（agent_start·end·repaint
 *   三时点——瞬时面律：不入正文、不跨 repaint 保存）；
 * - 宽容解码（update 载荷契约面 `unknown`——03 §2.3 自由载荷，呈现侧零
 *   契约收紧）：string 直显 / AgentToolResult 形〔content 块数组〕取文本块
 *   倒扫末条非空行 / 其余视为文本缺席退化为 ` ▸ 名 …`；
 * - 帽 4 行 + 溢出行「+ N 更多」；
 * - 与件 3 分职互补：状态行示「执行哪个工具」、本件行示「输出到哪了」；
 * - 插件面板行（2026-09-17 TUI 余量收官批③——07 §4.1 插件工具渲染钩子
 *   签名钉位）：行建行/原位换行时以当下快照现调 renderCall（tool_execution_
 *   update 驱动既有律不变——update 只驱时机不驱内容），行集命中即**整体
 *   替换该工具的面板行**（宿主 ` ▸ 名 · 末行` 形让位）、多行行集按视觉行
 *   计入面板帽 4 行；**零 update 的静默工具有进无面板行、renderCall 不触发**
 *   （在飞可见性归件 3 状态行不变）。回落恒在律：未命中/抛错/空行集 →
 *   宿主缺省形（try/catch 单源 pluginLinesOf）。tone → 语义键着色（渲染时
 *   以当下主题直取——行集是呈现态非事实源，不缓存）。
 */
import {
  stringWidth,
  truncateToWidth,
  type CellBuffer,
  type ColorValue,
  type Region,
  type Renderable,
} from '../../engine/index.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import { lookupToolRenderer, type RendererLine } from '../../renderers.js';

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

/** 建档条目（tool_execution_start 面事实——renderCall 在飞期快照的载荷源） */
interface ToolRecord {
  readonly name: string;
  readonly arguments: unknown;
}

/** 面板行（text null = 缺席退化形；lines null = 宿主形、非 null = 插件行集） */
interface ProgressRow {
  readonly toolCallId: string;
  readonly name: string;
  text: string | null;
  /** 插件行集（renderCall 现调产物——行集整体替换宿主面板行） */
  lines: readonly RendererLine[] | null;
}

/** 展开后的可视行（宿主形单行 / 插件行集逐行——帽与溢出按视觉行计） */
type VisualRow =
  { readonly kind: 'host'; readonly text: string } | { readonly kind: 'plugin'; readonly line: RendererLine };

/** 工具进度面板：正在流 partial 的工具各占一行（清板即零行） */
export class ToolProgressPanel implements Renderable {
  /** 建档表（toolCallId→名+参数快照——start 建档反查；end/clear 同摘） */
  private readonly records = new Map<string, ToolRecord>();
  private rows: ProgressRow[] = [];
  /**
   * 着色主题（插件段 tone → 语义键直取）：构造缺省 DEFAULT_THEME，tui-backend
   * injectTheme/applyPalette 换装注入（渲染时现取——主题换装下帧即生效）。
   */
  private theme: ResolvedTheme = DEFAULT_THEME;

  /** 主题注入（换装整体换引用——07 R2 纪律） */
  setTheme(theme: ResolvedTheme): void {
    this.theme = theme;
  }

  /** 建档不建行（名 + 参数快照供 update 反查——无档退 toolCallId 防御路径） */
  begin(toolCallId: string, name: string, args?: unknown): void {
    this.records.set(toolCallId, { name, arguments: args });
  }

  /** update 消费：已有行原位换行；无行建行（首 update 建行条款）。行内容 = 插件行集（命中）或宿主末行文本（回落） */
  applyUpdate(toolCallId: string, update: unknown): void {
    const text = decodeUpdateText(update);
    const existing = this.rows.find((row) => row.toolCallId === toolCallId);
    // 消费缝现调（07 钉位注）：行建行/原位换行两形都以当下快照调 renderCall
    const name = existing?.name ?? this.records.get(toolCallId)?.name ?? toolCallId;
    const lines = this.pluginLinesOf(toolCallId, name, this.records.get(toolCallId)?.arguments);
    if (existing !== undefined) {
      existing.text = text;
      existing.lines = lines;
      return;
    }
    this.rows.push({ toolCallId, name, text, lines });
  }

  /** end 即摘行（建档同摘——迟到 update 无档退 id 名） */
  end(toolCallId: string): void {
    this.rows = this.rows.filter((row) => row.toolCallId !== toolCallId);
    this.records.delete(toolCallId);
  }

  /** 清板（行与建档同清——agent_start·end·repaint 瞬时面律） */
  clear(): void {
    this.rows = [];
    this.records.clear();
  }

  /** 量高：清板 0；帽内视觉行数（插件多行行集逐行计）+ 溢出行 */
  measure(width: number): number {
    void width; // 行单行制——宽度不敏感（截断吸收）
    if (this.rows.length === 0) return 0;
    const total = this.visualRows().length;
    return Math.min(total, MAX_ROWS) + (total > MAX_ROWS ? 1 : 0);
  }

  /** 行集展开为可视行序列（宿主形 = ` ▸ 名 · 末行` 单行；插件行集 = 多行段序） */
  private visualRows(): VisualRow[] {
    const visual: VisualRow[] = [];
    for (const row of this.rows) {
      if (row.lines !== null) {
        for (const line of row.lines) visual.push({ kind: 'plugin', line });
        continue;
      }
      const tail = row.text !== null ? ` · ${row.text}` : ' …';
      visual.push({ kind: 'host', text: ` ▸ ${row.name}${tail}` });
    }
    return visual;
  }

  /**
   * renderCall 现调（回落恒在律单源 try/catch）：查表命中且钩子在场 → 以在飞
   * 期快照调用；非空行集 = 插件面板行。未命中 / 抛错 / 空行集 / 坏形返回 →
   * null 宿主形（插件渲染器结构性不可劣化呈现面）。
   */
  private pluginLinesOf(toolCallId: string, name: string, args: unknown): readonly RendererLine[] | null {
    const hook = lookupToolRenderer(name)?.renderCall;
    if (hook === undefined) return null; // 未命中 / renderCall 钩子缺席
    try {
      const lines = hook({ toolCallId, toolName: name, arguments: args });
      // 空行集回落 + 坏形返回（非数组/行非数组）同回落档——渲染路径零崩
      if (!Array.isArray(lines) || lines.length === 0) return null;
      if (!lines.every((line) => Array.isArray(line))) return null;
      return lines;
    } catch {
      return null; // 抛错回落（段取值坏形由渲染面 stringWidth 宽度吸收）
    }
  }

  /** 落位：可视行逐行写（段序按 tone 语义键着色、越宽截断）；溢出行收尾 */
  render(buffer: CellBuffer, region: Region): void {
    // 段内夹取（挂账解挂批 C②——固定区段优先级截断）：分配段高可低于
    // measure 原值（低段「缩」形）——可见行数按段高容量收，不越段写；
    // 溢出行仅在有富余行时收尾
    const capacity = Math.min(MAX_ROWS, region.height);
    const visual = this.visualRows();
    const shown = visual.slice(0, capacity);
    shown.forEach((row, i) => {
      const line = region.row + i;
      if (row.kind === 'host') {
        buffer.writeText(line, region.col, truncateToWidth(row.text, region.width));
        return;
      }
      // 插件行：段序逐段写（tone → 当下主题语义键直取；text/缺省无前景）
      let col = region.col;
      for (const seg of row.line) {
        const budget = region.col + region.width - col;
        if (budget <= 0) break; // 行宽帽收口
        const text = truncateToWidth(seg.text, budget);
        if (text !== '') {
          const fg: ColorValue | undefined = this.theme[seg.tone ?? 'text'];
          buffer.writeText(line, col, text, fg !== undefined ? { fg } : undefined);
          col += stringWidth(text);
        }
      }
    });
    const overflow = visual.length - shown.length;
    if (overflow > 0 && shown.length < region.height) {
      buffer.writeText(region.row + shown.length, region.col, `+ ${overflow} 更多`, { dim: true });
    }
  }
}
