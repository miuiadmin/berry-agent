/**
 * API 治理公开产物的知识域指路滤词单源（03 篇 §8.8——查 10 公开产物指路卫生
 * 的单源判据；2026-09-05 API 治理批 2）。
 *
 * 单源缘由：surface.json 随包分发（dist/api/），其 desc 字段与未来的公开生成物
 * （COMPATIBILITY.md / docs/API参考.md——批 4 收剑点火件）必须公开锚卫生——
 * 知识域（gitignored 设计文档）篇名/章节号禁入机器扫描面。本模块即该判据的
 * 唯一真身：本批消费方 = 抽取器 desc harvest（tools/extract-api-surface.mjs
 * firstPublicSentence 滤词）；批 4 落地 check-api 查 10（公开产物面执法）与
 * API 参考生成器 desc 滤词时共享本单源（tools/ 侧共享件，不入模块 DAG）。
 * 产码注释引用规范不受此限（查 10 面界——本正则只喂机器扫描面，不约束人写
 * 注释）。
 */

/**
 * 知识域指路滤词正则：命中即「指路知识域」。
 *
 * 覆盖面（承 berry 蓝本协议、篇名换本仓七篇）：
 * - 「设计文档」根路径指称与 01-规范 目录段；
 * - 七篇规范篇名全列（定位与宪章 / 内核与插件边界 / 插件契约与扩展点 /
 *   运行时骨架 / 会话与存储 / 记忆与自进化 / 技术栈）；
 * - 「0N 篇」缩写形（N ∈ 1..7——JSDoc 首句实证缩写漏网面）；
 * - `§8` 章节号族（03 篇 API 治理章专属——公开产物用公开锚不用规范节号）；
 * - 知识域目录名（02-计划 / 03-参考）。
 */
export const KNOWLEDGE_DOMAIN_RE =
  /(设计文档|01-规范|定位与宪章|内核与插件边界|插件契约与扩展点|运行时骨架|会话与存储|记忆与自进化|技术栈|0[1-7]\s?篇|§\s?8|0[23]-(?:计划|参考))/;

/**
 * 实验面豁免节标记（03 篇 §8.8 查 5——生态启动批 eco-4 落码定形）。
 *
 * 形 = 独立一行 `〔实验面〕`（整行 trim 后全等才认——句中字面不算标记，防
 * 误豁免）。消费方 = check-api 查 5（豁免节剥除预处理）与未来两生成器
 * （COMPATIBILITY.md / docs/API参考.md——批 4）的「实验面」节共享单源。
 */
export const EXPERIMENTAL_SECTION_MARK = '〔实验面〕';

/**
 * 剥除文档中的实验面豁免节（查 5 扫描前预处理）：标记行起、至下一个**同级
 * 或更高级**标题止——更深标题属节内继续豁免；标记前无任何标题时视为顶级
 * （任何标题收界）。节内行不参与实验符号扫描——豁免是定点开口不是全文放行。
 * @param {string} text 原文
 * @returns {string} 剥除豁免节后的文本
 */
export function stripExperimentalSections(text) {
  /** 标题级（1..6；非标题行 = 0） */
  const headingLevel = (line) => /^(#{1,6})\s/.exec(line)?.[1]?.length ?? 0;
  const out = [];
  let exemptLevel = 0; // >0 = 处于豁免节内（值 = 节标题级）
  for (const line of text.split('\n')) {
    const level = headingLevel(line);
    if (exemptLevel > 0) {
      if (level === 0 || level > exemptLevel) continue; // 节内行（含更深标题）豁免丢弃
      exemptLevel = 0; // 同级/更高级标题 = 收界；标题行本身回扫描面
      out.push(line);
      continue;
    }
    if (line.trim() === EXPERIMENTAL_SECTION_MARK) {
      // 豁免节级 = 最近上一标题级（回扫已保留行；缺省 99 = 任何标题收界）
      exemptLevel = 99;
      for (let i = out.length - 1; i >= 0; i--) {
        const lv = headingLevel(out[i]);
        if (lv > 0) {
          exemptLevel = lv;
          break;
        }
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}
