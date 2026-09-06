/**
 * 渐进披露第三层细化三件（06 §11.3——2026-09-06 技术调研消化批增补）：
 *
 * ① 节级寻址——SKILL.md 按标题建节骨架（split_sections 形），深读可按祖先路径
 *    寻址节（'Mode 3 > Workflow' 式——只读命中节不读全文）；歧义多匹配报错
 *    不猜（猜错节的注入比不注入更坏——错误指导比无指导危害大）；
 * ② 薄主文件——作者侧范式（主文件只留触发+路由、深度进 references/），机制面
 *    仅此件：引用路径按 baseDir 解析的约定（read 路径消费，无新通道）；
 * ③ 行级过滤——命中注入前按运行参数行级过滤（ponytail filterSkillBodyForMode
 *    形：强度表行按模式名匹配、带引号防普通规则行误杀——一份本体服务多档）。
 *
 * 三层的成本纪律同 06 §11.3 总则：节骨架与路由行是常驻清单成本、深读仍按需
 * ——渐进披露 O(1) 不破（细化的是第三层「read 全文」的粒度，不动清单层）。
 */

/** 切分产物节（含正文——骨架化时由消费方丢弃 body 省内存） */
export interface SkillSection {
  /** 祖先路径（含本节标题，' > ' 连接） */
  readonly path: string;
  /** 标题级别 1-6 */
  readonly level: number;
  /** 标题文本（# 剥离后） */
  readonly title: string;
  /** 节正文（标题行之后到下一同级或更高级标题前，不含标题行） */
  readonly body: string;
  /** 标题行号（1 起，body 坐标系） */
  readonly startLine: number;
  /** 节末行号（含） */
  readonly endLine: number;
}

/** ATX 标题行（CommonMark 形：≤3 前导空格 + 1-6 个 # + 空白 + 文本；尾 # 串修剪） */
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/** 围栏代码块开栏行（``` 或 ~~~ ≥3 个；缩进 ≤3；fence 标记后的 info 串不参与判定） */
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

/** 闭栏行（CommonMark：闭栏只许 fence 字符 + 空白——```js 带 info 串不闭栏） */
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * 按标题切节（split_sections 形）。
 *
 * 围栏代码块内的 `#` 行不是标题（fence 追踪——同字符开关，``` 开 ``` 关）；
 * 节正文到下一「同级或更高级」标题前收口；首个标题之前的引导文本不产节
 * （无标题路径可寻址——引导文本随全文 read 路径在场，不丢内容）。
 * 同父同名兄弟标题会产出重复 path——寻址歧义由 findSkillSection 报不猜。
 */
export function splitSkillSections(body: string): SkillSection[] {
  const lines = body.split('\n');
  // 尾随换行的空串尾巴是切分伪影（'a\n'.split → ['a','']）——剥掉防末节 endLine 虚增
  if (lines.length > 0 && (lines[lines.length - 1] ?? '') === '') lines.pop();
  const sections: SkillSection[] = [];
  // 祖先栈：[{level, title}]——遇到 ≤ 栈顶级别的标题先弹栈再入栈
  const stack: { level: number; title: string }[] = [];
  let openFence: string | null = null; // 在栏 fence 字符（'```' / '~~~'）
  let current: { path: string; level: number; title: string; startLine: number } | null = null;
  let startBodyIndex = -1; // 当前节正文首行（含）

  const closeSection = (endLineExclusive: number): void => {
    if (current === null) return;
    // endLineExclusive 是 0 起半开区间右端——换 1 起含端恰为「末行行号」；
    // 空节（标题紧邻下一标题/文末）时退化为 startLine（标题行自身）
    const endLine = Math.max(endLineExclusive, current.startLine);
    sections.push({
      path: current.path,
      level: current.level,
      title: current.title,
      body: lines.slice(startBodyIndex, endLineExclusive).join('\n'),
      startLine: current.startLine,
      endLine,
    });
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (openFence !== null) {
      const closeMatch = FENCE_CLOSE_RE.exec(line);
      // 闭栏须同字符（``` 开 ``` 关——``` 块内的 ~~~ 行是内容不是栏）
      if (closeMatch !== null && (closeMatch[1] ?? '').startsWith(openFence)) {
        openFence = null;
      }
      continue; // 栏内行不参与标题切分（正文由行区间还原）
    }
    const fenceMatch = FENCE_OPEN_RE.exec(line);
    if (fenceMatch !== null) {
      openFence = (fenceMatch[1] ?? '').slice(0, 3); // 同字符判定取前三位（``` 与 ```` 互闭）
      continue;
    }
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch === null) continue;
    const level = (headingMatch[1] ?? '').length;
    const title = headingMatch[2] ?? '';
    closeSection(i); // 上一节在标题行前收口
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
    stack.push({ level, title });
    current = {
      path: stack.map((s) => s.title).join(' > '),
      level,
      title,
      startLine: i + 1, // 1 起行号
    };
    startBodyIndex = i + 1; // 正文自标题行之后（0 起）
  }
  closeSection(lines.length);
  return sections;
}

/** 节寻址产物——歧义/未命中是结果不是异常（报错不猜：调用方决定人面呈现） */
export type FindSkillSectionResult =
  | { readonly ok: true; readonly section: SkillSection }
  | { readonly ok: false; readonly reason: 'not-found' | 'ambiguous'; readonly candidates: readonly string[] };

/**
 * 按祖先路径寻址节（'Mode 3 > Workflow' 式）。
 *
 * 歧义多匹配报错不猜（06 §11.3 细化①——错误指导比无指导危害大）；未命中时
 * candidates = 全部可寻址 path（人面呈现「可用节」——指路而非裸拒）。
 */
export function findSkillSection(body: string, path: string): FindSkillSectionResult {
  const sections = splitSkillSections(body);
  const hits = sections.filter((s) => s.path === path);
  if (hits.length === 1) {
    const section = hits[0];
    if (section !== undefined) return { ok: true, section };
  }
  if (hits.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: hits.map((s) => `${s.path}（L${s.startLine}）`) };
  }
  return { ok: false, reason: 'not-found', candidates: sections.map((s) => s.path) };
}

/** 行级过滤选项（命中注入前按运行参数裁剪——模式词汇由调用方给定） */
export interface FilterSkillBodyOptions {
  /** 模式词汇全集（如 ['lite', 'full', 'ultra']——标签命中词汇才进模式判定） */
  readonly modes: readonly string[];
  /** 当前生效模式（与 modes 成员按 trim+小写比对） */
  readonly active: string;
}

/**
 * 行级过滤（ponytail filterSkillBodyForMode 形泛化——06 §11.3 细化③）。
 *
 * 只有两种行是模式专属、参与裁剪，其余行一律原样保留（普通规则行绝不误杀）：
 *  - 强度表行：`| **label** | …`——label 命中模式词汇时，仅当前模式行保留；
 *  - 带引号的工作示例行：`- label: "…"`——引号是判据的一部分（`- Full: …`
 *    无引号形是普通规则行，略读误杀即静默改行为——ponytail 实测教训）。
 * 输入须为正文（frontmatter 已剥——装载态 content 即此形）。
 */
export function filterSkillBody(body: string, options: FilterSkillBodyOptions): string {
  const normalize = (label: string): string => label.trim().toLowerCase();
  const modeSet = new Set(options.modes.map(normalize));
  const active = normalize(options.active);
  const tableLabel = /^\|\s*\*\*(.+?)\*\*\s*\|/;
  const exampleLabel = /^-\s*([^:]+):\s*"/;
  return body
    .split('\n')
    .filter((line) => {
      const tableMatch = tableLabel.exec(line);
      if (tableMatch !== null) {
        const label = normalize(tableMatch[1] ?? '');
        if (modeSet.has(label)) return label === active;
      }
      const exampleMatch = exampleLabel.exec(line);
      if (exampleMatch !== null) {
        const label = normalize(exampleMatch[1] ?? '');
        if (modeSet.has(label)) return label === active;
      }
      return true;
    })
    .join('\n');
}
