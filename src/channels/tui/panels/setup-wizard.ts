/**
 * /setup 配置向导副屏件（onboarding ob-3——07 §4.1 命令面 TUI 本地拦截族）：
 * 相态机面板实现 WizardPrompter 五法（接口居 channels 公开面——host 流程件
 * 纯函数化消费同一契约）。
 *
 * - **一屏五相**（intro/select/text/confirm/outro——market-picker 同基建：
 *   自持光标/视口 + kitty disambiguate 轨裸字母分派 + exit 闭锁防竞发）；
 * - **取消防收口**：select/text/confirm 的 esc/q = resolve(undefined)——流程
 *   侧解释中止（保存前零改动）；面板不闭（流程 outro 随即接管呈现）；
 * - **敏感录入掩码**：text sensitive 相键入只呈 ●（值只经回值出屏——态可
 *   入面、值恒不入面）；粘贴整段（paste 事件/多字 text）同律追加；
 * - **Ctrl+C = 打断在飞 run**（目标 = 当前交互会话位——不退屏，件族同律）、
 *   **Ctrl+D = 先撤悬题再退出柄**（退出闭锁后一切 prompter 法即时回值——
 *   流程侧自然收场）；
 * - 程序化重画经注入 requestRepaint（面板自持态变更自请——host 侧无从而知）。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { truncateToWidth } from '../../engine/index.js';
import type { OverlayContent } from '../overlay/overlay.js';
import type {
  WizardConfirmRequest,
  WizardPrompter,
  WizardSelectRequest,
  WizardTextRequest,
} from '../../wizard-prompter.js';

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 光标行标记（在选行） */
const CURSOR_MARK = '▸';
/** 敏感录入掩码符 */
const MASK_CHAR = '●';
/** 面板头前缀 */
const HEAD_PREFIX = '⚙ 配置向导';

/** 面板相（可变——prompter 法逐相切换） */
type Phase =
  | { readonly kind: 'static'; readonly title: string; readonly lines: readonly string[] }
  | {
      readonly kind: 'select';
      readonly req: WizardSelectRequest;
      cursor: number;
      readonly resolve: (value: string | undefined) => void;
    }
  | {
      readonly kind: 'text';
      readonly req: WizardTextRequest;
      buffer: string;
      readonly resolve: (value: string | undefined) => void;
    }
  | {
      readonly kind: 'confirm';
      readonly req: WizardConfirmRequest;
      yes: boolean;
      readonly resolve: (value: boolean | undefined) => void;
    }
  | {
      readonly kind: 'outro';
      readonly title: string;
      readonly lines: readonly string[];
      readonly resolve: () => void;
    };

/** 选装面板装配选项 */
export interface SetupWizardPanelOptions {
  readonly sessionId: string;
  /** 面板自持态变更后的重画请求（backend.requestAltRepaint 注入） */
  readonly requestRepaint: () => void;
  readonly onExit: () => void;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
}

/** key 事件窄化 */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/** 无修饰单字符判（legacy 轨打字——kitty 轨走 text 事件） */
function plainChar(e: InputEvent & { kind: 'key' }): string | null {
  if (e.ctrl || e.alt || e.meta) return null;
  return e.key.length === 1 ? e.key : null;
}

/**
 * 配置向导副屏内容件（OverlayContent + WizardPrompter 双面）：host 侧
 * runSetupWizard 流程持 prompter 面驱动，本件相态随问切换、键路由随相分发。
 */
export class SetupWizardPanel implements OverlayContent, WizardPrompter {
  private readonly sessionId: string;
  private readonly requestRepaint: () => void;
  private readonly onExit: () => void;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  /** 当前相（static 起——prompter 法切换） */
  private phase: Phase = { kind: 'static', title: '', lines: [] };
  /** 视口高实测（render 回写——翻选的页幅依据） */
  private viewportHeight = 1;
  /** 选择器视口首行（持久态——双向夹取防跳变，market-picker 同律） */
  private selectOffset = 0;
  /** 退出闭锁（竞发防御位——退出后一切 prompter 法即时回值） */
  private exited = false;

  constructor(options: SetupWizardPanelOptions) {
    this.sessionId = options.sessionId;
    this.requestRepaint = options.requestRepaint;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
  }

  /* ---------------- WizardPrompter 面（流程件消费） ---------------- */

  /** 开场（非阻塞——随即进入首问，static 相为过渡帧） */
  intro(title: string, lines: readonly string[]): void {
    if (this.exited) return;
    this.phase = { kind: 'static', title, lines };
    this.requestRepaint();
  }

  select(req: WizardSelectRequest): Promise<string | undefined> {
    return new Promise((resolve) => {
      if (this.exited) return resolve(undefined);
      const preselect = req.preselect !== undefined ? req.items.findIndex((item) => item.id === req.preselect) : -1;
      this.phase = {
        kind: 'select',
        req,
        cursor: preselect >= 0 ? preselect : 0,
        resolve,
      };
      this.requestRepaint();
    });
  }

  text(req: WizardTextRequest): Promise<string | undefined> {
    return new Promise((resolve) => {
      if (this.exited) return resolve(undefined);
      this.phase = { kind: 'text', req, buffer: '', resolve };
      this.requestRepaint();
    });
  }

  confirm(req: WizardConfirmRequest): Promise<boolean | undefined> {
    return new Promise((resolve) => {
      if (this.exited) return resolve(undefined);
      this.phase = { kind: 'confirm', req, yes: req.defaultYes, resolve };
      this.requestRepaint();
    });
  }

  outro(title: string, lines: readonly string[]): Promise<void> {
    return new Promise((resolve) => {
      if (this.exited) return resolve();
      this.phase = { kind: 'outro', title, lines, resolve };
      this.requestRepaint();
    });
  }

  /* ---------------- OverlayContent 面（副屏引擎消费） ---------------- */

  /** 量高：头行 + 相内容（相自量——选择器条目数等）+ 键面提示行 */
  measure(width: number): number {
    void width;
    const phase = this.phase;
    let body = 1;
    if (phase.kind === 'select') body = Math.max(1, phase.req.items.length) + (phase.req.note !== undefined ? 1 : 0);
    else if (phase.kind === 'text') body = 1 + (phase.req.preview !== undefined ? 1 : 0);
    else if (phase.kind === 'confirm') body = 2;
    else body = Math.max(1, phase.lines.length);
    return 1 + body + 1;
  }

  /** 落位：头行 → 相内容 → 键面提示行（选择器视口窗口化——market-picker 同律） */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    const phase = this.phase;
    const title =
      phase.kind === 'select' || phase.kind === 'text' || phase.kind === 'confirm' ? phase.req.title : phase.title;
    buffer.writeText(region.row, region.col, truncateToWidth(`${HEAD_PREFIX} · ${title}`, region.width));
    const end = region.row + region.height - 1; // 键面提示行占位
    let line = region.row + 1;
    let hint = 'esc 退出（保存前零改动）';
    if (phase.kind === 'select') {
      this.viewportHeight = Math.max(1, end - line);
      this.clampCursor(phase);
      const viewHeight = this.viewportHeight;
      const start = this.clampOffset(phase, viewHeight);
      for (let i = 0; i < viewHeight && line < end; i++) {
        const index = start + i;
        if (index >= phase.req.items.length) break;
        const item = phase.req.items[index]!;
        buffer.writeText(
          line,
          region.col,
          truncateToWidth(`${index === phase.cursor ? `${CURSOR_MARK} ` : '  '}${item.label}`, region.width),
        );
        line++;
      }
      if (phase.req.note !== undefined && line < end) {
        buffer.writeText(line, region.col, truncateToWidth(phase.req.note, region.width), HINT_STYLE);
        line++;
      }
      hint = '↑↓ 移动 · enter 选定 · esc 退出';
    } else if (phase.kind === 'text') {
      // 敏感相掩码呈现（值不入面）；非敏感原文；尾随 _ 光标位
      const shown = phase.req.sensitive === true ? MASK_CHAR.repeat([...phase.buffer].length) : phase.buffer;
      buffer.writeText(line, region.col, truncateToWidth(`${shown}_`, region.width));
      line++;
      if (phase.req.preview !== undefined && line < end) {
        buffer.writeText(line, region.col, truncateToWidth(`当前：${phase.req.preview}`, region.width), HINT_STYLE);
        line++;
      }
      if (phase.req.hint !== undefined && line < end) {
        buffer.writeText(line, region.col, truncateToWidth(phase.req.hint, region.width), HINT_STYLE);
        line++;
      }
      hint = '键入后 enter 确认 · backspace 删尾 · esc 退出';
    } else if (phase.kind === 'confirm') {
      buffer.writeText(line, region.col, truncateToWidth(phase.req.title, region.width));
      line++;
      if (line < end) {
        const yesMark = phase.yes ? '[是]' : ' 是 ';
        const noMark = phase.yes ? ' 否 ' : '[否]';
        buffer.writeText(line, region.col, `${yesMark}/${noMark} · enter 取 ${phase.req.defaultYes ? '是' : '否'}`);
        line++;
      }
      hint = 'y 是 · n 否 · ←/→ 切换 · enter 确认 · esc 退出';
    } else {
      for (const text of phase.lines) {
        if (line >= end) break;
        buffer.writeText(line, region.col, truncateToWidth(text, region.width));
        line++;
      }
      hint = phase.kind === 'outro' ? '任意键关闭' : '';
    }
    if (hint !== '' && end > region.row) {
      buffer.writeText(end, region.col, truncateToWidth(hint, region.width), HINT_STYLE);
    }
  }

  /**
   * 事件分发（副屏内容终局消费——模态独占）：Ctrl+C/Ctrl+D 补丁 → 相分发。
   * kitty disambiguate 轨：裸字母/打字走 text 事件（选择器 q 取消 + 录入
   * 追加两消费位）。
   */
  handleEvent(event: InputEvent): boolean {
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      // Ctrl+C = 打断在飞 run（目标 = 当前交互会话位——不退屏，件族同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        this.onInterrupt?.(this.sessionId);
        return true;
      }
      // Ctrl+D = 退出进程（撤悬题再转退出柄——闭锁后流程自然收场）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'd') {
        this.cancelPending();
        this.exit();
        this.onQuit?.();
        return true;
      }
      this.handleKeyEvent(k);
      return true;
    }
    if (event.kind === 'text' || event.kind === 'paste') {
      const text = event.kind === 'paste' ? event.text.replace(/[\r\n]+$/, '') : event.text;
      if (text !== '') this.handleTextRun(text);
      return true;
    }
    return true; // 未消费键终局吞（模态独占）
  }

  /* ---------------- 相分发 ---------------- */

  /** key 轨相分发（release 相已滤） */
  private handleKeyEvent(k: InputEvent & { kind: 'key' }): void {
    const phase = this.phase;
    if (phase.kind === 'select') {
      if (isPlainKey(k, 'up')) return this.moveCursor(phase, -1);
      if (isPlainKey(k, 'down')) return this.moveCursor(phase, 1);
      if (isPlainKey(k, 'pageup')) return this.moveCursor(phase, -this.viewportHeight);
      if (isPlainKey(k, 'pagedown')) return this.moveCursor(phase, this.viewportHeight);
      if (isPlainKey(k, 'home')) {
        phase.cursor = 0;
        this.requestRepaint();
        return;
      }
      if (isPlainKey(k, 'end')) {
        phase.cursor = Math.max(0, phase.req.items.length - 1);
        this.requestRepaint();
        return;
      }
      if (isPlainKey(k, 'enter')) {
        const chosen = phase.req.items[phase.cursor]?.id;
        return this.settleSelect(phase, chosen);
      }
      if (isPlainKey(k, 'escape') || isPlainKey(k, 'q')) return this.settleSelect(phase, undefined);
      return;
    }
    if (phase.kind === 'text') {
      if (isPlainKey(k, 'enter')) {
        const value = phase.buffer;
        this.settleText(phase, value);
        return;
      }
      if (isPlainKey(k, 'backspace')) {
        phase.buffer = [...phase.buffer].slice(0, -1).join('');
        this.requestRepaint();
        return;
      }
      if (isPlainKey(k, 'escape')) return this.settleText(phase, undefined); // 录入相无 q 捷键——字母 q 是内容
      // legacy 轨打字（kitty 轨走 text 事件——双轨同收）
      const ch = plainChar(k);
      if (ch !== null) {
        phase.buffer += ch;
        this.requestRepaint();
      }
      return;
    }
    if (phase.kind === 'confirm') {
      if (isPlainKey(k, 'y')) return this.settleConfirm(phase, true);
      if (isPlainKey(k, 'n')) return this.settleConfirm(phase, false);
      if (isPlainKey(k, 'left') || isPlainKey(k, 'right')) {
        phase.yes = isPlainKey(k, 'left');
        this.requestRepaint();
        return;
      }
      if (isPlainKey(k, 'enter')) return this.settleConfirm(phase, phase.yes);
      if (isPlainKey(k, 'escape') || isPlainKey(k, 'q')) return this.settleConfirm(phase, undefined);
      return;
    }
    if (phase.kind === 'outro') {
      // 任意键收尾（enter/esc/q/space…——收屏终局）
      this.exit();
      phase.resolve();
      return;
    }
    // static（intro/过渡）：吞键待下一问（intro 非阻塞——流程随即进首问）
  }

  /** text 轨相分发（kitty 打字 + 粘贴整段——敏感/非敏感同路追加） */
  private handleTextRun(text: string): void {
    const phase = this.phase;
    if (phase.kind === 'text') {
      phase.buffer += text;
      this.requestRepaint();
      return;
    }
    if (phase.kind === 'select') {
      // kitty disambiguate 轨裸字母（q 取消——market-picker 同形坑）
      if (text === 'q') this.settleSelect(phase, undefined);
      return;
    }
    if (phase.kind === 'confirm') {
      if (text === 'y') this.settleConfirm(phase, true);
      else if (text === 'n') this.settleConfirm(phase, false);
      return;
    }
    if (phase.kind === 'outro') {
      this.exit();
      phase.resolve();
    }
  }

  /* ---------------- 收口与工具 ---------------- */

  /** 选择器收口（选定/取消共尾——撤相防陈交互，resolve 后流程接管） */
  private settleSelect(phase: Extract<Phase, { kind: 'select' }>, value: string | undefined): void {
    this.phase = { kind: 'static', title: value !== undefined ? '已选' : '已取消', lines: [] };
    phase.resolve(value);
    this.requestRepaint();
  }

  /** 录入收口（回值原样——剥前缀归流程侧单源） */
  private settleText(phase: Extract<Phase, { kind: 'text' }>, value: string | undefined): void {
    this.phase = { kind: 'static', title: '已录', lines: [] };
    phase.resolve(value);
    this.requestRepaint();
  }

  /** 确认收口 */
  private settleConfirm(phase: Extract<Phase, { kind: 'confirm' }>, value: boolean | undefined): void {
    this.phase = { kind: 'static', title: '已答', lines: [] };
    phase.resolve(value);
    this.requestRepaint();
  }

  /** 撤悬题（退出路——Ctrl+D：悬题按取消收口，流程侧自然收场） */
  private cancelPending(): void {
    const phase = this.phase;
    if (phase.kind === 'select' || phase.kind === 'text') phase.resolve(undefined);
    else if (phase.kind === 'confirm') phase.resolve(undefined);
    else if (phase.kind === 'outro') phase.resolve();
    this.phase = { kind: 'static', title: '', lines: [] };
  }

  /** 光标夹取（条目下标入界；空表归 0） */
  private clampCursor(phase: Extract<Phase, { kind: 'select' }>): void {
    const length = phase.req.items.length;
    phase.cursor = length > 0 ? Math.max(0, Math.min(length - 1, phase.cursor)) : 0;
  }

  /** 视口夹取：光标行恒在窗内（持久 offset 双向夹取防跳变——返回视口首行） */
  private clampOffset(phase: Extract<Phase, { kind: 'select' }>, viewHeight: number): number {
    const maxOffset = Math.max(0, phase.req.items.length - viewHeight);
    if (this.selectOffset > maxOffset) this.selectOffset = maxOffset;
    if (phase.cursor < this.selectOffset) this.selectOffset = phase.cursor;
    else if (phase.cursor >= this.selectOffset + viewHeight) this.selectOffset = phase.cursor - viewHeight + 1;
    return this.selectOffset;
  }

  /** 光标移动（越界夹取不循环；移动后重画） */
  private moveCursor(phase: Extract<Phase, { kind: 'select' }>, delta: number): void {
    phase.cursor = Math.max(0, Math.min(phase.req.items.length - 1, phase.cursor + delta));
    this.requestRepaint();
  }

  /** 退出（闭锁——单次收口） */
  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.onExit?.();
  }
}
