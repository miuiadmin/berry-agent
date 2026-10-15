/**
 * /diff 会话改动总览副屏件（07 §4.1 命令面增补批——TUI 本地拦截族）。
 *
 * - **数据源 = 会话事件投影聚合**（foldSessionDiff 纯函数——投影 assistant
 *   消息 toolCalls 中 edit 类调用的 patch 参数按文件分组）：组头文件名 +
 *   +N/-M 行计数（同文件多次 edit **累计**）、组体 patch 行**事件时间序全量
 *   呈现**、词级 intra-line diff 高亮**复用 R4 单源**（word-diff 件
 *   diffWords/parsePatchLines——实件单源，本件只做呈现）；**组序 = 文件路径
 *   字典序**；孤儿 toolCall（无 result）分组标 ⋮〔在飞〕**同键混排不另立分区**；
 * - **零 git 子进程**：「会话改了什么」（事件真源）与「工作树现在什么样」
 *   （git 真源）两问分立——v1 答前者，投影快照档（开屏一次现取）；
 * - **enter = 展开 / 收起光标组**（缺省全收起——总览语义）；空集（会话零
 *   edit）= 诚实空态行；
 * - **行号槽 + 宽屏 split 双栏**（2026-10-05 ZCode TUI 对标批——07 §4.1
 *   副屏族 diff-viewer 双件定形注）：diff 行前旧/新行号 dim 槽——**真帧优先**
 *   （挖掘 45 轮件 D：edit 回执 meta operations 携 startLine 则段自真帧起算、
 *   add 段回执在场即新文件自 1）、**缺席回退 patch 相对帧**（旧日志/孤儿
 *   toolCall 无 meta——组体行序自算的唯一自洽帧，缺席段续前段尾跨界续算），
 *   各循其轨（删行旧轨 / 增行新轨 / ctx 双轨同进）、位数按组最大轨号自适应
 *   （真帧可达百千位——宽度自号位）；终端宽 ≥100 列（SPLIT_MIN_WIDTH 落码
 *   定值）unified→split 双栏（左旧右新、中缝 1 列、行号槽分栏各随、词级对
 *   行合并同屏行、孤立删/增单侧挂空），窄屏维持 unified；两形导航键与
 *   ⋮/… 省略位不变；
 * - **段间 ⋮ 分隔行**（挖掘 45 轮件 D）：同文件多段（多次 edit / 多文件段
 *   指令）段间插 dim ⋮ 占位行（无带无槽、不占行号账——codex spacer 同形），
 *   单段组零分隔行；
 * - **组体 add/del 行行级 bg 色带**（挖掘 45 轮件 E——07 §4.1 2026-10-16
 *   接档注）：unified 全行带 / split 半栏带中缝 1 列恒裸、ctx 与组头不施、
 *   16 档降采缺席腿纯前景独行（双通道并行律）；
 * - 键面同副屏件族律（q / esc 返回、Ctrl+C 打断、Ctrl+D 先收屏再退）。
 */
import type { CellBuffer, CellStyle, ColorValue, InputEvent, Region } from '../../engine/index.js';
import { ellipsize, stringWidth } from '../../engine/index.js';
import { fitLine } from '../row-segments.js';
import type { ResolvedTheme } from '../theme/index.js';
import { sanitizeLineText } from '../blocks/tool-card.js';
import { diffWords, parsePatchLines, type DiffSeg, type PatchLine } from '../blocks/word-diff.js';
import type { OverlayContent } from '../overlay/overlay.js';
import { hintLine } from '../keys/hint.js';
import { DIM_STYLE } from '../../engine/index.js';
import { activeRowStyleOf, CURSOR_MARK as PANEL_CHROME_CURSOR_MARK, HEAD_MARKS } from './panel-chrome.js';
import { extractDiffStartLines } from '../backend/transcript.js';

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
  /** toolResult 形在场：审计位（05 §1.1 meta——挖掘 45 轮件 D，edit 回执 operations 真帧源） */
  readonly meta?: unknown;
}

/** 文件段（一次 call 对该文件的一段补丁——段界 = 文件段指令出现，不依行连续性） */
export interface DiffFileSection {
  /** 段体 patch 行（ctx/del/add 分类形——meta 段指令不入段体，组头已呈路径） */
  readonly lines: readonly PatchLine[];
  /**
   * 段真帧起点（1-based 旧侧；null = 缺席回退组内连续相对帧）。update 段 =
   * 回执 operations 槽 startLine（缺席/非数 → null——槽级诚实缺席）；add 段
   * = 回执在场即新文件帧自 1（operations add 项不带 startLine，坏形忽略）；
   * delete 段无行体恒 null。
   */
  readonly startLine: number | null;
}

/** 文件分组（foldSessionDiff 产物——组体按段组织、段序 = call 时间序） */
export interface DiffFileGroup {
  /** 文件路径（apply_patch 文件段指令原文——字典序键） */
  readonly path: string;
  /** 增行计数（多次 edit 累计——'+' 体系行） */
  readonly added: number;
  /** 删行计数（多次 edit 累计——'-' 体系行） */
  readonly removed: number;
  /** 孤儿位（贡献本组的 edit toolCall 存在无 result 在飞形——⋮ 标记） */
  readonly orphan: boolean;
  /** 段集（同文件多次 edit = 多段——段间 ⋮ 分隔） */
  readonly sections: readonly DiffFileSection[];
}

/** 文件段指令前缀三形（apply_patch 文法——tools 件真源，此处显示层判形） */
const FILE_DIRECTIVES = ['*** Update File:', '*** Add File:', '*** Delete File:'] as const;

/**
 * 投影消息 → 文件分组（纯函数——装配/测试双消费）：assistant 消息 toolCalls
 * 中 edit 调用（`toolName === 'edit'` 且 arguments JSON 串解析出 string
 * `patch`——transcript 工具卡判形同源、arguments 载体异形〔投影 = 审计原始
 * 串〕）逐个累积；toolResult 按 toolCallId 配对，无配对 = 孤儿（⋮ 在飞）。
 * 组序 = 路径字典序。
 */
export function foldSessionDiff(messages: readonly DiffProjectionMessage[]): readonly DiffFileGroup[] {
  // 配对面先行：有 result 的 toolCallId 全集（孤儿判据）+ 审计位账（挖掘 45 轮
  // 件 D——meta 键 toolCallId，真帧源）
  const answered = new Set<string>();
  const metaByCall = new Map<string, unknown>();
  for (const message of messages) {
    if (message.type === 'toolResult' && message.toolCallId !== undefined) {
      answered.add(message.toolCallId);
      if (message.meta !== undefined) metaByCall.set(message.toolCallId, message.meta);
    }
  }
  const groups = new Map<
    string,
    { path: string; added: number; removed: number; orphan: boolean; sections: DiffFileSection[] }
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
      // 回执真帧槽序列（工具卡同器单源——段序对齐风险归零；无 meta = 全程缺席）
      const starts = extractDiffStartLines(metaByCall.get(call.toolCallId));
      let currentGroup: {
        path: string;
        added: number;
        removed: number;
        orphan: boolean;
        sections: DiffFileSection[];
      } | null = null;
      let currentSection: { lines: PatchLine[]; startLine: number | null } | null = null;
      let sectionIndex = -1; // call 内段序（跨文件连续计——operations 槽序对齐）
      for (const line of parsePatchLines(patch)) {
        if (line.kind === 'meta') {
          // 文件段指令 → 切段（段界 = 指令出现即开新段，不依行连续性——同文件
          // 同 call 两段指令按连续性归段会并段致 operations 槽位错位）；
          // Begin/End 等其余 meta 不产段
          const directive = FILE_DIRECTIVES.find((prefix) => line.text.startsWith(prefix));
          if (directive === undefined) {
            currentGroup = null; // 段外 meta（Begin/End）——后续体系行无组可归
            currentSection = null;
            continue;
          }
          const path = line.text.slice(directive.length).trim();
          sectionIndex += 1;
          let group = groups.get(path);
          if (group === undefined) {
            group = { path, added: 0, removed: 0, orphan: false, sections: [] };
            groups.set(path, group);
          }
          group.orphan = group.orphan || orphan; // 孤儿位按贡献 OR 累积（同键混排）
          // 段真帧（消费侧按段指令裁）：update 段取回执槽 startLine（槽级缺席
          // → null）；add 段回执在场即新文件帧自 1（operations add 项不带
          // startLine，坏形忽略）；delete 段无行体恒 null
          const slot = starts?.[sectionIndex];
          const startLine =
            directive === '*** Update File:' && typeof slot === 'number'
              ? slot
              : directive === '*** Add File:' && !orphan
                ? 1
                : null;
          const section = { lines: [] as PatchLine[], startLine };
          group.sections.push(section); // 段序 = call 时间序（事件序遍历自然序）
          currentGroup = group;
          currentSection = section;
          continue;
        }
        if (currentSection === null || currentGroup === null) continue; // 段首指令前的体系行（畸形防御）——不归组
        currentSection.lines.push(line);
        if (line.kind === 'add') currentGroup.added += 1;
        else if (line.kind === 'del') currentGroup.removed += 1;
      }
    }
  }
  return [...groups.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** 组体呈现行（词级对行展开后——del/add 行带 DiffSeg 段族则同段裸变段着色） */
interface DiffBodyRow {
  readonly kind: 'del' | 'add' | 'ctx' | 'gap';
  readonly text: string;
  /** 词级段族（相邻 del+add 对行——null = 孤立行整行着色 / gap 行无段） */
  readonly segs: readonly DiffSeg[] | null;
  /** 旧轨行号（ctx/del 在场——真帧优先、缺席段相对帧续算；gap 恒 null） */
  readonly oldLine: number | null;
  /** 新轨行号（ctx/add 在场——真帧优先、缺席段相对帧续算；gap 恒 null） */
  readonly newLine: number | null;
}

/**
 * 组体呈现行（段界分隔 + 真帧游标——挖掘 45 轮件 D）：同组多段段间插 gap 行
 * （dim ⋮——codex diff_render.rs spacer 同形）；段有真帧（startLine 非 null）
 * 则双轨自真帧重起（update 段双侧同起 / add 段新轨自 1），缺席段续前段尾
 * 游标跨界续算——全程无真帧的组 = 组内连续 patch 相对帧（旧日志/孤儿零回归）；
 * 段内行进律维持（tool-card renderDiffBodyLines 同律：1 删 1 增相邻对走词级
 * + 各循其轨）+ 行号轨记账。
 */
function bodyRowsOf(sections: readonly DiffFileSection[]): readonly DiffBodyRow[] {
  const rows: DiffBodyRow[] = [];
  // 行号轨游标（跨段连续账）：旧轨 = ctx+del 前进、新轨 = ctx+add 前进——
  // 真帧段自 startLine 重起，缺席段续前段尾（组内跨界续算）
  let oldLine = 0;
  let newLine = 0;
  for (let s = 0; s < sections.length; s++) {
    const section = sections[s]!;
    if (s > 0) {
      // 段间分隔行（首段前不插——codex is_first_hunk 同闸）
      rows.push({ kind: 'gap', text: '⋮', segs: null, oldLine: null, newLine: null });
    }
    if (section.startLine !== null) {
      // 真帧重起（startLine 1-based → 游标先减一）：本段首行落 startLine
      oldLine = section.startLine - 1;
      newLine = section.startLine - 1;
    }
    const lines = section.lines;
    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!;
      if (line.kind === 'meta') {
        i += 1; // 防御位：段体不应含 meta（fold 切段时已分流）——畸形输入跳过不炸
        continue;
      }
      // 构造位消毒先行（2026-09-21 第六役修复组 2——S2 宽度账族，tool-card
      // renderWordDiffPair/renderSinglePatchLine 同律单源）：patch 体是模型生成
      // 真源码——CRLF 行尾 \r 计宽 1 落格 0（宽度模型分歧）、ESC 序列的可打印
      // 载荷照写落屏。词元切分与测宽截断都以消毒后文本为基（sanitize 先于
      // diffWords——段几何与落格账一致）。
      if (line.kind === 'del' && lines[i + 1]?.kind === 'add') {
        // 相邻对：词级 intra-line（R4 单源——两行共享段族，各取本侧变段着色）
        const delBody = sanitizeLineText(line.text);
        const addBody = sanitizeLineText(lines[i + 1]!.text);
        const segs = diffWords(delBody, addBody);
        oldLine += 1; // 删行旧轨前进
        newLine += 1; // 对行增侧新轨前进（记账与 push 同序——轨号即行位）
        rows.push({ kind: 'del', text: delBody, segs, oldLine, newLine: null });
        rows.push({ kind: 'add', text: addBody, segs, oldLine: null, newLine });
        i += 2;
        continue;
      }
      if (line.kind === 'ctx') {
        oldLine += 1; // 上下文行双轨同进
        newLine += 1;
        rows.push({ kind: 'ctx', text: sanitizeLineText(line.text), segs: null, oldLine, newLine });
      } else if (line.kind === 'del') {
        oldLine += 1; // 孤立删行旧轨前进
        rows.push({ kind: 'del', text: sanitizeLineText(line.text), segs: null, oldLine, newLine: null });
      } else {
        newLine += 1; // 孤立增行新轨前进
        rows.push({ kind: 'add', text: sanitizeLineText(line.text), segs: null, oldLine: null, newLine });
      }
      i += 1;
    }
  }
  return rows;
}

/** 行号槽串（右对齐 W 宽；null = 本轨不前进位——空槽） */
function lineSlot(line: number | null, width: number): string {
  return line === null ? ' '.repeat(width) : String(line).padStart(width);
}

/**
 * 行号槽宽（位数自适应——rows 中两轨最大号位数；空组下限 1）。真帧后行号可
 * 达百千位（回执 startLine）——宽度自号位非自段长（挖掘 45 轮件 D 起
 * numWidthOf 组行计数版退役），超宽时内容预算收缩。
 */
function numWidthOfRows(rows: readonly DiffBodyRow[]): number {
  let max = 0;
  for (const row of rows) {
    if (row.kind === 'gap') continue; // 段间分隔行无行号
    if (row.oldLine !== null && row.oldLine > max) max = row.oldLine;
    if (row.newLine !== null && row.newLine > max) max = row.newLine;
  }
  return Math.max(1, String(max).length);
}

/** split 双栏行（左旧右新——null = 该侧无内容：孤立删挂右空、孤立增挂左空） */
interface SplitPair {
  readonly left: DiffBodyRow | null;
  readonly right: DiffBodyRow | null;
}

/**
 * 组体行 → split 双栏行（宽屏形行空间）：词级对行合并同屏行（左旧右新
 * 对齐——segs 在场即对行判据）；孤立删/增单侧挂空；ctx 双侧同现。连续
 * 删/增族经 bodyRowsOf 的 1:1 相邻对配对后自然对齐（余行挂空侧）。
 */
function splitRowsOf(rows: readonly DiffBodyRow[]): readonly SplitPair[] {
  const pairs: SplitPair[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (row.kind === 'gap') {
      // 段间分隔行：双侧挂空占位（renderSplit 全空 ⇔ gap 分支——不变式：
      // 非 gap 行每 pair 至少一侧非空）
      pairs.push({ left: null, right: null });
      i += 1;
      continue;
    }
    if (row.kind === 'del' && row.segs !== null && rows[i + 1]?.kind === 'add') {
      pairs.push({ left: row, right: rows[i + 1]! });
      i += 2;
      continue;
    }
    if (row.kind === 'ctx') pairs.push({ left: row, right: row });
    else if (row.kind === 'del') pairs.push({ left: row, right: null });
    else pairs.push({ left: null, right: row });
    i += 1;
  }
  return pairs;
}

/**
 * 扁平呈现行（光标/滚动的行空间单源——形随宽双空间）：组头 + 展开组体
 *（unified 形逐行 / split 形双栏合并行）。
 */
type FlatRow =
  | { readonly kind: 'head'; readonly group: DiffFileGroup }
  | { readonly kind: 'body'; readonly row: DiffBodyRow; readonly numWidth: number }
  | { readonly kind: 'split'; readonly pair: SplitPair; readonly numWidth: number };

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

/** 提示行样式（dim——注⑩：engine DIM_STYLE 单源） */
const HINT_STYLE: Readonly<CellStyle> = DIM_STYLE;
/** 光标行标记（在选行——panel-chrome 单源引形） */
const CURSOR_MARK = PANEL_CHROME_CURSOR_MARK;
/** 收起态标记（组头第二位——与展开 ▾ 配对的窄形） */
// 撞形修正两轮（2026-09-23 + V-3 注⑩翻档）：初版同用 ▸ 与光标标记撞——缺省
// 全收起 + 光标 0 时首屏「▸ ▸ path」双记不可辨，改窄形 ›；注⑩光标符全域
// 单形 › 后收起位再撞（「› › path」同形复现）——改列点位 •（stringWidth 1
// 语义分立：• = 折叠组/列点、› = 输入与选中——撞形回归防御随形翻档）
const COLLAPSED_MARK = '•';
const EXPANDED_MARK = '▾';

/** 滚轮单步行数（ScrollView WHEEL_LINES 同值——vim mousescroll ver 缺省档三行；mu-2 件族面） */
const WHEEL_LINES = 3;

/**
 * split 双栏阈值（2026-10-05 ZCode 对标批落码定值——07 §4.1 副屏族 diff-viewer
 * 双件定形注「随落码批定值」）：终端宽 ≥100 列 unified→split。定值依据：半栏
 * ~49 列扣除行号槽与前缀后两侧各余 ~44 列正文可读位；窄于此双栏挤成截断雨。
 */
const SPLIT_MIN_WIDTH = 100;

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
  /**
   * 滚轮自由滚位（mu-2 件族面）：滚轮只滚视口（组折叠语义——展开组体长
   * 清单自由翻阅，不挪光标）；置位后 render 夹取只守界（光标可暂出窗），
   * 键盘光标动作族复位钉随（光标恒可见律回锚）。
   */
  private freeScroll = false;
  /** 视口高实测（render 回写——翻页的页幅依据） */
  private viewportHeight = 1;
  /**
   * 末次量宽实测（measure/render 双回写——split 形判定真源）：形随宽的双
   * 行空间（split 对行合并）需要 render 外的消费面（handleEvent 的光标/
   * 滚动/翻组）与 render 同形——渲染前缺省 0 = unified（首帧先于任何键）。
   */
  private lastWidth = 0;
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

  /** split 形在场判定（宽达阈值——ZCode 对标批双件②） */
  private get splitForm(): boolean {
    return this.lastWidth >= SPLIT_MIN_WIDTH;
  }

  /** 扁平行空间（组头 + 展开组体——render/事件两消费面单源；形随宽双空间） */
  private flatRows(): readonly FlatRow[] {
    const split = this.splitForm;
    const rows: FlatRow[] = [];
    for (const group of this.groups) {
      rows.push({ kind: 'head', group });
      if (!this.expanded.has(group.path)) continue;
      const bodyRows = bodyRowsOf(group.sections);
      const numWidth = numWidthOfRows(bodyRows);
      // split 形：对行合并同屏行（行空间收缩）；unified 形：组体逐行
      if (split) {
        for (const pair of splitRowsOf(bodyRows)) rows.push({ kind: 'split', pair, numWidth });
      } else {
        for (const row of bodyRows) rows.push({ kind: 'body', row, numWidth });
      }
    }
    return rows;
  }

  /** 量高：头行 + 扁平行全量 + 底行提示（副屏 root 不经布局路——render 窗口化；形随宽） */
  measure(width: number): number {
    this.lastWidth = width; // 量宽回写（与 render 同源——两消费面同形）
    return 1 + Math.max(1, this.flatRows().length) + 1;
  }

  /** 落位：头行 → 行视口（组头计数着色 / 组体行号槽 + 词级变段着色 / split 双栏）→ 底行提示 */
  render(buffer: CellBuffer, region: Region): void {
    this.lastWidth = region.width; // 落位宽回写（与 measure 同源——resize 弃旧换新后即随新形）
    if (region.height < 2) return; // 防御位（极小终端）
    const head = `${HEAD_MARKS.diff} 改动总览 · ${this.groups.length} 文件`;
    // 头行/空态/底行 fitLine 收口（界面美化役美学注⑤——窄窗溢出止漏）
    buffer.writeText(region.row, region.col, fitLine(head, region.width));
    // 守卫族语义（height=2 → 零内容行只头行+底行）：下限 0——旧 Math.max(1,·)
    // 在 height=2 强立 1 行内容，首内容行先写后又被底行覆写留残段
    const viewHeight = Math.max(0, region.height - 2);
    this.viewportHeight = viewHeight;
    // 底行滚动位标（48 轮件 B——codex scroll_percentage_visible 同义滚动进度
    // 比）：else 分支内 rows 在场时现算（零第二账）；height=2 / 空集缺席
    let bottomPercent: number | null = null;
    if (viewHeight > 0) {
      if (this.groups.length === 0) {
        // 空集诚实空态行（零 git 子进程——数据源注记随行）
        buffer.writeText(
          region.row + 1,
          region.col,
          fitLine('（本会话没有文件改动——只统计本会话改动，非 git 工作区状态）', region.width),
          HINT_STYLE,
        );
      } else {
        const rows = this.flatRows();
        this.clampCursor(rows.length);
        this.clampOffset(rows.length);
        // 滚动进度比：顶 0% / 尾贴窗底 100% / 短清单（maxOffset=0 不滚）恒 100
        //（percent 形免疫后续 flatRows 行粒度变迁——07 §4.1 48 轮件 B 条款）
        const maxOffset = Math.max(0, rows.length - viewHeight);
        bottomPercent = Math.min(100, maxOffset === 0 ? 100 : Math.floor((this.offset / maxOffset) * 100));
        for (let i = 0; i < viewHeight; i++) {
          const index = this.offset + i;
          if (index >= rows.length) break;
          const row = rows[index]!;
          if (row.kind === 'head') {
            this.renderHead(buffer, region.row + 1 + i, region.col, region.width, index, row.group);
          } else if (row.kind === 'body') {
            this.renderBody(buffer, region.row + 1 + i, region.col, region.width, index, row.row, row.numWidth);
          } else {
            this.renderSplit(buffer, region.row + 1 + i, region.col, region.width, index, row.pair, row.numWidth);
          }
        }
      }
    }
    buffer.writeText(
      region.row + region.height - 1,
      region.col,
      fitLine(
        // 位标拼 hintLine 头参（左段）——右缘不立第二写位（fitLine 整行单源
        // 坍缩：右缘位标恰在截断首 victims——拼前免丢）；空集纯 'q/esc'、
        // height=2（bottomPercent 缺席）纯三段教学位
        this.groups.length === 0
          ? 'q/esc 返回'
          : hintLine(
              ...(bottomPercent !== null ? [`${bottomPercent}%`] : []),
              '↑↓ 移动',
              'enter 展开/收起',
              'q/esc 返回',
            ),
        region.width,
      ),
      HINT_STYLE,
    );
  }

  /** 组头行：光标 › + 展开位 •/▾ + 路径左段；+N（绿）/-M（红）/⋮（次文·在飞跳略位）右段 */
  private renderHead(
    buffer: CellBuffer,
    row: number,
    col: number,
    width: number,
    index: number,
    group: DiffFileGroup,
  ): void {
    const expanded = this.expanded.has(group.path);
    const left = `${index === this.cursor ? CURSOR_MARK : ' '} ${expanded ? EXPANDED_MARK : COLLAPSED_MARK} ${group.path}${group.orphan ? '  ⋮ 进行中' : ''}`;
    // 右段三游程：+N（diffAdded）/ -M（diffRemoved）——计数着色即语义着色。
    // 右段预算（第五役 G8——fitRowSegments 单源的形态学例外注记）：三游程
    // 双色计数段非单串右段，不能整段走 row-segments 单源，本位等价收紧——
    // 余宽不足（右段全宽 + 左段至少 '…' 帽 2）整段丢弃（同「预算 0 丢右段」
    // 负起列封堵律）：极窄窗下 c = col+width-rightWidth 为负，writeText 负列
    // 首字素越界吸收、后续字素顺移落行首——覆写左段（'1 -0' 坏形族）
    const addedText = `+${group.added}`;
    const removedText = `-${group.removed}`;
    const rightWidth = stringWidth(addedText) + 1 + stringWidth(removedText);
    const showRight = width - rightWidth >= 2;
    const rightStart = col + width - rightWidth;
    const maxLeft = (showRight ? rightStart : col + width) - col - 1;
    const fitLeft = ellipsize(left, maxLeft); // 省略形单源（width 件）
    // 在选行整行 accent bold（R-9）——左段组头行；右段 ±N/-M 语义色不参与
    // 覆写（语义色优先于装饰律——diff 计数着色保持）
    buffer.writeText(row, col, fitLeft, index === this.cursor ? activeRowStyleOf(this.theme) : undefined);
    if (showRight) {
      let c = rightStart;
      buffer.writeText(row, c, addedText, { fg: this.theme.diffAdded });
      c += stringWidth(addedText) + 1;
      buffer.writeText(row, c, removedText, { fg: this.theme.diffRemoved });
    }
  }

  /**
   * 组体行（unified 形）：光标位 + 行号槽（旧轨|新轨 dim——各循其轨）+ 前缀
   * 与内容（词级对行同段裸/变段着色——R4 单源呈现；孤立 del/add 整行着色；
   * ctx 裸行；超宽 … 收口）。行几何 = 光标位(1) + 槽区(2W+1) + 前缀(1) + 文本。
   */
  private renderBody(
    buffer: CellBuffer,
    row: number,
    col: number,
    width: number,
    index: number,
    body: DiffBodyRow,
    numWidth: number,
  ): void {
    if (body.kind === 'gap') {
      // 段间分隔行（挖掘 45 轮件 D）：无带无槽——光标位 + 前缀列 dim ⋮
      //（codex diff_render.rs spacer 同形——跨段省略位不占行号账）
      buffer.writeText(row, col, index === this.cursor ? CURSOR_MARK : ' ');
      buffer.writeText(row, col + 2 * numWidth + 2, '⋮', HINT_STYLE);
      return;
    }
    // 行级全宽 bg 色带（件 E）：先铺整行底带再落文本——setCell 全量替换律下，
    // 带内每个后写必须同携 bg 才不凿洞；行尾衬底（文本外余列）由底带自然
    // 覆盖（工具卡 fillBg 尾腿 / history-viewer 逐格补底同效——BCE 同义）
    const band = this.bandOf(body.kind);
    if (band !== undefined) {
      buffer.writeText(row, col, ' '.repeat(width), band);
    }
    buffer.writeText(row, col, index === this.cursor ? CURSOR_MARK : ' ', band);
    buffer.writeText(
      row,
      col + 1,
      `${lineSlot(body.oldLine, numWidth)} ${lineSlot(body.newLine, numWidth)}`,
      // 槽 dim 与带合流；缺席腿（band undefined）恒等传 HINT_STYLE——不造新
      // 对象（16 档腿 toBe identity 锁的硬约束）
      band !== undefined ? { ...HINT_STYLE, ...band } : HINT_STYLE,
    );
    const start = col + 2 * numWidth + 2; // 前缀列（槽区 2W+1 起于 col+1）
    this.renderLineContent(buffer, row, start, width - (2 * numWidth + 2), body, band);
  }

  /**
   * split 双栏行（宽屏形——左旧右新、中缝 1 列）：行号槽分栏各随（左旧轨/
   * 右新轨 dim）；两侧同预算（对齐位 1 + 槽 W + 缝 1 + 前缀 1——前缀列跨缝
   * 同列，width 奇偶余列归右半）；内容收口单源 renderLineContent（半栏窗——
   * … 省略位与 unified 同律，止步缝前）。
   */
  private renderSplit(
    buffer: CellBuffer,
    row: number,
    col: number,
    width: number,
    index: number,
    pair: SplitPair,
    numWidth: number,
  ): void {
    const half = Math.floor((width - 1) / 2); // 左半 [col, col+half)，缝 1 列，右半 [col+half+1, col+width)
    const rightCol = col + half + 1;
    if (pair.left === null && pair.right === null) {
      // 段间分隔行（全空 ⇔ gap——splitRowsOf 不变式：非 gap 行每 pair 至少
      // 一侧非空）：双侧无带无槽，光标位 + 左半内容列 dim ⋮（与 unified ⋮
      // 同符号同 dim——split 形段界不换记号）
      buffer.writeText(row, col, index === this.cursor ? CURSOR_MARK : ' ');
      buffer.writeText(row, col + numWidth + 2, '⋮', HINT_STYLE);
      return;
    }
    // 双侧分立带（件 E）：左半 del 带 / 右半 add 带、中缝 1 列恒不铺
    //（del 带 | 裸缝 | add 带的双带并置分隔位；文本写恒不越缝既有律）；
    // 空挂半（孤增左 / 孤删右）无带（pair 侧 null → 本侧 band undefined）
    const leftBand = pair.left !== null ? this.bandOf(pair.left.kind) : undefined;
    const rightBand = pair.right !== null ? this.bandOf(pair.right.kind) : undefined;
    if (leftBand !== undefined) buffer.writeText(row, col, ' '.repeat(half), leftBand);
    if (rightBand !== undefined) buffer.writeText(row, rightCol, ' '.repeat(width - half - 1), rightBand);
    // 光标位列随左半带（左空挂 = 无带）
    buffer.writeText(row, col, index === this.cursor ? CURSOR_MARK : ' ', leftBand);
    if (pair.left !== null) {
      buffer.writeText(
        row,
        col + 1,
        lineSlot(pair.left.oldLine, numWidth),
        leftBand !== undefined ? { ...HINT_STYLE, ...leftBand } : HINT_STYLE,
      );
    }
    if (pair.right !== null) {
      buffer.writeText(
        row,
        rightCol + 1,
        lineSlot(pair.right.newLine, numWidth),
        rightBand !== undefined ? { ...HINT_STYLE, ...rightBand } : HINT_STYLE,
      );
    }
    const room = half - numWidth - 2; // 两侧同内容预算（前缀列起算——含前缀 1）
    if (pair.left !== null) this.renderLineContent(buffer, row, col + numWidth + 2, room, pair.left, leftBand);
    if (pair.right !== null) this.renderLineContent(buffer, row, rightCol + numWidth + 2, room, pair.right, rightBand);
  }

  /**
   * 行内容渲染（前缀 -/+/空 + 词级段族或整行文本，窗 [start, start+room) 内
   * 收口——unified 全宽窗 / split 半栏窗两消费面单源）：词级段族在场逐段写
   * （same 段裸、本侧变段着色——对行的异侧段不在此行），超宽段省略形收口
   * （… 记号随段既有着色、被切即行终——界面美化役①）；孤立行整行着色
   * （ctx 裸）+ 超宽 ellipsize（0 宽守卫在源）。尾参 band（件 E）= 行级
   * bg 色带——全部写点携 bg 合并（same 段洞补裸 bg 承底；bg 缺席腿纯前景
   * 现状独行——双通道并行律）。
   */
  private renderLineContent(
    buffer: CellBuffer,
    row: number,
    start: number,
    room: number,
    body: DiffBodyRow,
    band?: CellStyle,
  ): void {
    if (room <= 0) return; // 极窄窗（槽区占满）——内容位零预算不写（带已由 caller pre-fill 铺就）
    const fg: ColorValue | undefined =
      body.kind === 'del' ? this.theme.diffRemoved : body.kind === 'add' ? this.theme.diffAdded : undefined;
    const bg = band?.bg; // undefined = 无带腿（16 档降采）——纯前景现状
    const style: CellStyle | undefined =
      fg === undefined ? (bg === undefined ? undefined : { bg }) : bg === undefined ? { fg } : { fg, bg };
    const prefix = body.kind === 'del' ? '-' : body.kind === 'add' ? '+' : '';
    buffer.writeText(row, start, prefix, style);
    let c = start + 1;
    const limit = start + room;
    if (body.segs !== null) {
      for (const seg of body.segs) {
        if (c >= limit) break; // 超宽即止（段级截断）
        // 段族两栖承载（del+add+same 全集）——本行只取本侧变段 + same 段
        //（对行的异侧变段不在此行：del 行不写 add 段、add 行不写 del 段）
        if (seg.kind !== 'same' && seg.kind !== body.kind) continue;
        const isChange = seg.kind === body.kind; // 本侧变段（着色位）
        const piece = seg.text;
        const space = limit - c;
        if (stringWidth(piece) <= space) {
          // 适装段整段写（着色语义不变——本侧变段红/绿带 bg 双通道、
          // same 段洞补裸 bg 承底〔件 E——工具卡洞补同义〕、无带腿两形现状）
          buffer.writeText(row, c, piece, isChange ? style : bg !== undefined ? { bg } : undefined);
          c += stringWidth(piece);
          continue;
        }
        // 超宽段省略形收口（界面美化役 2026-10-01 ①——diffAdded/diffRemoved
        // 前景色不变，仅截断点拼 … 记号且随本段既有着色——被切行与真实行尾
        // 可辨）；被切即行终——后续段不再写（防 … 记号后缀残段内容），整字
        // 丢弃的残列留白（带尾由 pre-fill 覆盖——截断点后余列恒衬底）
        buffer.writeText(row, c, ellipsize(piece, space), isChange ? style : bg !== undefined ? { bg } : undefined);
        break;
      }
      return;
    }
    // 孤立行/上下文行：整行续写（前缀已落；ctx 裸——style undefined 即裸）
    buffer.writeText(row, c, ellipsize(body.text, limit - c), style);
  }

  /**
   * 组体行 bg 色带样式（挖掘 45 轮件 E）：add/del 行施 diffAddedBg/
   * diffRemovedBg（theme 双键——codex diff bg 静态定值，工具卡 diff 档同源
   * 第二消费位）；ctx/gap 行与 16 档降采缺席腿恒 undefined（bg 缺席不破前景
   * 可读性——「双通道并行」律）。
   */
  private bandOf(kind: DiffBodyRow['kind']): CellStyle | undefined {
    const bg = kind === 'add' ? this.theme.diffAddedBg : kind === 'del' ? this.theme.diffRemovedBg : undefined;
    return bg === undefined ? undefined : { bg };
  }

  /** 事件分发（副屏内容终局消费）：滚轮 → Ctrl+C/Ctrl+D 补丁 → 翻组 → 移动键 → 退出 */
  handleEvent(event: InputEvent): boolean {
    if (event.kind === 'mouse') {
      // 滚轮只滚视口（mu-2 件族面）：±3 行界夹取（展开组体长清单自由翻阅
      // ——不挪光标）；wheel 无 release 相（终端不报——press 一相到达）；
      // 非滚轮鼠标相零动作吞（v1 无选区/点击面，模态独占）
      if (event.phase === 'press' && (event.button === 'wheel-up' || event.button === 'wheel-down')) {
        if (this.groups.length > 0) {
          const rows = this.flatRows();
          const maxOffset = Math.max(0, rows.length - this.viewportHeight);
          const delta = event.button === 'wheel-up' ? -WHEEL_LINES : WHEEL_LINES;
          this.freeScroll = true; // 自由滚位（render 夹取只守界）
          this.offset = Math.max(0, Math.min(maxOffset, this.offset + delta));
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
      // Ctrl+D = 退出进程（先收副屏再转退出柄——件族同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'd') {
        this.exit();
        this.onQuit?.();
        return true;
      }
      if (this.groups.length > 0) {
        // 键盘光标动作族（移动/翻组）复位钉随——滚轮自由滚位让位（光标恒可见律）
        this.freeScroll = false;
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

  /**
   * 视口夹取：界夹取恒守（[0, maxOffset]——收起收缩后防空窗）；光标钉随
   * （下溢提窗 / 上溢压窗）只在非自由滚位期——滚轮只滚视口期光标可暂出窗
   * （键盘光标动作复位钉随）。
   */
  private clampOffset(length: number): void {
    // 尾窗不满则提窗（收起收缩后防空窗）+ 上界恒守（自由滚位同样不越界）
    const maxOffset = Math.max(0, length - this.viewportHeight);
    if (this.offset > maxOffset) this.offset = maxOffset;
    if (this.offset < 0) this.offset = 0;
    if (this.freeScroll) return; // 滚轮自由滚位——只守界（光标可暂出窗）
    if (this.cursor < this.offset) this.offset = this.cursor;
    else if (this.cursor >= this.offset + this.viewportHeight) {
      this.offset = this.cursor - this.viewportHeight + 1;
    }
  }

  /** 退出（闭锁——单次收口） */
  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.onExit?.();
  }
}
