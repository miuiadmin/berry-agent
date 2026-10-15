/**
 * 高亮件聚合出口（07 §4.1 R1——批 10h）。
 *
 * `highlight(code, language)` 全量入口 + `tokenizeLine(line, spec, carryIn)`
 * 增量单行入口（41 轮件 II——开栏代码块逐行续算；同 transducer 单源）。
 * 未知语言 `resolveSpec` 返 **null**（消费方诚实退单色——不发明半高亮）。
 * 围栏开栏期经 tokenizeLine 增量高亮（闭栏才走 highlight 全量——流式防
 * 闪烁律在消费方 markdown 件）。
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

export type { CarryState, HighlightToken, LanguageSpec, TokenType } from './scan.js';
export { tokenize, tokenizeLine, tokenStyle } from './scan.js';

/** 别名 → 语言表（键 = 小写归一形；表本体 languages.ts 单源） */
const ALIASES: Readonly<Record<string, LanguageSpec>> = {
  ts: TS_SPEC,
  tsx: TS_SPEC,
  typescript: TS_SPEC,
  mts: TS_SPEC,
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
  htm: HTML_SPEC,
  xml: HTML_SPEC,
  svg: HTML_SPEC,
};

/**
 * 语言名/别名归一 → 语言表（未知语言 null——退单色判据）。
 *
 * 41 轮件 II 起公开：开栏增量消费方（block-rows 开栏路）与全量 highlight
 * 同一归一单源。归一形：去空白 + 小写（` ` `` ```ts ``、`TypeScript` 同达）。
 */
export function resolveSpec(language: string | undefined): LanguageSpec | null {
  if (language === undefined) return null;
  return ALIASES[language.trim().toLowerCase()] ?? null;
}

/**
 * 代码 → token 流（未知语言 null——退单色判据；闭栏全量路）。
 */
export function highlight(code: string, language: string | undefined): HighlightToken[] | null {
  const spec = resolveSpec(language);
  return spec === null ? null : tokenize(code, spec);
}

/**
 * 路径 → 高亮语言名（挖掘 39 轮件 I——diff 段体语法着色入口）：末点扩展名
 * 小写**直查 ALIASES**（键域本混容扩展名键——tsx/mjs/cjs/py/sh/yml/rs 在册；
 * 命中即返回键名本身作 language 形，一跳零新表）。无点/首点隐藏文件形/未知
 * 扩展名返 undefined——消费方诚实退现状零行为变（不发明半高亮）。
 */
export function languageForPath(path: string): string | undefined {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const base = path.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return undefined; // 无扩展名 / 首点形（.gitignore 族）缺席
  const ext = base.slice(dot + 1).toLowerCase();
  return ALIASES[ext] === undefined ? undefined : ext;
}
