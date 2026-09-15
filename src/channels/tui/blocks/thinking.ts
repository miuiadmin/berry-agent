/**
 * thinking 块渲染（07 §4.1 R1 批 10i——思考块渲染档位）。
 *
 * 两档：缺省**折叠单行标签**（`✻ 思考 N 字（ctrl+t 展开）`——省 scrollback，
 * 批 10i 落码定值）；展开态 = 标签行 + markdown 体全量（体渲染走既有 doc
 * 管线后**整面改妆**——全部游程 fg=thinkingText + italic，斜体与专用色双位
 * 齐 R1 条款；bold 位保留——标题粗体在单色面仍有层级信息）。
 *
 * 纯函数：同一 (text, expanded, columns, theme, hint, doc) 恒同行集——流式
 * 槽前缀行与定稿 thinking 块**同一函数两用**（换装跳行不漂移的定位前提，
 * 见 main-screen 冻结账注）；doc 参数为预构 markdown renderable（流式槽传
 * StreamingMarkdown 增量件、定稿块持 MarkdownDoc——缺席则内部即时构档）。
 */
import { CellGrid, type CellStyle, type Renderable } from '../../engine/index.js';
import { MarkdownDoc } from '../markdown/markdown.js';
import type { ResolvedTheme } from '../theme/index.js';
import { gridRowToStyled, type StyleRun, type StyledLine } from '../backend/ansi-rows.js';

/** 思考块渲染视图面（块数据与本件渲染的窄接口——流式槽/定稿块共用） */
export interface ThinkingView {
  /** 思考全文（多思考块合并形——'\n\n' 串接） */
  readonly text: string;
  /** 展开态（会话级开关的快照——渲染纯函数化，态归 transcript） */
  readonly expanded: boolean;
  readonly theme: ResolvedTheme;
  /** 开关键名提示（keyText(动作id) 动态取——用户覆盖后随动） */
  readonly toggleHint: string;
}

/** 思考标签行（单行——折叠档全量 + 展开档首行；字数 = UTF-16 单元数近似） */
export function thinkingLabelText(view: ThinkingView, action: '展开' | '收起'): string {
  return `✻ 思考 ${view.text.length} 字（${view.toggleHint} ${action}）`;
}

/**
 * 思考块 → 带样式行集。折叠 = 单标签行（整行 italic + thinkingText 色）；
 * 展开 = 标签行 + 改妆 doc 体行。空 text 零行（守卫位——调用面不落空块，
 * 防御性双保险）。
 */
export function renderThinkingStyledLines(view: ThinkingView, columns: number, doc?: Renderable | null): StyledLine[] {
  if (view.text === '') return [];
  const thinkStyle: CellStyle = { fg: view.theme.thinkingText, italic: true };
  const label = thinkingLabelText(view, view.expanded ? '收起' : '展开');
  const labelLine: StyledLine = {
    plain: label,
    runs: [{ start: 0, end: label.length, style: thinkStyle }],
  };
  if (!view.expanded) return [labelLine];
  // 展开档：体行 = doc 管线行集整面改妆（斜体 + thinkingText——bold 保留）
  const bodyDoc = doc ?? MarkdownDoc.of(view.text, view.theme);
  const grid = new CellGrid(columns, Math.max(1, bodyDoc.measure(columns)));
  bodyDoc.render(grid, { row: 0, col: 0, width: columns, height: grid.rows });
  const body: StyledLine[] = [];
  for (let r = 0; r < grid.rows; r++) {
    const line = gridRowToStyled(grid, r) ?? { plain: '', runs: [] }; // 无内容行保空行（doc 管线同律）
    body.push(restyleThinking(line, thinkStyle));
  }
  return [labelLine, ...body];
}

/** 体行改妆：全部游程换思考样式（start/end 几何保留——纯样式替换） */
function restyleThinking(line: StyledLine, style: CellStyle): StyledLine {
  const runs: StyleRun[] = line.runs.map((run) => ({
    start: run.start,
    end: run.end,
    style: { ...style, bold: run.style.bold }, // bold 层级保留——单色面仍有语义
  }));
  if (runs.length === 0 && line.plain !== '') {
    runs.push({ start: 0, end: line.plain.length, style }); // 无游程裸行补整行妆
  }
  return { plain: line.plain, runs };
}
