/**
 * 自研高亮器测试（批 10h——纯函数直锁）。
 *
 * 覆盖：串接恒等原文律（零丢字——消费方按原文回放布局的前提）、五类
 * token 判例、跨行 carry（块注释 / 三引号串）、单行串未闭吃行尾不跨行、
 * 语言别名归一、未知语言诚实 null、tokenStyle 主题键映射。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../../theme/index.js';
import { highlight, tokenize, tokenStyle } from './index.js';
import { JS_SPEC, PYTHON_SPEC, TS_SPEC, YAML_SPEC } from './languages.js';

/** 精确文本找 token（非 plain 类断言用——plain 有弥合不在此断言） */
function tokenOf(tokens: ReturnType<typeof tokenize>, text: string) {
  return tokens.find((t) => t.text === text);
}

/** 多语言串接恒等原文律样本 */
const FIDELITY_SAMPLES: ReadonlyArray<readonly [string, string]> = [
  ['ts', 'const x = 42; // 注释\nfoo(1); "str \'esc\'" `t`'],
  ['js', 'let x = 42; // c\nfn(`t`)'],
  ['python', 'def f(a):\n    """doc\n    string"""\n    return None # c'],
  ['bash', 'echo "hi" # c\nif [ -f x ]; then\n  ls\nfi'],
  ['sql', 'SELECT * FROM t WHERE a = 1 -- c'],
  ['yaml', 'name: bob # 注\nitems:\n  - true'],
  ['go', 'func main() {\n\tx := 0x1F // c\n}'],
  ['rust', 'fn main() {\n    let s = "中"; // c\n}'],
  ['css', 'a { color: #fff; /* c */ }'],
  ['html', '<div class="a"><!-- 注 --></div>'],
  ['markdown', '# 标题\n\n- 项 `code`\n\n> 引'],
  ['json', '{"a": [1, true, null, "s"]}'],
];

describe('highlight 自研高亮器', () => {
  it('串接恒等原文律（十二语言样本零丢字——按原文回放布局的前提）', () => {
    for (const [language, code] of FIDELITY_SAMPLES) {
      const tokens = highlight(code, language);
      expect(tokens, `语言 ${language} 应可高亮`).not.toBeNull();
      expect(tokens!.map((t) => t.text).join('')).toBe(code);
    }
  });

  it('五类 token 判例（ts：keyword/number/comment/function/string 各就位）', () => {
    const tokens = tokenize("const x = 42; // 注\nfoo(1); 's'", TS_SPEC);
    expect(tokenOf(tokens, 'const')?.type).toBe('keyword');
    expect(tokenOf(tokens, '42')?.type).toBe('number');
    expect(tokenOf(tokens, '// 注')?.type).toBe('comment');
    expect(tokenOf(tokens, 'foo')?.type).toBe('function'); // ident + ( → 函数名
    expect(tokenOf(tokens, "'s'")?.type).toBe('string');
    // 非关键字标识符归 plain（弥合律 plain 与相邻空白/符号并段——包含断言）
    expect(tokens.some((t) => t.type === 'plain' && t.text.includes('x'))).toBe(true);
  });

  it('JS 独立词表判据（js 别名同达 + JS_SPEC token 级：console=keyword、TS 类型位词剥除）', () => {
    // 别名面：js 短名 → JS_SPEC 可高亮（与 FIDELITY_SAMPLES 的 js 样本互补——
    // 此处进 token 级，样本只锁串接恒等）
    const viaAlias = highlight('let x = 1;', 'js');
    expect(viaAlias).not.toBeNull();
    expect(tokenOf(viaAlias!, 'let')?.type).toBe('keyword');
    // JS_SPEC 直测：console 入 JS 词表（runtime 调试词——与 TS_SPEC 同收）
    const tokens = tokenize('console.log("x")', JS_SPEC);
    expect(tokenOf(tokens, 'console')?.type).toBe('keyword');
    expect(tokenOf(tokens, '"x"')?.type).toBe('string');
    // 分辨形断言：TS 类型位词 interface 不入 JS 词表（JS_SPEC ≠ TS_SPEC 复述
    // ——TS 子集剥除即两词表分界的可红锚点）；plain 弥合并段用包含断言
    expect(tokenize('interface Foo {}', JS_SPEC).some((t) => t.type === 'plain' && t.text.includes('interface'))).toBe(
      true,
    );
    expect(tokenOf(tokenize('interface Foo {}', TS_SPEC), 'interface')?.type).toBe('keyword');
  });

  it('跨行 carry：块注释开于前行、闭后回常规扫描', () => {
    const tokens = tokenize('/* 开\n中间\n闭 */ const', TS_SPEC);
    expect(tokens.map((t) => t.text).join('')).toBe('/* 开\n中间\n闭 */ const');
    expect(tokens.some((t) => t.type === 'comment' && t.text.includes('中间'))).toBe(true);
    expect(tokenOf(tokens, 'const')?.type).toBe('keyword'); // 闭定界后 carry 出——后续常规扫描
  });

  it('跨行 carry：Python 三引号串（先于单引号——前缀撞车序）', () => {
    const tokens = tokenize('"""\na\n"""\nx = 1', PYTHON_SPEC);
    expect(tokens.map((t) => t.text).join('')).toBe('"""\na\n"""\nx = 1');
    expect(tokens.some((t) => t.type === 'string' && t.text.includes('a'))).toBe(true);
    expect(tokenOf(tokens, '1')?.type).toBe('number');
  });

  it('单行串未闭吃行尾不跨行（多数语言字符串不跨行的诚实近似）', () => {
    const tokens = tokenize("'abc\nconst", TS_SPEC);
    expect(tokenOf(tokens, "'abc")?.type).toBe('string'); // 未闭吃行尾
    expect(tokenOf(tokens, 'const')?.type).toBe('keyword'); // 次行常规扫描——无 carry
  });

  it('转义引号承纳（\\\\x 不闭串）', () => {
    const tokens = tokenize(`'a\\'b' x`, TS_SPEC);
    expect(tokenOf(tokens, `'a\\'b'`)?.type).toBe('string');
  });

  it('相邻同类弥合（碎片合并——消费方按类分桶免碎片）', () => {
    // 标识符 + 空白两段 plain 相邻 → 单段弥合
    expect(tokenize('abc def', TS_SPEC).filter((t) => t.type === 'plain')).toHaveLength(1);
    // 相邻同引号两串 `'a''b'` → 单 string 段
    expect(tokenize("'a''b'", TS_SPEC).filter((t) => t.type === 'string')).toHaveLength(1);
  });

  it('SQL 大小写不敏感（SELECT 大写形同 keyword）', () => {
    const tokens = highlight('SELECT x FROM t', 'sql');
    expect(tokenOf(tokens!, 'SELECT')?.type).toBe('keyword');
    expect(tokenOf(tokens!, 'FROM')?.type).toBe('keyword');
  });

  it('YAML 键位判据（ident 紧贴 : → keyword；值位 plain）', () => {
    const tokens = tokenize('name: bob', YAML_SPEC);
    expect(tokenOf(tokens, 'name')?.type).toBe('keyword');
    // ': ' 与 'bob' 相邻同类弥合为单 plain 段（包含断言）
    expect(tokens.some((t) => t.type === 'plain' && t.text.includes('bob'))).toBe(true);
  });

  it('Markdown 行首结构前缀 → keyword（标题/列表标记）', () => {
    const tokens = highlight('# 标题\n- 项', 'markdown');
    expect(tokens!.some((t) => t.type === 'keyword' && t.text === '# ')).toBe(true);
    expect(tokens!.some((t) => t.type === 'keyword' && t.text === '- ')).toBe(true);
  });

  it('别名归一：大小写/空白/长名同达', () => {
    expect(highlight('x', 'TypeScript')).not.toBeNull();
    expect(highlight('x', ' ts ')).not.toBeNull();
    expect(highlight('x', 'PY')).not.toBeNull();
  });

  it('未知语言诚实 null（不发明半高亮）', () => {
    expect(highlight('x', 'brainfuck')).toBeNull();
    expect(highlight('x', undefined)).toBeNull();
  });

  it('tokenStyle 五类各映主题键（fg 单源 = ResolvedTheme 高亮键族）', () => {
    expect(tokenStyle('keyword', DEFAULT_THEME)).toEqual({ fg: DEFAULT_THEME.codeKeyword });
    expect(tokenStyle('string', DEFAULT_THEME)).toEqual({ fg: DEFAULT_THEME.codeString });
    expect(tokenStyle('comment', DEFAULT_THEME)).toEqual({ fg: DEFAULT_THEME.codeComment });
    expect(tokenStyle('number', DEFAULT_THEME)).toEqual({ fg: DEFAULT_THEME.codeNumber });
    expect(tokenStyle('function', DEFAULT_THEME)).toEqual({ fg: DEFAULT_THEME.codeFunction });
  });
});
