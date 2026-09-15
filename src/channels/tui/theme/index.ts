/**
 * TUI 主题面聚合（07 §4.1 引擎节件 3 R2——批 10g 目录化：原单文件 theme.ts
 * 拆五件——语义键 / 色板 / 解析 / 探测 / 会话区分色）。
 *
 * 消费纪律：组件**只认 ResolvedTheme**（构造注入 + setTheme 换装），源色板
 * 与降采不进组件；accent 载体清单见 semantic 件头注。
 */
export type { SemanticKey, SemanticPalette, ThemeSetting } from './semantic.js';
export { SEMANTIC_KEYS } from './semantic.js';
export type { BuiltinPalette } from './palette.js';
export { builtinPalette, DARK_PALETTE, LIGHT_PALETTE } from './palette.js';
export type { ColorDepth, ResolvedTheme } from './resolve.js';
export { DEFAULT_THEME, resolveTheme } from './resolve.js';
export type { ColorEnv } from './detect.js';
export { detectColorDepth, isDarkBackground, paletteForBackground, parseOsc11Reply } from './detect.js';
export { sessionColor } from './session-color.js';
