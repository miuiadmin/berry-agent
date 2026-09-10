/**
 * 布局组合子四件（07 篇 §4.1 引擎节件 6（组件与呈现装配件） 组件条款——组合子布局）：Flex /
 * Column / Row / Inset。
 *
 * 无约束求解器——量高（measure）与落位（render 的区域划定）走同一分配
 * 单源、两段永不漂移：量高即分配的承诺，落位不得超卖。越界写由缓冲吸收
 * （CellBuffer 静默丢弃界外格——渲染契约兜底位）。
 *
 * 机制语义承 berry desktop components.ts 同构件（裁 ⓪ 从零重写——契约改
 * 本仓形：measure(width) / render(buffer, region) / Region{row,col}）。
 */
import type { CellBuffer, Region, Renderable } from '../engine/index.js';

/** Flex 结构判据（isFlex 真值 = Column 吸收余量的信号位） */
export function isFlexRenderable(r: Renderable): r is Flex {
  return (r as { isFlex?: boolean }).isFlex === true;
}

/** 区域取交（越界返回 null——布局夹取的公共件） */
function intersect(a: Region, b: Region): Region | null {
  const row1 = Math.max(a.row, b.row);
  const col1 = Math.max(a.col, b.col);
  const row2 = Math.min(a.row + a.height, b.row + b.height);
  const col2 = Math.min(a.col + a.width, b.col + b.width);
  if (row2 <= row1 || col2 <= col1) return null;
  return { row: row1, col: col1, width: col2 - col1, height: row2 - row1 };
}

/** Flex 包装 props */
export interface FlexProps {
  child: Renderable;
}

/** Flex 包装件（isFlex 标记——Column 吸收余量的信号；协商最小占位 1） */
export class Flex implements Renderable {
  readonly isFlex = true as const;
  private readonly child: Renderable;

  constructor(props: FlexProps) {
    this.child = props.child;
  }

  measure(_width: number): number {
    return 1; // 协商最小占位（真高度由 Column 分配余量决定）
  }

  render(buffer: CellBuffer, region: Region): void {
    if (region.height <= 0 || region.width <= 0) return;
    this.child.render(buffer, region);
  }
}

/** Column props：垂直堆叠 */
export interface ColumnProps {
  children: Renderable[];
}

/**
 * 垂直堆叠组合子：固定子按 measure(width) 定高顺排；Flex 子均分余量
 * （整除余数给最后一个 Flex 子）。子区域宽 = 全宽；底部溢出截断。
 */
export class Column implements Renderable {
  private readonly children: Renderable[];

  constructor(props: ColumnProps) {
    this.children = props.children;
  }

  measure(width: number): number {
    // 协商面：固定子按各自期望；Flex 子按最小占位 1 计
    let total = 0;
    for (const c of this.children) {
      total += isFlexRenderable(c) ? 1 : Math.max(1, c.measure(width));
    }
    return Math.max(1, total);
  }

  render(buffer: CellBuffer, region: Region): void {
    if (region.width <= 0 || region.height <= 0) return;
    // 两遍：先算固定高合计与 Flex 子数，再逐子分配落位
    const fixed: number[] = [];
    let fixedSum = 0;
    let flexCount = 0;
    for (const c of this.children) {
      if (isFlexRenderable(c)) {
        fixed.push(-1);
        flexCount++;
      } else {
        const h = Math.max(1, c.measure(region.width));
        fixed.push(h);
        fixedSum += h;
      }
    }
    const remaining = Math.max(0, region.height - fixedSum);
    const flexH = flexCount > 0 ? Math.max(1, Math.floor(remaining / flexCount)) : 0;
    let flexSeen = 0;
    let row = region.row;
    for (let idx = 0; idx < this.children.length; idx++) {
      if (row >= region.row + region.height) break; // 底部溢出截断
      const child = this.children[idx]!;
      let h: number;
      if (fixed[idx]! < 0) {
        flexSeen++;
        // 末 Flex 子收整除余数（份额 = 余量 - 前 N-1 份），仍受底部截断约束
        const share = flexSeen === flexCount ? remaining - flexH * (flexCount - 1) : flexH;
        h = Math.min(Math.max(0, share), region.row + region.height - row);
      } else {
        h = Math.min(fixed[idx]!, region.row + region.height - row);
      }
      if (h > 0) {
        child.render(buffer, { row, col: region.col, width: region.width, height: h });
      }
      row += h;
    }
  }
}

/** Row props：水平分列（weights 缺省等权） */
export interface RowProps {
  children: Renderable[];
  /** 各子权重（缺省全 1——等分） */
  weights?: number[];
}

/** 水平分列组合子：按权重分宽（整除余数给末列）；高度 = 各子期望最大值 */
export class Row implements Renderable {
  private readonly children: Renderable[];
  private readonly weights: number[];

  constructor(props: RowProps) {
    this.children = props.children;
    this.weights = props.weights ?? props.children.map(() => 1);
  }

  /**
   * 在总宽 width 下各子分得的列宽（含余数吸收——render 与 measure 共用
   * 单源：两段协商「同一分配单源」条款的执法位）。
   */
  private allocate(width: number): number[] {
    const totalW = this.weights.reduce((a, b) => a + b, 0);
    const out: number[] = [];
    let used = 0;
    for (let i = 0; i < this.children.length; i++) {
      // 末列收整除余数（宽 = 总宽 - 前已分），前列按权重整除
      const w = i === this.children.length - 1 ? width - used : Math.floor((width * (this.weights[i] ?? 1)) / totalW);
      out.push(Math.max(0, w));
      used += Math.max(0, w);
    }
    return out;
  }

  measure(width: number): number {
    const widths = this.allocate(Math.max(1, width));
    let max = 1;
    for (let i = 0; i < this.children.length; i++) {
      max = Math.max(max, this.children[i]!.measure(Math.max(1, widths[i]!)));
    }
    return max;
  }

  render(buffer: CellBuffer, region: Region): void {
    if (region.width <= 0 || region.height <= 0) return;
    const widths = this.allocate(region.width);
    let col = region.col;
    for (let i = 0; i < this.children.length; i++) {
      if (col >= region.col + region.width) break; // 右侧溢出截断
      if (widths[i]! > 0) {
        this.children[i]!.render(buffer, { row: region.row, col, width: widths[i]!, height: region.height });
      }
      col += widths[i]!;
    }
  }
}

/** Inset props：内缩边距 */
export interface InsetProps {
  child: Renderable;
  /** 上边距（行） */
  top?: number;
  /** 右边距（列） */
  right?: number;
  /** 下边距（行） */
  bottom?: number;
  /** 左边距（列） */
  left?: number;
}

/** 内缩组合子：区域四向收缩后与原区域取交整夹，再整交子件 */
export class Inset implements Renderable {
  private readonly child: Renderable;
  private readonly top: number;
  private readonly right: number;
  private readonly bottom: number;
  private readonly left: number;

  constructor(props: InsetProps) {
    this.child = props.child;
    this.top = props.top ?? 0;
    this.right = props.right ?? 0;
    this.bottom = props.bottom ?? 0;
    this.left = props.left ?? 0;
  }

  measure(width: number): number {
    return Math.max(1, this.child.measure(Math.max(1, width - this.left - this.right))) + this.top + this.bottom;
  }

  render(buffer: CellBuffer, region: Region): void {
    const inner: Region = {
      row: region.row + this.top,
      col: region.col + this.left,
      width: Math.max(0, region.width - this.left - this.right),
      height: Math.max(0, region.height - this.top - this.bottom),
    };
    const clipped = intersect(inner, region);
    if (!clipped) return;
    this.child.render(buffer, clipped);
  }
}
