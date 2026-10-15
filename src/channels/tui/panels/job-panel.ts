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
 *   行 › 记 + accent 着色；enter 开 /jobs 副屏定位该任务（消费位 backend
 *   openJobs）；escape 清光标（让路族）；
 * - 刷新时机归装配（backend renderFixed 帧首拉取 + job_settled 推送锚），
 *   件内零时钟零事件面。
 */
import { ellipsize, type CellBuffer, type CellStyle, type Region, type Renderable } from '../../engine/index.js';
import type { JobEntry, JobKind } from '../../../contracts/index.js';
import { formatElapsedCompact } from '../../../contracts/index.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import { DIM_STYLE } from '../../engine/index.js'; // 溢出行暗淡样式单源（注⑩收编）
import { activeRowStyleOf, CURSOR_MARK } from './panel-chrome.js';

/** 帽内行数（溢出行另计——07 §4.1 界面美化役批定值 5） */
const MAX_ROWS = 5;

/** kind 图标词汇（宽度 1 几何符——panel-chrome 图标收敛律同源：emoji 类不稳符弃用） */
const KIND_MARKS: Readonly<Record<JobKind, string>> = Object.freeze({
  subagent: '◆',
  issue: '■',
  trigger: '○',
});

/**
 * goal 面板行载荷（件 G——挖掘 45 轮：host 装配从 goal 域注入；与 host 侧
 * GoalRuntimeStatus 结构兼容的独立声明——词面独立律，channels 零业务
 * import，GoalJobsFace 两席窄面先例同律）。budgetCap null = 无帽（预算段
 * 缺席——无段不显律，retry 零重试同律）。
 */
export interface GoalPanelRow {
  readonly id: string;
  readonly objective: string;
  /** 三相：running 运行 / budget-paused 预算暂停 / stalled 停滞暂停 */
  readonly phase: 'running' | 'budget-paused' | 'stalled';
  /** 预算已用（本会话条数 + 后台代跑折叠条数——goal list 预算式同口径） */
  readonly budgetUsed: number;
  readonly budgetCap: number | null;
}

/** goal 段帽（持续背景态非活活动——帽 2 溢出指路 goal 命令，job 段帽 5 分职） */
const GOAL_MAX_ROWS = 2;

/** goal 相位记号（◇ 运行相——领域记号另册不入 job kind ◆■○ 集；⏸ 暂停两相同符——符号册预算停靠保留位兑现） */
const GOAL_MARKS: Readonly<Record<GoalPanelRow['phase'], string>> = Object.freeze({
  running: '◇',
  'budget-paused': '⏸',
  stalled: '⏸',
});

/**
 * 后台任务面板：running 快照 → 固定区行段（清板即零行——布局自洽）。
 * 光标态（批6 问题②）：激活后 › 记 + accent 在选行；行集收缩时夹取。
 */
export class JobPanel implements Renderable {
  private entries: readonly JobEntry[] = [];
  /** goal 持续段行集（件 G——帧首供给整体替换，与 job entries 分立两供给面） */
  private goalRows: readonly GoalPanelRow[] = [];
  /** 本地钟（时长计算基准——注入位测试确定性，件内零自驱时钟） */
  private readonly now: () => number;
  /** 光标位（null = 光标态未激活——alt+↑/↓ 首按激活置 0） */
  private cursor: number | null = null;
  /**
   * 可见窗容量（最近渲染帧的 visibleCount——光标域夹取同源；挖掘 27 轮
   * [9] 收口：挤压段高可见窗小于帽时，光标域随窗收（在选恒可见——enter
   * 有作用对象必屏上在）。首渲染前按帽（与旧形兼容）。
   */
  private visibleCapacity = MAX_ROWS;
  /** 在选行整行样式（theme 注入位——缺省 DEFAULT_THEME；R-9 换引单源升 bold） */
  private selectedStyle: Readonly<CellStyle> = activeRowStyleOf(DEFAULT_THEME);

  constructor(options: { readonly now: () => number }) {
    this.now = options.now;
  }

  /** 主题换装（backend injectTheme 单源路——accent 派生样式重建） */
  setTheme(theme: ResolvedTheme): void {
    this.selectedStyle = activeRowStyleOf(theme);
  }

  /**
   * 快照整体替换（null / undefined / 空表同义——清板）。终态防御性滤除
   * （running/stopping 之外不入行——防闪烁约件内自守，数据面混入不破形）。
   */
  update(entries: readonly JobEntry[] | null | undefined): void {
    this.entries = (entries ?? []).filter((entry) => entry.status === 'running' || entry.status === 'stopping');
    this.clampCursor();
  }

  /**
   * goal 持续段帧首供给（件 G——update 同族整体替换；null/undefined/空表同义
   * 清段）。**光标域不动**——clampCursor 只辖 job entries，goal 行不入光标域
   * （呈现投影非可操作实体）。
   */
  updateGoals(rows: readonly GoalPanelRow[] | null | undefined): void {
    this.goalRows = rows ?? [];
  }

  /** 量高：jobs 段（清板 0；帽内行数 + 溢出行）+ goal 段（帽 2 + 溢出行） */
  measure(_width: number): number {
    const jobsHeight =
      this.entries.length === 0
        ? 0
        : Math.min(this.entries.length, MAX_ROWS) + (this.entries.length > MAX_ROWS ? 1 : 0);
    const goalsHeight =
      this.goalRows.length === 0
        ? 0
        : Math.min(this.goalRows.length, GOAL_MAX_ROWS) + (this.goalRows.length > GOAL_MAX_ROWS ? 1 : 0);
    return jobsHeight + goalsHeight;
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
    // 光标域 = 可见窗内行（帽与可见窗容量的较小界——可见窗随帧同步，挤压
    // 期光标不漫游到屏外行）
    const limit = Math.min(this.entries.length, this.visibleCapacity) - 1;
    this.cursor = Math.max(0, Math.min(limit, this.cursor + delta));
    return true;
  }

  /** 清光标（escape 让路族）：在场才返 true（调用位按需触重画） */
  clearCursor(): boolean {
    if (this.cursor === null) return false;
    this.cursor = null;
    return true;
  }

  /** 落位：job 段每行 `{图标} {名} · {时长}[ · 重试 ×N]`（光标期在选行 › 记 + accent）+ 溢出行；goal 段 `{记号} 目标 {名} · 预算 {used}/{cap}[ · 暂停尾词]` 殿后 */
  render(buffer: CellBuffer, region: Region): void {
    // 早退闸（件 G 松改）：两段行集全空才整帧退——jobs 空而 goals 在场时
    // goal 段仍渲染（修前闸只判 entries 会把该形整帧吞掉）
    if (region.height <= 0 || (this.entries.length === 0 && this.goalRows.length === 0)) return;
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
    // 可见窗容量随帧同步（光标域夹取同源）+ 越界光标即帧夹取（先按键后
    // 渲染的残窗自守——本帧绘制用夹取前值，下一击/下一帧已在可见域）。
    // 零可见行（段高 1 挤压让位形）失位归 null 非 -1（挖掘 28 轮 [1]）：
    // clampCursor 的 limit<0→null 同形——cursorActive 只判非 null，-1 会使
    // enter 路由读 selectedId 取 entries[-1].id 抛 TypeError 杀进程
    this.visibleCapacity = visibleCount;
    if (this.cursor !== null && this.cursor > visibleCount - 1) {
      this.cursor = visibleCount > 0 ? visibleCount - 1 : null;
    }
    visible.forEach((entry, i) => {
      const selected = this.cursor === i;
      // 光标期首列 › 记（未激活零占列——无光标帧不缩内容预算）；内容预算 =
      // 宽 - 图标 2 列 - 光标列，省略形单源（0 宽守卫在源）
      const mark = KIND_MARKS[entry.kind];
      const duration = formatElapsedCompact(Math.max(0, this.now() - entry.startedAt));
      // 重试段（07 §4.1 V-0 注①聚合律——retry>0 追加；零重试缺席形无段不显 ×0）
      const retrySeg = entry.retry !== undefined && entry.retry > 0 ? ` · 重试 ×${entry.retry}` : '';
      const prefixWidth = this.cursor !== null ? 2 : 0;
      const content = ellipsize(`${entry.name} · ${duration}${retrySeg}`, region.width - 2 - prefixWidth);
      const row = this.cursor !== null ? `${selected ? CURSOR_MARK : ' '} ${mark} ${content}` : `${mark} ${content}`;
      buffer.writeText(region.row + i, region.col, row, selected ? this.selectedStyle : undefined);
    });
    // 溢出行对截断几何诚实：+ N 更多 = 帽/段高外未显行数（指路 /jobs 全量）；
    // ellipsize 收口（条目行同律——窄窗裸直写硬截断无省略号）
    let used = visibleCount;
    if (overflow > 0) {
      buffer.writeText(
        region.row + used,
        region.col,
        ellipsize(`+ ${overflow} 更多 · /jobs 查看`, region.width),
        DIM_STYLE,
      );
      used += 1;
    }
    // goal 持续段殿后（件 G）：jobs 段完整在前（活活动先、持续背景后——光标
    // 域连续性不被 goal 行打断）；goal 行不入光标域（恒零光标列，selected 恒
    // 假）。低段高挤压同 jobs 段律：段高与可见数同高时让一行给溢出行。
    let goalUsed = region.height - used;
    if (goalUsed <= 0) return;
    let goalVisible = Math.min(this.goalRows.length, GOAL_MAX_ROWS, goalUsed);
    const goalOverflow = this.goalRows.length - goalVisible;
    if (goalOverflow > 0 && goalVisible === goalUsed) {
      goalVisible -= 1;
    }
    for (const goal of this.goalRows.slice(0, goalVisible)) {
      // 预算段（无帽缺席——无段不显律）+ 暂停相尾词（运行相无尾词）
      const budgetSeg = goal.budgetCap !== null ? ` · 预算 ${goal.budgetUsed}/${goal.budgetCap}` : '';
      const pauseSeg = goal.phase === 'budget-paused' ? ' · 预算暂停' : goal.phase === 'stalled' ? ' · 停滞暂停' : '';
      const content = ellipsize(`目标 ${goal.objective}${budgetSeg}${pauseSeg}`, region.width - 2);
      buffer.writeText(region.row + used, region.col, `${GOAL_MARKS[goal.phase]} ${content}`);
      used += 1;
    }
    if (goalOverflow > 0) {
      buffer.writeText(
        region.row + used,
        region.col,
        ellipsize(`+ ${goalOverflow} 目标 · /goal 查看`, region.width),
        DIM_STYLE,
      );
    }
  }

  /** 行集收缩时光标夹取（update 后自守——越界即收到新末行） */
  private clampCursor(): void {
    if (this.cursor === null) return;
    const limit = Math.min(this.entries.length, this.visibleCapacity) - 1;
    this.cursor = limit < 0 ? null : Math.min(this.cursor, limit);
  }
}
