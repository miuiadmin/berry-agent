/**
 * 自研 TUI 引擎契约件（07 篇 §4.1 自研引擎节件 1——批 10b 引擎核心）。
 *
 * 引擎与真 TTY 全解耦的接缝根基：TerminalIO 是注入面（按引擎生命周期需要
 * 设计接口面，非照抄进程 API）、MemoryTerminalIO 内存实现是引擎公开测试面
 * （结构性义务非可选件——「mock 只停在模型层」纪律的接缝根基）。
 *
 * 本文件只立契约（类型 + 协议），零实现、零外部依赖；实现可替换性由接口
 * 面承载（CellBuffer 协议下实装在 cell 件、TerminalIO 下真终端适配在批 10c）。
 */

/** 16 色 ANSI 色号（0-15；色域 = 16 色 + 属性位，真彩 / 256 色挂账不预造） */
export type AnsiColor = number & { readonly __brand: 'ansi-16-color' };

/** 16 色色号构造（brand 收口：色号只能经此进入引擎面） */
export function ansiColor(n: number): AnsiColor {
  if (!Number.isInteger(n) || n < 0 || n > 15) {
    throw new Error(`ansiColor: 色号须为 0-15 整数，收到 ${n}`);
  }
  return n as AnsiColor;
}

/** 单格样式（属性位族——缺省位一律 false / undefined） */
export interface CellStyle {
  /** 前景 16 色索引（undefined = 终端缺省前景） */
  readonly fg?: AnsiColor;
  /** 背景 16 色索引（undefined = 终端缺省背景） */
  readonly bg?: AnsiColor;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly dim?: boolean;
  readonly inverse?: boolean;
}

/**
 * 网格单格三元：码点面 + 样式 + 列宽（07 引擎节件 3 cell 网格模型）。
 *
 * - grapheme 存**完整字素串**（单码点字素即该码点）——多码点字素（ZWJ 家族 /
 *   旗帜 / 变体选择子）整串入格，同首码点不同字素因串不同在差分按格直比中
 *   自然判不等（字素面参与差分自证——结构自证、无旁路账本）。
 * - width 三值：2 = 宽字素首格、0 = 宽字素续格（grapheme 为空串占位——与主流
 *   终端续格形同构，差分按格直比无需行结构感知）、1 = 常规字素。
 */
export interface Cell {
  readonly grapheme: string;
  readonly style: CellStyle;
  readonly width: 0 | 1 | 2;
}

/** 本帧光标声明（帧尾统一落位——显隐态跨帧去重归 diff 件） */
export interface CursorState {
  readonly row: number;
  readonly col: number;
  readonly visible: boolean;
}

/**
 * 终端 IO 注入面（七动词：写出 / 几何 / raw 模式 / 流暂停复起 / 输入订阅 /
 * resize 订阅 / raw 真值查询）。
 *
 * 真终端适配（ProcessTerminalIO）与内存实现（MemoryTerminalIO）同面
 * 接入；引擎六件只认本接口、永不直触 process.stdout / stdin。isRaw 供
 * 挂起交出面复原先验态（start 前记录、suspend/dispose 还原）。
 */
export interface TerminalIO {
  /** 写出 ANSI 字节（同步写出——帧缓冲的最终出口） */
  write(data: string): void;
  /** 当前几何（列 / 行——resize 后以真值为准，不缓存） */
  size(): { columns: number; rows: number };
  /** raw 模式开关（真终端适配负责复原先验态；内存实现纯记账） */
  setRawMode(enable: boolean): void;
  /** 当前 raw 真值（挂起交出面复原先验态的记录依据） */
  isRaw(): boolean;
  /** 流暂停 / 复起（挂起交出面用——为 $EDITOR 类子交互进程预留） */
  pause(): void;
  resume(): void;
  /** 订阅输入字节流（解码件消费——回调返回退订函数） */
  onInput(listener: (data: string) => void): () => void;
  /** 订阅几何变更（引擎侧弃旧换新重绘） */
  onResize(listener: () => void): () => void;
}

/** 键盘协议轨（DA1 哨兵探测落定：kitty 应答先到 = kitty 轨 / 否则 legacy） */
export type KeyboardProtocol = 'kitty' | 'legacy';

/** 组件落位区域（行 / 列 / 宽 / 高——屏幕坐标系） */
export interface Region {
  readonly row: number;
  readonly col: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 组件两段协商协议（07 引擎节件 1）：
 * 量高（给定宽度报期望行数）与落位（只写自己区域内）走同一分配单源、
 * 两段永不漂移（无约束求解器——量高即分配的承诺，落位不得超卖）。
 * 越界写由缓冲吸收（CellBuffer 静默丢弃界外格——组件可信任缓冲兜底）。
 */
export interface Renderable {
  /** 量高：给定可用宽度，报本组件期望行数 */
  measure(width: number): number;
  /** 落位：只写自己区域内（region 由装配层依量高结果划定） */
  render(buffer: CellBuffer, region: Region): void;
}

/**
 * cell 网格写入契约（实现可替换；含本帧光标声明写入面）。
 *
 * 光标三问（07 引擎节件 1 审读补条款）：由谁声明 = 交互件 render 内声明本帧
 * 可见光标位置；竞声明裁决 = setCursor / clearCursor 同帧多组件竞声明以
 * **末次为准**；显隐去重 = 帧尾统一落位（定位 + 显 / 隐），同态跨帧零冗余
 * 序列（去重执法在 diff 件，buffer 只存本帧声明终值）。
 *
 * 帧路径零分配：缓冲跨帧复用、clear 只摘格不重分配，resize 是唯一重分配点。
 */
export interface CellBuffer {
  readonly columns: number;
  readonly rows: number;
  /** 摘格清屏（网格结构复用——帧间清屏用，零分配） */
  clear(): void;
  /** 读单格（界外 / 未写格返回 null = 缺省空格） */
  getCell(row: number, col: number): Cell | null;
  /**
   * 写单字素格（宽字素自动铺续格；覆写区既有宽字素整字摘痕防新旧混叠；
   * 越界写静默吸收——渲染契约「越界写由缓冲吸收」的执法位）。
   */
  setCell(row: number, col: number, grapheme: string, style?: CellStyle): void;
  /**
   * 写文本（字素级写入 + 列位推进；返回推进后列位——宽字素占双列）。
   * 空串 / 零宽情形下返回原列位（推进为零）。
   */
  writeText(row: number, col: number, text: string, style?: CellStyle): number;
  /** 本帧光标声明（显式落位） */
  setCursor(row: number, col: number): void;
  /** 本帧光标清除声明（本帧无可见光标） */
  clearCursor(): void;
  /** 本帧光标声明终值（无声明 = null） */
  readonly cursor: CursorState | null;
  /** 几何变更（唯一重分配点；内容弃置——resize 弃旧换新，编排侧重绘兜底） */
  resize(columns: number, rows: number): void;
}

/**
 * 输入事件模型五分（07 引擎节件 1——2026-09-11 鼠标解码批四分扩五分）：
 * key / text / ime / paste / mouse。
 *
 * 事件由输入解码件（批 10c；mouse 增补随鼠标解码批 mu-2）产出——本件只立
 * 模型面。key 事件带 press / repeat / release 三型（kitty 轨可达；legacy 轨
 * 无事件型区分、恒 press）；text 事件粒度 = 同 chunk 内连续可打印游程合并
 * 单事件（打字 / 中文提交不撕裂——逐字符派发会每事件触发渲染请求）。
 * mouse 事件带 press/motion/release 三型 + 按钮语义位 + 修饰键还原 +
 * 0 基屏幕坐标（SGR 报文 1 基的换算归解码件，模型面单源 0 基）。
 */

/** 键相（press 首按 / repeat 连按 / release 释放——kitty 轨专属区分） */
export type KeyPhase = 'press' | 'repeat' | 'release';

/** key 事件：逻辑键名（'enter' / 'escape' / 'up' … 词汇表由解码件定）+ 修饰键还原 */
export interface KeyEvent {
  readonly kind: 'key';
  readonly key: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly phase: KeyPhase;
}

/** text 事件：可打印文本游程（同 chunk 连续合并；跨 chunk 不滞留） */
export interface TextInputEvent {
  readonly kind: 'text';
  readonly text: string;
}

/**
 * ime 事件：组字一等公民模型面。committed = false 预编辑增量（不落正文）、
 * committed = true 提交（才落正文）；识别判据（前缀增长检测）与首达零延迟
 * 是解码件行为条款，模型面不涉。
 */
export interface ImeEvent {
  readonly kind: 'ime';
  readonly text: string;
  readonly committed: boolean;
}

/** paste 事件：bracketed paste 整段交付（终界跨 chunk 悬置等待在解码件） */
export interface PasteEvent {
  readonly kind: 'paste';
  readonly text: string;
}

/** mouse 事件相（press 按下 / motion 按住拖动 / release 释放——SGR 报文 M/m 终点区分） */
export type MousePhase = 'press' | 'motion' | 'release';

/** mouse 按钮语义位（07 引擎节件 4 v1 收窄五钮——其余按钮线值整序吞不产事件） */
export type MouseButton = 'left' | 'middle' | 'right' | 'wheel-up' | 'wheel-down';

/**
 * mouse 事件：SGR 1006 解码产物（07 引擎节件 4 鼠标解码批条款）。
 *
 * - 坐标 0 基（col 列 / row 行——SGR 报文 1 基的换算归解码件）；
 * - 修饰键还原（SGR 位域 4=shift / 8=alt / 16=ctrl——线值 8-11 的 alt 系
 *   组合在此拆解、绝不入吞清单；SGR 无 meta 位，meta 恒 false）；
 * - motion = 按住拖动（DECSET 1002 button-event tracking——无键 motion 不
 *   报）；wheel 无 release（终端不报，滚轮以 press 一相到达）。
 */
export interface MouseEvent {
  readonly kind: 'mouse';
  readonly phase: MousePhase;
  readonly button: MouseButton;
  readonly col: number;
  readonly row: number;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}

/** 输入事件五分判别联合（mouse 系 2026-09-11 鼠标解码批增补） */
export type InputEvent = KeyEvent | TextInputEvent | ImeEvent | PasteEvent | MouseEvent;
