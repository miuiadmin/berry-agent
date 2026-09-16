/**
 * todo 面板（07 §4.1 呈现面件 4）——输入框上方紧凑面板。
 *
 * - 数据面纯呈现投影：items 全量快照经 `update()` 整体替换（真源 = 装配
 *   注入的 todoFor——05 §1.1 todo/write 事件载荷的会话侧映射，webui SPA
 *   同源折叠产物）；空表与 null/undefined 同为清板；
 * - 条目四态记号：☐ 待办 / ◐ 进行中（activeForm 优先于 content——CC 式
 *   文案）/ ☑ 已完成·暗淡 / ⊙ 缓办·暗淡；
 * - 帽 6 条 + 溢出行「+ N 更多」（暗淡）；
 * - 刷新时机归装配（TuiBackend 三时点 repaint / tool_execution_end /
 *   agent_end——批 10e-2 已接线），件内零时钟零事件面。
 */
import { truncateToWidth, type CellBuffer, type Region, type Renderable } from '../../engine/index.js';
import type { TodoItem } from '../../types.js';

/** 帽内条数（溢出行另计——spec 定形不预收数字者已实测定形 6） */
const MAX_ITEMS = 6;

/** 四态记号（呈现投影——07 §4.1 件 4 定形） */
const STATUS_MARKS: Readonly<Record<TodoItem['status'], string>> = Object.freeze({
  pending: '☐',
  'in-progress': '◐',
  completed: '☑',
  deferred: '⊙',
});

/** 暗淡两态（已完成 / 缓办——退场视觉语义） */
const DIM_STATUSES: ReadonlySet<TodoItem['status']> = new Set(['completed', 'deferred']);

/** todo 面板：条目快照 → 固定区行段（清板即零行——布局自洽） */
export class TodoPanel implements Renderable {
  private items: readonly TodoItem[] = [];

  /** 快照整体替换（null / undefined / 空表同义——清板） */
  update(items: readonly TodoItem[] | null | undefined): void {
    this.items = items ?? [];
  }

  /** 量高：清板 0；帽内条数 + 溢出行 */
  measure(width: number): number {
    void width; // 条目单行制——宽度不敏感（内容截断吸收）
    if (this.items.length === 0) return 0;
    return Math.min(this.items.length, MAX_ITEMS) + (this.items.length > MAX_ITEMS ? 1 : 0);
  }

  /** 落位：每条一行（记号 + 空格 + 内容截断）；溢出行收尾 */
  render(buffer: CellBuffer, region: Region): void {
    // 段内夹取（挂账解挂批 C②——固定区段优先级截断）：分配到的段高可低于
    // measure 原值（低段「缩」形）——可见条数按段高容量收，Renderable 契约
    // 只写自己区域内（不越段写）；溢出行仅在有富余行时收尾
    const capacity = Math.min(MAX_ITEMS, region.height);
    const visible = this.items.slice(0, capacity);
    visible.forEach((item, i) => {
      const dimmed = DIM_STATUSES.has(item.status);
      // 进行中 activeForm 优先（缺席回落 content）
      const content = item.status === 'in-progress' && item.activeForm !== undefined ? item.activeForm : item.content;
      const row = `${STATUS_MARKS[item.status]} ${truncateToWidth(content, region.width - 2)}`;
      buffer.writeText(region.row + i, region.col, row, dimmed ? { dim: true } : undefined);
    });
    // 溢出行对截断几何诚实：+ N 更多数 = 帽/段高外未显条数（非截断几何下
    // capacity = MAX_ITEMS——与既有行为逐字相同）
    const overflow = this.items.length - capacity;
    if (overflow > 0 && visible.length < region.height) {
      buffer.writeText(region.row + visible.length, region.col, `+ ${overflow} 更多`, { dim: true });
    }
  }
}
