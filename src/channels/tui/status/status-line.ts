/**
 * 状态行件（07 §4.1 呈现面件 3——批 10d-4；V-4 注⑪ 笔3 底栏三行栈重做）。
 *
 * - **三行栈（注⑪①——用户口述定序）**：行1 = 仪表栈（模式/思考/模型/累计/
 *   速度/上下文——供数器渲染期 pull）+ 尾注让位（⑨ 右对齐右缘垫 1，在场即
 *   自右起挤占仪表槽——与坍缩梯⑧同向衔接）；行2 = 环境栈（目录/短 id/⎇
 *   支名@短哈希/沙箱原词 + 教学提示 dim——同源两表示：行1 模式词换词〔MODE_
 *   SHORT〕行2 沙箱原词〔SANDBOX_MODE_SHORT〕）；行3 = JobPanel（renderFixed
 *   段八迁最底行——件内零涉）。
 * - **窄宽坍缩梯（注⑪⑧——右起丢）**：行2 教学先丢（承 V-3 律）→ 沙箱 → ⎇
 *   → 短 id → 目录（目录 ellipsize 兜底——fitFooter 整字截断律退役让位；
 *   数据全空 = 整行退场零高度）；行1 上下文 → 速度 → 累计 → 模型 → 思考 →
 *   **模式词恒保**（rung4 承袭——安全信息最后保真，ellipsize 容忍）。
 *   量高与宽度无关（宽度不驱退场——防行跳动）。
 * - 模式槽 danger 档（YOLO）→ error 语义键（承 danger 打头安全律）；其余
 *   仪表槽/环境槽 secondary；教学提示 dim（教学位弱存在感）。
 * - footer 缺席（setFooter 未调 / null 清除）= 旧形：闲态文案居左满行。
 * - onChange 通知：状态任何变更（换文案/换 footer 段集）触发——装配层接重绘。
 */
import type { CellBuffer, CellStyle, Region, Renderable } from '../../engine/index.js';
import { ellipsize, stringWidth } from '../../engine/index.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import { DIM_STYLE } from '../../engine/index.js';

/**
 * footer 三行栈段集（V-4 注⑪②③——backend 装配位供数器注入）：仪表/环境两
 * 行均供数器渲染期 pull（流中活值随 tick 重画直取现值——承 TaskStatusProviders
 * 先例）；低频值（档位 fold/git 读盘）由 backend 低频锚缓存后经供数器读缓存
 * （tiers fold 与 git IO 不进渲染期）。
 */
export interface FooterSegments {
  /**
   * 行1 仪表槽供数器（槽序 = 模式/思考/模型/累计/速度/上下文——注⑪② 定
   * 序；'' 槽缺席过滤）。首槽 = 模式词（坍缩梯恒保位 + modeDanger 样式判据）。
   */
  readonly instruments: () => readonly string[];
  /**
   * 行2 环境槽供数器（槽序 = 目录/短 id/⎇ 支名@短哈希/沙箱原词——注⑪③
   * 定序；'' 槽缺席过滤）。全空（含教学缺席）= 行2 整行退场零高度。
   */
  readonly env: () => readonly string[];
  /** 闲态教学提示（`? 快捷键`——空稿闲态门控在 backend 侧；退场 = ''） */
  readonly hint: string;
  /** 模式词 danger 档（YOLO 警示色——行1 恒保位样式判据） */
  readonly modeDanger: boolean;
}

/** 槽间连接符（' · '——3 显示列；样式随前一槽） */
const SEGMENT_SEP = ' · ';

/** 供数器安全拉取（fail-open：装配侧闭包异常归空段——渲染路不断流；filter 返新数组可原地 pop） */
function pullSafe(source: () => readonly string[]): string[] {
  try {
    return source().filter((slot) => slot !== '');
  } catch {
    return [];
  }
}

/** 槽列连缀宽（含槽间连接符） */
function joinedWidth(slots: readonly string[]): number {
  if (slots.length === 0) return 0;
  return slots.reduce((sum, slot) => sum + stringWidth(slot), 0) + (slots.length - 1) * stringWidth(SEGMENT_SEP);
}

/**
 * 状态行件（量高 1-2：行1 恒 1〔零高度行跳动律〕+ 行2 数据在场 1——宽度不
 * 驱退场；行3 JobPanel 归 renderFixed 段八非本件）。
 */
export class StatusLine implements Renderable {
  /** 状态变更通知（装配层接重绘请求——setStatus/setFooter） */
  onChange?: () => void;
  /** 闲态文案（setStatus last-writer-wins——件 6 尾注/回执同载体；footer 在场 = 行1 尾注⑨） */
  private idleText = '';
  /**
   * 仪表槽样式（secondary 次文键——常驻信息退后；模式槽 danger 档独立
   * errorStyle；setTheme 派生重建）。
   */
  private footerStyle: Readonly<CellStyle> = Object.freeze({ fg: DEFAULT_THEME.secondary });
  /** 模式槽警示样式（modeDanger——error 语义键） */
  private dangerStyle: Readonly<CellStyle> = Object.freeze({ fg: DEFAULT_THEME.error });
  /** 教学提示样式（dim——教学位弱存在感，不入 §4.4 律三载体集） */
  private readonly hintStyle: Readonly<CellStyle> = DIM_STYLE;
  /** footer 段集（null = footer 缺席旧形——闲态文案居左满行） */
  private seg: FooterSegments | null = null;

  /** 主题换装（backend 注入——secondary/error 派生样式重建） */
  setTheme(theme: ResolvedTheme): void {
    this.footerStyle = Object.freeze({ fg: theme.secondary });
    this.dangerStyle = Object.freeze({ fg: theme.error });
  }

  /** 量高：footer 缺席/行2 数据全空 = 1；行2 任一环境槽或教学在场 = 2（宽度无关） */
  measure(_width: number): number {
    if (this.seg === null) return 1;
    return pullSafe(this.seg.env).length > 0 || this.seg.hint !== '' ? 2 : 1;
  }

  /** 落位：footer 缺席 = 旧形（闲态文案居左）；在场 = 行1 仪表 + 尾注 + 行2 环境 */
  render(buffer: CellBuffer, region: Region): void {
    if (this.seg === null) {
      // 旧形（footer 缺席——零扰动锚）
      if (this.idleText !== '') buffer.writeText(region.row, region.col, this.idleText);
      return;
    }
    const w = region.width;
    if (w <= 0) return;
    const seg = this.seg;
    // —— 行1：仪表栈 + 尾注让位（⑨——尾注右对齐右缘垫 1，在场即自右起
    // 挤占仪表预算；双垫 = 间隔 1 + 右缘 1，仪表全空时尾注独享右槽）——
    const tail = this.idleText !== '' ? ellipsize(this.idleText, Math.max(0, w - 2)) : '';
    const tailW = stringWidth(tail);
    const budget = tailW > 0 ? Math.max(0, w - tailW - 2) : w;
    const slots = pullSafe(seg.instruments);
    // 坍缩梯⑧：右起丢非模式槽（上下文→速度→累计→模型→思考——装配槽序即
    // 丢弃序）；模式词（首槽）恒保——独存仍超宽走 ellipsize（整字截断容忍）
    while (slots.length > 1 && joinedWidth(slots) > budget) slots.pop();
    this.writeSlots(buffer, region.row, region.col, slots, budget, seg.modeDanger);
    if (tailW > 0) {
      // 尾注正文前景（瞬时重要信息——右对齐 + 1 列右缘垫）
      buffer.writeText(region.row, region.col + Math.max(0, w - 1 - tailW), tail);
    }
    // —— 行2：环境栈（数据全空 = 整行退场——measure 已承诺高度不含此行）——
    if (region.height < 2) return;
    const envSlots = pullSafe(seg.env);
    if (envSlots.length === 0 && seg.hint === '') return;
    const row2 = seg.hint !== '' ? [...envSlots, seg.hint] : [...envSlots];
    // 坍缩梯⑧：右起丢（教学先丢〔末位〕→ 沙箱 → ⎇ → 短 id）；目录（首位）
    // 永不丢——独存超宽走 ellipsize 兜底（fitFooter 整字截断律退役让位）
    while (row2.length > 1 && joinedWidth(row2) > w) row2.pop();
    this.writeSlots(buffer, region.row + 1, region.col, row2, w, false, seg.hint);
  }

  /**
   * 槽列写出（逐槽定位——样式随槽：首槽 modeDanger 时 error / 教学槽 dim /
   * 其余 secondary；连接符样式随前一槽）。超预算整段 ellipsize（模式词恒保
   * 形与目录兜底共用此路）。
   */
  private writeSlots(
    buffer: CellBuffer,
    row: number,
    col: number,
    slots: readonly string[],
    budget: number,
    modeDanger: boolean,
    hint?: string,
  ): void {
    if (slots.length === 0) return;
    const sepW = stringWidth(SEGMENT_SEP);
    // 整段超预算（模式词独存/目录独存形）：ellipsize 收口整段单样式写出
    if (joinedWidth(slots) > budget) {
      const style = modeDanger && slots.length === 1 ? this.dangerStyle : this.footerStyle;
      buffer.writeText(row, col, ellipsize(slots.join(SEGMENT_SEP), budget), style);
      return;
    }
    let at = col;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      const style = slot === hint ? this.hintStyle : i === 0 && modeDanger ? this.dangerStyle : this.footerStyle;
      buffer.writeText(row, at, slot, style);
      at += stringWidth(slot);
      if (i < slots.length - 1) {
        buffer.writeText(row, at, SEGMENT_SEP, style); // 连接符随前一槽样式
        at += sepW;
      }
    }
  }

  /** 闲态文案（last-writer-wins——usage 行与自定义状态同载体共存） */
  setStatus(text: string): void {
    this.idleText = text;
    this.onChange?.();
  }

  /**
   * footer 段集（V-4 注⑪②③——装配位供数器注入）：null = 清除回旧形（可逆
   * 切换——footer 门控缺席零扰动）。
   */
  setFooter(seg: FooterSegments | null): void {
    this.seg = seg;
    this.onChange?.();
  }
}
