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
// 主题面（批 10g——host tui-entry 消费：settings.theme → TuiBackendOptions.theme；
// /themes 批扩自定义文件面——tui-entry 装配下装与副屏条目两消费位）
export type { ColorEnv, PartialSemanticPalette, ThemeSetting } from './theme/index.js';
export { isValidCustomThemeName, listCustomThemeNames, loadCustomThemeColors } from './theme/index.js';
// 补全源族（批 12e host 装配消费——@ 文件段源与注入面类型；组件族余者仍件内）
export { FileMentionSource } from './autocomplete/file-mentions.js';
export type { FileMentionSourceOptions } from './autocomplete/file-mentions.js';
export type { AutocompleteSources } from './autocomplete/autocomplete.js';
export type { AutocompleteItem } from './autocomplete/provider.js';
// 高度帽公式（R3 批 10j——host 装配位 maxVisibleLines 注入单源）
export { editorHeightCap } from './editor/height-cap.js';
// fuzzy 子序列过滤（R6 批 10j——命令名 / @ 文件段两源装配消费）
export { fuzzyFilter, isSubsequence, fuzzyMatchKind } from './autocomplete/fuzzy.js';
// 市场选装面板模型三类型（03 §9.6 mp-5——openMarketplace 签名面：host 侧
// 编舞 face（marketplace-tui-face）持模型/动作面构造注入；面板件本体仍件内
// 消费不出面——本面只出类型三名）
export type { MarketEntryRow, MarketPanelModel, MarketPanelActions } from './panels/market-picker.js';
