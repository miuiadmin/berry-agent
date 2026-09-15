/**
 * 高亮语言数据表（07 §4.1 R1 自研轻量词法器——批 10h）。
 *
 * 12 常用语言 × 五类 token（keyword / string / comment / number / function）。
 * 纯数据件：只描语言形（注释定界符、引号形、关键字集），扫描算法归 scan.ts
 * 单源。覆盖语言外**诚实退单色**——不发明半高亮（R1 分句原文）。
 *
 * 关键字集取各语言核心常用词（非全规范词表——轻量子集的刻意裁剪）；
 * 函数名类走「标识符后随 `(`」通用判据（js/ts/python/go），shell/sql 形
 * 不合该判据故关。
 */
import type { LanguageSpec } from './scan.js';

/** 关键字空白串 → Set（表载体紧凑形） */
function kw(text: string): ReadonlySet<string> {
  return new Set(text.split(/\s+/).filter((w) => w !== ''));
}

/** 语言表构造简写（缺省：无注释无引号无函数判据——逐字段覆写） */
function lang(over: Partial<Omit<LanguageSpec, 'keywords'>> & { keywords: string }): LanguageSpec {
  return {
    keywords: kw(over.keywords),
    ci: over.ci ?? false,
    lineComment: over.lineComment ?? [],
    blockComment: over.blockComment ?? [],
    stringQuotes: over.stringQuotes ?? [],
    tripleQuotes: over.tripleQuotes ?? [],
    functionCall: over.functionCall ?? false,
    identColonKey: over.identColonKey ?? false,
    linePrefixKeyword: over.linePrefixKeyword ?? false,
  };
}

/** TS / TSX（JS 超集——JS 词并入） */
export const TS_SPEC: LanguageSpec = lang({
  keywords: `abstract any as asserts async await boolean break case catch class const continue debugger
    declare default delete do else enum export extends false finally for from function get if implements
    import in infer instanceof interface is keyof let module namespace never new null number object of
    package private protected public readonly require return satisfies set static string super switch
    symbol this throw true try type typeof undefined union unknown var void while with yield
    console`,
  lineComment: ['//'],
  blockComment: [['/*', '*/']],
  stringQuotes: ["'", '"', '`'],
  functionCall: true,
});

/** JS / JSX（TS 子集——类型位词剥除） */
export const JS_SPEC: LanguageSpec = lang({
  keywords: `async await boolean break case catch class const continue debugger default delete do else
    export extends false finally for from function get if import in instanceof let new null of return
    set static super switch this throw true try typeof undefined var void while with yield
    console`,
  lineComment: ['//'],
  blockComment: [['/*', '*/']],
  stringQuotes: ["'", '"', '`'],
  functionCall: true,
});

/** JSON（三字面量即全部关键字——键位天然是字符串类） */
export const JSON_SPEC: LanguageSpec = lang({
  keywords: 'true false null',
  stringQuotes: ['"'],
});

/** Python（三引号跨行串 + # 行注释；内建函数走 ident+( 判据） */
export const PYTHON_SPEC: LanguageSpec = lang({
  keywords: `and as assert async await break class continue def del elif else except False finally for
    from global if import in is lambda None nonlocal not or pass raise return True try while with yield
    self cls print len range str int float dict list set tuple open type isinstance enumerate zip map
    filter sorted min max sum abs round super`,
  lineComment: ['#'],
  stringQuotes: ["'", '"'],
  tripleQuotes: ['"""', "'''"],
  functionCall: true,
});

/** Bash / Shell / Zsh（控制词 + 高频命令词并集；函数判据不合 shell 形故关） */
export const BASH_SPEC: LanguageSpec = lang({
  keywords: `if then else elif fi for while until do done case esac function return in select time
    local export readonly declare typeset unset shift source alias echo eval exec exit read set trap
    test true false cd pushd popd pwd ls cp mv rm mkdir rmdir touch cat grep sed awk find xargs sort
    uniq head tail wc chmod chown chgrp ln tar gzip gunzip zip unzip ssh scp curl wget git npm npx
    node python python3 pip pip3 printf`,
  lineComment: ['#'],
  stringQuotes: ['"', "'"],
});

/** SQL（关键字大小写不敏感；-- 行注释 + C 形块注释对） */
export const SQL_SPEC: LanguageSpec = lang({
  keywords: `select from where and or not null is in like between as on inner left right full outer
    join group by order having limit offset distinct union all insert into values update set delete
    create table drop alter index view primary key foreign references default check unique constraint
    begin commit rollback transaction case when then else end exists asc desc with recursive
    returning count sum avg min max true false integer int text varchar boolean timestamp date json
    blob real serial`,
  ci: true,
  lineComment: ['--'],
  blockComment: [['/*', '*/']],
  stringQuotes: ["'", '"'],
});

/** YAML（键位 ident: → keyword；# 行注释） */
export const YAML_SPEC: LanguageSpec = lang({
  keywords: 'true false null yes no on off',
  lineComment: ['#'],
  stringQuotes: ["'", '"'],
  identColonKey: true,
});

/** Go */
export const GO_SPEC: LanguageSpec = lang({
  keywords: `break case chan const continue default defer else fallthrough for func go goto if import
    interface map package range return select struct switch type var nil true false iota error any
    string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64
    complex64 complex128 byte rune bool append cap close copy delete imag len make new panic print
    println real recover`,
  lineComment: ['//'],
  blockComment: [['/*', '*/']],
  stringQuotes: ['"', "'", '`'],
  functionCall: true,
});

/** Rust */
export const RUST_SPEC: LanguageSpec = lang({
  keywords: `as async await break const continue crate dyn else enum extern false fn for if impl in
    let loop match mod move mut pub ref return self static struct super trait true type unsafe use
    where while i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 usize isize f32 f64 str bool char String
    Vec Option Result Box Some None Ok Err println vec format panic assert`,
  lineComment: ['//'],
  blockComment: [['/*', '*/']],
  stringQuotes: ['"'],
  functionCall: true,
});

/** CSS（属性 + 高频取值并集——轻量子集；数字含单位由数字正则收尾） */
export const CSS_SPEC: LanguageSpec = lang({
  keywords: `color background background-color margin margin-top margin-right margin-bottom margin-left
    padding padding-top padding-right padding-bottom padding-left border border-radius border-color
    display position top right bottom left width height min-width max-width min-height max-height
    flex flex-direction flex-wrap flex-grow flex-shrink justify-content align-items align-self gap
    grid grid-template-columns grid-template-rows font font-size font-weight font-family text-align
    text-decoration line-height overflow overflow-x overflow-y z-index opacity transition transform
    cursor box-shadow content visibility white-space list-style important absolute relative fixed
    sticky static block inline-block inline-flex inline-grid grid flexbox none auto inherit initial
    unset solid dotted dashed pointer default px em rem vh vw s ms deg`,
  blockComment: [['/*', '*/']],
  stringQuotes: ['"', "'"],
});

/** HTML / XML（标签名 + 高频属性词并集——通用扫描器的近似形） */
export const HTML_SPEC: LanguageSpec = lang({
  keywords: `html head body div span p a img ul ol li table thead tbody tr td th form input button
    label select option textarea script style link meta title header footer nav main section article
    aside details summary figure figcaption code pre blockquote strong em hr br iframe video audio
    source canvas svg path g rect circle class id href src type name value placeholder required
    async defer charset content rel media`,
  blockComment: [['<!--', '-->']],
  stringQuotes: ['"', "'"],
});

/** Markdown（行首结构前缀 → keyword；` 码段 → string；<!-- --> 注释） */
export const MARKDOWN_SPEC: LanguageSpec = lang({
  keywords: '',
  blockComment: [['<!--', '-->']],
  stringQuotes: ['`'],
  linePrefixKeyword: true,
});
