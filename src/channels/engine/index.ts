/**
 * 自研 TUI 引擎公共面（07 篇 §4.1 自研引擎节——件内子目录聚合面）。
 *
 * 批 10b 引擎核心四件 + 内存终端：契约件（types）/ 文本度量（width）/
 * 缓冲（cell）/ 差分（diff）/ MemoryTerminalIO。引擎编排与输入解码归批
 * 10c、组件层归批 10d、TUI 实装装配归批 10e——本面随批扩。
 *
 * 件内消费（channels 件内 TUI 实装侧）经本面导入；件外（其他模块）只准走
 * channels 公开面四名（02 §4.3 契约面执法——engine/ 非公开面）。
 */
export type {
  AnsiColor,
  Cell,
  CellBuffer,
  CellStyle,
  CursorState,
  ImeEvent,
  InputEvent,
  KeyEvent,
  KeyPhase,
  PasteEvent,
  Region,
  Renderable,
  TerminalIO,
  TextInputEvent,
} from './types.js';
export { ansiColor } from './types.js';
export { MemoryTerminalIO } from './memory-io.js';
export { graphemeWidth, splitGraphemes, stringWidth, truncateToWidth, wrapText } from './width.js';
export { CellGrid, cellEquals, EMPTY_STYLE, styleEquals } from './cell.js';
export { renderFrameDiff } from './diff.js';
