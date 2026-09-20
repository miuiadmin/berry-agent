/**
 * 单行左右双段预算排版单源（TUI 第四役处置批 fx3 单源化推全）：右段先按
 * 预算截成 … 省略形再右对齐——极长右段按原宽右对齐会把起列推成负值
 * （CellGrid 越界写静默吸收首段、余段从行首覆写整行——左段 label 被劈毁
 * 的坏形）；左段以右段实占后余宽为帽 … 收口。两段各自整字截断
 * （truncateToWidth——不撕宽字符）。
 *
 * - **谱系**：2026-09-20 TUI 视觉品质战役·组 2 起源（select-confirm 与
 *   autocomplete popup 各持私拷贝 + market-picker 内联同律）——本件把该律
 *   提为件外单源；副屏选择器族（theme/sandbox/thinking/skills/market
 *   picker 与 sessions 切换器）renderRow 的时间/短 id/说明/层名右段全走本
 *   律，窄窗右段不再负起列劈毁档名/标题；
 * - **收紧位**：私拷贝形在预算 0（窗宽 ≤ 2 且右段非空）放行原宽右段——
 *   单源收紧为丢弃右段（预算 0 = 无位可放），右段实占恒 ≤ 预算，起列
 *   恒 ≥ 1（负起列结构性封堵——不只坏形窗封堵）。
 */
import { stringWidth, truncateToWidth } from '../engine/index.js';

/** 双段排版产出形（rightWidth 单出——消费位右对齐起列 = col + width - rightWidth） */
export interface RowSegmentsFit {
  /** 左段收口形（超帽 … 收口；通常原样） */
  readonly left: string;
  /** 右段预算形（超预算 … 收口；预算 0 / 空右段恒 ''） */
  readonly right: string;
  /** 右段实占宽（0 = 无右段——消费位跳写） */
  readonly rightWidth: number;
}

/**
 * 单行左右双段预算排版：左段保留位 = 左段宽与半窗取小（右段预算的下限保证
 * ——label 至多让半窗）；右段预算 = 总宽 - 间隔 1 列 - 左段保留位，超预算先
 * 整字截断加 …（消费位再右对齐——起列恒 ≥ 1）；左段帽 = 总宽 - 右段实占 -
 * 间隔 1 列（无右段即总宽——label 自身极长时 … 收口）。
 */
export function fitRowSegments(left: string, right: string | undefined, width: number): RowSegmentsFit {
  // 左段保留位 = 左段宽与半窗取小（右段预算的下限保证——label 至多让半窗）
  const leftReserve = Math.max(0, Math.min(stringWidth(left), Math.floor(width / 2)));
  // 预算 0（窗极窄或右段空）= 丢弃右段——不放行原宽（负起列封堵收紧位）
  const rightBudget = right !== undefined && right.length > 0 ? Math.max(0, width - 1 - leftReserve) : 0;
  const fittedRight =
    rightBudget === 0
      ? ''
      : stringWidth(right ?? '') <= rightBudget
        ? (right ?? '')
        : `${truncateToWidth(right ?? '', Math.max(0, rightBudget - 1))}…`;
  const rightWidth = stringWidth(fittedRight);
  // 左段帽 = 总宽 - 右段实占 - 间隔 1 列（无右段即总宽；右段已按预算截断，
  // 此处帽内通常已适——label 自身极长时 … 收口）
  const maxLeft = rightWidth > 0 ? width - rightWidth - 1 : width;
  const fittedLeft = stringWidth(left) <= maxLeft ? left : `${truncateToWidth(left, Math.max(0, maxLeft - 1))}…`;
  return { left: fittedLeft, right: fittedRight, rightWidth };
}
