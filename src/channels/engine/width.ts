/**
 * 文本度量件（07 篇 §4.1 自研引擎节件 2——批 10b 引擎核心）。
 *
 * 字素边界与列宽两件必须同时在场（立法缘由：berry 注释点名 OpenCode 反课
 * 「只用字素切分不管列宽 → CJK 断行错位至今未修」）——
 * - 字素边界：运行时内建 Intl.Segmenter（零新依赖，模块级单例）；
 * - 列宽：EAW 分类**数据面**外包 get-east-asian-width（§2.1 精确锁 1.6.0），
 *   `ambiguous = 1` 的中西混排语境取舍**决策面自持**在本件（见 eawWidth 注释）。
 *
 * 2026-09-20 TUI 修复组 1 批增三面单源（禁则 / 控制字消毒 / 零宽记账）：
 * - CJK 折行禁则（kinsoku）字集与谓词单源落本件——wrapText / markdown
 *   layoutParts / editor foldLine 三引擎同律消费（禁则字集不在各引擎重复定义）；
 * - sanitizeDisplayText 控制字符单源消毒——tab 语义展开 2 空格、CR 剥除、
 *   ESC 序列剥除、其余 C0/DEL 剥除（与 cell.ts 网格面零控制字节律对齐，
 *   inline 呈现面不再裸写控制字节产未记账物理行）；
 * - graphemeWidth 增零宽字素分支——孤立 ZWSP/SHY/ZWJ/WJ/BOM 按 0 列记账。
 */
import { eastAsianWidthType } from 'get-east-asian-width';

/** 字素切分器（模块级单例——Segmenter 构造贵、无状态可复用） */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** 变体选择子 16（emoji 呈现形——字素含之即宽 2） */
const VS16 = 0xfe0f;
/** Regional Indicator 起止（旗帜 = 恰一对 RI 合成一字素） */
const RI_FIRST = 0x1f1e6;
const RI_LAST = 0x1f1ff;

/**
 * 行首禁则字集（kinsoku——不可起行的字素）。
 * 实收面（头注与集成员逐字对齐——2026-09-21 TUI 第四役批二勘正宣称）：
 * 点类七（、。，！？：；）+ 省略号 … + 全角闭合括引九
 * （）】」』〉》圆/方/双书名/尖/书名 + ］｝〕方/花/龟甲——括族三形齐）；
 * 破折号「—」与省略号「⋯」二义（可居中成段）不收录、龟甲闭合以外的小
 * 集合括号（〗〙〛 等）暂不收录——收录面保守起步，扩集走本单源一处改。
 */
const LINE_START_PROHIBITED = new Set([
  '）',
  '】',
  '」',
  '』',
  '〉',
  '》',
  '］', // 全角方括号闭合（2026-09-21 批二增——中文技术正文常用族）
  '｝', // 全角花括号闭合
  '〕', // 龟甲括号闭合
  '、',
  '。',
  '，',
  '！',
  '？',
  '：',
  '；',
  '…',
]);

/**
 * 行尾禁则字集（kinsoku——不可收行的字素）：全角开括引号。
 * 实收面九：（【「『〈《圆/方/双书名/尖/书名 + ［｛〔方/花/龟甲——括族
 * 三形齐（2026-09-21 批二增后三员）。
 * 开括号悬挂行尾则其配对内容起于次行、视觉断裂——折点须将其推下开行。
 */
const LINE_END_PROHIBITED = new Set(['（', '【', '「', '『', '〈', '《', '［', '｛', '〔']);

/** 行首禁则谓词（kinsoku 单源——折点回送判据，三引擎同律消费） */
export function isLineStartProhibited(grapheme: string): boolean {
  return LINE_START_PROHIBITED.has(grapheme);
}

/** 行尾禁则谓词（kinsoku 单源——折点推下判据，三引擎同律消费） */
export function isLineEndProhibited(grapheme: string): boolean {
  return LINE_END_PROHIBITED.has(grapheme);
}

/**
 * EAW 单码点分类宽（决策面自持位）。
 *
 * ambiguous（A 类：〇 ⊡ ⛭ …）在 CJK 语境常按 2 列渲染、西文语境按 1 列——
 * 本仓取舍 **= 1**（中西混排对话正文按窄计），依据 = berry 实证同款取舍；
 * 部分按 2 渲染的 CJK 终端上对齐误差可容忍，可配置性挂真实需求再裁
 * （07 §4.1 终端支持矩阵降级三款注记在案）。
 * 注：外包库的 eastAsianWidth() 缺省 ambiguousAsWide = true——与本取舍相反，
 * 故只取其分类函数、宽度判定自持，不走其合成宽函数。
 */
function eawWidth(codePoint: number): 0 | 1 | 2 {
  const type = eastAsianWidthType(codePoint);
  return type === 'wide' || type === 'fullwidth' ? 2 : 1;
}

/**
 * 孤立零宽字素码点集（单码点格式控制类，按 0 列记账）：
 * ZWSP U+200B / ZWNJ U+200C / 孤立 ZWJ U+200D / SHY U+00AD / WJ U+2060 / BOM U+FEFF。
 * 多码点字素（ZWJ 家族 emoji 等）不落此集——家族宽仍走规则②③①。
 */
const ZERO_WIDTH_CODE_POINTS = new Set([0x200b, 0x200c, 0x200d, 0x00ad, 0x2060, 0xfeff]);

/**
 * 字素级宽度规则（07 引擎节件 2）：
 * ① 字素内任一码点 EAW wide/fullwidth → 2；
 * ② 含 VS16 → 2（emoji 呈现形——窄基字符 + VS16 也占双列）；
 * ③ 恰一对 Regional Indicator → 2（旗帜——单码点 EAW 覆盖不到，孤立 RI 按 1）；
 * ④ 孤立零宽字素（单码点格式控制）→ 0（2026-09-20 增——算术面与 cell.ts
 *    网格面零宽防御位对齐，ZWSP 伪装可见字符占列的失真收口）；
 * ⑤ tab（U+0009）→ 2（2026-09-21 TUI 第四役批二增——语义展开两空格，与
 *    sanitizeDisplayText 的 tab→2 空格、cell.ts writeText 的落格展开三面
 *    单源；编辑器粘贴路 tab 原样入模型不经消毒，模型侧全部宽度算术
 *    〔折行/光标列/垂直移动〕在此记 2 使与落格账对齐）；
 * ⑥ 其余 → 1。
 */
export function graphemeWidth(grapheme: string): 0 | 1 | 2 {
  // 规则⑤：tab 记 2（控制字素中唯一有呈现语义者——语义展开两空格；
  // 其余控制字素不在此发明占位语义，仍落规则⑥由网格写入层拒收）
  if (grapheme === '\t') return 2;
  // 全域清扫 #12：单码点 ASCII 快路——编辑器逐字素测宽热路径在 ASCII 域
  // 跳过码点展开/RI 过滤/VS16 查询全链（该域规则①-⑥退化恒 1：零宽集全
  // 部 ≥U+0080、EAW wide 无 ASCII 位——等价性由 width/cell 既有测试面锁）
  if (grapheme.length === 1 && grapheme.charCodeAt(0) < 0x80) return 1;
  const codePoints = [...grapheme].map((ch) => ch.codePointAt(0)!);
  // 规则③：恰一对 RI（两面旗恰好两个 RI 码点合成）判 2；单 RI / 三连 RI 落规则④
  const riCount = codePoints.filter((cp) => cp >= RI_FIRST && cp <= RI_LAST).length;
  if (codePoints.length === 2 && riCount === 2) return 2;
  // 规则②：VS16 在场即宽（emoji 呈现形语义优先于基字符分类）
  if (codePoints.includes(VS16)) return 2;
  // 规则①：任一码点 wide/fullwidth → 2
  for (const cp of codePoints) {
    if (eawWidth(cp) === 2) return 2;
  }
  // 规则④：孤立零宽字素 → 0（多码点字素已在前三规则收口，不误伤 ZWJ 家族）
  if (codePoints.length === 1 && ZERO_WIDTH_CODE_POINTS.has(codePoints[0]!)) return 0;
  // 规则⑥：其余 → 1（其余控制字符的占位语义不在此件发明——网格写入层拒收）
  return 1;
}

/** 切分字素序列（Intl.Segmenter——ZWJ 家族 / 旗帜 / 变体选择子整素不撕裂） */
export function splitGraphemes(text: string): string[] {
  if (text === '') return [];
  const out: string[] = [];
  for (const seg of segmenter.segment(text)) out.push(seg.segment);
  return out;
}

/** 整字三原语之一·测宽：全串字素宽度和 */
export function stringWidth(text: string): number {
  let width = 0;
  for (const g of splitGraphemes(text)) width += graphemeWidth(g);
  return width;
}

/**
 * 整字三原语之二·按宽截断：截到不超过 cols 的最长字素前缀——
 * 宽字素跨界整字丢弃**不产半字**（末位恰剩一列放不下双宽字素时整字放弃）。
 */
export function truncateToWidth(text: string, cols: number): string {
  if (cols <= 0) return '';
  let used = 0;
  let out = '';
  for (const g of splitGraphemes(text)) {
    const w = graphemeWidth(g);
    if (used + w > cols) break; // 剩余列宽不足整字——整字丢弃（不产半字）
    used += w;
    out += g;
  }
  return out;
}

/**
 * 省略形截断单源（TUI 优化役 2026-09-23 收口）：不超宽原样透传；超宽整字
 * 截到 width-1 后缀省略号；**width ≤ 0 返空串**（0 宽守卫——消费位旧散形
 * 此态产 1 列 '…' 超帽写出，收口为零输出；status-line fitFooter 早退语义
 * 由本守卫吸收）。row-segments / diff-viewer / status-line / select-confirm
 * 四件同式消费单源。
 */
export function ellipsize(text: string, width: number): string {
  if (width <= 0) return '';
  return stringWidth(text) <= width ? text : `${truncateToWidth(text, width - 1)}…`;
}

/**
 * 控制字符消毒（单源——inline 呈现面源头消毒，2026-09-20 TUI 修复组 1）：
 * - tab → 2 空格（语义展开，非剥除——列对齐意图保留）；
 * - LF 保留（段语义——调用方分段折行）、CR 剥除（CRLF 归一 LF）；
 * - ESC 序列整段剥除：CSI（ESC [ … final 0x40–0x7E）/ OSC（ESC ] … BEL 或
 *   ST）/ 传统式（ESC + 中间码 0x20–0x2F + final 0x30–0x7E）——呈现文本里
 *   的 ESC 序列是模型输出或网关报文夹带的转义残留，落屏即伪控制；
 * - 其余 C0（<0x20）与 DEL 剥除（与 cell.ts 网格面零控制字节律同律）。
 */
export function sanitizeDisplayText(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === 0x1b) {
      // ESC 序列消费：整段剥除（截尾 malformed 序列一并吞——不外泄半个序列）
      i = consumeEscapeSequence(text, i);
      continue;
    }
    if (code === 0x09) {
      out += '  '; // tab 语义展开 2 空格
      i++;
      continue;
    }
    if (code === 0x0a) {
      out += '\n'; // LF 保留（段语义）
      i++;
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      i++; // 其余 C0 / DEL 剥除（含 CR——CRLF 归一 LF）
      continue;
    }
    out += text[i]!;
    i++;
  }
  return out;
}

/**
 * ESC 转义序列消费（返回序列末后位——整段剥除用）。
 * 三形：CSI（'[' + 参数/中间码 + final 0x40–0x7E）、OSC（']' + 至 BEL/ST）、
 * 传统式（中间码 0x20–0x2F* + final 0x30–0x7E）。截尾 malformed 形吞到串尾。
 */
function consumeEscapeSequence(text: string, start: number): number {
  let i = start + 1;
  if (i >= text.length) return i;
  const kind = text[i]!;
  if (kind === '[') {
    // CSI：参数码 0x30–0x3F 与中间码 0x20–0x2F 直到 final 0x40–0x7E
    i++;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c >= 0x40 && c <= 0x7e) return i + 1; // final——序列闭合
      if (c >= 0x20 && c <= 0x3f) {
        i++;
        continue;
      }
      return i; // 非 CSI 语法字节——截断 malformed，吞到此为止
    }
    return i;
  }
  if (kind === ']') {
    // OSC：吞到 BEL（0x07）或 ST（ESC \）
    i++;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x07) return i + 1;
      if (c === 0x1b && text[i + 1] === '\\') return i + 2; // ST
      i++;
    }
    return i;
  }
  // 传统式：中间码 0x20–0x2F* + final 0x30–0x7E（如 ESC ( B 字符集选择）
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c >= 0x20 && c <= 0x2f) {
      i++;
      continue;
    }
    if (c >= 0x30 && c <= 0x7e) return i + 1; // final
    return i; // 非法形——截断
  }
  return i;
}

/**
 * 整字三原语之三·整字换行：按 cols 折行——
 * - 行末剩一列遇双宽字素整字下移**第二列不悬挂**；ZWJ 家族**跨行不撕裂**
 *   （字素切分在前、折行只动字素边界）；
 * - 显式 \n 强制换行（段语义保留，空行保留）；
 * - **CJK 折行禁则（kinsoku，2026-09-20 增）**：折点行首不可为闭合标点
 *   （回送当行末字素下移）、行尾不可悬挂开括号（推下开行）——两规则同一
 *   操作「当行末字素携下移」；回送后新行越帽即放弃硬断（不无限回送）；
 * - **折点空格处理**：折点字素为空格时吞掉不转行、续行行首空格跳过
 *   （段首行缩进保留——与 markdown layoutParts 对齐）；
 * - **源头消毒**：段文本先经 sanitizeDisplayText（tab 展开 / CR 与 ESC
 *   序列剥除）再折行——控制字节不产未记账物理行。
 */
export function wrapText(text: string, cols: number): string[] {
  if (cols <= 0) return [sanitizeDisplayText(text)]; // 非法宽防御：不折行整段返回（坏参不丢字；消毒仍做）
  const lines: string[] = [];
  // 先单源消毒再按显式换行分段（空段保留——空行语义），段内再按宽折行
  for (const paragraph of sanitizeDisplayText(text).split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    const paragraphStart = lines.length; // 段首行界（续行行首空格跳过只作用于折行产生的行——段首行缩进保留）
    let current: string[] = []; // 当行字素累积（数组形——禁则回送要从未尾弹出）
    let used = 0;
    for (const g of splitGraphemes(paragraph)) {
      // 续行行首空格跳过（折行产物不保留行首空格——段首行不受此律）
      if (g === ' ' && current.length === 0 && lines.length > paragraphStart) continue;
      const w = graphemeWidth(g);
      if (used + w > cols) {
        // 折点吞空格：折点字素是空格 → 当前行收笔、空格不转行不占下行行首
        if (g === ' ') {
          lines.push(current.join(''));
          current = [];
          used = 0;
          continue;
        }
        // CJK 禁则回送（kinsoku）：行首禁则（折点后字素不可起行）与行尾禁则
        // （当行末字素不可收行）同一操作——当行末字素弹出携下移；回送后新行
        // [carry…+g] 越帽即放弃（禁则让位硬断——不无限回送，原折点保持）；
        // 被弹空格弹丢不入 carry（空格不是排版内容——不占新行行首，回送位
        // 与迭代位两路同守「续行行首空格跳过」自规则，2026-09-21 批二）
        const carry: string[] = [];
        let carryWidth = 0;
        while (current.length > 0) {
          const nextFirst = carry.length > 0 ? carry[0]! : g; // 新行行首候选
          const currentLast = current[current.length - 1]!; // 当行行末候选
          if (!isLineStartProhibited(nextFirst) && !isLineEndProhibited(currentLast)) break;
          const head = currentLast;
          if (head === ' ') {
            // 空格弹丢：只出当行不入 carry——弹丢不耗 carry 宽、不受回送
            // 越帽判据约束（丢字不占新行，无解风险不存在）
            current.pop();
            used -= 1;
            continue;
          }
          const headW = graphemeWidth(head);
          if (carryWidth + headW + w > cols) break; // 回送无解——放弃硬断
          current.pop();
          used -= headW;
          carry.unshift(head);
          carryWidth += headW;
        }
        lines.push(current.join('')); // 当前行满——整字下移开新行（双宽字不悬挂第二列）
        current = carry.length > 0 ? [...carry, g] : [g];
        used = carryWidth + w;
      } else {
        current.push(g);
        used += w;
      }
    }
    // 段尾行（含整段未折情形）——尾推守卫与 layoutParts 同律（2026-09-21 批二）：
    // 段尾折点吞空格后 current 为空且已有前行时不推空行（恰满行空格收尾不产
    // 多余空白行）；lines 仍空（首段整段折空——理论不可达的防御位）保底一行
    if (current.length > 0 || lines.length === 0) lines.push(current.join(''));
  }
  return lines;
}
