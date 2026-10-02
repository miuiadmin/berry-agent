/**
 * 状态行件（07 §4.1 呈现面件 3——批 10d-4；V-3 注⑦② footer 左右分栏重做 +
 * 注⑧③ 忙态族整役退役）。
 *
 * - 忙态呈现归件 12 任务状态行（09-30 UX 批迁移定谳）——本件只司闲态文案
 *   与 footer 常驻段；
 * - **footer 左右分栏（V-3 注⑦——codex footer 同构）**：左段 = 档位模式词
 *   （secondary）+ 闲态教学提示（dim）；右段 = 今日用量右对齐（1 列右缘垫
 *   + 左右段最小 1 列间隙）；尾注/回执（setStatus——件 6 usage 尾注与
 *   ctx.ui.setStatus 回执同载体）优先占右槽（让位族：尾注 > 今日段）；
 * - **窄宽坍缩梯（V-3 注⑦③——自宽而窄五档段级丢弃）**：教学提示先丢 →
 *   档位注缩词（仅沙箱安全词）→ 右段今日藏（尾注不藏——帽截断保底）→
 *   仅档位 danger 位（安全信息最后保真——ellipsize 容忍）→ 全空（行恒 1
 *   ——零高度防行跳动）；段内超宽 = ellipsize 整字既有律维持（段内字段
 *   重排梯不造）；
 * - footer 缺席（setFooter 未调 / null 清除）= 旧形：闲态文案居左满行；
 * - onChange 通知：状态任何变更（换文案/换 footer 段集）触发——装配层接重绘。
 */
import type { CellBuffer, CellStyle, Region, Renderable } from '../../engine/index.js';
import { ellipsize, stringWidth } from '../../engine/index.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';

/**
 * footer 分栏段集（V-3 注⑦②——backend 装配位拼段注入）：
 * 模型/短 id/目录⎇支名@短哈希三段已退役出 footer（承载面 = /status 副屏）。
 */
export interface FooterSegments {
  /** 档位段全形（`沙箱短词 · 思考短词` join——缺省档缩位；'' = 段缺席） */
  readonly tiers: string;
  /** 档位段安全缩形（仅沙箱短词——坍缩梯 rung2 消费；'' = 无沙箱词） */
  readonly tiersSafety: string;
  /** 沙箱档是否 danger（rung4「仅档位 danger 位」安全保真判据） */
  readonly danger: boolean;
  /** 闲态教学提示（`? 快捷键`——空稿闲态门控在 backend 侧；退场 = ''） */
  readonly hint: string;
  /** 右段常驻（`今日 N`；零耗缩位 = ''） */
  readonly right: string;
}

/** 段间连接符（' · '——3 显示列；样式随前一档位段） */
const SEGMENT_SEP = ' · ';

/** 状态行件（量高恒 1 行——底部固定区状态行；闲态文案 + footer 左右分栏） */
export class StatusLine implements Renderable {
  /** 状态变更通知（装配层接重绘请求——setStatus/setFooter） */
  onChange?: () => void;
  /** 闲态文案（setStatus last-writer-wins——件 6 尾注/回执同载体） */
  private idleText = '';
  /**
   * footer 常驻段样式（secondary 次文键——常驻信息退后，层级 = 状态信息 >
   * footer 段；setTheme 派生重建）。
   */
  private footerStyle: Readonly<CellStyle> = Object.freeze({ fg: DEFAULT_THEME.secondary });
  /** 教学提示样式（dim——教学位弱存在感，不入 §4.4 律三载体集） */
  private readonly hintStyle: Readonly<CellStyle> = Object.freeze({ dim: true });
  /** footer 段集（null = footer 缺席旧形——闲态文案居左满行） */
  private seg: FooterSegments | null = null;

  /** 主题换装（backend 注入——secondary 派生样式重建） */
  setTheme(theme: ResolvedTheme): void {
    this.footerStyle = Object.freeze({ fg: theme.secondary });
  }

  /** 量高：恒 1（状态行单行制——坍缩梯全空档行也保留，防行跳动） */
  measure(width: number): number {
    void width;
    return 1;
  }

  /** 落位：footer 缺席 = 旧形（闲态文案居左）；在场 = 左右分栏 + 坍缩梯 */
  render(buffer: CellBuffer, region: Region): void {
    if (this.seg === null) {
      // 旧形（footer 缺席——零扰动锚）
      if (this.idleText !== '') buffer.writeText(region.row, region.col, this.idleText);
      return;
    }
    const w = region.width;
    const seg = this.seg;
    // 右段原料：尾注让位族（尾注/回执优先于今日段——「忙态工具段优先于右段
    // 状态」同族）；尾注走正文前景（瞬时重要信息），今日走 secondary
    const rightIsTail = this.idleText !== '';
    const rightRaw = rightIsTail ? this.idleText : seg.right;
    // 右段帽（B-render 批帽律承袭）：w-2（间隔 1 列 + 左段至少留 1 列截断形）
    const rightText = rightRaw === '' ? '' : ellipsize(rightRaw, Math.max(0, w - 2));
    const rW = stringWidth(rightText);
    const gap = (leftW: number): number => (leftW > 0 && rW > 0 ? 1 : 0);
    // withRight 判据含双垫：段间最小 1 列 + 右缘垫 1 列（注⑦② 几何双保）
    const fits = (leftW: number, withRight: boolean): boolean =>
      withRight ? leftW + gap(leftW) + rW + 1 <= w : leftW <= w;
    const tiersW = stringWidth(seg.tiers);
    const safetyW = stringWidth(seg.tiersSafety);
    const hintW = stringWidth(seg.hint);
    const fullLeftW = tiersW + (tiersW > 0 && hintW > 0 ? stringWidth(SEGMENT_SEP) : 0) + hintW;
    // 坍缩梯逐档（段级丢弃——非字段重排）
    let leftText = '';
    let showRight = rightText !== '';
    if (fits(fullLeftW, true)) {
      // rung0：档位全形 + 教学提示 + 右段（hint 段独立 dim 样式——分段写）
      let col = region.col;
      if (seg.tiers !== '') {
        buffer.writeText(region.row, col, this.fit(seg.tiers, w), this.footerStyle);
        col += Math.min(tiersW, w);
      }
      if (seg.hint !== '') {
        if (seg.tiers !== '') {
          buffer.writeText(region.row, col, SEGMENT_SEP, this.footerStyle);
          col += stringWidth(SEGMENT_SEP);
        }
        // 教学段按剩余宽截断（左段内超宽 ellipsize 既有律；右段双垫预留）
        const rest = Math.max(0, w - (col - region.col) - (rW > 0 ? rW + 2 : 0));
        buffer.writeText(region.row, col, ellipsize(seg.hint, rest), this.hintStyle);
      }
    } else if (fits(tiersW, true)) {
      leftText = seg.tiers; // rung1：教学提示丢
    } else if (fits(safetyW, true)) {
      leftText = seg.tiersSafety; // rung2：档位注缩词（仅沙箱安全词）
    } else if (!rightIsTail && fits(safetyW, false)) {
      leftText = seg.tiersSafety; // rung3：右段今日藏（尾注不藏——帽截断保底）
      showRight = false;
    } else {
      // rung4/rung5：右段今日恒藏（尾注保真——帽截断保底）；rung4 = 仅档位
      // danger 位（安全信息最后保真——ellipsize 容忍），尾注在场时须双垫可容
      // 才并陈（几何不容则尾注独占——尾注永不丢且不被左段覆写 garble）
      showRight = rightIsTail;
      if (seg.danger && (!rightIsTail || fits(safetyW, true))) {
        leftText = seg.tiersSafety === '' ? '' : ellipsize(seg.tiersSafety, w);
      }
    }
    // rung5：全空（左右皆空——行保留恒 1 由 measure 承诺）
    if (leftText !== '') {
      buffer.writeText(region.row, region.col, leftText, this.footerStyle);
    }
    if (showRight) {
      // 右对齐 + 1 列右缘垫（codex right-aligned 同构）；尾注正文前景
      buffer.writeText(
        region.row,
        region.col + Math.max(0, w - 1 - rW),
        rightText,
        rightIsTail ? undefined : this.footerStyle,
      );
    }
  }

  /** 左段适配（超宽整字截断 + 省略号；0 宽早退由 ellipsize 单源守卫吸收） */
  private fit(text: string, max: number): string {
    return ellipsize(text, Math.max(0, max));
  }

  /** 闲态文案（last-writer-wins——usage 行与自定义状态同载体共存） */
  setStatus(text: string): void {
    this.idleText = text;
    this.onChange?.();
  }

  /**
   * footer 段集（V-3 注⑦②——装配位拼段注入）：null = 清除回旧形（可逆
   * 切换——footer 门控缺席零扰动）。
   */
  setFooter(seg: FooterSegments | null): void {
    this.seg = seg;
    this.onChange?.();
  }
}
