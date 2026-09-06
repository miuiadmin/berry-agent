/**
 * 文本度量件（07 篇 §4.1 自研引擎节件 2——批 10b 引擎核心）。
 *
 * 字素边界与列宽两件必须同时在场（立法缘由：berry 注释点名 OpenCode 反课
 * 「只用字素切分不管列宽 → CJK 断行错位至今未修」）——
 * - 字素边界：运行时内建 Intl.Segmenter（零新依赖，模块级单例）；
 * - 列宽：EAW 分类**数据面**外包 get-east-asian-width（§2.1 精确锁 1.6.0），
 *   `ambiguous = 1` 的中西混排语境取舍**决策面自持**在本件（见 eawWidth 注释）。
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
 * 字素级宽度四规则（07 引擎节件 2）：
 * ① 字素内任一码点 EAW wide/fullwidth → 2；
 * ② 含 VS16 → 2（emoji 呈现形——窄基字符 + VS16 也占双列）；
 * ③ 恰一对 Regional Indicator → 2（旗帜——单码点 EAW 覆盖不到，孤立 RI 按 1）；
 * ④ 其余 → 1。
 */
export function graphemeWidth(grapheme: string): 0 | 1 | 2 {
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
  // 规则④：其余 → 1（含控制字符的占位语义不在此件发明——网格写入层拒收）
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
 * 整字三原语之三·整字换行：按 cols 折行——
 * 行末剩一列遇双宽字素整字下移**第二列不悬挂**；ZWJ 家族**跨行不撕裂**
 * （字素切分在前、折行只动字素边界）；显式 \n 强制换行（段语义保留）。
 */
export function wrapText(text: string, cols: number): string[] {
  if (cols <= 0) return [text]; // 非法宽防御：不折行整段返回（坏参不丢字）
  const lines: string[] = [];
  // 先按显式换行分段（空段保留——空行语义），段内再按宽折行
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    let current = '';
    let used = 0;
    for (const g of splitGraphemes(paragraph)) {
      const w = graphemeWidth(g);
      if (used + w > cols) {
        lines.push(current); // 当前行满——整字下移开新行（双宽字不悬挂第二列）
        current = g;
        used = w;
      } else {
        current += g;
        used += w;
      }
    }
    lines.push(current); // 段尾行（含整段未折情形）
  }
  return lines;
}
