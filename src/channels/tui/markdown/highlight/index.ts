/**
 * 高亮件聚合出口（07 §4.1 R1——批 10h）。
 *
 * `highlight(code, language)` 唯一入口：语言别名归一 → 数据表 → tokenize。
 * 未知语言返 **null**（消费方诚实退单色——不发明半高亮）。围栏**开栏期不
 * 高亮**（闭栏才进本件——流式防闪烁律在消费方 markdown 件）。
 */
import { tokenize } from './scan.js';
import type { HighlightToken, LanguageSpec } from './scan.js';
import {
  BASH_SPEC,
  CSS_SPEC,
  GO_SPEC,
  HTML_SPEC,
  JS_SPEC,
  JSON_SPEC,
  MARKDOWN_SPEC,
  PYTHON_SPEC,
  RUST_SPEC,
  SQL_SPEC,
  TS_SPEC,
  YAML_SPEC,
} from './languages.js';

export type { HighlightToken, LanguageSpec, TokenType } from './scan.js';
export { tokenize, tokenStyle } from './scan.js';

/** 别名 → 语言表（键 = 小写归一形；表本体 languages.ts 单源） */
const ALIASES: Readonly<Record<string, LanguageSpec>> = {
  ts: TS_SPEC,
  tsx: TS_SPEC,
  typescript: TS_SPEC,
  js: JS_SPEC,
  jsx: JS_SPEC,
  javascript: JS_SPEC,
  mjs: JS_SPEC,
  cjs: JS_SPEC,
  json: JSON_SPEC,
  jsonc: JSON_SPEC,
  python: PYTHON_SPEC,
  py: PYTHON_SPEC,
  python3: PYTHON_SPEC,
  bash: BASH_SPEC,
  sh: BASH_SPEC,
  shell: BASH_SPEC,
  zsh: BASH_SPEC,
  console: BASH_SPEC,
  markdown: MARKDOWN_SPEC,
  md: MARKDOWN_SPEC,
  sql: SQL_SPEC,
  psql: SQL_SPEC,
  mysql: SQL_SPEC,
  sqlite: SQL_SPEC,
  yaml: YAML_SPEC,
  yml: YAML_SPEC,
  go: GO_SPEC,
  golang: GO_SPEC,
  rust: RUST_SPEC,
  rs: RUST_SPEC,
  css: CSS_SPEC,
  scss: CSS_SPEC,
  less: CSS_SPEC,
  html: HTML_SPEC,
  xml: HTML_SPEC,
  svg: HTML_SPEC,
};

/**
 * 代码 → token 流（未知语言 null——退单色判据）。
 *
 * 语言形归一：去空白 + 小写（` ` `` ```ts ``、`TypeScript` 同达）。
 */
export function highlight(code: string, language: string | undefined): HighlightToken[] | null {
  if (language === undefined) return null;
  const spec = ALIASES[language.trim().toLowerCase()];
  return spec === undefined ? null : tokenize(code, spec);
}

/** 语言可高亮判据（消费方选路用——避免空 token 流试探） */
export function isHighlightable(language: string | undefined): boolean {
  if (language === undefined) return false;
  return ALIASES[language.trim().toLowerCase()] !== undefined;
}
