/**
 * /diff 会话改动总览副屏件（07 §4.1 命令面增补批——TUI 本地拦截族）。
 *
 * - **数据源 = 会话事件投影聚合**（foldSessionDiff 纯函数——投影 assistant
 *   消息 toolCalls 中 edit 类调用的 patch 参数按文件分组）：组头文件名 +
 *   +N/-M 行计数（同文件多次 edit **累计**）、组体 patch 行**事件时间序全量
 *   呈现**、词级 intra-line diff 高亮**复用 R4 单源**（word-diff 件
 *   diffWords/parsePatchLines——实件单源，本件只做呈现）；**组序 = 文件路径
 *   字典序**；孤儿 toolCall（无 result）分组标 ⧗〔在飞〕**同键混排不另立分区**；
 * - **零 git 子进程**：「会话改了什么」（事件真源）与「工作树现在什么样」
 *   （git 真源）两问分立——v1 答前者，投影快照档（开屏一次现取）；
 * - **enter = 展开 / 收起光标组**（缺省全收起——总览语义）；空集（会话零
 *   edit）= 诚实空态行；
 * - 键面同副屏件族律（q / esc 返回、Ctrl+C 打断、Ctrl+D 先收屏再退）。
 */
import type { CellBuffer, CellStyle, ColorValue, InputEvent, Region } from '../../engine/index.js';
import { stringWidth, truncateToWidth } from '../../engine/index.js';
import type { ResolvedTheme } from '../theme/index.js';
import { diffWords, parsePatchLines, type DiffSeg, type PatchLine } from '../blocks/word-diff.js';
import type { OverlayContent } from '../overlay/overlay.js';

/**
 * 投影工具调用最小面（foldSessionDiff 消费子集）：arguments = **原始未解析
 * JSON 串**（tool/call 事件审计保真形——'patch' 键经 JSON.parse 现析，坏串
 * 呈现面跳过不炸）。
 */
export interface DiffProjectionToolCall {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: string;
}

/**
 * 投影消息最小面（/diff 聚合消费——05 §3.1 ProjectedMessage 的结构子集）：
 * channels 不依 session 型（DAG 边表零新边），装配位直投 session.projection()
 * 产物零折算（结构兼容——多余字段透明）。
 */
export interface DiffProjectionMessage {
  readonly type: string;
  /** assistant 形在场：同一响应内发起的工具调用（toolCall 块不内联 content——tool/call 事件唯一承载） */
  readonly toolCalls?: readonly DiffProjectionToolCall[];
  /** toolResult 形在场：配对键 */
  readonly toolCallId?: string;
}

/** 文件分组（foldSessionDiff 产物——组体行按事件时间序累计） */
export interface DiffFileGroup {
  /** 文件路径（apply_patch 文件段指令原文——字典序键） */
  readonly path: string;
  /** 增行计数（多次 edit 累计——'+' 体系行） */
  readonly added: number;
  /** 删行计数（多次 edit 累计——'-' 体系行） */
  readonly removed: number;
  /** 孤儿位（贡献本组的 edit toolCall 存在无 result 在飞形——⧗ 标记） */
  readonly orphan: boolean;
  /** 组体 patch 行（ctx/del/add 分类形——meta 段指令不入组体，组头已呈路径） */
  readonly lines: readonly PatchLine[];
}

/** 文件段指令前缀三形（apply_patch 文法——tools 件真源，此处显示层判形） */
const FILE_DIRECTIVES = ['*** Update File:', '*** Add File:', '*** Delete File:'] as const;

/**
 * 投影消息 → 文件分组（纯函数——装配/测试双消费）：assistant 消息 toolCalls
 * 中 edit 调用（`toolName === 'edit'` 且 arguments JSON 串解析出 string
 * `patch`——transcript 工具卡判形同源、arguments 载体异形〔投影 = 审计原始
 * 串〕）逐个累积；toolResult 按 toolCallId 配对，无配对 = 孤儿（⧗ 在飞）。
 * 组序 = 路径字典序。
 */
export function foldSessionDiff(messages: readonly DiffProjectionMessage[]): readonly DiffFileGroup[] {
  // 配对面先行：有 result 的 toolCallId 全集（孤儿判据）
  const answered = new Set<string>();
  for (const message of messages) {
    if (message.type === 'toolResult' && message.toolCallId !== undefined) answered.add(message.toolCallId);
  }
  const groups = new Map<
    string,
    { path: string; added: number; removed: number; orphan: boolean; lines: PatchLine[] }
  >();
  for (const message of messages) {
    if (message.type !== 'assistant') continue; // 用户/工具结果消息不产分组
    for (const call of message.toolCalls ?? []) {
      if (call.toolName !== 'edit') continue;
      // arguments = 原始未解析 JSON 串（审计保真形）——现析取 patch；坏串/
      // 非 string patch = 跳过（呈现面不炸，transcript 判形同义）
      let parsed: unknown;
      try {
        parsed = JSON.parse(call.arguments);
      } catch {
        continue;
      }
      if (typeof parsed !== 'object' || parsed === null) continue;
      const patch = (parsed as Record<string, unknown>).patch;
      if (typeof patch !== 'string') continue;
      const orphan = !answered.has(call.toolCallId);
      let current: { added: number; removed: number; orphan: boolean; lines: PatchLine[] } | null = null;
      for (const line of parsePatchLines(patch)) {
        if (line.kind === 'meta') {
          // 文件段指令 → 切组（字典序键 = 指令路径原文）；Begin/End 等其余 meta 不产组
          const directive = FILE_DIRECTIVES.find((prefix) => line.text.startsWith(prefix));
          if (directive === undefined) {
            current = null; // 段外 meta（Begin/End）——后续体系行无组可归
            continue;
          }
          const path = line.text.slice(directive.length).trim();
          let group = groups.get(path);
          if (group === undefined) {
            group = { path, added: 0, removed: 0, orphan: false, lines: [] };
            groups.set(path, group);
          }
          group.orphan = group.orphan || orphan; // 孤儿位按贡献 OR 累积（同键混排）
          current = group;
          continue;
        }
        if (current === null) continue; // 段首指令前的体系行（畸形防御）——不归组
        current.lines.push(line);
        if (line.kind === 'add') current.added += 1;
        else if (line.kind === 'del') current.removed += 1;
      }
    }
  }
  return [...groups.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** 组体呈现行（词级对行展开后——del/add 行带 DiffSeg 段族则同段裸变段着色） */
interface DiffBodyRow {
  readonly kind: 'del' | 'add' | 'ctx';
  readonly text: string;
  /** 词级段族（相邻 del+add 对行——null = 孤立行整行着色） */
  readonly segs: readonly DiffSeg[] | null;
}

/** 组体行 → 呈现行（tool-card renderDiffBodyLines 同律：1 删 1 增相邻对走词级） */
function bodyRowsOf(lines: readonly PatchLine[]): readonly DiffBodyRow[] {
  const rows: DiffBodyRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === 'meta') {
      i += 1; // 防御位：组体不应含 meta（fold 切组时已分流）——畸形输入跳过不炸
      continue;
    }
    if (line.kind === 'del' && lines[i + 1]?.kind === 'add') {
      // 相邻对：词级 intra-line（R4 单源——两行共享段族，各取本侧变段着色）
      const segs = diffWords(line.text, lines[i + 1]!.text);
      rows.push({ kind: 'del', text: line.text, segs });
      rows.push({ kind: 'add', text: lines[i + 1]!.text, segs });
      i += 2;
      continue;
    }
    rows.push({ kind: line.kind, text: line.text, segs: null }); // 孤立行/上下文行
    i += 1;
  }
  return rows;
}

/** 扁平呈现行（组头 + 展开组体——光标/滚动的行空间单源） */
type FlatRow =
  { readonly kind: 'head'; readonly group: DiffFileGroup } | { readonly kind: 'body'; readonly row: DiffBodyRow };

/** 改动总览装配选项 */
export interface DiffViewerOptions {
  /** 投影快照（foldSessionDiff 在构造期一次聚合——快照档，活体跟随挂账） */
  readonly messages: readonly DiffProjectionMessage[];
  /** 主题（组头计数与词级变段着色——diffAdded/diffRemoved/secondary） */
  readonly theme: ResolvedTheme;
  readonly sessionId: string;
  readonly onExit: () => void;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
}

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 光标行标记（在选行） */
const CURSOR_MARK = '▸';
/** 展开态标记（收起 ▸ / 展开 ▾——组头第二位） */
const COLLAPSED_MARK = '▸';
const EXPANDED_MARK = '▾';

/** key 事件窄化 */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/**
 * 改动总览内容件（OverlayContent——副屏 root 直收全屏 region）：行空间光标
 * （组头 + 展开组体的扁平行——组体可滚）；enter 翻组展开位。快照档——构造后
 * 静态，返回主屏全帧补显。
 */
export class DiffViewer implements OverlayContent {
  private readonly groups: readonly DiffFileGroup[];
  private readonly theme: ResolvedTheme;
  private readonly sessionId: string;
  private readonly onExit: () => void;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  /** 展开组集合（路径键——缺省全收起：总览语义） */
  private readonly expanded = new Set<string>();
  /** 行空间光标（扁平行下标） */
  private cursor = 0;
  /** 视口首行（光标驱动夹取） */
  private offset = 0;
  /** 视口高实测（render 回写——翻页的页幅依据） */
  private viewportHeight = 1;
  /** 退出闭锁（q/Esc 与 Ctrl+D 两路共闭——竞发防御位） */
  private exited = false;

  constructor(options: DiffViewerOptions) {
    this.groups = foldSessionDiff(options.messages);
    this.theme = options.theme;
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
  }

  /** 扁平行空间（组头 + 展开组体——render/事件两消费面单源） */
  private flatRows(): readonly FlatRow[] {
    const rows: FlatRow[] = [];
    for (const group of this.groups) {
      rows.push({ kind: 'head', group });
      if (this.expanded.has(group.path)) {
        for (const row of bodyRowsOf(group.lines)) rows.push({ kind: 'body', row });
      }
    }
    return rows;
  }

  /** 量高：头行 + 扁平行全量 + 底行提示（副屏 root 不经布局路——render 窗口化） */
  measure(width: number): number {
    void width;
    return 1 + Math.max(1, this.flatRows().length) + 1;
  }

  /** 落位：头行 → 行视口（组头计数着色 / 组体词级变段着色）→ 底行提示 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    const head = `± 改动总览 · ${this.groups.length} 文件`;
    buffer.writeText(region.row, region.col, head);
    const viewHeight = Math.max(1, region.height - 2);
    this.viewportHeight = viewHeight;
    if (this.groups.length === 0) {
      // 空集诚实空态行（零 git 子进程——数据源注记随行）
      buffer.writeText(
        region.row + 1,
        region.col,
        '（本会话零 edit 类改动——聚合会话事件真源，非 git 工作树态）',
        HINT_STYLE,
      );
    } else {
      const rows = this.flatRows();
      this.clampCursor(rows.length);
      this.clampOffset(rows.length);
      for (let i = 0; i < viewHeight; i++) {
        const index = this.offset + i;
        if (index >= rows.length) break;
        const row = rows[index]!;
        if (row.kind === 'head') {
          this.renderHead(buffer, region.row + 1 + i, region.col, region.width, index, row.group);
        } else {
          this.renderBody(buffer, region.row + 1 + i, region.col, region.width, index, row.row);
        }
      }
    }
    buffer.writeText(
      region.row + region.height - 1,
      region.col,
      this.groups.length === 0 ? 'q/esc 返回' : '↑↓ 移动 · enter 展开/收起 · q/esc 返回',
      HINT_STYLE,
    );
  }

  /** 组头行：光标 ▸ + 展开位 ▸/▾ + 路径左段；+N（绿）/-M（红）/⧗（次文）右段 */
  private renderHead(
    buffer: CellBuffer,
    row: number,
    col: number,
    width: number,
    index: number,
    group: DiffFileGroup,
  ): void {
    const expanded = this.expanded.has(group.path);
    const left = `${index === this.cursor ? CURSOR_MARK : ' '} ${expanded ? EXPANDED_MARK : COLLAPSED_MARK} ${group.path}${group.orphan ? '  ⧗ 在飞' : ''}`;
    // 右段三游程：+N（diffAdded）/ -M（diffRemoved）——计数着色即语义着色
    const addedText = `+${group.added}`;
    const removedText = `-${group.removed}`;
    const rightWidth = stringWidth(addedText) + 1 + stringWidth(removedText);
    let c = col + width - rightWidth;
    const maxLeft = c - col - 1;
    const fitLeft = stringWidth(left) <= maxLeft ? left : `${truncateToWidth(left, Math.max(0, maxLeft - 1))}…`;
    buffer.writeText(row, col, fitLeft);
    buffer.writeText(row, c, addedText, { fg: this.theme.diffAdded });
    c += stringWidth(addedText) + 1;
    buffer.writeText(row, c, removedText, { fg: this.theme.diffRemoved });
  }

  /** 组体行：词级对行同段裸/变段着色（R4 单源呈现）；孤立 del/add 整行着色；ctx 裸行 */
  private renderBody(
    buffer: CellBuffer,
    row: number,
    col: number,
    width: number,
    index: number,
    body: DiffBodyRow,
  ): void {
    const fg: ColorValue | undefined =
      body.kind === 'del' ? this.theme.diffRemoved : body.kind === 'add' ? this.theme.diffAdded : undefined;
    // 词级段族在场：逐段写（same 段裸、本侧变段着色——对行的异侧段不在此行）
    if (body.segs !== null) {
      buffer.writeText(row, col, index === this.cursor ? CURSOR_MARK : ' ');
      let c = col + 2;
      const prefix = body.kind === 'del' ? '-' : '+';
      buffer.writeText(row, c, prefix, { fg });
      c += 1;
      for (const seg of body.segs) {
        if (c >= col + width) break; // 超宽即止（段级截断）
        // 段族两栖承载（del+add+same 全集）——本行只取本侧变段 + same 段
        //（对行的异侧变段不在此行：del 行不写 add 段、add 行不写 del 段）
        if (seg.kind !== 'same' && seg.kind !== body.kind) continue;
        const isChange = seg.kind === body.kind; // 本侧变段（着色位）
        const piece = seg.text;
        const room = col + width - c;
        const fit = stringWidth(piece) <= room ? piece : truncateToWidth(piece, room);
        buffer.writeText(row, c, fit, isChange ? { fg } : undefined);
        c += stringWidth(fit);
      }
      return;
    }
    // 孤立行：前缀 + 整行着色（ctx 裸——fg undefined 时样式位即裸）
    const prefix = body.kind === 'del' ? '-' : body.kind === 'add' ? '+' : '';
    const text = `${index === this.cursor ? CURSOR_MARK : ' '} ${prefix}${body.text}`;
    const fit = stringWidth(text) <= width ? text : `${truncateToWidth(text, Math.max(0, width - 1))}…`;
    buffer.writeText(row, col, fit, fg === undefined ? undefined : { fg });
  }

  /** 事件分发（副屏内容终局消费）：Ctrl+C/Ctrl+D 补丁 → 翻组 → 移动键 → 退出 */
  handleEvent(event: InputEvent): boolean {
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      // Ctrl+C = 打断在飞 run（目标 = 当前交互会话位——不退屏，件族同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        this.onInterrupt?.(this.sessionId);
        return true;
      }
      // Ctrl+D = 退出进程（先收副屏再转退出柄——件族同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'd') {
        this.exit();
        this.onQuit?.();
        return true;
      }
      if (this.groups.length > 0) {
        const rows = this.flatRows();
        if (isPlainKey(k, 'up')) {
          this.cursor = Math.max(0, this.cursor - 1);
          return true;
        }
        if (isPlainKey(k, 'down')) {
          this.cursor = Math.min(rows.length - 1, this.cursor + 1);
          return true;
        }
        if (isPlainKey(k, 'pageup')) {
          this.cursor = Math.max(0, this.cursor - this.viewportHeight);
          return true;
        }
        if (isPlainKey(k, 'pagedown')) {
          this.cursor = Math.min(rows.length - 1, this.cursor + this.viewportHeight);
          return true;
        }
        if (isPlainKey(k, 'home')) {
          this.cursor = 0;
          return true;
        }
        if (isPlainKey(k, 'end')) {
          this.cursor = rows.length - 1;
          return true;
        }
        if (isPlainKey(k, 'enter')) {
          // 展开/收起光标组（光标行所在组——组头/组体同判）
          const row = rows[Math.min(this.cursor, rows.length - 1)]!;
          const group = row.kind === 'head' ? row.group : this.groupAt(this.cursor, rows);
          if (group !== null) {
            if (this.expanded.has(group.path)) this.expanded.delete(group.path);
            else this.expanded.add(group.path);
          }
          return true;
        }
      }
      if (isPlainKey(k, 'escape') || isPlainKey(k, 'q')) {
        this.exit();
        return true;
      }
    }
    if (event.kind === 'text' && event.text === 'q') {
      this.exit(); // kitty disambiguate 轨纯键打字走 text 事件
      return true;
    }
    return true; // 未消费键终局吞（模态独占）
  }

  /** 行空间下标 → 所在组（组头即本组；组体回溯同组头） */
  private groupAt(index: number, rows: readonly FlatRow[]): DiffFileGroup | null {
    for (let i = Math.min(index, rows.length - 1); i >= 0; i--) {
      const row = rows[i]!;
      if (row.kind === 'head') return row.group;
    }
    return null;
  }

  /** 光标夹取（翻组收起行空间收缩——行下标入界） */
  private clampCursor(length: number): void {
    if (length > 0) this.cursor = Math.max(0, Math.min(length - 1, this.cursor));
    else this.cursor = 0;
  }

  /** 视口夹取：光标行恒在窗内（下溢提窗 / 上溢压窗） */
  private clampOffset(length: number): void {
    if (this.cursor < this.offset) this.offset = this.cursor;
    else if (this.cursor >= this.offset + this.viewportHeight) {
      this.offset = this.cursor - this.viewportHeight + 1;
    }
    // 尾窗不满则提窗（收起收缩后防空窗）
    const maxOffset = Math.max(0, length - this.viewportHeight);
    if (this.offset > maxOffset) this.offset = maxOffset;
  }

  /** 退出（闭锁——单次收口） */
  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.onExit?.();
  }
}
