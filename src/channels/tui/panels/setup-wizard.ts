/**
 * /setup 配置向导副屏件（onboarding ob-3——07 §4.1 命令面 TUI 本地拦截族；
 * 2026-09-28 模型渠道批 C-3 v2）：相态机面板实现 WizardPrompter 六法（接口
 * 居 channels 公开面——host 流程件纯函数化消费同一契约）。
 *
 * - **一屏六相**（intro/select/multiselect/text/confirm/outro——market-picker
 *   同基建：自持光标/视口 + kitty disambiguate 轨裸字母分派 + exit 闭锁防竞发）；
 * - **取消防收口**：select/multiselect/text/confirm 的 esc/q = resolve(undefined)
 *   ——流程侧解释中止（保存前零改动）；面板不闭（流程 outro 随即接管呈现）；
 * - **录入回显全明文**（2026-09-28 全明文翻裁——用户拍板人面所见即所录；
 *   v1 敏感掩码相整条退役：值经回值出屏的通道不变，呈现恒原文）；
 * - **multiselect 相**（v2 新法——模型清单勾选）：空格切换勾选、enter 回
 *   勾选 id 清单（空清单合法——流程侧解释）；q 取消同 select；
 * - **select desc 次行**（v2 分桶选单渠道元信息位）：条目行下 dim 次行
 *   （baseUrl 等）；视口溢出不硬挤；**窗口化按物理行预算夹取**（#21 修——
 *   desc 在场条目占 2 物理行，光标条目含 desc 恒完整入窗；与 measure 同源）；
 * - **paste 剥所有换行**（#22 修——单行字段无换行语义，内嵌换行不入睡值）、
 *   **confirm 相 q 双轨同收**（#23 修——kitty text 轨 q 同 esc 取消，
 *   select/multiselect 两键轨同律；text 相字母 q 仍为合法录入）；
 * - **Ctrl+C = 打断在飞 run**（目标 = 当前交互会话位——不退屏，件族同律）、
 *   **Ctrl+D = 先撤悬题再退出柄**（text 相有文不退——主屏空框闸让路同律
 *   〔07 §4.1 输入路由 2026-09-07 实装对账裁决①：退出判据含输入框空、
 *   在场让路〕；空缓冲后照常退出（逃生舱不锁死）；退出闭锁后一切
 *   prompter 法即时回值——流程侧自然收场）；
 * - **外部收屏清算**（OverlayContent onClosed——AltScreenHost.close 单源
 *   调）：cancelPending + exited 闭锁——在飞问题 promise 按取消收口，
 *   流程侧零改动自然走 abortOut 诚实收场（悬垂泄漏封堵）；
 * - 程序化重画经注入 requestRepaint（面板自持态变更自请——host 侧无从而知）。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { truncateToWidth } from '../../engine/index.js';
import type { OverlayContent } from '../overlay/overlay.js';
import type {
  WizardConfirmRequest,
  WizardMultiselectRequest,
  WizardPrompter,
  WizardSelectRequest,
  WizardTextRequest,
} from '../../wizard-prompter.js';

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 光标行标记（在选行） */
const CURSOR_MARK = '▸';
/** multiselect 勾选/未选标记（v2——模型清单勾选相） */
const CHECKED_MARK = '◉';
const UNCHECKED_MARK = '○';
/** 面板头前缀 */
const HEAD_PREFIX = '⚙ 配置向导';
/** 滚轮单步行数（ScrollView WHEEL_LINES 同值——vim mousescroll ver 缺省档三行；mu-2 件族面） */
const WHEEL_LINES = 3;

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
      readonly kind: 'multiselect';
      readonly req: WizardMultiselectRequest;
      cursor: number;
      /** 勾选集（id 键——空格切换增删） */
      readonly checked: Set<string>;
      readonly resolve: (value: readonly string[] | undefined) => void;
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
 * 视口窗口化走 region 内 clampOffset（副屏路 region = 终端满高——物理
 * 约束下的最大值，无需 ViewportCapAware 帽协议；该协议只服务主屏
 * overlay 栈的截断预算恒等式）。
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
  /** 选择器视口首条目下标（持久态——物理行预算双向夹取防跳变，#21 修） */
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

  /** 多选（v2 法——勾选 id 清单；取消 = undefined） */
  multiselect(req: WizardMultiselectRequest): Promise<readonly string[] | undefined> {
    return new Promise((resolve) => {
      if (this.exited) return resolve(undefined);
      const checked = new Set(req.preselect ?? []);
      this.phase = {
        kind: 'multiselect',
        req,
        cursor: 0,
        checked,
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

  /** 忙等指示（R-3——static 相呈现 ⏳ 行非阻塞；返回幂等清除函数） */
  busy(label: string): () => void {
    if (this.exited) return () => {};
    this.phase = { kind: 'static', title: `⏳ ${label}`, lines: [] };
    this.requestRepaint();
    let cleared = false;
    return () => {
      if (cleared || this.exited) return;
      cleared = true;
      this.phase = { kind: 'static', title: '', lines: [] };
      this.requestRepaint();
    };
  }

  /* ---------------- OverlayContent 面（副屏引擎消费） ---------------- */

  /**
   * 量高：头行 + 相内容（相自量——选择器条目数等）+ 键面提示行。
   * 注：副屏路（Engine.renderNow）region = 终端满高、不消费本值——本面
   * 仅为 OverlayContent 契约完整性与测试直测而设。
   */
  measure(width: number): number {
    void width;
    const phase = this.phase;
    let body = 1;
    if (phase.kind === 'select' || phase.kind === 'multiselect') {
      // 条目行 + desc 次行（在场各 +1）+ 尾注行
      body = Math.max(1, phase.req.items.length);
      for (const item of phase.req.items) if (item.desc !== undefined) body += 1;
      if (phase.req.note !== undefined) body += 1;
    } else if (phase.kind === 'text') body = 1 + (phase.req.preview !== undefined ? 1 : 0);
    else if (phase.kind === 'confirm') body = 2 + (phase.req.lines !== undefined ? phase.req.lines.length : 0);
    else body = Math.max(1, phase.lines.length);
    return 1 + body + 1;
  }

  /** 落位：头行 → 相内容 → 键面提示行（选择器视口窗口化——market-picker 同律） */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    const phase = this.phase;
    const title =
      phase.kind === 'select' || phase.kind === 'multiselect' || phase.kind === 'text' || phase.kind === 'confirm'
        ? phase.req.title
        : phase.title;
    buffer.writeText(region.row, region.col, truncateToWidth(`${HEAD_PREFIX} · ${title}`, region.width));
    const end = region.row + region.height - 1; // 键面提示行占位
    let line = region.row + 1;
    let hint = 'esc 退出（保存前零改动）';
    if (phase.kind === 'select') {
      this.viewportHeight = Math.max(1, end - line);
      this.clampCursor(phase);
      // 窗口化按物理行预算（#21）：从窗首条目起逐条占行（desc 次行在场 +1），
      // line 预算尽即停——勿按条目数截窗（desc 在场时条目数 ≠ 物理行数）
      const start = this.clampOffset(phase, this.viewportHeight);
      let lastDrawn = start - 1; // 窗内最后绘到的条目（预算尽提前停即低于尾条）
      for (let index = start; index < phase.req.items.length && line < end; index++) {
        const item = phase.req.items[index]!;
        buffer.writeText(
          line,
          region.col,
          truncateToWidth(`${index === phase.cursor ? `${CURSOR_MARK} ` : '  '}${item.label}`, region.width),
        );
        line++;
        // desc 次行（v2——dim 渠道元信息；视口溢出不硬挤）
        if (item.desc !== undefined && line < end) {
          buffer.writeText(line, region.col, truncateToWidth(`    ${item.desc}`, region.width), HINT_STYLE);
          line++;
        }
        lastDrawn = index;
      }
      if (phase.req.note !== undefined && line < end) {
        buffer.writeText(line, region.col, truncateToWidth(phase.req.note, region.width), HINT_STYLE);
        line++;
      }
      // 滚动溢出指示（用户真机反馈）：窗上/下方还有被裁条目时在键面行报计数，
      // 让长清单「还有多少」可感知（并入键面行零几何耦合——不占行预算）
      hint = this.overflowHint(phase.req.items, start, lastDrawn, '↑↓ 移动 · enter 选定 · esc 退出');
    } else if (phase.kind === 'multiselect') {
      this.viewportHeight = Math.max(1, end - line);
      this.clampCursor(phase);
      // 窗口化按物理行预算（#21——与 select 相同律，共用 clampOffset）
      const start = this.clampOffset(phase, this.viewportHeight);
      let lastDrawn = start - 1; // 窗内最后绘到的条目（与 select 相同律）
      for (let index = start; index < phase.req.items.length && line < end; index++) {
        const item = phase.req.items[index]!;
        const mark = phase.checked.has(item.id) ? CHECKED_MARK : UNCHECKED_MARK;
        buffer.writeText(
          line,
          region.col,
          truncateToWidth(`${index === phase.cursor ? `${CURSOR_MARK} ` : '  '}${mark} ${item.label}`, region.width),
        );
        line++;
        if (item.desc !== undefined && line < end) {
          buffer.writeText(line, region.col, truncateToWidth(`    ${item.desc}`, region.width), HINT_STYLE);
          line++;
        }
        lastDrawn = index;
      }
      if (phase.req.note !== undefined && line < end) {
        buffer.writeText(line, region.col, truncateToWidth(phase.req.note, region.width), HINT_STYLE);
        line++;
      }
      // 滚动溢出指示（与 select 相同律——长模型清单勾选面同感知）
      hint = this.overflowHint(phase.req.items, start, lastDrawn, '↑↓ 移动 · space 勾选 · enter 确认 · esc 退出');
    } else if (phase.kind === 'text') {
      // 全明文回显（2026-09-28 翻裁——掩码相退役恒原文）；尾随 _ 光标位
      buffer.writeText(line, region.col, truncateToWidth(`${phase.buffer}_`, region.width));
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
      // 附呈行（v2 全值回执位——dim 直呈所录值）
      if (phase.req.lines !== undefined) {
        for (const text of phase.req.lines) {
          if (line >= end) break;
          buffer.writeText(line, region.col, truncateToWidth(text, region.width), HINT_STYLE);
          line++;
        }
      }
      if (line < end) {
        const yesMark = phase.yes ? '[是]' : ' 是 ';
        const noMark = phase.yes ? ' 否 ' : '[否]';
        // enter 结算当前切换态（←/→ 可切）——尾段与括号标记同源取 phase.yes，
        // 非 req.defaultYes（readonly 请求缺省恒不变，切后屏示会失真）
        buffer.writeText(line, region.col, `${yesMark}/${noMark} · enter 取 ${phase.yes ? '是' : '否'}`);
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
   * 事件分发（副屏内容终局消费——模态独占）：滚轮相态分派 → Ctrl+C/Ctrl+D
   * 补丁 → 相分发。kitty disambiguate 轨：裸字母/打字走 text 事件（选择器
   * q 取消 + 录入追加两消费位）。
   */
  handleEvent(event: InputEvent): boolean {
    if (event.kind === 'mouse') {
      // 滚轮相态分派（mu-2 件族面）：select 相滚清单（光标 ±3 行——经既有
      // 夹取，↑↓ 同路）；text/confirm/static/outro 相零动作（录入/确认态
      // 滚轮无义）；wheel 无 release 相（终端不报——press 一相到达）；非
      // 滚轮鼠标相零动作吞（模态独占）
      if (event.phase === 'press' && (event.button === 'wheel-up' || event.button === 'wheel-down')) {
        const phase = this.phase;
        if (phase.kind === 'select' || phase.kind === 'multiselect') {
          this.moveCursor(phase, event.button === 'wheel-up' ? -WHEEL_LINES : WHEEL_LINES);
        }
        return true;
      }
      return true;
    }
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      // Ctrl+C = 打断在飞 run（目标 = 当前交互会话位——不退屏，件族同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        this.onInterrupt?.(this.sessionId);
        return true;
      }
      // Ctrl+D = 退出进程（text 相有文不退——主屏空框闸让路同律〔07 §4.1
      // 输入路由 2026-09-07 实装对账裁决①：在场让路、不发明「首按清缓冲」；
      // 有文时落入相分发被吞（纯不退）〕；撤悬题再转退出柄——闭锁后流程
      // 自然收场）
      if (
        k.ctrl &&
        !k.alt &&
        !k.shift &&
        !k.meta &&
        k.key === 'd' &&
        (this.phase.kind !== 'text' || this.phase.buffer === '')
      ) {
        this.cancelPending();
        this.exit();
        this.onQuit?.();
        return true;
      }
      this.handleKeyEvent(k);
      return true;
    }
    if (event.kind === 'text' || event.kind === 'paste') {
      // paste 剥所有换行（#22——单行字段无换行语义：内嵌换行入 buffer 会致
      // 回显（引擎跳控制字节拼连通顺）所见≠所录、存值经 trim 幸存坏 key）
      const text = event.kind === 'paste' ? event.text.replace(/[\r\n]+/g, '') : event.text;
      if (text !== '') this.handleTextRun(text);
      return true;
    }
    return true; // 未消费键终局吞（模态独占）
  }

  /**
   * 外部收屏通知（OverlayContent onClosed——AltScreenHost.close 单源位调，
   * 07 §4.1 2026-09-23 定形）：外部收屏路（ask 收屏扇出 / collapseAltScreen）
   * 不经键面，在飞问题 promise 在此清算（取消形收口——流程侧 abortOut 诚实
   * 收场）+ exited 闭锁（此后一切 prompter 法即时回值）。已闭锁时幂等零动作。
   */
  onClosed(): void {
    if (this.exited) return; // 已收口（outro 收屏 / Ctrl+D 已撤）——幂等
    this.cancelPending(); // 悬题按取消收口（undefined 形）
    this.exit(); // 闭锁（onExit 收副屏在调用位已先行置空——重入无害）
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
    if (phase.kind === 'multiselect') {
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
      // 空格双形（key 轨 'space' 命名形 + ' ' 字符形——引擎双轨防御）；kitty
      // text 轨 ' ' 在 handleTextRun 同判（打字走 text 事件）
      if (isPlainKey(k, 'space') || isPlainKey(k, ' ')) return this.toggleChecked(phase);
      if (isPlainKey(k, 'enter')) {
        // 勾选清单按 items 序保序（Set 无序——呈现序即回值序）
        const chosen = phase.req.items.filter((item) => phase.checked.has(item.id)).map((item) => item.id);
        return this.settleMultiselect(phase, chosen);
      }
      if (isPlainKey(k, 'escape') || isPlainKey(k, 'q')) return this.settleMultiselect(phase, undefined);
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
    if (phase.kind === 'multiselect') {
      // kitty 轨空格（打字走 text 事件——与 key 轨双形同判）；q 取消
      if (text === ' ') this.toggleChecked(phase);
      else if (text === 'q') this.settleMultiselect(phase, undefined);
      return;
    }
    if (phase.kind === 'confirm') {
      // y/n 直答；q 取消（#23——kitty text 轨与 key 轨 q/esc 双轨同收，
      // select/multiselect 两键轨同律对齐——修前 text 轨 q 被吞不取消）
      if (text === 'y') this.settleConfirm(phase, true);
      else if (text === 'n') this.settleConfirm(phase, false);
      else if (text === 'q') this.settleConfirm(phase, undefined);
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

  /** 多选收口（确认/取消共尾——items 序保序清单或 undefined） */
  private settleMultiselect(
    phase: Extract<Phase, { kind: 'multiselect' }>,
    value: readonly string[] | undefined,
  ): void {
    this.phase = {
      kind: 'static',
      title: value !== undefined ? (value.length > 0 ? `已选 ${value.length} 项` : '全不选') : '已取消',
      lines: [],
    };
    phase.resolve(value);
    this.requestRepaint();
  }

  /** 勾选切换（光标位条目——Set 增删幂等） */
  private toggleChecked(phase: Extract<Phase, { kind: 'multiselect' }>): void {
    const id = phase.req.items[phase.cursor]?.id;
    if (id === undefined) return; // 空表防御（items ≥1 由流程侧保证）
    if (phase.checked.has(id)) phase.checked.delete(id);
    else phase.checked.add(id);
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
    if (phase.kind === 'select' || phase.kind === 'multiselect' || phase.kind === 'text') phase.resolve(undefined);
    else if (phase.kind === 'confirm') phase.resolve(undefined);
    else if (phase.kind === 'outro') phase.resolve();
    this.phase = { kind: 'static', title: '', lines: [] };
  }

  /** 光标夹取（条目下标入界；空表归 0——select/multiselect 共用） */
  private clampCursor(phase: Extract<Phase, { kind: 'select' }> | Extract<Phase, { kind: 'multiselect' }>): void {
    const length = phase.req.items.length;
    phase.cursor = length > 0 ? Math.max(0, Math.min(length - 1, phase.cursor)) : 0;
  }

  /**
   * 滚动溢出指示（用户真机反馈「看不到还有多少」）：窗上/下方被裁条目数
   * 前缀进键面行（形如「↑18 项 · ↓3 项 · ↑↓ 移动 · …」）；全清单入窗时
   * 返回原键面文案零污染。并入键面行零几何耦合——不占行预算、不回流
   * clampOffset（select/multiselect 共用）。
   */
  private overflowHint(
    items: readonly { readonly label: string; readonly desc?: string }[],
    start: number,
    lastDrawn: number,
    baseHint: string,
  ): string {
    const above = start; // 窗首前被裁条目数
    const below = items.length - 1 - lastDrawn; // 窗尾后被裁条目数（预算尽提前停如实计）
    const parts: string[] = [];
    if (above > 0) parts.push(`↑${above} 项`);
    if (below > 0) parts.push(`↓${below} 项`);
    return parts.length > 0 ? `${parts.join(' · ')} · ${baseHint}` : baseHint;
  }

  /**
   * 视口夹取（物理行预算——#21 修）：光标条目（含其 desc 次行）恒完整入窗。
   * 条目行高 = label 行 + desc 在场次行（与 measure 同源——desc 普遍在场时
   * 条目数 ≠ 物理行数，按条目数夹取会把光标条目滚出屏）；持久 offset 双向
   * 夹取防跳变（尾向步进最小滚动），返回视口首条目下标（select/multiselect 共用）。
   */
  private clampOffset(
    phase: Extract<Phase, { kind: 'select' }> | Extract<Phase, { kind: 'multiselect' }>,
    rowBudget: number,
  ): number {
    const items = phase.req.items;
    if (items.length === 0) return (this.selectOffset = 0); // 空表防御
    // 条目物理行高（desc 在场 = 2——与 measure() select 分支累加同源）
    const rowsOf = (item: { readonly desc?: string }): number => (item.desc !== undefined ? 2 : 1);
    // 尾向上界：最大可滚起点 = 从该起到表尾累计行 ≤ 预算（再往上滚尾后留空白
    // 无义；尾条目独占作保底——预算不足单条目行高时仍可滚到尾条目 label 行）
    let tailRows = rowsOf(items[items.length - 1]!);
    let maxOffset = items.length - 1;
    for (let i = items.length - 2; i >= 0; i--) {
      const r = rowsOf(items[i]!);
      if (tailRows + r > rowBudget) break; // 再纳前条超预算——上界定
      tailRows += r;
      maxOffset = i;
    }
    let start = Math.min(Math.max(0, this.selectOffset), maxOffset);
    // 头向夹取：光标在窗首前——光标条目即新窗首
    if (phase.cursor < start) start = phase.cursor;
    // 尾向夹取：光标条目（含 desc）须完整入窗——从 start 累行预算，装不下则
    // 窗首步进重试（最小滚动防跳变），直至光标完整入窗或窗首追上光标（退化
    // 形：单条目行高超预算——窗首即光标，label 行独呈）
    while (start < phase.cursor) {
      let used = 0;
      let cursorInView = false;
      for (let i = start; i < items.length; i++) {
        const r = rowsOf(items[i]!);
        if (used + r > rowBudget) break; // 预算尽——条目 i 不完整入窗
        used += r;
        if (i === phase.cursor) {
          cursorInView = true;
          break;
        }
      }
      if (cursorInView) break;
      start++;
    }
    this.selectOffset = start;
    return start;
  }

  /** 光标移动（越界夹取不循环；移动后重画——select/multiselect 共用） */
  private moveCursor(
    phase: Extract<Phase, { kind: 'select' }> | Extract<Phase, { kind: 'multiselect' }>,
    delta: number,
  ): void {
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
