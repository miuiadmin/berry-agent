/**
 * /memory 轻管理面副屏件（06 §7 `/memory` TUI 形态定形注——mm 批落码腿）：
 * 副屏内容件（OverlayContent——经 AltScreenHost 装载入 1049 备屏，与
 * /history 回看器同基建同键面）。
 *
 * - **视图三段式**（定形注②）：头行（档名 + owner 并集短显——project 键
 *   16 hex 截前 8 位）→ 健康投影两行（overview().health 五计数**恒全库口径**
 *   ——全库不分 owner 假精度既有裁决，无参即正形勿对齐）→ 三分区列表
 *   （活体区〔listVisible 滤除 frozen 位〕→ 冻结区〔listVisible 滤出 frozen
 *   位、行首 ✱〕→ 终态区〔listForExport 客户端 ownerKey + status ∈
 *   {dismissed, expired} 双过滤；TTL 未物化 active 行三区皆不进〕）；
 *   条目行与工具读面同形（`[m:短id] [kind] summary  id=<完整id>
 *   updated=<ISO>`——p-1 批时效尾缀同源），读出消毒经注入的 §8.2 统一函数
 *   罩住（secret 命中遮蔽原文保留 id 操作面、指令样命中引述注记）；
 * - **键面动词族**（定形注③）：行动词 f（冻结切换——呈现层判向调
 *   freeze/unfreeze，终态行零义吞）/ d（忘掉——confirm 两段式；终态行零义
 *   吞、冻结行零义吞 + 底行提示「先 f 解冻」）/ r（恢复——终态行免
 *   confirm，active 行零义吞）；全局动词 e（副屏内嵌输入行走 /memory-export
 *   真身同一函数——argv 引号感知切分与命令分发同源）/ Tab（筛选循环
 *   全部→活体→冻结→终态）。光标只在条目行间移动（↑/↓ 循环——分区头/
 *   投影行非可指行）；PgUp/PgDn/Home/End 与滚轮归 ScrollView 滚动路；
 * - **confirm 副屏内嵌行**（定形注④）：主屏浮层在副屏在场时物理不可见 +
 *   走通道 ask 原语会触发 ask 强制收起先收副屏——故收口为副屏内嵌行
 *   （底行确认文案；键面语义同 ConfirmPanel：Enter/y 确认、Esc/n 取消、
 *   单次保守值）；确认执行 forget(id) 缺省 supersededBy='user'，守卫错折
 *   底行；
 * - **刷新语义**（定形注⑤）：开屏快照 + 动词成功后整表重取重建、重取同 id
 *   锚定、锚定目标不在筛选可见集驻留原位就近、零条目可见行动词消隐
 *   （底行动态呈现按光标行分区给键面提示）；他路写入不实时进屏（挂账）；
 * - **单源执法**（定形注⑥）：键面动词全走 DAO 既有族（零新 DAO 方法）、
 *   导出走注入的 /memory-export 处理器闭包（真身同一函数）、用户直发零
 *   审批对、零新审计词；
 * - **鼠标消费面**（07 篇屏模型双形态节同批回写）：滚轮滚动（ScrollView
 *   统一路）+ 左键点条目行 = 光标移至该行；头行/健康投影区/底铬/滚动条列
 *   命中零动作；拖选复制不进 v1（操作面非回看面——挂账随真实需求再裁）；
 * - **退出键面**：q/Esc 退出（确认态/输入态在场时让位——Esc 先收模态）、
 *   Ctrl+C 打断（滤 kitty release）、Ctrl+D 退出进程（先收副屏再转退出柄；
 *   输入行有文不退——主屏空框闸同律）。
 *
 * DAG 注记：本件不 import memory 域（02 §4.1 边表——channels 无 memory
 * 边是刻意设计）：DAO/行形经手写结构相容窄面（TS 鸭子型装配零胶水——
 * MemoryDaoFace 与 memory 域 MemoryDao 单实现律互证），消毒函数与导出
 * 命令经依赖倒置注入（装配面传真身——「同一函数」由装配保证）。
 */
import type { CellBuffer, CellStyle, InputEvent, MouseEvent, Region } from '../../engine/index.js';
import { ScrollView } from '../scroll/scroll-view.js';
import { Editor } from '../editor/editor.js';
import { prefixDisplayWidth, type VisualSegment } from '../editor/visual-lines.js';
import { shortIdOf } from '../backend/transcript.js';
import type { StyledLine } from '../backend/ansi-rows.js';
import type { OverlayContent } from '../overlay/overlay.js';
import { tokenize } from '../../commands.js';

/* ---------------- 结构相容窄面（channels 不依赖 memory——边表执法） ---------------- */

/** 记忆行呈现窄面（MemoryRow 子集 + content——消毒入检需要；结构相容真身） */
export interface MemoryRowFace {
  readonly id: string;
  readonly ownerKey: string;
  readonly kind: string;
  readonly summary: string;
  readonly content: string;
  readonly status: 'active' | 'dismissed' | 'expired';
  /** 终态来源记号：'auto_resolved' | 'user' | 'llm:<id>' | 'ttl' | 'skill:<名>'（active 行 null） */
  readonly supersededBy: string | null;
  /** Unix 毫秒 */
  readonly updatedAt: number;
  /** 冻结位（0/1） */
  readonly frozen: boolean;
}

/** 健康五计数窄面（恒全库口径——overview 无参形） */
export interface MemoryHealthFace {
  readonly active: number;
  readonly dismissed: number;
  readonly expired: number;
  readonly frozen: number;
  readonly total: number;
}

/**
 * DAO 窄面（结构相容 memory 域 MemoryDao——方法双变下窄参数/宽返回可并；
 * 管理面只消费既有动词族，零新方法条款的码面形）。
 */
export interface MemoryDaoFace {
  /** 可见行（active AND (frozen OR 未过期)，updated_at DESC——活体/冻结两分区单源） */
  listVisible(ownerKeys?: readonly string[]): readonly MemoryRowFace[];
  /** 全库全状态行（终态区客户端双过滤的数据源） */
  listForExport(ownerKey?: string): readonly MemoryRowFace[];
  /** 整面（health 五计数恒全库口径） */
  overview(ownerKeys?: readonly string[]): { readonly health: MemoryHealthFace };
  /** 忘掉（缺省 supersededBy='user'；frozen 拒 MEMORY_FROZEN；终态短路幂等） */
  forget(id: string, opts?: { readonly supersededBy?: string }): MemoryRowFace;
  /** 恢复（状态复活腿免 revision；幂等） */
  restore(id: string, revision?: number): MemoryRowFace;
  /** 冻结（幂等——纯持有面不动 updated_at） */
  freeze(id: string): MemoryRowFace;
  /** 解冻（幂等——解冻即按 ttl_days 重算钟） */
  unfreeze(id: string): MemoryRowFace;
}

/** 读出消毒函数面（§8.2 统一函数注入位——装配传真身保持「同一函数」） */
export type MemorySanitize = (entry: { readonly summary: string; readonly content?: string }) => {
  readonly blocked: boolean;
  readonly patterns: readonly string[];
  readonly quoted: boolean;
};

/** 数据材料位（TuiBackend 后置注入面 setMemoryScreen 的载荷——装配根 boot 后从服务面传真身） */
export interface MemoryViewerDataDeps {
  /** owner 并集（['global', 'project:<16hex>']——两分区过滤 + 头行短显） */
  readonly ownerKeys: readonly string[];
  readonly dao: MemoryDaoFace;
  /** 读出消毒（§8.2 统一函数——真身由装配注入） */
  readonly sanitize: MemorySanitize;
  /** 导出命令（/memory-export 处理器装配闭包——真身同一函数；argv 引号感知切分同源） */
  readonly exportCommand: (argv: readonly string[]) => Promise<string>;
}

/** 管理面装配选项（数据材料 + 退出三柄——三柄归 TuiBackend 装配闭包） */
export interface MemoryViewerOptions extends MemoryViewerDataDeps {
  /** 退出管理面（q/Esc/Ctrl+D——装配接线：收副屏〔AltScreenHost close〕） */
  readonly onExit: () => void;
  /** 打断在飞 run（Ctrl+C 副屏键面补丁——零参形：装配闭包已知目标会话） */
  readonly onInterrupt?: () => void;
  /** 退出进程（Ctrl+D——先收副屏〔onExit 已先调〕再转装配退出柄） */
  readonly onQuit?: () => void;
}

/* ---------------- 词面常量 ---------------- */

/** 分区三值（筛选循环面 + 条目归属） */
type Section = 'active' | 'frozen' | 'terminal';

/** 筛选四态循环序（全部→活体→冻结→终态→全部——Tab 单步右移） */
const FILTER_CYCLE: readonly ('all' | Section)[] = ['all', 'active', 'frozen', 'terminal'];

/** 分区呈现名（分区头 + 筛选注记共用单源） */
const SECTION_LABEL: Readonly<Record<Section, string>> = Object.freeze({
  active: '活体',
  frozen: '冻结',
  terminal: '终态',
});

/** 提示行样式（dim——存在感弱于正文；分区头/投影行同载体） */
const DIM_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 光标行反色样式（整行最强存在感——SelectPanel 高亮行同载体） */
const CURSOR_STYLE: Readonly<CellStyle> = Object.freeze({ inverse: true });

/** 常态底行键面提示（按光标行分区动态铸造——零条目可见时行动词消隐） */
function hintText(section: Section | null): string {
  const verbs =
    section === null
      ? ''
      : section === 'active'
        ? 'f 冻结 · d 忘掉 · '
        : section === 'frozen'
          ? 'f 解冻 · '
          : 'r 恢复 · ';
  return `${verbs}e 导出 · tab 筛选 · q/esc 返回`;
}

/** owner 键短显（头行——project 键 16 hex 截前 8 位，引用短 id 同款 8 位惯例） */
function ownerLabel(key: string): string {
  if (key.startsWith('project:')) return `project:${key.slice('project:'.length, 'project:'.length + 8)}`;
  return key; // global（及未来他形）原样——project 之外的键无哈希面
}

/** epoch 毫秒 → ISO UTC（tools.ts fmt 同式——呈现换算面同源注记） */
function fmtTs(ts: number): string {
  return new Date(ts).toISOString().replace('.000Z', 'Z');
}

/** key 事件窄化（text/ime/paste 归各分路） */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/** 错误折底行文案（守卫错人读面——码与人读原因直呈，同命令面 idiom） */
function errorText(err: unknown): string {
  if (err instanceof Error && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return `${(err as { code: string }).code}：${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** 可见条目描述（分区归属 + 行集锚——光标模型与点击反查的统一形） */
interface EntryDesc {
  readonly row: MemoryRowFace;
  readonly section: Section;
  /** 本条目行在逻辑行集里的下标（ensureVisible 与鼠标点击反查锚） */
  readonly lineIndex: number;
}

/**
 * 管理面内容件：ScrollView 子类（滚动/折叠/偏移算术继承）+ OverlayContent
 * （副屏 root——render 直收全屏 region）。
 */
export class MemoryViewer extends ScrollView implements OverlayContent {
  private readonly ownerKeys: readonly string[];
  private readonly dao: MemoryDaoFace;
  private readonly sanitize: MemorySanitize;
  private readonly exportCommand: (argv: readonly string[]) => Promise<string>;
  private readonly onExit: (() => void) | undefined;
  private readonly onInterrupt: (() => void) | undefined;
  private readonly onQuit: (() => void) | undefined;

  /* ---- 视图态（rebuild 全量重建——动词后整表重取） ---- */
  private styledLines: readonly StyledLine[] = [];
  private entries: readonly EntryDesc[] = [];
  /** 光标（entries 下标；-1 = 零条目可见无处可指） */
  private cursor = -1;
  /** 健康五计数（投影两行数据源） */
  private health: MemoryHealthFace = { active: 0, dismissed: 0, expired: 0, frozen: 0, total: 0 };
  /** 筛选态（Tab 循环） */
  private filter: 'all' | Section = 'all';

  /* ---- 模态两态（互斥：确认态与输入态不并在场——开其一先收另一） ---- */
  /** 确认态（d 两段式——目标条目非空即在态） */
  private confirmTarget: MemoryRowFace | null = null;
  /** 输入态（e 导出参数行在场位） */
  private exportOpen = false;
  private readonly exportEditor: Editor;
  /** 底行一次性提示（守卫错/导出回执/解冻指引——常态下次按键即清） */
  private notice: string | null = null;
  /** 退出闭锁（同批多事件只退一次——q 与 Esc 竞发的防御位） */
  private exited = false;

  constructor(options: MemoryViewerOptions) {
    super(); // 无 maxHeight——副屏 root 直收 region 全高
    this.ownerKeys = options.ownerKeys;
    this.dao = options.dao;
    this.sanitize = options.sanitize;
    this.exportCommand = options.exportCommand;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.exportEditor = new Editor({ maxVisibleLines: 1 }); // 单行档——导出参数行
    this.exportEditor.setFocused(false);
    this.rebuild(); // 开屏快照（光标落首条——顶部对齐）
  }

  /** 量高：头行 + 视口全量 + 底铬（输入态 = Editor；其余恒 1 行） */
  measure(width: number): number {
    return 1 + super.measure(width) + (this.exportOpen ? this.exportEditor.measure(width) : 1);
  }

  /**
   * 落位（副屏全屏 region 三段）：头行（档名 + owner 短显 + 筛选注记）→
   * 滚动视口（super.render——投影两行/分区头/条目行全在内，折叠与偏移恒归
   * ScrollView）→ 底铬（输入态 = 单行 Editor；确认态 = 确认文案；否则
   * 一次性提示 ?? 动态键面提示）。
   */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端——头行 + 视口都不够）
    // 头行（筛选态在场时附注记——Tab 动作的可视反馈位）
    const filterTag = this.filter === 'all' ? '' : ` ·〔筛选：${SECTION_LABEL[this.filter]}〕`;
    buffer.writeText(region.row, region.col, `❄ 记忆管理 · ${this.ownerKeys.map(ownerLabel).join(' · ')}${filterTag}`);
    // 滚动视口
    const chromeBottom = this.exportOpen ? this.exportEditor.measure(region.width) : 1;
    const viewHeight = region.height - 1 - chromeBottom;
    if (viewHeight > 0) {
      super.render(buffer, { row: region.row + 1, col: region.col, width: region.width, height: viewHeight });
    }
    // 底铬
    if (this.exportOpen) {
      this.exportEditor.setFocused(true);
      this.exportEditor.render(buffer, {
        row: region.row + region.height - chromeBottom,
        col: region.col,
        width: region.width,
        height: chromeBottom,
      });
      return;
    }
    const bottom =
      this.confirmTarget !== null
        ? `忘掉 [m:${shortIdOf(this.confirmTarget.id)}]？enter/y 确认 · esc/n 取消`
        : (this.notice ?? hintText(this.cursorEntry()?.section ?? null));
    buffer.writeText(region.row + region.height - 1, region.col, bottom, DIM_STYLE);
  }

  /**
   * 事件分发（副屏内容终局消费——未消费键不穿透，模态独占）。
   * 序：Ctrl+C/Ctrl+D 副屏键面补丁 → Tab 全局动词（输入态仍可达——Editor
   * 不消费 Tab）→ 输入态模态 → 确认态模态 → 常态（退出键/行动词/光标键
   * → ScrollView 滚动路）。
   */
  handleEvent(event: InputEvent): boolean {
    if (event.kind === 'mouse') return this.handleMouse(event); // mouse 路（终局消费）
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      // Ctrl+C = 打断在飞 run（press/repeat 相动作滤 kitty release——主屏同键面）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        this.onInterrupt?.();
        return true;
      }
      // Ctrl+D = 退出进程（先收副屏再转退出柄；输入行有文不退——主屏空框闸同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'd' && this.exportEditor.model.isEmpty()) {
        this.exit();
        this.onQuit?.();
        return true;
      }
      // Tab 全局动词：筛选循环单步（输入态在场仍可达——Editor 不消费 Tab，
      // 与 /history 搜索框键面无冲突的判据面）
      if (isPlainKey(k, 'tab')) {
        this.closeModals();
        this.cycleFilter();
        return true;
      }
    }
    // 输入态（e 导出参数行）——模态：Esc 关 / Enter 执行 / 其余入 Editor
    if (this.exportOpen) {
      if (k !== null && k.phase !== 'release' && !k.ctrl && !k.alt && !k.meta) {
        if (isPlainKey(k, 'escape')) {
          this.closeExport();
          return true;
        }
        if (isPlainKey(k, 'enter')) {
          void this.runExport();
          return true;
        }
      }
      this.exportEditor.handleEvent(event);
      return true;
    }
    // 确认态（d 两段式）——模态：Enter/y 确认 / Esc/n 取消（保守值）/ 其余吞
    //（y/n 双轨同判——kitty 轨纯键打字走 text 事件，与常态行动词同律）
    if (this.confirmTarget !== null) {
      const typed = event.kind === 'text' ? event.text : null;
      if (k !== null && k.phase !== 'release') {
        if (isPlainKey(k, 'enter') || isPlainKey(k, 'y')) {
          this.commitForget();
          return true;
        }
        if (isPlainKey(k, 'escape') || isPlainKey(k, 'n')) {
          this.confirmTarget = null; // 取消——保守值收场
          return true;
        }
      }
      if (typed === 'y') {
        this.commitForget();
        return true;
      }
      if (typed === 'n') {
        this.confirmTarget = null; // 取消——保守值收场
        return true;
      }
      return true; // 未消费键层内终局（模态）
    }
    // 常态：退出键与行动词双轨（kitty disambiguate 轨纯键打字走 text 事件、
    // legacy 轨走 key 事件——同一动作两轨同判，HistoryViewer q 键同律）
    this.notice = null; // 一次性提示读毕即清（动词自身的新提示随后覆写）
    if (k !== null && k.phase !== 'release') {
      if (isPlainKey(k, 'escape')) {
        this.exit();
        return true;
      }
      if (isPlainKey(k, 'up')) {
        this.moveCursor(-1);
        return true;
      }
      if (isPlainKey(k, 'down')) {
        this.moveCursor(1);
        return true;
      }
      if (isPlainKey(k, 'f')) {
        this.applyFreezeToggle();
        return true;
      }
      if (isPlainKey(k, 'd')) {
        this.beginForget();
        return true;
      }
      if (isPlainKey(k, 'r')) {
        this.applyRestore();
        return true;
      }
      if (isPlainKey(k, 'e')) {
        this.openExport();
        return true;
      }
    }
    if (event.kind === 'text') {
      const ch = event.text;
      if (ch === 'q') {
        this.exit();
        return true;
      }
      if (ch === 'f') {
        this.applyFreezeToggle();
        return true;
      }
      if (ch === 'd') {
        this.beginForget();
        return true;
      }
      if (ch === 'r') {
        this.applyRestore();
        return true;
      }
      if (ch === 'e') {
        this.openExport();
        return true;
      }
    }
    // 滚动键（PgUp/PgDn/Home/End——↑/↓ 已被光标消费；未消费键终局吞）
    super.handleEvent(event);
    return true;
  }

  /* ---------------- 鼠标消费面（07 屏模型双形态节同批回写） ---------------- */

  /**
   * mouse 事件路（终局消费——模态独占）：滚轮归 ScrollView（统一滚动路）；
   * 左键点条目行 = 光标移至该行（点击反查经视口段映射到逻辑行，再对
   * entries 锚比对——非条目行零动作）；头行/底铬/滚动条列/非左键零动作吞。
   */
  private handleMouse(event: MouseEvent): boolean {
    if (event.button === 'wheel-up' || event.button === 'wheel-down') {
      super.handleEvent(event); // 滚轮消费路（±3 视觉行——显式滚动路）
      return true;
    }
    if (event.phase !== 'press') return true; // motion/release 零动作（无拖选面 v1）
    if (this.exportOpen || this.confirmTarget !== null) return true; // 模态在场零动作吞
    if (event.button !== 'left') return true; // v1 只有左键消费——中/右零动作
    const geo = this.viewportGeometry;
    if (event.row < 1 || event.row >= 1 + geo.height) return true; // 头行/底铬命中零动作
    if (this.hitScrollbar(event.col)) return true; // 滚动条列零动作
    const seg = this.segmentAt(event.row - 1); // 视口首行 = region.row + 1
    if (seg === null) return true;
    const idx = this.entries.findIndex((e) => e.lineIndex === seg.line);
    if (idx >= 0) this.cursor = idx; // 条目行命中——光标移至该行；分区头/投影行不指
    return true;
  }

  /* ---------------- 行动词（f/d/r——单源走 DAO 既有族） ---------------- */

  /** f：冻结切换（呈现层判向——frozen 行 unfreeze、active 行 freeze；终态行零义吞） */
  private applyFreezeToggle(): void {
    const entry = this.cursorEntry();
    if (entry === undefined || entry.section === 'terminal') return; // 终态行 f 零义吞
    try {
      if (entry.section === 'frozen') this.dao.unfreeze(entry.row.id);
      else this.dao.freeze(entry.row.id);
      this.rebuild(entry.row.id); // 同 id 锚定（frozen 位变即换分区呈现）
    } catch (err) {
      this.notice = errorText(err); // 守卫错折底行
    }
  }

  /** d：忘掉起手（active 行入确认态；终态行零义吞；冻结行零义吞 + 底行指引） */
  private beginForget(): void {
    const entry = this.cursorEntry();
    if (entry === undefined || entry.section === 'terminal') return; // 终态行 d 零义吞
    if (entry.section === 'frozen') {
      this.notice = '已冻结——先 f 解冻再忘掉';
      return;
    }
    this.confirmTarget = entry.row; // 确认态（两段式第二段）
  }

  /** 确认态落子：forget(id) 缺省 supersededBy='user'（撤回后条目呈终态区——r 可复） */
  private commitForget(): void {
    const target = this.confirmTarget;
    this.confirmTarget = null; // 单次语义（先出态——守卫错也不再回确认态）
    if (target === null) return;
    try {
      this.dao.forget(target.id, { supersededBy: 'user' });
      this.rebuild(target.id); // 同 id 锚定（filter=all 时条目现于终态区）
    } catch (err) {
      this.notice = errorText(err); // 守卫错折底行（MEMORY_FROZEN 等）
    }
  }

  /** r：恢复（终态行免 confirm 直接 restore；active 行零义吞） */
  private applyRestore(): void {
    const entry = this.cursorEntry();
    if (entry === undefined || entry.section !== 'terminal') return; // active 行 r 零义吞
    try {
      this.dao.restore(entry.row.id);
      this.rebuild(entry.row.id); // 同 id 锚定（复活后现于活体区）
    } catch (err) {
      this.notice = errorText(err);
    }
  }

  /* ---------------- 全局动词（e/Tab） ---------------- */

  /** e：开导出参数输入行（/memory-export 真身同一函数——参数面与命令面同形） */
  private openExport(): void {
    this.confirmTarget = null; // 模态互斥（先收另一态）
    this.exportOpen = true;
    this.exportEditor.setFocused(true);
  }

  /** 关输入行（查询文本保留——重开续打的增量延续，/history 搜索框同律） */
  private closeExport(): void {
    this.exportOpen = false;
    this.exportEditor.setFocused(false);
  }

  /**
   * 执行导出：输入行文本 → 引号感知切分（命令分发同源 tokenize）→ 注入的
   * 处理器闭包；回执折底行（多行以 · 连呈——底行单行面）。fire-and-forget：
   * 命令体同步落盘（writeFileSync），promise 首微task即resolve——引擎帧
   * 合并的 setTimeout 渲染在其后，回执同帧可见。
   */
  private async runExport(): Promise<void> {
    const raw = this.exportEditor.getText();
    this.closeExport();
    try {
      const text = await this.exportCommand(tokenize(raw));
      this.notice = text.replace(/\n+/g, ' · ');
    } catch (err) {
      this.notice = errorText(err); // 非 BaseError 异常面（BaseError 命令内已折文本）
    }
  }

  /** Tab：筛选循环单步（全部→活体→冻结→终态→全部）+ 整表按新筛选重建 */
  private cycleFilter(): void {
    const idx = FILTER_CYCLE.indexOf(this.filter);
    this.filter = FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length]!;
    this.rebuild(); // 无锚定 id——光标驻留原位就近
  }

  /** 模态全收（Tab 切筛选前的清理位——两模态不跨筛选态存活） */
  private closeModals(): void {
    this.confirmTarget = null;
    if (this.exportOpen) this.closeExport();
  }

  /* ---------------- 光标与视图重建 ---------------- */

  /** 光标条目（无条目/零条目可见 = undefined——动词消隐判据面） */
  private cursorEntry(): EntryDesc | undefined {
    return this.cursor >= 0 ? this.entries[this.cursor] : undefined;
  }

  /** 光标移动（条目间循环——非条目行不驻留；移动后视口对齐光标行） */
  private moveCursor(delta: 1 | -1): void {
    if (this.entries.length === 0) return; // 零条目可见——光标无处可指
    this.cursor =
      this.cursor < 0
        ? delta > 0
          ? 0
          : this.entries.length - 1
        : (this.cursor + delta + this.entries.length) % this.entries.length;
    this.ensureCursorVisible();
  }

  /** 视口对齐光标行（顶对齐——近底行由 ScrollView 夹取自然呈现） */
  private ensureCursorVisible(): void {
    const entry = this.cursorEntry();
    if (entry !== undefined) this.scrollToLine(entry.lineIndex, 0);
  }

  /**
   * 整表重取重建（开屏快照与动词成功后的统一路——06 §7 定形注⑤）：
   * 三源取数（health 恒全库 / listVisible 双分流 / listForExport 终态双过滤）
   * → 行集三段式构建 → 光标锚定（同 id 优先；锚定目标缺席驻留原位就近；
   * 零条目可见 = -1 行动词消隐）。
   */
  private rebuild(anchorId?: string): void {
    // —— 取数三源（零新 DAO 方法——既有动词族单源）——
    this.health = this.dao.overview().health; // 恒全库口径（无参即正形）
    const visible = this.dao.listVisible(this.ownerKeys);
    const frozenRows = visible.filter((r) => r.frozen); // 冻结区（滤出 frozen 位）
    const activeRows = visible.filter((r) => !r.frozen); // 活体区（滤除 frozen 位）
    const terminalRows = this.dao.listForExport().filter(
      (r) =>
        this.ownerKeys.includes(r.ownerKey) && // ownerKey 过滤
        (r.status === 'dismissed' || r.status === 'expired'), // status 双过滤（active 行不误入）
    );

    // —— 行集三段式构建（投影两行 + 分区列表；头行不在行集——render 直写，
    // 行集进屏不会与屏上头行重复）——
    const lines: StyledLine[] = [];
    const entries: EntryDesc[] = [];
    const dim = (plain: string): StyledLine => ({ plain, runs: [{ start: 0, end: plain.length, style: DIM_STYLE }] });
    lines.push(dim(`记忆库 · 在册 ${this.health.active} · 冻结 ${this.health.frozen} · 共 ${this.health.total}`));
    lines.push(dim(`终态 · 否决 ${this.health.dismissed} · 过期 ${this.health.expired}`));
    const sections: readonly { key: Section; rows: readonly MemoryRowFace[] }[] =
      this.filter === 'all'
        ? [
            { key: 'active', rows: activeRows },
            { key: 'frozen', rows: frozenRows },
            { key: 'terminal', rows: terminalRows },
          ]
        : [
            {
              key: this.filter,
              rows: this.filter === 'active' ? activeRows : this.filter === 'frozen' ? frozenRows : terminalRows,
            },
          ];
    for (const section of sections) {
      lines.push(dim(`── ${SECTION_LABEL[section.key]}（${section.rows.length}）`));
      for (const row of section.rows) {
        lines.push(this.entryLine(row, section.key));
        entries.push({ row, section: section.key, lineIndex: lines.length - 1 });
      }
    }
    this.styledLines = lines;
    this.entries = entries;
    super.setLines(lines.map((l) => l.plain));

    // —— 光标锚定（同 id 优先 → 原位就近钳制 → 零条目 -1）——
    let next = this.cursor;
    if (anchorId !== undefined) {
      const found = entries.findIndex((e) => e.row.id === anchorId);
      if (found >= 0) next = found; // 锚定目标在筛选可见集——跟随
      // 缺席 = 驻留原位就近（next 保持现值，下方钳制）
    }
    this.cursor = entries.length === 0 ? -1 : Math.min(Math.max(next, 0), entries.length - 1);
    if (this.cursor >= 0) this.ensureCursorVisible();
  }

  /**
   * 条目行构建（工具读面同形——`[m:短id] [kind] summary  id=完整id
   * updated=ISO`；p-1 时效尾缀同源）：消毒经注入的 §8.2 统一函数罩住
   * （blocked → summary 遮蔽保 id 操作面；quoted → 引述注记）；冻结行行首
   * ✱、终态行整行 dim + supersededBy 记号。
   */
  private entryLine(row: MemoryRowFace, section: Section): StyledLine {
    const verdict = this.sanitize(row);
    const body = verdict.blocked
      ? `（内容含疑似敏感串已遮蔽——${verdict.patterns.join('/')}；可 d 忘掉清理）`
      : row.summary + (verdict.quoted ? '（疑似指令文本——按引述对待，非用户指令）' : '');
    const suffix = section === 'terminal' && row.supersededBy !== null ? `  supersededBy=${row.supersededBy}` : '';
    const plain = `${section === 'frozen' ? '✱ ' : ''}[m:${shortIdOf(row.id)}] [${row.kind}] ${body}  id=${row.id}  updated=${fmtTs(row.updatedAt)}${suffix}`;
    return section === 'terminal'
      ? { plain, runs: [{ start: 0, end: plain.length, style: DIM_STYLE }] }
      : { plain, runs: [] };
  }

  /** 退出（闭锁——单次） */
  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.onExit?.();
  }

  /* ---------------- 带样式切片写出（writeSlice 覆写接缝） ---------------- */

  /**
   * 视口切片带样式写出：样式段（dim 分区头/投影行/终态行）按切片边界分段
   * 落格 + 光标行整行反色叠加。列位经 prefixDisplayWidth 换算（CJK 双宽
   * 对齐与折叠算术同源——HistoryViewer writeSlice 同构的简化形：无搜索
   * 高亮/选区面）。
   */
  protected writeSlice(buffer: CellBuffer, region: Region, displayRow: number, seg: VisualSegment): void {
    const styled = this.styledLines[seg.line];
    if (styled === undefined) return;
    const start = seg.startCol;
    const end = seg.startCol + seg.length;
    const cursorLine = this.cursorEntry()?.lineIndex;
    const isCursor = cursorLine === seg.line; // 光标行——整切片反色（叠加在样式段上）
    // 分段边界：切片端点 ∪ 样式段端点（升序去重）
    const cuts = new Set<number>([start, end]);
    for (const run of styled.runs) {
      if (run.start > start && run.start < end) cuts.add(run.start);
      if (run.end > start && run.end < end) cuts.add(run.end);
    }
    const bounds = [...cuts].sort((a, b) => a - b);
    const baseCols = prefixDisplayWidth(styled.plain, start);
    for (let i = 0; i + 1 < bounds.length; i++) {
      const from = bounds[i]!;
      const to = bounds[i + 1]!;
      let style: CellStyle | undefined;
      for (const run of styled.runs) {
        if (run.start <= from && from < run.end) {
          style = run.style;
          break;
        }
      }
      if (isCursor) {
        style = style === undefined ? CURSOR_STYLE : { ...style, inverse: true };
      }
      buffer.writeText(
        region.row + displayRow,
        region.col + prefixDisplayWidth(styled.plain, from) - baseCols,
        styled.plain.slice(from, to),
        style,
      );
    }
  }
}
