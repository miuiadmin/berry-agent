/**
 * 终端外显件（07 §4.1 呈现面件 7——OSC 标题 + OSC 9;4 进度态）。
 *
 * 语义平移 pi-tui Terminal setTitle/setProgress（自研改裁——字节形锚定
 * 参考源码/pi-monorepo/packages/tui/src/terminal.ts：title = OSC 0;… BEL、
 * 忙态 = `\x1b]9;4;3\x07`、清零 = `\x1b]9;4;0\x07`、keepalive 1s）。
 * - **OSC 写出分治**（07 §4.1 件 7 条款）：title 值缓存去重（同值不重写
 *   字节）；progress 态**保活周期重发**——OSC 9;4 在部分终端超时衰减，去重
 *   不适用于 progress 序列、须周期重写维持；
 * - **OSC 52 选区复制序列构造**（2026-09-11 鼠标解码批——件 8 选区复制）：
 *   buildOsc52Copy 纯函数（无状态无缓存——写出与否归装配层注入柄）；
 * - **桌面通知第三写点**（挖掘 36 轮 notify-osc9——件 7）：载波探测
 *   detectNotifyCarrier 纯函数（TMUX 在场 bel 诚实降级 / TERM_PROGRAM 五家
 *   osc9）+ buildOsc9Notify / sanitizeNotifyText 两纯函数 + notify() 写点
 *   （定值缺席 = 通道关闭恒零写；写失败即闩死——后续零写）；
 * - **待处置注意态 title 外显**（件 C——挖掘 46 轮）：setAttention 开/收
 *   1s 交替拍（`[ ! ] 待处置 <常态title>` / `[ . ] …` 同宽防抖——常态值账
 *   与帧值分立防污染）——判据归 TuiBackend（应答车在场或模态浮层在场），
 *   本件只承拍显、归位与停针自持（注意拍与保活拍两针分立）；
 * - 进度态判据（按 sessionId 归账的 agent_start/end 净计数、任一会话 > 0
 *   即忙）在 TuiBackend 侧——本件只承「忙/闲」两态写出与保活自持；
 * - 退出复原两写点：title 复原基线 + 进度清零（restore——TuiBackend 的
 *   stop 与硬退复原钩子两消费点）。
 *
 * 可测性：写出走注入 TerminalIO 形参（勿直写 process）；保活 timer 走
 * schedule 注入（TuiBackend armTick 同形），停针暴露名册语义（句柄非空才
 * 取消、停后清位——cancelTimer 同律）。schedule 缺席 = 保活缺位（忙态首写
 * 仍在——同步测试语义，与 TuiBackend「无注入调度 = 同步直出」同构）。
 */
import type { TerminalIO } from '../../engine/index.js';

/** 保活重发周期（ms——pi-tui TERMINAL_PROGRESS_KEEPALIVE_MS 实证值） */
export const OSC_PROGRESS_KEEPALIVE_MS = 1000;

/**
 * 注意态交替拍周期（ms——件 C 挖掘 46 轮）：与保活同拍 1s（OSC 外显族
 * 帧节奏单源经验值——终端标签页注意力外显的感知粒度）。
 */
export const OSC_ATTENTION_BLINK_MS = 1000;

/** OSC 9;4 忙态序列（indeterminate progress——state 3） */
const PROGRESS_ACTIVE_SEQUENCE = '\x1b]9;4;3\x07';
/** OSC 9;4 清零序列（state 0） */
const PROGRESS_CLEAR_SEQUENCE = '\x1b]9;4;0\x07';

/**
 * DECSCUSR 光标形序列（模态编辑批——39 池 P4·L，07 §4.1 R5 mode 域捆绑注记）：
 * 形 5 = SteadyBar（insert 态）、形 2 = SteadyBlock（normal 态）、形 0 =
 * 复位终端缺省形（模态关闭/退出复原）。写点归本件 setCursorShape（值去重），
 * 态判据归 TuiBackend（模态层三态投影）。
 */
const CURSOR_STEADY_BAR_SEQUENCE = '\x1b[5 q';
const CURSOR_STEADY_BLOCK_SEQUENCE = '\x1b[2 q';
const CURSOR_RESET_SEQUENCE = '\x1b[0 q';

/** 注意态帧词（件 C——待处置问句在场的外显词面） */
const ATTENTION_WORD = '待处置';
/** 注意态显形拍标记 */
const ATTENTION_MARK_ON = '[ ! ]';
/** 注意态隐形拍标记（'.' 占位与显形拍同宽——交替不抖动） */
const ATTENTION_MARK_OFF = '[ . ]';

/**
 * OSC 52 选区复制序列（07 §4.1 呈现面件 8 细则——BEL 终界）：
 * `\x1b]52;c;<base64>\x07`，`c` = 系统剪贴板主位。终端支持不可探测（无标准
 * 应答——kitty/Alacritty/wezterm/foot 支持、iTerm2 默认禁需用户开、tmux 需
 * set-clipboard on、xterm 兼容族受 allowWindowOps 门控）——尽力写出无反馈，
 * 不构成故障面。写出柄归装配层注入（onCopy），本函数只铸字节。
 */
export function buildOsc52Copy(text: string): string {
  return `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`;
}

/**
 * OSC 52 复制 tmux DCS 透传形（挖掘 38 轮件 A——tmux 三层分诊的第三层）：
 * `\x1bPtmux;` 前缀 + 裸 OSC 52 载荷（内层 ESC 双写——防载荷内 ESC 提前
 * 终结 DCS）+ `\x1b\\` 收尾。buildOsc9Notify DCS 包裹判例同构（codex
 * dcs_passthrough 同律）——直穿 tmux 至外层终端，外层支持 OSC 52 即成
 * （尽力写出无反馈——件 8 细则语义维持）。
 */
export function buildOsc52CopyDcs(text: string): string {
  const payload = buildOsc52Copy(text);
  return `\x1bPtmux;${payload.replace(/\x1b/g, '\x1b\x1b')}\x1b\\`;
}

/**
 * 桌面通知载波两形（挖掘 36 轮 notify-osc9）：osc9 = OSC 9 真桌面通知、
 * bel = BEL 响铃降级。探测与写点分治——探测归 detectNotifyCarrier 纯函数、
 * 写出归 OscDisplay.notify（本件），装配层定值注入。
 */
export type NotifyCarrier = 'osc9' | 'bel';

/** OSC 9 通知的支持终端名册（TERM_PROGRAM 五家——codex supports_osc9 同参） */
const OSC9_TERM_PROGRAMS: readonly string[] = ['ghostty', 'iTerm.app', 'kitty', 'wezterm', 'WarpTerminal'];

/**
 * 通知载波探测（纯函数，detectColorDepth 同例）：TMUX 在场 → bel 优先
 * （tmux 下外层终端不可探测——诚实降级，不猜）；TERM_PROGRAM 五家 →
 * osc9；其余/缺席 → bel。
 */
export function detectNotifyCarrier(env: { readonly TERM_PROGRAM?: string; readonly TMUX?: string }): NotifyCarrier {
  // TMUX 判定优先：外层真终端是谁不可知，五家猜测在 tmux 下不作数
  if (env.TMUX !== undefined) return 'bel';
  return OSC9_TERM_PROGRAMS.includes(env.TERM_PROGRAM ?? '') ? 'osc9' : 'bel';
}

/**
 * OSC 9 通知字节（纯函数，buildOsc52Copy 同例）：
 * - 裸形：`\x1b]9;<消息>\x07`（codex PostNotification 同形）；
 * - tmux=true（明示 osc9 强开且 TMUX 在场的 DCS 透传形）：`\x1bPtmux;` 前缀
 *   + 载荷内 ESC 双写 + `\x1b\` 收尾——codex dcs_passthrough 同律。
 */
export function buildOsc9Notify(text: string, opts: { readonly tmux: boolean }): string {
  const payload = `\x1b]9;${text}\x07`;
  if (!opts.tmux) return payload;
  // DCS 透传包裹：载荷内每个 ESC 双写（tmux 规范——防载荷内 ESC 提前终结 DCS）
  return `\x1bPtmux;${payload.replace(/\x1b/g, '\x1b\x1b')}\x1b\\`;
}

/**
 * 通知文案消毒（纯函数）：取首行 → 剥行内 C0 控制符与 ESC → 折叠空白
 * （连续空白并一、首尾去——codex agent_turn_preview 同律）→ 码点帽（超帽
 * 截 max-1 码点尾加「…」，总长恰 max）。桌面通知面只承干净单行——消息原文
 * 可能含转义序列/多行/超长，消毒后方可入 OSC 9 载荷。
 */
export function sanitizeNotifyText(text: string, maxCodePoints: number): string {
  // 首行先行（多行只取第一行——后续行整段丢弃，非并入；空串输入 split 亦出 ['']）
  const firstLine = text.split('\n')[0] ?? '';
  // 行内 C0（0x00-0x1F，含 ESC）与 DEL（0x7F）全剥成空格，再折叠空白归一
  const folded = firstLine
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .split(/\s+/)
    .join(' ')
    .trim();
  // 码点帽（展开按码点截——多字节字符不劈半）
  const cps = [...folded];
  if (cps.length <= maxCodePoints) return folded;
  return cps.slice(0, maxCodePoints - 1).join('') + '…';
}

/**
 * title 折叠空白集（件 C 挖掘 51 轮——Unicode White_Space 精确集，codex
 * is_whitespace 判定集同参）：**JS `\s` 简写不可代**——多含 U+FEFF（codex
 * 直删非折叠）、少含 U+0085 NEL（codex 折叠）。
 */
const TITLE_WHITESPACE_RE = /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

/**
 * title 禁字符集（codex is_disallowed 判定集同参）：C0/C1 控制 + DEL + 软
 * 连字符 + 双向/零宽/包裹禁用族 + 变体选择符 + BOM + interlinear 注记 +
 * 标签禁用区。SMP 段**必须 `\u{…}` 花括号形 + u 旗**——`\uXXXX` 4 位截断
 * 会酿巨区间字符类（冷读 C-1 实证：`ᯊ0` 解析为 U+1BCA + 字面 '0'）。
 */
const TITLE_DISALLOWED_RE =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff\ufff9-\ufffb\u{1bca0}-\u{1bca3}\u{e0100}-\u{e01ef}]/gu;

/**
 * title 消毒（纯函数，sanitizeNotifyText 同族——件 C 挖掘 51 轮，codex
 * sanitize_title 同律）：三步序——①White_Space 精确集折叠单空格 + trim
 * （**折叠先行**：TAB/LF/NEL 折叠非直删——先剥后折会把 TAB 直删酿词粘连）；
 * ②禁字符直剥（OSC 0 载荷注入面——控制/零宽族不可入终端标题）；③码点帽
 * 240 硬截**无省略号**（终端标签页窄面近似截断可接受——sanitizeNotifyText
 * 的「…」尾形是通知面语义，title 面纯截）。空串入空串出（空 title 是合法
 * 诚实态，不注入占位词）。帽为近似值（codex MAX_TITLE_LEN 同值——按码点
 * 非显示宽，宽字符可超终端显示宽，溢出由终端自裁）。
 */
export function sanitizeTitle(title: string, maxCodePoints = 240): string {
  const folded = title.replace(TITLE_WHITESPACE_RE, ' ').trim();
  const stripped = folded.replace(TITLE_DISALLOWED_RE, '');
  const cps = [...stripped];
  return cps.length <= maxCodePoints ? stripped : cps.slice(0, maxCodePoints).join('');
}

/** 调度注入形（与 TuiBackend schedule 注入同形——(fn, ms) → 句柄） */
export type OscSchedule = (fn: () => void, ms: number) => unknown;

/** 终端外显件构造选项 */
export interface OscDisplayOptions {
  /** title 复原基线（退出复原落点——起屏基线形如 `berry-agent <版本>`） */
  readonly baseline: string;
  /** 调度注入（保活周期重发 + 注意拍交替；缺席 = 保活缺位——忙态首写不受影响） */
  readonly schedule?: OscSchedule;
  /** 取消调度注入（与 schedule 配对——停针名册语义的取消出口） */
  readonly cancel?: (handle: unknown) => void;
  /**
   * 动效门（件 C——挖掘 46 轮）：false = 注意拍不摆（显形帧静态常驻——
   * TuiBackend animationsEnabled 同源注入，taskLine 转轮动效门同例）；
   * 缺省 true。保活针不受此门辖（progress 序列是超时衰减维持面非动效）。
   */
  readonly animations?: boolean;
  /**
   * 桌面通知定值（挖掘 36 轮 notify-osc9）——缺席 = 通知通道整体关闭
   * （notify() 恒零写零字节——缺席注入律，旧测试/旧装配零扰动）。
   * carrier/tmux 由装配层 detectNotifyCarrier 定值注入（探测与写点分治）。
   */
  readonly notify?: {
    readonly carrier: NotifyCarrier;
    /** 载波 osc9 且 TMUX 在场 → DCS 包裹（明示 osc9 强开形才可能出现；auto 形 tmux 已降级 bel） */
    readonly tmux: boolean;
  };
}

/**
 * 终端外显件：OSC title + 进度态两写点的最小自持件。
 * 忙态期间保活自重排（触发即清位再续针——armTick 同形）；restore/停针后
 * 句柄位归 null，重复停针是 no-op。
 */
export class OscDisplay {
  /** title 值缓存（null = 未写过——同值不重写判据位） */
  private lastTitle: string | null = null;
  /** 常态 title 值账（最后一次 setTitle 值——收注意态归位写数据源；null = 从未写常态值） */
  private normalTitle: string | null = null;
  /** 注意态位（true = 待处置外显在身——帧写出经私法绕开常态值记账） */
  private attentionOn = false;
  /** 注意态拍相位（true = 显形拍；开态首帧恒显形） */
  private attentionPhase = true;
  /** 注意拍在飞句柄（null = 无在飞——名册语义判据位；与保活针分立互不牵连） */
  private blinkHandle: unknown = null;
  /** 保活在飞句柄（null = 无在飞——名册语义判据位） */
  private keepaliveHandle: unknown = null;
  /** 光标形值缓存（null = 从未写——同形不重写字节判据位；模态编辑批） */
  private lastCursorShape: 'block' | 'bar' | 'default' | null = null;

  private readonly io: TerminalIO;
  private readonly baseline: string;
  private readonly schedule: OscSchedule | null;
  private readonly cancel: (handle: unknown) => void;
  /** 动效门（false = 注意拍不摆——显形帧静态常驻；缺省 true） */
  private readonly animations: boolean;
  /** 桌面通知定值（null = 通道关闭——notify 恒零写；构造期定值不再变） */
  private readonly notifyConf: { readonly carrier: NotifyCarrier; readonly tmux: boolean } | null;
  /** 通知写失败闩（true = 已闩死——io.write 抛错后后续 notify 零写，teardown EPIPE 不炸） */
  private notifyDisabled = false;

  constructor(io: TerminalIO, options: OscDisplayOptions) {
    this.io = io;
    this.baseline = options.baseline;
    this.schedule = options.schedule ?? null;
    // 取消缺省兜底 setTimeout 句柄族（与 TuiBackend cancelFn 缺省同形）
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    this.animations = options.animations ?? true;
    this.notifyConf = options.notify ?? null;
  }

  /** 在飞保活句柄现值（null = 无在飞——名册摘除/测试断言位） */
  get activeKeepalive(): unknown {
    return this.keepaliveHandle;
  }

  /** 标题写出（OSC 0;… BEL——值缓存去重：同值不重写字节；常态值随写记账〔注意帧经私法绕开记账〕） */
  setTitle(title: string): void {
    this.writeTitleDedup(title);
    this.normalTitle = title;
  }

  /** 去重写出私法（注意态帧共用去重律——帧值非常态值，不记常态值账防污染；入口单点消毒〔件 C 挖掘 51 轮〕：setTitle 公法与注意帧私法两路同律，lastTitle 记消毒值、normalTitle 记原始值〔归位重写再消毒幂等〕） */
  private writeTitleDedup(title: string): void {
    const safe = sanitizeTitle(title);
    if (safe === this.lastTitle) return; // 去重律——同值零字节
    this.lastTitle = safe;
    this.io.write(`\x1b]0;${safe}\x07`);
  }

  /**
   * 待处置外显（件 C——挖掘 46 轮）：true = 注意态——title 以 1s 交替拍外显
   * `[ ! ] 待处置 <常态title>` / `[ . ] 待处置 <常态title>`（隐形拍 '.' 占位
   * 同宽防抖）；false = 收态——停拍 + 常态 title 强制重写归位（lastTitle 清空
   * 绕过去重；常态值 null 则跳过归位写）。同态重复调用零字节零重排。
   * blink 门 = schedule 在场 && animations 开（任一缺席 = 显形帧静态常驻
   * ——taskLine 转轮动效门同例）；注意拍与保活拍两针分立互不牵连。
   */
  setAttention(active: boolean): void {
    if (active === this.attentionOn) return; // 同态零扰动
    this.attentionOn = active;
    if (active) {
      this.attentionPhase = true; // 开态首帧恒显形
      this.writeAttentionFrame();
      this.armBlink();
    } else {
      this.stopBlink();
      this.lastTitle = null; // 强制归位（lastTitle 是注意帧值——绕过去重律）
      if (this.normalTitle !== null) this.setTitle(this.normalTitle);
    }
  }

  /** 注意帧 title 铸 + 去重写出（经私法——不记常态值账） */
  private writeAttentionFrame(): void {
    const mark = this.attentionPhase ? ATTENTION_MARK_ON : ATTENTION_MARK_OFF;
    this.writeTitleDedup(
      this.normalTitle === null ? `${mark} ${ATTENTION_WORD}` : `${mark} ${ATTENTION_WORD} ${this.normalTitle}`,
    );
  }

  /** 起注意拍（门：schedule 在场 && animations 开；触发即翻相清位自重排续拍——单链不叠针） */
  private armBlink(): void {
    if (this.schedule === null || !this.animations || this.blinkHandle !== null) return;
    this.blinkHandle = this.schedule(() => {
      this.blinkHandle = null;
      this.attentionPhase = !this.attentionPhase;
      this.writeAttentionFrame();
      this.armBlink();
    }, OSC_ATTENTION_BLINK_MS);
  }

  /** 停注意拍（名册语义：句柄非空才取消、停后清位——与 stopKeepalive 分立） */
  private stopBlink(): void {
    if (this.blinkHandle === null) return;
    this.cancel(this.blinkHandle);
    this.blinkHandle = null;
  }

  /**
   * 进度态写出（OSC 9;4）：
   * - true = 写忙态序列 + 起 1s 保活周期重发（已在飞不重复起针——重发维持
   *   单链不叠针）；同值重复调用仍重写忙态序列（去重不适用于 progress）；
   * - false = 写清零序列 + 停保活 timer。
   */
  setProgress(active: boolean): void {
    if (active) {
      this.io.write(PROGRESS_ACTIVE_SEQUENCE);
      this.armKeepalive();
    } else {
      this.stopKeepalive();
      this.io.write(PROGRESS_CLEAR_SEQUENCE);
    }
  }

  /**
   * 光标形写出（DECSCUSR——模态编辑批，39 池 P4·L）：bar = SteadyBar
   * （insert 态）/ block = SteadyBlock（normal 态）/ default = 复位终端
   * 缺省形（模态关闭）。值缓存去重（title 同律——同形不重写字节）。
   */
  setCursorShape(shape: 'block' | 'bar' | 'default'): void {
    if (shape === this.lastCursorShape) return; // 去重律——同形零字节
    this.lastCursorShape = shape;
    this.io.write(
      shape === 'bar'
        ? CURSOR_STEADY_BAR_SEQUENCE
        : shape === 'block'
          ? CURSOR_STEADY_BLOCK_SEQUENCE
          : CURSOR_RESET_SEQUENCE,
    );
  }

  /**
   * 退出复原两写点齐（07 §4.1 件 7 条款）：title 复原基线（经值缓存——
   * 已在基线则零字节）+ 进度清零（无条件写——终态收口，含停保活）。
   * 注意态同收（件 C——复原后 setTitle 记账恢复常态语义；注意拍停针）。
   * 光标形同收（模态编辑批——写过非缺省形则复位缺省，未写过零字节）。
   */
  restore(): void {
    this.attentionOn = false;
    this.stopKeepalive();
    this.stopBlink();
    this.setTitle(this.baseline);
    this.io.write(PROGRESS_CLEAR_SEQUENCE);
    if (this.lastCursorShape !== null && this.lastCursorShape !== 'default') {
      this.setCursorShape('default');
    }
  }

  /** 停保活定时器（名册语义：句柄非空才取消、停后清位——重复停针 no-op） */
  stopKeepalive(): void {
    if (this.keepaliveHandle === null) return;
    this.cancel(this.keepaliveHandle);
    this.keepaliveHandle = null;
  }

  /**
   * 桌面通知写点（title/setProgress 同位第三写点——挖掘 36 轮 notify-osc9）：
   * osc9 → buildOsc9Notify（tmux 定值经 DCS 包裹）；bel → `\x07`。
   * 构造期 notify 定值缺席则恒零写（通道关）；io.write 抛错（EPIPE 等）即
   * 闩死——后续 notify 零写（codex 失败禁用律同参——teardown 期写出失败
   * 不上抛不重试）。文案消毒归调用方（enqueueNotice 前置），本方法只铸字节。
   */
  notify(text: string): void {
    if (this.notifyConf === null || this.notifyDisabled) return;
    try {
      this.io.write(
        this.notifyConf.carrier === 'osc9' ? buildOsc9Notify(text, { tmux: this.notifyConf.tmux }) : '\x07',
      );
    } catch {
      // 写失败即闩死（后续零写）——吞不上抛：通知是尽力面非故障面
      this.notifyDisabled = true;
    }
  }

  /** 起保活（schedule 缺席 = 缺位；触发后清位自重排续针——周期重发维持） */
  private armKeepalive(): void {
    if (this.schedule === null || this.keepaliveHandle !== null) return;
    this.keepaliveHandle = this.schedule(() => {
      this.keepaliveHandle = null;
      this.io.write(PROGRESS_ACTIVE_SEQUENCE); // 周期重发（超时衰减型终端维持）
      this.armKeepalive();
    }, OSC_PROGRESS_KEEPALIVE_MS);
  }
}
