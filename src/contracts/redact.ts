/**
 * 出口治理③ 凭据消毒（04 §7 执行段 2026-09-08 落码定形——出口层 redaction
 * 纯函数单源；c-4 泄漏面净化④「server 工具结果回显 env 值」的收口批）。
 *
 * 词汇面与词面单源纪律（env-ref.ts 同先例）：放 contracts 使两消费方零新
 * DAG 边——tools 管道链尾（模式 + 值基两腿）与 agent 错误包装位（纯模式
 * 腿——错误即结果 ⑤ 与正常结果同一出口语义）。纯函数零依赖零状态，jiti
 * 可载。
 *
 * 两腿：
 * - **模式腿**（`redactSensitiveText`）：闭集正则三段——URL userinfo 剥离 /
 *   URL query 敏感参数值剥离 / 敏感键名值脱敏（赋值形覆盖裸 =、:、JSON
 *   引号形与 Authorization 头整行特例）。无外部数据依赖、恒在场。
 * - **值基腿**（`redactKnownSecretValues` + `redactToolResultExit`）：装配
 *   注入 credentials 库活值 provider——具名形态外的裸值回显收口；provider
 *   缺席 = 纯模式执法（降级诚实）。
 *
 * 非静默原则（截断注记同律）：消毒以 `[REDACTED:<reason>]` 注记进上下文
 * ——模型可见有物被消，非凭空篡改。幂等：注记自身不构成再触发形（回调内
 * 显式判已注记即跳过）。
 */

import type { AgentToolResult } from './tools.js';

/** 消毒注记前缀（形如 `[REDACTED:<reason>]`——幂等判定的锚） */
const MARK = '[REDACTED:';

/** URL query 敏感参数名闭集（小写单源；匹配大小写不敏感） */
const QUERY_TOKEN_PARAMS = [
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'api_key',
  'apikey',
  'token',
  'secret',
  'password',
  'passwd',
  'signature',
  'sig',
  'key',
] as const;

/** 敏感键名分段闭集（键名按 -_. 分段、**末段**命中即敏感；小写单源） */
const SENSITIVE_NAME_SEGMENTS = new Set([
  'token',
  'tokens',
  'secret',
  'secrets',
  'password',
  'passwords',
  'passwd',
  'pass',
  'pwd',
  'apikey',
  'key',
  'keys',
  'credential',
  'credentials',
  'signature',
  'auth',
  'authorization',
  'bearer',
]);

/** 正则元字符转义（闭集参数名拼接进 alternation 前的安全化） */
function escapeRe(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/** 值是否已是消毒注记（幂等跳过锚） */
function isMarked(value: string): boolean {
  return value.startsWith(MARK);
}

/**
 * 键名是否敏感（**末段**判据——GITHUB_TOKEN / aws_secret_access_key / api-key
 * 同判；末段判控制误伤面：token_type / token_url / secret_name 之类「敏感词
 * 作前缀修饰、末段为中性词」的公开字段不触发）。
 */
function isSensitiveName(name: string): boolean {
  const segments = name
    .toLowerCase()
    .split(/[-_.]+/)
    .filter((seg) => seg.length > 0);
  const last = segments[segments.length - 1];
  return last !== undefined && SENSITIVE_NAME_SEGMENTS.has(last);
}

/**
 * URL query 敏感参数值剥离正则（`?token=…` / `&api_key=…`——参数名精确段
 * 匹配：`[?&]` 前锚 + `=` 后锚，`token_type` 之类前缀词不误伤）。
 */
const QUERY_TOKEN_RE = new RegExp(`([?&])(${QUERY_TOKEN_PARAMS.map(escapeRe).join('|')})(=)([^&\\s#'"]*)`, 'gi');

/**
 * URL userinfo 剥离正则（`scheme://user:pass@`——冒号对形才命中，裸用户名
 * 形不触发）。值两段排除 `[`：消毒注记形 `[REDACTED:...]` 不被当 user:pass
 * 二次剥离（幂等锚的一环）。
 */
const URL_USERINFO_RE = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s"'<>@/[]+):([^\s"'<>@/[]+)@/g;

/** Authorization 头整行特例（值含空格——`Bearer xyz` 裸赋值形只截到首词，特例整行收口） */
const AUTHORIZATION_RE = /\b(proxy-authorization|authorization)(\s*[=:]\s*)([^\r\n]+)/gi;

/**
 * 通用赋值形正则：名字（裸词 / 引号词）+ 分隔（= 或 :）+ 值（引号串或裸串）。
 * 敏感性与否经回调判名（分段闭集）——正则只负责形，语义在回调。
 */
const ASSIGNMENT_RE =
  /("[A-Za-z][A-Za-z0-9_.-]*"|[A-Za-z][A-Za-z0-9_.-]*)(\s*[=:]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;"'`&\]}]+)/g;

/** 键名提取（剥引号——JSON 形 `"api_key"` 与裸形 `api_key` 同判） */
function bareName(raw: string): string {
  return raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw;
}

/** 值替换形（保引号——JSON 形消毒产物仍是合法引号串） */
function markedValue(raw: string): string {
  if (raw.startsWith('"')) return '"[REDACTED:secret]"';
  if (raw.startsWith("'")) return "'[REDACTED:secret]'";
  return '[REDACTED:secret]';
}

/**
 * 模式腿：出口文本消毒（04 §7 出口治理③模式集三段——纯函数、幂等、恒在场）。
 *
 * 覆盖面（闭集、大小写不敏感）：URL userinfo / URL query 敏感参数值 /
 * 敏感键名赋值值（含 Authorization 头整行特例）。通用赋值形值长 < 4 跳过
 * （散文冒号误伤面控制——"the token: is" 不触发；URL 两段上下文无歧义不设此阈）。
 */
export function redactSensitiveText(text: string): string {
  // 段序：userinfo → query → Authorization → 通用赋值（特例先于通例——
  // Authorization 整行形若先被通例截短即漏尾词）
  let out = text.replace(URL_USERINFO_RE, '$1[REDACTED:url-userinfo]@');
  out = out.replace(QUERY_TOKEN_RE, (full, q: string, name: string, eq: string, value: string) =>
    isMarked(value) ? full : `${q}${name}${eq}[REDACTED:query-token]`,
  );
  out = out.replace(AUTHORIZATION_RE, (full, name: string, sep: string, value: string) =>
    isMarked(value.trimStart()) ? full : `${name}${sep}[REDACTED:credential]`,
  );
  return redactAssignments(out);
}

/**
 * 通用赋值形消毒（redactSensitiveText 第四段本体——独立函数供值内递归）。
 * 非敏感名命中不吞段：裸值字符类允许 = 与全/半角冒号，形如
 * `Error: 命令失败：GITHUB_TOKEN=x` 的前缀对会把后续敏感对并进自己的值区
 * （正则消费区不再访）——值内递归再扫收口。递归操作于严格更短子串，深度
 * 有界。
 */
function redactAssignments(text: string): string {
  return text.replace(ASSIGNMENT_RE, (full, rawName: string, sep: string, rawValue: string) => {
    if (isMarked(rawValue)) return full;
    if (!isSensitiveName(bareName(rawName))) {
      return `${rawName}${sep}${redactAssignments(rawValue)}`;
    }
    // 裸值过短跳过（散文误伤阈——引号值不设阈：引号形即结构化语境）
    if (!/["']/.test(rawValue[0] ?? '') && rawValue.length < 4) return full;
    return `${rawName}${sep}${markedValue(rawValue)}`;
  });
}

/**
 * 值基腿：已知秘密活值整段置换（split/join 字面替换——值含正则元字符安全）。
 *
 * 长值先换（前缀包含关系下短值先换会破坏长值锚）；长度 < 8 不参与（短值
 * 误伤普通文本的灾难面控制——04 §7 定形⑤）。provider 给值已是明文（装配
 * 侧 credentials 库 live 读——本函数恒不取库，纯数据进出）。
 */
export function redactKnownSecretValues(text: string, values: readonly string[]): string {
  const eligible = values.filter((v): v is string => typeof v === 'string' && v.length >= 8 && !v.includes(MARK));
  const ordered = [...new Set(eligible)].sort((a, b) => b.length - a.length);
  let out = text;
  for (const value of ordered) {
    if (!out.includes(value)) continue;
    out = out.split(value).join('[REDACTED:credential]');
  }
  return out;
}

/** 两腿合流（值基先行——名形留下具名注记，模式腿补裸形） */
function redactAll(text: string, values: readonly string[]): string {
  return redactSensitiveText(redactKnownSecretValues(text, values));
}

/** details 深走上限（防御深度——病态深构不递归失控） */
const DETAILS_DEPTH_CAP = 8;

/** details 字符串叶消毒（结构保形——只改字符串叶，数与布尔不动） */
function redactDetails(node: unknown, values: readonly string[], depth: number, seen: Set<object>): void {
  if (depth > DETAILS_DEPTH_CAP) return;
  if (typeof node === 'string') return; // 字符串非对象——叶替换在调用处（readonly 容器内就地不可行，见下）
  if (node === null || typeof node !== 'object') return;
  if (seen.has(node)) return; // 环防御（details 是工具产物，理论纯 JSON——防御位）
  seen.add(node);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const item = node[i];
      if (typeof item === 'string') node[i] = redactAll(item, values);
      else redactDetails(item, values, depth + 1, seen);
    }
    return;
  }
  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value === 'string') {
      // 对象键名敏感即整值脱敏（c-4 ④ 本体形态：结构化明细里敏感键携裸值——
      // 字符串叶内无键名形可匹配，模式正则够不着；键名即结构化语境的赋值形，
      // JSON 引号形的内存对偶，同律不设值阈）
      record[key] = isSensitiveName(key) ? '[REDACTED:secret]' : redactAll(value, values);
    } else if (value !== null && typeof value === 'object') redactDetails(value, values, depth + 1, seen);
  }
}

/**
 * 工具结果出口消毒（管道链尾调用——04 §7 定形①：护栏之前一步）。
 *
 * 就地改写：文本 content 逐块消毒（图片等自有界块原样保留——与输出护栏
 * 同判据）；details 深走字符串叶消毒（结构化明细同是 server 回显面）。
 * 纯模式 + 值基两腿合流；provider 调用方恒传数组（装配闭包 live 读）。
 */
export function redactToolResultExit(result: AgentToolResult, sensitiveValues: readonly string[]): void {
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        block.text = redactAll(block.text, sensitiveValues);
      }
    }
  }
  if (result.details !== undefined && result.details !== null && typeof result.details === 'object') {
    redactDetails(result.details, sensitiveValues, 0, new Set());
  }
}
