/**
 * 高亮词法扫描件（07 §4.1 R1——批 10h）。
 *
 * 通用行扫描器：按 LanguageSpec 数据表驱动，五类 token 收敛（keyword /
 * string / comment / number / function），plain 段弥合成流——token 文本
 * 串接恒等于原文（消费方按原文回放布局，零丢字律）。跨行构造（块注释、
 * Python 三引号串）经 carry 状态跨行承载；单引号串未闭吃行尾**不跨行**
 * （多数语言字符串不跨行的诚实近似）。
 *
 * 判据序（命中即让）：行首结构前缀 → 行注释 → 块注释 → 三引号 → 单引号
 * 串 → 数字 → 标识符（关键字 / 键位 / 函数名三判）→ 单字符。
 */
import type { CellStyle } from '../../../engine/index.js';
import type { ResolvedTheme } from '../../theme/index.js';

/** token 五类（'plain' 非类——弥合原文用） */
export type TokenType = 'keyword' | 'string' | 'comment' | 'number' | 'function';

/** 高亮 token（text 恒为原文切片） */
export interface HighlightToken {
  readonly type: TokenType | 'plain';
  readonly text: string;
}

/** 语言形数据表（languages.ts 为唯一产地） */
export interface LanguageSpec {
  /** 关键字集（ci 档按小写比对） */
  readonly keywords: ReadonlySet<string>;
  /** 关键字大小写不敏感（sql） */
  readonly ci: boolean;
  /** 行注释开场（最长优先逐试） */
  readonly lineComment: readonly string[];
  /** 块注释定界对 [开, 闭]（跨行 carry） */
  readonly blockComment: readonly (readonly [string, string])[];
  /** 单行字符串引号形（转义 \\x 承纳；未闭吃行尾） */
  readonly stringQuotes: readonly string[];
  /** 三引号串形（跨行 carry——python） */
  readonly tripleQuotes: readonly string[];
  /** 标识符后随空白与 ( → function（js/ts/python/go 形） */
  readonly functionCall: boolean;
  /** 标识符紧贴 : → keyword（yaml 键位） */
  readonly identColonKey: boolean;
  /** 行首结构前缀（#标题 / > 引用 / -*+ 列表）→ keyword（markdown） */
  readonly linePrefixKeyword: boolean;
}

/** token 类 → 主题键（五类各一键——semantic 件键面单源） */
const TOKEN_THEME_KEY: Readonly<
  Record<TokenType, 'codeKeyword' | 'codeString' | 'codeComment' | 'codeNumber' | 'codeFunction'>
> = {
  keyword: 'codeKeyword',
  string: 'codeString',
  comment: 'codeComment',
  number: 'codeNumber',
  function: 'codeFunction',
};

/** token 类 → CellStyle 前景（主题注入单点——markdown 渲染位消费） */
export function tokenStyle(type: TokenType, theme: Readonly<ResolvedTheme>): Readonly<CellStyle> {
  return { fg: theme[TOKEN_THEME_KEY[type]] };
}

/** 行首结构前缀（markdown 专用——限 spec.linePrefixKeyword 开） */
const PREFIX_RE = /^[ \t]{0,3}(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t])/;
/** 数字（十六/八/二进制前缀形 + 小数 + 指数；CSS 百分号/单位尾随归 plain） */
const NUMBER_RE = /(?:0[xXoObB][0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)/y;
/** 标识符（ASCII——轻量子集不含 unicode 标识语言） */
const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/y;
/** 行内空白游程（plain 弥合批量吞） */
const WS_RE = /[ \t]+/y;

/** 跨行承载态（块注释 / 三引号串——行首先收尾部再回常规扫描） */
interface Carry {
  readonly type: 'comment' | 'string';
  readonly end: string;
}

/** sticky 正则定位执行（lastIndex 由调用方归零——无共享态残留） */
function stickyMatch(re: RegExp, at: string): string | null {
  re.lastIndex = 0;
  const m = re.exec(at);
  return m === null ? null : m[0]!;
}

/**
 * 词法扫描主入口：代码全文 → token 流（串接恒等原文）。
 */
export function tokenize(code: string, spec: LanguageSpec): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  const push = (type: HighlightToken['type'], text: string): void => {
    if (text === '') return;
    const last = tokens.length > 0 ? tokens[tokens.length - 1]! : undefined;
    // 相邻同类弥合（含 plain——消费方按类分桶时免碎片）
    if (last !== undefined && last.type === type) {
      tokens[tokens.length - 1] = { type, text: last.text + text };
      return;
    }
    tokens.push({ type, text });
  };

  const lines = code.split('\n');
  let carry: Carry | null = null;
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln]!;
    let i = 0;
    // 跨行承载先行：找闭定界——命中回常规扫描，未闭整行入类
    if (carry !== null) {
      const end = line.indexOf(carry.end);
      if (end === -1) {
        push(carry.type, line);
        i = line.length;
      } else {
        push(carry.type, line.slice(0, end + carry.end.length));
        i = end + carry.end.length;
        carry = null;
      }
    }
    let atLineStart = true;
    while (i < line.length) {
      const rest = line.slice(i);
      // 行首结构前缀（markdown 标题/引用/列表标记——前导空白归 plain）
      if (atLineStart && spec.linePrefixKeyword) {
        const m = PREFIX_RE.exec(rest);
        if (m !== null) {
          const marker = m[1]!;
          push('plain', rest.slice(0, m[0].length - marker.length));
          push('keyword', marker);
          i += m[0].length;
          atLineStart = false;
          continue;
        }
      }
      atLineStart = false;
      // 行注释：余行整段收
      let matched = false;
      for (const opener of spec.lineComment) {
        if (rest.startsWith(opener)) {
          push('comment', rest);
          i = line.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      // 块注释：同行闭则段内收，未闭 carry 跨行
      for (const [open, close] of spec.blockComment) {
        if (rest.startsWith(open)) {
          const end = rest.indexOf(close, open.length);
          if (end === -1) {
            push('comment', rest);
            carry = { type: 'comment', end: close };
            i = line.length;
          } else {
            push('comment', rest.slice(0, end + close.length));
            i += end + close.length;
          }
          matched = true;
          break;
        }
      }
      if (matched) continue;
      // 三引号串（先于单引号——''' 含 ' 前缀撞车）
      for (const quote of spec.tripleQuotes) {
        if (rest.startsWith(quote)) {
          const end = rest.indexOf(quote, quote.length);
          if (end === -1) {
            push('string', rest);
            carry = { type: 'string', end: quote };
            i = line.length;
          } else {
            push('string', rest.slice(0, end + quote.length));
            i += end + quote.length;
          }
          matched = true;
          break;
        }
      }
      if (matched) continue;
      // 单行字符串：转义承纳；未闭吃行尾不跨行
      for (const quote of spec.stringQuotes) {
        if (rest.startsWith(quote)) {
          let j = quote.length;
          let closed = false;
          while (j < rest.length) {
            if (rest[j] === '\\') {
              j += 2;
              continue;
            }
            if (rest.startsWith(quote, j)) {
              j += quote.length;
              closed = true;
              break;
            }
            j++;
          }
          push('string', closed ? rest.slice(0, j) : rest);
          i += closed ? j : rest.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      // 数字
      const num = stickyMatch(NUMBER_RE, rest);
      if (num !== null) {
        push('number', num);
        i += num.length;
        continue;
      }
      // 标识符：关键字 → 键位 → 函数名 → plain 三判
      const name = stickyMatch(IDENT_RE, rest);
      if (name !== null) {
        const probe = spec.ci ? name.toLowerCase() : name;
        const after = rest.slice(name.length);
        if (spec.keywords.has(probe)) push('keyword', name);
        else if (spec.identColonKey && after.startsWith(':')) push('keyword', name);
        else if (spec.functionCall && /^\s*\(/.test(after)) push('function', name);
        else push('plain', name);
        i += name.length;
        continue;
      }
      // 空白游程批量吞（省逐字符 plain 碎片）
      const ws = stickyMatch(WS_RE, rest);
      if (ws !== null) {
        push('plain', ws);
        i += ws.length;
        continue;
      }
      push('plain', rest[0]!);
      i += 1;
    }
    // 行界弥合（末行无换行——串接恒等原文律）
    if (ln < lines.length - 1) push('plain', '\n');
  }
  return tokens;
}
