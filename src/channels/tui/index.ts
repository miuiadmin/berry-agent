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
export type { EditorOptions } from './editor/editor.js';
export { Editor } from './editor/editor.js';
export type { EditorState } from './editor/editor-model.js';
export { EditorModel } from './editor/editor-model.js';
export type { VisualSegment } from './editor/visual-lines.js';
export { EditorView } from './editor/editor-view.js';
export type { ScrollViewOptions } from './scroll/scroll-view.js';
export { ScrollView } from './scroll/scroll-view.js';
export type { OverlayAnchor, OverlayContent, OverlayHandle } from './overlay/overlay.js';
export { OverlayStack } from './overlay/overlay.js';
export type { ConfirmPanelOptions, SelectOption, SelectPanelOptions } from './overlay/select-confirm.js';
export { ConfirmPanel, SELECT_CANCELLED, SelectPanel } from './overlay/select-confirm.js';
export type { AltScreenOptions } from './overlay/alt-screen.js';
export { AltScreenHost } from './overlay/alt-screen.js';
export type {
  AutocompleteContext,
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteResult,
} from './autocomplete/provider.js';
export type { AutocompleteSources } from './autocomplete/autocomplete.js';
export { CombinedAutocompleteProvider } from './autocomplete/autocomplete.js';
export { AutocompletePopup } from './autocomplete/popup.js';
export type { InlineSpan } from './markdown/inline.js';
export { parseInline } from './markdown/inline.js';
export type { MarkdownBlock } from './markdown/blocks.js';
export { parseMarkdown } from './markdown/blocks.js';
export { MarkdownDoc } from './markdown/markdown.js';
export { StatusLine } from './status/status-line.js';
export type { TuiBackendOptions } from './backend/tui-backend.js';
export { TuiBackend } from './backend/tui-backend.js';
