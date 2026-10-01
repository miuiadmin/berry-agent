/**
 * 后台任务面板（界面美化役批6——07 §4.1「UX 五问题批」问题②拍板：JobPanel
 * 固定区段，todo-panel 克隆形）。
 *
 * - 数据面纯呈现投影：running 快照经 `update()` 整体替换（真源 = 装配注入
 *   的 jobs pull 闭包——Job 注册表内存面，backend 拉取前已滤 running）；
 *   **终态条目不进**（防闪烁——settle 瞬间行消失比行变灰再消失更稳，全量
 *   史走 /jobs 副屏）；件内防御性再滤（running/stopping 之外不入行——数据
 *   面混入终态也不破防闪烁约）；空表与 null/undefined 同为清板；
 * - 行形 `{图标} {名} · {时长}`（图标按 kind：◆ 子代理 / ■ 议题 / ○ 触发器
 *   ——宽度 1 几何符，emoji 类宽度不稳符弃用）；时长单源
 *   formatElapsedCompact（任务行括号段同源）；名超宽省略形收口（截断省略
 *   号全域统一律）；
 * - 帽 5 行 + 溢出行「+ N 更多 · /jobs 查看」（暗淡）；
 * - **光标翻页态一期直接做**（问题②拍板「不分二期」）：alt+↑/↓ 激活/移动
 *   段内光标（键路由在 backend 层③.5——本件零键知识，只持光标态），在选
 *   行 ▸ 记 + accent 着色；enter 开 /jobs 副屏定位该任务（消费位 backend
 *   openJobs）；escape 清光标（让路族）；
 * - 刷新时机归装配（backend renderFixed 帧首拉取 + job_settled 推送锚），
 *   件内零时钟零事件面。
 */
import { ellipsize, type CellBuffer, type CellStyle, type Region, type Renderable } from '../../engine/index.js';
import type { JobEntry, JobKind } from '../../../contracts/index.js';
import { formatElapsedCompact } from '../status/task-status-line.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';

/** 帽内行数（溢出行另计——07 §4.1 界面美化役批定值 5） */
const MAX_ROWS = 5;

/** kind 图标词汇（宽度 1 几何符——panel-chrome 图标收敛律同源：emoji 类不稳符弃用） */
const KIND_MARKS: Readonly<Record<JobKind, string>> = Object.freeze({
  subagent: '◆',
  issue: '■',
  trigger: '○',
});

/** 暗淡样式（溢出行） */
const DIM_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });

/** 在选行记号（panel-chrome 光标符统一律同形——件内自持单源引形） */
const CURSOR_MARK = '▸';

/**
 * 后台任务面板：running 快照 → 固定区行段（清板即零行——布局自洽）。
 * 光标态（批6 问题②）：激活后 ▸ 记 + accent 在选行；行集收缩时夹取。
 */
export class JobPanel implements Renderable {
  private entries: readonly JobEntry[] = [];
  /** 本地钟（时长计算基准——注入位测试确定性，件内零自驱时钟） */
  private readonly now: () => number;
  /** 光标位（null = 光标态未激活——alt+↑/↓ 首按激活置 0） */
  private cursor: number | null = null;
  /** 在选行 accent 样式（theme 注入位——缺省 DEFAULT_THEME） */
  private selectedStyle: Readonly<CellStyle> = Object.freeze({ fg: DEFAULT_THEME.accent });

  constructor(options: { readonly now: () => number }) {
    this.now = options.now;
  }

  /** 主题换装（backend injectTheme 单源路——accent 派生样式重建） */
  setTheme(theme: ResolvedTheme): void {
    this.selectedStyle = Object.freeze({ fg: theme.accent });
  }

  /**
   * 快照整体替换（null / undefined / 空表同义——清板）。终态防御性滤除
   * （running/stopping 之外不入行——防闪烁约件内自守，数据面混入不破形）。
   */
  update(entries: readonly JobEntry[] | null | undefined): void {
    this.entries = (entries ?? []).filter((entry) => entry.status === 'running' || entry.status === 'stopping');
    this.clampCursor();
  }

  /** 量高：清板 0；帽内行数 + 溢出行（溢出行 dim 收尾） */
  measure(_width: number): number {
    if (this.entries.length === 0) return 0;
    return Math.min(this.entries.length, MAX_ROWS) + (this.entries.length > MAX_ROWS ? 1 : 0);
  }

  /** 行集在场观测（键路由消费——空段不劫 alt+↑/↓，编辑器既有键零让位） */
  get hasRows(): boolean {
    return this.entries.length > 0;
  }

  /** 光标激活态观测（enter/escape 路由消费——未激活不劫 enter） */
  get cursorActive(): boolean {
    return this.cursor !== null;
  }

  /** 在选任务 id（enter 定位开屏消费；未激活/空集 = null） */
  get selectedId(): string | null {
    if (this.cursor === null || this.entries.length === 0) return null;
    return this.entries[Math.min(this.cursor, this.entries.length - 1)]!.id;
  }

  /**
   * 光标移动（alt+↑/↓——backend 层③.5 直达）：未激活首按激活置 0（↑/↓ 同位
   * ——首按即见光标在首行，再按才移动）；激活后按 delta 界夹取。返 false =
   * 空集零动作（调用位不劫键）。
   */
  moveCursor(delta: number): boolean {
    if (this.entries.length === 0) return false;
    if (this.cursor === null) {
      this.cursor = 0; // 首按激活置 0（首行之上无路——↑ 同位）
      return true;
    }
    const limit = Math.min(this.entries.length, MAX_ROWS) - 1; // 溢出行不可选——帽内行是光标域
    this.cursor = Math.max(0, Math.min(limit, this.cursor + delta));
    return true;
  }

  /** 清光标（escape 让路族）：在场才返 true（调用位按需触重画） */
  clearCursor(): boolean {
    if (this.cursor === null) return false;
    this.cursor = null;
    return true;
  }

  /** 落位：每行 `{图标} {名} · {时长}`（光标期在选行 ▸ 记 + accent）；溢出行收尾 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height <= 0 || this.entries.length === 0) return;
    // 段内夹取（todo-panel 同律）：分配到的段高可低于 measure 原值（低段
    // 「缩」形）——可见行数按段高容量收，Renderable 契约只写自己区域内。
    // 段高压缩到与可见数同高时让出一行给溢出行（诚实指路优于多看一行——
    // 挤压期全量史更在 /jobs 副屏）
    const capacity = Math.min(MAX_ROWS, region.height);
    let visibleCount = Math.min(this.entries.length, capacity);
    let overflow = this.entries.length - visibleCount;
    if (overflow > 0 && visibleCount === region.height) {
      visibleCount -= 1;
      overflow += 1;
    }
    const visible = this.entries.slice(0, visibleCount);
    visible.forEach((entry, i) => {
      const selected = this.cursor === i;
      // 光标期首列 ▸ 记（未激活零占列——无光标帧不缩内容预算）；内容预算 =
      // 宽 - 图标 2 列 - 光标列，省略形单源（0 宽守卫在源）
      const mark = KIND_MARKS[entry.kind];
      const duration = formatElapsedCompact(Math.max(0, this.now() - entry.startedAt));
      const prefixWidth = this.cursor !== null ? 2 : 0;
      const content = ellipsize(`${entry.name} · ${duration}`, region.width - 2 - prefixWidth);
      const row = this.cursor !== null ? `${selected ? CURSOR_MARK : ' '} ${mark} ${content}` : `${mark} ${content}`;
      buffer.writeText(region.row + i, region.col, row, selected ? this.selectedStyle : undefined);
    });
    // 溢出行对截断几何诚实：+ N 更多 = 帽/段高外未显行数（指路 /jobs 全量）
    if (overflow > 0) {
      buffer.writeText(region.row + visibleCount, region.col, `+ ${overflow} 更多 · /jobs 查看`, DIM_STYLE);
    }
  }

  /** 行集收缩时光标夹取（update 后自守——越界即收到新末行） */
  private clampCursor(): void {
    if (this.cursor === null) return;
    const limit = Math.min(this.entries.length, MAX_ROWS) - 1;
    this.cursor = limit < 0 ? null : Math.min(this.cursor, limit);
  }
}
