/**
 * /sessions 会话切换副屏件（07 §4.1 R7 批 10k——选定走 registry.focus()
 * 既有权威路〔通道核闭包注入 onSelect〕；本件只呈现清单与光标选择）。
 *
 * - **光标行选择**（与回看器滚动模型分立的选择模型）：↑/↓ 移动光标
 *   （PgUp/PgDn 翻选、Home/End 到首尾），Enter 选定 → 先收副屏再 onSelect
 *   （切焦异步 repaint 与收屏两序皆收敛——挂起闸/复起全帧重画各担一形）；
 * - **行呈现**：光标标记 › + 活跃位 ●（进程内 driver 在场）+ 标题（缺席
 *   如实「（无题）」）+ 右侧时间（MM-DD HH:mm——呈现位确定性）与会话短
 *   id；超宽整字截断（左段适配剩余宽——CJK 双宽不产半字）；
 * - **滚动**：光标驱动的窗口滚动（光标恒可见——offset 跟随夹取），非
 *   ScrollView 的自由滚动（选择模型下两者合一更直）；
 * - **删除键与确认位**（05 §2.5 会话删除编排定形注①）：onDelete 注入在场
 *   时 'd'（key/text 双轨）进确认视图——破坏性动作必有确认（明示删除对象
 *   与「含审批记录在内的全部会话史将被删除且不可恢复」）；enter 确认 /
 *   esc·q 取消；回执 busy/missing 留确认视图呈就地状态行（notify 副屏期
 *   走停屏缓冲——面板须自带呈现），deleted 就地滤行回清单（刷新重拉最小
 *   形）；注入缺席 'd' 键无效零行为变；
 * - **退出键面**：q/Esc 取消退出、Ctrl+C 打断、Ctrl+D 退出进程（先收副屏
 *   再转退出柄）——副屏键面补丁三件套与件 8 同律。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { fitLine, fitRowSegments } from '../row-segments.js';
import { shortIdOf } from '../backend/transcript.js';
import type { OverlayContent } from '../overlay/overlay.js';
import type { UiSessionDeleteResult, UiSessionSummary } from '../../../contracts/index.js';
import { hintLine } from '../keys/hint.js';
import { foldErrorText } from '../../service.js';
import { DIM_STYLE } from '../../engine/index.js';
import { CURSOR_MARK, HEAD_MARKS } from '../panels/panel-chrome.js';

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
   * 异步请帧（删除回执落位后重画——面板不自驱重画；装配接 altHost
   * requestRepaint）。同步键路（视图切换/取消）由引擎事件后重画承载。
   */
  readonly requestRepaint?: () => void;
}

/** 提示行样式（dim——注⑩：engine DIM_STYLE 单源） */
const HINT_STYLE: Readonly<CellStyle> = DIM_STYLE;
/** 活跃位标记（进程内 driver 在场） */
const ACTIVE_MARK = '●';
/** 滚轮单步行数（ScrollView WHEEL_LINES 同值——vim mousescroll ver 缺省档三行；mu-2 件族面） */
const WHEEL_LINES = 3;
/** 删除确认视图警示记号 */
const WARN_MARK = '⚠';

/** key 事件窄化 */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/** 活动时间呈现（MM-DD HH:mm——呈现位确定性形；本地时区显示档） */
function formatStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

  constructor(options: SessionPickerOptions) {
    this.sessions = [...options.sessions]; // 可变副本（就地滤行——不回写调用方数组）
    this.totalCount = options.totalCount;
    this.onSelect = options.onSelect;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.onDelete = options.onDelete;
    this.requestRepaint = options.requestRepaint;
  }

  /** 量高：清单形 = 头行 + 清单全量 + 底行提示（副屏 root 不经布局路——render 按实际 region 窗口化）；确认视图定高（头 + 警示 + 状态行预留 + 底行） */
  measure(width: number): number {
    void width;
    if (this.view === 'confirm') return 5;
    return 1 + Math.max(1, this.sessions.length) + 1;
  }

  /** 落位：清单视图 = 头行 → 清单视口（光标行标记 + 活跃位 + 标题左段 / 时间·短 id 右段）→ 底行提示；确认视图 = 警示文案 + 就地状态行 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    if (this.view === 'confirm') {
      this.renderConfirm(buffer, region);
      return;
    }
    // 头行：全量已呈现原形；总数超清单长 → N/M + 仅显示最近（B2 截断披露——
    // 清单默认 100 窗，超窗不注记即「所见即全量」的静默谎）
    const n = this.sessions.length;
    const head =
      n === 0
        ? `${HEAD_MARKS.session} 会话切换 · 无会话`
        : this.totalCount !== undefined && this.totalCount > n
          ? `${HEAD_MARKS.session} 会话切换 · ${n}/${this.totalCount} 会话（仅显示最近）`
          : `${HEAD_MARKS.session} 会话切换 · ${n} 会话`;
    // 非条目行（头行/空态行/底行）fitLine … 收口（wf_3c8b00b8 组δ X-5——raw
    // writeText 窄窗硬截断无提示；条目行走 fitRowSegments 双段）
    buffer.writeText(region.row, region.col, fitLine(head, region.width));
    // 守卫族语义（height=2 → 零内容行只头行+底行）：下限 0——旧 Math.max(1,·)
    // 在 height=2 强立 1 行内容，首内容行先写后又被底行覆写留残段
    const viewHeight = Math.max(0, region.height - 2);
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
      } else {
        for (let i = 0; i < viewHeight; i++) {
          const index = this.offset + i;
          if (index >= this.sessions.length) break;
          this.renderRow(buffer, region.row + 1 + i, region.col, region.width, index);
        }
      }
    }
    // 底行提示：删除注入在场加「d 删除」段（键面如实——缺席保持原形不虚报）
    buffer.writeText(
      region.row + region.height - 1,
      region.col,
      fitLine(
        this.sessions.length === 0
          ? 'q/esc 返回'
          : this.onDelete !== undefined
            ? hintLine('↑↓ 移动', 'enter 切换', 'd 删除', 'q/esc 返回')
            : hintLine('↑↓ 移动', 'enter 切换', 'q/esc 返回'),
        region.width,
      ),
      HINT_STYLE,
    );
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
    // 就地状态行（busy/missing/异常折面——notify 副屏期走停屏缓冲，面板自带
    // 呈现保确认视图内可见）
    if (this.confirmStatus !== undefined) {
      buffer.writeText(region.row + 2, region.col, fitLine(this.confirmStatus, region.width));
    }
    buffer.writeText(
      region.row + region.height - 1,
      region.col,
      fitLine(hintLine('enter 确认删除', 'esc/q 取消'), region.width),
      HINT_STYLE,
    );
  }

  /** 单行落位：左段（光标 + 活跃位 + 标题——适配剩余宽截断）+ 右段（时间 短id）右对齐 */
  private renderRow(buffer: CellBuffer, row: number, col: number, width: number, index: number): void {
    const session = this.sessions[index]!;
    const right = `${formatStamp(session.updatedAt)} ${shortIdOf(session.id)}`;
    // 左段 = 光标标记 + 活跃位 + 标题
    const prefix = index === this.cursor ? `${CURSOR_MARK} ` : '  ';
    const title = session.title !== undefined && session.title !== '' ? session.title : '（无题）';
    const left = `${prefix}${session.active ? ACTIVE_MARK : ' '} ${title}`;
    // 右段预算律单源：时间/短 id 先按预算 … 截断再右对齐（窄窗不再负起列
    // 劈毁标题——两段各自整字截断不撕宽字符）
    const fit = fitRowSegments(left, right, width);
    buffer.writeText(row, col, fit.left);
    if (fit.rightWidth > 0) buffer.writeText(row, col + width - fit.rightWidth, fit.right, HINT_STYLE);
  }

  /** 事件分发（副屏内容终局消费）：滚轮 → Ctrl+C/Ctrl+D 补丁 → 确认视图（enter 确认 / esc·q 取消）→ 删除键 → 选定/取消 → 移动键 */
  handleEvent(event: InputEvent): boolean {
    if (event.kind === 'mouse') {
      // 确认视图吞鼠标（光标移动无意义——模态确认）
      if (this.view === 'confirm') return true;
      // 滚轮 = 光标 ±3 行（mu-2 件族面——经 moveCursor 既有夹取与视口跟随，
      // ↑↓ 同路）；wheel 无 release 相（终端不报——press 一相到达）；非滚轮
      // 鼠标相零动作吞（v1 无选区/点击面，模态独占）
      if (event.phase === 'press' && (event.button === 'wheel-up' || event.button === 'wheel-down')) {
        if (this.sessions.length > 0) {
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
      if (this.sessions.length > 0) {
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
          return true;
        }
        if (isPlainKey(k, 'end')) {
          this.cursor = this.sessions.length - 1;
          this.clampOffset();
          return true;
        }
        if (isPlainKey(k, 'enter')) {
          const chosen = this.sessions[this.cursor]!;
          this.exit(); // 先收副屏（切焦 repaint 异步到达——收屏与重画两序皆收敛）
          this.onSelect(chosen.id);
          return true;
        }
        // 'd' = 删除键（05 §2.5 定形注①——注入在场才有效：进确认视图；缺席
        // 吞而不动作——键面帮助行同步缺席不注记）
        if (isPlainKey(k, 'd')) {
          this.openConfirm();
          return true;
        }
      }
      if (isPlainKey(k, 'escape') || isPlainKey(k, 'q')) {
        this.exit();
        return true;
      }
    }
    if (event.kind === 'text') {
      // kitty disambiguate 轨纯键打字走 text 事件——q/d 双轨收键（与 key 轨
      // 同律：q 退出/取消、d 删除）
      if (event.text === 'q') {
        if (this.view === 'confirm') this.cancelConfirm();
        else this.exit();
        return true;
      }
      if (event.text === 'd') {
        if (this.view === 'list') this.openConfirm();
        return true;
      }
    }
    return true; // 未消费键终局吞（模态独占）
  }

  /** 进确认视图（光标行快照为删除目标——注入缺席/空表/已退出零动作） */
  private openConfirm(): void {
    if (this.onDelete === undefined || this.sessions.length === 0 || this.exited) return;
    this.confirmTarget = this.sessions[this.cursor]!;
    this.confirmStatus = undefined;
    this.deleteInFlight = false;
    this.view = 'confirm';
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
          this.cursor = Math.max(0, Math.min(this.sessions.length - 1, this.cursor));
          this.clampOffset();
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

  /** 光标移动（越界夹取——不循环；移动后光标恒可见） */
  private moveCursor(delta: number): void {
    this.cursor = Math.max(0, Math.min(this.sessions.length - 1, this.cursor + delta));
    this.clampOffset();
  }

  /** 视口夹取：光标行恒在窗内（下溢提窗 / 上溢压窗） */
  private clampOffset(): void {
    // 窗高上界：视口长高时 offset 不得深于「尾行恰贴窗底」位（首渲染前击键
    // 会以陈 viewportHeight=1 夹出过深 offset——render 回写真实窗高后回拉）
    const maxOffset = Math.max(0, this.sessions.length - this.viewportHeight);
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
