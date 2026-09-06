/**
 * TUI 组件层聚合面（07 篇 §4.1 呈现面件 6——批 10d 起组件件逐纵切入此面）。
 *
 * 件内消费（channels 件内 TUI 实装侧——批 10e UiBackend）经本面导入；
 * 件外（其他模块）只准走 channels 公开面四名（02 §4.3 契约面执法——
 * tui/ 同 engine/ 一样是非公开面，api 快照不进本面）。
 */
export { ACCENT_INDEX, sessionColor } from './theme.js';
export type { FlexProps, ColumnProps, RowProps, InsetProps } from './layout.js';
export { Column, Flex, Inset, Row, isFlexRenderable } from './layout.js';
export type { TextProps, ParagraphProps } from './text.js';
export { Paragraph, Text } from './text.js';
