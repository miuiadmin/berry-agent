/**
 * /sessions 会话切换副屏件（07 §4.1 R7 批 10k——选定走 registry.focus()
 * 既有权威路〔通道核闭包注入 onSelect〕；本件只呈现清单与光标选择）。
 *
 * - **光标行选择**（与回看器滚动模型分立的选择模型）：↑/↓ 移动光标
 *   （PgUp/PgDn 翻选、Home/End 到首尾），Enter 选定 → 先收副屏再 onSelect
 *   （切焦异步 repaint 与收屏两序皆收敛——挂起闸/复起全帧重画各担一形）；
 * - **行呈现**：光标标记 › + 活跃位 ●（进程内 driver 在场）+ 标题（缺席
 *   如实「（无题）」）+ 右侧工作区短名（挖掘 35 轮 B9——跨仓清单仓别可
 *   辨，缺席缩位）/ 相对时（挖掘 35 轮 B10——分档 <7d 相对、≥7d 回退绝对
 *   MM-DD HH:mm；基准构造期定格）与会话短 id；超宽整字截断（左段适配剩
 *   余宽——CJK 双宽不产半字）；
 * - **滚动**：光标驱动的窗口滚动（光标恒可见——offset 跟随夹取），非
 *   ScrollView 的自由滚动（选择模型下两者合一更直）；
 * - **删除键与确认位**（05 §2.5 会话删除编排定形注①）：onDelete 注入在场
 *   时 'd'（key/text 双轨）进确认视图——破坏性动作必有确认（明示删除对象
 *   与「含审批记录在内的全部会话史将被删除且不可恢复」）；enter 确认 /
 *   esc·q 取消；回执 busy/missing 留确认视图呈就地状态行（notify 副屏期
 *   走停屏缓冲——面板须自带呈现），deleted 就地滤行回清单（刷新重拉最小
 *   形）；注入缺席 'd' 键无效零行为变；
 * - **归档与视图切换**（53 轮件 B——05 §9 archived_at 专列兑现）：'a'
 *   （key/text 双轨）当前视图向位翻（active 归档 / archived 恢复）免确认
 *   就地滤行 + totalCount 恒 −1〔行离当前视图——视图域总数两向统一〕+
 *   cursor clamp；'s'（双轨·visible 门外空表可达）两视图互切（行集整页
 *   替换 + 视图域 total + 清搜索态 + cursor 归零）；归档视图 enter=恢复
 *   （不切焦不收屏；onArchive 缺席回落切焦）；归档视图 'o' 不效（M1 裁
 *   ——reopen 只携带活跃快照）；两注入缺席零行为变（'d' 同律）。
 * - **尾段预览**（挖掘 35 轮 B5——「（无题）」会话成片不可辨的对位）：
 *   onPreview 注入在场时 tab 展开键（toggle——按键才拉非自动加载；缺席
 *   键无效零行为变〔'd' 删除键同律〕）；展开态清单下方预览区（空行分隔
 *   + 尾段 6 条帽：user 行 `› ` 前缀与主屏 user 块同词汇、assistant 行
 *   两空格缩进对齐，正文 dim 单行整字截断，升序旧→新）；光标行联动懒加
 *   载（会话内 Map 缓存免重复拉——codex transcript_previews 缓存同构；
 *   缓存命中同步落帧零重画）；诚实占位三态（加载中 / 无转录 / 失败折面
 *   foldErrorText 单源）；异步回执经 requestRepaint 请帧（onDelete 同族）；
 * - **打字搜索**（挖掘 43 轮件 C——'/' 进搜索态：list 视图子模式非新视图）：
 *   '/' 进态（空表不可进——visible 门内）；三字段（标题占位词含 / 工作区
 *   短名 basename / 短 id）小写包含过滤（双侧 lowercase，query 进判据前
 *   trim——空规整 = 全匹配形）；搜索态内 q/d/'/' 归输入让位（退出/删除键
 *   不触发——hint 同步不虚报）、tab 维持预览 toggle、导航键仍效走过滤表；
 *   打印键 key/text 双轨同律（text 轨粘贴空白规整 split 空白 + 单空格
 *   join）；backspace 删尾、空 query 退态；esc 一步清 query 退态保位
 *   （by id——退态前光标行经 sessions.findIndex 找回，找不到回退 0）；
 *   query 变更 cursor 归 0 + 预览联动；空结果「（无匹配会话）」诚实行 +
 *   导航段让位；头行 `N/M 匹配 · query` 形（截断披露与匹配计数并存）；
 * - **视口溢出指示与位置读数**（39 池 P4 件——「会话清单无视口外溢出指示与
 *   位置读数」对齐 theme-picker 件族形）：视口 ≥3 行且清单溢出时上/下 dim
 *   边行「↑/↓ N 更多」（panel-chrome 溢出指示统一律——三行预留收窄窗收敛
 *   段提为共享段 fitIndicatorViewport 单源〔theme-picker 同构消费，件间不
 *   一致封堵〕；溢出时视口让一行给边行、预留翻转后光标重夹取〔指示行不遮
 *   在选行〕、条目+边行实占恰满视口〔占位行/预览区起位零迁移〕；不足视口/
 *   矮窗零边行）；底行键面提示右缘 dim 位置读数 `(cursor+1)/n`（picker 是
 *   光标窗口非 ScrollView——离散行序直读免 percent 算术；行源 visibleSessions
 *   单源〔搜索过滤随动〕；空清单/搜索零命中态读数不现〔无行可读〕；行宽
 *   窄于地板 24 读数退场提示独占——viewer 底行读数同律）；
 * - **退出键面**：q/Esc 取消退出、Ctrl+C 打断、Ctrl+D 退出进程（先收副屏
 *   再转退出柄）——副屏键面补丁三件套与件 8 同律。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { basename } from 'node:path';
import { fitLine, fitRowSegments } from '../row-segments.js';
import { shortIdOf } from '../backend/transcript.js';
import type { OverlayContent } from '../overlay/overlay.js';
import type {
  UiSessionArchiveResult,
  UiSessionDeleteResult,
  UiSessionListView,
  UiSessionPreviewLine,
  UiSessionSummary,
} from '../../../contracts/index.js';
import { hintLine } from '../keys/hint.js';
import { foldErrorText } from '../../service.js';
import { DIM_STYLE } from '../../engine/index.js';
import {
  CURSOR_MARK,
  HEAD_MARKS,
  activeRowStyleOf,
  fitIndicatorViewport,
  moreHint,
  stepCursorWrap,
} from '../panels/panel-chrome.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';

/** 切换器装配选项 */
export interface SessionPickerOptions {
  /** 会话清单（装配序——最新在前；空表如实呈现「无会话」行） */
  readonly sessions: readonly UiSessionSummary[];
  /** 会话全量总数（B2 截断披露——超清单长时头行注记「N/M（仅显示最近）」；
   *  缺席或 ≤ 清单长 = 全量已呈现，头行保持原形不注记） */
  readonly totalCount?: number;
  /** 选定回调（通道核闭包——registry.focus() 既有权威路） */
  readonly onSelect: (sessionId: string) => void;
  readonly onExit: () => void;
  /** 打断在飞 run（打断目标 = 当前聚焦会话——装配闭包自知，非光标行） */
  readonly onInterrupt?: () => void;
  readonly onQuit?: () => void;
  /**
   * 删除回调（05 §2.5 定形注①——注入在场 'd' 键有效〔进确认视图〕，缺席
   * 键无效零行为变）。真身 = 通道核 wrapper（回执三态路由 notify 归核——
   * 面板另呈就地状态行：busy/missing/异常留确认视图，用户可取消重试）。
   */
  readonly onDelete?: (sessionId: string) => Promise<UiSessionDeleteResult>;
  /**
   * 尾段预览懒加载闭包（挖掘 35 轮 B5——注入在场才有 tab 展开键行为，
   * 缺席键无效零行为变〔onDelete 同律〕）。异步回执归本面板缓存 +
   * requestRepaint 请帧（不经通道核路由）。
   */
  readonly onPreview?: (sessionId: string) => Promise<readonly UiSessionPreviewLine[]>;
  /**
   * 开史回调（挖掘 50 轮件 C——注入在场 'o' 键有效〔光标行会话完整史两段
   * 开合〕，缺席键无效零行为变〔onDelete/onPreview 同律〕）。真身 = 通道核
   * 闭包（拉投影 → 开回看器 → 退出复原切换器含光标位）。
   */
  readonly onOpenHistory?: (sessionId: string, cursorAt: number) => void;
  /**
   * 光标复原位（挖掘 50 轮件 C——backend 重开切换器时传入 'o' 开史前光标位；
   * 缺省 0；构造位显式夹取〔render 路 clampOffset 只夹 offset 从不写 cursor——
   * 界内恒定靠变更位自守，超界直赋即破不变量〕）。
   */
  readonly initialCursor?: number;
  /**
   * 续页拉闭包（挖掘 51 轮件 A——注入在场才有分页行为，缺席 = 静态窗零分页
   * 〔onDelete 同律〕；只接续页 cursor 恒有值）。异步回执归本面板 append +
   * requestRepaint 请帧（不经通道核路由——onPreview 同族）。
   */
  readonly onLoadMore?: (cursor: string) => Promise<{
    rows: readonly UiSessionSummary[];
    nextCursor: string | null;
  }>;
  /**
   * 首拉续页位（挖掘 51 轮件 A——首拉 nextCursor 直达：null = 已是最早页零
   * 占位；更名注：initialCursor 已名光标复原位故此参定名 moreCursor 防撞）。
   */
  readonly moreCursor?: string | null;
  /**
   * 归档回调（53 轮件 B——注入在场 'a' 键有效〔免确认就地滤行〕，缺席键
   * 无效零行为变〔onDelete 同律〕）。回执三态路由归通道核 wrapper（missing
   * → warn）；成功位行离当前视图——面板就地滤行 + cursor clamp + total
   * −1 调账。归档视图 enter 同柄（恢复向——onArchive 在场时替代切焦）。
   */
  readonly onArchive?: (sessionId: string, archive: boolean) => Promise<UiSessionArchiveResult>;
  /**
   * 视图切换闭包（53 轮件 B——注入在场 's' 键有效〔active/archived 两视图
   * 切换〕，缺席键无效零行为变）。回执行集整页替换 + 视图域 total +
   * nextCursor（token 单形经核包装）归本面板；空表仍可切（归档行可达）。
   */
  readonly onSwitchView?: (view: UiSessionListView) => Promise<{
    rows: readonly UiSessionSummary[];
    nextCursor: string | null;
    total: number;
  }>;
  /**
   * 异步请帧（删除回执落位后重画——面板不自驱重画；装配接 altHost
   * requestRepaint）。同步键路（视图切换/取消）由引擎事件后重画承载。
   */
  readonly requestRepaint?: () => void;
  /**
   * 主题（R-9——在选行 accent bold 注入位）：测试装配缺省 DEFAULT_THEME；
   * 主会话装配位已接线（tui-backend theme: this.theme）。
   */
  readonly theme?: ResolvedTheme;
  /**
   * 相对时基准（挖掘 35 轮 B10——构造期定格单源：呈现位确定性，重开屏
   * 才换新基准；测试注入固定钟；缺省 Date.now()）。
   */
  readonly nowMs?: number;
}

/** 提示行样式（dim——注⑩：engine DIM_STYLE 单源） */
const HINT_STYLE: Readonly<CellStyle> = DIM_STYLE;
/** 活跃位标记（进程内 driver 在场） */
const ACTIVE_MARK = '●';
/** 滚轮单步行数（ScrollView WHEEL_LINES 同值——vim mousescroll ver 缺省档三行；mu-2 件族面） */
const WHEEL_LINES = 3;
/** 删除确认视图警示记号 */
const WARN_MARK = '⚠';
/** 尾段预览条数帽（挖掘 35 轮 B5——不足帽如实 N 条） */
const PREVIEW_CAP = 6;
/** 近底预取阈值（挖掘 51 轮件 A——视口距底 ≤N 行触发续页拉；codex LOAD_NEAR_THRESHOLD 同值，改裁为视口距底形〔更早预取〕） */
const LOAD_NEAR_THRESHOLD = 5;
/**
 * 底行读数让位地板（39 池 P4 件——panel-chrome renderViewerHintBar 的
 * SCROLL_PERCENT_FLOOR_WIDTH 同值同律：行宽低于此值读数让位、键面提示独占
 * 〔提示行是不可省铬〕；各持本地常量因两读数语域分立〔离散行序 vs 连续
 * 百分比〕，值同律非同源）。
 */
const READOUT_FLOOR_WIDTH = 24;
/** 预览缓存态（呈现即缓存——三占位态与成功态同账） */
type PreviewState =
  | { readonly status: 'loading' }
  | { readonly status: 'ok'; readonly lines: readonly UiSessionPreviewLine[] }
  | { readonly status: 'empty' }
  | { readonly status: 'error'; readonly message: string };

/** key 事件窄化 */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/** 活动时间呈现（MM-DD HH:mm——≥7d 回退档；本地时区显示档） */
function formatStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 相对时分档表（挖掘 35 轮 B10——升档序；unit = 计数单位，ceiling = 升档上界） */
const RELATIVE_TIERS: ReadonlyArray<{ unit: number; ceiling: number; label: string }> = [
  { unit: 1_000, ceiling: 60_000, label: '秒前' },
  { unit: 60_000, ceiling: 3_600_000, label: '分钟前' },
  { unit: 3_600_000, ceiling: 86_400_000, label: '小时前' },
  { unit: 86_400_000, ceiling: 7 * 86_400_000, label: '天前' },
];

/**
 * 活动时间相对时分档（挖掘 35 轮 B10——最新在前清单的直读性对齐）：
 * <60s「N 秒前」/<60m「N 分钟前」/<24h「N 小时前」/<7d「N 天前」/≥7d 回退
 * 绝对 MM-DD HH:mm（远程旧会话保日期信息量——codex 恒 Nd ago 的信息倒挂
 * 勘正）。基准 now 构造期定格单源传入（呈现位确定性——测试注入固定钟）。
 */
export function formatRelativeStamp(ms: number, nowMs: number): string {
  const diff = nowMs - ms;
  for (const tier of RELATIVE_TIERS) {
    if (diff < tier.ceiling) return `${Math.floor(diff / tier.unit)} ${tier.label}`;
  }
  return formatStamp(ms);
}

/**
 * 会话行匹配判据（挖掘 43 轮件 C——三字段小写包含，双侧 lowercase）：标题
 * （占位词「（无题）」按词面可搜——所见即可搜）/ 工作区短名（**只搜末端
 * 目录名不搜全路径**——短清单场景 basename 足够，全路径长串误匹配泛滥）/
 * 短 id。query 调用侧已 trim+lowercase（空规整 = 全匹配形在调用侧短路）。
 */
function matchesQuery(session: UiSessionSummary, query: string): boolean {
  const title = session.title !== undefined && session.title !== '' ? session.title : '（无题）';
  const ws = session.workspaceRoot !== undefined && session.workspaceRoot !== '' ? basename(session.workspaceRoot) : '';
  return `${title}\n${ws}\n${shortIdOf(session.id)}`.toLowerCase().includes(query);
}

/**
 * 会话切换器内容件（OverlayContent——副屏 root 直收全屏 region；自持
 * 光标与视口窗口，非 ScrollView〔选择模型与滚动合一〕）。
 */
export class SessionPicker implements OverlayContent {
  /** 会话清单（删除成功就地滤行——快照档清单的确定性行移除，故持可变副本） */
  private readonly sessions: UiSessionSummary[];
  /** 会话全量总数（B2 截断披露头行注记源——删除成功就地滤行联动递减，故持可变副本〔2026-10-07 勘正〕） */
  private totalCount: number | undefined;
  private readonly onSelect: (sessionId: string) => void;
  private readonly onExit: () => void;
  private readonly onInterrupt: (() => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  private readonly onDelete: ((sessionId: string) => Promise<UiSessionDeleteResult>) | undefined;
  private readonly onPreview: ((sessionId: string) => Promise<readonly UiSessionPreviewLine[]>) | undefined;
  private readonly onOpenHistory: ((sessionId: string, cursorAt: number) => void) | undefined;
  private readonly requestRepaint: (() => void) | undefined;
  /** 当前视图（list 清单 / confirm 删除确认——视图切换形同 rewind-picker） */
  private view: 'list' | 'confirm' = 'list';
  /** 确认视图目标行（进视图时光标行快照） */
  private confirmTarget: UiSessionSummary | undefined;
  /** 确认视图就地状态行（busy/missing/异常——undefined = 无状态行） */
  private confirmStatus: string | undefined;
  /** 删除在飞守卫（回执落位前 enter 不双发——防双击） */
  private deleteInFlight = false;
  /** 光标行（清单下标；空表恒 0） */
  private cursor = 0;
  /** 视口首行（光标驱动夹取） */
  private offset = 0;
  /** 视口高实测（render 回写——翻选的页幅依据） */
  private viewportHeight = 1;
  /** 退出闭锁（选定与取消两路共闭——竞发防御位） */
  private exited = false;
  /** 在选行整行样式（R-9——accent bold；右段辅助段随光标行覆写） */
  private readonly activeRowStyle: Readonly<CellStyle>;
  /** 相对时基准（构造期定格——挖掘 35 轮 B10） */
  private readonly nowMs: number;
  /** 预览区展开态（挖掘 35 轮 B5——tab toggle；展开才拉才画） */
  private previewOpen = false;
  /** 预览缓存（会话 id → 呈现态——光标回访免重复拉；迟到回执落缓存无害） */
  private readonly previewCache = new Map<string, PreviewState>();
  /**
   * 搜索词（挖掘 43 轮件 C——null = 不在搜索态；进态置 ''，空串驻留态可见
   * ——用户续打或退）。渲染/导航/选定/删除目标/预览六面全经 visibleSessions
   * 单源换源，不裂第二账
   */
  private searchQuery: string | null = null;
  /** 续页拉闭包（挖掘 51 轮件 A——缺席 = 静态窗零分页零占位） */
  private readonly onLoadMore:
    ((cursor: string) => Promise<{ rows: readonly UiSessionSummary[]; nextCursor: string | null }>) | undefined;
  /** 续页位（null = 已到最早；onLoadMore 缺席时恒 null——双保险单源） */
  private moreCursor: string | null = null;
  /** 续页拉单飞锁（在飞回执落位前不重发——ensurePreviewOfCursor 同族） */
  private loadingMore = false;
  /** 曾发起续页拉（null 终态「已到最早」占位的在场判据——初值 null 零占位不虚报） */
  private loadAttempted = false;
  /** 归档回调存柄（53 轮件 B——缺席 'a' 键无效 + 归档视图 enter 回落切焦） */
  private readonly onArchive: ((sessionId: string, archive: boolean) => Promise<UiSessionArchiveResult>) | undefined;
  /** 视图切换闭包存柄（53 轮件 B——缺席 's' 键无效） */
  private readonly onSwitchView:
    | ((view: UiSessionListView) => Promise<{
        rows: readonly UiSessionSummary[];
        nextCursor: string | null;
        total: number;
      }>)
    | undefined;
  /**
   * 数据视图（53 轮件 B——active 活跃 / archived 已归档；与 view 布局名
   * 〔list/confirm〕分立两账：布局说「画哪个屏」，本位说「清单是哪个域」）。
   * 缺省 active——装配首开恒活跃视图。
   */
  private sessionView: UiSessionListView = 'active';
  /** 归档/恢复单飞锁（回执落位前重复 'a'/enter 恢复吞——deleteInFlight 同族） */
  private archiveInFlight = false;

  constructor(options: SessionPickerOptions) {
    this.sessions = [...options.sessions]; // 可变副本（就地滤行——不回写调用方数组）
    this.totalCount = options.totalCount;
    this.onSelect = options.onSelect;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.onDelete = options.onDelete;
    this.onPreview = options.onPreview;
    this.onOpenHistory = options.onOpenHistory;
    // 光标复原位（挖掘 50 轮件 C——构造位显式夹取：render 路 clampOffset 只夹
    // offset 从不写 cursor，界内恒定靠各变更位自守——超界直赋破不变量（enter/
    // tab 的 visible[cursor]!.id 直取即越界炸）；空表夹 0（home 同族））
    this.cursor = Math.min(Math.max(options.initialCursor ?? 0, 0), Math.max(this.sessions.length - 1, 0));
    // 分页接线（挖掘 51 轮件 A）：注入在场才持有续页位（缺席恒 null——双保险，
    // moreCursor 误传不点燃分页）
    this.onLoadMore = options.onLoadMore;
    this.moreCursor = options.onLoadMore !== undefined ? (options.moreCursor ?? null) : null;
    // 归档接线（53 轮件 B）：两闭包缺席零行为变（'a'/'s'/归档视图 enter 全部
    // 回落既有键面——onDelete 同律）
    this.onArchive = options.onArchive;
    this.onSwitchView = options.onSwitchView;
    this.requestRepaint = options.requestRepaint;
    this.activeRowStyle = activeRowStyleOf(options.theme ?? DEFAULT_THEME);
    this.nowMs = options.nowMs ?? Date.now();
  }

  /** 量高：清单形 = 头行 + 清单全量 + 底行提示（副屏 root 不经布局路——render 按实际 region 窗口化）；展开态加预览区（空行 + 内容行——缓存态单源）；确认视图定高（头 + 警示 + 状态行预留 + 底行） */
  measure(width: number): number {
    void width;
    if (this.view === 'confirm') return 5;
    // 清单行数换源 visible（挖掘 43 轮件 C——过滤态量高随匹配收缩；空匹配
    // max(1,·) 保持单行占位不塌行）；占位行 = 清单视口下方固定行恒 1 高
    // （挖掘 51 轮件 A——三态词面变不增高）
    let height = 1 + Math.max(1, this.visibleSessions().length) + 1;
    if (this.placeholderInUse()) height += 1;
    if (this.previewAreaInUse()) height += 1 + this.previewContentHeight();
    return height;
  }

  /**
   * 过滤表单源（挖掘 43 轮件 C——六消费位唯一行源）：非搜索态 = 全表；
   * 搜索态 = 三字段过滤；query 空规整 = 全匹配形（驻留空态等价未过滤）。
   * 每调用现过滤（清单帽 100 × 三字段小写包含——键入开销可忽略，不持缓存
   * 副本防双账漂移）
   */
  private visibleSessions(): UiSessionSummary[] {
    if (this.searchQuery === null) return this.sessions;
    const query = this.searchQuery.trim().toLowerCase();
    if (query === '') return this.sessions;
    return this.sessions.filter((session) => matchesQuery(session, query));
  }

  /** 占位行在场判据（挖掘 51 轮件 A——注入在场 + 三态任一：在飞/有续页/曾拉到终态；初值全否零占位不虚报） */
  private placeholderInUse(): boolean {
    return this.onLoadMore !== undefined && (this.loadingMore || this.moreCursor !== null || this.loadAttempted);
  }

  /**
   * 近底续页拉（挖掘 51 轮件 A——导航变更位后判：视口距底 ≤5 行〔codex
   * LOAD_NEAR_THRESHOLD 同值改裁为视口距底形——与光标位无关，全显窗恒
   * 触发即提前预取〕；非搜索态〔过滤表是窗内子集，全表分页与过滤正交〕+
   * 单飞锁 + 续页位非空）。回执 append 去重按 id 双保险（游标序防重为主、
   * id 集为兜底）+ moreCursor 更新 + requestRepaint 请帧；异常静默回占位
   * （续页位不动可重试——面板无 notify 面，用户面错误折面走下次拉取）。
   * 挂点：moveCursor/home/end 尾（滚轮/↑↓/PgUp/PgDn 全经 moveCursor）。
   */
  private maybeLoadMore(): void {
    if (this.onLoadMore === undefined || this.moreCursor === null || this.loadingMore) return;
    if (this.searchQuery !== null) return; // 搜索态不触发（过滤表是窗内子集）
    const visible = this.visibleSessions();
    if (visible.length === 0) return;
    if (visible.length - (this.offset + this.viewportHeight) > LOAD_NEAR_THRESHOLD) return;
    this.loadingMore = true;
    const cursor = this.moreCursor;
    this.onLoadMore(cursor).then(
      (page) => {
        this.loadingMore = false;
        this.loadAttempted = true;
        // append 去重按 id（双保险——游标序两页同序防重为主，构造/删除竞窗兜底）
        const known = new Set(this.sessions.map((s) => s.id));
        for (const row of page.rows) if (!known.has(row.id)) this.sessions.push(row);
        this.moreCursor = page.nextCursor;
        // 行集变长 maxOffset 变大——offset 恒仍在界（夹取幂等）；光标不动
        this.clampOffset();
        this.requestRepaint?.();
      },
      () => {
        this.loadingMore = false;
        this.loadAttempted = true;
        // 续页位不动（可重试）——占位回「↓ 加载更早…」形
        this.requestRepaint?.();
      },
    );
  }

  /** 预览区在用判据（展开态 + 注入在场 + 非空过滤表——三键守卫单源〔挖掘 43 轮件 C：visible 换源〕） */
  private previewAreaInUse(): boolean {
    return this.previewOpen && this.onPreview !== undefined && this.visibleSessions().length > 0;
  }

  /** 预览内容行数（缓存态单源——占位三态 1 行 / 成功态 min(帽, N) 行〔空数组归 empty 形〕） */
  private previewContentHeight(): number {
    const state = this.previewStateOfCursor();
    if (state === undefined || state.status !== 'ok') return 1;
    return Math.min(PREVIEW_CAP, state.lines.length);
  }

  /** 光标行预览缓存态（缺席 undefined = 未拉——渲染归 loading 位占位；行源 = visible 单源） */
  private previewStateOfCursor(): PreviewState | undefined {
    const visible = this.visibleSessions();
    if (visible.length === 0) return undefined;
    return this.previewCache.get(visible[this.cursor]!.id);
  }

  /** 落位：清单视图 = 头行 → 清单视口（光标行标记 + 活跃位 + 标题左段 / 时间·短 id 右段）→ 底行提示；确认视图 = 警示文案 + 就地状态行 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    if (this.view === 'confirm') {
      this.renderConfirm(buffer, region);
      return;
    }
    // 头行：全量已呈现原形；总数超清单长 → N/M + 仅显示最近（B2 截断披露——
    // 清单默认 100 窗，超窗不注记即「所见即全量」的静默谎）；分页在场去
    // 「（仅显示最近）」尾注（挖掘 51 轮件 A——更早经续页拉可达，截断谎句
    // 摘除、N/M 总数披露保真）；搜索态 → N/M 匹配 + query（挖掘 43 轮件 C
    // ——截断披露 totalCount 与匹配计数两数并存〔denom = totalCount ?? 全表
    // 长〕；query 空驻留形尾段空——「匹配 · 」后零字，不写「显示 / 尾段」
    // 防与 N/M 分隔符 '/' 混淆）；归档视图 → 头行「（已归档）」注记（53 轮
    // 件 B——行集归属视图可辨，两视图头行同构只差注记）
    const viewNote = this.sessionView === 'archived' ? '（已归档）' : '';
    const visible = this.visibleSessions();
    const n = visible.length;
    const head =
      this.sessions.length === 0
        ? `${HEAD_MARKS.session} 会话切换${viewNote} · 无会话`
        : this.searchQuery !== null
          ? `${HEAD_MARKS.session} 会话切换${viewNote} · ${n}/${this.totalCount ?? this.sessions.length} 匹配 · ${this.searchQuery}`
          : this.totalCount !== undefined && this.totalCount > n
            ? this.onLoadMore !== undefined
              ? `${HEAD_MARKS.session} 会话切换${viewNote} · ${n}/${this.totalCount} 会话`
              : `${HEAD_MARKS.session} 会话切换${viewNote} · ${n}/${this.totalCount} 会话（仅显示最近）`
            : `${HEAD_MARKS.session} 会话切换${viewNote} · ${n} 会话`;
    // 非条目行（头行/空态行/底行）fitLine … 收口（wf_3c8b00b8 组δ X-5——raw
    // writeText 窄窗硬截断无提示；条目行走 fitRowSegments 双段）
    buffer.writeText(region.row, region.col, fitLine(head, region.width));
    // 守卫族语义（height=2 → 零内容行只头行+底行）：下限 0——旧 Math.max(1,·)
    // 在 height=2 强立 1 行内容，首内容行先写后又被底行覆写留残段
    // 预览区在用：底行上方预留（空行 + 内容行）——清单视口相应让位（清单是
    // 选择主体，矮窗预览区先被行预算截断）；占位行（挖掘 51 轮件 A）同从
    // 预算扣——矮窗让位序：预览区先让（既有）→ 占位行后让（清单行优先）
    const previewArea = this.previewAreaInUse() ? 1 + this.previewContentHeight() : 0;
    const placeholderArea = this.placeholderInUse() ? 1 : 0;
    const viewHeight = Math.max(0, region.height - 2 - previewArea - placeholderArea);
    this.viewportHeight = viewHeight;
    this.clampOffset();
    if (viewHeight > 0) {
      if (this.sessions.length === 0) {
        buffer.writeText(
          region.row + 1,
          region.col,
          fitLine('（暂无会话——esc 返回，输入 /new 新建）', region.width),
          HINT_STYLE,
        );
      } else if (visible.length === 0) {
        // 空结果诚实行（挖掘 43 轮件 C——空态行同位同形先例 dim）
        buffer.writeText(region.row + 1, region.col, fitLine('（无匹配会话）', region.width), HINT_STYLE);
      } else {
        // 溢出指示收窄窗（39 池 P4 件——共享段单源收敛：视口 ≥3 行且溢出才立
        // 边行；预留行挤压后光标跟随〔指示行不遮在选行〕；条目+边行实占恰满
        // viewHeight——下方占位行/预览区起位零迁移；行源 visible 单源〔搜索
        // 过滤随动〕；边行走 fitLine … 收口〔X-5 非条目行律〕）
        const fit = fitIndicatorViewport(viewHeight, this.offset, this.cursor, visible.length);
        this.offset = fit.offset;
        let displayRow = region.row + 1;
        if (fit.on && fit.offset > 0) {
          buffer.writeText(displayRow, region.col, fitLine(moreHint('↑', fit.offset), region.width), HINT_STYLE);
          displayRow++;
        }
        for (let i = 0; i < fit.cap; i++) {
          const index = fit.offset + i;
          if (index >= visible.length) break;
          this.renderRow(buffer, displayRow, region.col, region.width, index, visible);
          displayRow++;
        }
        if (fit.on) {
          const below = visible.length - (fit.offset + fit.cap);
          if (below > 0) {
            buffer.writeText(displayRow, region.col, fitLine(moreHint('↓', below), region.width), HINT_STYLE);
          }
        }
      }
    }
    // 占位行（挖掘 51 轮件 A——清单视口正下方固定行，不随滚动〔虚拟尾行需
    // 扩 clampOffset 才可达，固定行位零交互〕；三态词面：在飞「加载中…」/
    // 有续页「↓ 加载更早…」/ 终态「已到最早」——dim 同 hint 族）
    if (placeholderArea > 0) {
      const placeholder = this.loadingMore ? '加载中…' : this.moreCursor !== null ? '↓ 加载更早…' : '已到最早';
      buffer.writeText(region.row + 1 + viewHeight, region.col, fitLine(placeholder, region.width), HINT_STYLE);
    }
    if (previewArea > 0)
      this.renderPreview(
        buffer,
        region.row + 1 + viewHeight + placeholderArea,
        region.col,
        region.width,
        region.height - 2 - viewHeight - placeholderArea,
      );
    // 底行提示（键面如实——缺席保持原形不虚报）：搜索态分档（挖掘 43 轮件 C
    //——q/d/'/'/a/s 归输入让位不注记、「q/esc 返回」段让位〔q 已非退出键〕；
    // 空匹配导航/enter/tab 段让位〔门零动作不虚报〕）；enter 段视图分档（53
    // 轮件 B——归档视图 + onArchive 在场 = 恢复语义；缺席回落切焦如实保持
    // 「enter 切换」）；归档视图 'o 开史' 段摘除（键位不效不虚报）；空表档
    // 视图切换段注入在场才入（空表 's' 仍效——归档行可达）
    const enterLabel = this.sessionView === 'archived' && this.onArchive !== undefined ? 'enter 恢复' : 'enter 切换';
    const switchLabel = this.sessionView === 'active' ? 's 归档视图' : 's 活跃视图';
    const bottomHint =
      this.sessions.length === 0
        ? this.onSwitchView !== undefined
          ? hintLine(switchLabel, 'q/esc 返回')
          : 'q/esc 返回'
        : this.searchQuery !== null
          ? visible.length === 0
            ? hintLine('输入过滤', 'esc 清搜索')
            : this.onPreview !== undefined
              ? hintLine('输入过滤', '↑↓ 移动', enterLabel, this.previewOpen ? 'tab 收预览' : 'tab 预览', 'esc 清搜索')
              : hintLine('输入过滤', '↑↓ 移动', enterLabel, 'esc 清搜索')
          : (() => {
              // 非搜索态段收集（挖掘 50 轮件 C——段族化：'o 开史' 段注入在场才
              // 入，段序 'd 删除' 后 'q/esc 返回' 前〔窄窗 fitLine 尾段让位截断
              // ——退出键面排末位最后丢〕；原四组合静态链等价重构零行为变）；
              // 53 轮件 B 段族化扩员——'a 归档/恢复'（onArchive 在场）+ 's 视图'
              // （onSwitchView 在场）+ enter 段视图分档 + 归档视图 'o 开史' 摘除
              const segments = ['↑↓ 移动', enterLabel];
              if (this.onPreview !== undefined) segments.push(this.previewOpen ? 'tab 收预览' : 'tab 预览');
              if (this.onArchive !== undefined) segments.push(this.sessionView === 'active' ? 'a 归档' : 'a 恢复');
              if (this.onDelete !== undefined) segments.push('d 删除');
              if (this.onOpenHistory !== undefined && this.sessionView === 'active') segments.push('o 开史');
              if (this.onSwitchView !== undefined) segments.push(switchLabel);
              segments.push('q/esc 返回');
              return hintLine(...segments);
            })();
    // 底行提示 + 右缘位置读数（39 池 P4 件）：键面如实——缺席保持原形不虚报；
    // 读数 `(cursor+1)/n` dim 右对齐（picker 是光标窗口非 ScrollView——离散
    // 行序直读免 percent 算术，与 viewer 底行 NN% 读数语域分立）；行源
    // visible 单源（搜索过滤随动）；空清单/搜索零命中态不现（无行可读）；
    // 窄于地板读数退场提示独占（renderViewerHintBar 同律——提示行是不可省铬）；
    // 双段排版走 fitRowSegments 单源（右段预算 + 左段帽——负起列结构性封堵
    // 继承；确认视图无清单光标面不评读数）
    const readout =
      visible.length > 0 && region.width >= READOUT_FLOOR_WIDTH ? `${this.cursor + 1}/${visible.length}` : undefined;
    const bottomFit = fitRowSegments(bottomHint, readout, region.width);
    buffer.writeText(region.row + region.height - 1, region.col, bottomFit.left, HINT_STYLE);
    if (bottomFit.rightWidth > 0) {
      buffer.writeText(
        region.row + region.height - 1,
        region.col + region.width - bottomFit.rightWidth,
        bottomFit.right,
        HINT_STYLE,
      );
    }
  }

  /**
   * 预览区落位（挖掘 35 轮 B5——清单视口下方：空行分隔 + 内容行）。占位
   * 三态诚实（加载中 / 无转录 / 失败折面）；成功态尾段帽内升序行（user `› `
   * 前缀与主屏 user 块同词汇、assistant 两空格缩进对齐，正文 dim 单行整字
   * 截断）。budget = 含空行的总行预算（矮窗清单视口已 clamp 0 时预算小于
   * 预期——先画先得，连首内容行都放不下则整体零画）。
   */
  private renderPreview(buffer: CellBuffer, startRow: number, col: number, width: number, budget: number): void {
    if (budget < 2) return; // 空行 + 至少 1 内容行
    // startRow 位 = 空行分隔（零写——清屏底自然空）
    const state = this.previewStateOfCursor();
    let row = startRow + 1;
    let lines = budget - 1;
    const write = (text: string): void => {
      if (lines <= 0) return;
      buffer.writeText(row, col, fitLine(text, width), HINT_STYLE);
      row += 1;
      lines -= 1;
    };
    if (state === undefined || state.status === 'loading') {
      write('加载中…');
      return;
    }
    if (state.status === 'empty') {
      write('（无转录）');
      return;
    }
    if (state.status === 'error') {
      write(`预览加载失败：${state.message}`);
      return;
    }
    // 尾段方向取帽（规范③「尾段 6 条帽」——超帽让位最旧；装配侧已取尾 6，
    // 本帽是呈现侧同向保险：载荷异常超长时仍呈最新段非最旧段）
    for (const line of state.lines.slice(-PREVIEW_CAP)) {
      write(line.speaker === 'user' ? `› ${line.text}` : `  ${line.text}`);
    }
  }

  /** 确认视图落位：删除对象明示（标题 + 短 id）+ 不可恢复警示（规范明文案）+ 就地状态行 + 底行键面 */
  private renderConfirm(buffer: CellBuffer, region: Region): void {
    const target = this.confirmTarget;
    const title = target !== undefined && target.title !== undefined && target.title !== '' ? target.title : '（无题）';
    const shortId = target !== undefined ? shortIdOf(target.id) : '';
    buffer.writeText(region.row, region.col, fitLine(`${WARN_MARK} 将删除：${title}（${shortId}）`, region.width));
    // 不可逆警示 = 规范明文（05 §2.5 定形注①确认文案——含审批记录在内的
    // 全部会话史，且不可恢复）
    buffer.writeText(
      region.row + 1,
      region.col,
      fitLine('含审批记录在内的全部会话史将被删除，且不可恢复。', region.width),
    );
    // 矮终端行预算让位律（挖掘 34 轮——与清单视图 viewHeight 下限守卫同构）：
    // 键面恒写 row+height-1 在 height=2 落 row+1 后写覆写不可逆警示（残段
    // 撕裂形——破坏性确认失警示仍可 enter）。让位序：警示两行恒在（规范
    // 明文案不让位）→ height≥3 键面回底行 → height≥4 状态行入位（height=3
    // 状态行让位——键面在底与清单视图同构）
    if (region.height >= 4 && this.confirmStatus !== undefined) {
      buffer.writeText(region.row + 2, region.col, fitLine(this.confirmStatus, region.width));
    }
    if (region.height >= 3) {
      buffer.writeText(
        region.row + region.height - 1,
        region.col,
        fitLine(hintLine('enter 确认删除', 'esc/q 取消'), region.width),
        HINT_STYLE,
      );
    }
  }

  /** 单行落位：左段（光标 + 活跃位 + 标题——适配剩余宽截断）+ 右段（工作区短名 · 时间 · 短id）右对齐；行源 = visible 单源〔挖掘 43 轮件 C〕 */
  private renderRow(
    buffer: CellBuffer,
    row: number,
    col: number,
    width: number,
    index: number,
    visible: readonly UiSessionSummary[],
  ): void {
    const session = visible[index]!;
    // 右段 = 工作区短名（挖掘 35 轮 B9——右段首位形：dim 辅助族样式与 R-9
    // 光标行覆写律天然继承、窄宽走右段预算律单源收口、缺席缩位不虚报）+
    // 相对时（挖掘 35 轮 B10——构造期定格基准）+ 短 id
    const ws =
      session.workspaceRoot !== undefined && session.workspaceRoot !== '' ? basename(session.workspaceRoot) : '';
    const right = `${ws !== '' ? `${ws} ` : ''}${formatRelativeStamp(session.updatedAt, this.nowMs)} ${shortIdOf(session.id)}`;
    // 左段 = 光标标记 + 活跃位 + 标题
    const prefix = index === this.cursor ? `${CURSOR_MARK} ` : '  ';
    const title = session.title !== undefined && session.title !== '' ? session.title : '（无题）';
    const left = `${prefix}${session.active ? ACTIVE_MARK : ' '} ${title}`;
    // 右段预算律单源：各段先按预算 … 截断再右对齐（窄窗不再负起列
    // 劈毁标题——两段各自整字截断不撕宽字符）
    const fit = fitRowSegments(left, right, width);
    // 在选行整行 accent bold（R-9——codex 全 spans 律：右段辅助段随光标行覆写）
    const active = index === this.cursor ? this.activeRowStyle : undefined;
    buffer.writeText(row, col, fit.left, active);
    if (fit.rightWidth > 0) buffer.writeText(row, col + width - fit.rightWidth, fit.right, active ?? HINT_STYLE);
  }

  /** 事件分发（副屏内容终局消费）：滚轮 → Ctrl+C/Ctrl+D 补丁 → 确认视图（enter 确认 / esc·q 取消）→ 搜索态键面（esc 清搜索 / backspace 删尾 / 打印键归输入）→ 搜索态进态（'/'）→ 删除键 → 选定/取消 → 移动键 */
  handleEvent(event: InputEvent): boolean {
    if (event.kind === 'mouse') {
      // 确认视图吞鼠标（光标移动无意义——模态确认）
      if (this.view === 'confirm') return true;
      // 滚轮 = 光标 ±3 行（mu-2 件族面——经 moveCursor 既有夹取与视口跟随，
      // ↑↓ 同路）；wheel 无 release 相（终端不报——press 一相到达）；非滚轮
      // 鼠标相零动作吞（v1 无选区/点击面，模态独占）；空过滤表零动作（门随
      // visible 换源——挖掘 43 轮件 C）
      if (event.phase === 'press' && (event.button === 'wheel-up' || event.button === 'wheel-down')) {
        if (this.visibleSessions().length > 0) {
          this.moveCursor(event.button === 'wheel-up' ? -WHEEL_LINES : WHEEL_LINES);
        }
        return true;
      }
      return true;
    }
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        // Ctrl+C = 打断在飞 run（目标 = 当前聚焦会话——装配闭包自知）
        this.onInterrupt?.();
        return true;
      }
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'd') {
        this.exit();
        this.onQuit?.();
        return true;
      }
      // —— 确认视图键面（模态独占：enter 确认 / esc·q 取消，其余吞）——
      if (this.view === 'confirm') {
        if (isPlainKey(k, 'enter')) {
          this.acceptDelete();
          return true;
        }
        if (isPlainKey(k, 'escape') || isPlainKey(k, 'q')) {
          this.cancelConfirm();
          return true;
        }
        return true;
      }
      // —— 搜索态键面（挖掘 43 轮件 C——list 视图子模式；q/d/'/' 打印键归
      // 输入让位，导航/enter/tab fall through 仍效走过滤表）——
      if (this.searchQuery !== null) {
        if (isPlainKey(k, 'escape')) {
          this.exitSearch(); // 一步清 query + 退态保位（单层子模式不造三段 esc）
          return true;
        }
        if (isPlainKey(k, 'backspace')) {
          // 删尾；空 query 退态保位（与 esc 同保位语义）
          if (this.searchQuery === '') this.exitSearch();
          else {
            this.searchQuery = this.searchQuery.slice(0, -1);
            this.afterQueryChanged();
          }
          return true;
        }
        // 打印键归输入（key 轨——shift 放行大写、ctrl/alt/meta 排除组合键）
        if (!k.ctrl && !k.alt && !k.meta && k.key.length === 1) {
          this.appendQuery(k.key);
          return true;
        }
        // 命名导航键（up/down/pgup/pgdn/home/end/enter/tab）fall through——
        // q/d 不再触发退出/删除（归输入已在上方吃掉）
      }
      const visible = this.visibleSessions();
      if (visible.length > 0) {
        if (isPlainKey(k, 'up')) {
          this.moveCursor(-1);
          return true;
        }
        if (isPlainKey(k, 'down')) {
          this.moveCursor(1);
          return true;
        }
        if (isPlainKey(k, 'pageup')) {
          this.moveCursor(-this.viewportHeight);
          return true;
        }
        if (isPlainKey(k, 'pagedown')) {
          this.moveCursor(this.viewportHeight);
          return true;
        }
        if (isPlainKey(k, 'home')) {
          this.cursor = 0;
          this.clampOffset();
          if (this.previewAreaInUse()) this.ensurePreviewOfCursor();
          this.maybeLoadMore();
          return true;
        }
        if (isPlainKey(k, 'end')) {
          this.cursor = visible.length - 1;
          this.clampOffset();
          if (this.previewAreaInUse()) this.ensurePreviewOfCursor();
          this.maybeLoadMore();
          return true;
        }
        if (isPlainKey(k, 'enter')) {
          // 归档视图 enter = 恢复向（53 轮件 B——onArchive 在场时位翻恢复〔同
          // 'a' 滤行路〕，不 onSelect 不收屏〔恢复后行离归档视图，切焦归用户
          // 回活跃视图再选〕；缺席回落既有切焦路〔M1 裁：reopen 只携带活跃快
          // 照，归档会话经恢复归队——面板如实呈现切焦结果〕）
          if (this.sessionView === 'archived' && this.onArchive !== undefined) {
            this.archiveAtCursor(false);
            return true;
          }
          const chosen = visible[this.cursor]!;
          this.exit(); // 先收副屏（切焦 repaint 异步到达——收屏与重画两序皆收敛）
          this.onSelect(chosen.id);
          return true;
        }
        // '/' = 进搜索态（挖掘 43 轮件 C——list 视图现无消费零冲突；空过滤表
        // 不可进——空表 × 搜索态组合不可达，空态行/空表 hint 专档不需搜索分档）
        if (isPlainKey(k, '/')) {
          this.searchQuery = '';
          this.cursor = 0;
          this.clampOffset();
          if (this.previewAreaInUse()) this.ensurePreviewOfCursor();
          return true;
        }
        // 'a' = 归档/恢复键（53 轮件 B——注入在场才有效：当前视图向位翻〔active
        // 视图归档 / archived 视图恢复〕，免确认就地滤行——位翻非删行纯视图
        // 可逆，'d' 破坏性确认族不适用；缺席吞而不动作〔'd' 同律〕；搜索态归
        // 输入不可达）
        if (isPlainKey(k, 'a')) {
          this.archiveAtCursor(this.sessionView === 'active');
          return true;
        }
        // 'd' = 删除键（05 §2.5 定形注①——注入在场才有效：进确认视图；缺席
        // 吞而不动作——键面帮助行同步缺席不注记；搜索态归输入不可达）
        if (isPlainKey(k, 'd')) {
          this.openConfirm();
          return true;
        }
        // 'o' = 开史键（挖掘 50 轮件 C——注入在场才有效：光标行会话完整史两段
        // 开合；缺席吞而不动作〔'd' 删除键同律〕；搜索态归输入不可达；面板不
        // 自杀收屏——「收」归 backend 透传包装位〔即收形〕）
        if (isPlainKey(k, 'o')) {
          this.openHistoryAtCursor();
          return true;
        }
        // tab = 尾段预览展开键（挖掘 35 轮 B5——注入在场才有效：toggle 预览
        // 区；缺席吞而不动作〔'd' 删除键同律〕；不可打印零输入冲突不废）
        if (isPlainKey(k, 'tab')) {
          if (this.onPreview !== undefined) {
            this.previewOpen = !this.previewOpen;
            if (this.previewOpen) this.ensurePreviewOfCursor();
          }
          return true;
        }
      }
      // 's' = 视图切换键（53 轮件 B——注入在场才有效：active/archived 两视图
      // 互切；**块外 = 空表可达**〔归档视图可能有行而活跃视图空表——切视图是
      // 空表下唯一可达归档行的路〕；缺席吞而不动作）
      if (isPlainKey(k, 's')) {
        this.switchView();
        return true;
      }
      if (isPlainKey(k, 'escape') || isPlainKey(k, 'q')) {
        this.exit();
        return true;
      }
    }
    if (event.kind === 'text') {
      // kitty disambiguate 轨纯键打字走 text 事件——双轨同律（同键单轨到达）
      if (this.view === 'confirm') {
        if (event.text === 'q') this.cancelConfirm(); // text 轨 q 取消确认
        return true;
      }
      // 搜索态：text 轨归输入（挖掘 43 轮件 C——单字符打字与多字符粘贴同路；
      // 粘贴空白规整 split 空白 + 单空格 join〔codex split_whitespace 锚——
      // 裸 split(/\s+/) 对前导/尾随空白产空串元素，filter(Boolean) 补齐等价〕）
      if (this.searchQuery !== null) {
        this.appendQuery(event.text.trim().split(/\s+/).filter(Boolean).join(' '));
        return true;
      }
      if (event.text === 'q') {
        this.exit();
        return true;
      }
      if (event.text === 'd') {
        if (this.view === 'list') this.openConfirm();
        return true;
      }
      // kitty text 轨 'a'/'s' 同律（53 轮件 B——双轨收键；搜索态已在上方
      // appendQuery 分支提前 return 归输入，两键归输入不可达）
      if (event.text === 'a') {
        if (this.view === 'list') this.archiveAtCursor(this.sessionView === 'active');
        return true;
      }
      if (event.text === 's') {
        if (this.view === 'list') this.switchView();
        return true;
      }
      if (event.text === 'o') {
        // kitty text 轨 'o' 同律（挖掘 50 轮件 C——双轨收键；搜索态已在上方
        // appendQuery 分支提前 return 归输入，'o' 归输入不可达）
        if (this.view === 'list') this.openHistoryAtCursor();
        return true;
      }
    }
    return true; // 未消费键终局吞（模态独占）
  }

  /** 进确认视图（光标行快照为删除目标——注入缺席/空表/已退出零动作；行源 = visible 单源〔挖掘 43 轮件 C〕） */
  private openConfirm(): void {
    if (this.onDelete === undefined || this.exited) return;
    const visible = this.visibleSessions();
    if (visible.length === 0) return;
    this.confirmTarget = visible[this.cursor]!;
    this.confirmStatus = undefined;
    this.deleteInFlight = false;
    this.view = 'confirm';
  }

  /**
   * 开史动作（挖掘 50 轮件 C——注入缺席/空表/已退出零动作〔openConfirm 同形
   * 自守卫〕；行源 = visible 单源；id + 当时光标位双参上浮——光标位供退出
   * 复原切换器用）。归档视图不效（53 轮件 B——M1 裁：reopen 只携带活跃快照，
   * 归档会话的史窗无从开——门放方法内 key/text 两轨同守）。
   */
  private openHistoryAtCursor(): void {
    if (this.onOpenHistory === undefined || this.exited) return;
    if (this.sessionView === 'archived') return;
    const visible = this.visibleSessions();
    if (visible.length === 0) return;
    this.onOpenHistory(visible[this.cursor]!.id, this.cursor);
  }

  /**
   * 归档/恢复光标行（53 轮件 B——archive 向位由调用侧视图定：active 视图
   * true=归档 / archived 视图 false=恢复；归档视图 enter 恢复同柄）。成功位
   * 行离当前视图——就地滤行 + totalCount **恒 −1** 调账〔totalCount 语义 =
   * 当前视图域总数，归档/恢复两向统一是「行离视图」非 ±1 方向位——归档视图
   * 恢复即归档域 −1〕+ 光标显式夹取〔构造位同律：render 路 clampOffset 只
   * 夹 offset 从不写 cursor〕+ 预览缓存清该 id + 近底续页补拉；missing/异常
   * 行不动（missing warn 归通道核 wrapper 路由——面板无 notify 面）。单飞锁
   * 防双击（deleteInFlight 同族）。
   */
  private archiveAtCursor(archive: boolean): void {
    if (this.onArchive === undefined || this.exited || this.archiveInFlight) return;
    const visible = this.visibleSessions();
    if (visible.length === 0) return;
    const target = visible[this.cursor]!;
    this.archiveInFlight = true;
    this.onArchive(target.id, archive).then(
      (result) => {
        this.archiveInFlight = false;
        if (result.status === 'missing') {
          // 行不动（他处已删等竞窗——用户下次刷新面自愈，免谎滤）
          this.requestRepaint?.();
          return;
        }
        // 成功位：行离当前视图（archived/unarchived 同路）——sessions 副本内
        // id 滤除，搜索态过滤表经 visibleSessions 单源自然跟随
        const at = this.sessions.findIndex((s) => s.id === target.id);
        if (at >= 0) this.sessions.splice(at, 1);
        if (this.totalCount !== undefined) this.totalCount = Math.max(0, this.totalCount - 1);
        // 光标夹取（滤行后表变短；空表归 0——home 同族）
        this.cursor = Math.min(this.cursor, Math.max(this.visibleSessions().length - 1, 0));
        this.clampOffset();
        this.previewCache.delete(target.id);
        this.maybeLoadMore();
        this.requestRepaint?.();
      },
      () => {
        // 异常吞行不动（错误折面已由通道核 wrapper 折 notify 呈现——面板不重复）
        this.archiveInFlight = false;
        this.requestRepaint?.();
      },
    );
  }

  /**
   * 视图切换（53 轮件 B——active/archived 两视图互切）。成功位视图位翻 +
   * 行集**整页替换**〔非 append——两视图行集互斥〕+ totalCount=回执 total
   * 〔「清单与总数同过滤」律的视图化延伸——归档视图头行 N/M 的 M 若仍是活跃
   * 域总数即谎〕+ moreCursor=回执 nextCursor（token 单形经核包装）+
   * loadAttempted 置位〔回执即一次拉——终态占位「已到最早」判据如实〕+ 清
   * 搜索态 + cursor 归零 + 预览缓存清（跨视图陈值不复用）；异常吞回原视图
   * （sessionView 不动可重试——onLoadMore「异常静默」同族）。空表可切（调用
   * 位在 visible 门外——归档行可达的唯一路）。
   */
  private switchView(): void {
    if (this.onSwitchView === undefined || this.exited) return;
    const next: UiSessionListView = this.sessionView === 'active' ? 'archived' : 'active';
    this.onSwitchView(next).then(
      (page) => {
        this.sessionView = next;
        // 行集整替（sessions 是可变副本——length 清零重填，字段 readonly 不换柄）
        this.sessions.length = 0;
        for (const row of page.rows) this.sessions.push(row);
        this.totalCount = page.total;
        this.moreCursor = page.nextCursor;
        this.loadAttempted = true;
        this.searchQuery = null;
        this.cursor = 0;
        this.clampOffset();
        this.previewCache.clear();
        this.requestRepaint?.();
      },
      () => {
        // 异常吞回原视图（视图位不动——用户重按可重试）
        this.requestRepaint?.();
      },
    );
  }

  /**
   * query 变更后处理（挖掘 43 轮件 C——append/删尾/进态共用）：cursor 归 0
   * （过滤表收缩旧光标位无意义——codex query 变更 selected 归零同义）+ 视口
   * 夹取 + 展开态预览区联动新行
   */
  private afterQueryChanged(): void {
    this.cursor = 0;
    this.clampOffset();
    if (this.previewAreaInUse()) this.ensurePreviewOfCursor();
  }

  /**
   * 退搜索态保位（挖掘 43 轮件 C——codex 稳定键同义）：退态前光标行 id 经
   * 全表 findIndex 找回（清 query 后过滤表恢复全表——selected 映射回同一
   * 元素）；空过滤表回退 0；找不到回退 0（防御位——picker 生命周期内
   * sessions 只经本地删除滤行，退态前 visible[cursor] 必在 sessions）。
   * 保的是「当前浏览位」非「进场位」——无须进场快照账。
   */
  private exitSearch(): void {
    const visible = this.visibleSessions();
    const heldId = visible.length > 0 ? visible[this.cursor]!.id : undefined;
    this.searchQuery = null;
    if (heldId !== undefined) {
      const at = this.sessions.findIndex((s) => s.id === heldId);
      this.cursor = at >= 0 ? at : 0;
    } else {
      this.cursor = 0;
    }
    this.clampOffset();
    if (this.previewAreaInUse()) this.ensurePreviewOfCursor();
  }

  /** query 追加（挖掘 43 轮件 C——key 轨单字符 / text 轨粘贴规整串共用） */
  private appendQuery(text: string): void {
    this.searchQuery = (this.searchQuery ?? '') + text;
    this.afterQueryChanged();
  }

  /**
   * 光标行预览懒加载（挖掘 35 轮 B5）：缓存命中零动作（同步落帧——键事件
   * 后引擎重画承载，无需请帧）；缺席置 loading 占位 + 发闭包——异步回执
   * 落缓存 + requestRepaint 请帧（onDelete 回执同族；面板不自驱重画）。
   * 空行组归 empty 形（「（无转录）」诚实占位）；异常折 foldErrorText 单源。
   * 行源 = visible 单源（挖掘 43 轮件 C——漏换此位则 query 归 0 后预览区拉
   * 全表首行会话的尾段）。
   */
  private ensurePreviewOfCursor(): void {
    if (this.onPreview === undefined) return;
    const visible = this.visibleSessions();
    if (visible.length === 0) return;
    const id = visible[this.cursor]!.id;
    if (this.previewCache.has(id)) return; // 缓存命中（含 loading 在飞——不双发）
    this.previewCache.set(id, { status: 'loading' });
    this.onPreview(id).then(
      (lines) => {
        this.previewCache.set(id, lines.length === 0 ? { status: 'empty' } : { status: 'ok', lines });
        this.requestRepaint?.();
      },
      (err: unknown) => {
        // 错误折面单源 foldErrorText（用户面折面禁裸 String——acceptDelete 同律）
        this.previewCache.set(id, { status: 'error', message: foldErrorText(err) });
        this.requestRepaint?.();
      },
    );
  }

  /** 取消确认回清单（零回调——未确认不删） */
  private cancelConfirm(): void {
    this.view = 'list';
    this.confirmTarget = undefined;
    this.confirmStatus = undefined;
  }

  /**
   * 确认删除：发 onDelete（在飞守卫——回执落位前 enter 不双发）。回执路由：
   * deleted → 就地滤行回清单（刷新重拉最小形——快照档清单的确定性行移除）；
   * busy/missing → 留确认视图呈就地状态行（用户可取消重试）；异常 → 折状态行
   * （不炸面板——onSelect 链直穿会成 uncaughtException 杀 TUI）。异步落位后
   * requestRepaint 请帧（面板不自驱重画）。
   */
  private acceptDelete(): void {
    const target = this.confirmTarget;
    if (target === undefined || this.onDelete === undefined) return;
    if (this.deleteInFlight) return; // 在飞守卫（防双击）
    this.deleteInFlight = true;
    this.confirmStatus = undefined;
    this.onDelete(target.id).then(
      (result) => {
        this.deleteInFlight = false;
        if (result.status === 'deleted') {
          // 就地滤行 + 光标夹取（删尾行回退——空表如实「无会话」）
          const at = this.sessions.findIndex((s) => s.id === target.id);
          if (at >= 0) this.sessions.splice(at, 1);
          // 滤行联动总数递减（2026-10-07 勘正）：物理删后全量真值已减 1，
          // 不递减即翻「N/M（仅显示最近）」假截断注记新谎（B2 披露位——
          // total > 清单长判据两侧同步动；webui App 删除腿同裁量）
          if (this.totalCount !== undefined) this.totalCount = Math.max(0, this.totalCount - 1);
          // 光标夹取随 visible 重算（删除后 query 不变过滤自然跟随——挖掘 43 轮件 C）
          this.cursor = Math.max(0, Math.min(this.visibleSessions().length - 1, this.cursor));
          this.clampOffset();
          // 滤行后光标行已变——展开态预览区联动新行（缓存命中同步落帧）
          if (this.previewAreaInUse()) this.ensurePreviewOfCursor();
          this.view = 'list';
          this.confirmTarget = undefined;
          this.confirmStatus = undefined;
        } else if (result.status === 'busy') {
          this.confirmStatus = '会话正在运行——等待完成或先打断后再删（可按 esc 取消）';
        } else {
          this.confirmStatus = `会话不存在：${target.id}`;
        }
        this.requestRepaint?.();
      },
      (err: unknown) => {
        this.deleteInFlight = false;
        // 错误折面单源 foldErrorText（689e5ba 立规——用户面折面禁裸 String；
        // 件内可达导入，tui-backend 命令面同源）
        this.confirmStatus = `删除失败：${foldErrorText(err)}`;
        this.requestRepaint?.();
      },
    );
  }

  /** 光标移动（单步环绕/大步夹取——挖掘 35 轮 B6 分立律；移动后光标恒可见；展开态预览区光标行联动；表长随 visible 单源〔挖掘 43 轮件 C〕；近底续页拉挂点〔挖掘 51 轮件 A——滚轮/PgUp/PgDn 同经此路〕） */
  private moveCursor(delta: number): void {
    this.cursor = stepCursorWrap(this.cursor, delta, this.visibleSessions().length);
    this.clampOffset();
    if (this.previewAreaInUse()) this.ensurePreviewOfCursor();
    this.maybeLoadMore();
  }

  /** 视口夹取：光标行恒在窗内（下溢提窗 / 上溢压窗） */
  private clampOffset(): void {
    // 窗高上界：视口长高时 offset 不得深于「尾行恰贴窗底」位（首渲染前击键
    // 会以陈 viewportHeight=1 夹出过深 offset——render 回写真实窗高后回拉）
    const maxOffset = Math.max(0, this.visibleSessions().length - this.viewportHeight);
    if (this.offset > maxOffset) this.offset = maxOffset;
    if (this.cursor < this.offset) this.offset = this.cursor;
    else if (this.cursor >= this.offset + this.viewportHeight) {
      this.offset = this.cursor - this.viewportHeight + 1;
    }
  }

  /** 退出（闭锁——选定与取消单次收口） */
  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.onExit?.();
  }
}
