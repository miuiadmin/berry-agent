/**
 * TUI 实装出口面（07 篇 §4.1 引擎节件 6（组件与呈现装配件）——UiBackend 实装的件外可见位）。
 *
 * 唯一件外消费方 = channels 公开面（index.ts 再出 TuiBackend 供批 12 host
 * 装配消费）；组件族（theme/layout/text/editor/scroll/overlay/autocomplete/
 * markdown/status/panels）件内消费走 sibling 直连（TuiBackend 实装侧），不
 * 预聚合。件外（其他模块）只准走 channels 公开面三名（02 §4.3 契约面执法
 * ——tui/ 同 engine/ 一样是非公开面，api 快照不进本面）。本面随真实件外
 * 消费扩。
 */
export type { TuiBackendOptions } from './backend/tui-backend.js';
export { TuiBackend } from './backend/tui-backend.js';
// 补全源族（批 12e host 装配消费——@ 文件段源与注入面类型；组件族余者仍件内）
export { FileMentionSource } from './autocomplete/file-mentions.js';
export type { FileMentionSourceOptions } from './autocomplete/file-mentions.js';
export type { AutocompleteSources } from './autocomplete/autocomplete.js';
export type { AutocompleteItem } from './autocomplete/provider.js';
