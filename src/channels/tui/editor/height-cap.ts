/**
 * 编辑器高度帽（07 §4.1 R3 批 10j——呈现高度上限 + 迟滞带；2026-10-08 TUI
 * 对标 Codex 五件批 A+B——呈现最小高 3 与上下空行垫）。
 *
 * 帽 = max(5, floor(视口行数 × 0.3))：超帽内容编辑器内部滚动（视口夹取
 * 自愈 + 顶/末内容行右端滚动指示 overlay ` ↑ N 更多 ` 形——V-0 注③ 框
 * 退役后不再写边框行），不撑爆主屏固定区。帽辖**内容呈现高**——上下空行
 * 垫（EDITOR_PAD_ROWS）在帽外叠加；最小高 3 < 帽下界 5 恒不冲突。
 * 迟滞带 ±1 行：增长即时跟手；缩帽须内容降 2 行才缩——防删一字合一行的
 * 高度抖动（高度变化经主屏固定区高度账钳制重画，抖动即整屏重排闪）。
 */

/** 呈现最小高（五件批 A+B——内容不足 3 行铺空行至 3：空稿视觉块体量化，codex composer 同构；空行是呈现垫非内容行——光标算术/折叠映射/输入历史/粘贴标记零扩） */
export const MIN_PRESENTED_LINES = 3;

/** 上下空行垫行数（各 1 共 2——五件批 A+B：Renderable 量高 +2，与上方任务状态行/下方面板族的视觉呼吸垫；帽外叠加、计入固定区预算） */
export const EDITOR_PAD_ROWS = 2;

/** 帽公式（rows = 终端视口行数——backend 构造期与 resize 现值计算注入；生产装配位注入已撤〔第六轮批，maxVisibleLines 选项留测试固定帽〕） */
export function editorHeightCap(rows: number): number {
  return Math.max(5, Math.floor(rows * 0.3));
}

/**
 * 呈现行数决策（迟滞带核心）：内容行数 ≥ 上次呈现行数 → 即时跟随（夹帽）；
 * 恰降 1 行且上次仍在帽内 → 保持上次（迟滞保持，空白行垫底）；降 ≥ 2 行 →
 * 跟随缩。全分支呈现最小高钳底、帽辖上限收口（五件批 A+B——内容不足 3 行
 * 铺空行至 3；最小高 3 < 帽下界 5 恒不冲突——帽 < 3 退化形〔测试固定帽〕帽
 * 辖优先：page 步幅与帽同源，帽语义不动是承重旧不变式）。minLines 可选参
 * （缺省规范值 3）：底铬瞬时输入行（viewer 导出/搜索行——单行形设计锁）
 * 传 1 回归旧几何——A+B 呈现策略辖主 composer 不辖底铬。
 * 纯函数——上次呈现行数由视图持有回传，决策零隐藏态。
 */
export function presentedLineCount(
  totalRows: number,
  cap: number,
  lastShown: number,
  minLines: number = MIN_PRESENTED_LINES,
): number {
  const target = Math.min(totalRows, cap);
  let shown = target; // 增长 / 持平——即时
  if (totalRows < lastShown && lastShown <= cap && lastShown - totalRows === 1) {
    shown = lastShown; // 迟滞带内保持
  } // 其余缩形——降 2 行及以上跟随缩
  return Math.min(cap, Math.max(minLines, shown)); // 最小高钳底（minLines 可选参）+ 帽辖上限
}
