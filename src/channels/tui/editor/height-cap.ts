/**
 * 编辑器高度帽（07 §4.1 R3 批 10j——呈现高度上限 + 迟滞带）。
 *
 * 帽 = max(5, floor(视口行数 × 0.3))：超帽内容编辑器内部滚动（视口夹取
 * 自愈 + 顶沿滚动指示边框行 `─── ↑ N more ──` 形），不撑爆主屏固定区。
 * 迟滞带 ±1 行：增长即时跟手；缩帽须内容降 2 行才缩——防删一字合一行的
 * 高度抖动（高度变化经主屏固定区高度账钳制重画，抖动即整屏重排闪）。
 */

/** 帽公式（rows = 终端视口行数——装配位注入 maxVisibleLines） */
export function editorHeightCap(rows: number): number {
  return Math.max(5, Math.floor(rows * 0.3));
}

/**
 * 呈现行数决策（迟滞带核心）：内容行数 ≥ 上次呈现行数 → 即时跟随（夹帽）；
 * 恰降 1 行且上次仍在帽内 → 保持上次（迟滞保持，空白行垫底）；降 ≥ 2 行 →
 * 跟随缩。纯函数——上次呈现行数由视图持有回传，决策零隐藏态。
 */
export function presentedLineCount(totalRows: number, cap: number, lastShown: number): number {
  const target = Math.min(totalRows, cap);
  if (totalRows >= lastShown) return target; // 增长 / 持平——即时
  if (lastShown <= cap && lastShown - totalRows === 1) return lastShown; // 迟滞带内保持
  return target; // 降 2 行及以上——缩
}
